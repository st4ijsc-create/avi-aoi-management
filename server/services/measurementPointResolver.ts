/**
 * Shared Measurement-Point Resolver (P0-A data-integrity fix)
 * ===========================================================
 * Single source of truth for turning a measurement-point CODE (as sent by an
 * AOI machine / ZIP package) into a REAL `measurement_point_defs.id`.
 *
 * Background (audit E):
 *   Two ingest paths existed. The HTTP `submitInspection` path resolved the
 *   real `pointDefId`, but the AOI-ZIP `aoiPackageRouter.commit` path inserted
 *   `measurement_results` rows with a HARD-CODED `pointDefId = 0`. Every SPC /
 *   capability / defect-heatmap query GROUPs BY `pointDefId`, so a value of 0
 *   silently dropped AOI-ZIP records out of all analytics.
 *
 * This module guarantees a NON-ZERO, NON-NULL pointDefId for every measurement
 * by RESOLVING an existing definition first and AUTO-PROVISIONING one (under the
 * product model, never under the synthetic id 0) when none exists. Both ingest
 * paths must call `resolveOrCreateMeasurementPointDefId` so the bug cannot recur.
 */
import * as db from "../db";
import {
  resolveMeasurementPointDefinition,
  type PointDefCache,
} from "../routers/_shared";

/** Sentinel product-model code used when an AOI package carries no resolvable model. */
export const UNMAPPED_PRODUCT_MODEL_CODE = "__UNMAPPED__";

export interface MeasurementPointResolverContext {
  /** Resolved product model id (preferred scope for the point def). May be undefined. */
  productModelId?: number;
  /** Machine id the inspection came from (fallback scope + ownership). */
  machineId: number;
  /** Per-call caches to avoid repeated DB lookups within one ingest batch. */
  productCache: PointDefCache;
  machineCache: PointDefCache;
  /** When true, a definition is auto-created if resolution fails (AOI-ZIP path). */
  autoCreate?: boolean;
}

/**
 * Guard against the legacy bug: a resolved id MUST be a positive integer.
 * Throws a clear, actionable error if anything tries to persist 0 / null / NaN.
 */
export function assertValidPointDefId(
  pointDefId: number | null | undefined,
  context: string,
): asserts pointDefId is number {
  if (
    pointDefId === null ||
    pointDefId === undefined ||
    !Number.isInteger(pointDefId) ||
    pointDefId <= 0
  ) {
    throw new Error(
      `[measurementPointResolver] Refusing to persist measurement with invalid ` +
        `pointDefId=${String(pointDefId)} (${context}). A real measurement_point_defs.id ` +
        `is required so SPC/capability/heatmap analytics can group by it. ` +
        `This is the P0-A data-integrity guard (no more pointDefId=0).`,
    );
  }
}

/**
 * Lazily get-or-create the synthetic "UNMAPPED" product model. Used only when an
 * AOI package references no resolvable product model but we still must anchor an
 * auto-created point def to a NON-NULL productModelId.
 */
let unmappedProductModelIdCache: number | undefined;
async function ensureUnmappedProductModelId(): Promise<number> {
  if (unmappedProductModelIdCache) return unmappedProductModelIdCache;
  const existing = await db.getProductModelByCode(UNMAPPED_PRODUCT_MODEL_CODE);
  if (existing) {
    unmappedProductModelIdCache = existing.id;
    return existing.id;
  }
  const id = await db.createProductModel({
    code: UNMAPPED_PRODUCT_MODEL_CODE,
    name: "Unmapped (auto-provisioned) measurement points",
    description:
      "System placeholder. Holds measurement-point definitions auto-created " +
      "during AOI-ZIP ingest when no product model could be resolved. " +
      "Re-map these points to their real product model when possible.",
  });
  unmappedProductModelIdCache = id;
  return id;
}

