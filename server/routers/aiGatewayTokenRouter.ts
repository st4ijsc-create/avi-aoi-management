/**
 * ★★★ Đợt 4A (2026-10-17) — router `aiGatewayToken`: token THEO NGƯỜI DÙNG cho cổng tương thích OpenAI `/v1`
 * (quyết định Q2-A — extension VSCode chạy lõi agent và gọi `/v1` thay mặt người đã đăng nhập).
 *
 *   danhSach()                         — token CỦA MÌNH (tiền tố, tên, phạm vi, hạn, trạng thái; KHÔNG băm/bản rõ)
 *   tao({ten, phamVi?, soNgay?})       — trả token RÕ ĐÚNG MỘT LẦN (phiên web bắt buộc), audit
 *   thuHoi({id})                       — thu hồi token CỦA MÌNH, audit
 *   xemThietBi({maNguoiDung})          — device flow: xem tên thiết bị + phạm vi xin trước khi duyệt
 *   quyetThietBi({maNguoiDung, dongY}) — device flow: duyệt/từ chối (phiên web bắt buộc), audit
 *
 * Quyền, phiên web, audit: xem docblock `server/services/ai/gatewayToken/thuTucToken.ts` (thân thủ tục ở đó).
 * ★ Cổng giấy phép MOD_AI (`moduleProcedure`) — cùng chiều với mọi router `ai*` (`congGiayPhepAiCensus.test.ts` §4).
 */
import { z } from "zod";
import { router, moduleProcedure } from "../_core/trpc";
import { PHAM_VI, SO_NGAY_TOI_DA } from "../services/ai/gatewayToken/maToken";

const thuTucAi = moduleProcedure("MOD_AI");
const thuTuc = () => import("../services/ai/gatewayToken/thuTucToken");

const nguoi = (u: unknown) => {
  const x = u as { id: number; role: string; name?: string | null };
  return { id: x.id, role: String(x.role), name: x.name ?? null };
};
const reqMeta = (ctx: { req?: { ip?: string; headers?: Record<string, unknown>; socket?: { remoteAddress?: string } } }) => ({
  ip: ctx.req?.ip,
  headers: ctx.req?.headers,
  socket: ctx.req?.socket,
});
const maNguoiDungSchema = z.string().trim().min(8).max(12);

export const aiGatewayTokenRouter = router({
  danhSach: thuTucAi.query(async ({ ctx }) => (await thuTuc()).thuTucDanhSach(nguoi(ctx.user))),

  tao: thuTucAi
    .input(
      z.object({
        ten: z.string().trim().min(1).max(100),
        phamVi: z.array(z.enum(PHAM_VI)).min(1).max(PHAM_VI.length).optional(),
        soNgay: z.number().int().min(1).max(SO_NGAY_TOI_DA).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => (await thuTuc()).thuTucTao(nguoi(ctx.user), ctx.sessionToken, input, reqMeta(ctx))),

  thuHoi: thuTucAi
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => (await thuTuc()).thuTucThuHoi(nguoi(ctx.user), input.id, reqMeta(ctx))),

  xemThietBi: thuTucAi
    .input(z.object({ maNguoiDung: maNguoiDungSchema }))
    .query(async ({ input, ctx }) => (await thuTuc()).thuTucXemThietBi(nguoi(ctx.user), input.maNguoiDung)),

  quyetThietBi: thuTucAi
    .input(z.object({ maNguoiDung: maNguoiDungSchema, dongY: z.boolean() }))
    .mutation(async ({ input, ctx }) =>
      (await thuTuc()).thuTucQuyetThietBi(nguoi(ctx.user), ctx.sessionToken, input, reqMeta(ctx)),
    ),
});
