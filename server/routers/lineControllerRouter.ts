/**
 * doc 44 W3-A2 / G3.1 — Line Controller tRPC router (UI nội bộ).
 *
 * Read: getState / listStates / stages / readiness / transitions / status
 *   → protectedProcedure (mọi user đã đăng nhập — read-only, không mở control path).
 * Write: transition / command
 *   → actuationProcedure (role-floor admin/supervisor/engineer + 2FA — doc 38 Đợt Q;
 *     đúng pattern mọi đường machine-control). Policy seam + FSM validate + audit
 *     nằm TRONG lineControllerService (một cửa — REST /v1/lines đi cùng đường).
 *
 * Mutation trả TransitionResult NGUYÊN TRẠNG (ok:true|false + code phân loại +
 * readiness checks) để UI render checklist/allowed-list — không ném TRPCError
 * cho lý do nghiệp vụ.
 */
import { z } from "zod";
import { protectedProcedure, actuationProcedure, router } from "../_core/trpc";
import { LINE_STATES } from "../../drizzle/schema";
import {
  listLinesWithState,
  getLineStateDetail,
  getLineStages,
  transitionLine,
  executeLineCommand,
  getLineControllerStatus,
  LINE_COMMANDS,
} from "../services/lineController/lineControllerService";
import { checkLineReadiness } from "../services/lineController/lineReadiness";
import { listTransitions } from "../services/lineController/lineStateRepo";

const lineIdSchema = z.number().int().positive();

export const lineControllerRouter = router({
  /** Mọi tuyến ACTIVE + trạng thái FSM (tuyến chưa có row → 'idle'). */
  listStates: protectedProcedure.query(async () => {
    return listLinesWithState();
  }),

  /** Trạng thái + nhịp/bottleneck + readiness cache + transitions gần nhất. */
  getState: protectedProcedure
    .input(z.object({ lineId: lineIdSchema }))
    .query(async ({ input }) => {
      return getLineStateDetail(input.lineId);
    }),

  /** Trạng thái từng trạm: máy, op-state, dwell, blocked/starved (spec §13.2). */
  stages: protectedProcedure
    .input(z.object({ lineId: lineIdSchema }))
    .query(async ({ input }) => {
      return getLineStages(input.lineId);
    }),

  /** Chạy checklist sẵn sàng MỚI (không dùng cache) — spec §6.2. */
  readiness: protectedProcedure
    .input(z.object({ lineId: lineIdSchema, requireRecipe: z.boolean().optional() }))
    .query(async ({ input }) => {
      return checkLineReadiness(input.lineId, { requireRecipe: input.requireRecipe ?? false });
    }),

  /** Lịch sử transition (audit append-only, gồm cả row POLICY_DENIED). */
  transitions: protectedProcedure
    .input(z.object({ lineId: lineIdSchema, limit: z.number().int().min(1).max(200).default(20) }))
    .query(async ({ input }) => {
      return listTransitions(input.lineId, input.limit);
    }),

  /** Trạng thái runtime của sweep scheduler + events gần nhất. */
  status: protectedProcedure.query(() => getLineControllerStatus()),

  /**
   * Chuyển trạng thái tường minh (FSM validate + readiness khi vào 'ready' +
   * policy seam + persist + publish). Trả TransitionResult — UI kiểm `ok`.
   */
  transition: actuationProcedure
    .input(
      z.object({
        lineId: lineIdSchema,
        to: z.enum(LINE_STATES),
        reason: z.string().max(500).optional(),
        heldReason: z.string().max(500).optional(),
        recipeSetRef: z.string().max(200).optional(),
        requireRecipe: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return transitionLine(input.lineId, input.to, {
        reason: input.reason,
        heldReason: input.heldReason,
        recipeSetRef: input.recipeSetRef,
        requireRecipe: input.requireRecipe,
        actor: String(ctx.user.id),
      });
    }),

  /** Lệnh tuyến mức cao (start|hold|resume|changeover|complete|reset_fault). */
  command: actuationProcedure
    .input(
      z.object({
        lineId: lineIdSchema,
        command: z.enum(LINE_COMMANDS),
        reason: z.string().max(500).optional(),
        recipeSetRef: z.string().max(200).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return executeLineCommand(input.lineId, input.command, {
        reason: input.reason,
        recipeSetRef: input.recipeSetRef,
        actor: String(ctx.user.id),
      });
    }),
});
