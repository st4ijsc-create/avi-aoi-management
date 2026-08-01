/**
 * I2-a (doc 16 §9 Khối 4 / doc 18 §6) — ROBOT-BEHAVIOUR ANOMALY detection.
 * Flag: AI_ROBOT_ANOMALY_ENABLED (default OFF).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * The TIME-SERIES analog of aiAnomalyDetection (which is PatchCore over IMAGES).
 * It does NOT fork the image memory bank — it reuses the aiTimeSeriesEngine math
 * (EWMA residual + CUSUM change-point) over robot telemetry/jobs.
 *
 * THREE detectors (all pure → unit-testable):
 *   (1) trajectory_deviation — joint positions (or Cartesian pose) vs a rolling
 *       EWMA baseline; a residual > threshold·σ on any joint is anomalous.
 *   (2) grip_force — force telemetry, IF present. HONEST NULL-SKIP: robot_telemetry
 *       has no dedicated force column today, so unless a driver surfaces a numeric
 *       `gripForce`/`force` inside jointStates/pose meta, this detector returns NO
 *       finding (it NEVER fabricates a force reading).
 *   (3) cycle_time_trend — per-job durations from robot_jobs (completedAt-startedAt);
 *       a rising CUSUM change-point (or EWMA drift) flags degradation.
 *
 * OUTPUT: advisory RobotAnomaly {robotId, kind, score, confidence, evidence}. The
 * runtime hook raises a SMART ALERT (aiSmartAlertRouter.routeAlert) + writes an
 * append-only robot_behavior_anomalies row — NEVER a device command.
 *
 * FLAG DISCIPLINE: detect() is a pure function usable regardless of the flag; the
 * runtime detectAndRaiseForRobot() is a NO-OP when AI_ROBOT_ANOMALY_ENABLED is off.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { ewma, detectChangePoints, type TimeSeriesPoint } from "../aiTimeSeriesEngine";
import type { AlarmSeverity } from "../standards/alarmTaxonomy";

export function isRobotAnomalyEnabled(): boolean {
  return process.env.AI_ROBOT_ANOMALY_ENABLED === "true";
}

/** Default EWMA residual threshold (σ) for trajectory/force. Override via env. */
function trajectoryThreshold(): number {
  const n = Number(process.env.AI_ROBOT_ANOMALY_TRAJ_SIGMA);
  return Number.isFinite(n) && n > 0 ? n : 3.0;
}
/** Default CUSUM threshold for the cycle-time trend. Override via env. */
function cycleTimeThreshold(): number {
  const n = Number(process.env.AI_ROBOT_ANOMALY_CYCLE_CUSUM);
  return Number.isFinite(n) && n > 0 ? n : 4.0;
}

export type RobotAnomalyKind = "trajectory_deviation" | "grip_force" | "cycle_time_trend";

export interface RobotAnomaly {
  robotId: number;
  kind: RobotAnomalyKind;
  /** Anomaly score (σ for EWMA-based; cumulative sum for CUSUM). Higher = worse. */
  score: number;
  /** 0..1 — how much data backed the detection. */
  confidence: number;
  severity: AlarmSeverity;
  evidence: Record<string, unknown>;
}

/** A telemetry snapshot the detector consumes (subset of robot_telemetry, decoded). */
export interface TelemetrySnapshot {
  timestamp: number; // epoch ms
  /** Per-joint numeric positions, in a stable joint order. */
  jointPositions?: number[];
  /** Cartesian position (fallback trajectory signal when no joints). */
  cartesian?: { x: number; y: number; z: number };
  /** Numeric grip/force reading IF a driver surfaced one (else undefined → skip). */
  gripForce?: number;
}

