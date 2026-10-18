/**
 * ★★★ Đợt 3c (2026-10-17) — tRPC MỎNG cho bảng "Chạy & Xem trước" của không gian lập trình AI.
 *
 * Mọi chính sách ở `services/ai/chayUngDung/dichVu.ts` (lưới `dichVu.test.ts`); tuyến này chỉ dựng danh tính PHIÊN
 * (`ctx.user` — KHÔNG tin client) rồi chuyển tiếp. Sàn `moduleProcedure("MOD_AI")` như `repoWorkspaceRouter`.
 *
 *   trangThai  (query)    — ai_repo_read/canView; trạng thái + lệnh chạy suy được + lệnh cài gợi ý + xem trước bật?
 *   nhatKy     (query)    — chủ/admin.
 *   chay       (mutation) — ai_repo_exec/canCreate; lệnh CHỈ từ khai báo dự án (không tham số lệnh).
 *   dung       (mutation) — chủ/admin.
 *   deXuatLenh (mutation) — đưa MỘT lệnh danh sách trắng (gõ ở Terminal / nút "Cài phụ thuộc") vào ĐÚNG đường HITL
 *                           của `run_command`: `executeDecision` → `proposeAction` ⇒ `pendingAction` cho thẻ duyệt;
 *                           chạy chỉ khi người bấm Xác nhận (`aiCopilot.confirmAction`). KHÔNG đi vòng qua model
 *                           (khảo sát đo 30–120 s/lệnh) và KHÔNG mở đường chạy thẳng: phán quyết danh sách trắng
 *                           chạy ở preview + execute như mọi lệnh khác.
 */
import { z } from "zod";
import { router, moduleProcedure } from "../_core/trpc";
import { checkPermission } from "../_core/accessControl";
import { executeDecision, type ToolExecContext } from "../services/aiLocalTools";
import { phanGiaiGoc } from "../services/aiLocalTools/repoProjects";
import { gocHopCat } from "../services/aiLocalTools/repoSandbox";
import { docCauHinhXemTruoc, quanLyUngDung } from "../services/ai/chayUngDung";
import {
  chayUngDungChoNguoi,
  dungUngDungChoNguoi,
  nhatKyChoNguoi,
  trangThaiChoNguoi,
  type PhuThuocDichVu,
} from "../services/ai/chayUngDung/dichVu";
import { langSchema } from "./repoWorkspaceRouter";

const protectedProcedure = moduleProcedure("MOD_AI");
const projectIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

function deps(): PhuThuocDichVu {
  return {
    coQuyen: (u, r, m, a) => checkPermission(u, r, m, a as never),
    phanGiaiGoc,
    gocRepoChinh: gocHopCat,
    ql: quanLyUngDung,
    cauHinhXemTruoc: () => {
      const c = docCauHinhXemTruoc();
      return { bat: c.bat, lyDoTat: c.lyDoTat };
    },
  };
}

function nguoi(ctx: any) {
  return { id: Number(ctx?.user?.id), role: String(ctx?.user?.role ?? "") };
}

export const aiChayUngDungRouter = router({
  trangThai: protectedProcedure
    .input(z.object({ projectId: projectIdSchema }))
    .query(({ input, ctx }) => trangThaiChoNguoi({ user: nguoi(ctx), projectId: input.projectId }, deps())),

  nhatKy: protectedProcedure
    .input(z.object({ projectId: projectIdSchema }))
    .query(({ input, ctx }) => nhatKyChoNguoi({ user: nguoi(ctx), projectId: input.projectId }, deps())),

  chay: protectedProcedure
    .input(z.object({ projectId: projectIdSchema }))
    .mutation(({ input, ctx }) => chayUngDungChoNguoi({ user: nguoi(ctx), projectId: input.projectId }, deps())),

  dung: protectedProcedure
    .input(z.object({ projectId: projectIdSchema }))
    .mutation(({ input, ctx }) => dungUngDungChoNguoi({ user: nguoi(ctx), projectId: input.projectId }, deps())),

  deXuatLenh: protectedProcedure
    .input(z.object({ projectId: projectIdSchema.optional(), command: z.string().min(1).max(300), lang: langSchema.optional() }))
    .mutation(async ({ input, ctx }) => {
      // Dự án cá nhân chỉ phân giải cho CHỦ/admin (repoProjects, Đợt 3a) — cùng cổng các thủ tục repoWorkspace.
      const goc = phanGiaiGoc(input.projectId, nguoi(ctx));
      if (!goc.ok) return { ok: false as const, note: "PROJECT_NOT_FOUND", message: null, pendingAction: null };
      const execCtx: ToolExecContext = {
        user: { id: Number((ctx as any).user?.id), role: String((ctx as any).user?.role ?? ""), name: (ctx as any).user?.name ?? null },
        lang: input.lang ?? "vi",
        req: { ip: (ctx as any).req?.ip, headers: (ctx as any).req?.headers, socket: (ctx as any).req?.socket },
        ...(goc.goc ? { projectRoot: goc.goc } : {}),
      };
      const outcome = await executeDecision({ tool: "run_command", args: { command: input.command } }, execCtx);
      if (outcome.denied) return { ok: false as const, note: "DENIED", message: outcome.denied.message, pendingAction: null };
      if (outcome.error || !outcome.pendingAction) {
        return { ok: false as const, note: outcome.error ?? "NO_PENDING", message: null, pendingAction: null };
      }
      return { ok: true as const, note: null, message: null, pendingAction: outcome.pendingAction };
    }),
});
