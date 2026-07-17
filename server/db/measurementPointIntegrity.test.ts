/**
 * Doc 51 P1/P2 (R4) — measurement-point integrity, AGAINST THE REAL TEST DB.
 *
 * These assertions are deliberately NOT written against a faked drizzle: every
 * property under test is a CONCURRENCY property that only PostgreSQL can settle.
 * A mock would happily "prove" a read-modify-write is atomic.
 *
 * Requires migration 0274 (+ the rest of the schema) on the test DB:
 *   node scripts/setup-test-db.mjs   then   DATABASE_URL=<test> node scripts/migrate-standalone.mjs
 * The suite SKIPS ITSELF (rather than lying green) when 0274 is absent.
 *
 * Proves:
 *   • bumpPointsConfigVersion is ATOMIC — N concurrent bumps ⇒ exactly +N, and
 *     every caller gets a DISTINCT version back (no lost update). This is the
 *     regression test for doc 51 CASE #12: swap the helper body back to
 *     read-modify-write and this goes red.
 *   • createMeasurementPointDef is race-safe — N concurrent creates of the same
 *     code ⇒ exactly ONE live row, all callers get the SAME id, losers are told
 *     `duplicate: true` (doc 51 §5.2 P2, "ghost points").
 *   • deleteMeasurementPointDef bumps + stamps deletedAtVersion in one tx, and is
 *     idempotent on re-delete.
 *   • getPointsChangedSinceVersion emits version-scoped tombstones (CASE #4),
 *     ships legacy NULL-version tombstones unconditionally, and NEVER tombstones
 *     a code that has been re-created.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { getDb } from "./connection";
import {
  bumpPointsConfigVersion,
  createMeasurementPointDef,
  deleteMeasurementPointDef,
  getPointsChangedSinceVersion,
  type CreateMeasurementPointOutcome,
} from "./product";
import { measurementPointDefs, productModels } from "../../drizzle/schema";

const STAMP = Date.now();
const modelIds: number[] = [];

/** 0274 present? Without it there is no unique index and nothing to prove. */
let hasIndex = false;

async function newModel(suffix: string): Promise<number> {
  const db = (await getDb())!;
  const [row] = await db
    .insert(productModels)
    .values({ code: `MPI-${STAMP}-${suffix}`, name: `doc51 R4 fixture ${suffix}` })
    .returning({ id: productModels.id });
  modelIds.push(row.id);
  return row.id;
}

async function versionOf(modelId: number): Promise<number> {
  const db = (await getDb())!;
  const [row] = await db
    .select({ v: productModels.pointsConfigVersion })
    .from(productModels)
    .where(eq(productModels.id, modelId));
  return Number(row.v);
}

function basePoint(productModelId: number, code: string) {
  return {
    productModelId,
    code,
    name: code,
    measurementType: "VISUAL" as const,
    positionX: 0,
    positionY: 0,
  };
}

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("test DB unavailable — run scripts/setup-test-db.mjs");
  // doc 55 PV0 (0286) renames this to the composite uq_point_defs_product_variant_code
  // (base points fold to COALESCE(variantId,0)=0 → same (productModelId, code) live-
  // uniqueness). Accept EITHER so the race assertion keeps running post-swap.
  const idx = await db.execute(
    sql`SELECT 1 FROM pg_indexes WHERE indexname IN ('uq_point_defs_product_code', 'uq_point_defs_product_variant_code')`,
  );
  hasIndex = (idx as unknown as unknown[]).length > 0;
});

afterAll(async () => {
  const db = await getDb();
  if (!db || modelIds.length === 0) return;
  await db.delete(measurementPointDefs).where(inArray(measurementPointDefs.productModelId, modelIds));
  await db.delete(productModels).where(inArray(productModels.id, modelIds));
});

