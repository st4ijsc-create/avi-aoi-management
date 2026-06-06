// Sprint F2 — DB access for generic process results (parallel to inspection).
import { getDb } from "./connection";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { processResults, InsertProcessResult } from "../../drizzle/schema";

/** Insert one process-result row; returns the new id. */
export async function insertProcessResult(row: InsertProcessResult): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
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