/**
 * Resolve a measurement-point code to a real definition id.
 *
 * 1. Try the existing resolver (product-scoped, then machine-scoped lookup).
 * 2. If not found and `autoCreate` is set, provision a minimal definition under
 *    the product model (or the synthetic UNMAPPED model) and return its id.
 *
 * The returned id is ALWAYS a positive integer; callers should still pass it
 * through `assertValidPointDefId` at the insert site as a defense-in-depth check.
 */
export async function resolveOrCreateMeasurementPointDefId(
  code: string | undefined,
  ctx: MeasurementPointResolverContext,
): Promise<number> {
  const existing = await resolveMeasurementPointDefinition(
    code,
    ctx.productModelId,
    ctx.machineId,
    ctx.productCache,
    ctx.machineCache,
  );
  if (existing?.id) {
    return existing.id;
  }

  if (!ctx.autoCreate) {
    throw new Error(
      `[measurementPointResolver] Measurement point '${code ?? "(empty)"}' not found ` +
        `(productModelId=${ctx.productModelId ?? "none"}, machineId=${ctx.machineId}) ` +
        `and auto-create is disabled.`,
    );
  }

  const normalizedCode = (code ?? "").trim() || `AUTO_${Date.now()}`;
  const productModelId =
    ctx.productModelId ?? (await ensureUnmappedProductModelId());

  // Double-check under the resolved/synthetic product model before creating, to
  // stay idempotent across retries of the same package commit.
  const preExisting = await db.getMeasurementPointDefByCode(
    productModelId,
    normalizedCode,
  );
  if (preExisting?.id) {
    ctx.productCache.set(normalizedCode, preExisting);
    return preExisting.id;
  }

  const newId = await db.createMeasurementPointDef({
    productModelId,
    machineId: ctx.machineId,
    code: normalizedCode,
    name: normalizedCode,
    description:
      "Auto-provisioned during inspection ingest (no pre-configured definition). " +
      "Review and complete tolerances/coordinates as needed.",
    // measurement_point_defs requires these NOT NULL columns; supply safe defaults.
    measurementType: "VISUAL",
    positionX: 0,
    positionY: 0,
  });

  // Warm the cache so repeated codes in the same batch reuse the new id.
  const created = await db.getMeasurementPointDefById(newId);
  if (created) ctx.productCache.set(normalizedCode, created);

  return newId;
}

// ============================================================================
// Doc 31 Đợt B (MP3) — __UNMAPPED__ visibility metric
// ----------------------------------------------------------------------------
// 68% of measurement points auto-provisioned under __UNMAPPED__ with no way to
// SEE it. `getUnmappedPointRate` exposes the fraction of measurement results
// resolving to __UNMAPPED__ defs (overall + per-machine) so a dashboard can
// surface the problem and drive the bulk-remap tool.
// ============================================================================

/**
 * Read-only lookup of the __UNMAPPED__ product model id. Unlike
 * `ensureUnmappedProductModelId`, this NEVER creates the model — returns
 * undefined when it does not exist yet (so a fresh DB reports a 0% rate).
 */
export async function getUnmappedProductModelId(): Promise<number | undefined> {
  if (unmappedProductModelIdCache) return unmappedProductModelIdCache;
  const existing = await db.getProductModelByCode(UNMAPPED_PRODUCT_MODEL_CODE);
  if (existing) {
    unmappedProductModelIdCache = existing.id;
    return existing.id;
  }
  return undefined;
}

export interface UnmappedRateFilter {
  machineId?: number;
  productModelId?: number;
  fromTs?: Date;
  toTs?: Date;
}

/**
 * Unmatched-rate metric: % of measurement results landing under __UNMAPPED__.
 * Delegates the aggregate SQL to the db layer; resolves the synthetic model id
 * here so the db layer stays free of a resolver import cycle.
 */
export async function getUnmappedPointRate(filter: UnmappedRateFilter = {}) {
  const unmappedModelId = await getUnmappedProductModelId();
  return db.computeUnmappedPointRate({ unmappedModelId, ...filter });
}
