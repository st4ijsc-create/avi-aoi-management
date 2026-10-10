/**
 * Phase 3 — Robot command dispatcher: the SINGLE gated path to run a motion job.
 *
 * Mirrors the OT commandDispatcher safety model. NOT exported to tRPC as a
 * mutation — reachable only from an internal caller (an AI write-tool after HITL
 * confirm, or a server-side operator action). Gates, in order:
 *   1. idempotency (per key, terminal job returned as-is — no blind re-run),
 *   2. HITL: triggerKind='hitl' requires a confirmedBy user AND — when an actionId is
 *      supplied — a re-verified ai_pending_actions row (confirmed/executed + owner match),
 *      symmetric to the OT commandDispatcher (doc 25 T1); fail-closed on any mismatch.
 *      doc 81 Đợt 1B final wave (item 2): that entry check is READ-ONLY and only guards the
 *      dry-run path; the REAL path (step 5) re-verifies under SELECT … FOR UPDATE that the row
 *      is 'confirmed', unexpired, owned by the confirmer AND bound to THIS robot/jobType/params
 *      (otActionBinding.robotPayloadHash), then consumes it confirmed→executed by CAS in the
 *      same transaction as the 'running' ledger row. Fix round 1 of doc 81 Đợt 1C Task 3 (R-1C-c):
 *      the whole of step 2 applies to MOTION only — a STOP is never refused on HITL grounds. Without an actionId step 2 is the whole
 *      gate ('manual' keeps ruling R11: confirmedBy === requestedBy).
 *      doc 81 Đợt 1C Task 3 (owner decision 2026-09-27 "Đóng"): 'hitl' + a MOTION job + NO actionId
 *      is refused outright (rejected, HITL_ACTION_REQUIRED, code PRECONDITION_FAILED) in every mode,
 *      before any driver call — a 'hitl' label without a confirmed action behind it is not HITL. A
 *      STOP (abort) is never refused on that ground. Automated producers mint a bound action first
 *      (robotAutomationAction.ensureBoundRobotAction); operator clicks use 'manual' (R11),
 *   3. active + connected driver,
 *   4. MODE GATE: ROBOT_CONTROL_ENABLED!=='true' → record status 'simulated',
 *      never call driver.runJob (default is dry-run),
 *   4a. commissioning/FAT gate, 4a-policy. policy-as-code seam (W3-B2, SEC_PLATFORM,
 *      action robot.command.{verb} — DENY → rejected POLICY_DENIED), 4a-safety. safety-PLC
 *      preflight (motion only; anything but OK blocks), 4b. interlock gate,
 *   5-R14. per-robot MOTION slot (final wave, ruling R14): a second motion on a robot whose
 *      motion is still in flight in this process is refused (robot_motion_in_progress); a stop
 *      never is,
 *   5. real run under timeout: ledger row 'running' FIRST (fail-closed), then runJob; on a
 *      timeout the driver's stop is sent BEFORE the row is finalised 'failed'.
 * Every branch writes a robot_jobs row; a ledger write failure is never swallowed.
 *
 * doc 81 Đợt 1B Task 5 (BE2 §L2 robotCommandDispatcher, §3 S5/S9) changed four things:
 *   • HITL also applies to triggerKind='manual' for MOTION jobs (see isMotionJob / step 2).
 *   • safety-PLC preflight (the OT adapter facade's getSafetyStatus) before motion.
 *   • record() no longer swallows insert errors; the pre-motion row is mandatory.
 *   • a motion whose outcome is unknown (deadline / driver reply timeout) is stopped.
 */
import { createHash } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { pgTable, serial, integer, varchar, timestamp, text } from "drizzle-orm/pg-core";
import { getDb } from "../../db/connection";
import { robotJobs, robots, aiPendingActions, type AiPendingAction } from "../../../drizzle/schema";
import { FOE_ENGINE_TOOL, foeSelfApprovalRefusal, readOtPayloadHash, robotPayloadHash } from "../ot/otActionBinding";
import { foeApprovalDbRefusal } from "../orchestration/foe/foeGateApproval"; // doc 81 Đợt 4 fix round 1 (R-4-i)
import { getActiveRobot } from "./robotManager";
import type { RobotJobSpec, RobotDriver, RobotJobResult } from "./robotDriver";
import {
  MOTION_OUTCOME_UNKNOWN_REASON_CODES,
  MOTION_LOCKED_REASON_CODE,
  DISPATCH_DEADLINE_REASON_CODE,
  RobotAbortUnsupportedError,
} from "./robotDriver";
import { withDeadline } from "../ot/drivers/boundedClose";
import { isStopJob } from "./stopJob"; // residual round 2 — one classifier for dispatcher, drivers, motion lock
import { isRobotSafetyPreflightEnabled, safetyPreflightReason, type SafetyUnknownBasis } from "../ot/safetyPreflightPolicy"; // final wave (item 3)

/**
 * CTL-02 (doc 40) — ROBOT COMMISSIONING / FAT LEDGER (bảng migration 0240). Định nghĩa
 * table INLINE ở đây (đúng shape với 0240_robot_commissioning.sql) vì đây là consumer duy
 * nhất và schema robot.ts nằm ngoài phạm vi sửa của Wave 2. Song song với OT
 * commissioning_records nhưng khoá theo robotId (KHÔNG tái dùng adapterId để tránh trùng
 * khoá số giữa robot và OT-adapter). Chỉ bản ghi status='active' + chưa hết hạn mới
 * commission một robot cho real-motion.
 */
