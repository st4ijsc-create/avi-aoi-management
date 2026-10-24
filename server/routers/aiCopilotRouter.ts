/**
 * AI Copilot Router (GĐ2) — HITL confirm/cancel/get for write-actions.
 *
 * The propose phase happens inside the KB ask/stream flow (server-side). These
 * protected procedures handle the user's explicit decision on a proposed action.
 * The session user (ctx.user) is the source of truth for ownership + RBAC re-check.
 */

import { z } from "zod";
import { router, moduleProcedure } from "../_core/trpc";
// Doc 37 P0-3 — gate the AI Copilot surface behind the MOD_AI license
// (flag LICENSE_MODULE_GATE_ENABLED, default OFF → pass-through).
const protectedProcedure = moduleProcedure("MOD_AI");
import {
  confirmAction,
  cancelAction,
  getAction,
  proposeAction,
  batDauApDungOClient,
  chotApDungOClient,
  type ConfirmResult,
  type CopilotUser,
} from "../services/aiCopilotActions";
import { appError } from "../_core/appError";
import { loiTotpKhoa } from "../_core/totpKhoaSai";
import type { ToolLang } from "../services/aiLocalTools";
import { getTool, isWriteTool } from "../services/aiLocalTools/toolRegistry";
import { RCA_SUGGESTED_ACTION_TOOLS, ensureRcaToolsRegistered } from "../services/ai/rcaActionSuggester";

const langSchema = z.enum(["vi", "en", "zh"]).default("vi");
// 64 hex ⇔ sha256. Đợt C · Task 5 — `batDauApDungOClient`/`chotApDungOClient` chỉ nhận BĂM, không
// bao giờ nhận nội dung tệp. Đợt 4B-server: lược đồ dời sang module lá dùng chung với cửa REST Bearer
// (`POST /api/ai/client-apply/*`) — MỘT chủ, hai cửa không trôi khỏi nhau.
import { batDauApDungOClientSchema, chotApDungOClientSchema } from "./aiCopilotApOClientSchema";

function toCopilotUser(user: { id: number; role: string; name?: string | null }): CopilotUser {
  return { id: user.id, role: String(user.role), name: user.name ?? null };
}

/**
 * SCADA R1a T10 — từ chối sàn vai / xác thực theo mức của tool ghi OT ⇒ appError, CÙNG mã + khoá i18n + params `{ma, level}` với
 * `scadaCommands` (T8/T9 `loiTuChoiLenh`), để client hiện một câu và một ô nhập TOTP cho cả hai đường. Kết quả khác ⇒ `null`
 * (trả nguyên như cũ).
 */
function loiXacThucTheoMuc(kq: ConfirmResult) {
  if (kq.ok || kq.level === undefined) return null;
  const ma = kq.reason;
  const level = kq.level;
  const chiTiet = kq.message ?? "";
  switch (ma) {
    case "ROLE_FLOOR":
      return appError("FORBIDDEN", "SCADA_ROLE_FLOOR", { ma, level }, chiTiet);
    case "TOTP_CHUA_DANG_KY":
      return appError("PRECONDITION_FAILED", "SCADA_TOTP_NOT_ENROLLED", { ma, level }, chiTiet);
    case "TOTP_CAN":
      return appError("PRECONDITION_FAILED", "SCADA_TOTP_REQUIRED", { ma, level }, chiTiet);
    case "TOTP_SAI":
      return appError("PRECONDITION_FAILED", "SCADA_TOTP_INVALID", { ma, level }, chiTiet);
    // R1a T16 — bộ đếm TOTP sai: CÙNG mã + câu i18n với scadaCommands / đăng nhập (phút còn lại, không số lần sai).
    case "TOTP_TAM_KHOA":
      return loiTotpKhoa({ ma: "TOTP_TAM_KHOA", conLaiMs: kq.conLaiMs }, { ma, level }); // thiếu ⇒ phutConLai dự phòng THOI_GIAN_KHOA_MS
    case "TOTP_KHONG_KIEM_DUOC":
      return loiTotpKhoa({ ma: "TOTP_KHONG_KIEM_DUOC" }, { ma, level });
    default:
      return null;
  }
}

