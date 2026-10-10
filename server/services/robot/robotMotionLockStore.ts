/**
 * doc 81 Đợt 4 Task B4 (QĐ-4c, mig 0364) — PERSISTENCE of a robot's motion lock (`robot_motion_locks`).
 *
 * The in-memory MotionLock (robotDriver.ts, ruling R13) stays the source of truth while the process runs. This store
 * only makes it survive a restart:
 *   • lock()         ⇒ UPSERT the row (fire-and-forget, bounded) — a failed write is LOGGED and never blocks lock();
 *   • clearByStop / clearByOperator ⇒ DELETE the row (fire-and-forget, bounded) — the STOP never waits for the DB;
 *   • registration (robotManager.startRobots, before connect) ⇒ LOAD the row: present ⇒ the driver starts LOCKED
 *     (restore: same cause, time, generation); the read fails / times out ⇒ FAIL-CLOSED: the driver starts locked with
 *     reason `persistUnknown` (cleared like any lock: a confirmed STOP or the audited robot.clearMotionLock).
 * Writes of one robot are applied in order (a per-robot chain). A step that overruns its deadline is NOT cancelled and may
 * still land later, after newer steps — so every write is CONDITIONAL on what it supersedes (fix round 2, ruling R-4-t):
 *   • a clear of a lock with a known generation g deletes only `generation <= g`;
 *   • a clear of a `persistUnknown` lock (boot instant B = its `since`) deletes `generation <= g OR lockedAt < B` (strict);
 *   • the lock upsert replaces only `generation <= g OR lockedAt < B` (B only after a `persistUnknown` boot), so the first
 *     lock after boot always replaces a pre-boot row.
 * A late delete therefore never matches a NEWER lock's row (higher generation, lockedAt ≥ B): a timed-out write can at
 * worst leave a restart LOCKED (fail-closed), never unlocked. There is no unconditional delete.
 */
import { and, eq, inArray, lt, lte, or } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { robotMotionLocks } from "../../../drizzle/schema";
import { withDeadline } from "../ot/drivers/boundedClose";
import { MOTION_LOCK_PERSIST_UNKNOWN_REASON_CODE, type MotionLock, type MotionLockState } from "./robotDriver";

/** Upper bound of ONE motion-lock DB step (load at registration, upsert, delete). */
export const MOTION_LOCK_DB_DEADLINE_MS = 2000;
/** Column caps of robot_motion_locks (varchar(64) reasonCode; detail kept short). */
const REASON_MAX = 64;
const DETAIL_MAX = 1000;

function errText(err: unknown): string {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return raw.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]*@/gi, "$1***@").slice(0, 240);
}

/**
 * R-4-t — the boot instant of a robot that started `persistUnknown` (= that lock's `since`). Read lazily by the upsert, so
 * the persistUnknown lock's own upsert (queued inside lock()) already uses it.
 */
const bootSinceByRobot = new Map<number, Date>();

/** Per-robot ordered chain of DB writes (lock/clear order is preserved at the DB). */
const chains = new Map<number, Promise<void>>();
function enqueue(robotId: number, what: string, work: () => Promise<void>): Promise<void> {
  const prev = chains.get(robotId) ?? Promise.resolve();
  const next = prev
    .then(() => withDeadline(Promise.resolve().then(work), MOTION_LOCK_DB_DEADLINE_MS, `robot ${robotId} motion lock ${what}`))
    .catch((err) => {
      console.error(`[Robot] motion lock ${what} for robot ${robotId} not persisted (in-memory lock unchanged, B4): ${errText(err)}`);
    });
  chains.set(robotId, next);
  void next.finally(() => {
    if (chains.get(robotId) === next) chains.delete(robotId);
  });
  return next;
}

/** UPSERT the current lock of `robotId` (generation never goes backwards). */
export function persistMotionLock(robotId: number, state: MotionLockState): Promise<void> {
  return enqueue(robotId, "upsert", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable (getDb returned null)");
    const row = {
      robotId,
      reasonCode: String(state.reasonCode ?? "unknown").slice(0, REASON_MAX),
      detail: state.detail != null ? String(state.detail).slice(0, DETAIL_MAX) : null,
      generation: Math.max(1, state.generation ?? 1),
      lockedAt: state.since ? new Date(state.since) : new Date(),
    };
    await db
      .insert(robotMotionLocks)
      .values(row)
      .onConflictDoUpdate({
        target: robotMotionLocks.robotId,
        set: { reasonCode: row.reasonCode, detail: row.detail, generation: row.generation, lockedAt: row.lockedAt },
        // R-4-t — replace only a row this lock supersedes (never a newer one written by a later step).
        setWhere: supersededBy(row.generation, bootSinceByRobot.get(robotId)),
      });
  });
}

