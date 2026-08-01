/**
 * server/db/reportAggregators.ts — Wave R1 report data aggregators (doc 32 §1.4,
 * §2 items 10/12/13, §4 Wave R1).
 * ============================================================================
 * The "missing" report data-layer helpers the audit (doc 32 §1.4) flagged as
 * gaps: defect Pareto by defect CATEGORY/severity/IPC-section, per-PRODUCT
 * yield, per-WEEK yield trend, and the workstation×NG heatmap that
 * reportGenerator's NG-Visual report mocked as empty.
 *
 * Design principles (mirrors server/services/aiInspectionAnalytics.getDefectClassPareto
 * and componentPackageAnalytics.getPackageDefectPareto — same filters, same
 * top-N + OTHERS folding, same honest never-hidden residual bucket):
 *
 *  - Canonical KPI math: FINAL yield = (OK + NTF)/total via utils/kpi.finalYield
 *    (decision #4 — NTF counts as PASS).
 *  - Factory-timezone bucketing: week buckets use factoryDateTruncSql('week', …)
 *    so ISO weeks split at the factory-local week boundary, not UTC.
 *  - Callers resolving date-ONLY UI strings ("YYYY-MM-DD") must first pass them
 *    through utils/kpi.resolveFactoryDateWindow so the window is factory-local;
 *    these functions take resolved Date instants.
 *  - HONESTY CONTRACT: NG rows that carry no defectCatalogId are NEVER hidden or
 *    redistributed — they land in one "UNCLASSIFIED" bucket that competes in the
 *    Pareto ranking like any category. (doc 31 note: historical feed carried no
 *    codes, so real data is ~0% classified today — the UNCLASSIFIED bucket makes
 *    that gap visible instead of faking a distribution.)
 *  - Fail-safe: DB offline → empty result (never throws to the report path).
 *
 * COMPLEMENTS, does not duplicate:
 *  - getDefectClassPareto (aiInspectionAnalytics) groups by individual
 *    defectCatalogId ("which exact defect class").
 *  - getPackageDefectPareto (componentPackageAnalytics) groups by component
 *    PACKAGE ("which part footprint").
 *  - THIS groups by defect_catalog.category / severity / ipcSection ("what KIND
 *    of defect, rolled up") — the dimension a management defect-analysis report
 *    wants.
 */
// T-3 (doc 38 R-2a): these are ALL heavy read-only analytics rollups (defect
// Pareto, per-product / per-week yield, workstation heatmap) — pure SELECT
// aggregations with no writes. They route through getReadDb() so they run on
// the read replica (env DATABASE_READ_URL) when one exists, and honest-degrade
// to the primary pool when it does not. These reports TOLERATE replica lag
// (ms–seconds staleness on a rollup window is acceptable), so this is safe.
import { getReadDb } from "./connection";
import { sql, eq, and, gte, lte, desc, SQL } from "drizzle-orm";
import {
  productInspections,
  measurementResults,
  defectCatalog,
  productModels,
  machines,
  stations,
  productionLines,
  workshops,
  workstations,
  measurementPointDefs,
} from "../../drizzle/schema";
import { finalYield, roundPct, factoryDateTruncSql } from "../utils/kpi";

// ═══════════════════════════════════════════════════════════════════════════
// Shared filter shape + condition builder (mirrors getDefectClassPareto)
// ═══════════════════════════════════════════════════════════════════════════

export interface ReportRollupFilters {
  /** Resolved window start (factory-local via resolveFactoryDateWindow). */
  startDate: Date;
  /** Resolved window end. */
  endDate: Date;
  machineId?: number;
  lineId?: number;
  workshopId?: number;
  factoryId?: number;
  productModelId?: number;
}

/** True when a filter needs the machines→stations→lines→workshops join chain. */
function needsHierarchy(f: ReportRollupFilters): boolean {
  return !!(f.lineId || f.workshopId || f.factoryId);
}

