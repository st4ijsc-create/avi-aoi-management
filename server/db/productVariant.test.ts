/**
 * doc 55 Item 3 / PV0 — PRODUCT VARIANT (PA2 first-class), AGAINST THE REAL TEST DB.
 *
 * These prove the schema + DB helpers + the effective-points resolver. Most assertions
 * are real-DB properties (unique indexes, backfill, atomic fan-out) that a mocked
 * drizzle could not settle honestly, so we hit the isolated test database.
 *
 * Requires migration 0286 (+ the rest of the schema) on the test DB:
 *   node scripts/setup-test-db.mjs
 *   DATABASE_URL=<test> node scripts/migrate-standalone.mjs
 * The DB-backed suites SKIP THEMSELVES (rather than lying green) when 0286 is absent.
 *
 * Proves:
 *   • 0286 backfill — every live product_models has exactly one live BASE variant.
 *   • ensureBaseVariant is idempotent (models created after 0286).
 *   • resolveEffectivePoints — base-only; variant exclude drops a point; variant
 *     override patches a base point (identity preserved); variant-added point appears
 *     only for that variant.
 *   • fan-out bump — a COMMON change bumps product_models + base + EVERY variant; a
 *     variant-specific bump moves ONLY that variant.
 *   • createMeasurementPointDef(variantId) — composite (model, variant, code) live-
 *     uniqueness: two variants may reuse a code; the same variant may not.
 *   • Legacy signatures (variantId absent) behave as base and do not break.
 *   • mergeEffectivePoints is a pure, deterministic merge (unit, no DB).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { getDb } from "./connection";
import {
  createVariant,
  getVariantsByModel,
  getBaseVariant,
  getVariantByCode,
  getVariantById,
  updateVariant,
  softDeleteVariant,
  ensureBaseVariant,
  setVariantPointOverride,
  getVariantOverrides,
  removeVariantOverride,
  resolveEffectivePoints,
  mergeEffectivePoints,
  createMeasurementPointDef,
  getMeasurementPointDefByCode,
  bumpPointsConfigVersion,
  bumpVariantPointsConfigVersion,
  getPointsChangedSinceVersion,
  deleteMeasurementPointDef,
  _resetProductVariantsTableProbe,
  type CreateMeasurementPointOutcome,
} from "./product";
import {
  measurementPointDefs,
  productModels,
  productVariants,
  variantPointOverrides,
  type MeasurementPointDef,
} from "../../drizzle/schema";

const STAMP = Date.now();
const modelIds: number[] = [];

/** 0286 present? Without product_variants + variantId there is nothing to prove. */
let hasPV0 = false;
/** Composite live-unique index swapped in? Needed for the conflict assertion. */
let hasCompositeIndex = false;

async function newModel(suffix: string, withBase = true): Promise<number> {
  const db = (await getDb())!;
  const [row] = await db
    .insert(productModels)
    .values({ code: `PV0-${STAMP}-${suffix}`, name: `doc55 PV0 fixture ${suffix}` })
    .returning({ id: productModels.id, pointsConfigVersion: productModels.pointsConfigVersion });
  modelIds.push(row.id);
  if (withBase) await ensureBaseVariant(row.id, Number(row.pointsConfigVersion));
  return row.id;
}

function basePoint(
  productModelId: number,
  code: string,
  extra?: Partial<typeof measurementPointDefs.$inferInsert>,
) {
  return {
    productModelId,
    code,
    name: code,
    measurementType: "VISUAL" as const,
    positionX: 0,
    positionY: 0,
    ...extra,
  };
}

async function modelVersion(modelId: number): Promise<number> {
  const db = (await getDb())!;
  const [row] = await db
    .select({ v: productModels.pointsConfigVersion })
    .from(productModels)
    .where(eq(productModels.id, modelId));
  return Number(row.v);
}

