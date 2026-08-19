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
 * ⚠ BA TOOL ĐIỀU HƯỚNG Ở ĐÂY ĐỀU LÀ **READ** ⇒ KHÔNG có HITL (đọc không cần người duyệt).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ ĐÍNH CHÍNH KHỐI NÀY (doc 79 · VÒNG TỰ ĐỘNG) — TRƯỚC ĐÂY NÓ VIẾT *"File này KHÔNG import một
 * cửa ghi nào"*. NAY KHÔNG CÒN ĐÚNG, và lời khai phải theo mã chứ không ngược lại.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `chayKiemChung` (dưới cùng) chạy **một lệnh KIỂM CHỨNG** không cần người bấm — đó là bước "CHẠY
 * test" của vòng tự động. Bốn điều KHÔNG đổi, và cả bốn đo được ở `aiCodingVerify.test.ts`:
 *   • **`apply_diff` vẫn phải qua NGƯỜI.** Tuyến này không nhận tên tool; nó viết thẳng
 *     `run_command`. Không có đường nào từ đây tới một lượt ghi mã nguồn.
 *   • **Tập lệnh HẸP HƠN danh sách trắng** (`NHAN_KIEM_CHUNG`): `dotnet format` — mục DUY NHẤT
 *     trong danh sách trắng có ghi đè tệp — **bị loại**.
 *   • **Cùng đường HITL**: `executeDecision` → `proposeAction` → `confirmAction`, cùng RBAC hai
 *     lần, cùng audit. Chỉ khác ở chỗ không có ngón tay người — và audit ghi rõ điều đó
 *     (`confirmedBy: "autonomy"`).
 *   • **Trần lượt kiểm ở SERVER**, không chỉ ở client.
 *
 * `apply_diff` vẫn KHÔNG được lộ ở đây — nó đi qua đường chat → `proposeAction` → thẻ duyệt →
 * `confirmAction` (aiCopilotRouter) như pha C đã dựng.
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
// ★★★ doc 79 · TRỤC 2 — phân giải projectId (client gửi) → gốc, tra DANH SÁCH TRẮNG server-side.
import { phanGiaiGoc } from "../services/aiLocalTools/repoProjects";

// Cùng cổng giấy phép với aiCopilotRouter (MOD_AI, mặc định pass-through). Xác thực do middleware lo.
const protectedProcedure = moduleProcedure("MOD_AI");

const langSchema = z.enum(["vi", "en", "zh"]).default("vi");

/**
 * ★★★ doc 79 · TRỤC 2 — id dự án. **Client CHỈ gửi id**, KHÔNG BAO GIỜ đường dẫn; server tra danh
 * sách trắng. Ràng buộc hình dạng `[A-Za-z0-9_-]` ở đây là lớp mặt tiếp xúc; `gocTheoId` mới là cửa
 * phán quyết thật (id lạ ⇒ null ⇒ router TỪ CHỐI). VẮNG ⇒ dự án mặc định (đường cũ).
 */
const projectIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional();

/**
 * Dựng `ToolExecContext` từ ctx tRPC — danh tính là ctx.user (server tự đọc, KHÔNG tin client).
 * `projectRoot` (nếu có) đã được phân giải server-side từ một projectId trong danh sách trắng.
 */