/**
 * Base WHERE conditions over product_inspections. The product filter is honoured
 * by default so any report can scope to a single product model (getYieldByProduct
 * still GROUPs by product, so a product filter just narrows it to one row).
 * `includeProduct=false` is an escape hatch for callers that want the product
 * dimension unconstrained regardless of the passed filter.
 */
function baseConditions(
  f: ReportRollupFilters,
  opts: { includeProduct?: boolean } = {},
): SQL[] {
  const includeProduct = opts.includeProduct ?? true;
  const conditions: SQL[] = [
    gte(productInspections.inspectionTime, f.startDate),
    lte(productInspections.inspectionTime, f.endDate),
  ];
  if (f.machineId) conditions.push(eq(productInspections.machineId, f.machineId));
  if (includeProduct && f.productModelId) {
    conditions.push(eq(productInspections.productModelId, f.productModelId));
  }
  if (f.lineId) conditions.push(eq(stations.lineId, f.lineId));
  if (f.workshopId) conditions.push(eq(productionLines.workshopId, f.workshopId));
  if (f.factoryId) conditions.push(eq(workshops.factoryId, f.factoryId));
  return conditions;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

// ═══════════════════════════════════════════════════════════════════════════
// 1. Defect Pareto by CATEGORY / SEVERITY / IPC-SECTION
// ═══════════════════════════════════════════════════════════════════════════

export type DefectDimension = "category" | "severity" | "ipcSection";

/** One raw grouped row from the DB (or a test fixture). */
export interface DimensionCountRow {
  /** The dimension value (category / severity / ipcSection); NULL when the NG
   * row is unclassified, or classified but the dimension column is null. */
  key: string | null;
  /** measurement_results.defectCatalogId IS NOT NULL. */
  classified: boolean;
  count: number;
}

export interface DimensionParetoItem {
  /** Dimension value | "UNSPECIFIED" | "OTHERS" | "UNCLASSIFIED". */
  key: string;
  count: number;
  /** Of the FULL NG population (classified + unclassified). */
  percentage: number;
  cumulativePercentage: number;
  bucket: "value" | "unspecified" | "others" | "unclassified";
}

export interface DimensionParetoResult {
  dimension: DefectDimension;
  items: DimensionParetoItem[];
  totalDefects: number;
  classifiedDefects: number;
  unclassifiedDefects: number;
  topN: number;
}

type EmittedItem = Omit<DimensionParetoItem, "percentage" | "cumulativePercentage">;

/**
 * Pure Pareto builder (unit-tested): true cumulative % over the FULL NG
 * population, top-N named dimension values + one "OTHERS" tail bucket, plus:
 *  - "UNSPECIFIED": classified rows whose dimension column is null (only
 *    possible for the nullable ipcSection — competes in the ranking).
 *  - "UNCLASSIFIED": rows with no defectCatalogId. NEVER folded into OTHERS —
 *    it stays its own bucket and competes in the ranking (hiding it would fake
 *    the distribution).
 */
export function buildDimensionPareto(
  rows: DimensionCountRow[],
  dimension: DefectDimension,
  topN = 10,
): DimensionParetoResult {
  let unclassified = 0;
  const byValue = new Map<string, number>();
  for (const r of rows) {
    const count = Number(r.count) || 0;
    if (count <= 0) continue;
    if (!r.classified) {
      unclassified += count;
      continue;
    }
    const key = r.key == null || r.key === "" ? "UNSPECIFIED" : String(r.key);
    byValue.set(key, (byValue.get(key) ?? 0) + count);
  }

  const valueItems: EmittedItem[] = [...byValue.entries()]
    .map(([key, count]) => ({
      key,
      count,
      bucket: (key === "UNSPECIFIED" ? "unspecified" : "value") as DimensionParetoItem["bucket"],
    }))
    .sort((a, b) => b.count - a.count);

  const totalDefects = valueItems.reduce((s, r) => s + r.count, 0) + unclassified;

  const head = valueItems.slice(0, Math.max(1, topN));
  const tail = valueItems.slice(Math.max(1, topN));
  const emitted: EmittedItem[] = [...head];
  if (tail.length > 0) {
    emitted.push({ key: "OTHERS", count: tail.reduce((s, r) => s + r.count, 0), bucket: "others" });
  }
  if (unclassified > 0) {
    emitted.push({ key: "UNCLASSIFIED", count: unclassified, bucket: "unclassified" });
  }
  // OTHERS/UNCLASSIFIED compete for rank — sort the emitted set by count.
  emitted.sort((a, b) => b.count - a.count);

  let cumulative = 0;
  const items: DimensionParetoItem[] = emitted.map((r) => {
    const pct = totalDefects > 0 ? (r.count / totalDefects) * 100 : 0;
    cumulative += pct;
    return { ...r, percentage: round2(pct), cumulativePercentage: round2(cumulative) };
  });

  return {
    dimension,
    items,
    totalDefects,
    classifiedDefects: totalDefects - unclassified,
    unclassifiedDefects: unclassified,
    topN,
  };
}

/**
 * Defect Pareto rolled up by a defect_catalog DIMENSION over an inspection
 * window. Filters: machine / line / workshop / factory / product model. NG
 * measurement_results only. See buildDimensionPareto for the honesty contract.
 */
export async function getDefectParetoByCategory(
  params: ReportRollupFilters & { dimension?: DefectDimension; topN?: number },
): Promise<DimensionParetoResult> {
  const dimension = params.dimension ?? "category";
  const topN = params.topN ?? 10;
  const db = await getReadDb();
  if (!db) {
    console.error("[getDefectParetoByCategory] Database connection unavailable (DB_UNAVAILABLE)");
    return { dimension, items: [], totalDefects: 0, classifiedDefects: 0, unclassifiedDefects: 0, topN };
  }

  const dimCol =
    dimension === "category"
      ? defectCatalog.category
      : dimension === "severity"
        ? defectCatalog.severity
        : defectCatalog.ipcSection;

  // Grouped as an int (not a boolean) so the classified flag is driver-agnostic
  // (postgres.js booleans vs 't'/'f' strings). Same expression in SELECT + GROUP BY.
  const classifiedExpr = sql<number>`(CASE WHEN ${measurementResults.defectCatalogId} IS NOT NULL THEN 1 ELSE 0 END)`;

  const conditions = baseConditions(params);
  conditions.push(sql`${measurementResults.result} = 'NG'`);

  let query = db
    .select({
      key: dimCol,
      classified: classifiedExpr.as("classified"),
      count: sql<number>`COUNT(*)`.as("count"),
    })
    .from(measurementResults)
    .innerJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
    .leftJoin(defectCatalog, eq(measurementResults.defectCatalogId, defectCatalog.id))
    .$dynamic();

  if (needsHierarchy(params)) {
    query = query
      .innerJoin(machines, eq(productInspections.machineId, machines.id))
      .innerJoin(stations, eq(machines.stationId, stations.id))
      .innerJoin(productionLines, eq(stations.lineId, productionLines.id))
      .innerJoin(workshops, eq(productionLines.workshopId, workshops.id));
  }

  const rows = await query
    .where(and(...conditions))
    .groupBy(dimCol, classifiedExpr)
    .orderBy(desc(sql`COUNT(*)`));

  const clean: DimensionCountRow[] = (rows as any[]).map((r) => ({
    key: r.key ?? null,
    classified: Number(r.classified) === 1,
    count: Number(r.count) || 0,
  }));
  return buildDimensionPareto(clean, dimension, topN);
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Per-PRODUCT yield rollup
// ═══════════════════════════════════════════════════════════════════════════

export interface ProductYieldRow {
  productModelId: number | null;
  productCode: string | null;
  productName: string | null;
  total: number;
  ok: number;
  ng: number;
  ntf: number;
  /** Canonical FINAL yield % ((OK+NTF)/total), rounded to 2 decimals. */
  yieldRate: number;
}

/**
 * Per-product output + canonical final yield over a window, ordered by output
 * (total inspections) descending. Inspections with a null productModelId are
 * NOT hidden — they roll up into one honest row (productModelId=null) so the
 * output totals stay reconcilable with getDashboardStats.
 */
export async function getYieldByProduct(params: ReportRollupFilters): Promise<ProductYieldRow[]> {
  const db = await getReadDb();
  if (!db) {
    console.error("[getYieldByProduct] Database connection unavailable (DB_UNAVAILABLE)");
    return [];
  }

  const conditions = baseConditions(params);

  let query = db
    .select({
      productModelId: productInspections.productModelId,
      productCode: productModels.code,
      productName: productModels.name,
      total: sql<number>`COUNT(*)`.as("total"),
      ok: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'OK' THEN 1 ELSE 0 END)`.as("ok"),
      ng: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'NG' THEN 1 ELSE 0 END)`.as("ng"),
      ntf: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'NTF' THEN 1 ELSE 0 END)`.as("ntf"),
    })
    .from(productInspections)
    .leftJoin(productModels, eq(productInspections.productModelId, productModels.id))
    .$dynamic();

  if (needsHierarchy(params)) {
    query = query
      .innerJoin(machines, eq(productInspections.machineId, machines.id))
      .innerJoin(stations, eq(machines.stationId, stations.id))
      .innerJoin(productionLines, eq(stations.lineId, productionLines.id))
      .innerJoin(workshops, eq(productionLines.workshopId, workshops.id));
  }

  const rows = await query
    .where(and(...conditions))
    .groupBy(productInspections.productModelId, productModels.code, productModels.name)
    .orderBy(desc(sql`COUNT(*)`));

  return (rows as any[]).map((r) => {
    const total = Number(r.total) || 0;
    const ok = Number(r.ok) || 0;
    const ng = Number(r.ng) || 0;
    const ntf = Number(r.ntf) || 0;
    return {
      productModelId: r.productModelId ?? null,
      productCode: r.productCode ?? null,
      productName: r.productName ?? null,
      total,
      ok,
      ng,
      ntf,
      yieldRate: roundPct(finalYield({ ok, ntf, total }), 2),
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. Per-WEEK yield trend (factory-timezone ISO week buckets)
// ═══════════════════════════════════════════════════════════════════════════

export interface WeeklyYieldRow {
  /** Factory-local week start (Monday) as 'YYYY-MM-DD'. */
  week: string;
  /** ISO week label e.g. '2026-W27'. */
  isoWeek: string;
  total: number;
  ok: number;
  ng: number;
  ntf: number;
  /** Canonical FINAL yield % for the week. */
  yieldRate: number;
}

/**
 * Yield trend bucketed by ISO week in the FACTORY timezone
 * (date_trunc('week', … AT TIME ZONE factory)). Ordered chronologically.
 */
export async function getYieldTrendByWeek(params: ReportRollupFilters): Promise<WeeklyYieldRow[]> {
  const db = await getReadDb();
  if (!db) {
    console.error("[getYieldTrendByWeek] Database connection unavailable (DB_UNAVAILABLE)");
    return [];
  }

  // Factory-local week bucket — same expression object in SELECT / GROUP BY /
  // ORDER BY (tz literals are inlined via sql.raw, so it is repeatable).
  const weekTrunc = factoryDateTruncSql("week", productInspections.inspectionTime);
  const weekText = sql<string>`TO_CHAR(${weekTrunc}, 'YYYY-MM-DD')`;
  const isoWeekText = sql<string>`TO_CHAR(${weekTrunc}, 'IYYY-"W"IW')`;

  const conditions = baseConditions(params);

  let query = db
    .select({
      week: weekText.as("week"),
      isoWeek: isoWeekText.as("isoWeek"),
      total: sql<number>`COUNT(*)`.as("total"),
      ok: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'OK' THEN 1 ELSE 0 END)`.as("ok"),
      ng: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'NG' THEN 1 ELSE 0 END)`.as("ng"),
      ntf: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'NTF' THEN 1 ELSE 0 END)`.as("ntf"),
    })
    .from(productInspections)
    .$dynamic();

  if (needsHierarchy(params)) {
    query = query
      .innerJoin(machines, eq(productInspections.machineId, machines.id))
      .innerJoin(stations, eq(machines.stationId, stations.id))
      .innerJoin(productionLines, eq(stations.lineId, productionLines.id))
      .innerJoin(workshops, eq(productionLines.workshopId, workshops.id));
  }

  const rows = await query
    .where(and(...conditions))
    .groupBy(weekTrunc)
    .orderBy(weekTrunc);

  return (rows as any[]).map((r) => {
    const total = Number(r.total) || 0;
    const ok = Number(r.ok) || 0;
    const ng = Number(r.ng) || 0;
    const ntf = Number(r.ntf) || 0;
    return {
      week: String(r.week),
      isoWeek: String(r.isoWeek),
      total,
      ok,
      ng,
      ntf,
      yieldRate: roundPct(finalYield({ ok, ntf, total }), 2),
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. Workstation × NG heatmap (real query behind reportGenerator's mock)
// ═══════════════════════════════════════════════════════════════════════════

export interface WorkstationHeatmapRow {
  workstationId: number | null;
  workstationName: string;
  /** NG measurement_results at this workstation. */
  ngCount: number;
  /** ALL measurement_results at this workstation (the ngRate denominator). */
  inspectionCount: number;
  ngRate: number;
}

/**
 * Workstation NG heatmap — NG rate per workstation (via
 * measurement_point_defs.workstationId). Shape matches the field set the NG
 * Visual report's HTML/PDF/XLSX consume ({ workstationName, ngCount,
 * inspectionCount, ngRate }). Only workstations that actually have NG appear
 * (HAVING ng>0) — an NG heatmap of zero-NG rows is noise. Point defs with no
 * workstation link roll up into one honest "Chưa gán công trạm" row.
 */
export async function getWorkstationHeatmap(params: ReportRollupFilters): Promise<WorkstationHeatmapRow[]> {
  const db = await getReadDb();
  if (!db) {
    console.error("[getWorkstationHeatmap] Database connection unavailable (DB_UNAVAILABLE)");
    return [];
  }

  const conditions = baseConditions(params);

  let query = db
    .select({
      workstationId: measurementPointDefs.workstationId,
      workstationName: workstations.name,
      total: sql<number>`COUNT(*)`.as("total"),
      ng: sql<number>`SUM(CASE WHEN ${measurementResults.result} = 'NG' THEN 1 ELSE 0 END)`.as("ng"),
    })
    .from(measurementResults)
    .innerJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
    .leftJoin(measurementPointDefs, eq(measurementResults.pointDefId, measurementPointDefs.id))
    .leftJoin(workstations, eq(measurementPointDefs.workstationId, workstations.id))
    .$dynamic();

  if (needsHierarchy(params)) {
    query = query
      .innerJoin(machines, eq(productInspections.machineId, machines.id))
      .innerJoin(stations, eq(machines.stationId, stations.id))
      .innerJoin(productionLines, eq(stations.lineId, productionLines.id))
      .innerJoin(workshops, eq(productionLines.workshopId, workshops.id));
  }

  const rows = await query
    .where(and(...conditions))
    .groupBy(measurementPointDefs.workstationId, workstations.name)
    .having(sql`SUM(CASE WHEN ${measurementResults.result} = 'NG' THEN 1 ELSE 0 END) > 0`)
    .orderBy(desc(sql`SUM(CASE WHEN ${measurementResults.result} = 'NG' THEN 1 ELSE 0 END)`));

  return (rows as any[]).map((r) => {
    const ngCount = Number(r.ng) || 0;
    const inspectionCount = Number(r.total) || 0;
    return {
      workstationId: r.workstationId ?? null,
      workstationName: r.workstationName ?? "Chưa gán công trạm",
      ngCount,
      inspectionCount,
      ngRate: inspectionCount > 0 ? round2((ngCount / inspectionCount) * 100) : 0,
    };
  });
}