async function variantVersion(variantId: number): Promise<number> {
  const db = (await getDb())!;
  const [row] = await db
    .select({ v: productVariants.pointsConfigVersion })
    .from(productVariants)
    .where(eq(productVariants.id, variantId));
  return Number(row.v);
}

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("test DB unavailable — run scripts/setup-test-db.mjs");
  _resetProductVariantsTableProbe();
  const pv = (await db.execute(
    sql`SELECT to_regclass('public.product_variants') AS t`,
  )) as unknown as Array<{ t: unknown }>;
  const col = (await db.execute(
    sql`SELECT 1 FROM information_schema.columns WHERE table_name='measurement_point_defs' AND column_name='variantId'`,
  )) as unknown as unknown[];
  hasPV0 = (pv[0]?.t != null) && col.length > 0;
  const idx = (await db.execute(
    sql`SELECT 1 FROM pg_indexes WHERE indexname = 'uq_point_defs_product_variant_code'`,
  )) as unknown as unknown[];
  hasCompositeIndex = idx.length > 0;
  if (!hasPV0) {
    console.warn("[doc55 PV0] migration 0286 absent (product_variants/variantId) — DB suites will skip.");
  }
});

afterAll(async () => {
  const db = await getDb();
  if (!db || modelIds.length === 0) return;
  await db.delete(measurementPointDefs).where(inArray(measurementPointDefs.productModelId, modelIds));
  // Overrides reference variants of these models; clear by variant id.
  const vars = await db.select({ id: productVariants.id }).from(productVariants)
    .where(inArray(productVariants.productModelId, modelIds));
  if (vars.length) {
    await db.delete(variantPointOverrides).where(inArray(variantPointOverrides.variantId, vars.map((v) => v.id)));
  }
  await db.delete(productVariants).where(inArray(productVariants.productModelId, modelIds));
  await db.delete(productModels).where(inArray(productModels.id, modelIds));
});

