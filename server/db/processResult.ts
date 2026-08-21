// Sprint F2 — DB access for generic process results (parallel to inspection).
import { getDb } from "./connection";
import { DbUnavailableError } from "../_core/dbErrors";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { processResults, processStepTypes, processResultDaily, InsertProcessResult } from "../../drizzle/schema";

/** Insert one process-result row; returns the new id. */
export async function insertProcessResult(row: InsertProcessResult): Promise<number> {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  const [inserted] = await db
    .insert(processResults)
    .values(row)
    .returning({ id: processResults.id });
  return inserted.id;
}

/** List all process-result rows for a serial, oldest first. */
export async function listProcessResultsBySerial(serialNumber: string, limit = 1000) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(processResults)
    .where(eq(processResults.serialNumber, serialNumber))
    .orderBy(asc(processResults.id))
    .limit(limit);
}

// ─── Sprint F6 — read-only helpers for the AI line-monitoring tools ──────────
// Additive: do NOT modify the helpers above. All return Number()-normalized
// rows and never mutate. Used by handlersF6 / insightHandlersF6 (read tools).

export type ProcessResultRow = typeof processResults.$inferSelect;

/**
 * List recent process results for a machine (optionally a step type), newest
 * first. `since` is a hard lower bound on measuredAt.
 */
export async function listProcessResultsByMachine(opts: {
  machineId: number;
  stepType?: string;
  since: Date;
  limit?: number;
}): Promise<ProcessResultRow[]> {
  const db = await getDb();
  if (!db) return [];
  const conds = [
    eq(processResults.machineId, opts.machineId),
    gte(processResults.measuredAt, opts.since),
  ];
  if (opts.stepType) conds.push(eq(processResults.stepType, opts.stepType));
  return db
    .select()
    .from(processResults)
    .where(and(...conds))
    .orderBy(desc(processResults.measuredAt))
    .limit(Math.min(Math.max(opts.limit ?? 20, 1), 200));
}

export interface ProcessResultStats {
  pass: number;
  fail: number;
  warn: number;
  skip: number;
}

/**
 * Aggregate pass/fail/warn/skip counts for process results matching a filter.
 * `serialNumber`/`machineId`/`stepType` are all optional (AND-combined).
 */
export async function aggregateProcessResultStats(filter: {
  machineId?: number;
  serialNumber?: string;
  stepType?: string;
  since: Date;
}): Promise<ProcessResultStats> {
  const db = await getDb();
  if (!db) return { pass: 0, fail: 0, warn: 0, skip: 0 };
  const conds = [gte(processResults.measuredAt, filter.since)];
  if (filter.machineId != null) conds.push(eq(processResults.machineId, filter.machineId));
  if (filter.serialNumber) conds.push(eq(processResults.serialNumber, filter.serialNumber));
  if (filter.stepType) conds.push(eq(processResults.stepType, filter.stepType));
  const rows = await db
    .select({
      pass: sql<number>`count(*) filter (where ${processResults.result} = 'pass')::int`,
      fail: sql<number>`count(*) filter (where ${processResults.result} = 'fail')::int`,
      warn: sql<number>`count(*) filter (where ${processResults.result} = 'warn')::int`,
      skip: sql<number>`count(*) filter (where ${processResults.result} = 'skip')::int`,
    })
    .from(processResults)
    .where(and(...conds));
  const r = rows[0] ?? { pass: 0, fail: 0, warn: 0, skip: 0 };
  return {
    pass: Number(r.pass ?? 0),
    fail: Number(r.fail ?? 0),
    warn: Number(r.warn ?? 0),
    skip: Number(r.skip ?? 0),
  };
}

export interface MetricSeriesPoint {
  bucket: string; // ISO-ish bucket label (hour or day)
  ts: number; // epoch ms of bucket start
  value: number; // avg of the numeric metric in the bucket
  samples: number;
}

/**
 * Build a time-bucketed average series for a numeric key inside the
 * `processResults.metrics` jsonb. SAFE numeric cast: only rows where the key
 * exists AND its text value matches a numeric regex are included
 * (`metrics ? key AND metrics->>key ~ '^-?[0-9.]+$'`).
 */
