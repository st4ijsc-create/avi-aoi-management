/**
 * Phase 3 — Robot router: registry CRUD + read-only telemetry/jobs + connection
 * test. Motion control is NOT exposed here — it goes through the internal
 * robotCommandDispatcher (HITL/dry-run gated), mirroring the OT design.
 */
import { z } from "zod";
import { appError } from "../_core/appError";
import { router, protectedProcedure, adminProcedure, actuationProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { getDb } from "../db/connection";
import { createAuditLog } from "../db";
import { robots, robotTelemetry, robotJobs } from "../../drizzle/schema";
import { eq, desc } from "drizzle-orm";
import { getRobotVendorValidation, ROBOT_VENDOR_VALIDATION } from "../services/robot";
import { dispatchRobotJob, robotInterlockTarget } from "../services/robot/robotCommandDispatcher";
import { getActiveRobot } from "../services/robot/robotManager";
import { MotionLockConflictError, type MotionLockState, type RobotJobType } from "../services/robot/robotDriver";

/**
 * doc 81 Đợt 1B Task 5 fix round 4 (ruling R13) — the LIVE state of a robot in THIS process (what
 * robotManager holds), attached to robot.list / robot.get so the UI that already reads them can
 * show "link lost" and the MOTION LOCK. `active=false` ⇒ the gateway has not loaded this robot
 * (disabled, or ROBOT_GATEWAY_ENABLED off) and there is nothing live to report.
 */
export interface RobotLiveState {
  active: boolean;
  connected: boolean;
  motionLock: MotionLockState | null;
}
function robotLiveState(robotId: number): RobotLiveState {
  const rt = getActiveRobot(robotId);
  if (!rt) return { active: false, connected: false, motionLock: null };
  let connected = false;
  try {
    connected = rt.driver.isConnected();
  } catch {
    connected = false;
  }
  return { active: true, connected, motionLock: rt.driver.getMotionLock?.() ?? null };
}
import {
  isTechmanScriptAllowed,
  isTechmanUnvalidatedConsoleVerb,
  TECHMAN_CONSOLE_VERB_UNVALIDATED,
  TECHMAN_SCRIPT_ALLOWLIST,
} from "../services/robot/drivers/techmanScriptAllowlist";

const vendorEnum = z.enum(["fanuc", "mitsubishi", "delta", "techman", "sim", "vda5050"]);
const kindEnum = z.enum(["arm", "scara", "cobot", "agv"]);

// ENG-F1 (doc 40) — các lệnh đơn lẻ Command Console được phép PHÁT qua HITL dispatcher.
// Đây là verb PackML/capability (start/stop/home/reset/pause/abort) — KHÔNG phải motion tự do.
const consoleCommandEnum = z.enum(["start", "stop", "home", "reset", "pause", "abort"]);

/**
 * Map một verb console → RobotJobType. 'stop'/'abort' → 'abort' (driver dừng chuyển động),
 * 'home' → 'home'; các verb điều-khiển-trạng-thái còn lại (start/reset/pause) → 'custom' với
 * verb kèm trong params (driver honest-log; real-run vẫn qua mode+commissioning+interlock gate).
 */
function verbToJobType(verb: z.infer<typeof consoleCommandEnum>): RobotJobType {
  switch (verb) {
    case "stop":
    case "abort":
      return "abort";
    case "home":
      return "home";
    default:
      return "custom";
  }
}

export const robotRouter = router({
  // Doc 38 Đợt Q — these rows carry `endpoint` + `connectionOptions` (device address
  // and, potentially, connection credentials). Gate behind machine_control/canView so
  // the connection surface is not exposed to every authenticated user.
  list: protectedProcedure
    .use(requirePermission("machine_control", "canView"))
    .query(async () => {
      const db = await getDb();
      if (!db) return [];
      const rows = await db.select().from(robots).orderBy(desc(robots.updatedAt));
      // CTL-05 — kèm validationStatus per-vendor để UI badge (spec-verified/assumed/mock).
      // Fix round 4 (R13) — kèm `live` (kết nối + khoá chuyển động của tiến trình này).
      return rows.map((r) => ({ ...r, validationStatus: getRobotVendorValidation(r.vendor), live: robotLiveState(r.id) }));
    }),

  get: protectedProcedure
    .use(requirePermission("machine_control", "canView"))
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const [row] = await db.select().from(robots).where(eq(robots.id, input.id)).limit(1);
      if (!row) return null;
      return { ...row, validationStatus: getRobotVendorValidation(row.vendor), live: robotLiveState(row.id) };
    }),

  // doc 81 Đợt 1B Task 5 fix round 4 (ruling R13) — NGƯỜI VẬN HÀNH GỠ KHOÁ CHUYỂN ĐỘNG.
  // Sau một lần rớt kết nối / kết cục chuyển động không rõ, driver (MELFA/Delta/FANUC) KHOÁ chuyển
  // động; poll chỉ đọc vẫn nối lại được nhưng chuyển động bị cổng 3 của dispatcher từ chối
  // (MOTION_LOCKED). Khoá tự gỡ khi một STOP được driver xác nhận; đường còn lại là mutation này:
  //   • sàn vai actuation (admin/supervisor/engineer + 2FA theo cấu hình) + machine_control/canEdit,
  //   • ghi audit (createAuditLog) TRƯỚC khi gỡ — không ghi được thì KHÔNG gỡ (fail-closed),
  //   • trả trạng thái mới. Không gửi byte nào tới robot.
  //   • fix round 5 (item 2): COMPARE-AND-CLEAR — the UI sends the lock `generation` it displayed; a
  //     new link loss during the dialog or the audit write bumps it and the clear is refused with
  //     CONFLICT (the newer lock is never erased by a decision taken about the older one).
  clearMotionLock: actuationProcedure
    .use(requirePermission("machine_control", "canEdit"))
    .input(z.object({
      robotId: z.number().int().positive(),
      reason: z.string().trim().min(3).max(500),
      expectedGeneration: z.number().int().nonnegative(),
    }))
    .mutation(async ({ ctx, input }) => {
      const conflict = (state: MotionLockState) =>
        appError(
          "CONFLICT",
          "OPERATION_FAILED",
          { operation: "clearRobotMotionLock", reason: "motionLockChanged" },
          `motion lock changed while you were confirming — now generation ${state.generation ?? "?"} (${state.reasonCode ?? "link loss"} since ${state.since ?? "?"}); re-read the robot state and confirm again`,
        );
      const rt = getActiveRobot(input.robotId);
      if (!rt) {
        throw appError(
          "PRECONDITION_FAILED",
          "OPERATION_FAILED",
          { operation: "clearRobotMotionLock", reason: "robotNotActive" },
          `robot ${input.robotId} is not active in this process (not loaded by the robot gateway) — there is no live motion lock to clear`,
        );
      }
      const driver = rt.driver;
      if (typeof driver.getMotionLock !== "function" || typeof driver.clearMotionLock !== "function") {
        throw appError(
          "PRECONDITION_FAILED",
          "OPERATION_FAILED",
          { operation: "clearRobotMotionLock", reason: "motionLockUnsupported" },
          `${rt.vendor} driver has no motion lock (one-shot transport) — nothing to clear`,
        );
      }
      const connectedNow = () => {
        try {
          return driver.isConnected();
        } catch {
          return false;
        }
      };
      const before = driver.getMotionLock();
      if (!before.locked) {
        return { robotId: input.robotId, changed: false, connected: connectedNow(), motionLock: before };
      }
      // Fix round 5 — cheap pre-check before any write: the operator decided about an older lock.
      if (before.generation !== input.expectedGeneration) throw conflict(before);
      const auditBase = {
        userId: ctx.user.id,
        userName: ctx.user.name ?? null,
        action: "robot.clearMotionLock",
        entityType: "robot",
        entityId: input.robotId,
        entityName: rt.code,
        ipAddress: ctx.req?.ip ?? null,
        userAgent: (ctx.req?.headers?.["user-agent"] as string | undefined) ?? null,
      };
      // Audit FIRST: if the trail cannot be written the lock stays set.
      await createAuditLog({
        ...auditBase,
        details: { reason: input.reason, vendor: rt.vendor, before, expectedGeneration: input.expectedGeneration },
      });
      let after: MotionLockState;
      try {
        after = driver.clearMotionLock({ reason: input.reason, userId: ctx.user.id, expectedGeneration: input.expectedGeneration });
      } catch (err) {
        if (!(err instanceof MotionLockConflictError)) throw err;
        // The lock changed between the audit row and the clear (a new link loss). Nothing was cleared;
        // record that outcome on the trail (best effort) and refuse.
        try {
          await createAuditLog({
            ...auditBase,
            status: "failure",
            details: { reason: input.reason, vendor: rt.vendor, before, expectedGeneration: input.expectedGeneration, conflict: err.state },
          });
        } catch (auditErr) {
          console.error(`[Robot] audit of a refused motion-lock clear failed (robot ${input.robotId}):`, (auditErr as Error)?.message ?? auditErr);
        }
        throw conflict(err.state);
      }
      console.warn(`[Robot] motion lock cleared by user ${ctx.user.id} on robot ${input.robotId} (${rt.code}): ${input.reason}`);
      return { robotId: input.robotId, changed: true, connected: connectedNow(), motionLock: after };
    }),

  // CTL-05 — bản đồ vendor → validationStatus (spec-verified/assumed/mock) cho UI badge.
  vendorValidation: protectedProcedure
    .use(requirePermission("machine_control", "canView"))
    .query(() => ROBOT_VENDOR_VALIDATION),

  // doc 54 Wave B — telemetry + job log were ungated while list/get are gated; require the
  // machine_monitoring/canView read floor so fleet observation isn't open to every user.
  telemetry: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ robotId: z.number(), limit: z.number().min(1).max(500).default(100) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(robotTelemetry)
        .where(eq(robotTelemetry.robotId, input.robotId))
        .orderBy(desc(robotTelemetry.timestamp))
        .limit(input.limit);
    }),

  jobs: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ robotId: z.number(), limit: z.number().min(1).max(200).default(50) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(robotJobs)
        .where(eq(robotJobs.robotId, input.robotId))
        .orderBy(desc(robotJobs.createdAt))
        .limit(input.limit);
    }),

  create: adminProcedure
    .input(z.object({
      code: z.string().min(1).max(64),
      name: z.string().min(1).max(255),
      vendor: vendorEnum,
      model: z.string().max(128).optional(),
      kind: kindEnum.default("arm"),
      endpoint: z.string().min(1).max(255),
      connectionOptions: z.record(z.string(), z.unknown()).optional(),
      pollIntervalMs: z.number().min(250).max(600000).default(5000),
      lineId: z.number().optional(),
      stationId: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB unavailable");
      const [row] = await db.insert(robots).values({ ...input, isEnabled: false }).returning();
      return row;
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().max(255).optional(),
      model: z.string().max(128).optional(),
      endpoint: z.string().max(255).optional(),
      connectionOptions: z.record(z.string(), z.unknown()).optional(),
      pollIntervalMs: z.number().min(250).max(600000).optional(),
      lineId: z.number().optional(),
      stationId: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB unavailable");
      const { id, ...rest } = input;
      const [row] = await db.update(robots).set({ ...rest, updatedAt: new Date() }).where(eq(robots.id, id)).returning();
      return row;
    }),

  setEnabled: adminProcedure
    .input(z.object({ id: z.number(), enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB unavailable");
      const [row] = await db.update(robots)
        .set({ isEnabled: input.enabled, updatedAt: new Date() })
        .where(eq(robots.id, input.id)).returning();
      return row;
    }),

  // Read-only connection test: open, read state once, disconnect. No motion.
  testConnection: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB unavailable");
      const [r] = await db.select().from(robots).where(eq(robots.id, input.id)).limit(1);
      if (!r) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "robot" }, "robot not found");
      const { createRobotDriver } = await import("../services/robot");
      const { probeRobotConnection } = await import("../services/robot/probeRobotConnection");
      const driver = createRobotDriver(r.vendor);
      // doc 81 Đợt 1B Task 2 (R8) — connect + getState + disconnect trong MỘT hạn tổng; robot im
      // lặng / disconnect treo không giữ được request, kết nối muộn vẫn bị hạ.
      try {
        const state = await probeRobotConnection(driver, {
          endpoint: r.endpoint,
          options: r.connectionOptions ?? undefined,
        });
        return { ok: true, state };
      } catch (err) {
        return { ok: false, error: (err as Error)?.message ?? String(err) };
      }
    }),

  // ENG-F1 (doc 40) — INTERLOCK PREVIEW (read-only). Chạy CHÍNH XÁC phép đánh giá interlock
  // mà dispatcher sẽ dùng cho robot này (robotInterlockTarget: machineId=robotId) nhưng
  // KHÔNG ghi gì — để Command Console hiển thị interlock-check TRƯỚC khi gửi. Đây chỉ là bản
  // xem trước; gate THẬT vẫn nằm trong robotCommandDispatcher (fail-closed, đồng bộ).
  interlockPreview: protectedProcedure
    .use(requirePermission("machine_control", "canView"))
    .input(z.object({ robotId: z.number() }))
    .query(async ({ input }) => {
      const { evaluateInterlockGate } = await import("../services/interlock/interlockGate");
      // doc 81 Đợt 1B Task 5 — CÙNG khoá với cổng thật (robotInterlockTarget), không hai định nghĩa.
      const gate = await evaluateInterlockGate(robotInterlockTarget(input.robotId));
      return { blocked: gate.blocked, failClosed: gate.failClosed, violations: gate.violations };
    }),

  // ENG-F1 (doc 40) — GATED COMMAND CONSOLE: phát MỘT lệnh đơn lẻ (start/stop/home/reset/
  // pause/abort) qua robotCommandDispatcher. GIỮ NGUYÊN MỌI GATE của dispatcher:
  // idempotency · mode gate (dry-run khi ROBOT_CONTROL_ENABLED≠true) · commissioning/FAT ·
  // interlock fail-closed · command-authz (FIELD_V2). Đây là đường operator trực tiếp
  // (triggerKind='manual') — typed-confirm ở UI là human-in-the-loop; requestedBy=confirmedBy
  // =chính operator đã đăng nhập + có quyền machine_control/canEdit. KHÔNG bao giờ fake
  // success: trả trạng thái honest (done/failed/simulated/rejected) đúng như dispatcher.
  // doc 40 QA-3 (blocker): actuate là đường real-motion → PHẢI qua actuationProcedure
  // (role-floor admin/supervisor/engineer + 2FA) như mọi actuation khác, không chỉ
  // protectedProcedure+bit. Dispatcher không kiểm 2FA nên gate phải nằm ở procedure.
  actuate: actuationProcedure
    .use(requirePermission("machine_control", "canEdit"))
    .input(z.object({
      robotId: z.number(),
      command: consoleCommandEnum,
      params: z.record(z.string(), z.unknown()).optional(),
      idempotencyKey: z.string().min(1).max(128).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // doc 81 Đợt 1B Task 4 (BE2 T1-G) — `params` được trải thẳng vào job và TechmanDriver đặt
      // nguyên văn `params.script` vào khung TMSCT ⇒ trước đây gửi được BẤT KỲ TM script nào.
      // Có khoá `script` ⇒ tra vendor; Techman chỉ nhận đúng TECHMAN_SCRIPT_ALLOWLIST. Driver còn
      // tự chặn lần nữa (phòng thủ sâu).
      // doc 81 Đợt 1B Task 5 (R10) — cùng mẫu hai lớp (router FORBIDDEN + driver từ chối):
      //   • Techman + verb start/reset/pause ⇒ từ chối `techman_console_verb_unvalidated` (job
      //     `custom` mặc định ScriptExit() ⇒ TMflow chạy tiếp flow, có thể chuyển động);
      //   • UR + `params.script` ⇒ từ chối (URScript tuỳ ý đi thẳng xuống robot);
      //   • UR + `params.home` ⇒ từ chối (movej tới đích tuỳ ý); home CHỈ lấy từ cấu hình robot.
      // Không có khoá script/home và không phải verb start/reset/pause ⇒ không tra CSDL, đường cũ
      // giữ nguyên.
      const params = input.params ?? {};
      const hasParam = (k: string) => Object.prototype.hasOwnProperty.call(params, k);
      if (hasParam("script") || hasParam("home") || isTechmanUnvalidatedConsoleVerb(input.command)) {
        const db = await getDb();
        if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB unavailable");
        const [r] = await db
          .select({ vendor: robots.vendor })
          .from(robots)
          .where(eq(robots.id, input.robotId))
          .limit(1);
        if (!r) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "robot" }, "robot not found");
        if (r.vendor === "techman" && hasParam("script") && !isTechmanScriptAllowed(params.script)) {
          throw appError(
            "FORBIDDEN",
            "PERMISSION_DENIED",
            { action: "sendTechmanScript", reason: "techmanScriptNotAllowlisted" },
            `Techman script is not in the allowlist (${TECHMAN_SCRIPT_ALLOWLIST.join(", ")}) — refused, nothing was sent.`,
          );
        }
        if (r.vendor === "techman" && isTechmanUnvalidatedConsoleVerb(input.command)) {
          throw appError(
            "FORBIDDEN",
            "PERMISSION_DENIED",
            { action: "sendTechmanConsoleVerb", reason: "techmanConsoleVerbUnvalidated" },
            `${TECHMAN_CONSOLE_VERB_UNVALIDATED}: Techman console '${input.command}' is not validated (it would send ScriptExit() and TMflow would continue the flow) — refused, nothing was sent.`,
          );
        }
        if (r.vendor === "ur" && hasParam("script")) {
          throw appError(
            "FORBIDDEN",
            "PERMISSION_DENIED",
            { action: "sendUrScript", reason: "urScriptForbidden" },
            "ur_script_forbidden: raw URScript is not accepted from the console — refused, nothing was sent.",
          );
        }
        if (r.vendor === "ur" && hasParam("home")) {
          throw appError(
            "FORBIDDEN",
            "PERMISSION_DENIED",
            { action: "overrideUrHome", reason: "urHomeParamForbidden" },
            "ur_home_param_forbidden: the UR home pose comes only from the robot's stored configuration — refused, nothing was sent.",
          );
        }
      }
      const res = await dispatchRobotJob({
        robotId: input.robotId,
        job: {
          jobType: verbToJobType(input.command),
          params: { command: input.command, ...(input.params ?? {}) },
        },
        triggerKind: "manual",
        requestedBy: ctx.user.id,
        confirmedBy: ctx.user.id,
        idempotencyKey: input.idempotencyKey,
      });
      return res;
    }),
});
