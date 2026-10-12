/**
 * Phase 3 — Robot manager: start/stop lifecycle (mirrors otManager).
 *
 * No-op unless ROBOT_GATEWAY_ENABLED=true. On start: load enabled robots, then
 * per-robot try/catch connect + subscribeState(ingest). A vendor scaffold whose
 * connect throws is logged "skipped" and never crashes the process.
 */
import type { MotionLock, RobotState, RobotStateHandle } from "./robotDriver";
import type { RuntimeRobot, RobotLoadScope } from "./robotAdapter";

let running = false;
let orphanSweepScheduled = false;
const active: Array<{ robot: RuntimeRobot; handle: RobotStateHandle }> = [];

function flagEnabled(): boolean {
  return process.env.ROBOT_GATEWAY_ENABLED === "true";
}

/**
 * doc 81 Đợt 9 final wave F1 (final review I1) — how an EDGE gateway starts its robots:
 *   • `scope` — only the robots of its node (its line codes / factory — robotAdapter.loadEnabledRobots), never every enabled
 *     robot of the control plane; no line codes ⇒ none;
 *   • `ingest: false` — ONE ingest owner per robot: central ingests robot state (robot_telemetry, the trusted e-stop
 *     safety_events, registry status); the edge connects its drivers for its own dispatchers and polls state only to keep the
 *     driver's link supervision (motion lock on a peer drop) — it records nothing, so an e-stop is never ingested twice.
 * Central calls startRobots() with no options (unchanged).
 */
export interface StartRobotsOptions {
  scope?: RobotLoadScope;
  ingest?: boolean;
  /**
   * doc 81 Đợt 10 task D (design §2.11 / §2.12) — EDGE v2 (no DB): the node's OWNED robots from the SIGNED config snapshot
   * (robotAdapter.runtimeRobotsFromConfig). Given ⇒ no DB anywhere in this start: no robot_jobs reconciliation (central owns
   * the ledger), no DB robot load, no DB motion-lock load / persistence.
   */
  configRobots?: RuntimeRobot[];
  /** EDGE v2 — where each robot state goes (the journal's robot_state stream → central ingest) instead of `ingest`. */
  stateSink?: (robot: RuntimeRobot, state: RobotState) => void;
  /**
   * EDGE v2 — the motion lock's seed + journal-sink persistence (robotMotionLockStore.attachEdgeMotionLockPersistence; N2).
   * REQUIRED with configRobots: without it every lockable robot starts LOCKED `persistUnknown` (fail-closed).
   */
  attachLock?: (robot: RuntimeRobot, lock: MotionLock) => void;
}