/** R-4-t — the rows a write for generation `g` (and, after a `persistUnknown` boot, boot instant `boot`) supersedes. */
function supersededBy(g: number, boot: Date | undefined) {
  return boot ? or(lte(robotMotionLocks.generation, g), lt(robotMotionLocks.lockedAt, boot)) : lte(robotMotionLocks.generation, g);
}

/**
 * DELETE the persisted lock of `robotId` that the cleared lock supersedes (R-4-t): `generation <= generation`, plus — for a
 * cleared `persistUnknown` lock, whose generation knows nothing of the unread row — `lockedAt < bootSince` (strict). Never
 * unconditional: a late delete cannot erase a NEWER lock's row.
 */
export function deleteMotionLock(robotId: number, generation: number, bootSince?: Date): Promise<void> {
  return enqueue(robotId, "delete", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable (getDb returned null)");
    await db.delete(robotMotionLocks).where(and(eq(robotMotionLocks.robotId, robotId), supersededBy(generation, bootSince)));
  });
}

export interface SavedMotionLock {
  reasonCode: string;
  detail: string | null;
  since: string;
  generation: number;
}
/** Result of the ONE registration-time read: the saved rows, or why they could not be read (every robot fails closed). */
export type MotionLockLoad = { ok: true; rows: Map<number, SavedMotionLock> } | { ok: false; error: string };

/**
 * Fix round 1 (R-4-s #8) — read the persisted locks of ALL registering robots in ONE query under ONE deadline
 * (MOTION_LOCK_DB_DEADLINE_MS), not one bounded read per robot (a hung DB used to cost N × 2 s at startup). Never throws.
 */
export async function loadMotionLocks(robotIds: number[]): Promise<MotionLockLoad> {
  if (robotIds.length === 0) return { ok: true, rows: new Map() };
  try {
    const read = (async () => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable (getDb returned null)");
      return db.select().from(robotMotionLocks).where(inArray(robotMotionLocks.robotId, robotIds));
    })();
    const rows = await withDeadline(read, MOTION_LOCK_DB_DEADLINE_MS, `motion lock load (${robotIds.length} robot(s))`);
    const out = new Map<number, SavedMotionLock>();
    for (const row of rows) {
      out.set(row.robotId, { reasonCode: row.reasonCode, detail: row.detail ?? null, since: new Date(row.lockedAt).toISOString(), generation: row.generation });
    }
    return { ok: true, rows: out };
  } catch (err) {
    return { ok: false, error: errText(err) };
  }
}

/**
 * Registration step (robotManager, before connect), given the ONE batched load: restore the persisted lock into `lock`
 * — or, when the load failed, lock with `persistUnknown` (fail-closed) — and attach the persistence hooks. Never throws.
 * Returns what happened (for logs/tests).
 */
export function attachMotionLockPersistence(robotId: number, lock: MotionLock, load: MotionLockLoad): "restored" | "none" | "persistUnknown" {
  let outcome: "restored" | "none" | "persistUnknown";
  const saved = load.ok ? load.rows.get(robotId) : undefined;
  if (!load.ok) outcome = "persistUnknown";
  else if (saved) {
    lock.restore(saved);
    outcome = "restored";
  } else outcome = "none";
  lock.attachPersistence({
    locked: (state) => void persistMotionLock(robotId, state),
    cleared: (state) =>
      void deleteMotionLock(
        robotId,
        state.generation ?? 0,
        state.reasonCode === MOTION_LOCK_PERSIST_UNKNOWN_REASON_CODE && state.since ? new Date(state.since) : undefined,
      ),
  });
  if (!load.ok) {
    console.error(`[Robot] robot ${robotId}: persisted motion lock could not be read — starting LOCKED (${MOTION_LOCK_PERSIST_UNKNOWN_REASON_CODE}, fail-closed, B4): ${load.error}`);
    lock.lock(MOTION_LOCK_PERSIST_UNKNOWN_REASON_CODE, `persisted motion lock unreadable at registration: ${load.error}`);
    const since = lock.snapshot().since;
    if (since) bootSinceByRobot.set(robotId, new Date(since)); // R-4-t — read lazily by the queued upserts
  } else {
    bootSinceByRobot.delete(robotId);
    if (outcome === "restored") {
      const st = lock.snapshot();
      console.warn(`[Robot] robot ${robotId}: motion lock restored from before the restart (${st.reasonCode} since ${st.since}, generation ${st.generation})`);
    }
  }
  return outcome;
}

/** Test seam — wait until every queued motion-lock write has settled. */
export async function _flushMotionLockWritesForTests(): Promise<void> {
  while (chains.size > 0) await Promise.all([...chains.values()]);
}