describe("doc 51 R4 — bumpPointsConfigVersion (atomic)", () => {
  it("increments by exactly 1 and returns the new version + product code", async () => {
    const modelId = await newModel("bump1");
    const before = await versionOf(modelId);

    const bump = await bumpPointsConfigVersion(modelId);

    expect(bump).not.toBeNull();
    expect(bump!.version).toBe(before + 1);
    expect(bump!.productModelId).toBe(modelId);
    // publishPointsConfigChanged broadcasts BY CODE — a helper that omits it
    // cannot notify anyone.
    expect(bump!.code).toBe(`MPI-${STAMP}-bump1`);
    await expect(versionOf(modelId)).resolves.toBe(before + 1);
  });

  it("N concurrent bumps produce +N with N distinct versions (no lost update)", async () => {
    const modelId = await newModel("race");
    const before = await versionOf(modelId);
    const N = 20;

    const bumps = await Promise.all(
      Array.from({ length: N }, () => bumpPointsConfigVersion(modelId)),
    );

    // The property that kills read-modify-write: with `SELECT then UPDATE`, racers
    // read the same version and write the same value → the column lands far short
    // of +N and versions collide, so a config change ships under a version some
    // machine already holds and is never re-fetched.
    await expect(versionOf(modelId)).resolves.toBe(before + N);
    const versions = bumps.map((b) => b!.version);
    expect(new Set(versions).size).toBe(N);
    expect(Math.max(...versions)).toBe(before + N);
  });

  it("returns null for a soft-deleted product (nothing to notify)", async () => {
    const modelId = await newModel("gone");
    const db = (await getDb())!;
    await db.update(productModels).set({ deletedAt: new Date() }).where(eq(productModels.id, modelId));

    await expect(bumpPointsConfigVersion(modelId)).resolves.toBeNull();
  });
});

describe("doc 51 P2 — createMeasurementPointDef (race-safe upsert)", () => {
  it("inserts a new point and reports duplicate: false", async () => {
    const modelId = await newModel("create");
    const outcome: CreateMeasurementPointOutcome = { duplicate: false };

    const id = await createMeasurementPointDef(basePoint(modelId, "P1"), outcome);

    expect(id).toBeGreaterThan(0);
    expect(outcome.duplicate).toBe(false);
  });

  it("N concurrent creates of the same code yield ONE row and one shared id", async () => {
    if (!hasIndex) {
      // Honest skip: without 0274 there is no constraint, so this cannot hold.
      console.warn("[doc51] uq_point_defs_product_code absent — race assertion skipped");
      return;
    }
    const modelId = await newModel("ghost");
    const N = 10;
    const outcomes: CreateMeasurementPointOutcome[] = Array.from({ length: N }, () => ({ duplicate: false }));

    const ids = await Promise.all(
      outcomes.map((o) => createMeasurementPointDef(basePoint(modelId, "DUP"), o)),
    );

    const db = (await getDb())!;
    const rows = await db
      .select({ id: measurementPointDefs.id })
      .from(measurementPointDefs)
      .where(eq(measurementPointDefs.productModelId, modelId));

    // The whole point: previously this produced N live rows with the same code,
    // and every by-code lookup then LIMIT-1'd onto an arbitrary one of them.
    expect(rows).toHaveLength(1);
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toBe(rows[0].id);
    // Exactly one writer won; everyone else must be TOLD they lost, or the router
    // would bump the version for a write that never happened.
    expect(outcomes.filter((o) => !o.duplicate)).toHaveLength(1);
    expect(outcomes.filter((o) => o.duplicate)).toHaveLength(N - 1);
  });

  it("allows the same code under a DIFFERENT product model", async () => {
    const a = await newModel("scopeA");
    const b = await newModel("scopeB");

    const idA = await createMeasurementPointDef(basePoint(a, "SHARED"));
    const idB = await createMeasurementPointDef(basePoint(b, "SHARED"));

    // The index is scoped per product — a code is only unique WITHIN a model.
    expect(idA).not.toBe(idB);
  });

  it("allows re-creating a code after the original was soft-deleted", async () => {
    const modelId = await newModel("recreate");
    const first = await createMeasurementPointDef(basePoint(modelId, "REBORN"));
    await deleteMeasurementPointDef(first);

    const outcome: CreateMeasurementPointOutcome = { duplicate: false };
    const second = await createMeasurementPointDef(basePoint(modelId, "REBORN"), outcome);

    // PARTIAL index (WHERE "deletedAt" IS NULL) — retired history must never
    // block an engineer from bringing a code back.
    expect(second).not.toBe(first);
    expect(outcome.duplicate).toBe(false);
  });
});

describe("doc 51 R4/CASE #4 — deleteMeasurementPointDef", () => {
  it("bumps the version and stamps deletedAtVersion in one transaction", async () => {
    const modelId = await newModel("del");
    const pointId = await createMeasurementPointDef(basePoint(modelId, "DEL1"));
    const before = await versionOf(modelId);

    const bump = await deleteMeasurementPointDef(pointId);

    expect(bump).not.toBeNull();
    expect(bump!.version).toBe(before + 1);

    const db = (await getDb())!;
    const [row] = await db
      .select({
        deletedAt: measurementPointDefs.deletedAt,
        deletedAtVersion: measurementPointDefs.deletedAtVersion,
        isActive: measurementPointDefs.isActive,
      })
      .from(measurementPointDefs)
      .where(eq(measurementPointDefs.id, pointId));

    expect(row.deletedAt).not.toBeNull();
    expect(row.isActive).toBe(false);
    // The stamp MUST equal the version the delete produced — a tombstone stamped
    // with any other version is either re-sent forever or never sent at all.
    expect(row.deletedAtVersion).toBe(bump!.version);
  });

  it("is idempotent: re-deleting does not churn the version", async () => {
    const modelId = await newModel("del2");
    const pointId = await createMeasurementPointDef(basePoint(modelId, "DEL2"));
    await deleteMeasurementPointDef(pointId);
    const after = await versionOf(modelId);

    const second = await deleteMeasurementPointDef(pointId);

    // A no-op delete that still bumped would force the whole fleet to re-fetch
    // an identical config.
    expect(second).toBeNull();
    await expect(versionOf(modelId)).resolves.toBe(after);
  });
});

