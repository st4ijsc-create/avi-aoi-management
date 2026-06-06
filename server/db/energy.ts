/**
 * Sprint G2.6a — DB access for advanced energy analytics
 * (per-recipe energy, peak demand, power factor, EnPI snapshots).
 *
 * SAFETY: pure data access + energy TELEMETRY insert. NO machine-write path
 * (no commandDispatcher / driver.writeTags). recordEnergyReading writes a DATA
 * row to energy_readings — it is NOT a control command.
 *
 * Mirrors the getDb()-guarded style of bom.ts: read helpers degrade to []/null
 * when the DB is not connected; writers throw "Database not available".
 *
 * CROSS-DB: business joins (recipe deployments, process results) live in the
 * main PG. Time-series rollups may also be served from TimescaleDB via the
 * timescale.ts helpers (queryEnergyBuckets / isTsdbEnabled) — the service layer
 * picks the path; this module only owns the main-PG SQL.
 */
import { getDb } from "./connection";
import { eq, sql } from "drizzle-orm";
import { energyReadings, enpiMetrics, type InsertEnergyReading } from "../../drizzle/schema/g3";

export interface EnergyRange {
  from: Date;
  to: Date;
  machineId?: number;
}

// ============================================================
// Raw energy readings (main PG)
// ============================================================
export interface EnergyReadingRow {
  id: number;
  machineId: number | null;
  source: string;
  value: number | null;
  powerKw: number | null;
  reactivePowerKvar: number | null;
  apparentPowerKva: number | null;
  powerFactor: number | null;
  recipeRef: string | null;
  timestamp: Date;
}

/** All readings in [from,to) (optionally one machine), oldest first. */
export async function getEnergyReadings(range: EnergyRange): Promise<EnergyReadingRow[]> {
  const db = await getDb();
  if (!db) return [];
  const machineFilter = range.machineId != null ? sql`AND "machineId" = ${range.machineId}` : sql``;
  const rows = await db.execute(sql`
    SELECT id, "machineId", source,
           value::float8           AS value,
           "powerKw"::float8       AS "powerKw",
           "reactivePowerKvar"::float8 AS "reactivePowerKvar",
           "apparentPowerKva"::float8  AS "apparentPowerKva",
           "powerFactor"::float8   AS "powerFactor",
           "recipeRef",
           "timestamp"
    FROM energy_readings
    WHERE "timestamp" >= ${range.from} AND "timestamp" < ${range.to} ${machineFilter}
    ORDER BY "timestamp" ASC
  `);
  return asRows<EnergyReadingRow>(rows);
}

// ============================================================
// Recipe deployment windows — LEAD() to derive [deployedAt, nextAt)
// ============================================================
export interface RecipeWindowRow {
  recipeId: number;
  machineId: number;
  recipeCode: string | null;
  startAt: Date;
  endAt: Date | null; // null = still active (open-ended)
}

/**
 * Active-recipe windows per machine over [from,to): for each recipe_deployments
 * row we compute nextAt = LEAD(deployedAt) OVER (PARTITION BY machineId ORDER BY
 * deployedAt). recipeCode is joined from machine_recipes. Includes the
 * deployment immediately preceding `from` so the window covering `from` is kept.
 */
export async function getRecipeDeploymentWindows(machineId: number | undefined, range: EnergyRange): Promise<RecipeWindowRow[]> {
  const db = await getDb();
  if (!db) return [];
  const machineFilter = machineId != null ? sql`WHERE rd."machineId" = ${machineId}` : sql``;
  const rows = await db.execute(sql`
    WITH windows AS (
      SELECT rd."recipeId",
             rd."machineId",
             mr.code AS "recipeCode",
             rd."deployedAt" AS "startAt",
             LEAD(rd."deployedAt") OVER (
               PARTITION BY rd."machineId" ORDER BY rd."deployedAt" ASC
             ) AS "endAt"
      FROM recipe_deployments rd
      LEFT JOIN machine_recipes mr ON mr.id = rd."recipeId"
      ${machineFilter}
    )
    SELECT "recipeId", "machineId", "recipeCode", "startAt", "endAt"
    FROM windows
    WHERE "startAt" < ${range.to}
      AND ("endAt" IS NULL OR "endAt" > ${range.from})
    ORDER BY "machineId" ASC, "startAt" ASC
  `);
  return asRows<RecipeWindowRow>(rows);
}