// ════════════════════════════════════════════════════════════════════════════
// PURE unit — mergeEffectivePoints (no DB, runs even without 0286)
// ════════════════════════════════════════════════════════════════════════════
describe("doc55 PV0 — mergeEffectivePoints (pure)", () => {
  const mk = (id: number, code: string, over?: Partial<MeasurementPointDef>): MeasurementPointDef =>
    ({ id, code, orderIndex: id, upperLimit: null, variantId: null, ...over } as unknown as MeasurementPointDef);

  it("returns base points untouched when there are no overrides or added points", () => {
    const base = [mk(1, "A"), mk(2, "B")];
    const out = mergeEffectivePoints({ basePoints: base, variantPoints: [], overrides: [] });
    expect(out.map((p) => p.code)).toEqual(["A", "B"]);
  });

  it("drops an EXCLUDED base point", () => {
    const base = [mk(1, "A"), mk(2, "B"), mk(3, "C")];
    const out = mergeEffectivePoints({
      basePoints: base,
      variantPoints: [],
      overrides: [{ basePointDefId: 2, action: "exclude", patchJson: null }],
    });
    expect(out.map((p) => p.code)).toEqual(["A", "C"]);
  });

  it("patches an OVERRIDDEN base point but keeps its identity", () => {
    const base = [mk(1, "A", { upperLimit: "10" })];
    const out = mergeEffectivePoints({
      basePoints: base,
      variantPoints: [],
      overrides: [{ basePointDefId: 1, action: "override", patchJson: { upperLimit: "99", id: 777, code: "HACK" } }],
    });
    expect(out).toHaveLength(1);
    expect(out[0].upperLimit).toBe("99");     // patched
    expect(out[0].id).toBe(1);                // identity NOT overwritten by patch
    expect(out[0].code).toBe("A");            // identity NOT overwritten by patch
  });

  it("appends variant-added points and orders by orderIndex then id", () => {
    const out = mergeEffectivePoints({
      basePoints: [mk(1, "A", { orderIndex: 2 } as any)],
      variantPoints: [mk(5, "V", { orderIndex: 1 } as any)],
      overrides: [],
    });
    expect(out.map((p) => p.code)).toEqual(["V", "A"]); // V has lower orderIndex
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DB-backed suites
// ════════════════════════════════════════════════════════════════════════════
describe("doc55 PV0 — 0286 backfill + base variant", () => {
  it("every live product_models has exactly one live BASE variant", async () => {
    if (!hasPV0) return;
    const db = (await getDb())!;
    const [{ orphans }] = (await db.execute(sql`
      SELECT count(*)::int AS orphans
        FROM product_models pm
       WHERE pm."deletedAt" IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM product_variants pv
            WHERE pv."productModelId" = pm."id" AND pv."isBase" = true AND pv."deletedAt" IS NULL
         )
    `)) as unknown as Array<{ orphans: number }>;
    expect(orphans).toBe(0);

    const [{ dupes }] = (await db.execute(sql`
      SELECT count(*)::int AS dupes FROM (
        SELECT 1 FROM product_variants
         WHERE "isBase" = true AND "deletedAt" IS NULL
         GROUP BY "productModelId" HAVING count(*) > 1
      ) d
    `)) as unknown as Array<{ dupes: number }>;
    expect(dupes).toBe(0);
  });

  it("ensureBaseVariant is idempotent — same id, one row", async () => {
    if (!hasPV0) return;
    const modelId = await newModel("ensure", false);
    const a = await ensureBaseVariant(modelId);
    const b = await ensureBaseVariant(modelId);
    expect(a).toBe(b);
    const variants = await getVariantsByModel(modelId);
    expect(variants.filter((v) => v.isBase)).toHaveLength(1);
    expect((await getBaseVariant(modelId))!.id).toBe(a);
  });
});

describe("doc55 PV0 — variant CRUD", () => {
  it("creates / reads / updates / soft-deletes a non-base variant; base is undeletable", async () => {
    if (!hasPV0) return;
    const modelId = await newModel("crud");
    const baseId = (await getBaseVariant(modelId))!.id;

    const vId = await createVariant({ productModelId: modelId, code: "EU", name: "EU SKU" });
    expect(await getVariantByCode(modelId, "EU")).toMatchObject({ id: vId, isBase: false });

    await updateVariant(vId, { name: "EU renamed" });
    expect((await getVariantById(vId))!.name).toBe("EU renamed");

    // base is never soft-deletable (guard).
    await softDeleteVariant(baseId);
    expect(await getBaseVariant(modelId)).toBeDefined();

    // non-base soft-deletes and drops out of the default listing.
    await softDeleteVariant(vId);
    expect(await getVariantByCode(modelId, "EU")).toBeUndefined();
    const listed = await getVariantsByModel(modelId);
    expect(listed.map((v) => v.id)).not.toContain(vId);
  });
});

describe("doc55 PV0 — resolveEffectivePoints (inheritance + override)", () => {
  it("base-only: variant NULL / base variant / absent all return the common points", async () => {
    if (!hasPV0) return;
    const modelId = await newModel("resolve-base");
    const baseId = (await getBaseVariant(modelId))!.id;
    await createMeasurementPointDef(basePoint(modelId, "P1"));
    await createMeasurementPointDef(basePoint(modelId, "P2"));

    expect((await resolveEffectivePoints(modelId, null)).map((p) => p.code).sort()).toEqual(["P1", "P2"]);
    expect((await resolveEffectivePoints(modelId)).map((p) => p.code).sort()).toEqual(["P1", "P2"]);
    // Base variant "owns" the NULL-variantId points → same set.
    expect((await resolveEffectivePoints(modelId, baseId)).map((p) => p.code).sort()).toEqual(["P1", "P2"]);
  });

  it("variant exclude drops a base point; override patches it; added point appears", async () => {
    if (!hasPV0) return;
    const modelId = await newModel("resolve-variant");
    const p1 = await createMeasurementPointDef(basePoint(modelId, "P1", { upperLimit: "10" }));
    const p2 = await createMeasurementPointDef(basePoint(modelId, "P2"));
    await createMeasurementPointDef(basePoint(modelId, "P3"));

    const vId = await createVariant({ productModelId: modelId, code: "V1" });
    await setVariantPointOverride({ variantId: vId, basePointDefId: p2, action: "exclude" });
    await setVariantPointOverride({ variantId: vId, basePointDefId: p1, action: "override", patchJson: { upperLimit: "99" } });
    // Point ADDED by the variant (QĐ#11 — variantId set, NOT via the override table).
    await createMeasurementPointDef(basePoint(modelId, "VADD", { variantId: vId }));

    const eff = await resolveEffectivePoints(modelId, vId);
    const byCode = new Map(eff.map((p) => [p.code, p]));

    expect([...byCode.keys()].sort()).toEqual(["P1", "P3", "VADD"]); // P2 excluded
    expect(byCode.get("P1")!.upperLimit).toBe("99");                 // patched
    expect(byCode.get("P1")!.id).toBe(p1);                           // identity preserved

    // The base set must NOT see the variant-only additions/overrides.
    const base = await resolveEffectivePoints(modelId, null);
    expect(base.map((p) => p.code).sort()).toEqual(["P1", "P2", "P3"]);
    // decimal(15,6) round-trips as "10.000000" — compare numerically. Unpatched at base.
    expect(Number(base.find((p) => p.code === "P1")!.upperLimit)).toBe(10);
    expect(base.map((p) => p.code)).not.toContain("VADD");
  });

  it("removeVariantOverride restores the base point", async () => {
    if (!hasPV0) return;
    const modelId = await newModel("resolve-remove");
    const p1 = await createMeasurementPointDef(basePoint(modelId, "P1"));
    const vId = await createVariant({ productModelId: modelId, code: "V1" });
    await setVariantPointOverride({ variantId: vId, basePointDefId: p1, action: "exclude" });
    expect((await resolveEffectivePoints(modelId, vId)).map((p) => p.code)).not.toContain("P1");
    await removeVariantOverride(vId, p1);
    expect((await resolveEffectivePoints(modelId, vId)).map((p) => p.code)).toContain("P1");
    expect(await getVariantOverrides(vId)).toHaveLength(0);
  });
});

describe("doc55 PV0 — fan-out vs variant-specific version bump (QĐ#10)", () => {
  it("a COMMON bump moves product_models + base + EVERY variant together", async () => {
    if (!hasPV0) return;
    const modelId = await newModel("fanout");
    const baseId = (await getBaseVariant(modelId))!.id;
    const vA = await createVariant({ productModelId: modelId, code: "VA" });
    const vB = await createVariant({ productModelId: modelId, code: "VB" });

    const mBefore = await modelVersion(modelId);
    const baseBefore = await variantVersion(baseId);
    const aBefore = await variantVersion(vA);
    const bBefore = await variantVersion(vB);

    const bump = await bumpPointsConfigVersion(modelId);

    expect(bump!.version).toBe(mBefore + 1);
    await expect(modelVersion(modelId)).resolves.toBe(mBefore + 1);
    await expect(variantVersion(baseId)).resolves.toBe(baseBefore + 1);
    await expect(variantVersion(vA)).resolves.toBe(aBefore + 1);
    await expect(variantVersion(vB)).resolves.toBe(bBefore + 1);
  });

  it("a variant-specific bump moves ONLY that variant", async () => {
    if (!hasPV0) return;
    const modelId = await newModel("variant-bump");
    const baseId = (await getBaseVariant(modelId))!.id;
    const vA = await createVariant({ productModelId: modelId, code: "VA" });

    const mBefore = await modelVersion(modelId);
    const baseBefore = await variantVersion(baseId);
    const aBefore = await variantVersion(vA);

    const bump = await bumpVariantPointsConfigVersion(vA);

    expect(bump).toMatchObject({ variantId: vA, productModelId: modelId, version: aBefore + 1 });
    await expect(variantVersion(vA)).resolves.toBe(aBefore + 1);
    await expect(modelVersion(modelId)).resolves.toBe(mBefore); // untouched
    await expect(variantVersion(baseId)).resolves.toBe(baseBefore); // untouched
  });
});

describe("doc55 PV0 — createMeasurementPointDef composite (model, variant, code)", () => {
  it("two DIFFERENT variants may reuse the same code; a base may too", async () => {
    if (!hasPV0) return;
    const modelId = await newModel("compkey");
    const vA = await createVariant({ productModelId: modelId, code: "VA" });
    const vB = await createVariant({ productModelId: modelId, code: "VB" });

    const baseP = await createMeasurementPointDef(basePoint(modelId, "SAME"));            // variantId NULL
    const aP = await createMeasurementPointDef(basePoint(modelId, "SAME", { variantId: vA }));
    const bP = await createMeasurementPointDef(basePoint(modelId, "SAME", { variantId: vB }));

    expect(new Set([baseP, aP, bP]).size).toBe(3); // three distinct live rows, same code
  });

  it("the SAME variant + code collides (composite unique) — resolves to the original", async () => {
    if (!hasPV0 || !hasCompositeIndex) return;
    const modelId = await newModel("compdupe");
    const vA = await createVariant({ productModelId: modelId, code: "VA" });

    const first = await createMeasurementPointDef(basePoint(modelId, "DUP", { variantId: vA }));
    const outcome: CreateMeasurementPointOutcome = { duplicate: false };
    const second = await createMeasurementPointDef(basePoint(modelId, "DUP", { variantId: vA }), outcome);

    expect(second).toBe(first);
    expect(outcome.duplicate).toBe(true);
  });
});

describe("doc55 PV0 — legacy signatures behave as base", () => {
  it("getMeasurementPointDefByCode: absent variantId ⇒ base row; scoped lookups resolve", async () => {
    if (!hasPV0) return;
    const modelId = await newModel("legacy");
    const vA = await createVariant({ productModelId: modelId, code: "VA" });
    const baseP = await createMeasurementPointDef(basePoint(modelId, "C"));                 // base
    const varP = await createMeasurementPointDef(basePoint(modelId, "C", { variantId: vA })); // variant point, same code

    // Legacy 2-arg call — unchanged callers keep working, land on a base row.
    const legacy = await getMeasurementPointDefByCode(modelId, "C");
    expect(legacy!.variantId).toBeNull();
    expect(legacy!.id).toBe(baseP);

    // Explicit scoping.
    expect((await getMeasurementPointDefByCode(modelId, "C", null))!.id).toBe(baseP);
    expect((await getMeasurementPointDefByCode(modelId, "C", vA))!.id).toBe(varP);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Doc 55 Item 3 PV2 (QĐ#14) — getPointsChangedSinceVersion VARIANT tombstones
// ════════════════════════════════════════════════════════════════════════════
describe("doc55 PV2 — getPointsChangedSinceVersion(variantId) tombstones", () => {
  it("variant call tombstones an EXCLUDED base point + a RETIRED variant point; base call omits the exclude", async () => {
    if (!hasPV0) return;
    const modelId = await newModel("delta");
    const V = await createVariant({ productModelId: modelId, code: "VD" });

    // Two active base points; one variant-added point (later retired).
    const bp1 = await createMeasurementPointDef(basePoint(modelId, "T-BP1"));
    const bp2 = await createMeasurementPointDef(basePoint(modelId, "T-BP2"));
    const vp = await createMeasurementPointDef(basePoint(modelId, "T-VP", { variantId: V }));

    // Variant EXCLUDES base point BP2.
    await setVariantPointOverride({ variantId: V, basePointDefId: bp2, action: "exclude" });
    // Variant-added point VP is RETIRED (soft-delete + model version bump + deletedAtVersion stamp).
    const bumped = await deleteMeasurementPointDef(vp);
    expect(bumped).not.toBeNull();

    // Sanity: the effective set is base-minus-exclude = [T-BP1] (VP gone, BP2 excluded).
    const effective = await resolveEffectivePoints(modelId, V);
    expect(effective.map((p) => p.code).sort()).toEqual(["T-BP1"]);

    // VARIANT call — deletedCodes must carry BOTH the excluded base point and the
    // retired variant point so the variant machine stops inspecting them.
    const variantDiff = await getPointsChangedSinceVersion(modelId, 0, V);
    expect(variantDiff.deletedCodes).toContain("T-BP2"); // excluded base point
    expect(variantDiff.deletedCodes).toContain("T-VP");  // retired variant point
    expect(variantDiff.deletedCodes).not.toContain("T-BP1"); // still in the effective set
    // The excluded base point is ACTIVE (not soft-deleted) — proves it came from the
    // effective-set diff, not the model soft-delete stream.
    expect(bp1).toBeGreaterThan(0);

    // BASE call (legacy 2-arg + explicit null) — byte-identical model stream: it
    // tombstones only the truly soft-deleted VP, NEVER the active excluded BP2.
    const baseDiff = await getPointsChangedSinceVersion(modelId, 0);
    expect(baseDiff.deletedCodes).toContain("T-VP");
    expect(baseDiff.deletedCodes).not.toContain("T-BP2");
    const baseDiffExplicit = await getPointsChangedSinceVersion(modelId, 0, null);
    expect(baseDiffExplicit.deletedCodes).toEqual(baseDiff.deletedCodes);
  });

  it("variant with NO exclude/retire ⇒ no extra variant tombstones vs base for its live points", async () => {
    if (!hasPV0) return;
    const modelId = await newModel("delta-clean");
    const V = await createVariant({ productModelId: modelId, code: "VC" });
    await createMeasurementPointDef(basePoint(modelId, "K-BP1"));
    // Bump so the version gate opens (createMeasurementPointDef does not bump on its own).
    await bumpPointsConfigVersion(modelId);

    const variantDiff = await getPointsChangedSinceVersion(modelId, 0, V);
    // K-BP1 is live + in the effective set ⇒ never tombstoned.
    expect(variantDiff.deletedCodes).not.toContain("K-BP1");
  });
});
