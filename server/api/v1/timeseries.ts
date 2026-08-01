/**
 * doc 44 W2-B1 / G2.16 — POST /v1/query/timeseries (SYNAPSE Tầng 2 §11.2).
 *
 * Body: { series, path | machineId, from, to, agg?: raw|avg|min|max|sum,
 *         bucket?: '1m'|'5m'|'1h'|…, limit? } → { points: [{ts, v, …}] }.
 *
 * ENGINE SELECTION (honest, reported in the response as `engine`):
 *   1. Dedicated TimescaleDB (TSDB_URL, server/db/timescale.ts) when configured
 *      and not degraded → `time_bucket` there ('timescale-tsdb').
 *   2. Main DB with the timescaledb extension active — detected via the
 *      db_feature_status row 'timescaledb_hypertables' (migration 0172),
 *      cached 5 min → `time_bucket` ('timescale-main').
 *   3. Plain PostgreSQL — epoch-floor bucketing
 *      to_timestamp(floor(extract(epoch from ts)/N)*N) ('plain-pg'), which
 *      unlike date_trunc supports arbitrary bucket sizes (5m, 15m, …).
 *
 * Aggregates operate on "numValue" ONLY (honest: non-numeric samples cannot be
 * averaged — raw mode surfaces text/bool values verbatim). Pagination: limit
 * default 5000, cap 50000, `truncated` flag when the cap bites.
 * Scope: data:read. READ-ONLY.
 */
import { type Router, type Request, type Response } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { requireScope } from "./auth";
import { API_SCOPES } from "./scopes";
import { sendOk, wrap, ApiHttpError } from "./envelope";
import { executeRows } from "../../utils/kpi";

// ─── Limits / validation ──────────────────────────────────────────────────────

const DEFAULT_LIMIT = 5000;
const MAX_LIMIT = 50000;

const AGGS = ["raw", "avg", "min", "max", "sum"] as const;
const AGG_SQL: Record<string, string> = { avg: "AVG", min: "MIN", max: "MAX", sum: "SUM" };

const bodySchema = z.object({
  series: z.string().trim().min(1).max(200),
  path: z.string().trim().min(1).max(512).optional(),
  machineId: z.number().int().positive().optional(),
  from: z.string().min(1),
  to: z.string().min(1),
  agg: z.enum(AGGS).default("raw"),
  bucket: z
    .string()
    .regex(/^\d+(s|m|h|d)$/, "bucket must look like 30s / 1m / 5m / 1h / 1d")
    .optional(),
  limit: z.number().int().positive().max(MAX_LIMIT).optional(),
});

/** '5m' → seconds (300). Caller has already regex-validated the shape. */
export function bucketToSeconds(bucket: string): number {
  const m = /^(\d+)(s|m|h|d)$/.exec(bucket);
  if (!m) return 300;
  const n = Number(m[1]);
  const mult = m[2] === "s" ? 1 : m[2] === "m" ? 60 : m[2] === "h" ? 3600 : 86400;
  return Math.max(1, n * mult);
}

function parseIsoDate(raw: string, label: string): Date {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new ApiHttpError(400, "bad_request", `Invalid ${label} — expected an ISO date-time.`);
  return d;
}

// ─── Main-DB Timescale detection (db_feature_status, cached) ─────────────────

const TIMESCALE_FEATURE = "timescaledb_hypertables";
const TIMESCALE_CHECK_TTL_MS = 5 * 60 * 1000;
let timescaleCheck: { active: boolean; checkedAt: number } | null = null;

/** True when migration 0172 recorded active hypertables on the MAIN DB. */
export async function isMainDbTimescaleActive(): Promise<boolean> {
  if (timescaleCheck && Date.now() - timescaleCheck.checkedAt < TIMESCALE_CHECK_TTL_MS) {
    return timescaleCheck.active;
  }
  let active = false;
  try {
    const { getDb } = await import("../../db/connection");
    const db = await getDb();
    if (db) {
      const rows = executeRows(
        await db.execute(
          sql`SELECT "status" FROM db_feature_status WHERE "feature" = ${TIMESCALE_FEATURE} LIMIT 1`,
        ),
      ) as Array<{ status?: string }>;
      active = rows[0]?.status === "ok";
    }
  } catch {
    active = false; // table absent / query failed → honest plain-PG fallback
  }
  timescaleCheck = { active, checkedAt: Date.now() };
  return active;
}

