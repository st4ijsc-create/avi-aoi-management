// Doc 31 Đợt D (UX2 / PM9) — Product config-completeness ("readiness") score.
//
// A product model is only useful to AOI/AVI once it is actually CONFIGURED:
// reference image + dims, measurement points, spec limits on the dimensional
// points, component linkage (Pareto), fiducials (alignment), a known-good golden
// (diff), a released program (provenance) and at least one machine mapping.
//
// This service turns that scatter into ONE weighted 0..100 score + a per-item
// checklist ({item,status,detail}) so the product list can show a badge
// ("62% • 40 points no limits") and the detail view a readiness panel. WD-1's
// onboarding wizard reuses computeProductReadiness() directly.
//
// COST: computeProductReadinessBatch(ids) issues a CONSTANT number of aggregate
// queries (7) regardless of how many products are requested — NO N+1. The single-
// product helper just calls the batch with [id].
import { getDb } from "../db/connection";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
  productModels,
  measurementPointDefs,
  fiducialMarks,
  inspectionProgramReleases,
  productMachineMappings,
} from "../../drizzle/schema/product";
import { productPanelDefs } from "../../drizzle/schema/productPanel";
import { goldenSampleReferences } from "../../drizzle/schema/goldenSample";

export type ReadinessItemStatus = "ok" | "partial" | "missing" | "na";

export interface ReadinessChecklistItem {
  /** Stable key — the client maps it to an i18n label. */
  key:
    | "image"
    | "points"
    | "limits"
    | "componentCode"
    | "fiducials"
    | "golden"
    | "release"
    | "mapping"
    | "panel";
  status: ReadinessItemStatus;
  /** Contribution weight toward the 0..100 score (0 = informational only). */
  weight: number;
  /** 0..1 completion for this item. */
  fraction: number;
  /** Concise English fallback detail (client localizes from key + counts). */
  detail: string;
  counts?: Record<string, number>;
}

export interface ProductReadiness {
  productModelId: number;
  productCode: string;
  productName: string;
  /** Weighted 0..100. */
  score: number;
  /** Banding for badge colour. */
  band: "ready" | "in_progress" | "blocked";
  items: ReadinessChecklistItem[];
  summary: {
    hasImage: boolean;
    hasDims: boolean;
    pointCount: number;
    numericPoints: number;
    numericWithLimits: number;
    withComponent: number;
    fiducials: number;
    goldens: number;
    releases: number;
    mappings: number;
    panels: number;
  };
}

/** Raw aggregate counts for ONE product, fed to the pure scorer. */
export interface ReadinessAggregate {
  productModelId: number;
  productCode: string;
  productName: string;
  hasImage: boolean;
  hasDims: boolean;
  pointCount: number;
  /** Points whose type requires a numeric spec limit (i.e. NOT pure VISUAL). */
  numericPoints: number;
  numericWithLimits: number;
  withComponent: number;
  fiducials: number;
  goldens: number;
  releases: number;
  mappings: number;
  panels: number;
}

// Weights sum to 100 across the COUNTED items (panel is informational, weight 0).
const WEIGHTS = {
  image: 15,
  points: 15,
  limits: 25,
  componentCode: 10,
  fiducials: 10,
  golden: 10,
  release: 5,
  mapping: 10,
} as const;

function statusFor(fraction: number): ReadinessItemStatus {
  if (fraction >= 1) return "ok";
  if (fraction <= 0) return "missing";
  return "partial";
}

/**
 * PURE scorer — deterministic, no DB. Exported for unit tests and for callers
 * that already hold the aggregate counts.
 */