const robotCommissioningRecords = pgTable("robot_commissioning_records", {
  id: serial("id").primaryKey(),
  robotId: integer("robotId").notNull(),
  status: varchar("status", { length: 16 }).default("active").notNull(),
  fatReference: varchar("fatReference", { length: 255 }),
  signedBy: integer("signedBy").notNull(),
  signedAt: timestamp("signedAt").defaultNow().notNull(),
  expiresAt: timestamp("expiresAt"),
  revokedBy: integer("revokedBy"),
  revokedAt: timestamp("revokedAt"),
  revokeReason: text("revokeReason"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/**
 * Cờ chủ cho CTL-02 gate. Khi ON (MẶC ĐỊNH — an toàn theo mặc định) dispatcher đòi robot
 * đã commissioned TRƯỚC một real-write; robot chưa commissioned bị ÉP xuống nhánh 'simulated'.
 * Chỉ "false"/"0" tường minh mới tắt (legacy/dev). Đọc ở RUNTIME (không phải lúc load module).
 * Đối xứng OT_COMMISSIONING_REQUIRED.
 */
export function isRobotCommissioningRequired(): boolean {
  const v = process.env.ROBOT_COMMISSIONING_REQUIRED;
  return !(v === "false" || v === "0"); // DEFAULT ON: chỉ opt-out tường minh mới tắt.
}

/**
 * TRUE iff `robotId` có ≥1 bản ghi commissioning status='active', chưa hết hạn, đã ký.
 * Fail-safe: DB không sẵn ⇒ FALSE (⇒ dispatcher KHÔNG real-write; degrade về simulated).
 * Chỉ có thể NGHIÊM NGẶT hơn hành vi trước — không bao giờ cho phép một write chưa được phép.
 */
export async function isRobotCommissioned(robotId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false; // fail-safe: no DB ⇒ coi như CHƯA commissioned.
  const rows = await db
    .select()
    .from(robotCommissioningRecords)
    .where(and(eq(robotCommissioningRecords.robotId, robotId), eq(robotCommissioningRecords.status, "active")));
  if (!Array.isArray(rows)) return false; // fail-safe: kết quả bất thường ⇒ coi như CHƯA commissioned.
  const now = Date.now();
  return rows.some((r) => {
    if (r.status !== "active") return false;
    if (r.expiresAt == null) return true;
    return new Date(r.expiresAt).getTime() > now;
  });
}

/**
 * X1-e — resolve the (equipmentClass, userRole) the command-authz guard needs.
 * equipmentClass maps the robot kind → a capability class (mirrors taskAllocator's
 * robotKindToCapabilityClass — robots resolve to "ROBOT"). Fail-safe defaults so the
 * guard can still decide (a missing user → role "user", which lacks control perms →
 * denied under the strict flag, which is the safe outcome).
 */
async function resolveRobotAuthzContext(
  robotId: number,
  userId: number,
): Promise<{ equipmentClass: string; userRole: string }> {
  let equipmentClass = "ROBOT";
  let userRole = "user";
  try {
    const db = await getDb();
    if (db) {
      const [r] = await db.select({ kind: robots.kind }).from(robots).where(eq(robots.id, robotId)).limit(1);
      // All robot kinds (arm/scara/cobot/agv) resolve to the ROBOT capability class.
      if (r) equipmentClass = "ROBOT";
      const { getUserById } = await import("../../db/auth");
      const user = await getUserById(userId);
      if (user?.role) userRole = user.role;
    }
  } catch {
    /* fail-safe defaults (user role lacks control perms → denied under strict flag) */
  }
  return { equipmentClass, userRole };
}

export interface RobotDispatchInput {
  robotId: number;
  job: RobotJobSpec;
  triggerKind?: "hitl" | "manual";
  actionId?: string;
  requestedBy: number;
  confirmedBy?: number;
  idempotencyKey?: string;
  /**
   * doc 81 Đợt 1C residual 1 (R-1C-m) — SET BY THE DISPATCHER ONLY (a caller's value is overwritten): true when a
   * STOP's caller-supplied params were dropped. Recorded on its ledger rows as `ignoredParams: true`.
   */
  ignoredParams?: boolean;
}

export interface RobotDispatchResult {
  ok: boolean;
  status: "done" | "failed" | "simulated" | "rejected";
  jobId?: number;
  error?: string;
  /** doc 81 Đợt 1C Task 3 — error class of a refusal (today only HITL_ACTION_REQUIRED sets it). */
  code?: "PRECONDITION_FAILED";
  /** Set when the motion ran but its terminal ledger update failed (row stays 'running'). */
  ledgerError?: string;
  /**
   * doc 81 Đợt 4 Task B1 — the driver's OWN result detail, untouched (only when the driver returned a result; absent on
   * refusal / dry-run / timeout / throw). Lets a caller report what the driver really did (VDA 5050: `published`)
   * instead of doing it a second time.
   */
  driverDetail?: Readonly<Record<string, unknown>>;
}

/**
 * Doc 80 Đợt 1 final wave (item 5) — vị từ DUY NHẤT "điều khiển robot THẬT đang bật" (cổng bước 4).
 * Bảng tư thế Hub (`oversightRouter.posture`) và bảng nguồn an toàn (`safetySourceHealth`) đọc qua đây,
 * không tự parse `process.env.ROBOT_CONTROL_ENABLED` — để dải hiển thị không bao giờ khác cổng thật.
 */
export function isRobotControlEnabled(): boolean {
  return process.env.ROBOT_CONTROL_ENABLED === "true";
}

function controlEnabled(): boolean {
  return isRobotControlEnabled();
}

/**
 * doc 81 Đợt 1B Task 5 — a job that can move the robot. Only `abort` (a stop) is not:
 * it stays exempt from the manual-HITL and safety preflight gates so a stop can never
 * be locked out by the very conditions that call for it.
 */
export function isMotionJob(job: RobotJobSpec): boolean {
  // doc 81 Đợt 1C residual 1 (R-1C-m) — `stop` / `e_stop` arriving as a run_job jobType are STOPs too (the verb
  // mapping already sends them as `abort`); they are canonicalised to `abort` before any driver sees them.
  // Anything else — including an unknown type — stays MOTION (fail-closed: fully gated).
  // residual round 2 — the ONE shared classifier (stopJob.ts), also used by every driver and the motion lock.
  return !isStopJob(job);
}

/**
 * doc 81 Đợt 1C residual 1 (ruling R-1C-m, LAYER a) — the ONLY job a driver ever receives for a STOP. A non-motion
 * job skips every motion gate, so it must not be able to carry anything a driver could turn into motion:
 * `api/v1` / FOE `run_job {jobType:"abort", params:{order:{…}}}` used to reach the VDA 5050 driver, which ignored
 * the job type and published `params.order` as an ORDER. The caller's params are dropped; the ledger records
 * only `ignoredParams: true` (never their values). Frozen: nothing downstream can add to it.
 */
export const CANONICAL_STOP_JOB: Readonly<RobotJobSpec> = Object.freeze({ jobType: "abort", params: Object.freeze({}) as Record<string, unknown> });

/**
 * doc 81 Đợt 1B Task 5 — the key the robot's interlock gate (and the console's
 * interlockPreview) evaluates. Decision after reading interlockGate.isTargeted: the gate
 * does NOT need a real OT adapter — a rule reaches a command through targetAdapterId,
 * targetMachineId or commandTag. A robot has no device_adapters row, so no adapter id is
 * real for it; ROBOT_NO_OT_ADAPTER_ID (-1) can never equal a device_adapters.id (serial ≥ 1)
 * nor an interlockRouter targetAdapterId (z.number().int().positive()), so an adapter- or
 * tag-targeted OT rule never blocks a robot by accident. The robot itself is keyed as
 * machineId = robotId, the convention interlockEngine already uses for robot rules
 * (robotId = rule.targetMachineId ?? rule.machineId).
 */
export const ROBOT_NO_OT_ADAPTER_ID = -1;
export function robotInterlockTarget(robotId: number): { adapterId: number; machineId: number; tagKeys: string[] } {
  return { adapterId: ROBOT_NO_OT_ADAPTER_ID, machineId: robotId, tagKeys: [] };
}

/** Upper bound for the safety-PLC preflight read (a hung read must not hang the command). */
const SAFETY_PREFLIGHT_DEADLINE_MS = 5000;

/**
 * doc 81 Đợt 1C final wave 1 (ruling R-1C-h, final review I2) — deadline of ONE DB step on the STOP
 * (non-motion) path. Four DB steps stood before `driver.runJob` of a STOP: the idempotency lookup, the
 * commissioning check (gate 4a), the commissioning re-read inside the policy block and the 'running'
 * ledger pre-write. Any of them throwing refused the STOP; any of them hanging hung it. Now each is
 * bounded (≤ 1.5 s per the ruling) and a failure/timeout NEVER stops the STOP: it is sent, and its ledger
 * row is written best-effort afterwards. MOTION keeps its fail-closed behaviour (no deadline added there).
 */
export const ROBOT_STOP_DB_STEP_DEADLINE_MS = 1000;

export type StopDbStep =
  | "idempotency_lookup"
  | "commissioning_check"
  | "authz_check"
  | "policy_role_lookup"
  | "policy_commissioning_check"
  | "ledger_prewrite";

/**
 * doc 81 Đợt 1C residual 2 — on the STOP path a null `getDb()` (DB not configured / pool not ready) is treated like
 * a DB error: thrown here so StopDbBudget marks the DB degraded, logs it, and the STOP takes the energy-reducing
 * default (sent to the registered driver; ledger best-effort). Motion never calls this (it stays fail-closed).
 */
export class StopDbUnavailableError extends Error {
  readonly reasonCode = "stop_db_unavailable" as const;
  constructor() {
    super("DB unavailable (getDb returned null)");
    this.name = "StopDbUnavailableError";
  }
}
async function requireDbForStop(): Promise<Db> {
  const db = await getDb();
  if (!db) throw new StopDbUnavailableError();
  return db;
}

/** An error text safe for logs and the ledger: credentials in a connection string are masked, length capped. */
function safeDbError(err: unknown): string {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return raw
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]*@/gi, "$1***@")
    .replace(/(password|pwd|secret|token)\s*[=:]\s*\S+/gi, "$1=***")
    .slice(0, 240);
}

/**
 * R-1C-h — the DB budget of ONE STOP dispatch. Each step runs under ROBOT_STOP_DB_STEP_DEADLINE_MS; the
 * first failure marks the DB "degraded" and every later step is SKIPPED (a hung DB costs the STOP one
 * deadline in total, not one per step). A skipped/failed step returns `{ ok: false }` and the caller
 * takes the energy-reducing default (no replay, "commissioned", no pre-write). Never throws.
 */
class StopDbBudget {
  degraded: { step: StopDbStep; error: string } | null = null;
  constructor(private readonly robotId: number) {}
  async run<T>(step: StopDbStep, fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
    if (this.degraded) return { ok: false, error: `skipped: DB degraded at ${this.degraded.step}` };
    try {
      return { ok: true, value: await withDeadline(Promise.resolve().then(fn), ROBOT_STOP_DB_STEP_DEADLINE_MS, `STOP ${step}`) };
    } catch (err) {
      const error = safeDbError(err);
      this.degraded = { step, error };
      console.error(`[Robot] STOP on robot ${this.robotId}: DB step '${step}' failed or timed out — the STOP is still sent (R-1C-h): ${error}`);
      return { ok: false, error };
    }
  }
}

/**
 * doc 81 Đợt 4 Task B2 — the 'simulated' row of the mode gate (dry-run) and of the commissioning gate (robot KNOWN not
 * commissioned). For MOTION it is awaited as before. For a STOP (`stopDb` set) it runs under the same
 * ROBOT_STOP_DB_STEP_DEADLINE_MS as every other STOP DB step (R-1C-h): a hung or failing DB used to hang / refuse the
 * STOP's answer here. Timeout or error ⇒ still 'simulated' (nothing is sent in this branch, exactly as before),
 * `ledgerError: "LEDGER_WRITE_FAILED"`, logged without secrets. Worst case added to a STOP: one deadline (1 s).
 */
async function recordSimulated(
  input: RobotDispatchInput,
  result: Record<string, unknown>,
  errorText: string | undefined,
  stopDb: StopDbBudget | undefined,
): Promise<RobotDispatchResult> {
  const write = record(input, "simulated", result, errorText);
  if (!stopDb) return { ok: true, status: "simulated", jobId: await write };
  try {
    const jobId = await withDeadline(write, ROBOT_STOP_DB_STEP_DEADLINE_MS, "STOP simulated ledger");
    return { ok: true, status: "simulated", jobId };
  } catch (err) {
    console.error(`[Robot] STOP on robot ${input.robotId}: 'simulated' ledger row not written (B2, bounded): ${safeDbError(err)}`);
    return { ok: true, status: "simulated", ledgerError: "LEDGER_WRITE_FAILED" };
  }
}

/** A robot_jobs write failed — never swallowed (doc 81 Đợt 1B Task 5). */
export class RobotLedgerWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RobotLedgerWriteError";
  }
}

/**
 * Append a robot_jobs row. Insert errors are THROWN as RobotLedgerWriteError (they used to
 * be logged and swallowed ⇒ a robot could move with no ledger entry). `requireDb` makes a
 * missing DB an error too — used for the pre-motion row; the non-motion branches keep the
 * old "no DB ⇒ no row" behaviour (nothing moves on those branches).
 */
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
/** A drizzle handle or the `tx` of `db.transaction(...)` — same query API (idiom of controlAuditService). */
type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/** robot_jobs.idempotencyKey is varchar(128), robot_jobs.actionId varchar(64). */
export const ROBOT_LEDGER_IDEMPOTENCY_KEY_MAX = 128;
export const ROBOT_LEDGER_ACTION_ID_MAX = 64;

