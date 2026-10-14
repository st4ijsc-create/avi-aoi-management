/**
 * Phase 3 — Robot manager: start/stop lifecycle (mirrors otManager).
 *
 * No-op unless ROBOT_GATEWAY_ENABLED=true. On start: load enabled robots, then
 * per-robot try/catch connect + subscribeState(ingest). A vendor scaffold whose
 * connect throws is logged "skipped" and never crashes the process.
 */
import { endSessionQuiescing, sessionQuiescing } from "./robotQuiesce"; // doc 81 Đợt 12 N fix 1 (R-12-d)
import type { MotionLock, RobotState, RobotStateHandle } from "./robotDriver";
import type { RuntimeRobot, RobotLoadScope } from "./robotAdapter";

let running = false;
let orphanSweepScheduled = false;
const active: Array<{ robot: RuntimeRobot; handle: RobotStateHandle }> = [];
/**
 * doc 81 Đợt 10 task D fix review 3 (scan #73) — bumped by stopRobots / by every detachRobot(id): a start / attach whose connect
 * was in flight across a stop or a detach (moved to an edge node) closes its session instead of registering it.
 */
let robotEpoch = 0;
const detachGen = new Map<number, number>();
const detachToken = (robotId: number): number => detachGen.get(robotId) ?? 0;

/**
 * doc 81 Đợt 10 task D fix review 5 (R-10-bc) — the robot → factory map held in MEMORY (factory id; null = the robot has no
 * factory): what a STOP's scope check falls back on when the database does not answer. Filled best-effort (bounded, never
 * blocking) when central starts / attaches robots, and by every STOP-route DB read.
 */
