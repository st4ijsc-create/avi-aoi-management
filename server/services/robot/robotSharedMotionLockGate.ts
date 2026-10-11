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
import { eq } from "drizzle-orm";
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
