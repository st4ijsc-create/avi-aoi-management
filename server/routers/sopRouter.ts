/**
 * doc 44 W6-1 (G5.14) — e-SOP router (SYNAPSE LDS-L5 §6.2).
 *
 * RBAC:
 *   • Đọc (list/get/resolve/executions):  protectedProcedure.
 *   • Soạn/quản trị SOP (create/update/setStatus/clone/delete/replaceSteps):
 *     roleProcedure('admin','supervisor','engineer') — kỹ sư quá trình soạn SOP.
 *   • Thực thi (startExecution/confirmStep/finish/abandon):  operatorProcedure
 *     (admin/supervisor/operator) — vận hành viên chạy checklist tại chỗ.
 *
 * KHÔNG có đường ghi xuống máy (catalog + sổ thao tác tay). Mutation thực thi trả
 * result-union {ok:false, code} NGUYÊN TRẠNG cho lý do nghiệp vụ (cổng chưa thỏa).
 */
import { z } from "zod";
import { router, protectedProcedure, roleProcedure, operatorProcedure } from "../_core/trpc";
import {
  listSops,
  getSop,
  resolveActiveSop,
  createSop,
  updateSop,
  setSopStatus,
  deleteSop,
  cloneAsNewVersion,
  replaceSteps,
  startExecution,
  confirmStep,
  finishExecution,
  abandonExecution,
  getExecution,
  listExecutions,
} from "../services/sopService";

const authorProcedure = roleProcedure("admin", "supervisor", "engineer");

const stepInput = z.object({
  stepNo: z.number().int().min(1),
  text: z.string().min(1).max(5000),
  mediaRef: z.string().max(500).nullable().optional(),
  requiresConfirm: z.boolean().optional(),
  expectedInput: z.string().max(255).nullable().optional(),
});

export const sopRouter = router({
  // ── Đọc ─────────────────────────────────────────────────────────────────────
  list: protectedProcedure
    .input(
      z
        .object({
          status: z.enum(["draft", "active", "retired"]).optional(),
          productModelId: z.number().int().positive().nullable().optional(),
          stationId: z.number().int().positive().nullable().optional(),
          code: z.string().max(80).optional(),
          limit: z.number().int().min(1).max(500).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => listSops(input ?? {})),

  get: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => getSop(input.id)),

  /** Chọn SOP đang hiệu lực theo ngữ cảnh sản phẩm/trạm (dùng cho SopViewer). */
  resolveActive: protectedProcedure
    .input(
      z.object({
        productModelId: z.number().int().positive().nullable().optional(),
        stationId: z.number().int().positive().nullable().optional(),
      }),
    )
    .query(async ({ input }) => resolveActiveSop(input)),

  executions: protectedProcedure
    .input(z.object({ sopId: z.number().int().positive(), limit: z.number().int().min(1).max(200).optional() }))
    .query(async ({ input }) => listExecutions(input.sopId, input.limit ?? 50)),

  execution: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => getExecution(input.id)),

  // ── Soạn / quản trị SOP (engineer/admin/supervisor) ───────────────────────────
  create: authorProcedure
    .input(
      z.object({
        code: z.string().min(1).max(80),
        title: z.string().min(1).max(255),
        description: z.string().max(5000).nullable().optional(),
        productModelId: z.number().int().positive().nullable().optional(),
        stationId: z.number().int().positive().nullable().optional(),
        version: z.number().int().min(1).optional(),
        status: z.enum(["draft", "active", "retired"]).optional(),
        steps: z.array(stepInput).max(200).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => createSop({ ...input, createdBy: ctx.user.id })),

  update: authorProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        title: z.string().min(1).max(255).optional(),
        description: z.string().max(5000).nullable().optional(),
        productModelId: z.number().int().positive().nullable().optional(),
        stationId: z.number().int().positive().nullable().optional(),
        steps: z.array(stepInput).max(200).optional(),
      }),
    )
    .mutation(async ({ input }) => updateSop(input)),

  replaceSteps: authorProcedure
    .input(z.object({ sopId: z.number().int().positive(), steps: z.array(stepInput).max(200) }))
    .mutation(async ({ input }) => replaceSteps(input.sopId, input.steps)),

  setStatus: authorProcedure
    .input(z.object({ id: z.number().int().positive(), status: z.enum(["draft", "active", "retired"]) }))
    .mutation(async ({ input }) => setSopStatus(input.id, input.status)),

  cloneNewVersion: authorProcedure
    .input(z.object({ sopId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => cloneAsNewVersion(input.sopId, ctx.user.id)),

  delete: authorProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => deleteSop(input.id)),

  // ── Thực thi (operator) ───────────────────────────────────────────────────────
  startExecution: operatorProcedure
    .input(
      z.object({
        sopId: z.number().int().positive(),
        unitSerial: z.string().max(128).nullable().optional(),
        lineId: z.number().int().positive().nullable().optional(),
        stationId: z.number().int().positive().nullable().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => startExecution({ ...input, operatorId: ctx.user.id })),

  confirmStep: operatorProcedure
    .input(
      z.object({
        executionId: z.number().int().positive(),
        stepNo: z.number().int().min(1),
        input: z.string().max(255).nullable().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => confirmStep(input.executionId, input.stepNo, input.input, ctx.user.id)),

  finishExecution: operatorProcedure
    .input(z.object({ executionId: z.number().int().positive() }))
    .mutation(async ({ input }) => finishExecution(input.executionId)),

  abandonExecution: operatorProcedure
    .input(z.object({ executionId: z.number().int().positive() }))
    .mutation(async ({ input }) => abandonExecution(input.executionId)),
});