/**
 * doc 81 Đợt 1C Task 3 fix round 2 (ruling (e)) — a caller-chosen key longer than its ledger column made the
 * robot_jobs INSERT fail ⇒ LEDGER_WRITE_FAILED ⇒ the command (a STOP too: api/v1 builds `apiv1-<key>`) was
 * refused. A key that does not fit is HASHED (never truncated — two long keys sharing a prefix must not
 * collide); a key that fits is kept byte-identical. Applied on the ledger path for EVERY job type.
 */
export const LEDGER_KEY_HASH_PREFIX = "h-sha256-";
export function fitLedgerKey(key: string | undefined, max: number): string | undefined {
  // doc 81 Đợt 1C final wave 2 (R-1C-i) — the hashed form's prefix is RESERVED: a literal key that already
  // starts with it is hashed too, so no literal key can ever equal the hashed form of another key (before,
  // a caller could pick the exact `h-sha256-…` string of a long key and share its ledger row / replay).
  if (key == null || (key.length <= max && !key.startsWith(LEDGER_KEY_HASH_PREFIX))) return key;
  return `${LEDGER_KEY_HASH_PREFIX}${createHash("sha256").update(key, "utf8").digest("hex")}`.slice(0, max);
}

async function record(
  input: RobotDispatchInput,
  status: RobotDispatchResult["status"] | "running",
  result: Record<string, unknown> | undefined,
  errorText?: string,
  opts: { requireDb?: boolean; db?: DbOrTx } = {},
): Promise<number | undefined> {
  // final wave (item 2) — `opts.db` lets the real path write its 'running' row inside the same
  // transaction that consumes the HITL action (a failed insert rolls the consume back).
  const db = opts.db ?? (await getDb());
  if (!db) {
    if (opts.requireDb) throw new RobotLedgerWriteError("robot ledger unavailable (no DB)");
    return undefined;
  }
  // residual 1 (R-1C-m) — a STOP whose caller params were dropped says so on EVERY row it writes (never the values).
  if (input.ignoredParams) result = { ...(result ?? {}), ignoredParams: true };
  try {
    const now = new Date();
    const [row] = await db.insert(robotJobs).values({
      robotId: input.robotId,
      jobType: input.job.jobType,
      params: input.job.params,
      status,
      triggerKind: input.triggerKind ?? "hitl",
      actionId: fitLedgerKey(input.actionId, ROBOT_LEDGER_ACTION_ID_MAX), // fix round 2 (e) — ledger copy only; verification uses the raw id
      requestedBy: input.requestedBy,
      confirmedBy: input.confirmedBy,
      idempotencyKey: input.idempotencyKey,
      result,
      errorText,
      startedAt: now,
      completedAt: status === "running" ? undefined : now,
    }).returning({ id: robotJobs.id });
    if (opts.requireDb && row?.id == null) throw new RobotLedgerWriteError("robot ledger insert returned no id");
    return row?.id;
  } catch (err) {
    if (err instanceof RobotLedgerWriteError) throw err;
    throw new RobotLedgerWriteError(`robot ledger insert failed: ${(err as Error)?.message ?? String(err)}`);
  }
}

/** Move the pre-motion row to its terminal state. Throws RobotLedgerWriteError on failure. */
async function finalize(
  jobId: number,
  status: "done" | "failed",
  result?: Record<string, unknown>,
  errorText?: string,
): Promise<void> {
  const db = await getDb();
  if (!db) throw new RobotLedgerWriteError("robot ledger unavailable (no DB) at finalize");
  try {
    await db
      .update(robotJobs)
      .set({ status, result, errorText, completedAt: new Date() })
      .where(eq(robotJobs.id, jobId));
  } catch (err) {
    throw new RobotLedgerWriteError(`robot ledger finalize failed: ${(err as Error)?.message ?? String(err)}`);
  }
}

type AbortOutcome =
  | { abort: "abort_sent" }
  | { abort: "abort_failed"; abortError: string }
  | { abort: "abort_unsupported"; abortError: string };

/**
 * doc 81 Đợt 1B Task 5 (BE2 §3 S5) — stop a motion whose outcome is unknown. Goes straight
 * to the driver's stop (NOT through the gates: a stop must never be blocked by them),
 * bounded by `deadlineMs`. Never throws; the outcome is recorded in the ledger.
 */
async function stopAfterUnknownOutcome(driver: RobotDriver, deadlineMs: number): Promise<AbortOutcome> {
  if (typeof (driver as Partial<RobotDriver>).abort !== "function") {
    return { abort: "abort_unsupported", abortError: `${driver.vendor} driver has no abort()` };
  }
  try {
    await withDeadline(driver.abort(), deadlineMs, `${driver.vendor} abort`);
    return { abort: "abort_sent" };
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    if (err instanceof RobotAbortUnsupportedError) return { abort: "abort_unsupported", abortError: msg };
    return { abort: "abort_failed", abortError: msg };
  }
}

/**
 * doc 81 Đợt 1B Task 5 fix round 1 (M1) — replay of a prior job with the same idempotency
 * key, mapped onto the RobotDispatchResult union (the DB enum also has running / draft /
 * pending / confirmed, which used to be cast straight into the union). A key whose job is
 * still `running` (or in any non-terminal state) is NOT re-run and NOT reported as done:
 * `rejected` + IDEMPOTENT_JOB_IN_PROGRESS.
 */
function idempotentReplay(prior: { id: number; status: string }): RobotDispatchResult {
  switch (prior.status) {
    case "done":
    case "simulated":
      return { ok: true, status: prior.status, jobId: prior.id };
    case "failed":
    case "rejected":
      return { ok: false, status: prior.status, jobId: prior.id };
    default:
      return { ok: false, status: "rejected", jobId: prior.id, error: "IDEMPOTENT_JOB_IN_PROGRESS" };
  }
}

/**
 * doc 81 Đợt 1C Task 3 — refusal reason: a MOTION job labelled triggerKind 'hitl' (the default)
 * carries no actionId, i.e. no confirmed ai_pending_actions row stands behind it. Returned with
 * code PRECONDITION_FAILED; never applied to a stop (abort).
 */
export const HITL_ACTION_REQUIRED = "HITL_ACTION_REQUIRED" as const;

/**
 * doc 81 Đợt 1C final wave 2 (R-1C-i) — refusal reason: a MOTION carries an idempotency key that already
 * belongs to a job of another robot / another job type. Never applied to a STOP (that is sent).
 */
export const IDEMPOTENCY_KEY_REUSED = "IDEMPOTENCY_KEY_REUSED" as const;

/** errorText written by the startup sweep on an orphaned `running` row. */
export const PROCESS_RESTART_OUTCOME_UNKNOWN = "process_restart_outcome_unknown" as const;

/**
 * doc 81 Đợt 1B final wave (ruling R14) — refusal reason: another MOTION job on the same robot
 * is in flight in this process. `rejected` status (no new enum value); never applied to a stop.
 */
export const ROBOT_MOTION_IN_PROGRESS = "robot_motion_in_progress" as const;

/**
 * Ruling R14 — PER-ROBOT MOTION SERIALISATION (this process). Two overlapping motions on one
 * robot used to share ONE transport session; on FANUC the SequenceIDs restart after every
 * FRC_Initialize, so M2's reply could be taken for M1's ("false done"). The only prior stop was
 * the robot_jobs.idempotencyKey UNIQUE, which exists only when a caller supplies a key.
 *
 * The slot is claimed SYNCHRONOUSLY (no await between the check and the set — JS is
 * single-threaded, so two concurrent dispatches cannot both pass) right before the real-motion
 * path starts, and released when that job's terminal ledger write is done (try/finally). A
 * second motion is REFUSED (rejected + ROBOT_MOTION_IN_PROGRESS), not queued. A STOP (abort)
 * never claims or checks the slot — it must always reach the robot. The dry-run/simulated path
 * never claims it (nothing moves). Restart drops it (like the driver motion lock).
 */
const motionInFlight = new Map<number, { jobType: string; since: string }>();

/** Snapshot of the in-flight motion on `robotId` (null when idle) — observability + tests. */
export function robotMotionInFlight(robotId: number): { jobType: string; since: string } | null {
  return motionInFlight.get(robotId) ?? null;
}

/**
 * Age after which a `running` row cannot belong to a live dispatch: the job deadline plus the
 * abort deadline (both = ROBOT_CONTROL_TIMEOUT_MS) plus one minute of slack.
 */
export function orphanedRunningThresholdMs(): number {
  const timeoutMs = Math.max(1000, Number(process.env.ROBOT_CONTROL_TIMEOUT_MS) || 10_000);
  return 2 * timeoutMs + 60_000;
}

/**
 * doc 81 Đợt 1B Task 5 fix round 1 (M1) — startup reconciliation. A process that died
 * between the pre-motion `running` row and its finalize leaves the row `running` forever
 * (and its idempotency key blocked). Marks every `running` row started more than
 * `olderThanMs` ago as `failed` with PROCESS_RESTART_OUTCOME_UNKNOWN — honest: the robot
 * may or may not have moved. Called from startRobots(). Never throws; returns the count.
 */
