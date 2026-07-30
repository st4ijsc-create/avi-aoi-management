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
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { getDb } from "../db/connection";
import { and, desc, eq } from "drizzle-orm";
import { robotBehaviorAnomalies, modelRollbackEvents } from "../../drizzle/schema";
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
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const conds = [] as ReturnType<typeof eq>[];
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
      const [row] = await db
        .update(robotBehaviorAnomalies)
        .set({ status: "acknowledged", acknowledgedBy: ctx.user.id, acknowledgedAt: new Date() })
        .where(eq(robotBehaviorAnomalies.id, input.id))
        .returning();
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Anomaly not found" });
      return row;
    }),

  /** Manually trigger an anomaly scan for a robot (flag-gated — same as the auto hook). */
  scanRobot: protectedProcedure
    .use(requirePermission("machine_control", "canEdit"))
    .input(z.object({ robotId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      if (!isRobotAnomalyEnabled()) {
        throw new TRPCError({ code: "CONFLICT", message: "Robot anomaly detection disabled (set AI_ROBOT_ANOMALY_ENABLED=true)" });
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
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const where = input.modelId ? eq(modelRollbackEvents.modelId, input.modelId) : undefined;
      return db
        .select()
        .from(modelRollbackEvents)
        .where(where)
        .orderBy(desc(modelRollbackEvents.createdAt))
        .limit(input.limit);
    }),

  /** Run the auto-rollback evaluation for one model now (flag-gated). */
  evaluateRollback: protectedProcedure
    .use(requirePermission("machine_control", "canEdit"))
    .input(z.object({ modelId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      if (!isModelAutoRollbackEnabled()) {
        throw new TRPCError({ code: "CONFLICT", message: "Model auto-rollback disabled (set AI_MODEL_AUTOROLLBACK_ENABLED=true)" });
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
  manualRollback: protectedProcedure
    .use(requirePermission("machine_control", "canEdit"))
    .input(z.object({
      modelId: z.number().int().positive(),
      toVersionId: z.number().int().positive(),
      reason: z.string().max(500).optional(),
      force: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const outcome = await manualRollback(
        input.modelId, input.toVersionId, ctx.user.id, input.reason ?? "Manual rollback",
        { force: input.force === true },
      );
      if (!outcome.rolledBack) throw new TRPCError({ code: "BAD_REQUEST", message: outcome.reason });
      return outcome;
    }),
});