export function scoreReadiness(agg: ReadinessAggregate): ProductReadiness {
  const items: ReadinessChecklistItem[] = [];

  // 1) Reference image + dimensions.
  const imageFraction = !agg.hasImage ? 0 : agg.hasDims ? 1 : 0.5;
  items.push({
    key: "image",
    weight: WEIGHTS.image,
    fraction: imageFraction,
    status: statusFor(imageFraction),
    detail: !agg.hasImage
      ? "No reference image"
      : agg.hasDims
        ? "Reference image + dimensions set"
        : "Image present but dimensions unknown (coords not portable)",
  });

  // 2) At least one measurement point.
  const pointsFraction = agg.pointCount > 0 ? 1 : 0;
  items.push({
    key: "points",
    weight: WEIGHTS.points,
    fraction: pointsFraction,
    status: statusFor(pointsFraction),
    detail: agg.pointCount > 0 ? `${agg.pointCount} measurement points` : "No measurement points defined",
    counts: { pointCount: agg.pointCount },
  });

  // 3) Spec limits on the DIMENSIONAL points (VISUAL points are judged by golden-
  //    diff / criteria, not LSL/USL — excluding them keeps the score honest).
  const numeric = agg.numericPoints;
  const withLimits = agg.numericWithLimits;
  const limitsFraction = numeric > 0 ? withLimits / numeric : agg.pointCount > 0 ? 1 : 0;
  const limitsMissing = Math.max(0, numeric - withLimits);
  items.push({
    key: "limits",
    weight: WEIGHTS.limits,
    fraction: limitsFraction,
    status: numeric === 0 && agg.pointCount > 0 ? "na" : statusFor(limitsFraction),
    detail:
      numeric === 0
        ? "No dimensional points require limits"
        : limitsMissing === 0
          ? `All ${numeric} dimensional points have limits`
          : `${limitsMissing}/${numeric} points missing limits`,
    counts: { numericPoints: numeric, withLimits, missing: limitsMissing },
  });

  // 4) Component linkage (Pareto-by-package). Over ALL points.
  const compFraction = agg.pointCount > 0 ? agg.withComponent / agg.pointCount : 0;
  const compMissing = Math.max(0, agg.pointCount - agg.withComponent);
  items.push({
    key: "componentCode",
    weight: WEIGHTS.componentCode,
    fraction: compFraction,
    status: agg.pointCount === 0 ? "missing" : statusFor(compFraction),
    detail:
      agg.pointCount === 0
        ? "No points to link"
        : compMissing === 0
          ? "All points linked to a component"
          : `${compMissing}/${agg.pointCount} points missing componentCode`,
    counts: { withComponent: agg.withComponent, missing: compMissing },
  });

  // 5) Fiducials (alignment) — 2+ is healthy, 1 partial, 0 missing.
  const fidFraction = agg.fiducials >= 2 ? 1 : agg.fiducials === 1 ? 0.5 : 0;
  items.push({
    key: "fiducials",
    weight: WEIGHTS.fiducials,
    fraction: fidFraction,
    status: statusFor(fidFraction),
    detail: agg.fiducials > 0 ? `${agg.fiducials} fiducial(s)` : "No fiducials",
    counts: { fiducials: agg.fiducials },
  });

  // 6) Approved + active golden reference.
  const goldenFraction = agg.goldens > 0 ? 1 : 0;
  items.push({
    key: "golden",
    weight: WEIGHTS.golden,
    fraction: goldenFraction,
    status: statusFor(goldenFraction),
    detail: agg.goldens > 0 ? `${agg.goldens} approved golden(s)` : "No approved golden sample",
    counts: { goldens: agg.goldens },
  });

  // 7) Released program (provenance / audit-only per decision #1).
  const releaseFraction = agg.releases > 0 ? 1 : 0;
  items.push({
    key: "release",
    weight: WEIGHTS.release,
    fraction: releaseFraction,
    status: statusFor(releaseFraction),
    detail: agg.releases > 0 ? "Released program present" : "No released program",
    counts: { releases: agg.releases },
  });

  // 8) At least one active machine mapping (so a machine actually runs it).
  const mappingFraction = agg.mappings > 0 ? 1 : 0;
  items.push({
    key: "mapping",
    weight: WEIGHTS.mapping,
    fraction: mappingFraction,
    status: statusFor(mappingFraction),
    detail: agg.mappings > 0 ? `${agg.mappings} machine mapping(s)` : "Not mapped to any machine",
    counts: { mappings: agg.mappings },
  });

  // 9) Panel definition — INFORMATIONAL (weight 0). Not every board is panelized,
  //    so its absence must never lower the score.
  items.push({
    key: "panel",
    weight: 0,
    fraction: agg.panels > 0 ? 1 : 0,
    status: agg.panels > 0 ? "ok" : "na",
    detail: agg.panels > 0 ? `${agg.panels} panel definition(s)` : "No panel definition (single-board)",
    counts: { panels: agg.panels },
  });

  const totalWeight = items.reduce((s, it) => s + it.weight, 0);
  const earned = items.reduce((s, it) => s + it.weight * it.fraction, 0);
  const score = totalWeight > 0 ? Math.round((earned / totalWeight) * 100) : 0;

  const band: ProductReadiness["band"] = score >= 85 ? "ready" : score >= 50 ? "in_progress" : "blocked";

  return {
    productModelId: agg.productModelId,
    productCode: agg.productCode,
    productName: agg.productName,
    score,
    band,
    items,
    summary: {
      hasImage: agg.hasImage,
      hasDims: agg.hasDims,
      pointCount: agg.pointCount,
      numericPoints: agg.numericPoints,
      numericWithLimits: agg.numericWithLimits,
      withComponent: agg.withComponent,
      fiducials: agg.fiducials,
      goldens: agg.goldens,
      releases: agg.releases,
      mappings: agg.mappings,
      panels: agg.panels,
    },
  };
}