export async function getProcessMetricSeries(opts: {
  machineId?: number;
  stepType?: string;
  metricKey: string;
  since: Date;
  bucket?: "hour" | "day";
}): Promise<MetricSeriesPoint[]> {
  const db = await getDb();
  if (!db) return [];
  const bucket = opts.bucket ?? "hour";
  const key = opts.metricKey;
  const conds = [
    gte(processResults.measuredAt, opts.since),
    sql`${processResults.metrics} ? ${key}`,
    sql`${processResults.metrics}->>${key} ~ '^-?[0-9.]+$'`,
  ];
  if (opts.machineId != null) conds.push(eq(processResults.machineId, opts.machineId));
  if (opts.stepType) conds.push(eq(processResults.stepType, opts.stepType));
  const truncUnit = bucket === "day" ? sql`'day'` : sql`'hour'`;
  const rows = await db
    .select({
      bucketTs: sql<string>`date_trunc(${truncUnit}, ${processResults.measuredAt})`,
      value: sql<number>`avg((${processResults.metrics}->>${key})::numeric)`,
      samples: sql<number>`count(*)::int`,
    })
    .from(processResults)
    .where(and(...conds))
    .groupBy(sql`date_trunc(${truncUnit}, ${processResults.measuredAt})`)
    .orderBy(asc(sql`date_trunc(${truncUnit}, ${processResults.measuredAt})`));
  return rows.map((r) => {
    const d = new Date(r.bucketTs);
    return {
      bucket: r.bucketTs ? new Date(r.bucketTs).toISOString() : "",
      ts: d.getTime(),
      value: Number(r.value ?? 0),
      samples: Number(r.samples ?? 0),
    };
  });
}

// ─── doc 56 Đ3 — ProcessAnalytics: active step-type vocabulary for UI dropdowns ─
export interface ProcessStepTypeRow {
  code: string;
  nameVi: string | null;
  machineType: string | null;
}

/** List active process step types (seed 0289), optionally scoped to a machineType. */
export async function listActiveStepTypes(machineType?: string): Promise<ProcessStepTypeRow[]> {
  const db = await getDb();
  if (!db) return [];
  const conds = [eq(processStepTypes.active, true)];
  if (machineType) conds.push(eq(processStepTypes.machineType, machineType));
  const rows = await db
    .select({
      code: processStepTypes.code,
      nameVi: processStepTypes.nameVi,
      machineType: processStepTypes.machineType,
    })
    .from(processStepTypes)
    .where(and(...conds))
    .orderBy(asc(processStepTypes.code));
  return rows;
}

// ═══════════════════════════════════════════════════════════════════════════════
// doc 56 Đ5 — ProcessAnalytics: SPC individuals, fleet rollup, daily mart.
// All additive + read-mostly; used only when PROCESS_ANALYTICS_ENABLED is on.
// ═══════════════════════════════════════════════════════════════════════════════

export interface MetricPoint {
  value: number;
  measuredAt: Date;
}

/**
 * RAW individual measurements for a numeric metric key (NOT bucket-averaged) —
 * feeds an I-MR control chart. Oldest first, hard-capped. Same safe numeric-cast
 * guard as getProcessMetricSeries (key present AND text value matches a number).
 */
export async function getProcessMetricPoints(opts: {
  machineId?: number;
  stepType?: string;
  metricKey: string;
  since: Date;
  limit?: number;
}): Promise<MetricPoint[]> {
  const db = await getDb();
  if (!db) return [];
  const key = opts.metricKey;
  const conds = [
    gte(processResults.measuredAt, opts.since),
    sql`${processResults.metrics} ? ${key}`,
    sql`${processResults.metrics}->>${key} ~ '^-?[0-9.]+$'`,
  ];
  if (opts.machineId != null) conds.push(eq(processResults.machineId, opts.machineId));
  if (opts.stepType) conds.push(eq(processResults.stepType, opts.stepType));
  const rows = await db
    .select({
      value: sql<number>`(${processResults.metrics}->>${key})::numeric`,
      measuredAt: processResults.measuredAt,
    })
    .from(processResults)
    .where(and(...conds))
    .orderBy(asc(processResults.measuredAt))
    .limit(Math.min(Math.max(opts.limit ?? 500, 2), 5000));
  return rows.map((r) => ({ value: Number(r.value), measuredAt: new Date(r.measuredAt as unknown as string) }));
}

export interface TypeRollupRow {
  machineType: string | null;
  pass: number;
  fail: number;
  warn: number;
  skip: number;
  total: number;
}

/**
 * Fleet rollup — pass/fail/warn/skip grouped by machineType (deviceClass is derived
 * from machineType in code). Live aggregate over the raw rows since `since`.
 */
