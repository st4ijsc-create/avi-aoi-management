/**
 * Component-package defect Pareto (doc 27 §2 M12a → doc 29 §1.3 read path,
 * implemented Đợt 8 / W8-A).
 * ============================================================================
 * Groups NG measurement results by COMPONENT PACKAGE via the doc-29 linkage
 * chain (no new tables — pure read path over the 0191 columns):
 *
 *   measurement_results (result='NG')
 *     ⋈ measurement_point_defs.componentCode   (which component the point measures)
 *     ⋈ materials.code = componentCode          (business key of the component)
 *     ⋈ component_packages ON materials.packageId
 *
 * HONESTY CONTRACT (doc 29 §1.3): results whose chain does not resolve to a
 * package are NEVER hidden or redistributed — they land in ONE "UNLINKED"
 * bucket that competes in the ranking like any package, with a breakdown of
 * WHY they are unlinked (no componentCode on the point / componentCode has no
 * material / material has no packageId) so the gap is actionable.
 *
 * Mirrors getDefectClassPareto (aiInspectionAnalytics.ts): same filters
 * (machine/line/workshop/factory/product), same top-N + OTHERS folding, same
 * wire-adjacent result shape. Date-only strings must be resolved by callers
 * via utils/kpi.resolveFactoryDateWindow (factory-local days).
 */
import { getDb } from "../db/connection";
import { sql, eq, and, gte, lte, desc, SQL } from "drizzle-orm";
import {
  productInspections,
  measurementResults,
  measurementPointDefs,
  materials,
  componentPackages,
  machines,
  stations,
  productionLines,
  workshops,
} from "../../drizzle/schema";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PackageParetoParams {
  startDate: Date;
  endDate: Date;
  machineId?: number;
  lineId?: number;
  workshopId?: number;
  factoryId?: number;
  productModelId?: number;
  /** Named packages kept before folding the tail into "OTHERS" (default 10). */
  topN?: number;
}

/** One raw grouped row from the DB (or a test fixture). */
export interface PackageCountRow {
  packageId: number | null;
  code: string | null;
  family: string | null;
  /** Why the row is unlinked (NULL for linked rows). */
  unlinkedReason: "no_component_code" | "no_material" | "no_package" | null;
  count: number;
}

export interface PackageParetoItem {
  packageId: number | null;
  code: string;               // package code | "UNLINKED" | "OTHERS"
  family: string | null;
  count: number;
  percentage: number;         // of the FULL defect population
  cumulativePercentage: number;
  bucket: "package" | "unlinked" | "others";
}

export interface PackageParetoResult {
  items: PackageParetoItem[];
  totalDefects: number;
  linkedDefects: number;
  unlinkedDefects: number;
  /** Honest breakdown of WHY defects could not be attributed to a package. */
  unlinkedBreakdown: {
    noComponentCode: number;  // point def has no componentCode
    noMaterial: number;       // componentCode does not match any materials.code
    noPackage: number;        // material exists but has no packageId link
  };
  topN: number;
}

// ─── Pure Pareto builder (unit-tested) ────────────────────────────────────────

/**
 * Fold raw grouped rows into the Pareto: true cumulative % over the FULL
 * population, top-N named packages + one "OTHERS" tail bucket, and the single
 * honest "UNLINKED" bucket (which ranks like any package — hiding it would
 * fake the distribution).
 */
