/**
 * ★★★ Đợt 11.8 · T7 — router PHIÊN HỢP NHẤT (coding + agent; web · VS Code · CLI) — hợp đồng D5 đã CHỐT (kế hoạch §8 + 6 sửa của dieu-phoi).
 *
 * • Cổng nền = `moduleProcedure("MOD_AI")` (cùng cổng giấy phép của `aiChatRouter`); phần coding/agent đòi THÊM `ai_repo_read/canView`
 *   (cùng bit của ba read tool và `repoWorkspace.*Phien`), phần chat chỉ cần MOD_AI + chủ sở hữu.
 * • `userId` CHỈ từ `ctx.user.id`. Dự án là ID danh sách trắng (`phanGiaiGoc`, dự án cá nhân theo danh tính người gọi).
 * • CHAT KHÔNG có kho thứ hai: `danhSach(kind:"chat"|"all")` chỉ CHIẾU ĐỌC `ai_chat_conversations` (id `chat:<n>`); `mo/themLuot/nhanBan/nopTomTat/
 *   doiTen/xoa` với id `chat:*` ⇒ NOT_FOUND (client dùng `aiChat.*`). `all` mà thiếu `ai_repo_read` ⇒ chỉ trả phần chat, không lỗi.
 * • Không thủ tục nào nhận/phát `pending_action`, `actionId`, `token`: `turns` chỉ user|assistant (zod `.strict()` + `locLuot` hai cửa).
 *   Vai `assistant` do client khai: khi nạp lại làm ngữ cảnh model coi như lịch sử client (không nâng tin cậy).
 * • Thân dữ liệu: `server/db/aiPhien.ts` (mọi hàm `userId` bắt buộc đầu tiên).
 */
import { z } from "zod";
import { router, moduleProcedure } from "../_core/trpc";
import { checkPermission } from "../_core/accessControl";
import { phanGiaiGoc, type NguoiGoiDuAn } from "../services/aiLocalTools/repoProjects";
import { GIOI_HAN_PHIEN, KIND_PHIEN, NGUON_PHIEN } from "@shared/aiCodingSession";
import * as kho from "../db/aiPhien";

const base = moduleProcedure("MOD_AI");
const RE_ID_DU_AN = /^[A-Za-z0-9_-]{1,64}$/;
const idPhien = z.string().min(1).max(80);
const laIdChat = (id: string) => id.startsWith("chat:");

function nguoiGoi(ctx: any): NguoiGoiDuAn | null {
  const id = Number(ctx?.user?.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  return { id, role: String(ctx?.user?.role ?? "") };
}

/** `ai_repo_read/canView` — FAIL-CLOSED (danh tính méo / RBAC ném / false ⇒ không). */
async function coQuyenDoc(ctx: any): Promise<boolean> {
  const u = nguoiGoi(ctx);
  if (!u) return false;
  try {
    return await checkPermission(u.id, u.role, "ai_repo_read", "canView");
  } catch {
    return false;
  }
}

const turnSchema = z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(GIOI_HAN_PHIEN.BYTE_MOI_LUOT) }).strict();

