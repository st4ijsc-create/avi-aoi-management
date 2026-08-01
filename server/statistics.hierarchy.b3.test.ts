/**
 * DB-integration tests for doc 27 W4-C:
 *
 *  B3 — the dashboard-stats hierarchy filter is now ONE query
 *  (machineId IN (machines ⋈ stations ⋈ lines ⋈ workshops)) instead of 4
 *  sequential round-trips. Expectations below are HAND-COMPUTED from the
 *  seeded fixture (never compared against the old code path):
 *
 *    Factory F1
 *      ws1 → line1 → st1 → machine A : OK, OK, NG   (3 rows)
 *      ws2 → line2 → st2 → machine B : NTF          (1 row)
 *    Factory F2
 *      ws3 → line3 → st3 → machine C : NG           (1 row)
 *
 *  Deliberate semantic fixes (documented in statistics.ts):
 *    - workshopId used to be a DEAD parameter → now filters;
 *    - a hierarchy filter that matches no machines used to FALL THROUGH to
 *      unfiltered/global rows in some shapes → now honestly returns zeros/empty.
 *
 *  B9 — list reads (getProductInspections / getProductInspectionsCursor /
 *  searchInspections) return the PROJECTED column set only (no heavy
 *  json/text detail columns).
 *
 * Runs against the isolated cloned test DB (vitest.setup.ts).
 */
import { describe, it, expect, beforeAll } from "vitest";
import * as db from "./db";
import { getDb } from "./db/connection";
import { inArray, eq, and, gte, lte, sql } from "drizzle-orm";
import {
  workshops,
  productionLines,
  stations,
  machines,
  productInspections,
} from "../drizzle/schema";

const ts = Date.now();

// Fixture window — keep clear of other suites (kpi test uses 2026-03).
const rangeStart = new Date("2026-04-01T00:00:00Z");
const rangeEnd = new Date("2026-04-10T00:00:00Z");
const baseTime = new Date("2026-04-05T03:00:00Z").getTime();

const F1_CODE = `TEST_B3_F1_${ts}`;
const F2_CODE = `TEST_B3_F2_${ts}`;
const WS2_CODE = `TEST_B3_WS2_${ts}`;
const MC_CODE = `TEST_B3_MC_${ts}`;

let f1Id: number;
let f2Id: number;
let ws2Id: number;
let mAId: number;
let mBId: number;
let mCId: number;

async function seedChain(opts: {
  factoryId: number;
  wsCode: string;
  machineCode: string;
}): Promise<{ workshopId: number; machineId: number }> {
  const workshopId = await db.createWorkshop({
    factoryId: opts.factoryId,
    code: opts.wsCode,
    name: opts.wsCode,
  });
  const lineId = await db.createProductionLine({
    workshopId,
    code: `${opts.wsCode}_LN`,
    name: `${opts.wsCode} line`,
  });
  const stationId = await db.createStation({
    lineId,
    code: `${opts.wsCode}_ST`,
    name: `${opts.wsCode} station`,
    sequence: 1,
  });
  const machineId = await db.createMachine({
    stationId,
    code: opts.machineCode,
    name: opts.machineCode,
    machineType: "AOI",
    apiKey: `test_${opts.machineCode}`,
  });
  return { workshopId, machineId };
}

