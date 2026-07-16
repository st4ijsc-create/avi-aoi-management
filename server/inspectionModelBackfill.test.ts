/**
 * Doc 51 P2 (CASE #6) — inspection `productModelId` NULL-forever recovery.
 * ======================================================================
 * The AVI/AOI machine API accepts an inspection for a product model that does not
 * exist yet: it stores `productModelId = NULL` but keeps the raw `productModel`
 * code string. Before this fix, creating the model later left those inspections
 * NULL forever, so they vanished from every by-model report (all GROUP/JOIN on
 * productModelId). This suite proves the two halves of the fix, against the
 * ISOLATED test DB (vitest.setup.ts rewrites DATABASE_URL to a <db>_test clone):
 *
 *   1. productModelRouter.create (and the exported backfill helper) re-anchor the
 *      orphaned inspections the moment the model exists — end-to-end through the
 *      real tRPC mutation, so the wiring itself is under test.
 *   2. integrityScanService's `fk-soft-orphan` check DETECTS the recoverable
 *      orphans (a real product_models.code match with a NULL productModelId).
 *
 * Mutation-test property: remove the `backfillInspectionsForModel` call from
 * create ⇒ (1) goes red; remove the SOFT_INTEGRITY_CHECKS scan ⇒ (2) goes red
 * (softCount returns NaN → the toBe assertions fail).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import {
  runIntegrityScanNow,
  SOFT_INTEGRITY_CHECKS,
  type IntegrityScanRunResult,
} from "./services/integrityScanService";
import {
  backfillInspectionsForModel,
  productModelRouter,
} from "./routers/productRouters";

const DB_URL = process.env.DATABASE_URL;
const SOFT_KEY = "soft:product_inspections.productModel->product_models.code";
const RUN = `P2C6${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

let sql: ReturnType<typeof postgres>;
const ids = { factory: 0, workshop: 0, line: 0, station: 0, machine: 0 };
const createdInspections: number[] = [];
const createdProducts: number[] = [];

/** Violation count from the soft-orphan check. NaN when the check is gone. */
function softCount(run: IntegrityScanRunResult): number {
  const r = run.softResults.find((s) => s.key === SOFT_KEY);
  return r ? r.violationCount : NaN;
}

async function insertNullInspection(serial: string, productModel: string): Promise<number> {
  const [row] = await sql`
    INSERT INTO product_inspections
      ("machineId","serialNumber","overallResult","originalResult","inspectionTime","productModel")
    VALUES (${ids.machine}, ${serial}, 'NG', 'NG', now(), ${productModel})
    RETURNING id`;
  createdInspections.push(row.id);
  return row.id;
}

async function insertModel(code: string): Promise<number> {
  const [row] = await sql`
    INSERT INTO product_models (code, name) VALUES (${code}, ${"Model " + code}) RETURNING id`;
  createdProducts.push(row.id);
  return row.id;
}