export const aiPhienRouter = router({
  danhSach: base
    .input(
      z.object({
        projectId: z.string().regex(RE_ID_DU_AN),
        kind: z.enum(["chat", "coding", "agent", "all"]).default("all"),
        gioiHan: z.number().int().min(1).max(GIOI_HAN_PHIEN.SO_PHIEN_LIET_KE).optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const u = nguoiGoi(ctx);
      if (!u) return { ok: false, note: "PERMISSION_DENIED", sessions: [] };
      const sessions: Awaited<ReturnType<typeof kho.danhSach>> = [];
      // phần chat: chỉ MOD_AI + chủ (cổng nền đã kiểm MOD_AI); phép chiếu CHỈ ĐỌC
      if (input.kind === "chat" || input.kind === "all") sessions.push(...(await kho.danhSachChat(u.id, input.gioiHan)));
      if (input.kind !== "chat") {
        const doc = await coQuyenDoc(ctx);
        if (!doc) {
          // "all" thiếu ai_repo_read ⇒ chỉ phần chat, không lỗi; coding/agent tường minh ⇒ từ chối
          if (input.kind !== "all") return { ok: false, note: "PERMISSION_DENIED", sessions: [] };
        } else if (!phanGiaiGoc(input.projectId, u).ok) {
          if (input.kind !== "all") return { ok: false, note: "PROJECT_NOT_FOUND", sessions: [] };
        } else {
          sessions.push(...(await kho.danhSach(u.id, { projectId: input.projectId, kind: input.kind === "all" ? "all" : input.kind, gioiHan: input.gioiHan })));
        }
      }
      sessions.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
      return { ok: true, note: null, sessions };
    }),

  mo: base.input(z.object({ sessionId: idPhien })).query(async ({ input, ctx }) => {
    const u = nguoiGoi(ctx);
    if (!u || !(await coQuyenDoc(ctx))) return { ok: false, note: "PERMISSION_DENIED", session: null };
    if (laIdChat(input.sessionId)) return { ok: false, note: "NOT_FOUND", session: null };
    const r = await kho.mo(u.id, input.sessionId);
    return r.ok ? { ok: true, note: null, session: r.phien } : { ok: false, note: r.ma, session: null };
  }),

  tao: base
    .input(
      z.object({
        projectId: z.string().regex(RE_ID_DU_AN),
        kind: z.enum(KIND_PHIEN),
        source: z.enum(NGUON_PHIEN),
        title: z.string().max(200).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const u = nguoiGoi(ctx);
      if (!u || !(await coQuyenDoc(ctx))) return { ok: false, note: "PERMISSION_DENIED", id: null, version: 0 };
      if (!phanGiaiGoc(input.projectId, u).ok) return { ok: false, note: "PROJECT_NOT_FOUND", id: null, version: 0 };
      const r = await kho.tao(u.id, input);
      return r.ok ? { ok: true, note: null, id: r.id, version: r.version } : { ok: false, note: r.ma, id: null, version: 0 };
    }),

  themLuot: base
    .input(
      z.object({
        sessionId: idPhien,
        expectedVersion: z.number().int().min(1),
        luot: z.array(turnSchema).min(1).max(kho.TRAN_LUOT_MOI_LAN_GHI),
        contextPct: z.number().int().min(0).max(200).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const u = nguoiGoi(ctx);
      if (!u || !(await coQuyenDoc(ctx))) return { ok: false, note: "PERMISSION_DENIED" };
      if (laIdChat(input.sessionId)) return { ok: false, note: "NOT_FOUND" };
      const r = await kho.themLuot(u.id, input);
      return r.ok
        ? { ok: true, note: null, version: r.version, turnCount: r.turnCount }
        : { ok: false, note: r.ma, ...(r.versionHienTai !== undefined ? { versionHienTai: r.versionHienTai } : {}) };
    }),

  doiTen: base
    .input(z.object({ sessionId: idPhien, title: z.string().max(200), expectedVersion: z.number().int().min(1).optional() }))
    .mutation(async ({ input, ctx }) => {
      const u = nguoiGoi(ctx);
      if (!u || !(await coQuyenDoc(ctx))) return { ok: false, note: "PERMISSION_DENIED", title: "" };
      if (laIdChat(input.sessionId)) return { ok: false, note: "NOT_FOUND", title: "" };
      const r = await kho.doiTen(u.id, input);
      return r.ok ? { ok: true, note: null, title: r.title } : { ok: false, note: r.ma, title: "", ...(r.versionHienTai !== undefined ? { versionHienTai: r.versionHienTai } : {}) };
    }),

  nhanBan: base.input(z.object({ sessionId: idPhien })).mutation(async ({ input, ctx }) => {
    const u = nguoiGoi(ctx);
    if (!u || !(await coQuyenDoc(ctx))) return { ok: false, note: "PERMISSION_DENIED", id: null };
    if (laIdChat(input.sessionId)) return { ok: false, note: "NOT_FOUND", id: null };
    const r = await kho.nhanBan(u.id, input.sessionId);
    return r.ok ? { ok: true, note: null, id: r.id } : { ok: false, note: r.ma, id: null };
  }),

  xoa: base.input(z.object({ sessionId: idPhien })).mutation(async ({ input, ctx }) => {
    const u = nguoiGoi(ctx);
    if (!u || !(await coQuyenDoc(ctx))) return { ok: false, note: "PERMISSION_DENIED" };
    if (laIdChat(input.sessionId)) return { ok: false, note: "NOT_FOUND" };
    const r = await kho.xoa(u.id, input.sessionId);
    return { ok: r.ok, note: r.ok ? null : r.ma };
  }),

  nopTomTat: base
    .input(z.object({ sessionId: idPhien, expectedVersion: z.number().int().min(1), tomTat: z.string().min(1).max(kho.TRAN_KY_TU_TOM_TAT_PHIEN) }))
    .mutation(async ({ input, ctx }) => {
      const u = nguoiGoi(ctx);
      if (!u || !(await coQuyenDoc(ctx))) return { ok: false, note: "PERMISSION_DENIED", id: null };
      if (laIdChat(input.sessionId)) return { ok: false, note: "NOT_FOUND", id: null };
      const r = await kho.nopTomTat(u.id, input);
      return r.ok ? { ok: true, note: null, id: r.id } : { ok: false, note: r.ma, id: null, ...(r.versionHienTai !== undefined ? { versionHienTai: r.versionHienTai } : {}) };
    }),
});