/**
 * Fetch the aggregate counts for a SET of product ids in a fixed number of
 * grouped queries (no N+1). Returns one aggregate per existing (non-deleted)
 * product; unknown/deleted ids are simply absent.
 */
export async function aggregateReadinessData(ids: number[]): Promise<ReadinessAggregate[]> {
  const db = await getDb();
  if (!db || ids.length === 0) return [];

  // (1) Products.
  const products = await db
    .select({
      id: productModels.id,
      code: productModels.code,
      name: productModels.name,
      referenceImageUrl: productModels.referenceImageUrl,
      imageWidth: productModels.imageWidth,
      imageHeight: productModels.imageHeight,
    })
    .from(productModels)
    .where(and(inArray(productModels.id, ids), isNull(productModels.deletedAt)));

  if (products.length === 0) return [];
  const productIds = products.map((p) => p.id);
  const codes = products.map((p) => p.code);
  const idSet = new Set(productIds);

  // (2) Point aggregates (count / numeric / numeric-with-limits / with-component).
  const pointAgg = await db
    .select({
      productModelId: measurementPointDefs.productModelId,
      pointCount: sql<number>`COUNT(*)::int`,
      numericPoints: sql<number>`SUM(CASE WHEN ${measurementPointDefs.measurementType} <> 'VISUAL' THEN 1 ELSE 0 END)::int`,
      numericWithLimits: sql<number>`SUM(CASE WHEN ${measurementPointDefs.measurementType} <> 'VISUAL' AND (${measurementPointDefs.lowerLimit} IS NOT NULL OR ${measurementPointDefs.upperLimit} IS NOT NULL) THEN 1 ELSE 0 END)::int`,
      withComponent: sql<number>`SUM(CASE WHEN ${measurementPointDefs.componentCode} IS NOT NULL AND ${measurementPointDefs.componentCode} <> '' THEN 1 ELSE 0 END)::int`,
    })
    .from(measurementPointDefs)
    .where(and(
      inArray(measurementPointDefs.productModelId, productIds),
      eq(measurementPointDefs.isActive, true),
      isNull(measurementPointDefs.deletedAt),
    ))
    .groupBy(measurementPointDefs.productModelId);

  // (3) Fiducial counts.
  const fidAgg = await db
    .select({
      productModelId: fiducialMarks.productModelId,
      n: sql<number>`COUNT(*)::int`,
    })
    .from(fiducialMarks)
    .where(and(
      inArray(fiducialMarks.productModelId, productIds),
      eq(fiducialMarks.isActive, true),
      isNull(fiducialMarks.deletedAt),
    ))
    .groupBy(fiducialMarks.productModelId);

  // (4) Approved+active goldens (match by productModelId OR productCode — rename-safe).
  const goldenRows = await db
    .select({
      productModelId: goldenSampleReferences.productModelId,
      productCode: goldenSampleReferences.productCode,
    })
    .from(goldenSampleReferences)
    .where(and(
      eq(goldenSampleReferences.active, true),
      eq(goldenSampleReferences.status, "approved"),
      or(
        inArray(goldenSampleReferences.productModelId, productIds),
        inArray(goldenSampleReferences.productCode, codes),
      ),
    ));

  // (5) Released programs.
  const releaseAgg = await db
    .select({
      productModelId: inspectionProgramReleases.productModelId,
      n: sql<number>`COUNT(*)::int`,
    })
    .from(inspectionProgramReleases)
    .where(and(
      inArray(inspectionProgramReleases.productModelId, productIds),
      eq(inspectionProgramReleases.status, "released"),
    ))
    .groupBy(inspectionProgramReleases.productModelId);

  // (6) Active machine mappings.
  const mappingAgg = await db
    .select({
      productModelId: productMachineMappings.productModelId,
      n: sql<number>`COUNT(*)::int`,
    })
    .from(productMachineMappings)
    .where(and(
      inArray(productMachineMappings.productModelId, productIds),
      eq(productMachineMappings.isActive, true),
    ))
    .groupBy(productMachineMappings.productModelId);

  // (7) Panel definitions.
  const panelAgg = await db
    .select({
      productModelId: productPanelDefs.productModelId,
      n: sql<number>`COUNT(*)::int`,
    })
    .from(productPanelDefs)
    .where(and(
      inArray(productPanelDefs.productModelId, productIds),
      eq(productPanelDefs.isActive, true),
      isNull(productPanelDefs.deletedAt),
    ))
    .groupBy(productPanelDefs.productModelId);

  // ---- Fold into per-product maps ----
  const pointMap = new Map<number, { pointCount: number; numericPoints: number; numericWithLimits: number; withComponent: number }>();
  for (const r of pointAgg) {
    pointMap.set(Number(r.productModelId), {
      pointCount: Number(r.pointCount ?? 0),
      numericPoints: Number(r.numericPoints ?? 0),
      numericWithLimits: Number(r.numericWithLimits ?? 0),
      withComponent: Number(r.withComponent ?? 0),
    });
  }
  const numMap = (rows: Array<{ productModelId: number | null; n: number }>) => {
    const m = new Map<number, number>();
    for (const r of rows) m.set(Number(r.productModelId), Number(r.n ?? 0));
    return m;
  };
  const fidMap = numMap(fidAgg as any);
  const releaseMap = numMap(releaseAgg as any);
  const mappingMap = numMap(mappingAgg as any);
  const panelMap = numMap(panelAgg as any);

  // Golden: bucket each approved golden to a product (by id, else by code).
  const codeToId = new Map<string, number>();
  for (const p of products) codeToId.set(p.code, p.id);
  const goldenMap = new Map<number, number>();
  for (const g of goldenRows) {
    let pid: number | undefined;
    if (g.productModelId != null && idSet.has(Number(g.productModelId))) {
      pid = Number(g.productModelId);
    } else if (g.productCode != null && codeToId.has(g.productCode)) {
      pid = codeToId.get(g.productCode);
    }
    if (pid != null) goldenMap.set(pid, (goldenMap.get(pid) ?? 0) + 1);
  }

  return products.map((p) => {
    const pts = pointMap.get(p.id) ?? { pointCount: 0, numericPoints: 0, numericWithLimits: 0, withComponent: 0 };
    return {
      productModelId: p.id,
      productCode: p.code,
      productName: p.name,
      hasImage: !!p.referenceImageUrl,
      hasDims: !!(p.imageWidth && p.imageHeight),
      pointCount: pts.pointCount,
      numericPoints: pts.numericPoints,
      numericWithLimits: pts.numericWithLimits,
      withComponent: pts.withComponent,
      fiducials: fidMap.get(p.id) ?? 0,
      goldens: goldenMap.get(p.id) ?? 0,
      releases: releaseMap.get(p.id) ?? 0,
      mappings: mappingMap.get(p.id) ?? 0,
      panels: panelMap.get(p.id) ?? 0,
    };
  });
}

/**
 * Readiness for a SET of products (badges on the list). Fixed query cost.
 */
export async function computeProductReadinessBatch(ids: number[]): Promise<ProductReadiness[]> {
  const uniq = Array.from(new Set(ids.filter((n) => Number.isFinite(n) && n > 0)));
  const aggregates = await aggregateReadinessData(uniq);
  return aggregates.map(scoreReadiness);
}

/**
 * Readiness for ONE product. Returns null when the product does not exist.
 * WD-1's onboarding wizard calls this directly.
 */
export async function computeProductReadiness(productModelId: number): Promise<ProductReadiness | null> {
  const [one] = await computeProductReadinessBatch([productModelId]);
  return one ?? null;
}