const robotFactory = new Map<number, number | null>();
export function robotFactoryIdInMemory(robotId: number): number | null | undefined {
  return robotFactory.has(robotId) ? robotFactory.get(robotId)! : undefined;
}
export function noteRobotFactory(robotId: number, factoryId: number | null): void {
  robotFactory.set(robotId, factoryId);
}
async function refreshRobotFactories(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    const [{ getDb }, { sql }, { withDeadline }] = await Promise.all([import("../../db/connection"), import("drizzle-orm"), import("../ot/drivers/boundedClose")]);
    const db = await getDb();
    if (!db) return;
    const res = (await withDeadline(
      db.execute(sql`SELECT r.id, w."factoryId" AS f FROM public.robots r
          LEFT JOIN public.stations s ON s.id = r."stationId"
          LEFT JOIN public.production_lines l ON l.id = COALESCE(s."lineId", r."lineId")
          LEFT JOIN public.workshops w ON w.id = l."workshopId"
         WHERE r.id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`),
      5_000,
      "robot factory map",
    )) as unknown;
    const rows = (Array.isArray(res) ? res : ((res as { rows?: unknown[] })?.rows ?? [])) as Array<{ id: number; f: number | null }>;
    for (const r of rows) robotFactory.set(Number(r.id), r.f == null ? null : Number(r.f));
  } catch (err) {
    console.warn(`[Robot] robot → factory map not refreshed (${(err as Error)?.message ?? err}) — a STOP's scope falls back to "unknown"`);
  }
}

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
  // fix review 4 (NF-4) — a stopRobots() overtaking this start (any await below) wins: nothing registered, never marked running
  const ep = robotEpoch;
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

  // fix review 2 (R-10-al) — the central gateway is ON from here, whatever the load gives (0 central robots at cutover, a
  // failed load): a robot moved to central later is attached live (attachRobot) without a restart.
  if (!opts.scope && ep === robotEpoch) centralGatewayOn = true;
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
  if (!opts.scope) for (const r of robots) triedAtStart.add(r.id); // R-10-al — the reconcile's first pass skips these
  const lockable = robots.filter((r) => typeof r.driver.motionLockController === "function");
  const savedLocks = await loadMotionLocks(lockable.map((r) => r.id));
  for (const robot of robots) {
    const motionLock = robot.driver.motionLockController?.();
    if (motionLock) attachMotionLockPersistence(robot.id, motionLock, savedLocks);
    const tok = detachToken(robot.id);
    try {
      await robot.driver.connect(robot.connection);
      const handle = await robot.driver.subscribeState(
        opts.ingest === false ? () => undefined : (state) => ingestRobotState(robot, state),
        robot.pollIntervalMs,
      );
      if (ep !== robotEpoch || detachToken(robot.id) !== tok) {
        // scan #73 — stopped / moved to an edge node while connecting: never registered
        await Promise.resolve().then(() => handle.close()).catch(() => undefined);
        await Promise.resolve().then(() => robot.driver.disconnect()).catch(() => undefined);
        console.log(`[Robot] "${robot.code}" not started — stopped or detached while connecting`);
        continue;
      }
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

  if (ep !== robotEpoch) return false; // NF-4 — stopped meanwhile
  if (!opts.scope) void refreshRobotFactories(robots.map((r) => r.id)); // R-10-bc — the STOP scope's memory fallback
  running = true;
  console.log(`[Robot] started — ${active.length}/${robots.length} robot(s) active${opts.ingest === false ? " (edge: state NOT ingested here — central is the ingest owner)" : ""}`);
  return true;
}

/**
 * doc 81 Đợt 10 task D — EDGE v2 start: config-sourced robots, journal-backed lock, state sink. Touches no DB.
 * fix review 4 (R-10-au, for E) — every robot is started by the SAME per-robot step as attachEdgeRobot, all at once and each under
 * its own connect bound (EDGE_ROBOT_CONNECT_DEADLINE_MS): a robot that never connects never delays or disturbs the others.
 * The options (sink, lock persistence) are kept for attachEdgeRobot. A stopRobots() overtaking this start wins (NF-4).
 */
async function startConfigRobots(opts: StartRobotsOptions): Promise<boolean> {
  if (!flagEnabled()) {
    console.log("[Robot] disabled (set ROBOT_GATEWAY_ENABLED=true to enable)");
    return false;
  }
  const ep = robotEpoch;
  edgeStartOpts = { stateSink: opts.stateSink, attachLock: opts.attachLock };
  const robots = opts.configRobots ?? [];
  if (robots.length === 0) {
    console.log("[Robot] the signed config names no enabled robot for this node — nothing to start");
    return false;
  }
  const started = await Promise.all(robots.map((robot) => startOneEdgeRobot(robot, ep)));
  if (ep !== robotEpoch) return false; // NF-4 — stopped meanwhile: never marked running
  for (const s of started) if (s) active.push(s);
  running = true;
  console.log(`[Robot] started — ${active.length}/${robots.length} owned robot(s) active (edge: state → journal, lock authority = this node)`);
  return true;
}

/** R-10-au — the bound of ONE edge robot's connect + state subscription (the robot is skipped, the others are not affected). */
export const EDGE_ROBOT_CONNECT_DEADLINE_MS = 15_000;
let edgeConnectDeadlineMs = EDGE_ROBOT_CONNECT_DEADLINE_MS;
/** Test seam. */
export function _setEdgeRobotConnectDeadlineMsForTests(ms: number | null): void {
  edgeConnectDeadlineMs = ms ?? EDGE_ROBOT_CONNECT_DEADLINE_MS;
}
/** the options of the edge start (sink, lock persistence) — attachEdgeRobot uses the same */
let edgeStartOpts: Pick<StartRobotsOptions, "stateSink" | "attachLock"> | null = null;

/** ONE edge robot: lock seed / persistence FIRST, then connect + subscribe, bounded. Returns the session, or null (skipped). */
async function startOneEdgeRobot(robot: RuntimeRobot, ep: number, given?: Pick<StartRobotsOptions, "stateSink" | "attachLock">): Promise<{ robot: RuntimeRobot; handle: RobotStateHandle } | null> {
  const opts = given ?? edgeStartOpts ?? {};
  const { MOTION_LOCK_PERSIST_UNKNOWN_REASON_CODE } = await import("./robotDriver");
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
  const tok = detachToken(robot.id);
  const sink = opts.stateSink;
  let handle: RobotStateHandle | null = null;
  const work = (async () => {
    await robot.driver.connect(robot.connection);
    handle = await robot.driver.subscribeState(
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
    return handle;
  })();
  const { withDeadline } = await import("../ot/drivers/boundedClose");
  try {
    const h = await withDeadline(work, edgeConnectDeadlineMs, `robot "${robot.code}" edge connect`);
    if (ep !== robotEpoch || detachToken(robot.id) !== tok) {
      // stopped / detached while connecting: never registered (scan #73)
      await Promise.resolve().then(() => h.close()).catch(() => undefined);
      await Promise.resolve().then(() => robot.driver.disconnect()).catch(() => undefined);
      return null;
    }
    console.log(`[Robot] "${robot.code}" (${robot.vendor}) started (edge, owned)`);
    return { robot, handle: h };
  } catch (err) {
    console.warn(`[Robot] "${robot.code}" (${robot.vendor}) skipped: ${(err as Error)?.message ?? err}`);
    // a late connect (past the bound) is torn down when it lands; the driver is disconnected now
    // fix review 5 (NF4-4) — a connect that lands AFTER the bound: close its state handle AND disconnect the driver (no leaked slot)
    void work.then(
      async (late) => {
        await Promise.resolve().then(() => late.close()).catch(() => undefined);
        await Promise.resolve().then(() => robot.driver.disconnect()).catch(() => undefined);
      },
      () => void Promise.resolve().then(() => robot.driver.disconnect()).catch(() => undefined),
    );
    await withDeadline(Promise.resolve().then(() => robot.driver.disconnect()), 5_000, `robot "${robot.code}" disconnect`).catch(() => undefined);
    return null;
  }
}

/**
 * doc 81 Đợt 10 task D fix reviews 4 — rulings R-10-au / R-10-az (the contract E codes against). The EDGE's per-robot lifecycle,
 * never a whole-gateway restart.
 *
 * attachEdgeRobot(row, extras?) — `row` is the VERIFIED config row exactly as E receives it (EdgeRobotConfigRow ⊆ edgeProtocol's
 * edgeConfigRobotSchema). robotManager builds the driver + RuntimeRobot from it (robotAdapter.runtimeRobotsFromConfig). The motion
 * lock is seeded + persisted FIRST through `extras.attachLock` (E: from the journal, else the config's motionLock — R-10-x), else the
 * one given to the edge start; with neither the robot starts LOCKED `persistUnknown` (fail-closed): it starts locked unless a clear
 * is known. Connect + subscribe are bounded (EDGE_ROBOT_CONNECT_DEADLINE_MS). A robot that does not connect BACKS OFF: a new attach
 * of it inside its back-off window answers { ok:false, reason:"backoff" } without touching the device (2 s, 4 s … ≤ 60 s); no
 * other robot is ever delayed or touched. Never throws.
 *
 * detachEdgeRobot(robotId) — REFUSED { ok:false, reason:"not_locked" } unless the robot's motion lock is held (E calls it only after
 * a successful STOP, then locks): nothing can be dispatched to it between the STOP and the detach. A driver with no motion lock
 * cannot be proven locked ⇒ refused too. Never throws.
 */
export interface EdgeRobotConfigRow {
  id: number;
  code: string;
  vendor: string;
  endpoint: string;
  connectionOptions: Record<string, unknown> | null;
  pollIntervalMs: number;
  isEnabled: boolean;
  [k: string]: unknown;
}
export type EdgeRobotAttachExtras = Pick<StartRobotsOptions, "stateSink" | "attachLock">;
export type EdgeAttachReason = "gateway_disabled" | "not_edge" | "already_active" | "in_progress" | "not_buildable" | "backoff" | "connect_failed" | "stopped" | "error";
export type EdgeAttachResult = { ok: boolean; reason?: EdgeAttachReason; detail?: string };
export type EdgeDetachReason = "not_edge" | "not_active" | "not_locked" | "error";
export type EdgeDetachResult = { ok: boolean; reason?: EdgeDetachReason; detail?: string };

export const EDGE_ROBOT_BACKOFF_BASE_MS = 2_000;
export const EDGE_ROBOT_BACKOFF_MAX_MS = 60_000;
let backoffBaseMs = EDGE_ROBOT_BACKOFF_BASE_MS;
/** Test seam. */
export function _setEdgeRobotBackoffBaseMsForTests(ms: number | null): void {
  backoffBaseMs = ms ?? EDGE_ROBOT_BACKOFF_BASE_MS;
}
const edgeBackoff = new Map<number, { failures: number; until: number }>();

export async function attachEdgeRobot(row: EdgeRobotConfigRow, extras?: EdgeRobotAttachExtras): Promise<EdgeAttachResult> {
  try {
    const id = Number(row?.id);
    if (!flagEnabled()) return { ok: false, reason: "gateway_disabled" };
    const opts = extras ?? edgeStartOpts;
    if (!opts) return { ok: false, reason: "not_edge" };
    if (active.some((a) => a.robot.id === id)) return { ok: false, reason: "already_active" };
    if (attaching.has(id)) return { ok: false, reason: "in_progress" };
    const bo = edgeBackoff.get(id);
    if (bo && Date.now() < bo.until) return { ok: false, reason: "backoff", detail: `retry after ${new Date(bo.until).toISOString()}` };
    attaching.add(id);
    try {
      await import("./index"); // the robot drivers are registered (side effect), as E's start does
      const { runtimeRobotsFromConfig } = await import("./robotAdapter");
      const [robot] = runtimeRobotsFromConfig([row as never]);
      if (!robot) return { ok: false, reason: "not_buildable", detail: "disabled, or no driver for its vendor" };
      const ep = robotEpoch;
      const s = await startOneEdgeRobot(robot, ep, opts);
      if (!s) {
        if (ep !== robotEpoch) return { ok: false, reason: "stopped" };
        const failures = (bo?.failures ?? 0) + 1;
        edgeBackoff.set(id, { failures, until: Date.now() + Math.min(EDGE_ROBOT_BACKOFF_MAX_MS, backoffBaseMs * 2 ** (failures - 1)) });
        return { ok: false, reason: "connect_failed" };
      }
      if (active.some((a) => a.robot.id === id) || ep !== robotEpoch) {
        await Promise.resolve().then(() => s.handle.close()).catch(() => undefined);
        await Promise.resolve().then(() => robot.driver.disconnect()).catch(() => undefined);
        return { ok: false, reason: ep !== robotEpoch ? "stopped" : "already_active" };
      }
      edgeBackoff.delete(id);
      active.push(s);
      running = true;
      return { ok: true };
    } finally {
      attaching.delete(id);
    }
  } catch (err) {
    console.warn(`[Robot] edge attach of robot ${String(row?.id)} failed: ${(err as Error)?.message ?? err}`);
    return { ok: false, reason: "error", detail: String((err as Error)?.message ?? err).slice(0, 200) };
  }
}

/** doc 81 Đợt 12 N fix 1 (R-12-d) — the quiescing state of robot `robotId`'s live session (robotQuiesce.ts), or null. */
export function robotQuiescing(robotId: number): { since: string; why: string } | null {
  return sessionQuiescing(active.find((a) => a.robot.id === robotId)?.robot.driver);
}

export async function detachEdgeRobot(robotId: number): Promise<EdgeDetachResult> {
  try {
    if (!edgeStartOpts && !active.some((a) => a.robot.id === robotId)) return { ok: false, reason: "not_edge" };
    const entry = active.find((a) => a.robot.id === robotId);
    if (!entry) return { ok: false, reason: "not_active" };
    const lock = entry.robot.driver.motionLockController?.();
    if (!lock || !lock.isLocked()) return { ok: false, reason: "not_locked" };
    await detachRobot(robotId);
    edgeBackoff.delete(robotId);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: "error", detail: String((err as Error)?.message ?? err).slice(0, 200) };
  }
}

export async function stopRobots(): Promise<void> {
  // scan #73 — the gateway is OFF: no reconcile / NOTIFY attach re-starts a session; an in-flight start / attach closes its own
  robotEpoch += 1;
  centralGatewayOn = false;
  triedAtStart.clear();
  edgeStartOpts = null; // R-10-au — no edge attach after a stop
  edgeBackoff.clear();
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
  detachGen.set(robotId, detachToken(robotId) + 1); // scan #73 — an in-flight start / attach of it never registers
  const i = active.findIndex((a) => a.robot.id === robotId);
  if (i < 0) return false;
  const [entry] = active.splice(i, 1);
  endSessionQuiescing(entry.robot.driver); // R-12-d — the session is gone: its quiescing state with it
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
/** R-10-al — set by central's startRobots() as soon as the gateway flag is on (independent of what it loaded). */
let centralGatewayOn = false;
/** R-10-al — the robots central's startRobots() loaded (tried to connect) — a first reconcile pass does not retry them. */
const triedAtStart = new Set<number>();
export function robotTriedAtStart(robotId: number): boolean {
  return triedAtStart.has(robotId);
}
export function isCentralRobotGatewayOn(): boolean {
  return centralGatewayOn || running;
}
/** N5 — one attach per robot at a time (in-process change + this process's own NOTIFY race) */
const attaching = new Set<number>();

export async function attachRobot(robotId: number): Promise<boolean> {
  if (!isCentralRobotGatewayOn() || !flagEnabled() || active.some((a) => a.robot.id === robotId) || attaching.has(robotId)) return false;
  attaching.add(robotId);
  const tok = detachToken(robotId);
  const ep = robotEpoch;
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
    if (active.some((a) => a.robot.id === robotId) || detachToken(robotId) !== tok || ep !== robotEpoch) {
      // N5 — the loser of a race closes AND disconnects (no leaked session); scan #73 — so does an attach overtaken by a
      // detach (moved to an edge node meanwhile) or by stopRobots
      await handle.close().catch(() => undefined);
      await robot.driver.disconnect().catch(() => undefined);
      return false;
    }
    active.push({ robot, handle });
    running = true;
    void refreshRobotFactories([robot.id]); // R-10-bc
    console.log(`[Robot] "${robot.code}" attached — central owns it now`);
    return true;
  } catch (err) {
    console.warn(`[Robot] robot ${robotId} attach failed: ${(err as Error)?.message ?? err}`);
    return false;
  } finally {
    attaching.delete(robotId);
  }
}

/** The ids of the robots central holds a session for (reconcile). */
export function activeRobotIds(): number[] {
  return active.map((a) => a.robot.id);
}