export async function reconcileOrphanedRobotJobs(olderThanMs: number = orphanedRunningThresholdMs()): Promise<number> {
  try {
    const db = await getDb();
    if (!db) return 0;
    const cutoff = new Date(Date.now() - olderThanMs);
    const rows = await db
      .update(robotJobs)
      .set({
        status: "failed",
        errorText: `${PROCESS_RESTART_OUTCOME_UNKNOWN}: job was still 'running' when the process restarted — robot outcome unknown`,
        result: { reasonCode: PROCESS_RESTART_OUTCOME_UNKNOWN },
        completedAt: new Date(),
      })
      .where(and(eq(robotJobs.status, "running"), lt(robotJobs.startedAt, cutoff)))
      .returning({ id: robotJobs.id });
    if (rows.length > 0) {
      console.warn(`[Robot] reconciled ${rows.length} orphaned 'running' robot_jobs row(s) → failed (${PROCESS_RESTART_OUTCOME_UNKNOWN})`);
    }
    return rows.length;
  } catch (err) {
    console.error("[Robot] orphaned robot_jobs reconciliation failed:", (err as Error)?.message ?? err);
    return 0;
  }
}

/**
 * doc 81 Đợt 1C final wave 3 (ruling R-1C-j, final review I4) — dispatch options.
 *   motionActuator: the ONE channel that carries a MOTION job instead of `driver.runJob` (the ROS2 bridge
 *     publishes the message built from the bound job here). Called at exactly the point runJob would be —
 *     after every gate, the 'running' ledger row and the HITL consume, under the same deadline (stop on an
 *     unknown outcome still goes to the driver). The driver's runJob is then NOT called: one job, one
 *     actuation channel. Never used for a STOP — a STOP always goes to the driver.
 */
export interface RobotDispatchOptions {
  motionActuator?: (job: RobotJobSpec) => Promise<RobotJobResult>;
}

export async function dispatchRobotJob(rawInput: RobotDispatchInput, opts: RobotDispatchOptions = {}): Promise<RobotDispatchResult> {
  // fix round 2 (e) — the idempotency key is fitted ONCE, here, so the replay lookup (step 1) and the
  // ledger row use the same value (a hashed long key still replays).
  const fitted = fitLedgerKey(rawInput.idempotencyKey, ROBOT_LEDGER_IDEMPOTENCY_KEY_MAX);
  // residual 1 (R-1C-m, layer a) — a STOP becomes the canonical abort job HERE, before any gate, ledger row or
  // driver: the caller's params never travel with a non-motion job. `ignoredParams` is always recomputed.
  const stop = !isMotionJob(rawInput.job);
  const callerParams = rawInput.job?.params;
  const ignoredParams = stop && (rawInput.job.jobType !== "abort" || (callerParams != null && Object.keys(callerParams).length > 0));
  const input: RobotDispatchInput = {
    ...rawInput,
    idempotencyKey: fitted,
    job: stop ? { jobType: CANONICAL_STOP_JOB.jobType, params: {} } : rawInput.job,
    ignoredParams: stop && ignoredParams ? true : undefined,
  };
  if (input.ignoredParams) {
    console.warn(`[Robot] STOP on robot ${input.robotId}: caller-supplied job params/type ignored — sent as the canonical abort (R-1C-m)`);
  }
  try {
    return await dispatchRobotJobCore(input, opts);
  } catch (err) {
    if (err instanceof RobotLedgerWriteError) {
      // Every branch that can reach here is BEFORE any driver call (the post-motion finalize
      // is handled inside the core) ⇒ nothing moved; refuse honestly, never pretend success.
      console.error(`[Robot] ledger write failed — command refused (robot ${input.robotId}):`, err.message);
      return { ok: false, status: "rejected", error: "LEDGER_WRITE_FAILED" };
    }
    throw err;
  }
}

