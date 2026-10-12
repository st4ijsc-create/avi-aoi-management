/**
 * doc 81 Đợt 9 final wave F1 (final review I1) — the PERSISTED motion lock, read at MOTION time on an EDGE.
 *
 * The motion lock is in memory per process (robotDriver MotionLock, ruling R13); robot_motion_locks (Đợt 4 B4, mig 0364) only
 * makes it survive a restart. Central and an edge gateway are two processes with two drivers for the same robot, so a lock
 * central set (an outcome-unknown motion, a peer drop) was invisible to the edge's driver until the edge restarted — the edge
 * could move a robot central had locked.
 *
 * On an edge that executes runs (EDGE_EXECUTION_ENABLED, or the edge gateway mode) the robot dispatcher therefore asks this
 * module before any MOTION driver call (never for a STOP — L-7):
 *   • a robot_motion_locks row exists for the robot (whoever wrote it: central or this edge) ⇒ motion REFUSED;
 *   • the row cannot be read (no DB, error, timeout — bounded by STOP_DB_STEP_DEADLINE_MS) ⇒ motion REFUSED (fail-closed);
 *   • no row ⇒ allowed (the in-memory lock of this process is still checked by the dispatcher before this).
 * The row is cleared where it was set: a confirmed STOP / the audited robot.clearMotionLock on the process holding the lock
 * (central's page for a central lock). A STOP sent from the edge never needs this check.
 * Central keeps its own in-memory lock as the source of truth (unchanged): it is the process that wrote its rows.
 */
import { eq, sql } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { robotMotionLocks } from "../../../drizzle/schema";
import { DbUnavailableError } from "../../_core/dbErrors";
import { withDeadline } from "../ot/drivers/boundedClose";
import { STOP_DB_STEP_DEADLINE_MS } from "./stopJob";

const on = (v: string | undefined) => v === "true" || v === "1";

/** Is this process an edge that executes runs (so it shares robots with central and must honour central's persisted lock)? */
export function persistedMotionLockCheckRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  return on(env.EDGE_EXECUTION_ENABLED) || on(env.EDGE_GATEWAY_MODE);
}

export type PersistedMotionLockRead =
  | { locked: false }
  | { locked: true; reasonCode: string; since: string; generation: number }
  | { error: string };

/** The persisted motion lock of `robotId` now (bounded). Never throws; `{ error }` ⇒ the caller refuses motion. */
export async function readPersistedMotionLock(robotId: number): Promise<PersistedMotionLockRead> {
  try {
    const read = (async (): Promise<PersistedMotionLockRead> => {
      const db = await getDb();
      if (!db) throw new DbUnavailableError("DB unavailable (getDb returned null)");
      const [row] = await db.select().from(robotMotionLocks).where(eq(robotMotionLocks.robotId, robotId)).limit(1);
      if (!row) return { locked: false };
      return { locked: true, reasonCode: row.reasonCode, since: new Date(row.lockedAt).toISOString(), generation: row.generation };
    })();
    return await withDeadline(read, STOP_DB_STEP_DEADLINE_MS, `robot ${robotId} persisted motion lock check`);
  } catch (err) {
    return { error: String((err as Error)?.message ?? err).slice(0, 160) };
  }
}

// ── doc 81 Đợt 10 task D (design §2.11 / §2.12, re-review N1) — CENTRAL's motion-authority read ──────────────────────────
/**
 * N1 — the lock was honoured in one direction only: central never read robot_motion_locks, so a lock the EDGE set did not stop
 * central from moving the robot. Now central reads, at MOTION time (never for a STOP — L-7), bounded like every robot DB step:
 *   • the robot's OWNER (0374 robots.edgeNodeId): owned by an edge node ⇒ ROBOT_OWNED_BY_EDGE (central has no session for it —
 *     and must not move it even if a session from before an ownership change is still open);
 *   • its persisted LOCK ROW of any authority: a row central did NOT write itself — an 'edge:<n>' authority, or the DB's
 *     'ownerChanged' relock of an ownership change — refuses motion. A 'central' row written by central mirrors central's own
 *     in-memory lock (robotMotionLockStore), which stays its source of truth: it is not re-read as a gate (a just-cleared lock
 *     whose DELETE is still in flight would otherwise re-lock the robot after a confirmed STOP).
 *   • unreadable (no DB, error, timeout) ⇒ `{ error }` ⇒ the caller refuses motion (fail-closed). A DB without 0374
 *     (42P01 / 42703) has no edge owners and no authority column ⇒ `{ ok: true, schemaMissing: true }` (central unchanged).
 * Narrow projections (edgeControlSchema), never the full drizzle tables (0368 lesson).
 */
