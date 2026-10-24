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
import { sql } from "drizzle-orm";
import { appError } from "../_core/appError";
import { router, protectedProcedure, roleProcedure, operatorProcedure } from "../_core/trpc";
import { idsTrongPhamVi } from "../db/hierarchy";
import { phamViCua } from "./_phamViNguoiXem";
import { sopExecutions } from "../../drizzle/schema";
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

/**
 * phạm vi người dùng (L3 2026-10-25) — QUYẾT CỦA CHỦ DỰ ÁN (dieu-phoi chuyển 2026-10-25): SOP gắn TRẠM ⇒ theo phạm vi trạm; SOP KHÔNG gắn trạm là tài liệu DÙNG CHUNG ⇒ ai có quyền cũng ĐỌC, nhưng soạn/sửa/xoá/đổi trạng thái
 * CHỈ người phạm vi toàn quyền. Lượt thực thi (sop_executions) thấy được ⇔ trạm của lượt ∈ phạm vi, hoặc (không trạm) dây chuyền ∈ phạm vi, hoặc (không cả hai) CHÍNH người vận hành.
 * Ngoài phạm vi ≡ không tồn tại (cùng dạng trả về với id không tồn tại).
 */
interface PhamViSop { tram: number[]; dong: number[] }
async function phamViSop(ctx: unknown): Promise<PhamViSop | null> {
  const pv = phamViCua(ctx as never);
  const [tram, dong] = await Promise.all([idsTrongPhamVi("station", pv, { strict: true }), idsTrongPhamVi("line", pv, { strict: true })]);
  if (tram === null && dong === null) return null;
  return { tram: tram ?? [], dong: dong ?? [] };
}
const sopThay = (p: PhamViSop | null, s: { stationId: number | null }): boolean => p === null || s.stationId == null || p.tram.includes(s.stationId);
const sopGhi = (p: PhamViSop | null, s: { stationId: number | null }): boolean => p === null || (s.stationId != null && p.tram.includes(s.stationId));
const tuChoiDungChung = () =>
  appError("FORBIDDEN", "PERMISSION_DENIED", { action: "authorSharedSop" }, "SOP không gắn trạm là tài liệu dùng chung — chỉ người có phạm vi toàn quyền được soạn/sửa/xoá.");
/** ghi lên SOP đã có: "khong" = ngoài phạm vi (≡ không tồn tại) · ném FORBIDDEN khi là SOP dùng chung mà người gọi hẹp. */
async function quyenGhiSop(ctx: unknown, sopId: number): Promise<"ok" | "khong"> {
  const p = await phamViSop(ctx);
  if (p === null) return "ok";
  const s = await getSop(sopId);
  if (!s) return "ok"; // không tồn tại thật ⇒ để dịch vụ trả đúng như cũ
  if (s.stationId == null) throw tuChoiDungChung();
  return sopGhi(p, s) ? "ok" : "khong";
}
const thucThiThay = (p: PhamViSop | null, userId: number, e: { stationId: number | null; lineId: number | null; operatorId: number | null }): boolean =>
  p === null
    ? true
    : e.stationId != null
      ? p.tram.includes(e.stationId)
      : e.lineId != null
        ? p.dong.includes(e.lineId)
        : e.operatorId === userId;
