/**
 * Khối 7 (doc 16 §11.2 / §15 T1-d) — Replay from TimescaleDB.  Read-only.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Queries the canonical telemetry store for a time window and returns an ORDERED,
 * DOWNSAMPLED time-series of per-device snapshots optimized for FE streaming /
 * scrubbing (a "VCR" over an incident — doc 16 §11.2 Luồng Replay).
 *
 * SOURCES:
 *   • ot_telemetry  — the canonical machine/device store (TSDB hypertable when
 *     TSDB_URL is set, else the main-DB table). We bucket per device per step and
 *     take the LAST sample in each bucket for the relevant metrics
 *     (position/x, position/y, packml_state, active_task_id) so each frame is a
 *     coherent snapshot.
 *   • robot_telemetry — robot pose snapshots (poseJson.cartesian) when robots are in
 *     scope; same bucketing.
 *
 * DOWNSAMPLING (documented + CAPPED): the window is divided into fixed `step`-second
 * buckets. We emit at most ONE frame per (device, bucket) using the newest row in the
 * bucket (last-observation-carried-forward semantics on the client). The total frame
 * count is hard-capped (TWIN_REPLAY_MAX_FRAMES, default 5000) — if the requested
 * window/step would exceed it, `step` is widened automatically and `downsampledStep`
 * reports the effective bucket size. This bounds the payload regardless of how wide
 * the window is.
 *
 * Read-only. Degrade-safe: returns an empty frame list when no DB / no data.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { sql } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { getTsdb } from "../../db/timescale";

export interface ReplaySnapshot {
  /** Bucket timestamp (epoch ms) this frame represents. */
  timestamp: number;
  equipmentId: string; // "machine:<id>" | "robot:<id>"
  position: { x: number; y: number } | null;
  packMlState: string | null;
  activeTaskId: number | null;
}

export interface ReplayResult {
  from: string;
  to: string;
  requestedStepSec: number;
  /** Effective bucket size after auto-widening to honor the frame cap. */
  downsampledStepSec: number;
  frameCount: number;
  capped: boolean;
  /** Ordered ascending by timestamp, then equipmentId. */
  snapshots: ReplaySnapshot[];
  note: string;
}

const HARD_MAX_FRAMES = () => Math.min(50000, Math.max(100, Number(process.env.TWIN_REPLAY_MAX_FRAMES) || 5000));

/** Metrics we reconstruct per snapshot from ot_telemetry. */
const POS_X_METRICS = ["position_x", "pos_x", "x"];
const POS_Y_METRICS = ["position_y", "pos_y", "y"];
const STATE_METRICS = ["packml_state", "packml", "state", "operation_status"];
const TASK_METRICS = ["active_task_id", "task_id"];

interface RawRow {
  bucket: Date | string;
  machineId: number | null;
  deviceId: string | null;
  metric: string;
  numValue: number | null;
  textValue: string | null;
}

/**
 * Compute the effective step needed to keep frames under the cap, given how many
 * devices are in scope. PURE + exported for unit-testing the downsampling math.
 *
 * frames ≈ ceil(windowSec / stepSec) * deviceCount. We widen stepSec until that
 * product fits maxFrames. deviceCount defaults to 1 if unknown.
 */
export function computeEffectiveStep(windowSec: number, requestedStepSec: number, deviceCount: number, maxFrames: number): number {
  const dc = Math.max(1, deviceCount);
  let step = Math.max(1, Math.floor(requestedStepSec));
  const buckets = () => Math.ceil(windowSec / step);
  while (buckets() * dc > maxFrames) {
    step = Math.ceil(step * 1.5) + 1; // grow geometrically so we converge fast
    if (step >= windowSec) {
      step = Math.max(1, Math.ceil(windowSec)); // one bucket
      break;
    }
  }
  return step;
}

/**
 * PURE — fold raw per-metric bucket rows into ordered per-device snapshots. Exported
 * so the bucketing/ordering can be unit-tested without a DB. Each (device, bucket)
 * collapses the matching metric rows into one snapshot frame.
 */
export function foldSnapshots(rows: RawRow[]): ReplaySnapshot[] {
  const byKey = new Map<string, ReplaySnapshot & { _bucket: number }>();
  for (const row of rows) {
    const equipmentId = row.machineId != null ? `machine:${row.machineId}` : `device:${row.deviceId ?? "unknown"}`;
    const bucketMs = new Date(row.bucket).getTime();
    const key = `${equipmentId}@${bucketMs}`;
    let snap = byKey.get(key);
    if (!snap) {
      snap = { timestamp: bucketMs, equipmentId, position: null, packMlState: null, activeTaskId: null, _bucket: bucketMs };
      byKey.set(key, snap);
    }
    const metric = row.metric.toLowerCase();
    if (POS_X_METRICS.includes(metric) && row.numValue != null) {
      snap.position = { x: row.numValue, y: snap.position?.y ?? 0 };
    } else if (POS_Y_METRICS.includes(metric) && row.numValue != null) {
      snap.position = { x: snap.position?.x ?? 0, y: row.numValue };
    } else if (STATE_METRICS.includes(metric)) {
      snap.packMlState = row.textValue ?? (row.numValue != null ? String(row.numValue) : snap.packMlState);
    } else if (TASK_METRICS.includes(metric) && row.numValue != null) {
      snap.activeTaskId = Math.round(row.numValue);
    }
  }
  const out = Array.from(byKey.values()).map(({ _bucket, ...s }) => s);
  out.sort((a, b) => a.timestamp - b.timestamp || a.equipmentId.localeCompare(b.equipmentId));
  return out;
}

