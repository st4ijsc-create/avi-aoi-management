/**
 * Phase 3 — Robot state ingest: RobotState → robot_telemetry row.
 */
import { getDb } from "../../db/connection";
import { robotTelemetry, robots } from "../../../drizzle/schema";
import { eq } from "drizzle-orm";
import type { RuntimeRobot } from "./robotAdapter";
import type { RobotState } from "./robotDriver";

// S1-b — per-robot last-observed e-stop flag, to record a safety_event only on the
// TRANSITION into e-stop (not on every poll while it stays asserted). In-process,
// best-effort; a process restart simply re-arms (a fresh estop is then logged once).
const lastEstop = new Map<number, boolean>();

export async function ingestRobotState(robot: RuntimeRobot, state: RobotState): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const now = new Date();
  try {
    await db.insert(robotTelemetry).values({
      robotId: robot.id,
      mode: state.mode,
      busy: state.busy,
      estop: state.estop,
      poseJson: state.pose as Record<string, unknown> | undefined,
      payloadKg: state.payloadKg != null ? String(state.payloadKg) : undefined,
      speedPct: state.speedPct,
      errorText: state.error,
      // X1-a (doc 16 §5) — UDM/UEM extension columns. Honest NULL when the producer
      // has no value (jointStates/firmwareVersion are seams; batteryLevel is wired
      // from the VDA5050 battery extraction for AGVs). lastHeartbeat = the moment we
      // observed this snapshot → feeds the X1-b heartbeat TTL stale sweep.
      batteryLevel: state.batteryPct != null ? String(state.batteryPct) : undefined,
      jointStates: state.jointStates,
      safetyZoneId: state.safetyZoneId,
      firmwareVersion: state.firmwareVersion,
      lastHeartbeat: state.timestamp ?? now,
      timestamp: state.timestamp ?? now,
    });
    // Lightweight liveness update on the registry row.
    const newStatus = state.estop ? "estop" : state.busy ? "busy" : "idle";
    await db.update(robots)
      .set({ status: newStatus, lastSeenAt: now })
      .where(eq(robots.id, robot.id));

    // U3-live (doc 21 §6 / G-5) — fire-and-forget LIVE socket emit of the compact UDM
    // to the per-robot room `robot:{id}` so the Robot Cockpit renders live (robot pages
    // were poll/static before). Transport-only (telemetry is NOT a control path), so it
    // is ungated; error-isolated so a socket failure can NEVER break the persist path.
    // No-op when io is not initialized (tests / headless) → FE simply keeps its poll.
    try {
      const { emitRobotTelemetry } = await import("../../_core/socket");
      emitRobotTelemetry({
        robotId: robot.id,
        robotCode: robot.code,
        mode: state.mode ?? null,
        busy: state.busy ?? null,
        estop: state.estop ?? null,
        speedPct: state.speedPct ?? null,
        pose: (state.pose ?? null) as Record<string, unknown> | null,
        jointStates: state.jointStates ?? null,
        batteryPct: state.batteryPct ?? null,
        safetyZoneId: state.safetyZoneId ?? null,
        firmwareVersion: state.firmwareVersion ?? null,
        error: state.error ?? null,
        status: newStatus,
        ts: (state.timestamp ?? now).getTime(),
      });
    } catch (e) {
      console.error(`[Robot] telemetry emit failed for "${robot.code}":`, (e as Error)?.message ?? e);
    }

    // X1-b (doc 16 §5) — record the heartbeat into the field-health ledger so the
    // stale sweep can detect lost connections. Fire-and-forget + self-gated by
    // FIELD_V2_ENABLED (no-op when off) → zero cost on the default path.
    void import("../field/fieldHealthService")
      .then((m) => m.recordHeartbeat({ deviceKey: `robot:${robot.id}`, deviceKind: "robot", robotId: robot.id, at: state.timestamp ?? now }))
      .catch((e) => console.error(`[Robot] heartbeat record failed for "${robot.code}":`, (e as Error)?.message ?? e));

    // G1 (doc 16 Khối 2) — if the robot just hit a failed state (e-stop), hand its
    // open tasks to another device. Fire-and-forget; the rebalancer is itself
    // gated by FLEET_ORCH_ENABLED (no-op when off) and opens NO control path.
    if (state.estop) {
      void import("../fleet/taskAllocator")
        .then((m) => m.rebalanceDeviceTasks(robot.id, "robot_estop"))
        .catch((e) => console.error(`[Robot] rebalance hook failed for "${robot.code}":`, (e as Error)?.message ?? e));
    }

    // S1-b (doc 16 Khối 3) — ADVISORY safety audit on the e-stop TRANSITION only.
    // Fire-and-forget + lazily imported + self-gated by SAFETY_AUDIT_ENABLED → no-op
    // when off. This ONLY LOGS (outcome=logged_only); it does NOT change control
    // behaviour and is NOT a safety-rated stop — the software merely observed it.
    const wasEstop = lastEstop.get(robot.id) ?? false;
    if (state.estop && !wasEstop) {
      void import("../safety/safetyAuditService")
        .then((m) => m.record({
          eventType: "estop",
          robotId: robot.id,
          detectedBy: "telemetry",
          handledBy: "advisory",
          outcome: "logged_only",
          robotState: { mode: state.mode, busy: state.busy, error: state.error ?? null },
          notes: `ADVISORY: e-stop observed via telemetry on "${robot.code}" (software logged only — not a safety-rated stop)`,
        }))
        .catch((e) => console.error(`[Robot] safety-audit hook failed for "${robot.code}":`, (e as Error)?.message ?? e));
    }
    lastEstop.set(robot.id, !!state.estop);

    // I2-a (doc 16 Khối 4) — ADVISORY robot-behaviour anomaly scan (trajectory /
    // grip-force / cycle-time drift). Fire-and-forget + lazily imported + self-gated
    // by AI_ROBOT_ANOMALY_ENABLED (no-op when off) → zero cost on the default path.
    // Opens NO control path: it raises a smart alert + writes an advisory ledger row,
    // NEVER a robot command.
    void import("../ai/robotBehaviorAnomalyService")
      .then((m) => m.detectAndRaiseForRobot(robot.id))
      .catch((e) => console.error(`[Robot] anomaly-scan hook failed for "${robot.code}":`, (e as Error)?.message ?? e));
  } catch (err) {
    console.error(`[Robot] ingest failed for "${robot.code}":`, (err as Error)?.message ?? err);
  }
}