export const aiCopilotRouter = router({
  confirmAction: protectedProcedure
    /**
     * ★★★ ĐỢT 3 (2026-08-23) — `selectedHunkIds`: CHỈ SỐ các khối `apply_diff` người duyệt CHỌN GHI
     * (0-based theo `keHoachKhoiDuyet`). **CHỈ LÀ SỐ** — client không bao giờ gửi byte nội dung;
     * server dựng lại kế hoạch khối từ `argsJson` ĐÃ CHỐT trong CSDL rồi tự chiếu
     * (`aiCopilotActions.confirmAction`). Vắng ⇒ áp TẤT CẢ (đường cũ, từng byte — CLI/MCP/client cũ
     * không đổi gì). Lưới census soi đúng schema này: thêm một ô mang nội dung (`modified`/
     * `original`/`content`) vào đây là mở lại đúng lỗ mà HITL sinh ra để đóng ⇒ ĐỎ.
     * ⚠ Trần 1000 phần tử: kế hoạch khối bị `DEFAULT_MAX_DIFF_LINES=1500` chặn trên nên không một
     *   tệp hợp lệ nào có nổi 1000 khối — mảng dài hơn chỉ có thể là client hỏng/độc hại.
     */
    .input(z.object({
      actionId: z.string().min(1),
      token: z.string().min(1),
      lang: langSchema.optional(),
      selectedHunkIds: z.array(z.number().int().min(0)).max(1000).optional(),
      /**
       * SCADA R1a T10 — mã TOTP cho tool GHI OT ở kênh mức 4|5 (`kiemXacThucTheoMuc`). Tool không ghi OT bỏ qua (không đòi, không
       * tiêu). Danh tính, phiên, trạng thái 2FA lấy từ `ctx`, KHÔNG BAO GIỜ từ input.
       */
      totpCode: z.string().length(6).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const user = toCopilotUser(ctx.user as any);
      const lang: ToolLang = input.lang ?? "vi";
      const kq = await confirmAction(input.actionId, input.token, user, lang, {
        ip: (ctx.req as any)?.ip,
        headers: (ctx.req as any)?.headers,
        socket: (ctx.req as any)?.socket,
      }, {}, undefined, input.selectedHunkIds, {
        totpCode: input.totpCode,
        sessionToken: ctx.sessionToken ?? null,
        twoFactorEnabled: (ctx.user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled ?? false,
        ...(ctx.__luotXacMinhTotp ? { __luotXacMinhTotp: ctx.__luotXacMinhTotp } : {}),
      });
      const loi = loiXacThucTheoMuc(kq);
      if (loi) throw loi;
      return kq;
    }),

  cancelAction: protectedProcedure
    .input(z.object({ actionId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const user = toCopilotUser(ctx.user as any);
      return cancelAction(input.actionId, user, {
        ip: (ctx.req as any)?.ip,
        headers: (ctx.req as any)?.headers,
        socket: (ctx.req as any)?.socket,
      });
    }),

  getAction: protectedProcedure
    .input(z.object({ actionId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const user = toCopilotUser(ctx.user as any);
      const row = await getAction(input.actionId, user);
      if (!row) return null;
      return {
        actionId: row.id,
        tool: row.tool,
        summary: row.summary,
        status: row.status,
        preview: row.previewJson ?? null,
        expiresAt: row.expiresAt.toISOString(),
        executedAt: row.executedAt ? row.executedAt.toISOString() : null,
        result: row.resultJson ?? null,
      };
    }),

  // doc69 Wave2 A3 — propose a SUGGESTED action surfaced on an RCA insight / report
  // response (server/services/ai/rcaActionSuggester.ts). The client only ever sends
  // {tool, args} that came from OUR OWN suggestedActions payload, but this endpoint
  // NEVER trusts that blindly: `tool` is restricted to the small allow-list the
  // mapper is permitted to suggest, and `args` is RE-VALIDATED against the tool's
  // OWN zod schema (safeParse) before proposeAction ever sees it — defense in depth,
  // mirrors aiThresholdAdvisorRouter.applyNgThreshold. Routes 100% through the
  // EXISTING proposeAction (dry-run preview, RBAC gate #1); the client then confirms
  // via the EXISTING confirmAction above (RBAC gate #2). NOT a new write/execute path.
  proposeSuggestedAction: protectedProcedure
    .input(z.object({
      tool: z.enum(RCA_SUGGESTED_ACTION_TOOLS),
      args: z.record(z.string(), z.unknown()),
      lang: langSchema.optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const user = toCopilotUser(ctx.user as any);
      const lang: ToolLang = input.lang ?? "vi";

      await ensureRcaToolsRegistered();
      const tool = getTool(input.tool);
      if (!tool || !isWriteTool(tool)) {
        return { ok: false as const, reason: "TOOL_UNAVAILABLE", message: "Công cụ không khả dụng." };
      }

      const parsed = (tool.parameters as z.ZodType<any>).safeParse(input.args);
      if (!parsed.success) {
        return { ok: false as const, reason: "ARGS_OUT_OF_BOUNDS", message: "Tham số không hợp lệ." };
      }

      const res = await proposeAction(tool, parsed.data as Record<string, unknown>, { user, lang });
      if (!res.ok || !res.pendingAction) {
        return { ok: false as const, reason: res.reason ?? "PROPOSE_FAILED", message: res.message };
      }
      return { ok: true as const, pendingAction: res.pendingAction };
    }),

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ ĐỢT C · TASK 5 (2026-08-29, spec §6.5) — KIỂM TOÁN LƯỢT ÁP Ở CLIENT (chế độ LOCAL)
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // Chế độ LOCAL: byte rơi trên đĩa máy lập trình viên do EXTENSION VS Code ghi, ngoài tầm với của
  // máy chủ này — máy chủ CHỈ giữ sổ kiểm toán những gì extension TỰ KHAI. Xem docblock đầy đủ ở
  // `server/services/aiCopilotActions.ts` (`batDauApDungOClient`/`chotApDungOClient`).
  batDauApDungOClient: protectedProcedure
    .input(batDauApDungOClientSchema)
    .mutation(async ({ input, ctx }) => {
      const user = toCopilotUser(ctx.user as any);
      return batDauApDungOClient(input, user, {
        ip: (ctx.req as any)?.ip,
        headers: (ctx.req as any)?.headers,
        socket: (ctx.req as any)?.socket,
      });
    }),

  chotApDungOClient: protectedProcedure
    .input(chotApDungOClientSchema)
    .mutation(async ({ input, ctx }) => {
      const user = toCopilotUser(ctx.user as any);
      return chotApDungOClient(input, user, {
        ip: (ctx.req as any)?.ip,
        headers: (ctx.req as any)?.headers,
        socket: (ctx.req as any)?.socket,
      });
    }),
});
