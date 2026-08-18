/**
 * ★★★ doc 78 · PHA D — tRPC MỎNG cho KHÔNG GIAN LÀM VIỆC LẬP TRÌNH (điều hướng repo).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO CÓ FILE NÀY — VÀ VÌ SAO NÓ CHỈ LÀ MỘT LỚP MỎNG
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Pha A đăng ký ba READ tool (`list_files`/`read_file`/`grep_repo`) vào `toolRegistry`, nhưng
 * chúng chỉ tới được người dùng qua ĐƯỜNG CHAT (bộ phân loại ý định / vòng lặp tool). Cây tệp và
 * trình xem tệp của không gian làm việc cần ĐIỀU HƯỚNG TRỰC TIẾP — bấm một thư mục, mở một tệp —
 * nên cần một cổng tRPC gọi thẳng ba tool ấy. Đây đúng là ngoại lệ mà brief pha D cho phép: *"một
 * tRPC procedure mỏng để client gọi 5 tool ... đi qua đúng đường HITL đã có, KHÔNG mở đường tắt"*.
 *
 * ⚠ BA TOOL Ở ĐÂY ĐỀU LÀ **READ** ⇒ KHÔNG có HITL (đọc không cần người duyệt). Hai tool GHI/CHẠY
 *   (`apply_diff`/`run_command`) KHÔNG được lộ ở đây — chúng vẫn đi qua đường chat →
 *   `proposeAction`/`confirmAction` (aiCopilotRouter) như pha B/C đã dựng. File này KHÔNG import
 *   một cửa ghi nào.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ RBAC KHÔNG NẰM Ở ĐÂY — NÓ NẰM TRONG CHÍNH TOOL
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `moduleProcedure("MOD_AI")` chỉ chặn CHƯA ĐĂNG NHẬP + cổng giấy phép (mặc định TẮT). Cưỡng chế
 * `ai_repo_read/canView` THẬT nằm trong `readToolRbac.rbacGate` mà mỗi tool tự gọi: `executeDecision`
 * tiêm danh tính PHIÊN (`argsWithAuthCtx` → `__authCtx = {userId, role}` của người dùng THẬT, KHÔNG
 * tin từ client) rồi tool hỏi `checkPermission`. Tài khoản KHÔNG có `ai_repo_read` sẽ nhận một
 * `ToolResult` mang `note: "PERMISSION_DENIED"` + dữ liệu RỖNG — server chặn, không phải client.
 * ⇒ Client ẩn nút chỉ là phép LỊCH SỰ; đây mới là hàng rào.
 */
import { z } from "zod";
import { router, moduleProcedure } from "../_core/trpc";
import {
  executeDecision,
  type ToolExecContext,
  type ToolLang,
} from "../services/aiLocalTools";

// Cùng cổng giấy phép với aiCopilotRouter (MOD_AI, mặc định pass-through). Xác thực do middleware lo.
const protectedProcedure = moduleProcedure("MOD_AI");

const langSchema = z.enum(["vi", "en", "zh"]).default("vi");

/** Dựng `ToolExecContext` từ ctx tRPC — danh tính là ctx.user (server tự đọc, KHÔNG tin client). */
function execCtxFrom(ctx: any, lang: ToolLang): ToolExecContext {
  return {
    user: {
      id: Number(ctx.user?.id),
      role: String(ctx.user?.role ?? ""),
      name: ctx.user?.name ?? null,
    },
    lang,
    req: {
      ip: (ctx.req as any)?.ip,
      headers: (ctx.req as any)?.headers,
      socket: (ctx.req as any)?.socket,
    },
  };
}

/** Hình dạng trả về CHUNG: `ok=false` kèm `note` khi bị từ chối/hỏng (đủ để client nói thật). */
interface RepoToolReply<T> {
  ok: boolean;
  /** Mã máy-đọc-được của một phán quyết (PERMISSION_DENIED / DENIED_SECRET / NOT_FOUND …) hoặc null. */
  note: string | null;
  /** Tóm tắt người-đọc-được (đã che bí mật ở tầng tool). */
  summary: string | null;
  data: T | null;
}

/** Chạy một READ tool qua đúng `executeDecision` (nơi tiêm `__authCtx` + cưỡng chế RBAC). */
async function runReadTool<T>(
  tool: "list_files" | "read_file" | "grep_repo",
  args: Record<string, unknown>,
  ctx: any,
  lang: ToolLang,
): Promise<RepoToolReply<T>> {
  const outcome = await executeDecision({ tool, args }, execCtxFrom(ctx, lang));
  if (outcome.error) return { ok: false, note: outcome.error, summary: null, data: null };
  const r = outcome.result;
  if (!r) return { ok: false, note: "NO_RESULT", summary: null, data: null };
  // Read tool có `note` ⇔ một phán quyết (từ chối/không tìm thấy/lỗi đọc). Không note ⇔ thành công.
  return {
    ok: !r.note,
    note: (r.note as string) ?? null,
    summary: r.textSummary ?? null,
    data: (r.data as T) ?? null,
  };
}

// ── Kiểu dữ liệu mirror của ba tool (chỉ để client có kiểu; giá trị đến từ server) ──
export interface ListEntry {
  path: string;
  kind: string;
  bytes: number | null;
}
export interface ListFilesData {
  path: string | null;
  count: number;
  truncated: boolean;
  entries: ListEntry[];
}
export interface ReadFileData {
  path: string | null;
  bytes: number | null;
  truncated: boolean;
  redacted: boolean;
  content: string | null;
}
export interface GrepMatch {
  path: string;
  line: number;
  text: string;
}
export interface GrepData {
  pattern: string | null;
  scanned: number;
  count: number;
  truncated: boolean;
  timedOut: boolean;
  matches: GrepMatch[];
}

export const repoWorkspaceRouter = router({
  /** Liệt kê thư mục trong hộp cát repo (điều hướng cây tệp). */
  listFiles: protectedProcedure
    .input(
      z.object({
        path: z.string().max(1024).optional(),
        depth: z.number().int().min(1).max(3).optional(),
        lang: langSchema.optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return runReadTool<ListFilesData>(
        "list_files",
        { path: input.path, depth: input.depth },
        ctx,
        input.lang ?? "vi",
      );
    }),

  /** Đọc nội dung một tệp trong hộp cát repo (trình xem tệp). */
  readFile: protectedProcedure
    .input(
      z.object({
        path: z.string().min(1).max(1024),
        maxBytes: z.number().int().min(256).max(2_000_000).optional(),
        lang: langSchema.optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return runReadTool<ReadFileData>(
        "read_file",
        { path: input.path, maxBytes: input.maxBytes },
        ctx,
        input.lang ?? "vi",
      );
    }),

  /** Tìm một mẫu regex trong cây mã nguồn (grep). */
  grep: protectedProcedure
    .input(
      z.object({
        pattern: z.string().min(1).max(200),
        path: z.string().max(1024).optional(),
        ignoreCase: z.boolean().optional(),
        maxResults: z.number().int().min(1).max(200).optional(),
        lang: langSchema.optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return runReadTool<GrepData>(
        "grep_repo",
        {
          pattern: input.pattern,
          path: input.path,
          ignoreCase: input.ignoreCase,
          maxResults: input.maxResults,
        },
        ctx,
        input.lang ?? "vi",
      );
    }),
});