function execCtxFrom(ctx: any, lang: ToolLang, projectRoot?: string): ToolExecContext {
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
    ...(projectRoot ? { projectRoot } : {}),
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
  projectId?: string,
): Promise<RepoToolReply<T>> {
  // ★★★ doc 79 · TRỤC 2 — phân giải id → gốc TRƯỚC khi chạy tool. id lạ ⇒ TỪ CHỐI (fail-closed),
  //   KHÔNG âm thầm đọc gốc mặc định. Client gửi ĐƯỜNG DẪN thay vì id ⇒ cũng rơi vào đây (id không
  //   có trong danh sách trắng ⇒ PROJECT_NOT_FOUND) — không mở được gốc tuỳ ý.
  const goc = phanGiaiGoc(projectId);
  if (!goc.ok) {
    return { ok: false, note: "PROJECT_NOT_FOUND", summary: null, data: null };
  }
  const outcome = await executeDecision({ tool, args }, execCtxFrom(ctx, lang, goc.goc ?? undefined));
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
        projectId: projectIdSchema,
      }),
    )
    .query(async ({ input, ctx }) => {
      return runReadTool<ListFilesData>(
        "list_files",
        { path: input.path, depth: input.depth },
        ctx,
        input.lang ?? "vi",
        input.projectId,
      );
    }),

  /** Đọc nội dung một tệp trong hộp cát repo (trình xem tệp). */
  readFile: protectedProcedure
    .input(
      z.object({
        path: z.string().min(1).max(1024),
        maxBytes: z.number().int().min(256).max(2_000_000).optional(),
        lang: langSchema.optional(),
        projectId: projectIdSchema,
      }),
    )
    .query(async ({ input, ctx }) => {
      return runReadTool<ReadFileData>(
        "read_file",
        { path: input.path, maxBytes: input.maxBytes },
        ctx,
        input.lang ?? "vi",
        input.projectId,
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
        projectId: projectIdSchema,
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
        input.projectId,
      );
    }),

  /**
   * ★★★ doc 79 · TRỤC 2 — DANH SÁCH DỰ ÁN cho bộ chọn ở đầu cây tệp. Trả **id + tên** (KHÔNG trả
   * đường dẫn gốc tuyệt đối ra client — client chỉ cần id để chọn; đường là bí mật server). Tra danh
   * sách TRẮNG `AI_REPO_SANDBOX_ROOTS`; vắng ⇒ một dự án mặc định.
   */
  listProjects: protectedProcedure.query(async () => {
    const { danhSachDuAn, duAnMacDinh } = await import("../services/aiLocalTools/repoProjects");
    return {
      projects: danhSachDuAn().map((d) => ({ id: d.id, name: d.ten })),
      defaultId: duAnMacDinh().id,
    };
  }),

  /**
   * ★★★ doc 79 · VÒNG TỰ ĐỘNG — cấu hình cho bộ điều khiển vòng ở client.
   *
   * Client PHẢI hỏi server chứ không đoán: cờ và trần nằm ở `.env` của máy chủ, và một client tự
   * giả định "vòng đang bật" sẽ hiện "lượt 1/3" cho một hệ đã tắt vòng — tức nói dối người dùng.
   */
  cauHinhVong: protectedProcedure.query(async () => {
    const { vongTuDongBat, tranVongLap } = await import("../services/aiCodingVerify");
    return { bat: vongTuDongBat(), tran: tranVongLap() };
  }),

  /**
   * ★★★ doc 79 · VÒNG TỰ ĐỘNG — **CHẠY MỘT LƯỢT KIỂM CHỨNG** (bước "chạy test", không cần người bấm).
   *
   * ⚠⚠ Đây là mặt tiếp xúc DUY NHẤT cho phép vòng tự động sinh một tiến trình. Mọi phán quyết ở
   * `services/aiCodingVerify.ts` — tuyến này chỉ dựng danh tính phiên (server tự đọc, KHÔNG tin
   * client) rồi chuyển tiếp. Xem khối ⚠⚠⚠ ở đầu file cho bốn ràng buộc.
   */
  chayKiemChung: protectedProcedure
    .input(
      z.object({
        projectId: projectIdSchema,
        /** Lệnh đề nghị. Server phán quyết LẠI qua ba lớp — client không tự chọn được lệnh nào. */
        command: z.string().min(1).max(300).optional(),
        /** Lượt thứ mấy (1-based). Server kẹp theo trần của nó, không theo con số client gửi. */
        luot: z.number().int().min(1).max(50),
        /** Câu hỏi gốc — chỉ dùng để nhận ra lệnh người dùng NÊU ĐÍCH DANH. */
        cauHoi: z.string().max(2000).optional(),
        lang: langSchema.optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { chayKiemChung } = await import("../services/aiCodingVerify");
      const lang = input.lang ?? "vi";
      const execCtx = execCtxFrom(ctx, lang);
      return chayKiemChung(
        { projectId: input.projectId, command: input.command, luot: input.luot, cauHoi: input.cauHoi },
        execCtx,
        { id: execCtx.user.id, role: execCtx.user.role, name: execCtx.user.name ?? null },
        lang,
      );
    }),
});