export const ROBOT_OWNED_BY_EDGE = "ROBOT_OWNED_BY_EDGE" as const;
export const OWNER_CHANGED_REASON_CODE = "ownerChanged" as const;

export type CentralMotionAuthorityRead =
  | { ok: true; schemaMissing?: true; noDb?: true; ownerEpoch?: number }
  | { ownedByEdge: number; ownerEpoch: number }
  | { locked: true; authority: string; reasonCode: string; detail: string | null; since: string; generation: number; ownerEpoch: number | null }
  | { error: string };

export async function readCentralMotionAuthority(robotId: number): Promise<CentralMotionAuthorityRead> {
  try {
    const read = (async (): Promise<CentralMotionAuthorityRead> => {
      const { robotOwnership, robotMotionLockAuthority, isEdgeControlSchemaMissing } = await import("../edge/edgeControlSchema");
      const db = await getDb();
      // No DB configured at all: nothing can move here anyway — the real path's write-ahead ledger row requires the DB and
      // refuses (LEDGER_WRITE_FAILED), the dry-run path sends nothing. Defer to that gate (its refusal is the existing one).
      if (!db) return { ok: true, noDb: true };
      try {
        const [own] = await db.select().from(robotOwnership).where(eq(robotOwnership.id, robotId)).limit(1);
        const owner = (own as { edgeNodeId?: unknown } | undefined)?.edgeNodeId;
        if (typeof owner === "number" && Number.isSafeInteger(owner)) return { ownedByEdge: owner, ownerEpoch: Number((own as { ownerEpoch?: unknown }).ownerEpoch ?? 0) };
        const [row] = await db.select().from(robotMotionLockAuthority).where(eq(robotMotionLockAuthority.robotId, robotId)).limit(1);
        const r = row as Partial<typeof robotMotionLockAuthority.$inferSelect> | undefined;
        if (r && r.robotId === robotId && ((typeof r.authority === "string" && r.authority !== "central") || r.reasonCode === OWNER_CHANGED_REASON_CODE)) {
          return {
            locked: true,
            authority: String(r.authority ?? "central"),
            reasonCode: String(r.reasonCode),
            detail: r.detail ?? null,
            since: new Date(r.lockedAt ?? Date.now()).toISOString(),
            generation: Number(r.generation ?? 0),
            ownerEpoch: r.ownerEpoch == null ? null : Number(r.ownerEpoch),
          };
        }
        const observed = Number((own as { ownerEpoch?: unknown } | undefined)?.ownerEpoch);
        return Number.isSafeInteger(observed) ? { ok: true, ownerEpoch: observed } : { ok: true };
      } catch (err) {
        if (isEdgeControlSchemaMissing(err)) return { ok: true, schemaMissing: true };
        throw err;
      }
    })();
    return await withDeadline(read, STOP_DB_STEP_DEADLINE_MS, `robot ${robotId} motion authority check`);
  } catch (err) {
    return { error: String((err as Error)?.message ?? err).slice(0, 160) };
  }
}