describe("hierarchy filter single-query (B3) + list projection (B9)", () => {
  beforeAll(async () => {
    f1Id = await db.createFactory({ code: F1_CODE, name: "B3 factory 1" });
    f2Id = await db.createFactory({ code: F2_CODE, name: "B3 factory 2" });

    const c1 = await seedChain({ factoryId: f1Id, wsCode: `TEST_B3_WS1_${ts}`, machineCode: `TEST_B3_MA_${ts}` });
    const c2 = await seedChain({ factoryId: f1Id, wsCode: WS2_CODE, machineCode: `TEST_B3_MB_${ts}` });
    const c3 = await seedChain({ factoryId: f2Id, wsCode: `TEST_B3_WS3_${ts}`, machineCode: MC_CODE });
    mAId = c1.machineId;
    ws2Id = c2.workshopId;
    mBId = c2.machineId;
    mCId = c3.machineId;

    const rows: Array<[number, "OK" | "NG" | "NTF", number]> = [
      [mAId, "OK", 0],
      [mAId, "OK", 1],
      [mAId, "NG", 2],
      [mBId, "NTF", 3],
      [mCId, "NG", 4],
    ];
    let n = 0;
    for (const [machineId, overallResult, minutes] of rows) {
      n += 1;
      await db.createProductInspection({
        machineId,
        serialNumber: `SN_B3_${ts}_${n}`,
        overallResult,
        originalResult: overallResult === "NTF" ? "NG" : overallResult,
        inspectionTime: new Date(baseTime + minutes * 60_000),
      });
    }
  });

  // ── B3: getDashboardStats hierarchy filter ────────────────────────────────

  it("factoryId filter aggregates exactly the machines under that factory", async () => {
    const stats = await db.getDashboardStats({ factoryId: f1Id, startDate: rangeStart, endDate: rangeEnd });
    // Hand-computed: mA (OK,OK,NG) + mB (NTF) = 4 rows.
    expect(stats.total).toBe(4);
    expect(stats.ok).toBe(2);
    expect(stats.ng).toBe(1);
    expect(stats.ntf).toBe(1);
    // Canonical final yield: (2 OK + 1 NTF) / 4 = 75%.
    expect(stats.yieldRate).toBe(75);
    // True FPY: 4 distinct serials, firsts = OK,OK,NG,NTF → 2/4 = 50%.
    expect(stats.firstTotal).toBe(4);
    expect(stats.firstPass).toBe(2);
    expect(stats.fpy).toBe(50);
  });

  it("workshopId filter (previously a dead parameter) now actually filters", async () => {
    const stats = await db.getDashboardStats({ workshopId: ws2Id, startDate: rangeStart, endDate: rangeEnd });
    expect(stats.total).toBe(1);
    expect(stats.ntf).toBe(1);
    expect(stats.ok).toBe(0);
    expect(stats.ng).toBe(0);
    expect(stats.yieldRate).toBe(100); // NTF counts as pass in final yield
  });

  it("does not leak the neighbour factory", async () => {
    const stats = await db.getDashboardStats({ factoryId: f2Id, startDate: rangeStart, endDate: rangeEnd });
    expect(stats.total).toBe(1);
    expect(stats.ng).toBe(1);
    expect(stats.yieldRate).toBe(0);
  });

  it("a factory that resolves to zero machines returns zeros (no fall-through to global)", async () => {
    const stats = await db.getDashboardStats({ factoryId: 999_999_999, startDate: rangeStart, endDate: rangeEnd });
    expect(stats.total).toBe(0);
    expect(stats.ok).toBe(0);
    expect(stats.ng).toBe(0);
    expect(stats.ntf).toBe(0);
    expect(stats.yieldRate).toBe(0);
    expect(stats.fpy).toBe(0);
  });

  it("factoryId intersects with machineId", async () => {
    const stats = await db.getDashboardStats({
      factoryId: f1Id,
      machineId: mBId,
      startDate: rangeStart,
      endDate: rangeEnd,
    });
    expect(stats.total).toBe(1);
    expect(stats.ntf).toBe(1);
  });

  // ── B3: searchInspections hierarchy filter ────────────────────────────────

  it("searchInspections factoryCode returns exactly the rows under that factory", async () => {
    const res = await db.searchInspections({ factoryCode: F1_CODE, startDate: rangeStart, endDate: rangeEnd });
    expect(Number(res.total)).toBe(4);
    const machineIds = new Set(res.data.map((r: any) => r.machineId));
    expect(machineIds).toEqual(new Set([mAId, mBId]));
  });

  it("searchInspections machineCode overrides the other hierarchy filters (preserved)", async () => {
    const res = await db.searchInspections({
      machineCode: MC_CODE,
      // deliberately contradictory factory filter — the old if/else-if shape ignored it
      factoryCode: F1_CODE,
      startDate: rangeStart,
      endDate: rangeEnd,
    });
    expect(Number(res.total)).toBe(1);
    expect(res.data[0].machineId).toBe(mCId);
  });

  it("searchInspections with an unmatched factoryCode returns empty", async () => {
    const res = await db.searchInspections({ factoryCode: `NO_SUCH_FACTORY_${ts}` });
    expect(res.data).toEqual([]);
    expect(Number(res.total)).toBe(0);
  });

  it("unmatched factoryCode + valid workshopCode is empty (old code silently dropped the factory filter)", async () => {
    const res = await db.searchInspections({
      factoryCode: `NO_SUCH_FACTORY_${ts}`,
      workshopCode: WS2_CODE,
    });
    expect(res.data).toEqual([]);
    expect(Number(res.total)).toBe(0);
  });

  // ── B9: list projection ───────────────────────────────────────────────────

  const mustHave = [
    "id", "machineId", "serialNumber", "productModel", "productModelId",
    "overallResult", "originalResult", "inspectionTime", "corporateCode",
    "factoryCode", "workshopCode", "lineCode", "stageCode", "batchNumber",
    "cycleTime", "acknowledgedBy", "acknowledgedAt", "aiDecision", "createdAt",
  ];
  const mustNotHave = [
    "notes", "tags", "ntfConfirmedBy", "ntfConfirmedAt", "ntfReason",
    "isArchived", "archivedAt", "archivedBy", "aiConfidence", "aiModelId",
    "aiProcessedAt", "aiDetails", "inspectionType", "variantPayload",
    "operatorId", "productionOrderCode", "ingestMode", "updatedAt",
  ];

  function expectProjectedShape(row: Record<string, unknown>) {
    for (const key of mustHave) expect(row, `missing projected column ${key}`).toHaveProperty(key);
    for (const key of mustNotHave) {
      expect(Object.prototype.hasOwnProperty.call(row, key), `detail-only column ${key} leaked into list payload`).toBe(false);
    }
  }

  it("getProductInspections returns the projected list shape", async () => {
    const res = await db.getProductInspections({ machineId: mAId, startDate: rangeStart, endDate: rangeEnd });
    expect(res.data).toHaveLength(3);
    expectProjectedShape(res.data[0] as any);
  });

  it("searchInspections returns the projected list shape", async () => {
    const res = await db.searchInspections({ factoryCode: F1_CODE, startDate: rangeStart, endDate: rangeEnd });
    expectProjectedShape(res.data[0] as any);
  });

  it("getProductInspectionsCursor pages with the projected shape and working cursors", async () => {
    const page1 = await db.getProductInspectionsCursor({
      machineId: mAId,
      startDate: rangeStart,
      endDate: rangeEnd,
      limit: 2,
    });
    expect(page1.data).toHaveLength(2);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).toBeTruthy();
    expectProjectedShape(page1.data[0] as any);

    const page2 = await db.getProductInspectionsCursor({
      machineId: mAId,
      startDate: rangeStart,
      endDate: rangeEnd,
      limit: 2,
      cursor: page1.nextCursor!,
    });
    expect(page2.data).toHaveLength(1);
    expect(page2.hasMore).toBe(false);
    const ids = [...page1.data, ...page2.data].map((r) => r.id);
    expect(new Set(ids).size).toBe(3); // no dup/skip across the cursor boundary
  });

  // ── Honest benchmark: old 4-round-trip shape vs new single query ──────────

  it("benchmark: 4 sequential round-trips vs 1 subquery (rough, logged)", async () => {
    const dbc = await getDb();
    if (!dbc) throw new Error("Database not available");

    const ITER = 25;

    // OLD shape — replicated verbatim from the pre-B3 code (4 awaited selects
    // to resolve machine IDs, then the aggregate with an inArray literal list).
    async function oldShape() {
      const workshopsInFactory = await dbc.select({ id: workshops.id }).from(workshops)
        .where(eq(workshops.factoryId, f1Id));
      const workshopIds = workshopsInFactory.map((w) => w.id);
      const linesInWorkshops = await dbc.select({ id: productionLines.id }).from(productionLines)
        .where(inArray(productionLines.workshopId, workshopIds));
      const lineIds = linesInWorkshops.map((l) => l.id);
      const stationsInLines = await dbc.select({ id: stations.id }).from(stations)
        .where(inArray(stations.lineId, lineIds));
      const stationIds = stationsInLines.map((s) => s.id);
      const machinesInStations = await dbc.select({ id: machines.id }).from(machines)
        .where(inArray(machines.stationId, stationIds));
      const machineIds = machinesInStations.map((m) => m.id);
      const [row] = await dbc.select({
        total: sql<number>`count(*)`,
        ok: sql<number>`sum(case when ${productInspections.overallResult} = 'OK' then 1 else 0 end)`,
      }).from(productInspections).where(and(
        gte(productInspections.inspectionTime, rangeStart),
        lte(productInspections.inspectionTime, rangeEnd),
        inArray(productInspections.machineId, machineIds),
      ));
      return Number(row.total);
    }

    // Warm-up (connection, plan caches) so neither side pays first-query cost.
    await oldShape();
    await db.getDashboardStats({ factoryId: f1Id, startDate: rangeStart, endDate: rangeEnd });

    const t0 = performance.now();
    for (let i = 0; i < ITER; i++) await oldShape();
    const oldMs = performance.now() - t0;

    const t1 = performance.now();
    for (let i = 0; i < ITER; i++) {
      await db.getDashboardStats({ factoryId: f1Id, startDate: rangeStart, endDate: rangeEnd });
    }
    const newMs = performance.now() - t1;

    // eslint-disable-next-line no-console
    console.log(
      `[B3 benchmark] hierarchy filter ×${ITER}: OLD 4-round-trip ${(oldMs / ITER).toFixed(1)}ms/call` +
      ` vs NEW single-query getDashboardStats ${(newMs / ITER).toFixed(1)}ms/call` +
      ` (note: NEW also runs the FPY aggregate the old shape above does not — real gap is larger)`,
    );

    // Sanity only — no flaky timing assertions.
    const total = await oldShape();
    expect(total).toBe(4);
  }, 60_000);
});
