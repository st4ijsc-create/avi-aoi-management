/**
 * Doc 55 Item 1 (PA-A "reserve-id") — INTEGRATION test of reserveInspectionId +
 * persistInspectionAtomic against the ISOLATED test DB (vitest.setup rewrites
 * DATABASE_URL → <db>_test). This is the MUTATION-PROOF for the single-transaction
 * ingest path: it exercises a REAL Postgres rollback, which no fake-drizzle unit
 * test can.
 *
 * Proves:
 *   • reserveInspectionId advances product_inspections_id_seq (strictly-increasing,
 *     positive integers — nextval comes back as a bigint string over postgres-js).
 *   • happy path — the header row AND its measurement rows COMMIT together.
 *   • ★ a measurement-insert failure ROLLS BACK the header → NO empty header remains
 *     (this is the whole point: the two-phase path leaves the header committed).
 *     MUTATION-PROOF: move the measurement insert OUT of persistInspectionAtomic's
 *     transaction and this assertion (0 header rows) goes RED.
 *   • duplicate via the idempotency ledger (0275) → exactly-once: no 2nd header, no
 *     2nd measurement, returns the ORIGINAL id + duplicate:true.
 *   • duplicate via the natural key (0272, no explicit key) → exactly-once.
 *   • promoteOverallToNg flips overallResult inside the same tx (originalResult kept).
 *
 * Fully self-contained fixtures (factory→…→machine, product + point def) + cleanup,
 * mirroring server/db/productClone.db.test.ts. Skipped when no DATABASE_URL.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { reserveInspectionId, persistInspectionAtomic } from "./inspection";
import type { InsertProductInspection, InsertMeasurementResult } from "../../drizzle/schema";

const DB_URL = process.env.DATABASE_URL;
const RUN = `PAA${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

let sql: ReturnType<typeof postgres>;
const ids = { factory: 0, workshop: 0, line: 0, station: 0, machine: 0, product: 0, point: 0 };
const inspectionIds: number[] = [];
const ledgerKeys: string[] = [];

describe.skipIf(!DB_URL)("persistInspectionAtomic — single-tx atomicity + dedup (doc 55 Item 1 PA-A)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    const [f] = await sql`INSERT INTO factories (code, name) VALUES (${"F-" + RUN}, 'PAA factory') RETURNING id`;
    ids.factory = f.id;
    const [w] = await sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${ids.factory}, ${"W-" + RUN}, 'PAA ws') RETURNING id`;
    ids.workshop = w.id;
    const [l] = await sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ids.workshop}, ${"L-" + RUN}, 'PAA line') RETURNING id`;
    ids.line = l.id;
    const [s] = await sql`INSERT INTO stations ("lineId", code, name) VALUES (${ids.line}, ${"S-" + RUN}, 'PAA station') RETURNING id`;
    ids.station = s.id;
    const [m] = await sql`INSERT INTO machines ("stationId", code, name, "machineType") VALUES (${ids.station}, ${"M-" + RUN}, 'PAA machine', 'AOI') RETURNING id`;
    ids.machine = m.id;
    const [p] = await sql`INSERT INTO product_models (code, name) VALUES (${"P-" + RUN}, 'PAA product') RETURNING id`;
    ids.product = p.id;
    const [pt] = await sql`
      INSERT INTO measurement_point_defs ("productModelId", code, name, "measurementType", "positionX", "positionY")
      VALUES (${ids.product}, ${"PT-" + RUN}, 'PAA point', 'DIMENSION', 10, 20) RETURNING id`;
    ids.point = pt.id;
  });

  afterAll(async () => {
    if (!sql) return;
    for (const id of inspectionIds) {
      await sql`DELETE FROM measurement_results WHERE "inspectionId" = ${id}`.catch(() => {});
      await sql`DELETE FROM product_inspections WHERE id = ${id}`.catch(() => {});
    }
    for (const k of ledgerKeys) {
      await sql`DELETE FROM inspection_idempotency_keys WHERE "machineId" = ${ids.machine} AND "idempotencyKey" = ${k}`.catch(() => {});
    }
    await sql`DELETE FROM measurement_point_defs WHERE id = ${ids.point}`.catch(() => {});
    await sql`DELETE FROM product_models WHERE id = ${ids.product}`.catch(() => {});
    await sql`DELETE FROM machines WHERE id = ${ids.machine}`.catch(() => {});
    await sql`DELETE FROM stations WHERE id = ${ids.station}`.catch(() => {});
    await sql`DELETE FROM production_lines WHERE id = ${ids.line}`.catch(() => {});
    await sql`DELETE FROM workshops WHERE id = ${ids.workshop}`.catch(() => {});
    await sql`DELETE FROM factories WHERE id = ${ids.factory}`.catch(() => {});
    await sql.end({ timeout: 5 });
  });

  const header = (
    id: number,
    over: Partial<InsertProductInspection> = {},
  ): InsertProductInspection & { id: number } => ({
    id,
    machineId: ids.machine,
    serialNumber: `${RUN}-${id}`,
    inspectionTime: new Date("2026-07-16T02:00:00.000Z"),
    overallResult: "OK",
    originalResult: "OK",
    ...over,
  });
  const mrow = (
    id: number,
    pointDefId = ids.point,
    over: Partial<InsertMeasurementResult> = {},
  ): InsertMeasurementResult => ({ inspectionId: id, pointDefId, result: "OK", ...over });

  const countInsp = async (id: number): Promise<number> =>
    Number((await sql`SELECT count(*)::int AS c FROM product_inspections WHERE id = ${id}`)[0].c);
  const countMr = async (id: number): Promise<number> =>
    Number((await sql`SELECT count(*)::int AS c FROM measurement_results WHERE "inspectionId" = ${id}`)[0].c);

  it("reserveInspectionId advances the sequence (strictly-increasing positive ints)", async () => {
    const a = await reserveInspectionId();
    const b = await reserveInspectionId();
    expect(Number.isInteger(a)).toBe(true);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
  });

  it("happy path — header + measurement rows COMMIT together", async () => {
    const id = await reserveInspectionId();
    inspectionIds.push(id);
    const res = await persistInspectionAtomic(
      header(id, { serialNumber: `${RUN}-OK` }),
      [mrow(id, ids.point, { measuredValue: "1.230000" }), mrow(id)],
      {},
    );
    expect(res).toEqual({ id, duplicate: false });
    expect(await countInsp(id)).toBe(1);
    expect(await countMr(id)).toBe(2);
  });

  it("★ measurement failure ROLLS BACK the header — no empty header remains (mutation-proof)", async () => {
    const id = await reserveInspectionId();
    inspectionIds.push(id); // track for cleanup even though it must not persist
    const BAD_POINT = 2_000_000_000; // no such measurement_point_def → FK violation mid-tx
    await expect(
      persistInspectionAtomic(header(id, { serialNumber: `${RUN}-FAIL` }), [mrow(id, BAD_POINT)], {}),
    ).rejects.toThrow();
    // The two-phase path leaves this header behind; the single physical tx must not.
    expect(await countInsp(id)).toBe(0);
    expect(await countMr(id)).toBe(0);
  });

  it("duplicate idempotencyKey — exactly once (no 2nd header, no 2nd measurement)", async () => {
    const key = `${RUN}-KEY`;
    ledgerKeys.push(key);
    const id1 = await reserveInspectionId();
    inspectionIds.push(id1);
    const r1 = await persistInspectionAtomic(
      header(id1, { serialNumber: `${RUN}-K1`, idempotencyKey: key }),
      [mrow(id1)],
      {},
    );
    expect(r1).toEqual({ id: id1, duplicate: false });

    // Retry: SAME key, a FRESH reserved id + its own measurement — must write nothing new.
    const id2 = await reserveInspectionId();
    inspectionIds.push(id2);
    const outcome = { duplicate: false };
    const r2 = await persistInspectionAtomic(
      header(id2, { serialNumber: `${RUN}-K2`, idempotencyKey: key }),
      [mrow(id2)],
      { outcome },
    );
    expect(r2).toEqual({ id: id1, duplicate: true });
    expect(outcome.duplicate).toBe(true);
    expect(await countMr(id1)).toBe(1); // NOT 2
    expect(await countInsp(id2)).toBe(0); // header never inserted
    expect(await countMr(id2)).toBe(0);
  });

  it("duplicate natural key (no idempotencyKey) — exactly once", async () => {
    const t = new Date("2026-07-16T03:30:00.000Z");
    const id1 = await reserveInspectionId();
    inspectionIds.push(id1);
    const r1 = await persistInspectionAtomic(
      header(id1, { serialNumber: `${RUN}-NAT`, inspectionTime: t }),
      [mrow(id1)],
      {},
    );
    expect(r1.duplicate).toBe(false);

    const id2 = await reserveInspectionId();
    inspectionIds.push(id2);
    const r2 = await persistInspectionAtomic(
      header(id2, { serialNumber: `${RUN}-NAT`, inspectionTime: t }),
      [mrow(id2)],
      {},
    );
    expect(r2).toEqual({ id: id1, duplicate: true });
    expect(await countInsp(id2)).toBe(0);
    expect(await countMr(id1)).toBe(1);
  });

  it("promoteOverallToNg — overall promoted to NG inside the same tx (original kept)", async () => {
    const id = await reserveInspectionId();
    inspectionIds.push(id);
    await persistInspectionAtomic(
      header(id, { serialNumber: `${RUN}-PROMO` }),
      [mrow(id, ids.point, { result: "NG" })],
      { promoteOverallToNg: true },
    );
    const row = (await sql`SELECT "overallResult" AS o, "originalResult" AS oo FROM product_inspections WHERE id = ${id}`)[0];
    expect(row.o).toBe("NG");
    expect(row.oo).toBe("OK"); // originalResult preserved for audit
  });
});