export async function startRobots(opts: StartRobotsOptions = {}): Promise<boolean> {
  if (running) return true;
  if (opts.configRobots) return startConfigRobots(opts);
  // doc 81 Đợt 1B Task 5 fix round 1 (M1) — reconcile robot_jobs rows a previous process left
  // 'running' (died between the pre-motion row and its finalize). Runs even when the gateway
  // is off: a stale row would otherwise block its idempotency key forever. Never throws.
  // Fix round 2 — a crash + restart within the threshold leaves the row younger than the
  // threshold at boot, so ONE more pass runs once the threshold has elapsed (unref'd timer:
  // never keeps the process alive). Scheduled once per process.
  const { reconcileOrphanedRobotJobs, orphanedRunningThresholdMs } = await import("./robotCommandDispatcher");
  await reconcileOrphanedRobotJobs();
  if (!orphanSweepScheduled) {
    orphanSweepScheduled = true;
    const t = setTimeout(() => void reconcileOrphanedRobotJobs(), orphanedRunningThresholdMs());
    if (typeof t.unref === "function") t.unref();
  }
  if (!flagEnabled()) {
    console.log("[Robot] disabled (set ROBOT_GATEWAY_ENABLED=true to enable)");
    return false;
  }

  const { loadEnabledRobots } = await import("./robotAdapter");
  const { ingestRobotState } = await import("./robotIngest");

  let robots: RuntimeRobot[] = [];
  try {
    robots = await loadEnabledRobots(opts.scope);
  } catch (err) {
    console.error("[Robot] loadEnabledRobots failed:", (err as Error)?.message ?? err);
    return false;
  }
  if (robots.length === 0) {
    console.log(opts.scope ? `[Robot] no enabled robot on this node's lines (${opts.scope.lineCodes.join(", ") || "none configured"}) — nothing to start` : "[Robot] no enabled robots — nothing to start");
    return false;
  }

  const { attachMotionLockPersistence, loadMotionLocks } = await import("./robotMotionLockStore");
  // doc 81 Đợt 4 Task B4 (QĐ-4c) — BEFORE any driver can move anything: robots locked before the restart start locked
  // (persisted rows restored); unreadable ⇒ locked `persistUnknown` (fail-closed). Fix round 1: ONE query, ONE deadline.
  const lockable = robots.filter((r) => typeof r.driver.motionLockController === "function");
  const savedLocks = await loadMotionLocks(lockable.map((r) => r.id));
  for (const robot of robots) {
    const motionLock = robot.driver.motionLockController?.();
    if (motionLock) attachMotionLockPersistence(robot.id, motionLock, savedLocks);
    try {
      await robot.driver.connect(robot.connection);
      const handle = await robot.driver.subscribeState(
        opts.ingest === false ? () => undefined : (state) => ingestRobotState(robot, state),
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
  console.log(`[Robot] started — ${active.length}/${robots.length} robot(s) active${opts.ingest === false ? " (edge: state NOT ingested here — central is the ingest owner)" : ""}`);
  return true;
}

/** doc 81 Đợt 10 task D — EDGE v2 start: config-sourced robots, journal-backed lock, state sink. Touches no DB. */
async function startConfigRobots(opts: StartRobotsOptions): Promise<boolean> {
  if (!flagEnabled()) {
    console.log("[Robot] disabled (set ROBOT_GATEWAY_ENABLED=true to enable)");
    return false;
  }
  const robots = opts.configRobots ?? [];
  if (robots.length === 0) {
    console.log("[Robot] the signed config names no enabled robot for this node — nothing to start");
    return false;
  }
  const { MOTION_LOCK_PERSIST_UNKNOWN_REASON_CODE } = await import("./robotDriver");
  for (const robot of robots) {
    // BEFORE any driver can move anything: the seed / persistence of the authority's lock (fail-closed without it).
    const motionLock = robot.driver.motionLockController?.();
    if (motionLock) {
      let why: string | null = "no edge motion-lock persistence supplied";
      try {
        if (opts.attachLock) {
          opts.attachLock(robot, motionLock);
          why = null;
        }
      } catch (err) {
        why = String((err as Error)?.message ?? err);
      }
      if (why !== null) {
        console.error(`[Robot] "${robot.code}": edge motion lock not attached — starting LOCKED ${MOTION_LOCK_PERSIST_UNKNOWN_REASON_CODE} (fail-closed): ${why}`);
        motionLock.lock(MOTION_LOCK_PERSIST_UNKNOWN_REASON_CODE, "edge motion-lock persistence unavailable at start");
      }
    }
    try {
      await robot.driver.connect(robot.connection);
      const sink = opts.stateSink;
      const handle = await robot.driver.subscribeState(
        sink
          ? (state) => {
              try {
                sink(robot, state);
              } catch (err) {
                console.error(`[Robot] "${robot.code}": state sink failed:`, (err as Error)?.message ?? err);
              }
            }
          : () => undefined,
        robot.pollIntervalMs,
      );
      active.push({ robot, handle });
      console.log(`[Robot] "${robot.code}" (${robot.vendor}) started (edge, owned)`);
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
  console.log(`[Robot] started — ${active.length}/${robots.length} owned robot(s) active (edge: state → journal, lock authority = this node)`);
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

// ── doc 81 Đợt 10 task D fix review 1 (R-10-v) — ownership applied LIVE, one robot at a time ────────────────────────────

/** Is the robot gateway running in this process (startRobots done)? */
export function isRobotGatewayRunning(): boolean {
  return running;
}

/**
 * Stop central's session of ONE robot now (it moved to an edge node): its state subscription (polling + ingest) closes and the
 * driver disconnects, bounded. The motion lock leaves with the session (the edge is the authority now). true ⇔ it was active.
 */
export async function detachRobot(robotId: number): Promise<boolean> {
  const i = active.findIndex((a) => a.robot.id === robotId);
  if (i < 0) return false;
  const [entry] = active.splice(i, 1);
  const { withDeadline } = await import("../ot/drivers/boundedClose");
  await withDeadline(Promise.resolve().then(() => entry.handle.close()), 5_000, `robot ${robotId} state close`).catch(() => undefined);
  await withDeadline(Promise.resolve().then(() => entry.robot.driver.disconnect()), 5_000, `robot ${robotId} disconnect`).catch(() => undefined);
  console.log(`[Robot] "${entry.robot.code}" detached — owned by an edge node now (no polling / ingest / motion here)`);
  return true;
}

/**
 * Start central's session of ONE robot now (it moved to central): loaded from the DB like startRobots (only if enabled and
 * central-owned), its persisted motion lock loaded FIRST (an ownerChanged relock ⇒ it starts LOCKED), then connect + state
 * subscription with ingest. No-op when the gateway is not running in this process or the robot is already active. Never throws.
 */
export async function attachRobot(robotId: number): Promise<boolean> {
  if (!running || !flagEnabled() || active.some((a) => a.robot.id === robotId)) return false;
  try {
    const { loadEnabledRobots } = await import("./robotAdapter");
    const robot = (await loadEnabledRobots()).find((r) => r.id === robotId);
    if (!robot) return false;
    const { attachMotionLockPersistence, loadMotionLocks } = await import("./robotMotionLockStore");
    const lock = robot.driver.motionLockController?.();
    if (lock) attachMotionLockPersistence(robot.id, lock, await loadMotionLocks([robot.id]));
    const { ingestRobotState } = await import("./robotIngest");
    await robot.driver.connect(robot.connection);
    const handle = await robot.driver.subscribeState((state) => ingestRobotState(robot, state), robot.pollIntervalMs);
    if (active.some((a) => a.robot.id === robotId)) {
      await handle.close().catch(() => undefined);
      return false;
    }
    active.push({ robot, handle });
    console.log(`[Robot] "${robot.code}" attached — central owns it now`);
    return true;
  } catch (err) {
    console.warn(`[Robot] robot ${robotId} attach failed: ${(err as Error)?.message ?? err}`);
    return false;
  }
}

/** The ids of the robots central holds a session for (reconcile). */
export function activeRobotIds(): number[] {
  return active.map((a) => a.robot.id);
}
