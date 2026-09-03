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
import { router, moduleProcedure, adminProcedure, moduleGate } from "../_core/trpc";
import {
  executeDecision,
  type ToolExecContext,
  type ToolLang,
} from "../services/aiLocalTools";
// ★★★ doc 79 · TRỤC 2 — phân giải projectId (client gửi) → gốc, tra DANH SÁCH TRẮNG server-side.
// ★★★ QUẢN LÝ DỰ ÁN 2026-08-23 — phán quyết đăng ký/xoá + nạp lại ảnh chụp DB (xem khối dưới cùng).
import {
  phanGiaiGoc,
  danhSachDuAn,
  kiemTraDangKyDuAn,
  kiemTraXoaDuAn,
  napLaiDuAnTuDb,
  TRAN_DU_AN_DB,
} from "../services/aiLocalTools/repoProjects";
// ★★★ doc 79 · DANH SÁCH PHIÊN — tầng dữ liệu phạm vi CHỦ SỞ HỮU (xem khối ⚠ PHIÊN dưới cùng).
import { checkPermission } from "../_core/accessControl";
import {
  danhSachPhien as dbDanhSachPhien,
  moPhien as dbMoPhien,
  luuPhien as dbLuuPhien,
  xoaPhien as dbXoaPhien,
} from "../db/aiCodingSessions";
import { RE_ID_DU_AN, RE_ID_PHIEN, GIOI_HAN_PHIEN } from "@shared/aiCodingSession";
// ★★★ 2026-08-29 · ĐUÔI SỐNG — sổ RAM đầu-ra-đang-chạy (đã che per-chunk), khoá theo userId.
import { docLenhSong } from "../services/aiLocalTools/lenhSong";

// Cùng cổng giấy phép với aiCopilotRouter (MOD_AI, mặc định pass-through). Xác thực do middleware lo.
const protectedProcedure = moduleProcedure("MOD_AI");

const langSchema = z.enum(["vi", "en", "zh"]).default("vi");

/**
 * ★★★ doc 79 · TRỤC 2 — id dự án. **Client CHỈ gửi id**, KHÔNG BAO GIỜ đường dẫn; server tra danh
 * sách trắng. Ràng buộc hình dạng `[A-Za-z0-9_-]` ở đây là lớp mặt tiếp xúc; `gocTheoId` mới là cửa
 * phán quyết thật (id lạ ⇒ null ⇒ router TỪ CHỐI). VẮNG ⇒ dự án mặc định (đường cũ).
 */
const projectIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional();

/** ★ 2026-09-03 — ký tự có nghĩa trong regex, dùng cho phép thoát của `deXuatThayTheLo`. */
const KY_TU_REGEX: ReadonlySet<string> = new Set([".", "*", "+", "?", "^", "$", "{", "}", "(", ")", "|", "[", "]", "\\"]);

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

/**
 * ★★★ doc 79 · DANH SÁCH PHIÊN — **CỔNG CHUNG cho bốn tuyến phiên.** Hai việc, theo thứ tự:
 *   1. lấy `userId` từ **phiên đăng nhập** (`ctx.user.id`) — nguồn danh tính DUY NHẤT ở đây;
 *   2. hỏi `checkPermission` bit `ai_repo_read/canView` — **cùng bit** của ba read tool.
 *
 * ⚠ FAIL-CLOSED cả ba đường: danh tính méo ⇒ từ chối · `checkPermission` NÉM ⇒ từ chối · trả
 *   `false` ⇒ từ chối. RBAC hỏng không được biến thành cửa mở (cùng luật `readToolRbac.rbacGate`).
 */