/**
 * doc 81 Đợt 10 task D — ruling R-10-g (M4). `robot_jobs` has no FK to `robots`, so a motion whose authority read (above) passed
 * could still insert its 'running' row at the same moment as an ownership change / relock committed, slipping past 0374's
 * "no owner change while a job runs" guard. Closed on the INSERT side: in the SAME transaction as the 'running' row, the robot
 * row is locked `FOR SHARE` (an owner change — an UPDATE of the row — now waits for this transaction and then sees the running
 * job and is refused; one that committed first is seen here), and the authority is re-read under that lock:
 *   • edge-owned now ⇒ ROBOT_OWNED_BY_EDGE; owner epoch ≠ the one observed at the authority read ⇒ OWNER_CHANGED;
 *   • a lock row central did not write (edge authority, or the ownerChanged relock) ⇒ MOTION_LOCKED.
 * Any error other than "0374 not applied" (42P01 / 42703, savepoint-contained) is THROWN ⇒ the caller's reservation fails ⇒
 * nothing is sent (fail-closed). Returns null when the motion may proceed.
 * Capability: only a handle that cannot run SQL (`execute` absent — the in-memory test fakes of the dispatcher suites) skips
 * the re-read; every drizzle / postgres handle has it.
 */
export type MotionAuthorityRecheck = { code: typeof ROBOT_OWNED_BY_EDGE | "MOTION_LOCKED" | "OWNER_CHANGED"; detail: string };
type SqlTx = { execute: (q: ReturnType<typeof sql>) => Promise<unknown>; transaction?: <T>(fn: (sp: SqlTx) => Promise<T>) => Promise<T> };
const firstRows = (r: unknown): Array<Record<string, unknown>> => (Array.isArray(r) ? (r as Array<Record<string, unknown>>) : (((r as { rows?: unknown[] })?.rows ?? []) as Array<Record<string, unknown>>));

export async function recheckMotionAuthorityInTx(tx: unknown, robotId: number, observedOwnerEpoch?: number | null): Promise<MotionAuthorityRecheck | null> {
  const t = tx as SqlTx;
  if (!t || typeof t.execute !== "function") return null;
  const { isEdgeControlSchemaMissing } = await import("../edge/edgeControlSchema");
  const read = async (h: SqlTx) => {
    const own = firstRows(await h.execute(sql`SELECT "edgeNodeId", "ownerEpoch" FROM public.robots WHERE id = ${robotId} FOR SHARE`));
    const lock = firstRows(await h.execute(sql`SELECT authority, "reasonCode", generation FROM public.robot_motion_locks WHERE "robotId" = ${robotId}`));
    return { own: own[0], lock: lock[0] };
  };
  let got: { own?: Record<string, unknown>; lock?: Record<string, unknown> };
  try {
    // a savepoint keeps a "0374 missing" error from aborting the reservation transaction
    got = typeof t.transaction === "function" ? await t.transaction((sp) => read(sp)) : await read(t);
  } catch (err) {
    if (isEdgeControlSchemaMissing(err)) return null; // no edge owners / authority column before 0374 — central unchanged
    throw err;
  }
  // no robot row: nothing owns it and no owner change can race on it (the enabled gate refuses a missing row at motion time)
  if (!got.own) return null;
  const owner = got.own.edgeNodeId;
  if (owner !== null && owner !== undefined) return { code: ROBOT_OWNED_BY_EDGE, detail: `robot ${robotId} became owned by edge node ${String(owner)} before the motion was reserved` };
  const epoch = Number(got.own.ownerEpoch);
  if (observedOwnerEpoch != null && Number.isFinite(epoch) && epoch !== observedOwnerEpoch) {
    return { code: "OWNER_CHANGED", detail: `robot ${robotId}: owner epoch ${observedOwnerEpoch} → ${epoch} since the authority read` };
  }
  const l = got.lock;
  if (l && ((typeof l.authority === "string" && l.authority !== "central") || l.reasonCode === OWNER_CHANGED_REASON_CODE)) {
    return { code: "MOTION_LOCKED", detail: `robot ${robotId}: a lock not written by this process stands (${String(l.authority)}: ${String(l.reasonCode)}, generation ${String(l.generation)})` };
  }
  return null;
}
