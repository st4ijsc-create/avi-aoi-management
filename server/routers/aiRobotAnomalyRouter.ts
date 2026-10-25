/**
 * I2 (doc 16 §9 Khối 4 / doc 18 §6) — AI LOOP router.
 *   • I2-a robot-behaviour anomaly: list advisory anomalies + acknowledge.
 *   • I2-b model auto-rollback: rollback history + manual trigger rollback.
 *
 * RBAC (mirrors equipmentIntegrationRouter / fleetRouter):
 *   • reads     → machine_monitoring / canView
 *   • mutations → machine_control    / canEdit  (+ flag guard where applicable)
 * ctx.user is the source of truth — never the request body.
 *
 * SAFETY / NO-OP: anomalies are ADVISORY (no robot command). Rollback only flips a
 * model_versions.status (the SAME operation manual activation performs). The AUTOMATIC
 * sweep is gated by AI_MODEL_AUTOROLLBACK_ENABLED; a human manual rollback here is
 * allowed regardless of the flag (mirrors manual model activation), but is still perm-gated.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { router, moduleProcedure, moduleGate, roleProcedure, require2FA } from "../_core/trpc";
// ★ Cổng giấy phép MOD_AI — chỉ THÊM chiều giấy phép, RBAC/vai/2FA giữ nguyên từng ký tự.
//   Không-brick + fail-safe ở `_core/moduleGate.ts`; lượng từ canh ở `congGiayPhepAiCensus.test.ts`.
const protectedProcedure = moduleProcedure("MOD_AI");
/**
 * W17d (kiểm định phamViGhi, 2026-10-25; dieu-phoi duyệt) — QUAY LUI MODEL là hành động đổi model TOÀN CỤC cho MỌI nhà máy: sàn của model-card (admin · kỹ sư + 2FA + giấy phép MOD_AI)
 * VÀ chỉ người TOÀN QUYỀN theo phạm vi (kỹ sư / giám sát viên một nhà máy ⇒ NOT_FOUND). Trước: chỉ `machine_control.canEdit` — giám sát viên nhà máy A quay lui được model dùng chung.
 */
const quayLuiProcedure = roleProcedure("admin", "engineer").use(require2FA).use(moduleGate("MOD_AI"));
import { requirePermission } from "../_core/accessControl";
import { getDb } from "../db/connection";
import { and, desc, eq } from "drizzle-orm";
import { robotBehaviorAnomalies, modelRollbackEvents } from "../../drizzle/schema";
import { robotTrongPhamVi } from "./_robotPhamVi";
import { chiToanQuyenGhi } from "./_cauHinhPhamVi";
import { congBatThuongRobot, congRollbackMoHinh } from "./_aiPhamVi";
import { isRobotAnomalyEnabled } from "../services/ai/robotBehaviorAnomaly";
import { detectAndRaiseForRobot } from "../services/ai/robotBehaviorAnomalyService";
import {
  isModelAutoRollbackEnabled,
  runRollbackForModel,
  manualRollback,
} from "../services/ai/modelAutoRollback";