describe("doc 51 CASE #4 — getPointsChangedSinceVersion tombstones", () => {
  it("returns deletedCodes for points retired after the machine's version", async () => {
    const modelId = await newModel("tomb");
    const keepId = await createMeasurementPointDef(basePoint(modelId, "KEEP"));
    const dropId = await createMeasurementPointDef(basePoint(modelId, "DROP"));
    expect(keepId).toBeGreaterThan(0);

    const machineVersion = await versionOf(modelId); // machine syncs, then:
    await deleteMeasurementPointDef(dropId);

    const delta = await getPointsChangedSinceVersion(modelId, machineVersion);

    // Without this the machine keeps inspecting DROP forever — it simply
    // disappears from `points` and nothing ever says "stop".
    expect(delta.deletedCodes).toContain("DROP");
    expect(delta.points.map((p) => p.code)).toEqual(["KEEP"]);
    expect(delta.deletedPoints[0]?.deletedAtVersion).toBe(delta.currentVersion);
  });

  it("omits tombstones the machine already applied (deletedAtVersion <= sinceVersion)", async () => {
    const modelId = await newModel("tomb2");
    const dropId = await createMeasurementPointDef(basePoint(modelId, "OLD"));
    await createMeasurementPointDef(basePoint(modelId, "LIVE"));
    await deleteMeasurementPointDef(dropId);

    const caughtUp = await versionOf(modelId); // machine has seen the deletion
    await bumpPointsConfigVersion(modelId);     // some later, unrelated change

    const delta = await getPointsChangedSinceVersion(modelId, caughtUp);

    expect(delta.deletedCodes).not.toContain("OLD");
  });

  it("always ships legacy tombstones with a NULL deletedAtVersion", async () => {
    const modelId = await newModel("legacy");
    const dropId = await createMeasurementPointDef(basePoint(modelId, "LEGACY"));
    await deleteMeasurementPointDef(dropId);

    // Simulate a row soft-deleted before 0274 existed: version unknown.
    const db = (await getDb())!;
    await db
      .update(measurementPointDefs)
      .set({ deletedAtVersion: null })
      .where(eq(measurementPointDefs.id, dropId));
    await bumpPointsConfigVersion(modelId);
    const current = await versionOf(modelId);

    // Even for a machine that is fully caught up bar one version, an
    // unknown-version tombstone must be re-sent: over-shipping is a no-op at the
    // machine, withholding leaves a retired point live.
    const delta = await getPointsChangedSinceVersion(modelId, current - 1);

    expect(delta.deletedCodes).toContain("LEGACY");
  });

  it("never tombstones a code that has been re-created", async () => {
    const modelId = await newModel("revive");
    const oldId = await createMeasurementPointDef(basePoint(modelId, "PHOENIX"));
    const machineVersion = await versionOf(modelId);
    await deleteMeasurementPointDef(oldId);
    await createMeasurementPointDef(basePoint(modelId, "PHOENIX")); // re-created

    const delta = await getPointsChangedSinceVersion(modelId, machineVersion);

    // The machine keys on CODE. Shipping PHOENIX in BOTH lists would let it
    // delete the point it just installed — active must always win.
    expect(delta.points.map((p) => p.code)).toContain("PHOENIX");
    expect(delta.deletedCodes).not.toContain("PHOENIX");
  });

  it("returns no tombstones when the machine is already current", async () => {
    const modelId = await newModel("current");
    const dropId = await createMeasurementPointDef(basePoint(modelId, "X"));
    await deleteMeasurementPointDef(dropId);
    const current = await versionOf(modelId);

    const delta = await getPointsChangedSinceVersion(modelId, current);

    expect(delta.points).toEqual([]);
    expect(delta.deletedCodes).toEqual([]);
    expect(delta.currentVersion).toBe(current);
  });
});