async function congPhien(ctx: any): Promise<{ ok: true; userId: number } | { ok: false }> {
  const userId = Number(ctx?.user?.id);
  const role = String(ctx?.user?.role ?? "");
  if (!Number.isInteger(userId) || userId <= 0) return { ok: false };
  let cho = false;
  try {
    cho = await checkPermission(userId, role, "ai_repo_read", "canView");
  } catch {
    cho = false;
  }
  return cho ? { ok: true, userId } : { ok: false };
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
        /**
         * ★ 2026-08-31 · PDCA vòng 1 (T03/T10) — CHỈ MỤC PHẲNG cho Ctrl+P/@-mention. Đo trên UI
         * thật: chỉ mục cũ (tool `list_files` depth:3, trần 300 mục) vắng `client/src/lib/*` ⇒ gõ
         * tên tệp phổ biến KHÔNG mở được. `phang:true` đi nhánh `duyetTepDocDuoc` — ĐÚNG walker mà
         * `grep_repo` tin dùng (một nguồn luật cấm/đuôi, trần kép tệp+hạn-chót, không symlink) —
         * trả MỌI tệp đọc-được của cây làm chỉ mục. Thuần BỔ SUNG vào thủ tục ĐÃ CÓ (không thêm
         * thủ tục mới ⇒ `phamViDocCensus` không đổi — cùng khuôn `cauHinhVong` doc 81).
         * ⚠ RBAC fail-closed ngay dưới — nhánh này KHÔNG đi qua tool nên phải tự hỏi
         *   `checkPermission`, cùng bit `ai_repo_read/canView` với chính tool ấy.
         */
        phang: z.boolean().optional(),
        lang: langSchema.optional(),
        projectId: projectIdSchema,
      }),
    )
    .query(async ({ input, ctx }) => {
      if (input.phang === true) {
        const userId = Number((ctx as any).user?.id);
        const role = String((ctx as any).user?.role ?? "");
        let cho = false;
        try {
          cho = await checkPermission(userId, role, "ai_repo_read", "canView");
        } catch {
          cho = false;
        }
        if (!Number.isInteger(userId) || userId <= 0 || !cho) {
          return { ok: false, note: "PERMISSION_DENIED", summary: null, data: null };
        }
        const goc = phanGiaiGoc(input.projectId);
        if (!goc.ok) return { ok: false, note: "PROJECT_NOT_FOUND", summary: null, data: null };
        const { duyetTepDocDuoc, gocHopCat, TRAN_TEP_PHANG, HAN_CHOT_PHANG_MS } = await import(
          "../services/aiLocalTools/repoSandbox"
        );
        const kq = duyetTepDocDuoc(goc.goc ?? gocHopCat(), "", TRAN_TEP_PHANG, Date.now() + HAN_CHOT_PHANG_MS);
        return {
          ok: true,
          note: null,
          summary: null,
          data: {
            path: "",
            count: kq.tep.length,
            truncated: kq.hetGio || kq.hetTran,
            entries: kq.tep.map((p) => ({ path: p, kind: "file" as const, bytes: null })),
          },
        };
      }
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
    /**
     * ★ doc 81 · VIỆC 2 — thêm HAI ô cho **vòng lặp TOOL** (khác hẳn vòng TỰ ĐỘNG ở trên: vòng
     * tool CHỈ ĐỌC và chạy TRONG một lượt hỏi; vòng tự động chạy lệnh SAU một lượt người duyệt).
     * Client hiện "lượt n/N" bằng con số của SERVER, không tự đoán — nếu không, đổi
     * `AI_CODING_TOOL_LOOP_MAX_ROUNDS` sẽ làm nhãn nói dối mà không ai biết.
     * ⚠ Thuần BỔ SUNG vào một thủ tục ĐÃ CÓ (không thêm thủ tục mới ⇒ `phamViDocCensus` không đổi).
     */
    const { codingToolLoopEnabled, tranVongLapTrinh } = await import("../services/aiLocalTools");
    return {
      bat: vongTuDongBat(),
      tran: tranVongLap(),
      batTool: codingToolLoopEnabled(),
      tranTool: tranVongLapTrinh(),
    };
  }),

  /**
   * ★★★ 2026-08-31 · ĐỢT C (UX H2) — **SỬA TAY = MỘT ĐỀ XUẤT DIFF.** Người dùng gõ trực tiếp trong
   * Trình xem (chế độ sửa) rồi bấm "Tạo đề xuất"; tuyến này biến buffer thành MỘT lượt `apply_diff`
   * qua ĐÚNG `executeDecision` → `proposeAction` — tức trả về một thẻ duyệt HITL y hệt diff của
   * model. BA điều giữ cho tuyến này KHÔNG phải một đường ghi mới:
   *   • Nó CHỈ ĐỀ XUẤT: không nhánh nào gọi `confirmAction`/handler ghi — byte chỉ rời ra đĩa khi
   *     người bấm Duyệt ở thẻ (client vẫn đúng MỘT điểm gọi `confirmM.mutateAsync`).
   *   • RBAC + phán quyết đường/đuôi/hộp cát là của CHÍNH tool `apply_diff` (propose từ chối ⇒
   *     `denied` — tuyến chỉ chuyển tiếp, không nới một luật nào).
   *   • Chống TOCTOU giữ nguyên: `original` client gửi sẽ bị `execute()` đối chiếu băm với đĩa lúc
   *     Duyệt (`FILE_DIRTY`/`BASE_MISMATCH`) — buffer cũ thì lượt ghi TỪ CHỐI, không ghi đè mù.
   */
  /**
   * ★★★ 2026-09-03 · ĐỢT KẾ mục 5 — **THAY THẾ HÀNG LOẠT = MỘT ĐỀ XUẤT LÔ.** Người dùng tìm toàn
   * repo, gõ chuỗi thay, bấm "Thay tất cả": tuyến này đọc từng tệp TRONG hộp cát, tự tính bản
   * `modified`, rồi dựng MỘT lượt `apply_diff_batch` qua `executeDecision` → `proposeAction` ⇒ trả
   * về đúng thẻ duyệt LÔ đã có (mỗi tệp một tab diff, người bấm Duyệt mới ghi).
   *
   * BỐN ràng buộc giữ cho nó KHÔNG phải một đường ghi mới:
   *   • CHỈ ĐỀ XUẤT — không nhánh nào gọi `confirmAction`; trần 8 tệp/lô là của chính tool lô
   *     (`TRAN_TEP_MOI_LO`), tức trần "một người đọc nổi bao nhiêu diff", không phải trần token.
   *   • Server ĐỌC nội dung, client KHÔNG gửi byte nào của tệp — client chỉ gửi ĐƯỜNG + hai chuỗi.
   *   • ⚠ Nguồn đọc là `moTepTrongHopCat` (**ĐÃ che bí mật**, cùng cửa với `read_file`): ta KHÔNG
   *     mở một đường đọc-không-che thứ hai chỉ để tiện. Hệ quả phải khai: tệp chứa chuỗi TRÔNG
   *     GIỐNG bí mật sẽ có `original` mang chỗ che ⇒ băm lệch đĩa ⇒ `BASE_MISMATCH` lúc Duyệt
   *     (fail-closed, đúng chiều an toàn — xem docblock `applyDiff.ts`).
   *   • Regex do NGƯỜI gõ chỉ chạy khi bật cờ; mặc định `tim` bị thoát thành phép tìm NGUYÊN VĂN.
   */
  deXuatThayTheLo: protectedProcedure
    .input(
      z.object({
        tim: z.string().min(1).max(200),
        thay: z.string().max(200),
        regex: z.boolean().optional(),
        phanBietHoa: z.boolean().optional(),
        /** Đường TƯƠNG ĐỐI, do client lấy từ kết quả `grep` — server vẫn phán quyết lại từng đường. */
        duongDan: z.array(z.string().min(1).max(1024)).min(1).max(8),
        lang: langSchema.optional(),
        projectId: projectIdSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const userId = Number((ctx as any).user?.id);
      const role = String((ctx as any).user?.role ?? "");
      let cho = false;
      try {
        cho = await checkPermission(userId, role, "ai_repo_read", "canView");
      } catch {
        cho = false;
      }
      if (!Number.isInteger(userId) || userId <= 0 || !cho) {
        return { ok: false as const, note: "PERMISSION_DENIED", message: null, soTep: 0, pendingAction: null };
      }
      const goc = phanGiaiGoc(input.projectId);
      if (!goc.ok) return { ok: false as const, note: "PROJECT_NOT_FOUND", message: null, soTep: 0, pendingAction: null };

      const { moTepTrongHopCat } = await import("../services/aiLocalTools/repoSandbox");
      // Thoát ký tự đặc biệt bằng BẢNG TƯỜNG MINH (không dùng regex-literal: chuỗi thoát của nó
      // đọc sai một backslash là lặng lẽ đổi nghĩa char-class). `regex:true` ⇒ dùng nguyên văn.
      const co =
        input.regex === true
          ? input.tim
          : [...input.tim].map((c) => (KY_TU_REGEX.has(c) ? "\\" + c : c)).join("");
      let re: RegExp;
      try {
        re = new RegExp(co, input.phanBietHoa === true ? "g" : "gi");
      } catch {
        return { ok: false as const, note: "REGEX_INVALID", message: null, soTep: 0, pendingAction: null };
      }

      const files: Array<{ path: string; original: string; modified: string }> = [];
      for (const duong of input.duongDan) {
        const kq = moTepTrongHopCat(duong, { goc: goc.goc ?? undefined, khoaNganSach: `u:${userId}` });
        // ⚠ BỎ QUA thay vì giết cả lô: tệp bị hộp cát từ chối, hết ngân sách, **bị CẮT** (buffer
        //   thiếu đuôi ⇒ đề xuất sẽ xoá phần chưa nạp) hoặc **CÓ chỗ che bí mật** (băm chắc chắn
        //   lệch đĩa ⇒ BASE_MISMATCH lúc Duyệt). Mời người duyệt một thứ chắc chắn trượt là nói dối.
        if (!kq.ok || kq.catBot || kq.daChe) continue;
        re.lastIndex = 0;
        const moi = kq.noiDung.replace(re, input.thay);
        if (moi !== kq.noiDung) files.push({ path: kq.relPath, original: kq.noiDung, modified: moi });
      }
      if (files.length === 0) {
        return { ok: false as const, note: "NO_CHANGE", message: null, soTep: 0, pendingAction: null };
      }

      const outcome = await executeDecision(
        { tool: "apply_diff_batch", args: { files } },
        execCtxFrom(ctx, input.lang ?? "vi", goc.goc ?? undefined),
      );
      if (outcome.denied) {
        return { ok: false as const, note: "DENIED", message: outcome.denied.message, soTep: files.length, pendingAction: null };
      }
      if (outcome.error || !outcome.pendingAction) {
        return { ok: false as const, note: outcome.error ?? "NO_PENDING", message: null, soTep: files.length, pendingAction: null };
      }
      return { ok: true as const, note: null, message: null, soTep: files.length, pendingAction: outcome.pendingAction };
    }),

  deXuatSuaTay: protectedProcedure
    .input(
      z.object({
        path: z.string().min(1).max(1024),
        original: z.string().max(200_000),
        modified: z.string().max(200_000),
        lang: langSchema.optional(),
        projectId: projectIdSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const goc = phanGiaiGoc(input.projectId);
      if (!goc.ok) return { ok: false as const, note: "PROJECT_NOT_FOUND", message: null, pendingAction: null };
      const outcome = await executeDecision(
        { tool: "apply_diff", args: { path: input.path, original: input.original, modified: input.modified } },
        execCtxFrom(ctx, input.lang ?? "vi", goc.goc ?? undefined),
      );
      if (outcome.denied) return { ok: false as const, note: "DENIED", message: outcome.denied.message, pendingAction: null };
      if (outcome.error || !outcome.pendingAction) {
        return { ok: false as const, note: outcome.error ?? "NO_PENDING", message: null, pendingAction: null };
      }
      return { ok: true as const, note: null, message: null, pendingAction: outcome.pendingAction };
    }),

  /**
   * ★★★ 2026-08-29 · ĐUÔI SỐNG — đầu ra của lượt `run_command` ĐANG CHẠY của CHÍNH người hỏi,
   * cho panel Terminal poll (~800ms) xem realtime trong lúc `confirmAction` còn đang chặn.
   *
   * Ba ràng buộc giữ cho tuyến này KHÔNG phải một mặt tiếp xúc mới đúng nghĩa:
   *   • KHÔNG input — khoá duy nhất là `ctx.user.id` từ phiên đã xác thực. Client không gửi được
   *     actionId/userId nào ⇒ không có gì để giả; người A không có đường tới entry của người B.
   *   • CHỈ đọc sổ RAM (`lenhSong.ts`) — 0 truy vấn DB, 0 tệp, 0 tiến trình. Chữ trong sổ đã qua
   *     `StreamingSecretRedactor` TRƯỚC khi vào đuôi (xem docblock lenhSong.ts).
   *   • Đây là kênh HIỂN THỊ: kết quả chính thức của lệnh vẫn về theo đường `confirmAction` cũ.
   */
  dauRaSong: protectedProcedure.query(({ ctx }) => {
    const userId = Number((ctx as any).user?.id);
    if (!Number.isFinite(userId)) return null;
    return docLenhSong(userId);
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

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ doc 79 · DANH SÁCH PHIÊN — bốn thủ tục, một hàng rào
  // ════════════════════════════════════════════════════════════════════════════════════════════
  // ⚠⚠⚠ `userId` LUÔN là `ctx.user.id`. **KHÔNG một `input` nào ở đây có ô danh tính**, và đó là
  //   điều kiện để câu *"chỉ chủ phiên đọc được phiên"* đúng theo cấu tạo chứ không nhờ một lượt
  //   review nhớ dặn. Xem `server/db/aiCodingSessions.ts` (mọi WHERE mang `eq(userId)`) và
  //   `aiCodingSessionScope.test.ts` (đo trên CSDL THẬT, hai chiều, kèm đột biến).
  //
  // ⚠ RBAC: `moduleProcedure("MOD_AI")` chỉ chặn CHƯA ĐĂNG NHẬP. Bit thật là `ai_repo_read/canView`
  //   — **cùng bit** đang canh `read_file`/`list_files`/`grep_repo` (mig 0330). Phiên KHÔNG mở một
  //   quyền nào mới: nội dung nó chứa chính là thứ ba tool kia trả về.
  //
  // ⚠ Phiên chỉ mang **`projectId`** (`RE_ID_DU_AN`), và `phanGiaiGoc()` phán quyết id ấy có trong
  //   danh sách TRẮNG hay không — id lạ / một ĐƯỜNG DẪN ⇒ `PROJECT_NOT_FOUND`, fail-closed, y hệt
  //   ba tuyến đọc ở trên. Ràng buộc CHECK của mig 0333 là lớp cuối ở tầng CSDL.
  //
  // ⚠⚠ KHÔNG có thủ tục nào ở đây phát ra một `pending_action`, một `actionId`, một `token`, hay
  //   một trạng thái vòng tự động — theo cấu tạo: `moPhien` chiếu mọi lượt xuống `{role, content}`
  //   (`locLuot`). Nạp lại một phiên **không thể** tái phát một lượt GHI.

  /** Danh sách phiên của CHÍNH MÌNH trên một dự án (mới nhất trước). */
  danhSachPhien: protectedProcedure
    .input(z.object({ projectId: z.string().regex(RE_ID_DU_AN) }))
    .query(async ({ input, ctx }) => {
      const cong = await congPhien(ctx);
      if (!cong.ok) return { ok: false, note: "PERMISSION_DENIED", sessions: [] };
      if (!phanGiaiGoc(input.projectId).ok) {
        return { ok: false, note: "PROJECT_NOT_FOUND", sessions: [] };
      }
      return { ok: true, note: null, sessions: await dbDanhSachPhien(cong.userId, input.projectId) };
    }),

  /** Mở lại một phiên cũ — trả `{role, content}` và KHÔNG GÌ KHÁC. */
  moPhien: protectedProcedure
    .input(z.object({ sessionId: z.string().regex(RE_ID_PHIEN) }))
    .query(async ({ input, ctx }) => {
      const cong = await congPhien(ctx);
      if (!cong.ok) return { ok: false, note: "PERMISSION_DENIED", session: null };
      const p = await dbMoPhien(cong.userId, input.sessionId);
      // Không tồn tại và của-người-khác trả CÙNG mã: phân biệt hai ca ấy là một kênh đếm phiên
      // của người khác. Xem `moPhien` ở tầng dữ liệu.
      if (!p) return { ok: false, note: "NOT_FOUND", session: null };
      return { ok: true, note: null, session: p };
    }),

  /**
   * Lưu TOÀN BỘ mạch hội thoại (upsert). `sessionId` vắng ⇒ tạo mới; nhãn do **server** suy từ
   * câu hỏi đầu (`nhanTuLuot`) — client KHÔNG gửi nhãn, người dùng KHÔNG phải đặt tên.
   *
   * ⚠ `turns` khai `.strict()` ⇒ một lượt mang `actionId`/`token` bị zod **TỪ CHỐI CẢ LƯỢT GỌI**
   *   (không phải lọc im lặng): client gửi được hình dạng ấy nghĩa là có một lỗi lập trình cần
   *   thấy. Và kể cả nếu schema này trôi, `locLuot()` vẫn chiếu ở cả cửa ghi lẫn cửa đọc.
   */
  luuPhien: protectedProcedure
    .input(
      z.object({
        projectId: z.string().regex(RE_ID_DU_AN),
        sessionId: z.string().regex(RE_ID_PHIEN).nullish(),
        turns: z
          .array(
            z
              .object({
                role: z.enum(["user", "assistant"]),
                content: z.string().max(GIOI_HAN_PHIEN.BYTE_MOI_LUOT),
              })
              .strict(),
          )
          .max(GIOI_HAN_PHIEN.SO_LUOT),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const cong = await congPhien(ctx);
      if (!cong.ok) return { ok: false, note: "PERMISSION_DENIED", id: null, title: "", turnCount: 0 };
      if (!phanGiaiGoc(input.projectId).ok) {
        return { ok: false, note: "PROJECT_NOT_FOUND", id: null, title: "", turnCount: 0 };
      }
      const r = await dbLuuPhien(cong.userId, {
        projectId: input.projectId,
        sessionId: input.sessionId ?? null,
        turns: input.turns,
      });
      return { ...r, note: r.ok ? null : "SAVE_FAILED" };
    }),

  /** Xoá một phiên CỦA CHÍNH MÌNH. */
  xoaPhien: protectedProcedure
    .input(z.object({ sessionId: z.string().regex(RE_ID_PHIEN) }))
    .mutation(async ({ input, ctx }) => {
      const cong = await congPhien(ctx);
      if (!cong.ok) return { ok: false, note: "PERMISSION_DENIED" };
      const r = await dbXoaPhien(cong.userId, input.sessionId);
      return { ok: r.ok, note: r.ok ? null : "NOT_FOUND" };
    }),

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ QUẢN LÝ DỰ ÁN (2026-08-23) — bốn thủ tục ADMIN, và NGOẠI LỆ ĐƯỜNG DẪN được nói thành lời
  // ════════════════════════════════════════════════════════════════════════════════════════════
  // ⚠⚠⚠ ĐÚNG HAI thủ tục của cả bề mặt tRPC nhận một ĐƯỜNG DẪN, cả hai ở khối này và KHÔNG cái nào
  //   là đường thực thi tool: `themDuAn` (ĐĂNG KÝ một gốc — cửa duy nhất một đường dẫn thành mục
  //   danh sách trắng, qua `kiemTraDangKyDuAn` fail-closed: tuyệt đối · realpath tồn tại · là thư
  //   mục · không lồng gốc đã có · không node_modules/.git/dist · trần) và `duyetThuMuc` (CHỈ liệt
  //   kê TÊN thư mục con một cấp cho form — không ghi gì, không mở byte nào, không đổi danh sách
  //   trắng). Bất biến trục 2 ("client gửi ID, không gửi đường dẫn") nói về lượt THỰC THI: mọi tool
  //   vẫn chỉ nhận `projectId`, server tra id → gốc. Cả hai đều là lượt CẤU HÌNH/thăm dò của admin
  //   — cùng mức tin cậy với admin sửa tay `AI_REPO_SANDBOX_ROOTS` trong `.env`.
  //
  // ⚠⚠ SÀN `adminProcedure` (admin + 2FA bắt buộc) + `moduleGate("MOD_AI")` — đúng khuôn §4 của
  //   `congGiayPhepAiCensus`: file này thuộc bề mặt AI nên mọi thủ tục phải đứng sau cổng giấy
  //   phép. KHÔNG dùng `congPhien` (bit `ai_repo_read`): đăng ký một gốc MỚI là việc quản trị hạ
  //   tầng, không phải việc đọc mã — một engineer có `ai_repo_read` vẫn KHÔNG được thêm/xoá dự án.
  //
  // ⚠ Sau MỖI mutation: `napLaiDuAnTuDb()` — để `danhSachDuAn()` (sync, ảnh chụp) thấy ngay thay
  //   đổi trong TIẾN TRÌNH NÀY, không cần restart. Tiến trình CLI/MCP riêng nạp lúc nó khởi động
  //   (ngữ nghĩa ảnh chụp — khai ở docblock `repoProjects.ts`).
  //
  // ⚠ Audit: ngoài middleware audit chung của `adminProcedure`, mỗi mutation ghi thêm một dòng
  //   `logCrudOperation` CÓ chi tiết (id + gốc) — "ai đã mở gốc nào cho AI đọc" là câu một cuộc
  //   điều tra sẽ hỏi, và middleware chung cố ý không ghi input.

  /**
   * Danh sách ĐẦY ĐỦ cho màn quản lý của admin — kèm `nguon` (env|db) và `hoatDong`. Khác
   * `listProjects` (mọi người dùng, KHÔNG trả đường dẫn), thủ tục này trả cả `goc`: admin là người
   * đã/đang khai các gốc ấy (qua `.env` hoặc qua form này) — không có gì để giấu chính họ, và
   * không thấy gốc thì không quản được. Hàng DB có gốc đã biến mất trên đĩa (hoặc bị env che) vẫn
   * hiện với `hoatDong:false` — để admin còn XOÁ được nó (nếu lọc đi thì hàng ấy mồ côi vĩnh viễn).
   */
  danhSachDayDu: adminProcedure.use(moduleGate("MOD_AI")).query(async () => {
    const { danhSachDuAnDb } = await import("../db/aiRepoDuAn");
    const hopNhat = danhSachDuAn();
    const muc: Array<{ id: string; ten: string; goc: string; nguon: "env" | "db"; hoatDong: boolean }> = [];
    for (const d of hopNhat) {
      if (d.nguon === "env") muc.push({ id: d.id, ten: d.ten, goc: d.goc, nguon: "env", hoatDong: true });
    }
    const dangHoatDong = new Set(hopNhat.filter((d) => d.nguon === "db").map((d) => d.id));
    for (const r of await danhSachDuAnDb()) {
      muc.push({ id: r.id, ten: r.ten, goc: r.goc, nguon: "db", hoatDong: dangHoatDong.has(r.id) });
    }
    return { projects: muc, tranDb: TRAN_DU_AN_DB };
  }),

  /**
   * ★ BỘ DUYỆT THƯ MỤC MÁY CHỦ (2026-08-23) — cho nút "Chọn thư mục…" của form đăng ký, thay lượt
   * gõ tay đường dẫn (chủ dự án đã gõ sai thật). Cùng sàn `adminProcedure` + `moduleGate("MOD_AI")`
   * với `themDuAn` — admin (đã 2FA) tìm thư mục để đăng ký dự án, cùng mức tin cậy với việc admin
   * gõ đường dẫn tay hôm nay. Nó KHÔNG mở nội dung tệp (CHỈ tên thư mục con một cấp), và mọi đường
   * CHỌN xong vẫn đi qua `kiemTraDangKyDuAn` fail-closed lúc đăng ký — bộ duyệt không phải hàng
   * rào, hàng rào vẫn ở chỗ cũ. KHÔNG cache, KHÔNG ghi gì. Phán quyết + trần 500 mục/cấp ở
   * `services/aiLocalTools/duyetThuMuc.ts`; lưới qua tuyến thật ở `quanLyDuAnRepo.test.ts` §5.
   */
  duyetThuMuc: adminProcedure
    .use(moduleGate("MOD_AI"))
    .input(z.object({ duong: z.string().max(1024).optional() }))
    .query(async ({ input }) => {
      const { duyetThuMucServer } = await import("../services/aiLocalTools/duyetThuMuc");
      return duyetThuMucServer(input.duong);
    }),

  /** ĐĂNG KÝ một dự án mới (nguồn DB). `{ok:false, ma}` — mỗi mã một câu hướng dẫn ở client. */
  themDuAn: adminProcedure
    .use(moduleGate("MOD_AI"))
    .input(
      z.object({
        // Trần độ dài chỉ là lớp mặt tiếp xúc; `kiemTraDangKyDuAn` mới là cửa phán quyết (mỗi lỗi
        // một mã). KHÔNG regex ở đây: một id sai khuôn phải ra `ID_KHONG_HOP_LE` (câu hướng dẫn),
        // không phải một BAD_REQUEST chung chung của zod.
        id: z.string().max(200),
        ten: z.string().max(400),
        duongDan: z.string().max(1024),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const kq = kiemTraDangKyDuAn(input);
      if (!kq.ok) return { ok: false as const, ma: kq.ma };
      const { themDuAnDb } = await import("../db/aiRepoDuAn");
      const them = await themDuAnDb({ id: kq.id, ten: kq.ten, goc: kq.goc, nguoiTao: Number(ctx.user.id) });
      // Chèn hỏng sau khi phán quyết đã xanh = DB vắng hoặc một admin khác vừa chèn cùng id trong
      // cửa sổ giữa hai lượt (PK từ chối). Cả hai đều là "KHÔNG thêm được" — nói thật, không đoán.
      if (!them.ok) return { ok: false as const, ma: "LUU_THAT_BAI" as const };
      await napLaiDuAnTuDb();
      const { logCrudOperation } = await import("../services/auditTrailService");
      await logCrudOperation(
        {
          userId: Number(ctx.user.id),
          userName: (ctx.user as { name?: string | null }).name ?? null,
          ipAddress: (ctx.req as { ip?: string } | undefined)?.ip ?? null,
          source: "trpc",
        },
        {
          action: "create",
          entityType: "ai_repo_du_an",
          entityName: kq.id,
          details: { operation: "create", after: { id: kq.id, ten: kq.ten, goc: kq.goc } },
          status: "success",
        },
      );
      return { ok: true as const, ma: null };
    }),

  /** XOÁ một dự án nguồn DB. Mục env ⇒ từ chối (env chỉ sửa được bằng tay, đúng thiết kế). */
  xoaDuAn: adminProcedure
    .use(moduleGate("MOD_AI"))
    .input(z.object({ id: z.string().max(200) }))
    .mutation(async ({ input, ctx }) => {
      const kq = kiemTraXoaDuAn(input.id);
      if (!kq.ok) return { ok: false as const, ma: kq.ma };
      const { xoaDuAnDb } = await import("../db/aiRepoDuAn");
      const xoa = await xoaDuAnDb(kq.id);
      if (!xoa.ok) return { ok: false as const, ma: "KHONG_TIM_THAY" as const };
      await napLaiDuAnTuDb();
      const { logCrudOperation } = await import("../services/auditTrailService");
      await logCrudOperation(
        {
          userId: Number(ctx.user.id),
          userName: (ctx.user as { name?: string | null }).name ?? null,
          ipAddress: (ctx.req as { ip?: string } | undefined)?.ip ?? null,
          source: "trpc",
        },
        {
          action: "delete",
          entityType: "ai_repo_du_an",
          entityName: kq.id,
          details: { operation: "delete", before: { id: kq.id } },
          status: "success",
        },
      );
      return { ok: true as const, ma: null };
    }),
});