async function dispatchRobotJobCore(input: RobotDispatchInput, opts: RobotDispatchOptions = {}): Promise<RobotDispatchResult> {
  const triggerKind = input.triggerKind ?? "hitl";
  const motion = isMotionJob(input.job);
  // final wave 1 (R-1C-h) — a STOP's DB steps are bounded and best-effort; motion gets none (fail-closed).
  const stopDb = motion ? undefined : new StopDbBudget(input.robotId);
  /** What the STOP path had to assume because the DB did not answer — kept on its ledger row. */
  const stopNotes: Record<string, unknown> = {};

  // 1) Idempotency — return a prior terminal job for the same key.
  if (input.idempotencyKey) {
    const key = input.idempotencyKey;
    const lookup = async () => {
      const db = stopDb ? await requireDbForStop() : await getDb(); // residual 2 — null on the STOP path = DB failure
      if (!db) return undefined;
      const [prior] = await db.select().from(robotJobs).where(eq(robotJobs.idempotencyKey, key)).limit(1);
      return prior;
    };
    let prior: Awaited<ReturnType<typeof lookup>>;
    if (stopDb) {
      // R-1C-h — lookup failed/timed out ⇒ no replay: the STOP is sent (a duplicate STOP is harmless).
      const r = await stopDb.run("idempotency_lookup", lookup);
      prior = r.ok ? r.value : undefined;
      if (!r.ok) stopNotes.idempotencyLookup = "skipped_db_unavailable";
    } else {
      prior = await lookup();
    }
    if (prior) {
      // doc 81 Đợt 1C final wave 2 (R-1C-i, final review I3) — replay ONLY the same command: same robot
      // AND same job type. robot_jobs.idempotencyKey is globally unique and api/v1 / VDA5050 / ROS2 pass
      // caller-chosen keys, so a key already used for ANOTHER robot (or another job on this robot) used to
      // return that job's result — a STOP for robot B could come back "done" with nothing sent to B.
      const sameCommand = prior.robotId === input.robotId && prior.jobType === input.job.jobType;
      // doc 81 Đợt 1C residual 3 — a STOP replays ONLY an earlier attempt that is 'done'. A same-key retry after a
      // failed / rejected / still-running (or dry-run 'simulated') STOP is SENT again: a stop is energy-reducing and
      // idempotent at the device, and replaying the old result left the robot with nothing sent. Its new row drops
      // the key (UNIQUE) and names the earlier attempt. Motion replay is unchanged (never re-run blindly).
      if (sameCommand && !motion && prior.status !== "done") {
        console.warn(`[Robot] STOP on robot ${input.robotId}: same-key retry after a '${prior.status}' attempt (robot_jobs #${prior.id}) — sent again`);
        stopNotes.stopRetryOf = { priorJobId: prior.id, priorStatus: prior.status };
        input = { ...input, idempotencyKey: undefined };
      } else if (sameCommand) return idempotentReplay(prior);
      else if (motion) {
        // Never a false success: the motion is refused (its row cannot carry the key — UNIQUE).
        const jobId = await record(
          { ...input, idempotencyKey: undefined },
          "rejected",
          { reasonCode: IDEMPOTENCY_KEY_REUSED, priorJobId: prior.id },
          `${IDEMPOTENCY_KEY_REUSED}: idempotency key already used by robot_jobs #${prior.id} for a different robot/job — motion refused before any driver call`,
        );
        return { ok: false, status: "rejected", jobId, error: IDEMPOTENCY_KEY_REUSED };
      } else {
        // A STOP is sent; its ledger row drops the key (it belongs to the other job — UNIQUE).
        console.warn(`[Robot] STOP on robot ${input.robotId}: idempotency key already used by robot_jobs #${prior.id} (another robot/job) — not a replay, STOP sent (R-1C-i)`);
        stopNotes.idempotencyKeyReused = { priorJobId: prior.id };
        input = { ...input, idempotencyKey: undefined };
      }
    }
  }

  // 2) HITL gate — ĐỐI XỨNG với OT commandDispatcher (doc 25 T1).
  //    doc 81 Đợt 1B Task 5 — triggerKind='manual' NO LONGER skips this gate for a MOTION
  //    job. What 'manual' means (ruling R11, stated exactly — NOT a second-person check):
  //    manual = a human operator initiates the motion: authenticated session through
  //    actuationProcedure (role floor) + machine_control/canEdit; confirmedBy is bound
  //    server-side to the session user; no second person.
  //    Enforced here: a manual MOTION needs confirmedBy, and — when no actionId is given —
  //    confirmedBy === requestedBy (an internal caller cannot pass someone else's id as the
  //    "confirmer"); an actionId, when given, is re-verified like 'hitl'.
  //    doc 81 Đợt 1C Task 3 fix round 1 (ruling R-1C-c, L-7 energy direction) — a NON-motion job (a
  //    STOP: abort; `e_stop`/`stop` map to it in robotJobMapping) is exempt from this WHOLE block,
  //    WHATEVER its triggerKind: no confirmedBy needed (api/v1 never sets one; FOE's system user is 0),
  //    no actionId verification (an api-key STOP carries `apiv1-<key>`, a row that does not exist). It
  //    still gets its ledger row. Before, a 'hitl' abort without confirmedBy was refused here.
  if (motion) {
    // 2.0 doc 81 Đợt 1C Task 3 (owner decision 2026-09-27 "Đóng") — a MOTION that is not 'manual'
    //     (fix round 1: fail-closed on ANY other/unknown triggerKind, not just 'hitl') without an
    //     actionId: nothing was confirmed, so it is refused here, in every mode (dry-run too — a
    //     caller must not "pass" in simulation and break only at go-live), before any driver call.
    //     Used to run on a bare confirmedBy (Task 5 contract, CÒN MỞ in the final-wave report).
    if (triggerKind !== "manual" && !input.actionId) {
      const jobId = await record(
        input,
        "rejected",
        { reasonCode: HITL_ACTION_REQUIRED, code: "PRECONDITION_FAILED" },
        `PRECONDITION_FAILED: ${HITL_ACTION_REQUIRED} — a 'hitl' motion needs the actionId of a confirmed, bound ai_pending_actions row (operator clicks use triggerKind 'manual'; automated producers create a bound action first) — nothing sent to the robot`,
      );
      return { ok: false, status: "rejected", jobId, error: HITL_ACTION_REQUIRED, code: "PRECONDITION_FAILED" };
    }
    // 2.a Bắt buộc có người xác nhận.
    if (!input.confirmedBy) {
      const jobId = await record(input, "rejected", undefined, "HITL required: no confirmedBy");
      return { ok: false, status: "rejected", jobId, error: "HITL confirmation required" };
    }
    // 2.a-manual (R11) — manual without actionId: the confirmer IS the initiating session user.
    if (triggerKind === "manual" && !input.actionId && input.confirmedBy !== input.requestedBy) {
      const jobId = await record(
        input,
        "rejected",
        undefined,
        "MANUAL_CONFIRMER_MISMATCH: manual motion requires confirmedBy === requestedBy (the session user)",
      );
      return { ok: false, status: "rejected", jobId, error: "MANUAL_CONFIRMER_MISMATCH" };
    }
    // 2.b Defense-in-depth: khi có actionId, PHẢI tái-xác-minh bản ghi ai_pending_actions
    //     đã confirmed/executed VÀ đúng owner (=confirmedBy) — hệt OT. KHÔNG tin confirmedBy
    //     tự-điền vô điều kiện (trước đây robot bỏ qua bước này → lệnh FOE robot lọt trong khi
    //     FOE OT bị chặn). Fail-closed: DB không sẵn / bản ghi thiếu / sai owner → TỪ CHỐI.
    if (input.actionId) {
      const db = await getDb();
      if (!db) {
        const jobId = await record(input, "rejected", undefined, "DB unavailable — HITL verify fail-closed");
        return { ok: false, status: "rejected", jobId, error: "HITL verify unavailable" };
      }
      const [pending] = await db
        .select()
        .from(aiPendingActions)
        .where(eq(aiPendingActions.id, input.actionId))
        .limit(1);
      const confirmedOk =
        !!pending &&
        (pending.status === "confirmed" || pending.status === "executed") &&
        pending.userId === input.confirmedBy;
      if (!confirmedOk) {
        const jobId = await record(input, "rejected", undefined, "HITL action not confirmed or owner mismatch");
        return { ok: false, status: "rejected", jobId, error: "NOT_CONFIRMED" };
      }
    }
  }

  // 2b) X1-e (doc 16 §5) — COMMAND-LEVEL AUTHORIZATION (ADDITIVE, flag-gated).
  //     When FIELD_V2_ENABLED is on, the caller must hold the descriptor's
  //     requiredPermission for this robot job verb. This NEVER weakens the HITL gate
  //     above or the dry-run mode gate below — it can only DENY before any write.
  //     Flag OFF (default) → authorizeCommand returns skipped:true → pass-through
  //     (current behaviour, unchanged). A rejected command writes an append-only row.
  {
    const { authorizeCommand, fieldV2Enabled } = await import("../field/commandAuthz");
    if (fieldV2Enabled()) {
      const actorId = input.confirmedBy ?? input.requestedBy;
      const verb = input.job.jobType === "abort" ? "abort" : "run_job";
      const check = async () => {
        const { equipmentClass, userRole } = await resolveRobotAuthzContext(input.robotId, actorId);
        return authorizeCommand({ equipmentClass, verb, userId: actorId, userRole });
      };
      // final wave 1 (R-1C-h) — for a STOP this DB work is bounded (it used to be able to hang the STOP).
      // Authorization itself stays (R-1C-d): an unverifiable permission is still a refusal (fail-closed),
      // and the refusal's ledger row is best-effort under the same deadline.
      let authz: Awaited<ReturnType<typeof authorizeCommand>>;
      if (stopDb) {
        const r = await stopDb.run("authz_check", check);
        authz = r.ok ? r.value : { ok: false, skipped: false, reason: "command authorization could not be verified (DB unavailable) — fail-closed" };
      } else {
        authz = await check();
      }
      if (!authz.ok) {
        const reason = authz.reason ?? "command authorization denied";
        const write = record(input, "rejected", { requiredPermission: authz.requiredPermission }, reason);
        const jobId = stopDb
          ? await withDeadline(write, ROBOT_STOP_DB_STEP_DEADLINE_MS, "STOP refusal ledger").catch(() => undefined)
          : await write;
        return { ok: false, status: "rejected", jobId, error: reason };
      }
    }
  }

  // 3) Active + connected driver.
  //    Fix round 3 — isConnected() is false after a peer drop (MELFA/Delta/FANUC); that refuses
  //    MOTION here. A STOP (abort) is not refused on that ground: its driver path is the only
  //    one allowed to re-establish the session to deliver the stop.
  //    Fix round 4 (ruling R13) — "transport up" ≠ "motion allowed": a read-only poll may bring the
  //    link back, but the driver's MOTION LOCK (set on a peer drop / outcome-unknown motion) keeps
  //    motion refused until a STOP is confirmed or an authorised operator clears it
  //    (robot.clearMotionLock). Checked BEFORE the connectivity test so the ledger names the cause;
  //    a STOP is never refused on this ground.
  const robot = getActiveRobot(input.robotId);
  if (!robot) {
    const jobId = await record(input, "rejected", undefined, "robot not active/connected");
    return { ok: false, status: "rejected", jobId, error: "robot not active/connected" };
  }
  if (motion) {
    const lock = robot.driver.getMotionLock?.();
    if (lock?.locked) {
      const jobId = await record(
        input,
        "rejected",
        { reasonCode: MOTION_LOCKED_REASON_CODE, motionLock: lock },
        `MOTION_LOCKED: ${MOTION_LOCKED_REASON_CODE} since ${lock.since ?? "?"} (${lock.reasonCode ?? "link loss"}) — motion refused before any driver call; a confirmed STOP or robot.clearMotionLock clears it`,
      );
      return { ok: false, status: "rejected", jobId, error: "MOTION_LOCKED" };
    }
    if (!robot.driver.isConnected()) {
      const jobId = await record(input, "rejected", undefined, "robot not active/connected");
      return { ok: false, status: "rejected", jobId, error: "robot not active/connected" };
    }
  }

  // 4) MODE GATE — dry-run by default.
  if (!controlEnabled()) {
    return recordSimulated(input, { dryRun: true }, undefined, stopDb);
  }

  // 4a) COMMISSIONING / FAT GATE (CTL-02, doc 40) — ĐỐI XỨNG với OT commandDispatcher.
  //     Reachable CHỈ khi ROBOT_CONTROL_ENABLED==='true' (bước 4 đã trả 'simulated' nếu
  //     không). Khi ROBOT_COMMISSIONING_REQUIRED bật (MẶC ĐỊNH) và robot CHƯA có bản ghi
  //     commissioning active/chưa hết hạn/đã ký → ÉP xuống nhánh 'simulated' (y như OT).
  //     Chỉ HẠ một would-be real-write xuống simulated; KHÔNG bao giờ mở một write nên
  //     không thể nới lỏng bất kỳ gate nào ở trên. PRECEDENCE: chưa-commissioned ⇒ simulated.
  //     final wave 1 (R-1C-h) — for a STOP the check is bounded; when the DB cannot answer the robot is
  //     taken as commissioned and the STOP is SENT (a STOP to an uncommissioned robot only removes energy).
  //     A STOP to a robot KNOWN to be uncommissioned stays 'simulated' (R-1C-d).
  let commissioned: boolean | undefined;
  if (isRobotCommissioningRequired()) {
    if (stopDb) {
      // residual 2 — a NULL DB is a DB failure here, not "not commissioned": isRobotCommissioned returns false for
      // it (fail-safe for motion), which recorded the STOP 'simulated' and never sent it.
      const r = await stopDb.run("commissioning_check", async () => {
        await requireDbForStop();
        return isRobotCommissioned(input.robotId);
      });
      commissioned = r.ok ? r.value : true;
      if (!r.ok) stopNotes.commissioning = "unknown_db_unavailable_assumed_for_stop";
    } else {
      commissioned = await isRobotCommissioned(input.robotId);
    }
  }
  if (isRobotCommissioningRequired() && !commissioned) {
    return recordSimulated(
      input,
      { dryRun: true, notCommissioned: true },
      "not_commissioned: robot has no active, non-expired, signed commissioning record — real motion refused (recorded simulated)",
      stopDb,
    );
  }

  // 4a-policy) W3-B2 (doc 44 G3.14) — "MỘT CỬA": policy-as-code seam TRƯỚC nhánh thực
  //     thi thật, ĐỐI XỨNG với OT commandDispatcher (5a-policy: governance → safety, tức
  //     TRƯỚC interlock 4b). Reachable CHỈ khi ROBOT_CONTROL_ENABLED==='true' VÀ đã qua
  //     mọi gate phía trên (idempotency/HITL/authz/driver/FAT) — seam CHỈ có thể TỪ CHỐI
  //     thêm, không bao giờ nới lỏng gate nào. SEC_PLATFORM OFF (mặc định) → bỏ qua hoàn
  //     toàn (0 khác biệt hành vi, không thêm DB read nào). DENY → reject + ledger row
  //     POLICY_DENIED; obligations require_approval → dispatcher robot KHÔNG có kênh
  //     four-eyes riêng ⇒ reject honest POLICY_APPROVAL_REQUIRED (không giả vờ đã duyệt).
  //     doc 81 Đợt 1C Task 3 fix round 2 (ruling (b), R-1C-c): a DENY / REQUIRE_APPROVAL verdict still refuses
  //     a MOTION, but NOT a STOP (non-motion job): the verdict is recorded (ledger result.policyOverride + a
  //     control_audit_log row "stop_policy_override") and the STOP is sent anyway. The policy engine's own
  //     decision log (evaluatePolicy) keeps what the policy said.
  let policyOverride: Record<string, unknown> | undefined;
  {
    const { evaluateActionPolicy, secPlatformEnabled } = await import("../security/policyGate");
    if (secPlatformEnabled()) {
      const actorId = input.confirmedBy ?? input.requestedBy;
      // Best-effort role (fail-safe "user" → policy role-floor không match ⇒ hướng DENY an toàn
      // dưới default-deny). fat = có bản ghi commissioning active (cùng nguồn với gate 4a).
      // final wave 1 (R-1C-h) — a STOP's two DB reads here are bounded; the verdict cannot block a STOP
      // anyway (R-1C-c), so on a DB failure they fall back to the conservative context (role "user", fat false).
      let userRole: string;
      let fatPassed: boolean;
      if (stopDb) {
        const role = await stopDb.run("policy_role_lookup", () => resolveRobotAuthzContext(input.robotId, actorId));
        userRole = role.ok ? role.value.userRole : "user";
        const fat = await stopDb.run("policy_commissioning_check", () => isRobotCommissioned(input.robotId));
        fatPassed = fat.ok ? fat.value : false;
      } else {
        ({ userRole } = await resolveRobotAuthzContext(input.robotId, actorId));
        fatPassed = await isRobotCommissioned(input.robotId);
      }
      const verb = input.job.jobType;
      const verdict = evaluateActionPolicy(
        `user:${actorId}`,
        `robot.command.${verb}`,
        `robot:${input.robotId}`,
        {
          verb,
          argsKeys: Object.keys(input.job.params ?? {}), // args-summary: chỉ TÊN khóa, không leak giá trị
          robotId: input.robotId,
          triggerKind,
          role: userRole,
          fat_passed: fatPassed,
          mode: "real", // nhánh này chỉ reachable khi ROBOT_CONTROL_ENABLED==='true'
          requestedBy: input.requestedBy,
          ...(input.confirmedBy != null ? { confirmedBy: input.confirmedBy } : {}),
        },
      );
      if (!verdict.allow) {
        const reason = verdict.effect === "deny" ? "POLICY_DENIED" : "POLICY_APPROVAL_REQUIRED";
        if (!motion) {
          policyOverride = {
            decision: reason,
            effect: verdict.effect,
            policyRef: verdict.policyId,
            reasonCode: verdict.reasonCode,
            policyReason: verdict.reason,
            ruling: "R-1C-c",
            note: "STOP (non-motion job) is never blocked by policy — sent anyway",
          };
          console.warn(`[Robot] policy ${reason} (${verdict.policyId ?? "no policy id"}) for STOP on robot ${input.robotId} — overridden (R-1C-c), STOP sent`);
        } else {
          const jobId = await record(
            input,
            "rejected",
            { policyRef: verdict.policyId, effect: verdict.effect, reasonCode: verdict.reasonCode },
            `${reason}: ${verdict.reason}`,
          );
          return { ok: false, status: "rejected", jobId, error: reason };
        }
      }
    }
  }

  // 4a-safety) SAFETY-PLC PREFLIGHT (doc 81 Đợt 1B Task 5, BE2 §3 S9) — MOTION only.
  //     Reads the SAME source as the OT dispatcher's (5a-safety) preflight: the OT adapter
  //     facade's READ-ONLY getSafetyStatus (driver.getSafetyStatus → else the safety-PLC
  //     status adapter). A robot has no OT adapter ⇒ ROBOT_NO_OT_ADAPTER_ID, so the facade
  //     resolves no driver and reads the safety-PLC adapter. SAME RULE AS THE OT PATH (since
  //     Task 6 both sides block UNKNOWN): anything but OK refuses — BLOCKED, UNKNOWN (no
  //     safety-PLC configured/readable), a read error or a hung read.
  //     doc 81 Đợt 1B final wave (item 3): same escape hatch and same vocabulary as OT, from ONE
  //     module (safetyPreflightPolicy): ROBOT_SAFETY_PREFLIGHT_ENABLED — ON unless exactly
  //     "false" — and reasons SAFETY_BLOCKED / SAFETY_UNKNOWN (was SAFETY_PLC_BLOCKED /
  //     SAFETY_PLC_NOT_OK). The raw reading (incl. ERROR) stays in result.safety.
  //     A stop (abort) is never gated here.
  //     doc 81 Đợt 1C Task 1 (owner decision 2026-09-27): the facade reads with
  //     { forRealActuation: true } (this gate is reachable only on the real, commissioned path) —
  //     SIM / real_unmapped alone ⇒ SAFETY_SIM_ONLY; a bad-quality real safety tag ⇒ SAFETY_UNKNOWN.
  //     doc 81 Đợt 4 Task A1: robotId is passed so only the configs guarding THIS robot (its robot /
  //     station / line / factory, plus untargeted ones) are read; unplaced/unknown robot ⇒ all configs.
  if (motion && isRobotSafetyPreflightEnabled()) {
    let safetyState: string;
    let safetySource: string | undefined;
    let safetyBasis: SafetyUnknownBasis | undefined; // Đợt 1C Task 1 — "sim_only" ⇒ SAFETY_SIM_ONLY
    try {
      const { createAdapterFacade } = await import("../ot/adapterFacade");
      const s = await withDeadline(
        createAdapterFacade({ adapterId: ROBOT_NO_OT_ADAPTER_ID, machineId: null, robotId: input.robotId }).getSafetyStatus({ forRealActuation: true }),
        SAFETY_PREFLIGHT_DEADLINE_MS,
        "safety-PLC preflight",
      );
      safetyState = s?.state ?? "UNKNOWN";
      safetySource = s?.source;
      safetyBasis = s?.basis;
    } catch (err) {
      safetyState = "ERROR";
      safetySource = (err as Error)?.message ?? String(err);
    }
    if (safetyState !== "OK") {
      const error = safetyPreflightReason(safetyState, safetyBasis);
      const jobId = await record(
        input,
        "rejected",
        safetyBasis ? { safety: safetyState, safetySource, safetyBasis } : { safety: safetyState, safetySource },
        error === "SAFETY_SIM_ONLY"
          ? `${error}: safety-PLC preflight found no real safety PLC with a mapped safety tag (only SIM / unmapped) — a commissioned robot needs a REAL safety PLC; motion refused before any driver call`
          : `${error}: safety-PLC preflight returned ${safetyState} — motion refused before any driver call`,
      );
      return { ok: false, status: "rejected", jobId, error };
    }
  }

  // 4b) INTERLOCK GATE (doc 35 quy-trình-6) — fail-closed, ĐỒNG BỘ, TRƯỚC driver.runJob.
  //     ĐỐI XỨNG với OT commandDispatcher (bước 5a-bis). Reachable ONLY khi
  //     ROBOT_CONTROL_ENABLED==="true" (bước 4 đã trả 'simulated' nếu không) → chỉ gate
  //     nhánh REAL-MOTION. Khoá đánh giá = robotInterlockTarget(robotId) (xem lựa chọn ở
  //     định nghĩa hàm: cổng KHÔNG cần adapter thật; machineId=robotId theo quy ước
  //     interlockEngine; ROBOT_NO_OT_ADAPTER_ID không bao giờ trùng adapter thật) — CHỈ rule
  //     nhắm targetMachineId=robotId (action chặn/dừng, enabled+approved) mới chặn. Rule đang
  //     vi phạm HOẶC lỗi đánh giá (failClosed) → TỪ CHỐI, KHÔNG gọi driver.runJob.
  //     doc 81 Đợt 1B Task 5 fix round 1 (M3) — MOTION only: a stop (abort) is exempt, like the
  //     safety and HITL gates — an active interlock violation must never block a STOP.
  if (motion) {
    const { evaluateInterlockGate } = await import("../interlock/interlockGate");
    const gate = await evaluateInterlockGate(robotInterlockTarget(input.robotId));
    if (gate.blocked) {
      const detail = gate.failClosed
        ? "interlock evaluation error — fail-closed (no run)"
        : `blocked by active interlock rule(s): ${gate.violations
            .map((v) => `#${v.ruleId}(${v.action})`)
            .join(", ")}`;
      const jobId = await record(input, "rejected", { interlock: gate.violations }, `INTERLOCK_BLOCKED: ${detail}`);
      return { ok: false, status: "rejected", jobId, error: "INTERLOCK_BLOCKED" };
    }
  }

  // 5) Real run under timeout.
  //    doc 81 Đợt 1B Task 5 — (a) the ledger row is written BEFORE the driver is called
  //    ('running'); if that write fails nothing is sent (fail-closed). The row is then
  //    UPDATEd to its terminal state (robot_jobs keeps the UPDATE grant for exactly this
  //    lifecycle, migration 0279; one row per job also keeps the UNIQUE idempotencyKey,
  //    which now also stops a concurrent duplicate before it can move the robot).
  //    (b) a MOTION whose outcome is unknown — our deadline, or a driver reply timeout /
  //    dropped connection (MOTION_OUTCOME_UNKNOWN_REASON_CODES) — gets the driver's stop
  //    FIRST; only then is the row finalised 'failed' with abort_sent / abort_failed /
  //    abort_unsupported.
  const timeoutMs = Math.max(1000, Number(process.env.ROBOT_CONTROL_TIMEOUT_MS) || 10_000);

  // 5-R14) PER-ROBOT MOTION SLOT (final wave, ruling R14) — claimed synchronously, BEFORE the
  //     first await of the real path, so two concurrent motions on one robot cannot both pass.
  //     Refused ⇒ rejected + ROBOT_MOTION_IN_PROGRESS (not queued). A stop never checks it.
  if (motion) {
    const busy = motionInFlight.get(input.robotId);
    if (busy) {
      const jobId = await record(
        input,
        "rejected",
        { reasonCode: ROBOT_MOTION_IN_PROGRESS, inFlight: busy },
        `${ROBOT_MOTION_IN_PROGRESS}: a '${busy.jobType}' job on robot ${input.robotId} has been in flight since ${busy.since} — motion refused before any driver call (R14: one motion per robot at a time, not queued)`,
      );
      return { ok: false, status: "rejected", jobId, error: ROBOT_MOTION_IN_PROGRESS };
    }
    motionInFlight.set(input.robotId, { jobType: input.job.jobType, since: new Date().toISOString() });
  }
  try {
    return await runRealJob(input, robot.driver, motion, timeoutMs, policyOverride, stopDb, stopNotes, motion ? opts.motionActuator : undefined);
  } finally {
    if (motion) motionInFlight.delete(input.robotId);
  }
}

// ─── doc 81 Đợt 1B final wave (item 2) — HITL binding for robot jobs ─────────────────

type RobotBindingVerdict =
  | { ok: true; owner: number }
  | { ok: false; reason: "NOT_CONFIRMED" | "ACTION_BINDING_MISMATCH"; detail: string };

/**
 * PURE — is `pending` a valid authorisation for EXACTLY this robot job? Mirrors the OT
 * dispatcher's verifyActionBinding: status === 'confirmed' (an 'executed' row is spent), not
 * expired, owned by the confirmer, and carrying the canonical hash of THIS robotId/jobType/params
 * (otActionBinding.robotPayloadHash — the same function the producers use). Used under
 * SELECT … FOR UPDATE right before the row is consumed.
 */
export function verifyRobotActionBinding(pending: AiPendingAction | undefined, input: RobotDispatchInput): RobotBindingVerdict {
  if (!pending) return { ok: false, reason: "NOT_CONFIRMED", detail: "HITL action not found" };
  if (pending.status !== "confirmed") {
    return {
      ok: false,
      reason: "NOT_CONFIRMED",
      detail: `HITL action status is '${pending.status}' — only a 'confirmed' action authorises a robot job, exactly once`,
    };
  }
  if (new Date(pending.expiresAt).getTime() <= Date.now()) {
    return { ok: false, reason: "NOT_CONFIRMED", detail: "HITL action expired" };
  }
  if (input.confirmedBy !== undefined && pending.userId !== input.confirmedBy) {
    return { ok: false, reason: "NOT_CONFIRMED", detail: "HITL action owner mismatch" };
  }
  // doc 81 Đợt 4 Task A5 (R-4-a, defence in depth) — an orchestration-engine action authorising MOTION must be
  // confirmed by the approver of an earlier hitl_gate, never by the run owner (a STOP never reaches this check).
  const self = foeSelfApprovalRefusal(pending, input.requestedBy);
  if (self) return { ok: false, reason: "NOT_CONFIRMED", detail: self };
  const stored = readOtPayloadHash(pending.previewJson);
  if (!stored) {
    return { ok: false, reason: "ACTION_BINDING_MISMATCH", detail: "HITL action carries no robot payload binding" };
  }
  const expected = robotPayloadHash({ robotId: input.robotId, jobType: input.job.jobType, params: input.job.params ?? null });
  if (stored !== expected) {
    return { ok: false, reason: "ACTION_BINDING_MISMATCH", detail: "HITL action was confirmed for a different robot/jobType/params" };
  }
  return { ok: true, owner: pending.userId };
}

type RobotReservation = { ok: true; jobId: number } | { ok: false; result: RobotDispatchResult };

/**
 * Real-path reservation, ONE transaction, committed BEFORE the driver is called (the robot twin
 * of commandDispatcher.reserveRealWrite):
 *   • with an actionId ('hitl' or 'manual'): SELECT … FOR UPDATE the row, verifyRobotActionBinding,
 *     CAS confirmed→executed (0 rows ⇒ consumed concurrently ⇒ NOT_CONFIRMED), then the 'running'
 *     ledger row — all in the same tx, so a failed insert un-consumes the action;
 *   • without an actionId: just the 'running' row. Step 2 is the whole gate then (confirmedBy
 *     required; 'manual' additionally confirmedBy === requestedBy, ruling R11). Since doc 81 Đợt 1C
 *     Task 3 only a 'manual' motion or a STOP (abort) reaches here without an actionId — step 2.0
 *     refuses a 'hitl' motion without one (HITL_ACTION_REQUIRED).
 *   • a STOP (non-motion job) — fix round 1 (R-1C-c): just the 'running' row, even WITH an actionId.
 *     Its action is neither verified nor consumed: a STOP is never refused on HITL grounds, and a
 *     bound abort row authorises nothing a STOP does not already get (it simply expires).
 * Any throw ⇒ LEDGER_WRITE_FAILED and nothing is sent (the tx rolled back).
 */
async function reserveRobotJob(input: RobotDispatchInput, runningResult?: Record<string, unknown>): Promise<RobotReservation> {
  const rejected = (jobId: number | undefined, error: string): RobotReservation => ({
    ok: false,
    result: { ok: false, status: "rejected", jobId, error },
  });
  if (!input.actionId || !isMotionJob(input.job)) {
    const jobId = (await record(input, "running", runningResult, undefined, { requireDb: true })) as number;
    return { ok: true, jobId };
  }
  const actionId = input.actionId;
  const db = await getDb();
  if (!db) throw new RobotLedgerWriteError("robot ledger unavailable (no DB) at reservation");
  return await db.transaction(async (tx): Promise<RobotReservation> => {
    const [pending] = await tx.select().from(aiPendingActions).where(eq(aiPendingActions.id, actionId)).for("update");
    let verdict: RobotBindingVerdict = verifyRobotActionBinding(pending, input);
    // doc 81 Đợt 4 fix round 1 (R-4-i) — an orchestration-engine action: re-derive run owner + gate approver from the
    // DB rows under this transaction (a STOP never reaches here — non-motion jobs are not verified).
    if (verdict.ok && pending?.tool === FOE_ENGINE_TOOL) {
      const refusal = await foeApprovalDbRefusal(tx, pending, input.requestedBy);
      if (refusal) verdict = { ok: false, reason: "NOT_CONFIRMED", detail: refusal };
    }
    if (verdict.ok) {
      const consumed = await tx
        .update(aiPendingActions)
        .set({ status: "executed", executedAt: new Date() })
        .where(and(eq(aiPendingActions.id, actionId), eq(aiPendingActions.status, "confirmed")))
        .returning({ id: aiPendingActions.id });
      if (consumed.length !== 1) {
        verdict = { ok: false, reason: "NOT_CONFIRMED", detail: "HITL action was consumed concurrently" };
      }
    }
    if (!verdict.ok) {
      const jobId = await record(input, "rejected", { reasonCode: verdict.reason }, `${verdict.reason}: ${verdict.detail}`, { requireDb: true, db: tx });
      return rejected(jobId, verdict.reason);
    }
    const jobId = (await record(input, "running", undefined, undefined, { requireDb: true, db: tx })) as number;
    return { ok: true, jobId };
  });
}

/**
 * doc 81 Đợt 1C final wave 1 (R-1C-h) — ledger of a STOP that was SENT without a pre-written row
 * (the pre-write failed, timed out, or was skipped because the DB was already degraded). Best-effort,
 * bounded, never throws, at most ONE row per STOP:
 *   • the pre-write landed late ⇒ that row is finalised;
 *   • it failed (or was never attempted) ⇒ one terminal row is inserted (result.ledgerDeferred);
 *   • it is still pending ⇒ it is settled when it lands (finalise / insert on failure), logged either way.
 * A row that cannot be written is logged loudly (no secrets) and reported as `ledgerError`.
 */
async function stopLedgerAfterSend(
  input: RobotDispatchInput,
  prewrite: Promise<number> | undefined,
  status: "done" | "failed",
  detail: Record<string, unknown>,
  errorText: string | undefined,
): Promise<{ jobId?: number; ledgerError?: string }> {
  const terminal = { ...detail, ledgerDeferred: true };
  const insertTerminal = async (): Promise<number> =>
    (await record(input, status, terminal, errorText, { requireDb: true })) as number;
  const lost = (err: unknown) =>
    console.error(`[Robot] STOP on robot ${input.robotId} was SENT (${status}) but its ledger row could not be written (R-1C-h): ${safeDbError(err)}`);

  let state: { s: "ok"; id: number } | { s: "err" } | { s: "pending" } = { s: "err" };
  if (prewrite) {
    state = await Promise.race([
      prewrite.then(
        (id) => ({ s: "ok" as const, id }),
        () => ({ s: "err" as const }),
      ),
      new Promise<{ s: "pending" }>((r) => setImmediate(() => r({ s: "pending" }))),
    ]);
  }
  if (state.s === "pending") {
    // Still hanging: settle it when (if) it lands, without holding the STOP's response.
    prewrite!
      .then(
        (id) => finalize(id, status, terminal, errorText),
        () => insertTerminal().then(() => undefined),
      )
      .catch(lost);
    console.error(`[Robot] STOP on robot ${input.robotId} was SENT (${status}); its ledger pre-write is still pending — the row is settled when the DB answers (R-1C-h)`);
    return { ledgerError: "LEDGER_DEFERRED" };
  }
  try {
    if (state.s === "ok") {
      await withDeadline(finalize(state.id, status, terminal, errorText), ROBOT_STOP_DB_STEP_DEADLINE_MS, "STOP ledger finalize");
      return { jobId: state.id };
    }
    const id = await withDeadline(insertTerminal(), ROBOT_STOP_DB_STEP_DEADLINE_MS, "STOP ledger write");
    return { jobId: id };
  } catch (err) {
    lost(err);
    return { ledgerError: "LEDGER_WRITE_FAILED_AFTER_STOP" };
  }
}

/**
 * Step 5 proper — the real run under timeout (see the comment block above the slot claim in
 * dispatchRobotJobCore). Split out so the R14 slot is released by ONE try/finally whatever path
 * this takes (ledger failure, driver result, deadline + stop, finalize failure).
 */
async function runRealJob(
  input: RobotDispatchInput,
  driver: RobotDriver,
  motion: boolean,
  timeoutMs: number,
  policyOverride?: Record<string, unknown>,
  stopDb?: StopDbBudget,
  stopNotes: Record<string, unknown> = {},
  motionActuator?: (job: RobotJobSpec) => Promise<RobotJobResult>,
): Promise<RobotDispatchResult> {
  let jobId: number | undefined;
  /** R-1C-h — a STOP's pre-write that failed or has not landed within its deadline (settled after the send). */
  let prewrite: Promise<number> | undefined;
  if (motion || !stopDb) {
    try {
      const reserved = await reserveRobotJob(input, policyOverride ? { policyOverride } : undefined);
      if (!reserved.ok) return reserved.result;
      jobId = reserved.jobId;
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      console.error(`[Robot] pre-motion ledger write / HITL reservation failed — nothing sent to robot ${input.robotId}:`, msg);
      return { ok: false, status: "rejected", error: "LEDGER_WRITE_FAILED" };
    }
  } else {
    // final wave 1 (R-1C-h) — STOP: the 'running' row is written first as before, but under a deadline;
    // a failure/timeout does NOT refuse the STOP (it used to: LEDGER_WRITE_FAILED). The row is settled
    // best-effort once the STOP has been sent (stopLedgerAfterSend).
    const notes = stopDb.degraded ? { ...stopNotes, dbDegraded: stopDb.degraded } : stopNotes;
    const runningResult =
      policyOverride || Object.keys(notes).length > 0
        ? { ...(policyOverride ? { policyOverride } : {}), ...(Object.keys(notes).length > 0 ? { stopDb: notes } : {}) }
        : undefined;
    const pre = await stopDb.run("ledger_prewrite", () => {
      prewrite = record(input, "running", runningResult, undefined, { requireDb: true }) as Promise<number>;
      return prewrite;
    });
    if (pre.ok) {
      jobId = pre.value;
      prewrite = undefined;
    }
  }

  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<{ kind: "timeout" }>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
  });
  const outcome = await Promise.race([
    // R-1C-j — exactly ONE channel per job: the motion actuator (ROS2 bridge) OR the driver, never both;
    // a STOP always takes the driver (the actuator is only ever passed for motion).
    (motion && motionActuator ? motionActuator(input.job) : driver.runJob(input.job)).then(
      (r) => ({ kind: "result" as const, r }),
      (e: unknown) => ({ kind: "error" as const, e }),
    ),
    deadline,
  ]);
  clearTimeout(timer);

  let status: "done" | "failed";
  let detail: Record<string, unknown> | undefined;
  let errorText: string | undefined;
  // B1 — the driver's own detail, before the dispatcher merges its notes into `detail`.
  const driverOut = outcome.kind === "result" && outcome.r.detail ? { driverDetail: { ...outcome.r.detail } } : {};
  if (outcome.kind === "result") {
    status = outcome.r.ok ? "done" : "failed";
    detail = outcome.r.detail;
    errorText = outcome.r.error;
  } else if (outcome.kind === "error") {
    status = "failed";
    errorText = (outcome.e as Error)?.message ?? String(outcome.e);
  } else {
    status = "failed";
    detail = { timeout: true, timeoutMs, reasonCode: DISPATCH_DEADLINE_REASON_CODE };
    errorText = `robot job timeout after ${timeoutMs}ms`;
  }

  const reasonCode = typeof detail?.reasonCode === "string" ? detail.reasonCode : undefined;
  const outcomeUnknown =
    outcome.kind === "timeout" ||
    (status === "failed" && reasonCode != null && MOTION_OUTCOME_UNKNOWN_REASON_CODES.has(reasonCode));
  if (motion && outcomeUnknown) {
    // Fix round 5 (c) — R13 "lock on outcome-unknown" applied directly: lock the driver BEFORE the
    // stop goes out (the driver's own timer may not have fired yet when OUR deadline did). A
    // confirmed stop clears it again; a failed stop leaves it set. Drivers without a lock no-op.
    try {
      driver.lockMotion?.(reasonCode ?? DISPATCH_DEADLINE_REASON_CODE, errorText);
    } catch (err) {
      console.error(`[Robot] lockMotion failed for robot ${input.robotId} (stop still sent):`, (err as Error)?.message ?? err);
    }
    const stop = await stopAfterUnknownOutcome(driver, timeoutMs);
    detail = { ...(detail ?? {}), ...stop };
    errorText = `${errorText ?? "motion outcome unknown"} — ${stop.abort}${"abortError" in stop ? `: ${stop.abortError}` : ""}`;
  }

  // fix round 2 (b) — a policy verdict overridden for this STOP stays on the terminal row and is audited.
  // doc 81 Đợt 1C final wave 5 (M1): the audit runs AFTER finalize and is NOT awaited on the STOP's response
  // path (recordAuditEvent takes the global hash-chain advisory lock, no timeout) — see auditStopPolicyOverride.
  if (policyOverride) detail = { ...(detail ?? {}), policyOverride };

  if (!motion && stopDb) {
    // R-1C-h / R-1C-i — what the STOP path had to assume stays on the TERMINAL row too (finalize replaces result).
    const notes = stopDb.degraded ? { ...stopNotes, dbDegraded: stopDb.degraded } : stopNotes;
    if (Object.keys(notes).length > 0) detail = { ...(detail ?? {}), stopDb: notes };
  }
  // residual 1 (R-1C-m) — finalize replaces `result`; keep the flag on the terminal row too.
  if (input.ignoredParams) detail = { ...(detail ?? {}), ignoredParams: true };
  if (!motion && stopDb && jobId == null) {
    // R-1C-h — the STOP went out without a pre-written row: settle the ledger best-effort now.
    const ledger = await stopLedgerAfterSend(input, prewrite, status, { ...(detail ?? {}) }, errorText);
    if (policyOverride) auditStopPolicyOverride(input, ledger.jobId, policyOverride);
    return { ok: status === "done", status, jobId: ledger.jobId, error: errorText, ...(ledger.ledgerError ? { ledgerError: ledger.ledgerError } : {}), ...driverOut };
  }
  if (jobId == null) {
    // Unreachable: every other path reserved a row before the driver call.
    return { ok: status === "done", status, error: errorText, ledgerError: "LEDGER_FINALIZE_FAILED", ...driverOut };
  }
  try {
    const fin = finalize(jobId, status, detail, errorText);
    // R-1C-h — the STOP was sent; its terminal update must not hang the caller on a sick DB.
    await (motion ? fin : withDeadline(fin, ROBOT_STOP_DB_STEP_DEADLINE_MS, "STOP ledger finalize"));
  } catch (err) {
    // The driver WAS called; the row stays 'running' (honest: terminal state not recorded).
    const msg = (err as Error)?.message ?? String(err);
    console.error(`[Robot] ledger finalize failed for job ${jobId} (robot ${input.robotId}):`, msg);
    if (policyOverride) auditStopPolicyOverride(input, jobId, policyOverride);
    return { ok: status === "done", status, jobId, error: errorText, ledgerError: "LEDGER_FINALIZE_FAILED", ...driverOut };
  }
  if (policyOverride) auditStopPolicyOverride(input, jobId, policyOverride);
  return { ok: status === "done", status, jobId, error: errorText, ...driverOut };
}

/** Upper bound after which a still-pending STOP-override audit is logged as stuck (it is never awaited by the STOP). */
export const STOP_POLICY_AUDIT_DEADLINE_MS = 10_000;

/**
 * doc 81 Đợt 1C final wave 5 (final review M1) — control_audit_log row "stop_policy_override" (R-1C-c), written
 * AFTER the ledger row is final and FIRE-AND-FORGET: under SEC_PLATFORM recordAuditEvent waits on the global
 * hash-chain advisory lock with no timeout, which used to (a) hold the STOP's response and (b) leave its row
 * 'running' meanwhile (a restart then reconciled a delivered STOP as outcome-unknown). A failure or a stuck
 * audit is logged (no secrets), never surfaced as a STOP failure.
 */
function auditStopPolicyOverride(input: RobotDispatchInput, jobId: number | undefined, policyOverride: Record<string, unknown>): void {
  const work = (async () => {
    const db = await getDb();
    if (!db) {
      console.error(`[Robot] audit of the STOP policy override skipped for job ${jobId ?? "unrecorded"} — no DB (the STOP was sent)`);
      return;
    }
    const { recordAuditEvent } = await import("../audit/controlAuditService");
    await recordAuditEvent(db, {
      entityType: "robot_job",
      entityId: jobId ?? "unrecorded",
      action: "stop_policy_override",
      actorId: input.confirmedBy ?? input.requestedBy ?? null,
      after: policyOverride,
      reason: `R-1C-c: STOP sent despite policy ${String(policyOverride.decision)} (${String(policyOverride.policyRef ?? "no policy id")})`,
    });
  })();
  void withDeadline(work, STOP_POLICY_AUDIT_DEADLINE_MS, "STOP policy-override audit").catch((err) => {
    console.error(`[Robot] audit of the STOP policy override failed or is stuck for job ${jobId ?? "unrecorded"} (the STOP was sent): ${safeDbError(err)}`);
  });
}