describe.skipIf(!DB_URL)("doc51 P2 CASE#6 — inspection backfill + soft-orphan scan", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    const [f] = await sql`INSERT INTO factories (code, name) VALUES (${"F-" + RUN}, 'CASE6 factory') RETURNING id`;
    ids.factory = f.id;
    const [w] = await sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${ids.factory}, ${"W-" + RUN}, 'CASE6 workshop') RETURNING id`;
    ids.workshop = w.id;
    const [l] = await sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ids.workshop}, ${"L-" + RUN}, 'CASE6 line') RETURNING id`;
    ids.line = l.id;
    const [s] = await sql`INSERT INTO stations ("lineId", code, name) VALUES (${ids.line}, ${"S-" + RUN}, 'CASE6 station') RETURNING id`;
    ids.station = s.id;
    const [m] = await sql`INSERT INTO machines ("stationId", code, name, "machineType") VALUES (${ids.station}, ${"M-" + RUN}, 'CASE6 machine', 'AOI') RETURNING id`;
    ids.machine = m.id;
  }, 120_000);

  afterAll(async () => {
    try {
      if (createdInspections.length) await sql`DELETE FROM product_inspections WHERE id IN ${sql(createdInspections)}`;
      if (createdProducts.length) await sql`DELETE FROM product_models WHERE id IN ${sql(createdProducts)}`;
      if (ids.machine) await sql`DELETE FROM machines WHERE id = ${ids.machine}`;
      if (ids.station) await sql`DELETE FROM stations WHERE id = ${ids.station}`;
      if (ids.line) await sql`DELETE FROM production_lines WHERE id = ${ids.line}`;
      if (ids.workshop) await sql`DELETE FROM workshops WHERE id = ${ids.workshop}`;
      if (ids.factory) await sql`DELETE FROM factories WHERE id = ${ids.factory}`;
    } finally {
      await sql.end();
    }
  }, 120_000);

  it("the soft-orphan check is registered", () => {
    expect(SOFT_INTEGRITY_CHECKS.some((c) => c.key === SOFT_KEY && c.kind === "fk-soft-orphan")).toBe(true);
  });

  it("create re-anchors a pre-existing NULL inspection; scan detects the orphan before backfill", async () => {
    const code = `MODEL_${RUN}`;

    // 1. Inspection arrives BEFORE the model exists → productModelId stays NULL.
    const insp1 = await insertNullInspection(`SN1-${RUN}`, code);
    const [pre] = await sql`SELECT "productModelId" AS pmid FROM product_inspections WHERE id = ${insp1}`;
    expect(pre.pmid).toBeNull();

    // The soft-orphan check ignores it while no model with that code exists.
    const beforeModel = softCount(await runIntegrityScanNow("manual"));
    expect(Number.isNaN(beforeModel)).toBe(false);

    // 2. Create the model THROUGH the real tRPC mutation — proves the create-path
    //    wiring (not just the helper).
    const caller = productModelRouter.createCaller({
      user: { id: 1, role: "admin", twoFactorEnabled: true, name: "CASE6" },
      req: { ip: null, headers: {} },
    } as any);
    const res = await caller.create({ code, name: `Model ${RUN}` });
    createdProducts.push(res.id);

    // 3. WIRING: the create mutation itself backfilled insp1 (NULL → res.id).
    const [post] = await sql`SELECT "productModelId" AS pmid FROM product_inspections WHERE id = ${insp1}`;
    expect(Number(post.pmid)).toBe(res.id);

    // 4. SCAN DETECTION: seed a SECOND still-NULL inspection now that the model
    //    exists, and prove the soft-orphan check counts it (delta = exactly 1),
    //    then that the helper resolves it and the count drops back.
    const base = softCount(await runIntegrityScanNow("manual"));
    const insp2 = await insertNullInspection(`SN2-${RUN}`, code);
    const withOrphan = softCount(await runIntegrityScanNow("manual"));
    expect(withOrphan).toBe(base + 1); // ← RED if the fk-soft-orphan scan is removed

    const fixed = await backfillInspectionsForModel(res.id, code);
    expect(fixed).toBeGreaterThanOrEqual(1);
    const [row2] = await sql`SELECT "productModelId" AS pmid FROM product_inspections WHERE id = ${insp2}`;
    expect(Number(row2.pmid)).toBe(res.id); // ← RED if the backfill UPDATE is broken

    const afterFix = softCount(await runIntegrityScanNow("manual"));
    expect(afterFix).toBe(withOrphan - fixed);
  }, 120_000);

  it("never overwrites an inspection that already has a productModelId", async () => {
    const code = `KEEP_${RUN}`;
    const target = await insertModel(code);
    const other = await insertModel(`OTHER_${RUN}`);
    // Inspection already attributed to `other` but carrying `code` as raw string.
    const [row] = await sql`
      INSERT INTO product_inspections
        ("machineId","serialNumber","overallResult","originalResult","inspectionTime","productModel","productModelId")
      VALUES (${ids.machine}, ${"SN3-" + RUN}, 'OK', 'OK', now(), ${code}, ${other})
      RETURNING id`;
    createdInspections.push(row.id);

    const n = await backfillInspectionsForModel(target, code);
    // The pre-attributed row is NOT touched (WHERE productModelId IS NULL).
    const [after] = await sql`SELECT "productModelId" AS pmid FROM product_inspections WHERE id = ${row.id}`;
    expect(Number(after.pmid)).toBe(other);
    expect(n).toBe(0);
  }, 120_000);

  it("respects the INSPECTION_MODEL_BACKFILL_ENABLED=false kill switch (QĐ#1)", async () => {
    const code = `FLAG_${RUN}`;
    const model = await insertModel(code);
    const insp = await insertNullInspection(`SN4-${RUN}`, code);

    const prev = process.env.INSPECTION_MODEL_BACKFILL_ENABLED;
    process.env.INSPECTION_MODEL_BACKFILL_ENABLED = "false";
    try {
      const n = await backfillInspectionsForModel(model, code);
      expect(n).toBe(0);
    } finally {
      if (prev === undefined) delete process.env.INSPECTION_MODEL_BACKFILL_ENABLED;
      else process.env.INSPECTION_MODEL_BACKFILL_ENABLED = prev;
    }
    const [row] = await sql`SELECT "productModelId" AS pmid FROM product_inspections WHERE id = ${insp}`;
    expect(row.pmid).toBeNull();
  }, 120_000);
});