/** Test seam: drop the cached Timescale detection. */
export function _resetTimeseriesEngineCacheForTests(): void {
  timescaleCheck = null;
}

// ─── Row shapes ───────────────────────────────────────────────────────────────

export interface TimeseriesPointOut {
  ts: string;
  v: number | string | boolean | null;
  q?: string;
  unit?: string | null;
}

interface RawRow {
  ts: Date | string;
  numValue: number | null;
  textValue: string | null;
  boolValue: boolean | null;
  quality: string | null;
  unit: string | null;
}

interface BucketRow {
  bucket: Date | string;
  v: number | null;
}

// ─── Query executors (shared by /query/timeseries + the equipment fix) ───────

type Executor = { execute: (q: unknown) => Promise<unknown> };

async function runRaw(
  db: Executor,
  machineId: number,
  series: string,
  from: Date,
  to: Date,
  limit: number,
): Promise<TimeseriesPointOut[]> {
  const rows = executeRows(
    await db.execute(sql`
      SELECT "ts", "numValue", "textValue", "boolValue", "quality", "unit"
      FROM ot_telemetry
      WHERE "machineId" = ${machineId}
        AND "metric" = ${series}
        AND "ts" >= ${from.toISOString()}::timestamptz
        AND "ts" <= ${to.toISOString()}::timestamptz
      ORDER BY "ts" ASC
      LIMIT ${limit}
    `),
  ) as RawRow[];
  return rows.map((r) => ({
    ts: new Date(r.ts).toISOString(),
    v: r.numValue ?? r.boolValue ?? r.textValue ?? null,
    ...(r.quality ? { q: String(r.quality).toUpperCase() } : {}),
    ...(r.unit != null ? { unit: r.unit } : {}),
  }));
}

async function runBucketed(
  db: Executor,
  opts: { machineId: number; series: string; from: Date; to: Date; limit: number; agg: string; bucketSec: number; timeBucket: boolean },
): Promise<TimeseriesPointOut[]> {
  const aggFn = AGG_SQL[opts.agg];
  const aggExpr = sql.raw(`${aggFn}("numValue")::float8`);
  const bucketExpr = opts.timeBucket
    ? sql`time_bucket(${`${opts.bucketSec} seconds`}::interval, "ts")`
    : sql`to_timestamp(floor(extract(epoch FROM "ts") / ${opts.bucketSec}) * ${opts.bucketSec})`;
  const rows = executeRows(
    await db.execute(sql`
      SELECT ${bucketExpr} AS bucket, ${aggExpr} AS v
      FROM ot_telemetry
      WHERE "machineId" = ${opts.machineId}
        AND "metric" = ${opts.series}
        AND "ts" >= ${opts.from.toISOString()}::timestamptz
        AND "ts" <= ${opts.to.toISOString()}::timestamptz
        AND "numValue" IS NOT NULL
      GROUP BY bucket
      ORDER BY bucket ASC
      LIMIT ${opts.limit}
    `),
  ) as BucketRow[];
  return rows.map((r) => ({
    ts: new Date(r.bucket).toISOString(),
    v: r.v == null ? null : Number(r.v),
  }));
}

/**
 * W0-audit bug fix (router.ts /equipment/:id/telemetry): a REAL range query for
 * a machine's telemetry (all metrics), newest first — previously from/to were
 * echoed without ever filtering. Main-DB read (stable legacy row shape).
 */
export async function queryTelemetryRangeRows(opts: {
  machineId: number;
  from: Date;
  to: Date;
  limit?: number;
}): Promise<
  Array<{ tagKey: string; valueNumeric: number | null; valueText: string | null; quality: string; timestamp: string; unit: string | null }>
> {
  const { getDb } = await import("../../db/connection");
  const db = await getDb();
  if (!db) return [];
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 1000);
  const rows = executeRows(
    await db.execute(sql`
      SELECT "metric", "numValue", "textValue", "boolValue", "quality", "unit", "ts"
      FROM ot_telemetry
      WHERE "machineId" = ${opts.machineId}
        AND "ts" >= ${opts.from.toISOString()}::timestamptz
        AND "ts" <= ${opts.to.toISOString()}::timestamptz
      ORDER BY "ts" DESC
      LIMIT ${limit}
    `),
  ) as Array<RawRow & { metric: string }>;
  return rows.map((r) => ({
    tagKey: r.metric,
    valueNumeric: r.numValue == null ? null : Number(r.numValue),
    valueText: r.textValue ?? (r.boolValue == null ? null : r.boolValue ? "true" : "false"),
    quality: String(r.quality ?? "good"),
    timestamp: new Date(r.ts).toISOString(),
    unit: r.unit ?? null,
  }));
}

