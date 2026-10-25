/**
 * doc 44 W5-A2 (G4.18/G4.19/G4.20/G4.21) — Parameter guardrails + material forecast.
 *
 * Guardrail CRUD (list/get/set/delete) = actuationProcedure (role-floor
 * admin/supervisor/engineer + 2FA — pattern mọi đường machine-control): dải min–max
 * là ràng buộc AN TOÀN nhạy cảm, chỉ kỹ sư quá trình được đặt/sửa/xoá/xem.
 * changeLog.list + materialForecast.* = protectedProcedure (read-only).
 *
 * Mutation trả result-union {ok:false, code} NGUYÊN TRẠNG cho lý do nghiệp vụ
 * (dải sai/thiếu target) — không ném TRPCError.
 */
import { hangRaoGhi, hangRaoTheoIdGhi } from "./_cauHinhPhamVi";
import { dieuKienCauHinhTrongPhamVi, dieuKienDoiTuongTrongPhamVi, idsMayTrongPhamVi, mayTrongPhamVi } from "./_adapterPhamVi";
import { parameterGuardrails, parameterChangeLog } from "../../drizzle/schema";
import { z } from "zod";
import { protectedProcedure, actuationProcedure, router } from "../_core/trpc";
import {
  setGuardrail,
  deleteGuardrail,
  listGuardrails,
  getGuardrail,
  listChangeLog,
} from "../services/ai/parameterGuardrailService";
import { forecastTimeToEmpty, forecastMachineMaterials } from "../services/ai/materialForecastService";

export const parameterGuardrailRouter = router({
  // ── Guardrail CRUD (engineer authoring — actuation role-floor + 2FA) ──────────
  list: actuationProcedure
    .input(z.object({ machineId: z.number().int().positive().optional(), machineType: z.string().max(120).optional() }).optional())
    // phạm vi người dùng (L6c 2026-10-25): hàng theo máy ⇒ máy trong phạm vi; hàng theo LOẠI máy (machine_type, machineId NULL) vẫn thấy (dải an toàn vận hành — dieu-phoi duyệt)
    .query(async ({ input, ctx }) => listGuardrails({ machineId: input?.machineId, machineType: input?.machineType, dieuKienPhamVi: await dieuKienCauHinhTrongPhamVi(ctx, { may: parameterGuardrails.machineId }) })),

  get: actuationProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }) => getGuardrail(input.id, await dieuKienCauHinhTrongPhamVi(ctx, { may: parameterGuardrails.machineId }))), // phạm vi người dùng (L6c 2026-10-25)

  set: actuationProcedure
    .input(
      z
        .object({
          scope: z.enum(["machine", "machine_type"]),
          machineId: z.number().int().positive().nullable().optional(),
          machineType: z.string().min(1).max(120).nullable().optional(),
          paramKey: z.string().min(1).max(200),
          minValue: z.number().finite(),
          maxValue: z.number().finite(),
          maxStep: z.number().positive().nullable().optional(),
          unit: z.string().max(40).nullable().optional(),
          requiresTwinValidation: z.boolean().optional(),
          notes: z.string().max(2000).nullable().optional(),
        })
        .strict(),
    )
    .mutation(async ({ input, ctx }) => {
      await hangRaoGhi(ctx, { scope: input.scope, machineId: input.machineId }); // phạm vi nhà máy (W14b) — không đổi logic guardrail
      return setGuardrail({
        scope: input.scope,
        machineId: input.machineId ?? null,
        machineType: input.machineType ?? null,
        paramKey: input.paramKey,
        minValue: input.minValue,
        maxValue: input.maxValue,
        maxStep: input.maxStep ?? null,
        unit: input.unit ?? null,
        requiresTwinValidation: input.requiresTwinValidation ?? false,
        notes: input.notes ?? null,
        setBy: ctx.user.id,
      });
    }),

  delete: actuationProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      await hangRaoTheoIdGhi(ctx, input.id); // phạm vi nhà máy (W14b)
      return { ok: await deleteGuardrail(input.id) };
    }),

  // ── Change log (read-only) ────────────────────────────────────────────────────
  changeLog: protectedProcedure
    .input(
      z
        .object({
          machineId: z.number().int().positive().optional(),
          paramKey: z.string().max(200).optional(),
          limit: z.number().int().min(1).max(500).default(100),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) =>
      listChangeLog({ machineId: input?.machineId, paramKey: input?.paramKey, limit: input?.limit, dieuKienPhamVi: await dieuKienDoiTuongTrongPhamVi(ctx, { may: parameterChangeLog.machineId }) }), // phạm vi người dùng (L6c 2026-10-25)
    ),

  // ── G4.21 material time-to-empty forecast (read-only) ─────────────────────────
  materialForecast: router({
    /** One (machine, component) forecast. */
    component: protectedProcedure
      .input(
        z.object({
          machineId: z.number().int().positive(),
          componentCode: z.string().min(1).max(120),
          windowHours: z.number().int().min(1).max(720).optional(),
        }),
      )
      .query(async ({ input, ctx }) => {
        await mayTrongPhamVi(ctx, input.machineId); // phạm vi người dùng (L6c 2026-10-25)
        return forecastTimeToEmpty(input);
      }),

    /** All components loaded on a machine, soonest to empty first. */
    machine: protectedProcedure
      .input(z.object({ machineId: z.number().int().positive(), windowHours: z.number().int().min(1).max(720).optional() }))
      .query(async ({ input, ctx }) => {
        await mayTrongPhamVi(ctx, input.machineId); // phạm vi người dùng (L6c 2026-10-25)
        return forecastMachineMaterials(input.machineId, input.windowHours ?? 24);
      }),
  }),
});
