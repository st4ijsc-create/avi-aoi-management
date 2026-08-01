/**
 * I2-a — Robot-behaviour anomaly detector tests (pure, in-memory, no DB/net).
 * Covers: trajectory/grip/cycle-time detectors fire on injected drift + no-op on
 * stable data; honest null-skip when a signal is absent; flag helper reads env.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  detect,
  detectTrajectoryDeviation,
  detectGripForceAnomaly,
  detectCycleTimeTrend,
  isRobotAnomalyEnabled,
  type TelemetrySnapshot,
  type JobDuration,
} from "./robotBehaviorAnomaly";

const T0 = 1_700_000_000_000;

/** Stable joint series: constant + tiny noise → no anomaly. */
function stableSnapshots(n = 40): TelemetrySnapshot[] {
  return Array.from({ length: n }, (_, i) => ({
    timestamp: T0 + i * 1000,
    jointPositions: [10 + Math.sin(i) * 0.01, 20 + Math.cos(i) * 0.01],
  }));
}

describe("detectTrajectoryDeviation", () => {
  it("fires on a joint that jumps far off the rolling baseline", () => {
    const snaps = stableSnapshots(40);
    // Inject a large spike on joint 0 near the end.
    snaps[35].jointPositions = [10 + 50, 20];
    const anomaly = detectTrajectoryDeviation(1, snaps, 3.0);
    expect(anomaly).not.toBeNull();
    expect(anomaly!.kind).toBe("trajectory_deviation");
    expect(anomaly!.score).toBeGreaterThan(3.0);
    expect(anomaly!.confidence).toBeGreaterThan(0.5);
    expect(anomaly!.evidence.signal).toBe("joint_positions");
  });

  it("no-ops on stable joint data", () => {
    expect(detectTrajectoryDeviation(1, stableSnapshots(40), 3.0)).toBeNull();
  });

  it("honest-skip when there is no trajectory signal (no joints, no cartesian)", () => {
    const snaps: TelemetrySnapshot[] = Array.from({ length: 20 }, (_, i) => ({ timestamp: T0 + i * 1000 }));
    expect(detectTrajectoryDeviation(1, snaps, 3.0)).toBeNull();
  });

  it("falls back to cartesian when joints are absent", () => {
    const snaps: TelemetrySnapshot[] = Array.from({ length: 30 }, (_, i) => ({
      timestamp: T0 + i * 1000,
      cartesian: { x: 100 + Math.sin(i) * 0.01, y: 0, z: 0 },
    }));
    snaps[25].cartesian = { x: 100 + 40, y: 0, z: 0 };
    const anomaly = detectTrajectoryDeviation(1, snaps, 3.0);
    expect(anomaly).not.toBeNull();
    expect(anomaly!.evidence.signal).toBe("cartesian");
  });
});

describe("detectGripForceAnomaly", () => {
  it("fires on an abnormal force spike", () => {
    const snaps: TelemetrySnapshot[] = Array.from({ length: 30 }, (_, i) => ({
      timestamp: T0 + i * 1000,
      gripForce: 20 + Math.sin(i) * 0.05,
    }));
    snaps[25].gripForce = 120;
    const anomaly = detectGripForceAnomaly(1, snaps, 3.0);
    expect(anomaly).not.toBeNull();
    expect(anomaly!.kind).toBe("grip_force");
    expect(anomaly!.evidence.observedForce).toBe(120);
  });

  it("honest null-skip when there is no / too little force telemetry", () => {
    // Only 3 readings carry a force value (< 8 min).
    const snaps: TelemetrySnapshot[] = Array.from({ length: 30 }, (_, i) => ({
      timestamp: T0 + i * 1000,
      jointPositions: [1, 2],
      ...(i < 3 ? { gripForce: 10 } : {}),
    }));
    expect(detectGripForceAnomaly(1, snaps, 3.0)).toBeNull();
  });
});

describe("detectCycleTimeTrend", () => {
  it("fires on a rising cycle-time step change", () => {
    const jobs: JobDuration[] = [];
    for (let i = 0; i < 20; i++) jobs.push({ timestamp: T0 + i * 60_000, durationMs: 5000 + (Math.random() - 0.5) * 50 });
    // Step change: durations jump for the last 15 jobs.
    for (let i = 0; i < 15; i++) jobs.push({ timestamp: T0 + (20 + i) * 60_000, durationMs: 9000 + (Math.random() - 0.5) * 50 });
    const anomaly = detectCycleTimeTrend(1, jobs, 4.0);
    expect(anomaly).not.toBeNull();
    expect(anomaly!.kind).toBe("cycle_time_trend");
    expect(anomaly!.evidence.direction).toBe("increase");
    expect(Number(anomaly!.evidence.meanAfterMs)).toBeGreaterThan(Number(anomaly!.evidence.meanBeforeMs));
  });

  it("no-ops on stable cycle times", () => {
    const jobs: JobDuration[] = Array.from({ length: 30 }, (_, i) => ({
      timestamp: T0 + i * 60_000,
      durationMs: 5000 + Math.sin(i) * 5,
    }));
    expect(detectCycleTimeTrend(1, jobs, 4.0)).toBeNull();
  });

  it("no-ops with too few jobs", () => {
    expect(detectCycleTimeTrend(1, [{ timestamp: T0, durationMs: 5000 }], 4.0)).toBeNull();
  });
});

describe("detect (unified) + flag", () => {
  it("returns [] for a fully stable robot", () => {
    const jobs: JobDuration[] = Array.from({ length: 20 }, (_, i) => ({ timestamp: T0 + i * 60_000, durationMs: 5000 }));
    expect(detect({ robotId: 7, snapshots: stableSnapshots(40), jobs })).toEqual([]);
  });

  it("collects multiple anomalies when several signals drift", () => {
    const snaps = stableSnapshots(40);
    snaps[35].jointPositions = [60, 20];
    for (let i = 8; i < 40; i++) snaps[i].gripForce = 20;
    snaps[36].gripForce = 200;
    const jobs: JobDuration[] = [];
    for (let i = 0; i < 15; i++) jobs.push({ timestamp: T0 + i * 60_000, durationMs: 5000 });
    for (let i = 0; i < 15; i++) jobs.push({ timestamp: T0 + (15 + i) * 60_000, durationMs: 10000 });
    const found = detect({ robotId: 7, snapshots: snaps, jobs });
    const kinds = found.map((a) => a.kind).sort();
    expect(kinds).toContain("trajectory_deviation");
    expect(kinds).toContain("cycle_time_trend");
  });

  const prev = process.env.AI_ROBOT_ANOMALY_ENABLED;
  afterEach(() => { process.env.AI_ROBOT_ANOMALY_ENABLED = prev; });

  it("flag helper reflects env", () => {
    process.env.AI_ROBOT_ANOMALY_ENABLED = "false";
    expect(isRobotAnomalyEnabled()).toBe(false);
    process.env.AI_ROBOT_ANOMALY_ENABLED = "true";
    expect(isRobotAnomalyEnabled()).toBe(true);
  });
});
