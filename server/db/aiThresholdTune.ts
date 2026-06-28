/**
 * Scope enumeration for the threshold auto-tune scheduler.
 *
 * Mirrors enumerateOkScopes (server/db/aiAnomaly.ts): a grouped query that lists
 * candidate tuning scopes together with their RECENT sample counts, so the
 * scheduler only considers scopes that have accumulated enough new data.
 *
 * Two scope kinds:
 *   • "ng"    → one per enabled mqtt_ng_rate_thresholds row, with the count of
 *               measurement_results in its (machine ± point) scope over `days`.
 *   • "point" → one per measurement_point_defs row that has BOTH limits set,
 *               with the count of measurement_results for that point over `days`.
 *
 * All functions getDb()-null-guard → return [] (read path, fail-safe, never throw).
 */
import { getDb } from "./connection";
import { sql, type SQL } from "drizzle-orm";

export type TuneScopeKind = "ng" | "point";

export interface NgTuneScope {
  kind: "ng";
  /** mqtt_ng_rate_thresholds.id — what the advisor + adjust_ng_threshold tool key on. */
  ngThresholdId: number;
  machineId: number | null;
  measurementPointId: number | null;
  /** Recent measurement_results count in scope (the "enough new data" signal). */
  sampleCount: number;
}

export interface PointTuneScope {
  kind: "point";
  /** measurement_point_defs.id. */
  pointDefId: number;
  productModelId: number | null;
  machineId: number | null;
  /** Recent measurement_samples count for this point (the "enough new data" signal). */
  sampleCount: number;
}

function sinceClause(days: number): SQL {
  const d = Math.max(1, Math.floor(days));
  return sql`pi."inspectionTime" >= NOW() - (${d} || ' days')::interval`;
}

/** Window clause for measurement_samples (the source suggestThresholds/advisor reads). */
function sinceClauseSamples(days: number): SQL {
  const d = Math.max(1, Math.floor(days));
  return sql`s."sampledAt" >= NOW() - (${d} || ' days')::interval`;
}

/**
 * Enumerate enabled NG-rate thresholds whose scope has ≥ minSamples recent
 * measurement results. Scope = machineId (when set) ± measurementPointId (when set).
 * NULL machine/point widen the match (all rows in scope). getDb null → [].
 */
export async function enumerateNgTuneScopes(params: {
  minSamples: number;
  days: number;
}): Promise<NgTuneScope[]> {
  const db = await getDb();
  if (!db) return [];
  const minN = Math.max(1, Math.floor(params.minSamples));

  // Correlated count per threshold: filter measurement_results by the threshold's
  // (machineId, measurementPointId) scope, NULLs acting as wildcards.
  const result = await db.execute(sql`
    SELECT t."id" AS ng_id,
           t."machineId" AS machine_id,
           t."measurementPointId" AS point_id,
           (
             SELECT count(*)
             FROM measurement_results mr
             JOIN product_inspections pi ON pi."id" = mr."inspectionId"
             WHERE ${sinceClause(params.days)}
               AND (t."machineId" IS NULL OR pi."machineId" = t."machineId")
               AND (t."measurementPointId" IS NULL OR mr."pointDefId" = t."measurementPointId")
           ) AS sample_count
    FROM mqtt_ng_rate_thresholds t
    WHERE t."isEnabled" = true
  `);

  const rows = ((result as { rows?: unknown[] }).rows ?? (result as unknown[])) as Array<{
    ng_id: number | string;
    machine_id: number | string | null;
    point_id: number | string | null;
    sample_count: number | string;
  }>;

  const out: NgTuneScope[] = [];
  for (const r of rows) {
    const sampleCount = Number(r.sample_count ?? 0);
    if (sampleCount < minN) continue;
    out.push({
      kind: "ng",
      ngThresholdId: Number(r.ng_id),
      machineId: r.machine_id == null ? null : Number(r.machine_id),
      measurementPointId: r.point_id == null ? null : Number(r.point_id),
      sampleCount,
    });
  }
  return out;
}

/**
 * Enumerate measurement points (with BOTH limits set) that have ≥ minSamples
 * recent measurement results. getDb null → [].
 */
export async function enumeratePointTuneScopes(params: {
  minSamples: number;
  days: number;
}): Promise<PointTuneScope[]> {
  const db = await getDb();
  if (!db) return [];
  const minN = Math.max(1, Math.floor(params.minSamples));

  // Count measurement_samples (the SAME source the advisor / suggestThresholds reads),
  // so the cron's "enough new data" signal is consistent with the recommendation it will compute.
  const result = await db.execute(sql`
    SELECT d."id" AS point_id,
           d."productModelId" AS product_id,
           d."machineId" AS machine_id,
           count(*) AS sample_count
    FROM measurement_point_defs d
    JOIN measurement_samples s ON s."pointDefId" = d."id"
    WHERE ${sinceClauseSamples(params.days)}
      AND d."lowerLimit" IS NOT NULL
      AND d."upperLimit" IS NOT NULL
    GROUP BY d."id", d."productModelId", d."machineId"
    HAVING count(*) >= ${minN}
    ORDER BY count(*) DESC
  `);

  const rows = ((result as { rows?: unknown[] }).rows ?? (result as unknown[])) as Array<{
    point_id: number | string;
    product_id: number | string | null;
    machine_id: number | string | null;
    sample_count: number | string;
  }>;

  const out: PointTuneScope[] = [];
  for (const r of rows) {
    out.push({
      kind: "point",
      pointDefId: Number(r.point_id),
      productModelId: r.product_id == null ? null : Number(r.product_id),
      machineId: r.machine_id == null ? null : Number(r.machine_id),
      sampleCount: Number(r.sample_count ?? 0),
    });
  }
  return out;
}

/**
 * Resolve factory.code for a machine (for responsible-user targeting). Mirrors the
 * hierarchy join used by aiAutoProposer.resolveMachineContext. getDb null / no row → null.
 */
export async function factoryCodeForMachine(machineId: number | null): Promise<string | null> {
  if (machineId == null) return null;
  const db = await getDb();
  if (!db) return null;
  try {
    const { eq } = await import("drizzle-orm");
    const { machines, stations, productionLines, workshops, factories } = await import("../../drizzle/schema");
    const [m] = await db
      .select({ factoryCode: factories.code })
      .from(machines)
      .innerJoin(stations, eq(machines.stationId, stations.id))
      .innerJoin(productionLines, eq(stations.lineId, productionLines.id))
      .innerJoin(workshops, eq(productionLines.workshopId, workshops.id))
      .innerJoin(factories, eq(workshops.factoryId, factories.id))
      .where(eq(machines.id, machineId))
      .limit(1);
    return m?.factoryCode ?? null;
  } catch (err) {
    console.warn("[aiThresholdTune] factoryCodeForMachine failed:", (err as Error)?.message ?? err);
    return null;
  }
}
