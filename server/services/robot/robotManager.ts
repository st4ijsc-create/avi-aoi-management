/**
 * Phase 3 — Robot manager: start/stop lifecycle (mirrors otManager).
 *
 * No-op unless ROBOT_GATEWAY_ENABLED=true. On start: load enabled robots, then
 * per-robot try/catch connect + subscribeState(ingest). A vendor scaffold whose
 * connect throws is logged "skipped" and never crashes the process.
 */
import type { RobotStateHandle } from "./robotDriver";
import type { RuntimeRobot } from "./robotAdapter";

let running = false;
const active: Array<{ robot: RuntimeRobot; handle: RobotStateHandle }> = [];

function flagEnabled(): boolean {
  return process.env.ROBOT_GATEWAY_ENABLED === "true";
}

export async function startRobots(): Promise<boolean> {
  if (running) return true;
  if (!flagEnabled()) {
    console.log("[Robot] disabled (set ROBOT_GATEWAY_ENABLED=true to enable)");
    return false;
  }

  const { loadEnabledRobots } = await import("./robotAdapter");
  const { ingestRobotState } = await import("./robotIngest");

  let robots: RuntimeRobot[] = [];
  try {
    robots = await loadEnabledRobots();
  } catch (err) {
    console.error("[Robot] loadEnabledRobots failed:", (err as Error)?.message ?? err);
    return false;
  }
  if (robots.length === 0) {
    console.log("[Robot] no enabled robots — nothing to start");
    return false;
  }

  for (const robot of robots) {
    try {
      await robot.driver.connect(robot.connection);
      const handle = await robot.driver.subscribeState(
        (state) => ingestRobotState(robot, state),
        robot.pollIntervalMs,
      );
      active.push({ robot, handle });
      console.log(`[Robot] "${robot.code}" (${robot.vendor}) started`);
    } catch (err) {
      console.warn(`[Robot] "${robot.code}" (${robot.vendor}) skipped: ${(err as Error)?.message ?? err}`);
      try {
        await robot.driver.disconnect();
      } catch {
        /* ignore */
      }
    }
  }

  running = true;
  console.log(`[Robot] started — ${active.length}/${robots.length} robot(s) active`);
  return true;
}

export async function stopRobots(): Promise<void> {
  while (active.length > 0) {
    const entry = active.pop()!;
    try {
      await entry.handle.close();
    } catch {
      /* ignore */
    }
    try {
      await entry.robot.driver.disconnect();
    } catch {
      /* ignore */
    }
  }
  running = false;
}

/** Read-only accessor for the dispatcher (does not mutate lifecycle). */
export function getActiveRobot(robotId: number): RuntimeRobot | undefined {
  return active.find((a) => a.robot.id === robotId)?.robot;
}