// ============================================================
// Good units produced per recipe (process_results, result='pass')
// ============================================================
export interface GoodUnitsRow {
  recipeRef: string;
  machineId: number;
  goodUnits: number;
}

/** Count of passing process_results grouped by recipeRef + machineId in [from,to). */
export async function getGoodUnitsByRecipe(range: EnergyRange): Promise<GoodUnitsRow[]> {
  const db = await getDb();
  if (!db) return [];
  const machineFilter = range.machineId != null ? sql`AND "machineId" = ${range.machineId}` : sql``;
  const rows = await db.execute(sql`
    SELECT "recipeRef",
           "machineId",
           COUNT(*)::int AS "goodUnits"
    FROM process_results
    WHERE result = 'pass'
      AND "recipeRef" IS NOT NULL
      AND "measuredAt" >= ${range.from} AND "measuredAt" < ${range.to} ${machineFilter}
    GROUP BY "recipeRef", "machineId"
  `);
  return asRows<GoodUnitsRow>(rows);
}

// ============================================================
// Peak demand rows (main PG fallback when TSDB disabled)
// ============================================================
export interface PeakRow {
  instantaneousPeakKw: number | null;
  peakAt: Date | null;
}

/** MAX(powerKw) + the timestamp at which it occurred, over [from,to). */
export async function getPeakDemandRows(range: EnergyRange): Promise<PeakRow> {
  const db = await getDb();
  if (!db) return { instantaneousPeakKw: null, peakAt: null };
  const machineFilter = range.machineId != null ? sql`AND "machineId" = ${range.machineId}` : sql``;
  const rows = await db.execute(sql`
    SELECT "powerKw"::float8 AS "instantaneousPeakKw", "timestamp" AS "peakAt"
    FROM energy_readings
    WHERE "powerKw" IS NOT NULL
      AND "timestamp" >= ${range.from} AND "timestamp" < ${range.to} ${machineFilter}
    ORDER BY "powerKw" DESC, "timestamp" ASC
    LIMIT 1
  `);
  const r = asRows<PeakRow>(rows)[0];
  return r ?? { instantaneousPeakKw: null, peakAt: null };
}

/**
 * Rolling-window AVG(powerKw) over fixed buckets of `windowMin` minutes
 * (main-PG path; the TSDB path uses time_bucket via timescale.ts). Returns one
 * row per bucket containing the average power within it.
 */
export async function getRollingDemandBuckets(range: EnergyRange, windowMin: number): Promise<Array<{ bucket: Date; avgPowerKw: number | null }>> {
  const db = await getDb();
  if (!db) return [];
  const machineFilter = range.machineId != null ? sql`AND "machineId" = ${range.machineId}` : sql``;
  const seconds = Math.max(1, Math.floor(windowMin * 60));
  const rows = await db.execute(sql`
    SELECT to_timestamp(floor(extract(epoch FROM "timestamp") / ${seconds}) * ${seconds}) AS bucket,
           AVG("powerKw")::float8 AS "avgPowerKw"
    FROM energy_readings
    WHERE "powerKw" IS NOT NULL
      AND "timestamp" >= ${range.from} AND "timestamp" < ${range.to} ${machineFilter}
    GROUP BY bucket
    ORDER BY bucket ASC
  `);
  return asRows<{ bucket: Date; avgPowerKw: number | null }>(rows);
}

// ============================================================
// Power-factor aggregate (main PG)
// ============================================================
export interface PowerFactorRow {
  samples: number;
  pfSamples: number;
  avgPf: number | null;
  minPf: number | null;
  belowThreshold: number;
}

/** Aggregate power-factor stats over [from,to); NULL powerFactor rows are skipped. */
export async function getPowerFactorStats(range: EnergyRange, threshold: number): Promise<PowerFactorRow> {
  const db = await getDb();
  if (!db) return { samples: 0, pfSamples: 0, avgPf: null, minPf: null, belowThreshold: 0 };
  const machineFilter = range.machineId != null ? sql`AND "machineId" = ${range.machineId}` : sql``;
  const rows = await db.execute(sql`
    SELECT COUNT(*)::int AS samples,
           COUNT("powerFactor")::int AS "pfSamples",
           AVG("powerFactor")::float8 AS "avgPf",
           MIN("powerFactor")::float8 AS "minPf",
           COUNT(*) FILTER (WHERE "powerFactor" IS NOT NULL AND "powerFactor" < ${threshold})::int AS "belowThreshold"
    FROM energy_readings
    WHERE "timestamp" >= ${range.from} AND "timestamp" < ${range.to} ${machineFilter}
  `);
  const r = asRows<PowerFactorRow>(rows)[0];
  return r ?? { samples: 0, pfSamples: 0, avgPf: null, minPf: null, belowThreshold: 0 };
}