export const aiRobotAnomalyRouter = router({
  /** UI gating hint — are the I2 flags on? */
  status: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(() => ({
      robotAnomalyEnabled: isRobotAnomalyEnabled(),
      modelAutoRollbackEnabled: isModelAutoRollbackEnabled(),
    })),

  // ─── I2-a robot-behaviour anomalies ─────────────────────────────────────────

  listAnomalies: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({
      robotId: z.number().int().positive().optional(),
      status: z.enum(["raised", "acknowledged"]).optional(),
      limit: z.number().int().min(1).max(200).default(50),
    }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return [];
      const conds = [] as any[];
      const congPv = await congBatThuongRobot(ctx); // phạm vi người dùng (L6b 2026-10-25)
      if (congPv) conds.push(congPv);
      if (input.robotId) conds.push(eq(robotBehaviorAnomalies.robotId, input.robotId));
      if (input.status) conds.push(eq(robotBehaviorAnomalies.status, input.status));
      const where = conds.length ? and(...conds) : undefined;
      return db
        .select()
        .from(robotBehaviorAnomalies)
        .where(where)
        .orderBy(desc(robotBehaviorAnomalies.detectedAt))
        .limit(input.limit);
    }),

  acknowledgeAnomaly: protectedProcedure
    .use(requirePermission("machine_control", "canEdit"))
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB unavailable");
      // phạm vi nhà máy (rà bảo mật 2026-10-24): bất thường của robot ngoài phạm vi ≡ "Anomaly not found" — kiểm TRƯỚC khi ghi
      const [cu] = await db.select({ robotId: robotBehaviorAnomalies.robotId }).from(robotBehaviorAnomalies).where(eq(robotBehaviorAnomalies.id, input.id)).limit(1);
      if (cu) {
        try {
          await robotTrongPhamVi(ctx, cu.robotId);
        } catch {
          throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "anomaly" }, "Anomaly not found");
        }
      }
      const [row] = await db
        .update(robotBehaviorAnomalies)
        .set({ status: "acknowledged", acknowledgedBy: ctx.user.id, acknowledgedAt: new Date() })
        .where(eq(robotBehaviorAnomalies.id, input.id))
        .returning();
      if (!row) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "anomaly" }, "Anomaly not found");
      return row;
    }),

  /** Manually trigger an anomaly scan for a robot (flag-gated — same as the auto hook). */
  scanRobot: protectedProcedure
    .use(requirePermission("machine_control", "canEdit"))
    .input(z.object({ robotId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      await robotTrongPhamVi(ctx, input.robotId); // phạm vi nhà máy (rà bảo mật 2026-10-24): quét robot nhà máy khác ≡ không tồn tại
      if (!isRobotAnomalyEnabled()) {
        throw appError("CONFLICT", "FEATURE_DISABLED", { feature: "robotAnomalyDetection" }, "Robot anomaly detection disabled (set AI_ROBOT_ANOMALY_ENABLED=true)");
      }
      const anomalies = await detectAndRaiseForRobot(input.robotId);
      return { count: anomalies.length, anomalies };
    }),

  // ─── I2-b model auto-rollback ───────────────────────────────────────────────

  rollbackHistory: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({
      modelId: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(200).default(50),
    }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return [];
      const where = and(input.modelId ? eq(modelRollbackEvents.modelId, input.modelId) : undefined, await congRollbackMoHinh(ctx)); // phạm vi người dùng (L6b 2026-10-25)
      return db
        .select()
        .from(modelRollbackEvents)
        .where(where)
        .orderBy(desc(modelRollbackEvents.createdAt))
        .limit(input.limit);
    }),

  /** Run the auto-rollback evaluation for one model now (flag-gated). */
  evaluateRollback: quayLuiProcedure
    .use(requirePermission("machine_control", "canEdit"))
    .input(z.object({ modelId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      await chiToanQuyenGhi(ctx, "aiModel"); // W17d — model toàn cục: chỉ toàn quyền
      if (!isModelAutoRollbackEnabled()) {
        throw appError("CONFLICT", "FEATURE_DISABLED", { feature: "modelAutoRollback" }, "Model auto-rollback disabled (set AI_MODEL_AUTOROLLBACK_ENABLED=true)");
      }
      return runRollbackForModel(input.modelId);
    }),

  /**
   * Manually roll a model back to a chosen version (allowed regardless of the flag).
   * doc69 W0-2 follow-up: the target is an ARBITRARY human choice (not constrained by
   * pickRollbackTarget), so manualRollback() now enforces the SAME eval quality gate
   * as manual activation. A target whose evalReport.gate.pass !== true is rejected
   * unless `force: true` (+ this `reason`, doubling as the audited override reason).
   */
  manualRollback: quayLuiProcedure
    .use(requirePermission("machine_control", "canEdit"))
    .input(z.object({
      modelId: z.number().int().positive(),
      toVersionId: z.number().int().positive(),
      reason: z.string().max(500).optional(),
      force: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await chiToanQuyenGhi(ctx, "aiModel"); // W17d — model toàn cục: chỉ toàn quyền
      const outcome = await manualRollback(
        input.modelId, input.toVersionId, ctx.user.id, input.reason ?? "Manual rollback",
        { force: input.force === true },
      );
      if (!outcome.rolledBack) throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "rollbackAiModel" }, outcome.reason);
      return outcome;
    }),
});