export function buildPackagePareto(rows: PackageCountRow[], topN = 10): PackageParetoResult {
  const breakdown = { noComponentCode: 0, noMaterial: 0, noPackage: 0 };
  let unlinkedCount = 0;

  const linked: Array<Omit<PackageParetoItem, "percentage" | "cumulativePercentage">> = [];
  for (const r of rows) {
    const count = Number(r.count) || 0;
    if (count <= 0) continue;
    if (r.packageId == null) {
      unlinkedCount += count;
      if (r.unlinkedReason === "no_material") breakdown.noMaterial += count;
      else if (r.unlinkedReason === "no_package") breakdown.noPackage += count;
      else breakdown.noComponentCode += count;
    } else {
      linked.push({
        packageId: r.packageId,
        code: r.code ?? `#${r.packageId}`,
        family: r.family,
        count,
        bucket: "package",
      });
    }
  }
  linked.sort((a, b) => b.count - a.count);

  const totalDefects = linked.reduce((s, r) => s + r.count, 0) + unlinkedCount;

  const head = linked.slice(0, Math.max(1, topN));
  const tail = linked.slice(Math.max(1, topN));
  const emitted: Array<Omit<PackageParetoItem, "percentage" | "cumulativePercentage">> = [...head];
  if (tail.length > 0) {
    emitted.push({
      packageId: null,
      code: "OTHERS",
      family: null,
      count: tail.reduce((s, r) => s + r.count, 0),
      bucket: "others",
    });
  }
  if (unlinkedCount > 0) {
    emitted.push({ packageId: null, code: "UNLINKED", family: null, count: unlinkedCount, bucket: "unlinked" });
  }
  // The UNLINKED/OTHERS buckets compete in the ranking — sort the emitted set.
  emitted.sort((a, b) => b.count - a.count);

  let cumulative = 0;
  const items: PackageParetoItem[] = emitted.map((r) => {
    const pct = totalDefects > 0 ? (r.count / totalDefects) * 100 : 0;
    cumulative += pct;
    return {
      ...r,
      percentage: Math.round(pct * 100) / 100,
      cumulativePercentage: Math.round(cumulative * 100) / 100,
    };
  });

  return {
    items,
    totalDefects,
    linkedDefects: totalDefects - unlinkedCount,
    unlinkedDefects: unlinkedCount,
    unlinkedBreakdown: breakdown,
    topN,
  };
}

// ─── DB read path ─────────────────────────────────────────────────────────────

/**
 * Package-level defect Pareto over a window. Fail-safe: DB offline → empty
 * result (mirrors getDefectClassPareto).
 */
export async function getPackageDefectPareto(params: PackageParetoParams): Promise<PackageParetoResult> {
  const db = await getDb();
  if (!db) {
    console.error("[getPackageDefectPareto] Database connection unavailable (DB_UNAVAILABLE)");
    return {
      items: [], totalDefects: 0, linkedDefects: 0, unlinkedDefects: 0,
      unlinkedBreakdown: { noComponentCode: 0, noMaterial: 0, noPackage: 0 },
      topN: params.topN ?? 10,
    };
  }

  const conditions: SQL[] = [
    gte(productInspections.inspectionTime, params.startDate),
    lte(productInspections.inspectionTime, params.endDate),
    sql`${measurementResults.result} = 'NG'`,
  ];
  if (params.machineId) conditions.push(eq(productInspections.machineId, params.machineId));
  if (params.productModelId) conditions.push(eq(productInspections.productModelId, params.productModelId));

  const needsHierarchy = !!(params.lineId || params.workshopId || params.factoryId);
  if (params.lineId) conditions.push(eq(stations.lineId, params.lineId));
  if (params.workshopId) conditions.push(eq(productionLines.workshopId, params.workshopId));
  if (params.factoryId) conditions.push(eq(workshops.factoryId, params.factoryId));

  // Why a result is unlinked, resolved IN the group-by so one query answers
  // both the package ranking and the honest breakdown.
  const unlinkedReasonExpr = sql<string | null>`
    CASE
      WHEN ${measurementPointDefs.componentCode} IS NULL THEN 'no_component_code'
      WHEN ${materials.id} IS NULL THEN 'no_material'
      WHEN ${componentPackages.id} IS NULL THEN 'no_package'
      ELSE NULL
    END`;

  let query = db
    .select({
      packageId: componentPackages.id,
      code: componentPackages.code,
      family: componentPackages.family,
      unlinkedReason: unlinkedReasonExpr.as("unlinkedReason"),
      count: sql<number>`COUNT(*)`.as("count"),
    })
    .from(measurementResults)
    .innerJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
    .innerJoin(measurementPointDefs, eq(measurementResults.pointDefId, measurementPointDefs.id))
    .leftJoin(materials, eq(measurementPointDefs.componentCode, materials.code))
    .leftJoin(componentPackages, eq(materials.packageId, componentPackages.id))
    .$dynamic();

  if (needsHierarchy) {
    query = query
      .innerJoin(machines, eq(productInspections.machineId, machines.id))
      .innerJoin(stations, eq(machines.stationId, stations.id))
      .innerJoin(productionLines, eq(stations.lineId, productionLines.id))
      .innerJoin(workshops, eq(productionLines.workshopId, workshops.id));
  }

  const rows = await query
    .where(and(...conditions))
    .groupBy(
      componentPackages.id,
      componentPackages.code,
      componentPackages.family,
      unlinkedReasonExpr,
    )
    .orderBy(desc(sql`COUNT(*)`));

  return buildPackagePareto(rows as unknown as PackageCountRow[], params.topN ?? 10);
}
