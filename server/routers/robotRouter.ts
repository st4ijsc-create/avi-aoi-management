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
import { robots, robotTelemetry, robotJobs } from "../../drizzle/schema";
import { eq, desc } from "drizzle-orm";
import { getRobotVendorValidation, ROBOT_VENDOR_VALIDATION } from "../services/robot";
import { dispatchRobotJob } from "../services/robot/robotCommandDispatcher";
import type { RobotJobType } from "../services/robot/robotDriver";

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
      return rows.map((r) => ({ ...r, validationStatus: getRobotVendorValidation(r.vendor) }));
    }),

  get: protectedProcedure
    .use(requirePermission("machine_control", "canView"))
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const [row] = await db.select().from(robots).where(eq(robots.id, input.id)).limit(1);
      if (!row) return null;
      return { ...row, validationStatus: getRobotVendorValidation(row.vendor) };
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
      const driver = createRobotDriver(r.vendor);
      try {
        await driver.connect({ endpoint: r.endpoint, options: r.connectionOptions ?? undefined });
        const state = await driver.getState();
        return { ok: true, state };
      } catch (err) {
        return { ok: false, error: (err as Error)?.message ?? String(err) };
      } finally {
        try { await driver.disconnect(); } catch { /* ignore */ }
      }
    }),

  // ENG-F1 (doc 40) — INTERLOCK PREVIEW (read-only). Chạy CHÍNH XÁC phép đánh giá interlock
  // mà dispatcher sẽ dùng cho robot này (adapterId=-1, machineId=robotId, tagKeys=[]) nhưng
  // KHÔNG ghi gì — để Command Console hiển thị interlock-check TRƯỚC khi gửi. Đây chỉ là bản
  // xem trước; gate THẬT vẫn nằm trong robotCommandDispatcher (fail-closed, đồng bộ).
  interlockPreview: protectedProcedure
    .use(requirePermission("machine_control", "canView"))
    .input(z.object({ robotId: z.number() }))
    .query(async ({ input }) => {
      const { evaluateInterlockGate } = await import("../services/interlock/interlockGate");
      const gate = await evaluateInterlockGate({ adapterId: -1, machineId: input.robotId, tagKeys: [] });
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