// ============================================================
// Energy reading insert (TELEMETRY — not a machine command)
// ============================================================
export async function recordEnergyReading(data: InsertEnergyReading): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.insert(energyReadings).values(data).returning({ id: energyReadings.id });
  return row.id;
}

/** List EnPI snapshots with optional machine/recipe/period filters, newest first. */
export async function listEnpiMetrics(params: {
  machineId?: number;
  recipeId?: number;
  from?: Date;
  to?: Date;
}): Promise<Array<Record<string, unknown>>> {
  const db = await getDb();
  if (!db) return [];
  const conds = [sql`1=1`];
  if (params.machineId != null) conds.push(sql`"machineId" = ${params.machineId}`);
  if (params.recipeId != null) conds.push(sql`"recipeId" = ${params.recipeId}`);
  if (params.from != null) conds.push(sql`"periodStart" >= ${params.from}`);
  if (params.to != null) conds.push(sql`"periodEnd" <= ${params.to}`);
  const where = conds.reduce((acc, c, i) => (i === 0 ? c : sql`${acc} AND ${c}`));
  const rows = await db.execute(sql`
    SELECT * FROM enpi_metrics WHERE ${where} ORDER BY "periodStart" DESC LIMIT 500
  `);
  return asRows<Record<string, unknown>>(rows);
}

// ============================================================
// EnPI snapshot upsert (idempotent on period + recipe + machine)
// ============================================================
export interface EnpiSnapshotInput {
  machineId: number | null;
  layoutId?: number | null;
  periodStart: Date;
  periodEnd: Date;
  totalKwh: number;
  goodUnits: number;
  energyPerUnit?: number | null;
  peakDemandKw?: number | null;
  avgPowerFactor?: number | null;
  recipeId?: number | null;
  recipeCode?: string | null;
  carbonKg?: number | null;
}

/**
 * Idempotent EnPI snapshot: if a row already exists for the same
 * (machineId, recipeId, periodStart, periodEnd) it is UPDATEd in place;
 * otherwise INSERTed. Keyed manually (no DB unique constraint added) so the
 * migration stays purely additive.
 */
export async function upsertEnpiSnapshot(input: EnpiSnapshotInput): Promise<{ id: number; updated: boolean }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await db.execute(sql`
    SELECT id FROM enpi_metrics
    WHERE "periodStart" = ${input.periodStart}
      AND "periodEnd" = ${input.periodEnd}
      AND "machineId" IS NOT DISTINCT FROM ${input.machineId ?? null}
      AND "recipeId" IS NOT DISTINCT FROM ${input.recipeId ?? null}
    LIMIT 1
  `);
  const found = asRows<{ id: number }>(existing)[0];

  const values = {
    machineId: input.machineId ?? null,
    layoutId: input.layoutId ?? null,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    totalKwh: String(input.totalKwh),
    goodUnits: input.goodUnits,
    energyPerUnit: input.energyPerUnit != null ? String(input.energyPerUnit) : null,
    peakDemandKw: input.peakDemandKw != null ? String(input.peakDemandKw) : null,
    avgPowerFactor: input.avgPowerFactor != null ? String(input.avgPowerFactor) : null,
    recipeId: input.recipeId ?? null,
    recipeCode: input.recipeCode ?? null,
    carbonKg: input.carbonKg != null ? String(input.carbonKg) : null,
  };

  if (found) {
    await db.update(enpiMetrics).set(values).where(eq(enpiMetrics.id, found.id));
    return { id: found.id, updated: true };
  }
  const [row] = await db.insert(enpiMetrics).values(values).returning({ id: enpiMetrics.id });
  return { id: row.id, updated: false };
}

// ── helper: normalize postgres-js execute() result to a row array ──
function asRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}
