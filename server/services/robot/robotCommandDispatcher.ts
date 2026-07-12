/**
 * Phase 3 — Robot command dispatcher: the SINGLE gated path to run a motion job.
 *
 * Mirrors the OT commandDispatcher safety model. NOT exported to tRPC as a
 * mutation — reachable only from an internal caller (an AI write-tool after HITL
 * confirm, or a server-side operator action). Gates, in order:
 *   1. idempotency (per key, terminal job returned as-is — no blind re-run),
 *   2. HITL: triggerKind='hitl' requires a confirmedBy user AND — when an actionId is
 *      supplied — a re-verified ai_pending_actions row (confirmed/executed + owner match),
 *      symmetric to the OT commandDispatcher (doc 25 T1); fail-closed on any mismatch,
 *   3. active + connected driver,
 *   4. MODE GATE: ROBOT_CONTROL_ENABLED!=='true' → record status 'simulated',
 *      never call driver.runJob (default is dry-run),
 *   5. real run under timeout → record done/failed.
 * Every branch writes an append-only robot_jobs row.
 */
import { and, eq } from "drizzle-orm";
import { pgTable, serial, integer, varchar, timestamp, text } from "drizzle-orm/pg-core";
import { getDb } from "../../db/connection";
import { robotJobs, robots, aiPendingActions } from "../../../drizzle/schema";
import { getActiveRobot } from "./robotManager";
import type { RobotJobSpec, RobotJobResult } from "./robotDriver";

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
}

export interface RobotDispatchResult {
  ok: boolean;
  status: "done" | "failed" | "simulated" | "rejected";
  jobId?: number;
  error?: string;
}

function controlEnabled(): boolean {
  return process.env.ROBOT_CONTROL_ENABLED === "true";
}

async function record(
  input: RobotDispatchInput,
  // "running" is accepted so an in-flight job can be recorded before it reaches a terminal
  // state; the completedAt guard below relies on it. Callers currently pass terminal statuses.
  status: RobotDispatchResult["status"] | "running",
  result?: Record<string, unknown>,
  errorText?: string,
): Promise<number | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  try {
    const now = new Date();
    const [row] = await db.insert(robotJobs).values({
      robotId: input.robotId,
      jobType: input.job.jobType,
      params: input.job.params,
      status,
      triggerKind: input.triggerKind ?? "hitl",
      actionId: input.actionId,
      requestedBy: input.requestedBy,
      confirmedBy: input.confirmedBy,
      idempotencyKey: input.idempotencyKey,
      result,
      errorText,
      startedAt: now,
      completedAt: status === "running" ? undefined : now,
    }).returning({ id: robotJobs.id });
    return row?.id;
  } catch (err) {
    console.error("[Robot] failed to record job:", (err as Error)?.message ?? err);
    return undefined;
  }
}

