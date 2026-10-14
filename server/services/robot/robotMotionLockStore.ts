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
 * RESIDUAL (final wave G6) — CLOSED by doc 81 Đợt 10 final fix wave (I-5, R-10-br): a lock whose UPSERT never lands (the DB is
 * down past the deadline, a trigger refuses the row — 0374's writer guard against a stale build — or the process exits before
 * the write reaches Postgres) used to leave NO row, so the next restart started UNLOCKED. Now lock() first writes a durable
 * local MARKER (ROBOT_MOTION_LOCK_PENDING_DIR, one fsynced file per robot), removed only when its upsert LANDS or the lock is
 * cleared; at registration a marker left by ANOTHER process with no row to restore ⇒ the robot starts LOCKED `persistUnknown`
 * (an unreadable marker too). A deploy that applies 0374 under a still-running pre-Đợt-10 build is a runbook matter
 * (EDGE_GATEWAY.md §8.13: stop :3000 first) — that build writes no marker.
 */
import { and, eq, inArray, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from "node:fs";
import path from "node:path";
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
const clearedHere = new WeakMap<MotionLock, Array<{ generation: number; lockedAtMs: number; writer: string | null }>>();
function rememberCleared(lock: MotionLock, generation: number, lockedAtMs: number, writer: string | null): void {
  const list = clearedHere.get(lock) ?? [];
  list.push({ generation, lockedAtMs, writer });
  if (list.length > CLEARED_KEEP) list.splice(0, list.length - CLEARED_KEEP);
  clearedHere.set(lock, list);
}
/** true ⇔ the persisted row (generation, lockedAt) is one THIS process's lock wrote and has since cleared. */
export function motionLockRowClearedHere(lock: MotionLock | undefined | null, generation: number, lockedAt: Date | string | number | null | undefined, writer?: string | null): boolean {
  if (!lock || lockedAt == null) return false;
  const t = new Date(lockedAt).getTime();
  return Number.isFinite(t) && (clearedHere.get(lock) ?? []).some((c) => c.generation === generation && c.lockedAtMs === t && (writer === undefined || c.writer === (writer ?? null)));
}
/** the lockedAt this process persists for a lock state (the same clamp as the upsert) */
function persistedLockedAt(robotId: number, state: MotionLockState): Date {
  return clampToBoot(state.since ? new Date(state.since) : new Date(), bootSinceByRobot.get(robotId));
}

/**
 * doc 81 Đợt 10 task D fix reviews 2–3 — rulings R-10-aj / R-10-ap (re-review N1, scans #71 / #72). The central lock row is ONE slot
 * per robot shared by every API replica, and each replica's generation counter is its own. A replica never REPLACES (nor DELETES)
 * a row another writer holds:
 *   • WRITER IDENTITY = robot_motion_locks."writerInstanceId" (mig 0374, uuid, required on every new row, write-once: another
 *     writer takes a row over only with generation ≥ old + 1). Central: ONE uuid per process (PROCESS_WRITER). A row of another
 *     writer — another replica, the DB's ownerChanged relock, an edge authority, a pre-restart process, a LEGACY row with no writer
 *     (NULL is nobody's) — is FOREIGN. (The fix-review-2 microsecond tag is gone: R-10-ap.)
 *   • A lock write onto its OWN row keeps R-4-t (replace what it supersedes: generation ≤ g, or — after a persistUnknown boot —
 *     its OWN rows from before the boot; scan #72 P2: never another writer's). Onto a FOREIGN row it MERGES: generation =
 *     max(row, mine) + 1, the strongest reason kept (outcome-unknown > ownerChanged / persistUnknown > the rest), every reason
 *     LISTED, and the row then belongs to NOBODY (writer = MERGED_WRITER, no process uses it — scan #71 P3: the original writer's
 *     next lock merges again instead of replacing). A row this lock already CLEARED (acknowledged: exact generation, lockedAt ms
 *     and writer) is superseded by its next lock (taking it over with generation ≥ old + 1 when the writer differs).
 *   • A clear deletes only its own lineage (`mine AND (generation ≤ g OR its own pre-boot rows)`) or EXACTLY the row it adopted
 *     (boot restore / the motion gate): same generation, same lockedAt (ms), same writer (scan #71 P1: a row another writer
 *     re-created at the same generation is never touched). A clear naming an older generation removes nothing: the gate adopts the
 *     row, showing every reason, and the operator's clear must quote it.
 * A DB without 0374 (42703 / 42P01): the pre-0374 R-4-t writes, unchanged (no replicas protection there).
 */
const PROCESS_WRITER: string = randomUUID();
/** the writer no process ever uses: a MERGED row belongs to nobody */
export const MERGED_WRITER = "6d657267-6564-4000-8000-000000000000";
const writerOverride = new WeakMap<MotionLock, string>();
/** Test seam — make `lock` a different writer (another process / replica). */
export function _setMotionLockWriterForTests(lock: MotionLock, writer: number | string): void {
  writerOverride.set(lock, typeof writer === "number" ? `00000000-0000-4000-8000-${String(writer).padStart(12, "0")}` : writer);
}
function writerOf(lock: MotionLock | null | undefined): string {
  return (lock && writerOverride.get(lock)) || PROCESS_WRITER;
}
/** this process's writer instance (diagnostics / the gate's exemption) */
export function motionLockWriterInstanceId(lock?: MotionLock | null): string {
  return writerOf(lock);
}
function rankSql(code: SQL): SQL {
  const strongest = [...MOTION_OUTCOME_UNKNOWN_REASON_CODES, DISPATCH_DEADLINE_REASON_CODE, "motion_outcome_unknown"];
  return sql`(CASE WHEN ${code} IN (${sql.join(strongest.map((c) => sql`${c}`), sql`, `)}) OR ${code} LIKE '%outcome_unknown%' THEN 3 WHEN ${code} IN ('ownerChanged', ${MOTION_LOCK_PERSIST_UNKNOWN_REASON_CODE}) THEN 2 ELSE 1 END)`;
}
type RowIdentity = { generation: number; lockedAtMs: number; writer: string | null };
const rowMatchSql = (id: RowIdentity): SQL => {
  const T = robotMotionLockAuthority;
  return sql`(${T.generation} = ${id.generation} AND date_trunc('milliseconds', ${T.lockedAt}) = ${new Date(id.lockedAtMs).toISOString()}::timestamp AND ${T.writerInstanceId} IS NOT DISTINCT FROM ${id.writer}::uuid)`;
};
/** rows ADOPTED by a lock (boot restore / motion gate): exactly this row may be deleted by this lock's next clear */
const adoptedRow = new WeakMap<MotionLock, RowIdentity>();
/**
 * Adopt a persisted row this process did not write (the motion gate / boot restore): it becomes this lock's in-memory lock
 * (every listed reason shown), and this lock's next clear deletes exactly that row (generation, lockedAt, writer).
 */
export function adoptPersistedMotionLock(lock: MotionLock, saved: { reasonCode: string; detail?: string | null; since: string; generation: number; writerInstanceId?: string | null }): void {
  if (lock.isLocked()) return;
  lock.restore(saved);
  adoptedRow.set(lock, { generation: saved.generation, lockedAtMs: new Date(saved.since).getTime(), writer: saved.writerInstanceId ?? null });
}

// ── doc 81 Đợt 10 final fix wave (I-5, R-10-br) — the "persist pending" marker of a lock ───────────────────────────────────

/** The marker directory (central): ROBOT_MOTION_LOCK_PENDING_DIR, default ./data/robot-motion-lock-pending (tests: a temp dir). */
export function motionLockPendingDir(): string {
  const d = process.env.ROBOT_MOTION_LOCK_PENDING_DIR;
  return path.resolve(d && d.trim() ? d : "./data/robot-motion-lock-pending");
}
const markerFile = (robotId: number) => path.join(motionLockPendingDir(), `${robotId}.json`);
interface PendingMarker {
  robotId: number;
  generation: number;
  reasonCode: string;
  since: string | null;
  writer: string;
  at: string;
}
/** Write the marker durably (temp file + fsync + rename) BEFORE the upsert is queued. Never throws (a failure is logged loudly). */
/**
 * MIN-3 (residual, R-10-bt) — the directory entry of a renamed marker is made durable too (POSIX: fsync the directory). Windows
 * has no directory fsync (MoveFileEx without write-through): best effort only, documented (EDGE_GATEWAY.md §8.5).
 */
function fsyncDirBestEffort(dir: string): void {
  if (process.platform === "win32") return;
  try {
    const dfd = openSync(dir, "r");
    try {
      fsyncSync(dfd);
    } finally {
      closeSync(dfd);
    }
  } catch {
    /* best effort */
  }
}
/** MIN-3 — can a marker be written durably in the marker directory right now (write + fsync + remove a probe)? */
function pendingDirWritable(): { ok: true } | { ok: false; error: string } {
  try {
    mkdirSync(motionLockPendingDir(), { recursive: true });
    const probe = path.join(motionLockPendingDir(), `.probe-${process.pid}-${Date.now()}`);
    const fd = openSync(probe, "w", 0o600);
    try {
      writeSync(fd, "probe");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    unlinkSync(probe);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errText(err) };
  }
}
/** MIN-3 — the durable alert of a motion lock that cannot be made durable (alert stream + log; never throws). */
/** residual 2 (R-10-bu, P-3) — how long between two reads of the alert's recipients while the DB is down (test seam). */
const NOT_DURABLE_RECIPIENT_RETRY_MS = 30_000;
let notDurableRecipientRetryMs = NOT_DURABLE_RECIPIENT_RETRY_MS;
export function _setNotDurableRecipientRetryMsForTests(ms: number | null): void {
  notDurableRecipientRetryMs = ms ?? NOT_DURABLE_RECIPIENT_RETRY_MS;
}
/** The recipients of a robot-wide durable alert: the active admins / supervisors (the deviceOwnershipService pattern). */
async function notDurableRecipients(): Promise<number[]> {
  const db = await getDb();
  if (!db) throw new DbUnavailableError("DB unavailable (alert recipients)");
  const r = (await withDeadline(Promise.resolve(db.execute(sql`SELECT id FROM public.users WHERE "isActive" = true AND role IN ('admin', 'supervisor')`)), 1_000, "motion-lock alert recipients")) as unknown;
  const rows = (Array.isArray(r) ? r : ((r as { rows?: unknown[] })?.rows ?? [])) as Array<{ id: unknown }>;
  return rows.map((x) => Number(x.id)).filter((x) => Number.isSafeInteger(x) && x > 0);
}
/**
 * MIN-3 + residual 2 (P-3) — the DURABLE alert of a motion lock that cannot be made durable: the same path as the other durable
 * STOP / lock alerts (criticalStopAlert: alert stream + a safety-critical inbox row to every active admin / supervisor, retried
 * until persisted). The DB may be down exactly now (that is often why): the log line + stream go at once, and the recipients are
 * read again every 30 s (≤ 20 times) until the inbox rows can be written. Never throws.
 */
function alertNotDurable(robotId: number, why: string): void {
  const dedupKey = `motion_lock_not_durable:${robotId}:${Math.floor(Date.now() / 60_000)}`;
  const raise = (recipients: number[]) =>
    import("./criticalStopAlert")
      .then(({ raiseCriticalStopAlert }) =>
        raiseCriticalStopAlert({
          kind: "motion_lock_not_durable",
          title: `Motion lock not durable — robot ${robotId}`,
          message: `Robot ${robotId}: its motion lock cannot be made durable (${why}) — motion stays REFUSED until the lock or its clear is persisted (check ROBOT_MOTION_LOCK_PENDING_DIR and the database).`,
          recipients,
          dedupKey,
          source: "robot",
          entityType: "robot",
          entityId: robotId,
          retryUntilPersisted: { everyMs: 30_000, attempts: 20 },
        }),
      )
      .catch(() => undefined);
  const attempt = (n: number) => {
    void notDurableRecipients()
      .then((ids) => {
        if (ids.length > 0) return void raise(ids);
        throw new Error("no active admin / supervisor");
      })
      .catch((err) => {
        if (n === 0) void raise([]); // at once: the log line + the alert stream, even without recipients
        if (n >= 20) return console.error(`[Robot] robot ${robotId}: motion_lock_not_durable alert has no recipient after ${n} reads (${errText(err)}) — the log line and the alert stream carried it`);
        const t = setTimeout(() => attempt(n + 1), notDurableRecipientRetryMs);
        if (typeof t.unref === "function") t.unref();
      });
  };
  attempt(0);
}

/** Write the marker; true ⇔ it is durable (temp file + fsync + rename + directory fsync where the OS has one). Never throws. */
function markLockPersistPending(robotId: number, state: MotionLockState, writer: string): boolean {
  try {
    mkdirSync(motionLockPendingDir(), { recursive: true });
    const m: PendingMarker = { robotId, generation: Math.max(1, state.generation ?? 1), reasonCode: String(state.reasonCode ?? "unknown").slice(0, REASON_MAX), since: state.since ?? null, writer, at: new Date().toISOString() };
    const f = markerFile(robotId);
    const tmp = `${f}.${process.pid}.tmp`;
    const fd = openSync(tmp, "w", 0o600);
    try {
      writeSync(fd, JSON.stringify(m));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, f);
    fsyncDirBestEffort(motionLockPendingDir());
    return true;
  } catch (err) {
    console.error(`[Robot] robot ${robotId}: the motion-lock pending marker could not be written (${errText(err)}) — motion is HELD until this lock (or its clear) is persisted in the DB (MIN-3)`);
    return false;
  }
}
/**
 * Remove the marker of `robotId` when it is this writer's at a generation ≤ `generation` (a later lock's marker is kept).
 * SYNCHRONOUS on purpose: the read-check-unlink must not interleave with a lock() that writes a NEWER marker in between.
 */
function clearLockPersistPending(robotId: number, generation: number, writer: string): void {
  try {
    const m = JSON.parse(readFileSync(markerFile(robotId), "utf8")) as PendingMarker;
    if (m.writer !== writer || !(m.generation <= generation)) return;
    unlinkSync(markerFile(robotId));
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") console.warn(`[Robot] robot ${robotId}: motion-lock pending marker not removed (${errText(err)})`);
  }
}
/** The marker at registration: none · a valid one · unreadable (counts as a lock that may not have been persisted). */
function readLockPersistPending(robotId: number): { kind: "none" } | { kind: "marker"; m: PendingMarker } | { kind: "unreadable"; error: string } {
  let raw: string;
  try {
    raw = readFileSync(markerFile(robotId), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return { kind: "none" };
    return { kind: "unreadable", error: errText(err) };
  }
  try {
    const m = JSON.parse(raw) as PendingMarker;
    if (typeof m !== "object" || m === null || typeof m.writer !== "string" || !Number.isFinite(m.generation)) return { kind: "unreadable", error: "malformed marker" };
    return { kind: "marker", m };
  } catch (err) {
    return { kind: "unreadable", error: errText(err) };
  }
}

/** UPSERT the current lock of `robotId` (generation never goes backwards; a foreign row is MERGED, never replaced). */
export function persistMotionLock(
  robotId: number,
  state: MotionLockState,
  writer: string = PROCESS_WRITER,
  /** rows this lock already CLEARED (its own or adopted — the operator acknowledged them; a delete may still be in flight) */
  acknowledged: ReadonlyArray<RowIdentity> = [],
  /** I-5 — called once the upsert LANDED (the pending marker of this lock is then removed) */
  onLanded?: () => void | Promise<void>,
): Promise<void> {
  return enqueue(robotId, "upsert", async () => {
    await upsertMotionLockRow(robotId, state, writer, acknowledged);
    if (onLanded) await onLanded();
  });
}

async function upsertMotionLockRow(robotId: number, state: MotionLockState, writer: string, acknowledged: ReadonlyArray<RowIdentity>): Promise<void> {
  {
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
    const T = robotMotionLockAuthority;
    const mine = sql`(${T.writerInstanceId} = ${writer}::uuid)`;
    const ownBoot = boot ? sql` OR ${T.lockedAt} < ${boot.toISOString()}::timestamp` : sql``;
    const replaceOwn = sql`(${mine} AND (${T.generation} <= ${row.generation}${ownBoot}))`;
    const ackd = acknowledged.length ? sql.join(acknowledged.map((a) => rowMatchSql(a)), sql` OR `) : sql`false`;
    const replace = sql`(${replaceOwn} OR ${ackd})`;
    const listed = sql`left((CASE WHEN ${T.detail} LIKE 'reasons: %' THEN ${T.detail} ELSE 'reasons: ' || ${T.reasonCode} || ' (' || coalesce(${T.detail}, '') || ')' END) || ' + ' || excluded."reasonCode" || ' (' || coalesce(excluded."detail", '') || ')', ${DETAIL_MAX})`;
    try {
      await db
        .insert(robotMotionLockAuthority)
        .values({ ...row, writerInstanceId: writer })
        .onConflictDoUpdate({
          target: robotMotionLockAuthority.robotId,
          set: {
            generation: sql`(CASE WHEN ${replaceOwn} THEN excluded."generation" WHEN ${ackd} THEN GREATEST(excluded."generation", ${T.generation} + 1) ELSE GREATEST(${T.generation}, excluded."generation") + 1 END)`,
            reasonCode: sql`(CASE WHEN ${replace} THEN excluded."reasonCode" WHEN ${rankSql(sql`excluded."reasonCode"`)} > ${rankSql(sql`${T.reasonCode}`)} THEN excluded."reasonCode" ELSE ${T.reasonCode} END)`,
            detail: sql`(CASE WHEN ${replace} THEN excluded."detail" ELSE ${listed} END)`,
            lockedAt: sql`(CASE WHEN ${replace} THEN excluded."lockedAt" ELSE ${T.lockedAt} END)`,
            writerInstanceId: sql`(CASE WHEN ${replace} THEN excluded."writerInstanceId" ELSE ${MERGED_WRITER}::uuid END)`,
          },
          // every conflict is a replace or a merge — only ever on a CENTRAL row (never an edge authority's)
          setWhere: eq(T.authority, "central") as SQL,
        });
    } catch (err) {
      if (!isEdgeControlSchemaMissing(err)) throw err;
      // pre-0374 — the R-4-t write, unchanged
      await db
        .insert(robotMotionLocks)
        .values(row)
        .onConflictDoUpdate({
          target: robotMotionLocks.robotId,
          set: { reasonCode: row.reasonCode, detail: row.detail, generation: row.generation, lockedAt: row.lockedAt },
          setWhere: supersededBy(row.generation, boot),
        });
    }
  }
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

/** R-4-t (pre-0374 only) — the rows a write for generation `g` (and, after a `persistUnknown` boot, `boot`) supersedes. */
function supersededBy(g: number, boot: Date | undefined) {
  return boot ? or(lte(robotMotionLocks.generation, g), lt(robotMotionLocks.lockedAt, boot)) : lte(robotMotionLocks.generation, g);
}

/**
 * DELETE what the cleared lock may remove: its OWN lineage (`mine AND generation ≤ g`, plus — for a cleared persistUnknown lock —
 * its own rows from before the boot, strict) or EXACTLY the row it adopted. Never another writer's row, never unconditional.
 */
export function deleteMotionLock(robotId: number, generation: number, bootSince?: Date, adopted?: RowIdentity, writer: string = PROCESS_WRITER, onLanded?: () => void): Promise<void> {
  return enqueue(robotId, "delete", async () => {
    await deleteMotionLockRow(robotId, generation, bootSince, adopted, writer);
    if (onLanded) onLanded(); // MIN-3 — a PERSISTED clear
  });
}

async function deleteMotionLockRow(robotId: number, generation: number, bootSince: Date | undefined, adopted: RowIdentity | undefined, writer: string): Promise<void> {
  {
    const db = await getDb();
    if (!db) throw new DbUnavailableError("DB unavailable (getDb returned null)");
    const T = robotMotionLockAuthority;
    const ownBoot = bootSince ? sql` OR ${T.lockedAt} < ${bootSince.toISOString()}::timestamp` : sql``;
    const parts: SQL[] = [sql`(${T.writerInstanceId} = ${writer}::uuid AND (${T.generation} <= ${generation}${ownBoot}))`];
    if (adopted) parts.push(rowMatchSql(adopted));
    try {
      await db.delete(T).where(and(eq(T.robotId, robotId), eq(T.authority, "central"), or(...parts)));
    } catch (err) {
      if (!isEdgeControlSchemaMissing(err)) throw err;
      await db.delete(robotMotionLocks).where(and(eq(robotMotionLocks.robotId, robotId), supersededBy(generation, bootSince))); // pre-0374
    }
  }
}

export interface SavedMotionLock {
  reasonCode: string;
  detail: string | null;
  since: string;
  generation: number;
  /** 0374 — the row's writer instance (null: legacy / pre-0374) */
  writerInstanceId?: string | null;
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
    const read = (async (): Promise<Array<{ robotId: number; reasonCode: string; detail: string | null; lockedAt: Date; generation: number; writerInstanceId?: string | null }>> => {
      const db = await getDb();
      if (!db) throw new DbUnavailableError("DB unavailable (getDb returned null)");
      try {
        return await db.select().from(robotMotionLockAuthority).where(inArray(robotMotionLockAuthority.robotId, robotIds));
      } catch (err) {
        if (!isEdgeControlSchemaMissing(err)) throw err;
        return await db.select().from(robotMotionLocks).where(inArray(robotMotionLocks.robotId, robotIds)); // pre-0374
      }
    })();
    const rows = await withDeadline(read, MOTION_LOCK_DB_DEADLINE_MS, `motion lock load (${robotIds.length} robot(s))`);
    const out = new Map<number, SavedMotionLock>();
    for (const row of rows) {
      out.set(row.robotId, { reasonCode: row.reasonCode, detail: row.detail ?? null, since: new Date(row.lockedAt).toISOString(), generation: row.generation, writerInstanceId: row.writerInstanceId ?? null });
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
  // I-5 — a lock of ANOTHER process (a previous run) whose DB write never landed, or a marker that cannot be read
  const pending = readLockPersistPending(robotId);
  const foreignPending = pending.kind === "unreadable" || (pending.kind === "marker" && pending.m.writer !== writerOf(lock));
  let unpersisted: string | null = null;
  // MIN-3 — no durable marker can be written here ⇒ a lock taken now could not survive a restart if its DB write failed
  const writable = pendingDirWritable();
  if (!writable.ok) alertNotDurable(robotId, `the pending-marker directory ${motionLockPendingDir()} is not writable: ${writable.error}`);
  if (!load.ok) outcome = "persistUnknown";
  else if (saved) {
    lock.restore(saved);
    // R-10-aj / scan #71 — its clear deletes exactly this row (generation, lockedAt, writer)
    adoptedRow.set(lock, { generation: saved.generation, lockedAtMs: new Date(saved.since).getTime(), writer: saved.writerInstanceId ?? null });
    outcome = "restored";
  } else if (foreignPending) {
    outcome = "persistUnknown";
    unpersisted =
      pending.kind === "marker"
        ? `the motion lock taken before the restart (${pending.m.reasonCode}, generation ${pending.m.generation}, since ${pending.m.since ?? "?"}) was never persisted`
        : `its motion-lock pending marker is unreadable (${(pending as { error: string }).error})`;
  } else if (!writable.ok) {
    outcome = "persistUnknown";
    unpersisted = `the motion-lock pending-marker directory is not writable (${writable.error}) — a lock could not be made durable`;
  } else outcome = "none";
  if (foreignPending && outcome === "restored") {
    try {
      unlinkSync(markerFile(robotId)); // the restored row is the evidence now
    } catch {
      /* removed by the next clear */
    }
  }
  lock.attachPersistence({
    locked: (state) => {
      const w = writerOf(lock);
      // I-5 — durable BEFORE the upsert is even queued; MIN-3 — not durable ⇒ motion HELD until the upsert (or a clear) lands
      if (!markLockPersistPending(robotId, state, w)) {
        lock.holdUntilDurable(`the motion lock (${state.reasonCode ?? "lock"}, generation ${state.generation ?? "?"}) is not persisted yet and its pending marker could not be written`);
        alertNotDurable(robotId, "its pending marker could not be written");
      }
      void persistMotionLock(robotId, state, w, clearedHere.get(lock) ?? [], () => {
        clearLockPersistPending(robotId, Math.max(1, state.generation ?? 1), w);
        lock.releaseDurabilityHold(); // a PERSISTED lock
      });
    },
    cleared: (state) => {
      clearLockPersistPending(robotId, Number.MAX_SAFE_INTEGER, writerOf(lock)); // I-5 — decided: no restart lock for it
      const adopted = adoptedRow.get(lock);
      adoptedRow.delete(lock);
      // R-10-u — this process clears the row it holds (its own, or the one it adopted — R-10-aj): remember exactly that row
      rememberCleared(
        lock,
        adopted ? adopted.generation : Math.max(1, state.generation ?? 1),
        adopted ? adopted.lockedAtMs : persistedLockedAt(robotId, state).getTime(),
        adopted ? adopted.writer : writerOf(lock),
      );
      void deleteMotionLock(
        robotId,
        state.generation ?? 0,
        state.reasonCode === MOTION_LOCK_PERSIST_UNKNOWN_REASON_CODE && state.since ? new Date(state.since) : undefined,
        adopted,
        writerOf(lock),
        () => lock.releaseDurabilityHold(), // MIN-3 — a PERSISTED clear releases a durability hold
      );
    },
  });
  if (!load.ok || unpersisted !== null) {
    const why = !load.ok ? `persisted motion lock unreadable at registration: ${load.error}` : `${unpersisted} (I-5)`;
    console.error(`[Robot] robot ${robotId}: ${why} — starting LOCKED (${MOTION_LOCK_PERSIST_UNKNOWN_REASON_CODE}, fail-closed)`);
    lock.lock(MOTION_LOCK_PERSIST_UNKNOWN_REASON_CODE, why);
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

// ── doc 81 Đợt 12 task N (OWNER-SETUP B2) — the persisted lock of a robot whose DRIVER HAS NO MOTION LOCK ─────────────────
/**
 * A one-shot driver (Techman / UR / VDA5050) has no in-memory lock, so a robot_motion_locks row of such a robot — typically the
 * DB's `ownerChanged` relock written when the robot is released from an edge (0374 robot_owner_relock) — could be neither
 * adopted nor cleared: central refused its motion for ever. These two helpers are the ONLY way that row goes away, and only
 * from the audited operator clear (robot.clearMotionLock: scope, permission, reason, generation; audit row FIRST). Nothing calls
 * them automatically (no STOP, no reconcile, no restart).
 */
export interface PersistedMotionLockRow {
  robotId: number;
  authority: string;
  reasonCode: string;
  detail: string | null;
  /** ISO of lockedAt (as the boot restore / the motion gate read it) */
  since: string;
  /** lockedAt in ms — part of the row's identity (rowMatchSql truncates to ms) */
  lockedAtMs: number;
  generation: number;
  ownerEpoch: number | null;
  writerInstanceId: string | null;
}

/** The persisted motion-lock row of `robotId` now (bounded, any authority). Never throws; `{ error }` ⇒ the caller refuses. */
export async function readPersistedMotionLockRow(robotId: number): Promise<{ row: PersistedMotionLockRow | null } | { error: string }> {
  try {
    const read = (async () => {
      const db = await getDb();
      if (!db) throw new DbUnavailableError("DB unavailable (getDb returned null)");
      const T = robotMotionLockAuthority;
      const [r] = await db.select().from(T).where(eq(T.robotId, robotId)).limit(1);
      if (!r || r.robotId !== robotId) return { row: null };
      const lockedAt = new Date(r.lockedAt);
      return {
        row: {
          robotId,
          authority: String(r.authority ?? "central"),
          reasonCode: String(r.reasonCode),
          detail: r.detail ?? null,
          since: lockedAt.toISOString(),
          lockedAtMs: lockedAt.getTime(),
          generation: Number(r.generation),
          ownerEpoch: r.ownerEpoch == null ? null : Number(r.ownerEpoch),
          writerInstanceId: r.writerInstanceId ?? null,
        } satisfies PersistedMotionLockRow,
      };
    })();
    return await withDeadline(read, MOTION_LOCK_DB_DEADLINE_MS, `robot ${robotId} persisted motion lock read`);
  } catch (err) {
    return { error: errText(err) };
  }
}

/**
 * doc 81 Đợt 12 N fix 1 (M-3 / M-4) — the persisted CENTRAL lock rows of `robotIds` (one batched read, bounded), for DISPLAY only:
 * the robot panel shows the lock of a robot with no live lock in this process (inactive, or a lockless driver). An edge
 * authority's row is not central's (never shown as such). Never throws; a failed read gives an empty map (display only — the
 * motion gate still reads the row itself and refuses, fail-closed).
 */
export async function loadCentralPersistedLocks(robotIds: number[]): Promise<Map<number, PersistedMotionLockRow>> {
  const out = new Map<number, PersistedMotionLockRow>();
  if (robotIds.length === 0) return out;
  try {
    const read = (async () => {
      const db = await getDb();
      if (!db) return [];
      const T = robotMotionLockAuthority;
      return db.select().from(T).where(and(inArray(T.robotId, robotIds), eq(T.authority, "central")));
    })();
    for (const r of await withDeadline(read, MOTION_LOCK_DB_DEADLINE_MS, `persisted motion locks (${robotIds.length} robot(s))`)) {
      if (r.authority !== "central" || !robotIds.includes(r.robotId)) continue;
      const lockedAt = new Date(r.lockedAt);
      out.set(r.robotId, {
        robotId: r.robotId,
        authority: "central",
        reasonCode: String(r.reasonCode),
        detail: r.detail ?? null,
        since: lockedAt.toISOString(),
        lockedAtMs: lockedAt.getTime(),
        generation: Number(r.generation),
        ownerEpoch: r.ownerEpoch == null ? null : Number(r.ownerEpoch),
        writerInstanceId: r.writerInstanceId ?? null,
      });
    }
  } catch (err) {
    console.warn(`[Robot] persisted motion locks not shown (display only): ${errText(err)}`);
  }
  return out;
}

/**
 * doc 81 Đợt 12 N fix 1 (M-1) — a clear that did not land. `not_cleared`: the DB answered with an error (refused, statement /
 * lock timeout) ⇒ its transaction was rolled back, the row stands. `unknown`: no answer within the client bound (the connection
 * hung, or the COMMIT's answer was lost) ⇒ the caller must re-read the row before telling anyone it is (not) cleared.
 */
export class PersistedLockClearError extends Error {
  constructor(
    readonly outcome: "not_cleared" | "unknown",
    message: string,
  ) {
    super(message);
    this.name = "PersistedLockClearError";
  }
}
/** M-1 — the server-side bounds of the clear's transaction (statement / lock), and the client's own bound beyond them */
export const PERSISTED_LOCK_CLEAR_STATEMENT_MS = MOTION_LOCK_DB_DEADLINE_MS;
export const PERSISTED_LOCK_CLEAR_LOCK_MS = 1_000;
const PERSISTED_LOCK_CLEAR_CLIENT_MS = PERSISTED_LOCK_CLEAR_STATEMENT_MS + 3_000;

/**
 * Delete EXACTLY the row the operator decided about: same robot, authority 'central', same generation, same lockedAt (ms), same
 * writer (rowMatchSql — the R-10-aj / R-10-ap identity of an adopted row) and same owner epoch, and only while the robot is
 * central-owned (an edge-owned robot's row is its edge authority's: never touched here — the 0374 write guard refuses it too).
 * A row re-created, replaced or merged since the read (new generation, new writer, new epoch) matches nothing. Returns the
 * number of rows deleted (0 or 1).
 * M-1 — ONE transaction bounded BY THE SERVER (SET LOCAL statement_timeout + lock_timeout): a DELETE that waits on a held row lock
 * or runs long is cancelled by Postgres and its transaction rolls back, so a clear reported as failed can never commit later (a
 * client-side deadline alone abandoned a DELETE that still landed when the lock was released). Throws PersistedLockClearError.
 */
export async function clearPersistedCentralMotionLock(
  robotId: number,
  id: { generation: number; lockedAtMs: number; writerInstanceId: string | null; ownerEpoch: number | null },
): Promise<number> {
  const db = await getDb();
  if (!db) throw new PersistedLockClearError("not_cleared", "DB unavailable (getDb returned null)");
  const T = robotMotionLockAuthority;
  let settled = false;
  const work = db
    .transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('statement_timeout', ${String(PERSISTED_LOCK_CLEAR_STATEMENT_MS)}, true), set_config('lock_timeout', ${String(PERSISTED_LOCK_CLEAR_LOCK_MS)}, true)`,
      );
      const deleted = await tx
        .delete(T)
        .where(
          and(
            eq(T.robotId, robotId),
            eq(T.authority, "central"),
            rowMatchSql({ generation: id.generation, lockedAtMs: id.lockedAtMs, writer: id.writerInstanceId }),
            sql`${T.ownerEpoch} IS NOT DISTINCT FROM ${id.ownerEpoch}::bigint`,
            sql`NOT EXISTS (SELECT 1 FROM public.robots r WHERE r.id = ${robotId} AND r."edgeNodeId" IS NOT NULL)`,
          ),
        )
        .returning({ robotId: T.robotId });
      return deleted.length;
    })
    .finally(() => {
      settled = true;
    });
  try {
    return await withDeadline(work, PERSISTED_LOCK_CLEAR_CLIENT_MS, `robot ${robotId} persisted motion lock clear`);
  } catch (err) {
    // the DB answered (an SQLSTATE) ⇒ rolled back; no answer in the client bound, or a transport failure ⇒ unknown
    const sqlState = (err as { code?: unknown; cause?: { code?: unknown } })?.code ?? (err as { cause?: { code?: unknown } })?.cause?.code;
    const answered = settled && typeof sqlState === "string" && /^[0-9A-Z]{5}$/.test(sqlState);
    throw new PersistedLockClearError(answered ? "not_cleared" : "unknown", errText(err));
  }
}

/** Test seam — wait until every queued motion-lock write has settled. */
export async function _flushMotionLockWritesForTests(): Promise<void> {
  while (chains.size > 0) await Promise.all([...chains.values()]);
}