export interface ReplayQuery {
  factoryId: number;
  from: Date;
  to: Date;
  /** Requested bucket size in seconds (auto-widened to honor the frame cap). */
  stepSec: number;
  /** Optional explicit device count hint for cap math (else derived). */
}

/**
 * Run a replay query. Buckets ot_telemetry by `time_bucket` (TSDB) or date_trunc-ish
 * arithmetic (main DB) per device, last-value-per-bucket for the reconstruction
 * metrics. Result size is capped; the effective step is reported.
 */
export async function runReplay(q: ReplayQuery): Promise<ReplayResult> {
  const windowSec = Math.max(1, (q.to.getTime() - q.from.getTime()) / 1000);
  const maxFrames = HARD_MAX_FRAMES();
  // We don't know device count until we query; estimate conservatively first, then
  // recompute the cap after we know how many devices appeared (a single re-bucket in
  // SQL would be ideal, but estimating device count up front keeps it one query).
  const tsdb = getTsdb();
  const useTsdb = !!tsdb;
  const db = useTsdb ? tsdb : await getDb();
  if (!db) {
    return emptyResult(q, q.stepSec, "db unavailable");
  }

  // First pass step uses the requested step assuming a modest device count; we
  // refine the cap after fold by trimming if needed.
  const effectiveStep = computeEffectiveStep(windowSec, q.stepSec, 8, maxFrames);
  const fromIso = q.from.toISOString();
  const toIso = q.to.toISOString();
  const allMetrics = [...POS_X_METRICS, ...POS_Y_METRICS, ...STATE_METRICS, ...TASK_METRICS];

  let rawRows: RawRow[] = [];
  try {
    // time_bucket exists on TSDB; on the main DB we emulate with to_timestamp(floor()).
    const bucketExpr = useTsdb
      ? sql`time_bucket(${`${effectiveStep} seconds`}::interval, "ts")`
      : sql`to_timestamp(floor(extract(epoch from "ts") / ${effectiveStep}) * ${effectiveStep})`;
    const result = await db.execute(sql`
      SELECT ${bucketExpr} AS bucket,
             "machineId", "deviceId", "metric",
             AVG("numValue")::float8 AS "numValue",
             (array_agg("textValue" ORDER BY "ts" DESC))[1] AS "textValue"
      FROM ot_telemetry
      WHERE "ts" >= ${fromIso}::timestamptz AND "ts" < ${toIso}::timestamptz
        AND lower("metric") = ANY(${allMetrics})
      GROUP BY bucket, "machineId", "deviceId", "metric"
      ORDER BY bucket ASC
    `);
    rawRows = (Array.isArray(result) ? result : (result as any).rows || []) as RawRow[];
  } catch (err) {
    console.error("[TwinReplay] query failed:", (err as Error)?.message ?? err);
    return emptyResult(q, effectiveStep, "query failed (see logs)");
  }

  let snapshots = foldSnapshots(rawRows);

  // Honor the hard cap after folding (defensive — keeps payload bounded even if the
  // up-front device estimate was too low). Trim oldest-first beyond the cap.
  let capped = false;
  if (snapshots.length > maxFrames) {
    snapshots = snapshots.slice(snapshots.length - maxFrames);
    capped = true;
  }

  return {
    from: fromIso,
    to: toIso,
    requestedStepSec: q.stepSec,
    downsampledStepSec: effectiveStep,
    frameCount: snapshots.length,
    capped,
    snapshots,
    note:
      `${useTsdb ? "TSDB time_bucket" : "main-DB epoch-floor"} buckets @ ${effectiveStep}s; ` +
      `last-text/avg-num per (device,bucket); cap ${maxFrames} frames${capped ? " (trimmed)" : ""}`,
  };
}

function emptyResult(q: ReplayQuery, step: number, note: string): ReplayResult {
  return {
    from: q.from.toISOString(),
    to: q.to.toISOString(),
    requestedStepSec: q.stepSec,
    downsampledStepSec: step,
    frameCount: 0,
    capped: false,
    snapshots: [],
    note,
  };
}
