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
    await db.update(robots)
      .set({ status: state.estop ? "estop" : state.busy ? "busy" : "idle", lastSeenAt: new Date() })
      .where(eq(robots.id, robot.id));
  } catch (err) {
    console.error(`[Robot] ingest failed for "${robot.code}":`, (err as Error)?.message ?? err);
  }
}