const khongCoSop = () => appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "sop" }, "SOP not found");

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
    .query(async ({ input, ctx }) => {
      const p = await phamViSop(ctx);
      return listSops({ ...(input ?? {}), tramTrongPhamVi: p === null ? null : p.tram }); // phạm vi người dùng (L3 2026-10-25)
    }),

  get: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const s = await getSop(input.id);
      return s && sopThay(await phamViSop(ctx), s) ? s : null; // phạm vi người dùng (L3 2026-10-25): SOP gắn trạm ngoài phạm vi ≡ không tồn tại
    }),

  /** Chọn SOP đang hiệu lực theo ngữ cảnh sản phẩm/trạm (dùng cho SopViewer). */
  resolveActive: protectedProcedure
    .input(
      z.object({
        productModelId: z.number().int().positive().nullable().optional(),
        stationId: z.number().int().positive().nullable().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const p = await phamViSop(ctx);
      return resolveActiveSop({ ...input, tramTrongPhamVi: p === null ? null : p.tram }); // phạm vi người dùng (L3 2026-10-25)
    }),

  executions: protectedProcedure
    .input(z.object({ sopId: z.number().int().positive(), limit: z.number().int().min(1).max(200).optional() }))
    .query(async ({ input, ctx }) => {
      const p = await phamViSop(ctx);
      const s = await getSop(input.sopId);
      if (p !== null && s && !sopThay(p, s)) return []; // phạm vi người dùng (L3 2026-10-25)
      const cong = p === null ? undefined : sql`(CASE WHEN ${sopExecutions.stationId} IS NOT NULL THEN ${sopExecutions.stationId} IN (${sql.join((p.tram.length ? p.tram : [-1]).map((x) => sql`${x}`), sql`, `)})
        WHEN ${sopExecutions.lineId} IS NOT NULL THEN ${sopExecutions.lineId} IN (${sql.join((p.dong.length ? p.dong : [-1]).map((x) => sql`${x}`), sql`, `)})
        ELSE ${sopExecutions.operatorId} = ${ctx.user.id} END)`;
      return listExecutions(input.sopId, input.limit ?? 50, cong);
    }),

  execution: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const e = await getExecution(input.id);
      return e && thucThiThay(await phamViSop(ctx), ctx.user.id, e) ? e : null; // phạm vi người dùng (L3 2026-10-25)
    }),

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
    .mutation(async ({ input, ctx }) => {
      // phạm vi người dùng (L3 2026-10-25): trạm đích phải thuộc phạm vi; SOP không gắn trạm (dùng chung) chỉ phạm vi toàn quyền được tạo
      const p = await phamViSop(ctx);
      if (p !== null) {
        if (input.stationId == null) throw tuChoiDungChung();
        if (!p.tram.includes(input.stationId)) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "station" }, "Station not found");
      }
      return createSop({ ...input, createdBy: ctx.user.id });
    }),

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
    .mutation(async ({ input, ctx }) => {
      if ((await quyenGhiSop(ctx, input.id)) === "khong") return null; // phạm vi người dùng (L3 2026-10-25)
      const p = await phamViSop(ctx);
      if (p !== null && input.stationId !== undefined && (input.stationId === null ? true : !p.tram.includes(input.stationId))) {
        throw input.stationId === null ? tuChoiDungChung() : appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "station" }, "Station not found");
      }
      return updateSop(input);
    }),

  replaceSteps: authorProcedure
    .input(z.object({ sopId: z.number().int().positive(), steps: z.array(stepInput).max(200) }))
    .mutation(async ({ input, ctx }) => {
      if ((await quyenGhiSop(ctx, input.sopId)) === "khong") throw khongCoSop(); // phạm vi người dùng (L3 2026-10-25)
      return replaceSteps(input.sopId, input.steps);
    }),

  setStatus: authorProcedure
    .input(z.object({ id: z.number().int().positive(), status: z.enum(["draft", "active", "retired"]) }))
    .mutation(async ({ input, ctx }) => {
      if ((await quyenGhiSop(ctx, input.id)) === "khong") return null; // phạm vi người dùng (L3 2026-10-25)
      return setSopStatus(input.id, input.status);
    }),

  cloneNewVersion: authorProcedure
    .input(z.object({ sopId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      if ((await quyenGhiSop(ctx, input.sopId)) === "khong") return null; // phạm vi người dùng (L3 2026-10-25)
      return cloneAsNewVersion(input.sopId, ctx.user.id);
    }),

  delete: authorProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      if ((await quyenGhiSop(ctx, input.id)) === "khong") return { ok: false, code: "NOT_FOUND" }; // phạm vi người dùng (L3 2026-10-25)
      return deleteSop(input.id);
    }),

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
    .mutation(async ({ input, ctx }) => {
      // phạm vi người dùng (L3 2026-10-25): SOP phải thấy được; trạm/dây chuyền khai báo phải thuộc phạm vi
      const p = await phamViSop(ctx);
      if (p !== null) {
        const s = await getSop(input.sopId);
        if (s && !sopThay(p, s)) throw khongCoSop();
        if (input.stationId != null && !p.tram.includes(input.stationId)) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "station" }, "Station not found");
        if (input.lineId != null && !p.dong.includes(input.lineId)) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "line" }, "Line not found");
      }
      return startExecution({ ...input, operatorId: ctx.user.id });
    }),

  confirmStep: operatorProcedure
    .input(
      z.object({
        executionId: z.number().int().positive(),
        stepNo: z.number().int().min(1),
        input: z.string().max(255).nullable().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const e = await getExecution(input.executionId);
      if (e && !thucThiThay(await phamViSop(ctx), ctx.user.id, e)) return { ok: false, code: "NOT_FOUND" as const }; // phạm vi người dùng (L3 2026-10-25)
      return confirmStep(input.executionId, input.stepNo, input.input, ctx.user.id);
    }),

  finishExecution: operatorProcedure
    .input(z.object({ executionId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const e = await getExecution(input.executionId);
      if (e && !thucThiThay(await phamViSop(ctx), ctx.user.id, e)) return { ok: false, code: "NOT_FOUND" as const }; // phạm vi người dùng (L3 2026-10-25)
      return finishExecution(input.executionId);
    }),

  abandonExecution: operatorProcedure
    .input(z.object({ executionId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const e = await getExecution(input.executionId);
      if (e && !thucThiThay(await phamViSop(ctx), ctx.user.id, e)) return null; // phạm vi người dùng (L3 2026-10-25)
      return abandonExecution(input.executionId);
    }),
});
