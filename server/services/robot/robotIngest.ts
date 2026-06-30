/**
 * Phase 3 — Robot state ingest: RobotState → robot_telemetry row.
 */
import { getDb } from "../../db/connection";
import { robotTelemetry, robots } from "../../../drizzle/schema";
import { eq } from "drizzle-orm";
import type { RuntimeRobot } from "./robotAdapter";
import type { RobotState } from "./robotDriver";

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
  } catch (err) {
    console.error(`[Robot] ingest failed for "${robot.code}":`, (err as Error)?.message ?? err);
  }
}
