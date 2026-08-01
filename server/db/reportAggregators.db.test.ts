/**
 * Wave R1 (doc 32) — INTEGRATION tests for the report aggregators against the
 * ISOLATED test DB (vitest.setup.ts rewrites DATABASE_URL to <db>_test).
 *
 * Seeds CLASSIFIED NG data (doc 31 note: real historical data is ~0% classified
 * because the feed carried no codes) so the category/severity/ipcSection rollup
 * is actually exercised, plus an honest UNCLASSIFIED bucket (NG with no
 * defectCatalogId). Also proves per-product yield, factory-TZ per-week bucketing
 * across a week boundary, and the workstation NG heatmap (was a mock empty
 * array in reportGenerator).
 *
 * All fixtures are isolated by machineId; the M2 week-boundary rows are pinned
 * to naive UTC wall-times that fall in DIFFERENT factory-local ISO weeks.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import {
  getDefectParetoByCategory,
  getYieldByProduct,
  getYieldTrendByWeek,
  getWorkstationHeatmap,
} from "./reportAggregators";

const DB_URL = process.env.DATABASE_URL;
const RUN = `R1B${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

// Wide window — all fixtures live in late June 2026.
const WINDOW = { startDate: new Date("2026-06-01T00:00:00Z"), endDate: new Date("2026-07-15T00:00:00Z") };

let sql: ReturnType<typeof postgres>;
let prevFactoryTz: string | undefined;
let prevStorageTz: string | undefined;

const ids = {
  factory: 0, workshop: 0, line: 0, station: 0,
  machine1: 0, machine2: 0,
  product1: 0, product2: 0,
  workstation: 0,
  pointWs: 0, pointNoWs: 0,
  dcSolder: 0, dcComp: 0, dcPcb: 0,
  insp0: 0,
  inspIds: [] as number[],
  resultIds: [] as number[],
};

describe.skipIf(!DB_URL)("R1-B report aggregators (seeded, factory-TZ)", () => {
  beforeAll(async () => {
    // Pin factory + storage timezones to their defaults so the per-week bucket
    // assertions are deterministic (UTC-stored naive → Asia/Ho_Chi_Minh local).
    prevFactoryTz = process.env.FACTORY_TZ;
    prevStorageTz = process.env.FACTORY_DB_STORAGE_TZ;
    process.env.FACTORY_TZ = "Asia/Ho_Chi_Minh";
    process.env.FACTORY_DB_STORAGE_TZ = "UTC";

    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    // Pin the seed connection's session TZ to UTC so JS Date params are stored as
    // their UTC wall time (matching the canonical app write path + the
    // aggregators' FACTORY_DB_STORAGE_TZ=UTC read side). Without this the server's
    // default session TZ (Asia/Ho_Chi_Minh here) shifts stored naive timestamps.
    await sql`SET TIME ZONE 'UTC'`;

    const [f] = await sql`INSERT INTO factories (code, name) VALUES (${"F-" + RUN}, 'R1B factory') RETURNING id`;
    ids.factory = f.id;
    const [w] = await sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${ids.factory}, ${"W-" + RUN}, 'R1B workshop') RETURNING id`;
    ids.workshop = w.id;
    const [l] = await sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ids.workshop}, ${"L-" + RUN}, 'R1B line') RETURNING id`;
    ids.line = l.id;
    const [s] = await sql`INSERT INTO stations ("lineId", code, name) VALUES (${ids.line}, ${"S-" + RUN}, 'R1B station') RETURNING id`;
    ids.station = s.id;
    const [m1] = await sql`INSERT INTO machines ("stationId", code, name, "machineType") VALUES (${ids.station}, ${"M1-" + RUN}, 'R1B machine 1', 'AOI') RETURNING id`;
    ids.machine1 = m1.id;
    const [m2] = await sql`INSERT INTO machines ("stationId", code, name, "machineType") VALUES (${ids.station}, ${"M2-" + RUN}, 'R1B machine 2', 'AOI') RETURNING id`;
    ids.machine2 = m2.id;
    const [p1] = await sql`INSERT INTO product_models (code, name) VALUES (${"P1-" + RUN}, 'R1B product 1') RETURNING id`;
    ids.product1 = p1.id;
    const [p2] = await sql`INSERT INTO product_models (code, name) VALUES (${"P2-" + RUN}, 'R1B product 2') RETURNING id`;
    ids.product2 = p2.id;

    const [ws] = await sql`INSERT INTO workstations (code, name) VALUES (${"WS-" + RUN}, 'R1B workstation') RETURNING id`;
    ids.workstation = ws.id;

    const mkPoint = async (code: string, workstationId: number | null) => {
      const [r] = await sql`
        INSERT INTO measurement_point_defs
          ("productModelId", code, name, "measurementType", "positionX", "positionY", "workstationId")
        VALUES (${ids.product1}, ${code}, ${code}, 'VISUAL', 10, 10, ${workstationId})
        RETURNING id`;
      return r.id as number;
    };
    ids.pointWs = await mkPoint(`PT-WS-${RUN}`, ids.workstation);
    ids.pointNoWs = await mkPoint(`PT-NOWS-${RUN}`, null);

    // Defect catalog: 3 categories/severities; DC_solder + DC_comp share IPC section '8'.
    const mkDefect = async (code: string, category: string, severity: string, ipcSection: string) => {
      const [r] = await sql`
        INSERT INTO defect_catalog (code, name, severity, category, "ipcSection")
        VALUES (${code}, ${code}, ${severity}, ${category}, ${ipcSection})
        RETURNING id`;
      return r.id as number;
    };
    ids.dcSolder = await mkDefect(`DC-SOL-${RUN}`, "solder", "major", "8");
    ids.dcComp = await mkDefect(`DC-CMP-${RUN}`, "component", "critical", "8");
    ids.dcPcb = await mkDefect(`DC-PCB-${RUN}`, "pcb", "minor", "10");

    const mkInsp = async (
      machineId: number,
      productModelId: number,
      overall: "OK" | "NG" | "NTF",
      time: Date,
    ) => {
      const [r] = await sql`
        INSERT INTO product_inspections
          ("machineId", "productModelId", "serialNumber", "overallResult", "originalResult", "inspectionTime")
        VALUES (${machineId}, ${productModelId}, ${`SN-${RUN}-${ids.inspIds.length}`}, ${overall},
                ${overall === "NTF" ? "NG" : overall}, ${time})
        RETURNING id`;
      ids.inspIds.push(r.id);
      return r.id as number;
    };

    // Seed inspectionTime via JS Date (UTC instants) — the canonical write path
    // stores naive columns as the UTC wall time, which the aggregators read back
    // with FACTORY_DB_STORAGE_TZ=UTC. (A raw naive STRING param is re-interpreted
    // through the server session TZ on write and would shift by the offset.)
    const M1_TIME = new Date("2026-06-28T12:00:00.000Z");

    // insp0 (M1/P1) carries ALL measurement_results for the pareto/heatmap tests.
    ids.insp0 = await mkInsp(ids.machine1, ids.product1, "NG", M1_TIME);

    const addResult = async (pointDefId: number, result: "OK" | "NG", defectCatalogId: number | null) => {
      const [r] = await sql`
        INSERT INTO measurement_results ("inspectionId", "pointDefId", result, "defectCatalogId")
        VALUES (${ids.insp0}, ${pointDefId}, ${result}, ${defectCatalogId}) RETURNING id`;
      ids.resultIds.push(r.id as number);
    };
    // solder×5 + component×3 on the workstation-linked point; pcb×2 + UNCLASSIFIED×4
    // on the no-workstation point; +1 OK control (ignored by NG pareto).
    for (let i = 0; i < 5; i++) await addResult(ids.pointWs, "NG", ids.dcSolder);
    for (let i = 0; i < 3; i++) await addResult(ids.pointWs, "NG", ids.dcComp);
    for (let i = 0; i < 2; i++) await addResult(ids.pointNoWs, "NG", ids.dcPcb);
    for (let i = 0; i < 4; i++) await addResult(ids.pointNoWs, "NG", null);
    await addResult(ids.pointWs, "OK", null);

    // Per-product yield fixture (M1): P1 total 10 (6 OK, 3 NG incl insp0, 1 NTF),
    // P2 total 5 (5 OK).
    for (let i = 0; i < 6; i++) await mkInsp(ids.machine1, ids.product1, "OK", M1_TIME);
    for (let i = 0; i < 2; i++) await mkInsp(ids.machine1, ids.product1, "NG", M1_TIME);
    await mkInsp(ids.machine1, ids.product1, "NTF", M1_TIME);
    for (let i = 0; i < 5; i++) await mkInsp(ids.machine1, ids.product2, "OK", M1_TIME);

    // Per-week fixture (M2): two inspections whose FACTORY-LOCAL time falls in
    // different ISO weeks though both are 2026-06-28 in UTC (stored as UTC wall
    // time; the aggregator converts UTC→Asia/Ho_Chi_Minh before date_trunc).
    //   16:00Z → 2026-06-28 23:00 +07 (Sun) → week Mon 2026-06-22 (W26)
    //   20:00Z → 2026-06-29 03:00 +07 (Mon) → week Mon 2026-06-29 (W27)
    await mkInsp(ids.machine2, ids.product1, "OK", new Date("2026-06-28T16:00:00.000Z"));
    await mkInsp(ids.machine2, ids.product1, "NG", new Date("2026-06-28T20:00:00.000Z"));
  }, 120_000);

  afterAll(async () => {
    try {
      if (ids.resultIds.length) await sql`DELETE FROM measurement_results WHERE id IN ${sql(ids.resultIds)}`;
      if (ids.inspIds.length) await sql`DELETE FROM product_inspections WHERE id IN ${sql(ids.inspIds)}`;
      await sql`DELETE FROM measurement_point_defs WHERE id IN ${sql([ids.pointWs, ids.pointNoWs].filter(Boolean))}`;
      await sql`DELETE FROM defect_catalog WHERE id IN ${sql([ids.dcSolder, ids.dcComp, ids.dcPcb].filter(Boolean))}`;
      if (ids.workstation) await sql`DELETE FROM workstations WHERE id = ${ids.workstation}`;
      await sql`DELETE FROM machines WHERE id IN ${sql([ids.machine1, ids.machine2].filter(Boolean))}`;
      await sql`DELETE FROM product_models WHERE id IN ${sql([ids.product1, ids.product2].filter(Boolean))}`;
      if (ids.station) await sql`DELETE FROM stations WHERE id = ${ids.station}`;
      if (ids.line) await sql`DELETE FROM production_lines WHERE id = ${ids.line}`;
      if (ids.workshop) await sql`DELETE FROM workshops WHERE id = ${ids.workshop}`;
      if (ids.factory) await sql`DELETE FROM factories WHERE id = ${ids.factory}`;
    } finally {
      await sql?.end();
      if (prevFactoryTz === undefined) delete process.env.FACTORY_TZ; else process.env.FACTORY_TZ = prevFactoryTz;
      if (prevStorageTz === undefined) delete process.env.FACTORY_DB_STORAGE_TZ; else process.env.FACTORY_DB_STORAGE_TZ = prevStorageTz;
    }
  }, 60_000);

  it("defect Pareto by CATEGORY — cumulative % + honest UNCLASSIFIED bucket", async () => {
    const r = await getDefectParetoByCategory({ ...WINDOW, machineId: ids.machine1, dimension: "category" });

    expect(r.dimension).toBe("category");
    expect(r.totalDefects).toBe(14); // OK row never counts
    expect(r.classifiedDefects).toBe(10);
    expect(r.unclassifiedDefects).toBe(4);

    // Ranking: solder(5) > UNCLASSIFIED(4) > component(3) > pcb(2).
    expect(r.items[0]).toMatchObject({ key: "solder", count: 5, bucket: "value" });
    expect(r.items[1]).toMatchObject({ key: "UNCLASSIFIED", count: 4, bucket: "unclassified" });
    expect(r.items.find((i) => i.key === "component")).toMatchObject({ count: 3 });
    expect(r.items.find((i) => i.key === "pcb")).toMatchObject({ count: 2 });
    expect(r.items[0].percentage).toBeCloseTo(35.71, 1);
    expect(r.items[r.items.length - 1].cumulativePercentage).toBe(100);
  });

  it("defect Pareto by SEVERITY and by IPC-SECTION (rollup merges shared section)", async () => {
    const bySeverity = await getDefectParetoByCategory({ ...WINDOW, machineId: ids.machine1, dimension: "severity" });
    expect(bySeverity.dimension).toBe("severity");
    expect(bySeverity.totalDefects).toBe(14);
    expect(bySeverity.items.find((i) => i.key === "major")).toMatchObject({ count: 5 });
    expect(bySeverity.items.find((i) => i.key === "critical")).toMatchObject({ count: 3 });

    const bySection = await getDefectParetoByCategory({ ...WINDOW, machineId: ids.machine1, dimension: "ipcSection" });
    // DC_solder(5) + DC_comp(3) both live in IPC section '8' → merged to 8.
    expect(bySection.items.find((i) => i.key === "8")).toMatchObject({ count: 8 });
    expect(bySection.items.find((i) => i.key === "10")).toMatchObject({ count: 2 });
    expect(bySection.unclassifiedDefects).toBe(4);
  });

  it("yield by product — canonical final yield ((OK+NTF)/total) per product", async () => {
    const rows = await getYieldByProduct({ ...WINDOW, machineId: ids.machine1 });
    const p1 = rows.find((r) => r.productModelId === ids.product1);
    const p2 = rows.find((r) => r.productModelId === ids.product2);

    // P1: total 10 (6 OK, 3 NG, 1 NTF) → (6+1)/10 = 70%.
    expect(p1).toMatchObject({ total: 10, ok: 6, ng: 3, ntf: 1, yieldRate: 70 });
    expect(p1?.productCode).toBe(`P1-${RUN}`);
    // P2: total 5 all OK → 100%.
    expect(p2).toMatchObject({ total: 5, ok: 5, ng: 0, ntf: 0, yieldRate: 100 });
    // Ordered by output (total) descending → P1 first.
    expect(rows[0].productModelId).toBe(ids.product1);
  });

  it("yield trend by WEEK — factory-TZ ISO week buckets split at the boundary", async () => {
    const rows = await getYieldTrendByWeek({ ...WINDOW, machineId: ids.machine2 });

    // Two inspections, same UTC day, DIFFERENT factory-local ISO weeks → 2 buckets.
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ week: "2026-06-22", isoWeek: "2026-W26", total: 1, ok: 1, yieldRate: 100 });
    expect(rows[1]).toMatchObject({ week: "2026-06-29", isoWeek: "2026-W27", total: 1, ng: 1, yieldRate: 0 });
  });

  it("workstation heatmap — real non-empty rows in the report's consumed shape", async () => {
    const rows = await getWorkstationHeatmap({ ...WINDOW, machineId: ids.machine1 });
    expect(rows.length).toBeGreaterThan(0);

    // Each row must carry exactly the shape reportGenerator consumes.
    for (const r of rows) {
      expect(r).toHaveProperty("workstationName");
      expect(typeof r.ngCount).toBe("number");
      expect(typeof r.inspectionCount).toBe("number");
      expect(typeof r.ngRate).toBe("number");
    }

    // Linked point (workstation): solder5 + comp3 NG + 1 OK → ng 8 / total 9.
    const wsRow = rows.find((r) => r.workstationId === ids.workstation);
    expect(wsRow).toMatchObject({ ngCount: 8, inspectionCount: 9 });
    expect(wsRow?.ngRate).toBeCloseTo(88.89, 1);

    // Unlinked point rolls up honestly (pcb2 + unclassified4 NG → ng 6 / total 6).
    const unassigned = rows.find((r) => r.workstationId === null);
    expect(unassigned).toMatchObject({ ngCount: 6, inspectionCount: 6, ngRate: 100 });

    // Ordered by NG descending → workstation row (8) before unassigned (6).
    expect(rows[0].ngCount).toBeGreaterThanOrEqual(rows[rows.length - 1].ngCount);
  });
});
