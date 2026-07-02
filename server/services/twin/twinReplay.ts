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
  /**
   * doc 24 Wave-1 T1 — OPTIONAL joint-angle vector for an articulated robot
   * (from robot_telemetry.poseJson.joints, last-per-bucket). null for machines and
   * for robots that reported no joints → the FE replays the sliding block as before.
   * `kinematicModelId` names the sample chain the joints index into (arm/cobot →
   * sample-arm-6dof; else sample-scara), so the FE picks the matching FK chain.
   */
  joints: number[] | null;
  kinematicModelId: string | null;
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
      snap = { timestamp: bucketMs, equipmentId, position: null, packMlState: null, activeTaskId: null, joints: null, kinematicModelId: null, _bucket: bucketMs };
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

/**
 * doc 24 Wave-1 T1 — one bucketed robot_telemetry row (last poseJson per bucket).
 */
interface RobotJointRow {
  bucket: Date | string;
  robotId: number;
  kind: string | null;
  poseJson: Record<string, unknown> | null;
}

/** Map a robot `kind` → sample kinematic-model id (mirrors sceneGraph / assetCockpit). */
function robotKindToKinematicModelId(kind: string | null | undefined): string {
  const k = (kind ?? "").toLowerCase();
  if (k === "cobot" || k === "arm") return "sample-arm-6dof";
  return "sample-scara";
}

/** Extract a finite number[] joints vector from a pose JSON (poseJson.joints). */
function jointsFromPose(pose: Record<string, unknown> | null): number[] | null {
  if (!pose) return null;
  const j = (pose as { joints?: unknown }).joints;
  if (Array.isArray(j) && j.length > 0 && j.every((v) => typeof v === "number" && Number.isFinite(v))) {
    return j as number[];
  }
  return null;
}

/**
 * PURE — fold bucketed robot_telemetry rows into `robot:<id>` snapshot frames carrying
 * ONLY joints (+ modelId). Exported for unit-testing. These are MERGED into the
 * ot_telemetry snapshots by (equipmentId, timestamp) in runReplay; a robot with no
 * matching ot_telemetry frame still gets a joints-only frame (position stays null →
 * the FE keeps its last position, articulating in place).
 */
export function foldRobotJointFrames(rows: RobotJointRow[]): ReplaySnapshot[] {
  const byKey = new Map<string, ReplaySnapshot>();
  for (const row of rows) {
    const joints = jointsFromPose(row.poseJson);
    if (!joints) continue;
    const equipmentId = `robot:${row.robotId}`;
    const bucketMs = new Date(row.bucket).getTime();
    const key = `${equipmentId}@${bucketMs}`;
    byKey.set(key, {
      timestamp: bucketMs,
      equipmentId,
      position: null,
      packMlState: null,
      activeTaskId: null,
      joints,
      kinematicModelId: robotKindToKinematicModelId(row.kind),
    });
  }
  return Array.from(byKey.values());
}

/**
 * PURE — merge robot joints-frames into the ot_telemetry snapshots. When a
 * (equipmentId, timestamp) frame already exists, joints/kinematicModelId are attached
 * to it; otherwise a new joints-only frame is appended. Re-sorted ascending. Exported
 * for unit-testing the merge/ordering.
 */
export function mergeJointFrames(base: ReplaySnapshot[], jointFrames: ReplaySnapshot[]): ReplaySnapshot[] {
  if (jointFrames.length === 0) return base;
  const index = new Map<string, ReplaySnapshot>();
  for (const s of base) index.set(`${s.equipmentId}@${s.timestamp}`, s);
  const out = [...base];
  for (const jf of jointFrames) {
    const existing = index.get(`${jf.equipmentId}@${jf.timestamp}`);
    if (existing) {
      existing.joints = jf.joints;
      existing.kinematicModelId = jf.kinematicModelId;
    } else {
      index.set(`${jf.equipmentId}@${jf.timestamp}`, jf);
      out.push(jf);
    }
  }
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

  // doc 24 Wave-1 T1 — best-effort robot ARTICULATION frames. Robot joints live in
  // robot_telemetry.poseJson.joints (MAIN DB, not the ot_telemetry TSDB hypertable),
  // so this is a SEPARATE, additive query over the main-DB connection; last poseJson
  // per (robot, bucket), scoped to the factory's robots. Fully degrade-safe: any
  // failure (no main DB, no robots, malformed pose) just leaves snapshots unchanged →
  // replay articulates when joints exist and slides the block otherwise (backward-compat).
  try {
    const { getDb } = await import("../../db/connection");
    const mainDb = await getDb();
    if (mainDb) {
      const jointRows = await mainDb.execute(sql`
        SELECT to_timestamp(floor(extract(epoch from rt."timestamp") / ${effectiveStep}) * ${effectiveStep}) AS bucket,
               rt."robotId" AS "robotId",
               r."kind" AS "kind",
               (array_agg(rt."poseJson" ORDER BY rt."timestamp" DESC))[1] AS "poseJson"
        FROM robot_telemetry rt
        JOIN robots r ON r.id = rt."robotId"
        LEFT JOIN stations s ON s.id = r."stationId"
        LEFT JOIN production_lines pl ON pl.id = COALESCE(r."lineId", s."lineId")
        LEFT JOIN workshops w ON w.id = pl."workshopId"
        WHERE rt."timestamp" >= ${fromIso}::timestamptz AND rt."timestamp" < ${toIso}::timestamptz
          AND w."factoryId" = ${q.factoryId}
        GROUP BY bucket, rt."robotId", r."kind"
        ORDER BY bucket ASC
      `);
      const rows = (Array.isArray(jointRows) ? jointRows : (jointRows as any).rows || []) as RobotJointRow[];
      const jointFrames = foldRobotJointFrames(rows);
      snapshots = mergeJointFrames(snapshots, jointFrames);
    }
  } catch (err) {
    // Non-fatal — replay stays fully functional without articulation.
    console.error("[TwinReplay] robot-joints query failed (non-fatal):", (err as Error)?.message ?? err);
  }

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
