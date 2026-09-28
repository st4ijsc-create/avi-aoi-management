/**
 * doc 81 Đợt 1C Task 3 (owner decision 2026-09-27: "Đóng") — the AUTOMATED robot path's HITL action.
 *
 * The robot dispatcher now refuses `triggerKind:"hitl"` without an actionId (HITL_ACTION_REQUIRED).
 * An automated producer that has no human-confirmed action of its own (VDA5050 adapter, ROS2 bridge)
 * therefore creates one here, on the SAME pattern as foeEngine.ensureOrchestrationAction:
 *   • an ai_pending_actions row in status 'confirmed', owned by the confirmer the caller names;
 *   • previewJson carries robotPayloadHash(robotId, jobType, params) of EXACTLY the job about to be
 *     dispatched (otActionBinding — the one canonical form the dispatcher re-computes);
 *   • the dispatcher verifies it under SELECT … FOR UPDATE and consumes it confirmed→executed once.
 * The row is never shown in the action inbox (the inbox only lists 'proposed').
 *
 * Fail-closed: no owner, no DB or any insert error ⇒ `null` ⇒ the caller dispatches WITHOUT an
 * actionId ⇒ the dispatcher rejects it (HITL_ACTION_REQUIRED) with a ledger row, before any driver call.
 *
 * ⚠ Same caveat as FOE (doc 81 BE2 §L2, CÒN MỞ): this is a SELF-GRANT — no second human confirms the
 * automated command. What it adds over the closed path: the grant is bound to one exact job, is
 * single-use, expires, and leaves an auditable row naming the tool and the owner.
 */
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { aiPendingActions } from "../../../drizzle/schema";
import { readOtPayloadHash, robotPayloadHash, withOtPayloadHash } from "../ot/otActionBinding";
import type { RobotJobSpec } from "./robotDriver";

/** Tools that mint automated robot actions (ai_pending_actions.tool). */
export type RobotAutomationTool = "vda5050.automation" | "ros2.automation";

/** Lifetime of a minted action: it is created right before its dispatch, so minutes are ample. */
export const ROBOT_AUTOMATION_ACTION_TTL_MS = 5 * 60_000;

/**
 * ai_pending_actions.id is varchar(64). Fix round 1 (item 2): a key that does not fit is HASHED, never
 * truncated — two long keys sharing their first 64 characters used to collide on one id (and one row).
 * The hashed form carries its own prefix (`…h-`) so it can never equal a literal short key.
 */
function automationActionId(tool: RobotAutomationTool, idempotencyKey?: string): string {
  const prefix = tool === "vda5050.automation" ? "vda5050" : "ros2";
  const key = idempotencyKey?.trim() || randomUUID();
  const id = `${prefix}-${key}`;
  if (id.length <= 64) return id;
  const hashed = `${prefix}h-${createHash("sha256").update(key, "utf8").digest("hex")}`;
  return hashed.slice(0, 64);
}

/**
 * Create (idempotent per idempotencyKey) a 'confirmed' ai_pending_actions row bound to exactly
 * `job` on `robotId`, owned by `ownerUserId`. Returns its id, or null when it cannot be created.
 * Fix round 1 (items 2 + 4): INSERT … ON CONFLICT DO NOTHING, then — when the row already existed —
 * re-SELECT it and reuse it ONLY if it is the same tool, the same owner and carries the hash of THIS
 * job; anything else ⇒ null (fail-closed: the motion is refused, never run on a foreign row). No more
 * select-then-insert race (concurrent callers with one key all get the one row). Callers mint only for
 * MOTION jobs (isMotionJob) — a STOP never depends on this row.
 */
export async function ensureBoundRobotAction(opts: {
  tool: RobotAutomationTool;
  robotId: number;
  job: RobotJobSpec;
  ownerUserId: number | undefined;
  idempotencyKey?: string;
}): Promise<string | null> {
  if (!opts.ownerUserId) return null; // nobody to bind the grant to ⇒ fail-closed
  try {
    const db = await getDb();
    if (!db) return null;
    const id = automationActionId(opts.tool, opts.idempotencyKey);
    const hash = robotPayloadHash({ robotId: opts.robotId, jobType: opts.job.jobType, params: opts.job.params ?? null });
    const inserted = await db
      .insert(aiPendingActions)
      .values({
        id,
        tool: opts.tool,
        argsJson: { robotId: opts.robotId, jobType: opts.job.jobType },
        userId: opts.ownerUserId,
        userRole: "automation",
        summary: `${opts.tool}: robot ${opts.robotId} ${opts.job.jobType}`,
        previewJson: withOtPayloadHash(null, hash),
        status: "confirmed",
        idempotencyKey: id,
        expiresAt: new Date(Date.now() + ROBOT_AUTOMATION_ACTION_TTL_MS),
      })
      .onConflictDoNothing()
      .returning({ id: aiPendingActions.id });
    if (inserted.length === 1) return inserted[0].id;
    // Already there (a retry, a concurrent caller, or a collision): reuse only a row minted for THIS job.
    const [existing] = await db.select().from(aiPendingActions).where(eq(aiPendingActions.id, id)).limit(1);
    const matches =
      !!existing &&
      existing.tool === opts.tool &&
      existing.userId === opts.ownerUserId &&
      readOtPayloadHash(existing.previewJson) === hash;
    if (!matches) {
      console.warn(`[Robot] ${opts.tool}: action id for robot ${opts.robotId} is taken by a row bound to another job/owner — command will be refused`);
      return null;
    }
    return existing.id;
  } catch (err) {
    console.warn(`[Robot] ${opts.tool}: could not create the bound HITL action for robot ${opts.robotId} — command will be refused:`, (err as Error)?.message ?? err);
    return null;
  }
}