// ─── Route ────────────────────────────────────────────────────────────────────

/** Register POST /query/timeseries on the /api/v1 router. */
export function registerTimeseriesRoutes(r: Router): void {
  r.post(
    "/query/timeseries",
    requireScope(API_SCOPES.DATA_READ),
    wrap(async (req: Request, res: Response) => {
      const parsed = bodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new ApiHttpError(400, "bad_request", "Invalid timeseries query body.", { issues: parsed.error.issues });
      }
      const body = parsed.data;
      if (body.path == null && body.machineId == null) {
        throw new ApiHttpError(400, "bad_request", "Provide either `path` (ISA-95) or `machineId`.");
      }
      const from = parseIsoDate(body.from, "from");
      const to = parseIsoDate(body.to, "to");
      if (from.getTime() >= to.getTime()) {
        throw new ApiHttpError(400, "bad_request", "`from` must be earlier than `to`.");
      }
      const limit = Math.min(body.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

      const { getDb } = await import("../../db/connection");
      const mainDb = await getDb();
      if (!mainDb) throw new ApiHttpError(500, "db_unavailable", "Database not connected.");

      // Resolve path → machineId (spec §11.3: address by semantic path).
      let machineId = body.machineId ?? null;
      let path = body.path ?? null;
      if (machineId == null && path) {
        const { normalizePath } = await import("../../services/stateStore/stateStore");
        const norm = normalizePath(path);
        if (!norm) throw new ApiHttpError(400, "bad_request", "Invalid `path`.");
        path = norm;
        const rows = executeRows(
          await mainDb.execute(
            sql`SELECT "id" FROM machines WHERE "isa95_path" = ${norm} AND "isActive" = true LIMIT 1`,
          ),
        ) as Array<{ id: number }>;
        if (!rows[0]) throw new ApiHttpError(404, "not_found", `No asset maps to path "${norm}".`);
        machineId = Number(rows[0].id);
      }

      // Engine selection (see module header). TSDB errors fall back to main DB.
      let engine: "timescale-tsdb" | "timescale-main" | "plain-pg" = "plain-pg";
      let db: Executor = mainDb as unknown as Executor;
      try {
        const { getTsdb } = await import("../../db/timescale");
        const tsdb = getTsdb();
        if (tsdb) {
          engine = "timescale-tsdb";
          db = tsdb as unknown as Executor;
        }
      } catch {
        /* dedicated TSDB unavailable → main DB */
      }
      if (engine !== "timescale-tsdb") {
        engine = (await isMainDbTimescaleActive()) ? "timescale-main" : "plain-pg";
      }

      const run = async (executor: Executor, useTimeBucket: boolean): Promise<TimeseriesPointOut[]> => {
        if (body.agg === "raw") {
          return runRaw(executor, machineId!, body.series, from, to, limit);
        }
        const bucketSec = bucketToSeconds(body.bucket ?? "5m");
        return runBucketed(executor, {
          machineId: machineId!,
          series: body.series,
          from,
          to,
          limit,
          agg: body.agg,
          bucketSec,
          timeBucket: useTimeBucket,
        });
      };

      let points: TimeseriesPointOut[];
      try {
        points = await run(db, engine !== "plain-pg");
      } catch (err) {
        if (engine === "timescale-tsdb") {
          // Honest degrade: dedicated TSDB failed mid-flight → main DB path.
          engine = (await isMainDbTimescaleActive()) ? "timescale-main" : "plain-pg";
          db = mainDb as unknown as Executor;
          points = await run(db, engine !== "plain-pg");
        } else {
          throw err;
        }
      }

      sendOk(res, {
        series: body.series,
        ...(path ? { path } : {}),
        machineId,
        agg: body.agg,
        ...(body.agg !== "raw" ? { bucket: body.bucket ?? "5m" } : {}),
        from: from.toISOString(),
        to: to.toISOString(),
        engine,
        count: points.length,
        truncated: points.length >= limit,
        points,
      });
    }),
  );
}
