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
 * Writes of one robot are applied in order (a per-robot chain), so a fast lock → clear never leaves a stale row behind
 * a late upsert; a write that times out may still land later — in the worst case a restart then starts LOCKED
 * (fail-closed direction), never unlocked.
 */
import { and, eq, lte, sql } from "drizzle-orm";
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
        setWhere: sql`${robotMotionLocks.generation} <= ${row.generation}`,
      });
  });
}

/** DELETE the persisted lock of `robotId` up to `generation` (a newer lock's row is never removed). */
export function deleteMotionLock(robotId: number, generation: number): Promise<void> {
  return enqueue(robotId, "delete", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable (getDb returned null)");
    await db.delete(robotMotionLocks).where(and(eq(robotMotionLocks.robotId, robotId), lte(robotMotionLocks.generation, generation)));
  });
}

/** Read the persisted lock of `robotId` (null = none). THROWS on a DB failure / timeout (caller fails closed). */
export async function loadMotionLock(robotId: number): Promise<{ reasonCode: string; detail: string | null; since: string; generation: number } | null> {
  const read = (async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable (getDb returned null)");
    const [row] = await db.select().from(robotMotionLocks).where(eq(robotMotionLocks.robotId, robotId)).limit(1);
    return row ?? null;
  })();
  const row = await withDeadline(read, MOTION_LOCK_DB_DEADLINE_MS, `robot ${robotId} motion lock load`);
  if (!row) return null;
  return { reasonCode: row.reasonCode, detail: row.detail ?? null, since: new Date(row.lockedAt).toISOString(), generation: row.generation };
}

/**
 * Registration step (robotManager, before connect): restore the persisted lock into `lock` — or, when it cannot be
 * read, lock with `persistUnknown` (fail-closed) — then attach the persistence hooks. Never throws.
 * Returns what happened (for logs/tests).
 */
export async function attachMotionLockPersistence(robotId: number, lock: MotionLock): Promise<"restored" | "none" | "persistUnknown"> {
  let outcome: "restored" | "none" | "persistUnknown";
  let loadError: string | null = null;
  try {
    const saved = await loadMotionLock(robotId);
    if (saved) {
      lock.restore(saved);
      outcome = "restored";
    } else {
      outcome = "none";
    }
  } catch (err) {
    loadError = errText(err);
    outcome = "persistUnknown";
  }
  lock.attachPersistence({
    locked: (state) => void persistMotionLock(robotId, state),
    cleared: (state) => void deleteMotionLock(robotId, state.generation ?? 0),
  });
  if (outcome === "persistUnknown") {
    console.error(`[Robot] robot ${robotId}: persisted motion lock could not be read — starting LOCKED (${MOTION_LOCK_PERSIST_UNKNOWN_REASON_CODE}, fail-closed, B4): ${loadError}`);
    lock.lock(MOTION_LOCK_PERSIST_UNKNOWN_REASON_CODE, `persisted motion lock unreadable at registration: ${loadError}`);
  } else if (outcome === "restored") {
    const st = lock.snapshot();
    console.warn(`[Robot] robot ${robotId}: motion lock restored from before the restart (${st.reasonCode} since ${st.since}, generation ${st.generation})`);
  }
  return outcome;
}

/** Test seam — wait until every queued motion-lock write has settled. */
export async function _flushMotionLockWritesForTests(): Promise<void> {
  while (chains.size > 0) await Promise.all([...chains.values()]);
}