/** A completed job the cycle-time detector consumes. */
export interface JobDuration {
  timestamp: number; // epoch ms (completion time)
  durationMs: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Clamp a raw σ/CUSUM score into a 0..1 confidence via a soft saturating curve. */
function scoreToConfidence(score: number, threshold: number): number {
  if (!(score > 0) || !(threshold > 0)) return 0;
  // At exactly the threshold → 0.5; grows asymptotically toward 1.
  const ratio = score / threshold;
  return Math.min(1, Math.max(0, ratio / (ratio + 1)));
}

function severityForSigma(sigma: number): AlarmSeverity {
  if (sigma >= 6) return "critical";
  if (sigma >= 4.5) return "high";
  if (sigma >= 3) return "medium";
  return "low";
}

// ─── (1) Trajectory deviation ─────────────────────────────────────────────────

/**
 * Detect a trajectory deviation. For each joint (or each cartesian axis when no
 * joints are present) build a time series and run EWMA; the worst per-axis residual
 * σ over the threshold is the anomaly. Returns null when there's no usable signal
 * (honest skip) or nothing exceeds the threshold.
 */
export function detectTrajectoryDeviation(
  robotId: number,
  snapshots: TelemetrySnapshot[],
  threshold = trajectoryThreshold(),
): RobotAnomaly | null {
  if (snapshots.length < 8) return null; // not enough history for a baseline

  const useJoints = snapshots.every((s) => Array.isArray(s.jointPositions) && s.jointPositions.length > 0);
  const useCartesian = !useJoints && snapshots.every((s) => s.cartesian != null);
  if (!useJoints && !useCartesian) return null; // no trajectory signal → honest skip

  const axisCount = useJoints
    ? Math.min(...snapshots.map((s) => s.jointPositions!.length))
    : 3;

  let worst: { axis: number; sigma: number; index: number } | null = null;

  for (let axis = 0; axis < axisCount; axis++) {
    const series: TimeSeriesPoint[] = snapshots.map((s) => ({
      timestamp: s.timestamp,
      value: useJoints
        ? s.jointPositions![axis]
        : [s.cartesian!.x, s.cartesian!.y, s.cartesian!.z][axis],
    }));
    const { anomalies } = ewma(series, 0.3, threshold);
    for (const a of anomalies) {
      if (!worst || a.score > worst.sigma) worst = { axis, sigma: a.score, index: a.index };
    }
  }

  if (!worst) return null;

  return {
    robotId,
    kind: "trajectory_deviation",
    score: Number(worst.sigma.toFixed(4)),
    confidence: Number(scoreToConfidence(worst.sigma, threshold).toFixed(4)),
    severity: severityForSigma(worst.sigma),
    evidence: {
      algorithm: "ewma_residual",
      signal: useJoints ? "joint_positions" : "cartesian",
      axis: worst.axis,
      thresholdSigma: threshold,
      residualSigma: Number(worst.sigma.toFixed(4)),
      atIndex: worst.index,
      atTimestamp: snapshots[worst.index]?.timestamp ?? null,
      sampleCount: snapshots.length,
    },
  };
}

// ─── (2) Grip force ────────────────────────────────────────────────────────────

/**
 * Detect abnormal grip force via EWMA residual. HONEST NULL-SKIP: if fewer than 8
 * snapshots carry a numeric gripForce, returns null (no force telemetry → we do NOT
 * invent a reading). Only real force values feed the detector.
 */
export function detectGripForceAnomaly(
  robotId: number,
  snapshots: TelemetrySnapshot[],
  threshold = trajectoryThreshold(),
): RobotAnomaly | null {
  const forced = snapshots.filter((s) => typeof s.gripForce === "number" && Number.isFinite(s.gripForce));
  if (forced.length < 8) return null; // no / too little force telemetry → honest skip

  const series: TimeSeriesPoint[] = forced.map((s) => ({ timestamp: s.timestamp, value: s.gripForce as number }));
  const { anomalies } = ewma(series, 0.3, threshold);
  if (anomalies.length === 0) return null;

  const worst = anomalies.reduce((a, b) => (b.score > a.score ? b : a));
  return {
    robotId,
    kind: "grip_force",
    score: Number(worst.score.toFixed(4)),
    confidence: Number(scoreToConfidence(worst.score, threshold).toFixed(4)),
    severity: severityForSigma(worst.score),
    evidence: {
      algorithm: "ewma_residual",
      signal: "grip_force",
      thresholdSigma: threshold,
      residualSigma: Number(worst.score.toFixed(4)),
      observedForce: worst.value,
      atTimestamp: worst.timestamp,
      sampleCount: forced.length,
    },
  };
}

// ─── (3) Cycle-time trend ────────────────────────────────────────────────────

/**
 * Detect a RISING cycle-time trend via CUSUM change-point over per-job durations.
 * Only an INCREASE (degradation) is reported (a decrease = faster = not a fault).
 * Returns null when there aren't enough jobs or no upward change-point is found.
 */
export function detectCycleTimeTrend(
  robotId: number,
  jobs: JobDuration[],
  threshold = cycleTimeThreshold(),
): RobotAnomaly | null {
  if (jobs.length < 10) return null;

  const series: TimeSeriesPoint[] = jobs.map((j) => ({ timestamp: j.timestamp, value: j.durationMs }));
  const changePoints = detectChangePoints(series, threshold).filter((c) => c.direction === "increase");
  if (changePoints.length === 0) return null;

  const worst = changePoints.reduce((a, b) => (Math.abs(b.cumulativeSum) > Math.abs(a.cumulativeSum) ? b : a));
  const cusum = Math.abs(worst.cumulativeSum);

  // Report the before/after mean around the change-point as honest evidence.
  const before = jobs.slice(0, worst.index).map((j) => j.durationMs);
  const after = jobs.slice(worst.index).map((j) => j.durationMs);
  const meanOf = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0);

  return {
    robotId,
    kind: "cycle_time_trend",
    score: Number(cusum.toFixed(4)),
    confidence: Number(scoreToConfidence(cusum, threshold).toFixed(4)),
    severity: cusum >= threshold * 2 ? "high" : "medium",
    evidence: {
      algorithm: "cusum_change_point",
      direction: "increase",
      cusumThreshold: threshold,
      cumulativeSum: Number(cusum.toFixed(4)),
      changePointIndex: worst.index,
      changePointAt: worst.timestamp,
      meanBeforeMs: Number(meanOf(before).toFixed(1)),
      meanAfterMs: Number(meanOf(after).toFixed(1)),
      jobCount: jobs.length,
    },
  };
}

// ─── Unified pure detector ────────────────────────────────────────────────────

export interface DetectInput {
  robotId: number;
  snapshots: TelemetrySnapshot[];
  jobs: JobDuration[];
}

/**
 * Run all three detectors and return every anomaly found. PURE — no I/O, no flag
 * check. A stable robot returns []. Honest-null seams (no force telemetry / too
 * little history) simply contribute nothing.
 */
export function detect(input: DetectInput): RobotAnomaly[] {
  const out: RobotAnomaly[] = [];
  const traj = detectTrajectoryDeviation(input.robotId, input.snapshots);
  if (traj) out.push(traj);
  const grip = detectGripForceAnomaly(input.robotId, input.snapshots);
  if (grip) out.push(grip);
  const cycle = detectCycleTimeTrend(input.robotId, input.jobs);
  if (cycle) out.push(cycle);
  return out;
}
