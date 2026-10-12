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
 * A late DELETE therefore never matches a NEWER lock's row (higher generation, lockedAt ≥ B — clamped to B if the wall
 * clock stepped back after boot, final wave G5): a late delete can at worst leave a restart LOCKED (fail-closed), never
 * unlocked. There is no unconditional delete.
 * RESIDUAL (final wave G6, stated plainly): a lock whose UPSERT never lands — the DB is down past the deadline, or the
 * process exits before the write reaches Postgres — leaves NO row, so the NEXT restart starts UNLOCKED for that lock.
 * That is the "failed write is LOGGED" case above (`not persisted` in the log); this store does not retry it.
 */
import { and, eq, inArray, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { randomInt } from "node:crypto";
import { getDb } from "../../db/connection";
import { DbUnavailableError } from "../../_core/dbErrors";
import { robotMotionLocks } from "../../../drizzle/schema";
import { withDeadline } from "../ot/drivers/boundedClose";
import { DISPATCH_DEADLINE_REASON_CODE, MOTION_LOCK_PERSIST_UNKNOWN_REASON_CODE, MOTION_OUTCOME_UNKNOWN_REASON_CODES, type MotionLock, type MotionLockPersistence, type MotionLockState } from "./robotDriver";
import { isEdgeControlSchemaMissing, robotMotionLockAuthority } from "../edge/edgeControlSchema";

/**
 * doc 81 Đợt 10 task D (design §2.11, re-review N2) — ONE AUTHORITY PER ROBOT. robot_motion_locks.authority (mig 0374) is
 * 'central' or 'edge:<node>'. Central's writes here (its own in-memory lock's mirror) touch ONLY 'central' rows: a central upsert
 * never replaces, and a central delete never removes, an edge authority's row (and the DB refuses edge rows to avi_app anyway).
 * An edge's lock never comes through these DB writes: on the edge the hooks are the injected journal sink
 * (attachEdgeMotionLockPersistence), and central applies the edge's `lock` events only through edgeControlSchema's guarded
 * applyEdgeMotionLock / clearEdgeMotionLock (edgeReportsCentral). A DB without 0374 has no authority column: the write is
 * retried in its pre-0374 form (42703), so central is unchanged there.
 */
async function withCentralAuthority(write: (scope: SQL | undefined) => Promise<unknown>): Promise<void> {
  try {
    await write(eq(robotMotionLockAuthority.authority, "central") as SQL);
  } catch (err) {
    if (!isEdgeControlSchemaMissing(err)) throw err;
    await write(undefined); // pre-0374 — no authority column, no edge rows
  }
}

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

/**
 * doc 81 Đợt 10 task D fix review 1 — ruling R-10-u (N1 across central REPLICAS). Every API process runs the robot gateway with
 * its own in-memory lock, so a central row may have been written by ANOTHER replica. The rows THIS process wrote and then CLEARED
 * itself (its DELETE possibly still in flight) are remembered per MotionLock — (generation, lockedAt ms) exactly as persisted —
 * and the motion gate exempts only those; any other central row refuses motion (fail-closed across replicas) and is adopted.
 * Bounded: the last CLEARED_KEEP clears per lock.
 */
const CLEARED_KEEP = 16;
const clearedHere = new WeakMap<MotionLock, Array<{ generation: number; lockedAtMs: number }>>();
function rememberCleared(lock: MotionLock, generation: number, lockedAtMs: number): void {
  const list = clearedHere.get(lock) ?? [];
  list.push({ generation, lockedAtMs });
  if (list.length > CLEARED_KEEP) list.splice(0, list.length - CLEARED_KEEP);
  clearedHere.set(lock, list);
}
/** true ⇔ the persisted row (generation, lockedAt) is one THIS process's lock wrote and has since cleared. */
export function motionLockRowClearedHere(lock: MotionLock | undefined | null, generation: number, lockedAt: Date | string | number | null | undefined): boolean {
  if (!lock || lockedAt == null) return false;
  const t = new Date(lockedAt).getTime();
  return Number.isFinite(t) && (clearedHere.get(lock) ?? []).some((c) => c.generation === generation && c.lockedAtMs === t);
}
/** the lockedAt this process persists for a lock state (the same clamp as the upsert) */
function persistedLockedAt(robotId: number, state: MotionLockState): Date {
  return clampToBoot(state.since ? new Date(state.since) : new Date(), bootSinceByRobot.get(robotId));
}

/**
 * doc 81 Đợt 10 task D fix review 2 — ruling R-10-aj (re-review N1). The central lock row is ONE slot per robot shared by every
 * API replica, and each replica's generation counter is its own. A replica must therefore never REPLACE (nor DELETE) a row
 * another writer holds:
 *   • WRITER IDENTITY without a migration: each registered lock (one per robot per process — a "replica") stamps the
 *     sub-millisecond MICROSECONDS of the lockedAt it writes with its own tag (1..999, random per lock). JS reads lockedAt at ms precision, so nothing that shows / compares the time changes.
 *     A row whose µs differ (another replica, the DB's ownerChanged relock, a pre-restart process) is FOREIGN.
 *   • A lock write onto its OWN row keeps R-4-t exactly (replace only what it supersedes). Onto a FOREIGN row it MERGES: the
 *     generation becomes max(row, mine) + 1, the strongest reason is kept (outcome-unknown > ownerChanged / persistUnknown >
 *     the rest) and every reason is LISTED in the detail. (A row older than a persistUnknown boot is superseded as before.)
 *   • A clear deletes only its own lineage (`mine AND generation ≤ g`, R-4-t) — or, for a row this lock ADOPTED (restored at
 *     boot or adopted by the motion gate), exactly that row's generation. A clear naming an older generation removes nothing:
 *     the gate then adopts the row, showing every reason, and the operator's clear must quote its generation.
 *   • Residual: two replicas that drew the same tag (1 in 999) treat each other's rows as their own (R-4-t semantics between them).
 */
/** the default writer tag (direct calls without a registered lock); a registered lock draws its own (lockTag) */
const PROCESS_WRITER_TAG = randomInt(1, 1000);
const writerTags = new WeakMap<MotionLock, number>();
function lockTag(lock: MotionLock): number {
  let t = writerTags.get(lock);
  if (t === undefined) {
    t = randomInt(1, 1000);
    writerTags.set(lock, t);
  }
  return t;
}
const isMineSql = (tag: number): SQL => sql`(extract(microseconds from ${robotMotionLocks.lockedAt})::bigint % 1000) = ${tag}`;
function rankSql(code: SQL): SQL {
  const strongest = [...MOTION_OUTCOME_UNKNOWN_REASON_CODES, DISPATCH_DEADLINE_REASON_CODE, "motion_outcome_unknown"];
  return sql`(CASE WHEN ${code} IN (${sql.join(strongest.map((c) => sql`${c}`), sql`, `)}) OR ${code} LIKE '%outcome_unknown%' THEN 3 WHEN ${code} IN ('ownerChanged', ${MOTION_LOCK_PERSIST_UNKNOWN_REASON_CODE}) THEN 2 ELSE 1 END)`;
}
/** rows a FOREIGN-row write / clear has ADOPTED: exactly this generation may be deleted by this lock's next clear */
const adoptedRow = new WeakMap<MotionLock, { generation: number }>();
/**
 * Adopt a persisted row this process did not write (the motion gate / boot restore): it becomes this lock's in-memory lock
 * (every listed reason shown), and this lock's next clear deletes exactly that row's generation.
 */
export function adoptPersistedMotionLock(lock: MotionLock, saved: { reasonCode: string; detail?: string | null; since: string; generation: number }): void {
  if (lock.isLocked()) return;
  lock.restore(saved);
  adoptedRow.set(lock, { generation: saved.generation });
}

/** UPSERT the current lock of `robotId` (generation never goes backwards; a foreign row is MERGED, never replaced — R-10-aj). */
export function persistMotionLock(
  robotId: number,
  state: MotionLockState,
  tag: number = PROCESS_WRITER_TAG,
  /** rows this lock already CLEARED (its own or adopted — the operator acknowledged them; a delete may still be in flight) */
  acknowledged: ReadonlyArray<{ generation: number; lockedAtMs: number }> = [],
): Promise<void> {
  return enqueue(robotId, "upsert", async () => {
    const db = await getDb();
    if (!db) throw new DbUnavailableError("DB unavailable (getDb returned null)");
    const row = {
      robotId,
      reasonCode: String(state.reasonCode ?? "unknown").slice(0, REASON_MAX),
      detail: state.detail != null ? String(state.detail).slice(0, DETAIL_MAX) : null,
      generation: Math.max(1, state.generation ?? 1),
      lockedAt: clampToBoot(state.since ? new Date(state.since) : new Date(), bootSinceByRobot.get(robotId)),
    };
    const boot = bootSinceByRobot.get(robotId);
    // R-10-aj — the writer tag in the µs of lockedAt (the same naive-UTC text drizzle writes for a Date)
    const taggedAt = sql`(${row.lockedAt.toISOString()}::timestamp + ${tag} * interval '1 microsecond')`;
    const T = robotMotionLocks;
    // a row this lock already cleared (acknowledged) is superseded by its next lock — exact (generation, lockedAt ms)
    const ackd = acknowledged.length
      ? sql.join(
          acknowledged.map((a) => sql`(${T.generation} = ${a.generation} AND date_trunc('milliseconds', ${T.lockedAt}) = ${new Date(a.lockedAtMs).toISOString()}::timestamp)`),
          sql` OR `,
        )
      : sql`false`;
    const replace0 = boot ? sql`((${isMineSql(tag)} AND ${T.generation} <= ${row.generation}) OR ${T.lockedAt} < ${boot.toISOString()}::timestamp)` : sql`(${isMineSql(tag)} AND ${T.generation} <= ${row.generation})`;
    const replace = sql`(${replace0} OR ${ackd})`;
    const merge = sql`(NOT ${replace})`;
    const listed = sql`left((CASE WHEN ${T.detail} LIKE 'reasons: %' THEN ${T.detail} ELSE 'reasons: ' || ${T.reasonCode} || ' (' || coalesce(${T.detail}, '') || ')' END) || ' + ' || excluded."reasonCode" || ' (' || coalesce(excluded."detail", '') || ')', ${DETAIL_MAX})`;
    await withCentralAuthority((scope) =>
      db
        .insert(robotMotionLocks)
        .values({ ...row, lockedAt: taggedAt as unknown as Date })
        .onConflictDoUpdate({
          target: robotMotionLocks.robotId,
          set: {
            generation: sql`(CASE WHEN ${replace} THEN excluded."generation" ELSE GREATEST(${T.generation}, excluded."generation") + 1 END)`,
            reasonCode: sql`(CASE WHEN ${replace} THEN excluded."reasonCode" WHEN ${rankSql(sql`excluded."reasonCode"`)} > ${rankSql(sql`${T.reasonCode}`)} THEN excluded."reasonCode" ELSE ${T.reasonCode} END)`,
            detail: sql`(CASE WHEN ${replace} THEN excluded."detail" ELSE ${listed} END)`,
            lockedAt: sql`(CASE WHEN ${replace} THEN excluded."lockedAt" ELSE ${T.lockedAt} END)`,
          },
          // R-4-t — replace only a row this lock supersedes (never a newer one written by a later step); R-10-aj — a FOREIGN
          // row is merged, never replaced; Đợt 10 D — only a CENTRAL row (never an edge authority's).
          setWhere: and(sql`(${replace} OR ${merge})`, scope), // every conflict is either a replace or a merge
        }),
    );
  });
}

/**
 * Final wave G5 (re-review 2 NEW-1) — a lock row written after a `persistUnknown` boot never sorts BEFORE the boot instant.
 * The `lockedAt < boot` branch compares two wall-clock readings; if the clock steps back after boot (NTP/w32time, manual
 * set), a newer lock would otherwise be stamped `< boot` and a late persistUnknown DELETE could erase it. Clamped to `boot`
 * it survives (the branch is strict). Only the persisted row is clamped; the in-memory `since` is unchanged.
 */
function clampToBoot(at: Date, boot: Date | undefined): Date {
  return boot && !(at.getTime() >= boot.getTime()) ? new Date(boot.getTime()) : at;
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
export function deleteMotionLock(robotId: number, generation: number, bootSince?: Date, adoptedGeneration?: number, tag: number = PROCESS_WRITER_TAG): Promise<void> {
  return enqueue(robotId, "delete", async () => {
    const db = await getDb();
    if (!db) throw new DbUnavailableError("DB unavailable (getDb returned null)");
    // R-10-aj — its own lineage (mine AND generation ≤ g, R-4-t) / the pre-boot rows of a persistUnknown clear / EXACTLY the
    // row it adopted. Never another writer's row at another generation.
    const own = sql`(${isMineSql(tag)} AND ${robotMotionLocks.generation} <= ${generation})`;
    const parts: SQL[] = [own];
    if (bootSince) parts.push(lt(robotMotionLocks.lockedAt, bootSince) as SQL);
    if (adoptedGeneration !== undefined) parts.push(eq(robotMotionLocks.generation, adoptedGeneration) as SQL);
    await withCentralAuthority((scope) => db.delete(robotMotionLocks).where(and(eq(robotMotionLocks.robotId, robotId), or(...parts), scope)));
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
      if (!db) throw new DbUnavailableError("DB unavailable (getDb returned null)");
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
    adoptedRow.set(lock, { generation: saved.generation }); // R-10-aj — its clear deletes exactly this row (any writer)
    outcome = "restored";
  } else outcome = "none";
  lock.attachPersistence({
    locked: (state) => void persistMotionLock(robotId, state, lockTag(lock), clearedHere.get(lock) ?? []),
    cleared: (state) => {
      const adopted = adoptedRow.get(lock);
      adoptedRow.delete(lock);
      // R-10-u — this process clears the row it holds (its own, or the one it adopted — R-10-aj): remember exactly that row
      rememberCleared(lock, adopted ? adopted.generation : Math.max(1, state.generation ?? 1), persistedLockedAt(robotId, state).getTime());
      void deleteMotionLock(
        robotId,
        state.generation ?? 0,
        state.reasonCode === MOTION_LOCK_PERSIST_UNKNOWN_REASON_CODE && state.since ? new Date(state.since) : undefined,
        adopted?.generation,
        lockTag(lock),
      );
    },
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

/**
 * doc 81 Đợt 10 task D (design §2.11, re-review N2) — the EDGE authority's registration step (robotManager in edge mode): NO DB.
 *   • the seed (group E's edgeMotionLockSeed: journal ⊕ the signed config's mirrored row ⊕ the ownership floor) fixes the
 *     generation base (never backwards) and, when it says so, starts the robot LOCKED (restore — persistUnknown when the
 *     journal knows nothing, ownerChanged across an ownership change);
 *   • the persistence hooks are INJECTED (the journal / report sink → `lock` events → central mirror via the guarded helpers);
 *     a hook failure never blocks lock() or a clear (MotionLock logs it);
 *   • `announce` ⇒ the seeded lock is reported once as a `locked` event (central's mirror does not have it yet).
 * Returns what happened (logs / tests). Never throws.
 */
export function attachEdgeMotionLockPersistence(
  robotId: number,
  lock: MotionLock,
  seed: { locked: null | { reasonCode: string; since: string; generation: number; detail?: string | null }; generationBase: number },
  persistence: MotionLockPersistence,
  opts: { announce?: boolean } = {},
): "restored" | "none" {
  try {
    lock.seedGeneration(seed.generationBase);
    if (seed.locked) lock.restore({ reasonCode: seed.locked.reasonCode, detail: seed.locked.detail ?? null, since: seed.locked.since, generation: seed.locked.generation });
  } catch (err) {
    console.error(`[Robot] robot ${robotId}: edge motion-lock seed failed — locking ${MOTION_LOCK_PERSIST_UNKNOWN_REASON_CODE} (fail-closed):`, errText(err));
    lock.lock(MOTION_LOCK_PERSIST_UNKNOWN_REASON_CODE, "edge motion-lock seed failed");
  }
  lock.attachPersistence(persistence);
  if (opts.announce && lock.isLocked()) {
    try {
      persistence.locked(lock.snapshot());
    } catch (err) {
      console.error(`[Robot] robot ${robotId}: announcing the seeded edge lock failed (in-memory lock stands):`, errText(err));
    }
  }
  return lock.isLocked() ? "restored" : "none";
}

/** Test seam — wait until every queued motion-lock write has settled. */
export async function _flushMotionLockWritesForTests(): Promise<void> {
  while (chains.size > 0) await Promise.all([...chains.values()]);
}