export async function dispatchRobotJob(input: RobotDispatchInput): Promise<RobotDispatchResult> {
  const triggerKind = input.triggerKind ?? "hitl";

  // 1) Idempotency — return a prior terminal job for the same key.
  if (input.idempotencyKey) {
    const db = await getDb();
    if (db) {
      const [prior] = await db.select().from(robotJobs)
        .where(eq(robotJobs.idempotencyKey, input.idempotencyKey)).limit(1);
      if (prior) {
        return { ok: prior.status === "done" || prior.status === "simulated", status: prior.status as RobotDispatchResult["status"], jobId: prior.id };
      }
    }
  }

  // 2) HITL gate — ĐỐI XỨNG với OT commandDispatcher (doc 25 T1).
  if (triggerKind === "hitl") {
    // 2.a Bắt buộc có người xác nhận.
    if (!input.confirmedBy) {
      const jobId = await record(input, "rejected", undefined, "HITL required: no confirmedBy");
      return { ok: false, status: "rejected", jobId, error: "HITL confirmation required" };
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
      const { equipmentClass, userRole } = await resolveRobotAuthzContext(input.robotId, actorId);
      const verb = input.job.jobType === "abort" ? "abort" : "run_job";
      const authz = await authorizeCommand({ equipmentClass, verb, userId: actorId, userRole });
      if (!authz.ok) {
        const jobId = await record(input, "rejected", { requiredPermission: authz.requiredPermission }, authz.reason ?? "command authorization denied");
        return { ok: false, status: "rejected", jobId, error: authz.reason ?? "command authorization denied" };
      }
    }
  }

  // 3) Active + connected driver.
  const robot = getActiveRobot(input.robotId);
  if (!robot || !robot.driver.isConnected()) {
    const jobId = await record(input, "rejected", undefined, "robot not active/connected");
    return { ok: false, status: "rejected", jobId, error: "robot not active/connected" };
  }

  // 4) MODE GATE — dry-run by default.
  if (!controlEnabled()) {
    const jobId = await record(input, "simulated", { dryRun: true });
    return { ok: true, status: "simulated", jobId };
  }

  // 4a) COMMISSIONING / FAT GATE (CTL-02, doc 40) — ĐỐI XỨNG với OT commandDispatcher.
  //     Reachable CHỈ khi ROBOT_CONTROL_ENABLED==='true' (bước 4 đã trả 'simulated' nếu
  //     không). Khi ROBOT_COMMISSIONING_REQUIRED bật (MẶC ĐỊNH) và robot CHƯA có bản ghi
  //     commissioning active/chưa hết hạn/đã ký → ÉP xuống nhánh 'simulated' (y như OT).
  //     Chỉ HẠ một would-be real-write xuống simulated; KHÔNG bao giờ mở một write nên
  //     không thể nới lỏng bất kỳ gate nào ở trên. PRECEDENCE: chưa-commissioned ⇒ simulated.
  if (isRobotCommissioningRequired() && !(await isRobotCommissioned(input.robotId))) {
    const jobId = await record(
      input,
      "simulated",
      { dryRun: true, notCommissioned: true },
      "not_commissioned: robot has no active, non-expired, signed commissioning record — real motion refused (recorded simulated)",
    );
    return { ok: true, status: "simulated", jobId };
  }

  // 4b) INTERLOCK GATE (doc 35 quy-trình-6) — fail-closed, ĐỒNG BỘ, TRƯỚC driver.runJob.
  //     ĐỐI XỨNG với OT commandDispatcher (bước 5a-bis). Reachable ONLY khi
  //     ROBOT_CONTROL_ENABLED==="true" (bước 4 đã trả 'simulated' nếu không) → chỉ gate
  //     nhánh REAL-MOTION. Robot được định danh trong interlock rule qua targetMachineId
  //     (quy ước xuyên suốt interlockEngine: robotId = rule.targetMachineId ?? rule.machineId),
  //     nên map machineId=robotId. Robot không có OT-adapter/tag → adapterId sentinel (-1, không
  //     serial thật nào khớp) + tagKeys rỗng, vì vậy CHỈ rule nhắm targetMachineId=robotId (action
  //     chặn/dừng, enabled+approved) mới chặn. Rule đang vi phạm HOẶC lỗi đánh giá (failClosed) →
  //     TỪ CHỐI, KHÔNG gọi driver.runJob.
  {
    const { evaluateInterlockGate } = await import("../interlock/interlockGate");
    const gate = await evaluateInterlockGate({
      adapterId: -1,
      machineId: input.robotId,
      tagKeys: [],
    });
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
  const timeoutMs = Math.max(1000, Number(process.env.ROBOT_CONTROL_TIMEOUT_MS) || 10_000);
  try {
    const result = await Promise.race<RobotJobResult>([
      robot.driver.runJob(input.job),
      new Promise<RobotJobResult>((_, rej) => setTimeout(() => rej(new Error("robot job timeout")), timeoutMs)),
    ]);
    const status = result.ok ? "done" : "failed";
    const jobId = await record(input, status, result.detail, result.error);
    return { ok: result.ok, status, jobId, error: result.error };
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    const jobId = await record(input, "failed", undefined, msg);
    return { ok: false, status: "failed", jobId, error: msg };
  }
}
