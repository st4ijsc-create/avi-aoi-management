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
 * ⚠ Same caveat as FOE (doc 81 BE2 §L2): this is a SELF-GRANT — no second human confirms the
 * automated command. What it adds over the closed path: the grant is bound to one exact job, is
 * single-use, expires, and leaves an auditable row naming the tool and the owner.
 * Owner decision 2026-10-11 (doc 81 Đợt 7): the self-grant is KEPT as it is (bound, single-use, TTL, audited) and
 * documented in doc 81 §15.
 *
 * doc 81 Đợt 7 task I5 — PER-ROBOT "automation off" switch. While it is OFF for a robot, the automation grant is REFUSED:
 *   • here, before minting (no row is created; the caller dispatches without an actionId ⇒ HITL_ACTION_REQUIRED), and
 *   • in the robot dispatcher, when it consumes a row of an automation tool (a grant minted just before the switch was
 *     turned off) — robotCommandDispatcher.reserveRobotJob, inside its reservation transaction.
 *   STOPs are untouched: no STOP ever mints or consumes one of these rows (callers mint for MOTION jobs only; the dispatcher
 *   never verifies a STOP's row). An operator's own 'manual' command and a caller-supplied actionId are not automation.
 *   Storage: `system_settings` key `robot.automation.off.<robotId>` = "true" (off) / "false" or no row (on); changed only
 *   through robot.disableAutomation / robot.enableAutomation (reason required, audited before the change).
 *   ★ CANNOT DECIDE — the switch cannot be read (no DB, a query error, an unknown value): the grant is REFUSED (fail-closed;
 *   it only ever withholds motion). Every refusal is logged and audited (robot.automationRefused).
 */
import { createHash, randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { aiPendingActions, systemSettings } from "../../../drizzle/schema";
import { readOtPayloadHash, robotPayloadHash, withOtPayloadHash } from "../ot/otActionBinding";
import type { RobotJobSpec } from "./robotDriver";

/** Tools that mint automated robot actions (ai_pending_actions.tool). */
export type RobotAutomationTool = "vda5050.automation" | "ros2.automation";

/** doc 81 Đợt 7 I5 — the ai_pending_actions tools of the automation self-grant (what the switch governs). */
export const ROBOT_AUTOMATION_TOOLS: readonly RobotAutomationTool[] = ["vda5050.automation", "ros2.automation"];
export function isRobotAutomationTool(tool: unknown): tool is RobotAutomationTool {
  return typeof tool === "string" && (ROBOT_AUTOMATION_TOOLS as readonly string[]).includes(tool);
}

/** doc 81 Đợt 7 I5 — the system_settings key of a robot's automation switch. */
export const ROBOT_AUTOMATION_OFF_KEY_PREFIX = "robot.automation.off.";
export function robotAutomationOffKey(robotId: number): string {
  return `${ROBOT_AUTOMATION_OFF_KEY_PREFIX}${robotId}`;
}

/** "on" (no row, or "false"), "off" ("true"), "unknown" (unreadable / any other value — treated as OFF by every check). */
export type RobotAutomationState = "on" | "off" | "unknown";

type SettingsDb = { select: (...a: any[]) => any };

function stateOf(value: string | null | undefined, present: boolean): RobotAutomationState {
  if (!present) return "on";
  if (value === "false") return "on";
  if (value === "true") return "off";
  return "unknown";
}

/** doc 81 Đợt 7 I5 — the switch of ONE robot (`db` = a connection or a transaction). Never throws. */
export async function readRobotAutomationState(db: SettingsDb | null | undefined, robotId: number): Promise<RobotAutomationState> {
  try {
    if (!db) return "unknown";
    const rows = (await db
      .select({ value: systemSettings.settingValue })
      .from(systemSettings)
      .where(eq(systemSettings.settingKey, robotAutomationOffKey(robotId)))
      .limit(1)) as Array<{ value: string | null }>;
    return stateOf(rows[0]?.value, rows.length > 0);
  } catch {
    return "unknown";
  }
}

/** doc 81 Đợt 7 I5 — the switches of many robots (robot.list); a failed read ⇒ every one "unknown". */
export async function readRobotAutomationStates(db: SettingsDb | null | undefined, robotIds: number[]): Promise<Map<number, RobotAutomationState>> {
  const out = new Map<number, RobotAutomationState>();
  if (robotIds.length === 0) return out;
  if (!db) {
    for (const id of robotIds) out.set(id, "unknown");
    return out;
  }
  try {
    const rows = (await db
      .select({ key: systemSettings.settingKey, value: systemSettings.settingValue })
      .from(systemSettings)
      .where(inArray(systemSettings.settingKey, robotIds.map(robotAutomationOffKey)))) as Array<{ key: string; value: string | null }>;
    const byKey = new Map(rows.map((r) => [r.key, r.value] as const));
    for (const id of robotIds) {
      const k = robotAutomationOffKey(id);
      out.set(id, stateOf(byKey.get(k), byKey.has(k)));
    }
  } catch {
    for (const id of robotIds) out.set(id, "unknown");
  }
  return out;
}

/** doc 81 Đợt 7 I5 — a refused automation grant: one console line (always) + one audit row (best-effort, never throws). */
export function auditAutomationRefused(robotId: number, tool: string, state: RobotAutomationState, stage: "mint" | "dispatch", ownerUserId?: number): void {
  console.warn(`[Robot] ${tool}: automation grant for robot ${robotId} REFUSED at ${stage} — the robot's automation switch is ${state === "off" ? "OFF" : "unreadable (treated as OFF)"}; STOPs are not affected`);
  void (async () => {
    try {
      const { createAuditLog } = await import("../../db");
      await createAuditLog({
        userId: ownerUserId ?? 0,
        userName: null,
        action: "robot.automationRefused",
        entityType: "robot",
        entityId: robotId,
        entityName: null,
        status: "failure",
        details: { tool, state, stage },
      });
    } catch (err) {
      console.error(`[Robot] audit of a refused automation grant failed (robot ${robotId}):`, (err as Error)?.message ?? err);
    }
  })();
}

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
    // doc 81 Đợt 7 I5 — the robot's automation switch: OFF (or unreadable) ⇒ no grant (the motion is refused).
    const state = await readRobotAutomationState(db, opts.robotId);
    if (state !== "on") {
      auditAutomationRefused(opts.robotId, opts.tool, state, "mint", opts.ownerUserId);
      return null;
    }
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
