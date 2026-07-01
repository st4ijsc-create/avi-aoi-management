/**
 * I2-a runtime — load telemetry/jobs for a robot, run the pure detector, dedupe,
 * persist an advisory ledger row + raise a SMART ALERT. Flag-gated
 * (AI_ROBOT_ANOMALY_ENABLED) — a complete NO-OP when off.
 *
 * SAFETY: this NEVER issues a robot command. It writes to robot_behavior_anomalies
 * (advisory) and routes an alert through the EXISTING aiSmartAlertRouter path. It is
 * lazily imported from robotIngest (fire-and-forget) so the ingest hot path stays
 * dependency-free and unaffected when the flag is off.
 */
import { getDb } from "../../db/connection";
import { and, desc, eq, gte } from "drizzle-orm";
import {
  robotTelemetry,
  robotJobs,
  robotBehaviorAnomalies,
  type InsertRobotBehaviorAnomaly,
} from "../../../drizzle/schema";
import {
  detect,
  isRobotAnomalyEnabled,
  type RobotAnomaly,
  type TelemetrySnapshot,
  type JobDuration,
} from "./robotBehaviorAnomaly";
import type { AlarmSeverity } from "../standards/alarmTaxonomy";

const TELEMETRY_WINDOW = 200; // most-recent snapshots to consider
const JOB_WINDOW = 100; // most-recent completed jobs to consider
// De-dupe window: don't re-raise the same (robot, kind) within this many ms.
const DEDUPE_WINDOW_MS = 15 * 60 * 1000;

/** Map an ISA-18.2 severity band → the smart-alert severity enum. */
function toAlertSeverity(sev: AlarmSeverity): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
  switch (sev) {
    case "critical": return "CRITICAL";
    case "high": return "HIGH";
    case "low":
    case "diagnostic": return "LOW";
    default: return "MEDIUM";
  }
}

/** Decode a robot_telemetry row into a detector TelemetrySnapshot. */
function toSnapshot(row: typeof robotTelemetry.$inferSelect): TelemetrySnapshot {
  const ts = (row.timestamp ?? row.createdAt ?? new Date()).getTime();
  const snap: TelemetrySnapshot = { timestamp: ts };

  // jointStates: Array<{ position?/pos?/angle?, force?/gripForce? , ... }>
  const js = row.jointStates as Array<Record<string, unknown>> | null | undefined;
  if (Array.isArray(js) && js.length > 0) {
    const positions: number[] = [];
    for (const j of js) {
      const p = j.position ?? j.pos ?? j.angle ?? j.value;
      if (typeof p === "number" && Number.isFinite(p)) positions.push(p);
    }
    if (positions.length > 0) snap.jointPositions = positions;
    // Grip force is a SEAM — only present when a driver surfaces it. Honest skip otherwise.
    for (const j of js) {
      const f = j.gripForce ?? j.force ?? j.grip_force;
      if (typeof f === "number" && Number.isFinite(f)) { snap.gripForce = f; break; }
    }
  }

  // Cartesian fallback from poseJson.cartesian {x,y,z}.
  const pose = row.poseJson as Record<string, unknown> | null | undefined;
  const cart = pose?.cartesian as Record<string, unknown> | undefined;
  if (!snap.jointPositions && cart && typeof cart.x === "number" && typeof cart.y === "number" && typeof cart.z === "number") {
    snap.cartesian = { x: cart.x as number, y: cart.y as number, z: cart.z as number };
  }
  // Grip force may also arrive on poseJson.gripForce.
  if (snap.gripForce == null && typeof pose?.gripForce === "number") snap.gripForce = pose.gripForce as number;

  return snap;
}

/**
 * Detect anomalies for one robot and (when enabled) persist + raise alerts.
 * Returns the anomalies found (whether or not persisted). NO-OP → [] when the flag
 * is off or there's no DB.
 */
export async function detectAndRaiseForRobot(robotId: number): Promise<RobotAnomaly[]> {
  if (!isRobotAnomalyEnabled()) return [];
  const db = await getDb();
  if (!db) return [];

  // Most-recent telemetry (ascending time order for the detector).
  const telemetryRows = await db
    .select()
    .from(robotTelemetry)
    .where(eq(robotTelemetry.robotId, robotId))
    .orderBy(desc(robotTelemetry.timestamp))
    .limit(TELEMETRY_WINDOW);
  const snapshots = telemetryRows.map(toSnapshot).reverse();

  // Completed jobs → cycle-time durations.
  const jobRows = await db
    .select()
    .from(robotJobs)
    .where(and(eq(robotJobs.robotId, robotId), eq(robotJobs.status, "done")))
    .orderBy(desc(robotJobs.completedAt))
    .limit(JOB_WINDOW);
  const jobs: JobDuration[] = jobRows
    .filter((j) => j.startedAt && j.completedAt)
    .map((j) => ({
      timestamp: (j.completedAt as Date).getTime(),
      durationMs: (j.completedAt as Date).getTime() - (j.startedAt as Date).getTime(),
    }))
    .filter((j) => j.durationMs > 0)
    .reverse();

  const anomalies = detect({ robotId, snapshots, jobs });
  for (const anomaly of anomalies) {
    await persistAndRaise(anomaly).catch((err) =>
      console.error(`[robotAnomaly] persist/raise failed for robot ${robotId} (${anomaly.kind}):`, (err as Error)?.message ?? err),
    );
  }
  return anomalies;
}

/** Persist one anomaly (deduped) + raise a smart alert. */
async function persistAndRaise(anomaly: RobotAnomaly): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // De-dupe: skip if the same (robot, kind) was recorded within the window.
  const since = new Date(Date.now() - DEDUPE_WINDOW_MS);
  const [recent] = await db
    .select({ id: robotBehaviorAnomalies.id })
    .from(robotBehaviorAnomalies)
    .where(
      and(
        eq(robotBehaviorAnomalies.robotId, anomaly.robotId),
        eq(robotBehaviorAnomalies.kind, anomaly.kind),
        gte(robotBehaviorAnomalies.detectedAt, since),
      ),
    )
    .limit(1);
  if (recent) return;

  // Raise a smart alert through the EXISTING router (reuse — no new alert path).
  let alertId: number | null = null;
  try {
    const { routeAlert } = await import("../aiSmartAlertRouter");
    await routeAlert({
      type: "PATTERN_ANOMALY",
      severity: toAlertSeverity(anomaly.severity),
      message:
        `Robot ${anomaly.robotId} behaviour anomaly: ${anomaly.kind} ` +
        `(score ${anomaly.score}, confidence ${anomaly.confidence}). Advisory only — no command issued.`,
      data: { confidence: anomaly.confidence, robotId: anomaly.robotId, kind: anomaly.kind, evidence: anomaly.evidence },
    });
  } catch (err) {
    console.error(`[robotAnomaly] routeAlert failed (robot ${anomaly.robotId}/${anomaly.kind}):`, (err as Error)?.message ?? err);
  }

  const row: InsertRobotBehaviorAnomaly = {
    robotId: anomaly.robotId,
    kind: anomaly.kind,
    score: String(anomaly.score),
    confidence: anomaly.confidence != null ? String(anomaly.confidence) : null,
    severity: anomaly.severity,
    evidence: anomaly.evidence,
    alertId,
    status: "raised",
  };
  await db.insert(robotBehaviorAnomalies).values(row);
}
