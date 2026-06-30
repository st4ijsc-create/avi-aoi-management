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
      timestamp: state.timestamp ?? new Date(),
    });
    // Lightweight liveness update on the registry row.
    const newStatus = state.estop ? "estop" : state.busy ? "busy" : "idle";
    await db.update(robots)
      .set({ status: newStatus, lastSeenAt: new Date() })
      .where(eq(robots.id, robot.id));

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
  } catch (err) {
    console.error(`[Robot] ingest failed for "${robot.code}":`, (err as Error)?.message ?? err);
  }
}