export async function aggregateProcessResultStatsByType(filter: {
  since: Date;
  machineType?: string;
}): Promise<TypeRollupRow[]> {
  const db = await getDb();
  if (!db) return [];
  const conds = [gte(processResults.measuredAt, filter.since)];
  if (filter.machineType) conds.push(eq(processResults.machineType, filter.machineType as TypeRollupRow["machineType"] as never));
  const rows = await db
    .select({
      machineType: processResults.machineType,
      pass: sql<number>`count(*) filter (where ${processResults.result} = 'pass')::int`,
      fail: sql<number>`count(*) filter (where ${processResults.result} = 'fail')::int`,
      warn: sql<number>`count(*) filter (where ${processResults.result} = 'warn')::int`,
      skip: sql<number>`count(*) filter (where ${processResults.result} = 'skip')::int`,
      total: sql<number>`count(*)::int`,
    })
    .from(processResults)
    .where(and(...conds))
    .groupBy(processResults.machineType)
    .orderBy(desc(sql`count(*)`));
  return rows.map((r) => ({
    machineType: r.machineType ?? null,
    pass: Number(r.pass ?? 0),
    fail: Number(r.fail ?? 0),
    warn: Number(r.warn ?? 0),
    skip: Number(r.skip ?? 0),
    total: Number(r.total ?? 0),
  }));
}

/**
 * Idempotent MART refresh: upsert one process_result_daily row per
 * (day, machineId, stepType) from the raw rows in the trailing `sinceDays` window.
 * Returns the number of rollup rows written. Safe to call repeatedly (ON CONFLICT).
 */
export async function refreshProcessResultDaily(sinceDays = 30): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const since = new Date(Date.now() - Math.min(Math.max(sinceDays, 1), 365) * 24 * 60 * 60 * 1000);
  const res = await db.execute(sql`
    INSERT INTO ${processResultDaily} ("day","machineId","machineType","stepType","pass","fail","warn","skip","total","firstPassYield","updatedAt")
    SELECT date_trunc('day', ${processResults.measuredAt})::date AS d,
           ${processResults.machineId}, ${processResults.machineType}, ${processResults.stepType},
           count(*) filter (where ${processResults.result} = 'pass')::int,
           count(*) filter (where ${processResults.result} = 'fail')::int,
           count(*) filter (where ${processResults.result} = 'warn')::int,
           count(*) filter (where ${processResults.result} = 'skip')::int,
           count(*)::int,
           (count(*) filter (where ${processResults.result} = 'pass'))::float
             / nullif(count(*) filter (where ${processResults.result} in ('pass','fail','warn')), 0),
           now()
    FROM ${processResults}
    WHERE ${processResults.measuredAt} >= ${since.toISOString()}::timestamptz
    GROUP BY d, ${processResults.machineId}, ${processResults.machineType}, ${processResults.stepType}
    ON CONFLICT ("day","machineId","stepType") DO UPDATE SET
      "machineType" = excluded."machineType",
      "pass" = excluded."pass", "fail" = excluded."fail", "warn" = excluded."warn",
      "skip" = excluded."skip", "total" = excluded."total",
      "firstPassYield" = excluded."firstPassYield", "updatedAt" = now()
  `);
  return (res as unknown as { count?: number }).count ?? 0;
}

export interface DailyRollupRow {
  day: string;
  machineId: number;
  machineType: string | null;
  stepType: string;
  pass: number;
  fail: number;
  warn: number;
  skip: number;
  total: number;
  firstPassYield: number | null;
}

/** Read the daily mart for a trailing window, newest day first. */
export async function readProcessResultDaily(opts: {
  sinceDays?: number;
  machineId?: number;
  machineType?: string;
  limit?: number;
}): Promise<DailyRollupRow[]> {
  const db = await getDb();
  if (!db) return [];
  const since = new Date(Date.now() - Math.min(Math.max(opts.sinceDays ?? 30, 1), 365) * 24 * 60 * 60 * 1000);
  const conds = [gte(processResultDaily.day, sql`${since.toISOString()}::date`)];
  if (opts.machineId != null) conds.push(eq(processResultDaily.machineId, opts.machineId));
  if (opts.machineType) conds.push(eq(processResultDaily.machineType, opts.machineType as DailyRollupRow["machineType"] as never));
  const rows = await db
    .select()
    .from(processResultDaily)
    .where(and(...conds))
    .orderBy(desc(processResultDaily.day))
    .limit(Math.min(Math.max(opts.limit ?? 500, 1), 5000));
  return rows.map((r) => ({
    day: String(r.day),
    machineId: r.machineId,
    machineType: r.machineType ?? null,
    stepType: r.stepType,
    pass: r.pass,
    fail: r.fail,
    warn: r.warn,
    skip: r.skip,
    total: r.total,
    firstPassYield: r.firstPassYield ?? null,
  }));
}
