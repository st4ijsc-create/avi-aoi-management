/**
 * ★★★ doc 78 · PHA A — **BA READ TOOL CHO PHÉP LLM TỰ CHỌN TỆP ĐỂ ĐỌC.**
 *
 *   1. `read_file`  — đọc MỘT tệp trong hộp cát repo
 *   2. `list_files` — liệt kê thư mục (có độ sâu)
 *   3. `grep_repo`  — tìm một mẫu trong cây mã nguồn
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * TOÀN BỘ CHÍNH SÁCH AN TOÀN NẰM Ở `repoSandbox.ts` — FILE NÀY CHỈ LÀ **BỀ MẶT**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Không một phép kiểm đường dẫn nào được viết ở đây. Ba tool đều gọi `moTepTrongHopCat()` /
 * `lietKeTrongHopCat()` / `duyetTepDocDuoc()`, và những hàm ấy gọi tiếp cửa đĩa DUY NHẤT của cả
 * nhóm tool (`confineTargetUnder` + `readConfined` ở `readToolsProgramming.ts`). File này **không
 * nhập `node:fs`**, và `programmingFileIo.census.test.ts` cưỡng chế điều đó bằng AST.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ RBAC — `ai_repo_read/canView`, một BIT RIÊNG, và đây là lý do
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Chủ dự án chốt (doc 78 §7.3): *"ghim theo vai `engineer`/`admin`"*. Hệ RBAC của repo này ghim
 * theo **MODULE**, không theo vai, nên câu hỏi thật là *"module nào có đúng tập vai ấy?"*
 * ĐO ĐƯỢC trên `DEFAULT_ROLE_PERMISSIONS` (`server/routers/permissionsRouter.ts`): trong 20 module
 * mà `engineer` giữ, **đúng HAI** cái không ai khác giữ — `settings_factory` và
 * `settings_measurement_points`.
 *
 * ⇒ Mượn một trong hai là **neo theo TẬP VAI, không theo NGHĨA**, và hỏng theo hai đường:
 *   (a) câu từ chối sẽ nói *"bạn không có quyền settings_factory/canView"* cho một người vừa xin
 *       đọc một file `.ts` — một lời khai **SAI SỰ THẬT** về lý do, đúng thứ mà cả
 *       `readToolRbac.cauTuChoi` lẫn `_uyQuyenAnh.MA_KHONG_PHAN_GIAI` tồn tại để chống;
 *   (b) ngày nào ai đó cấp `settings_factory` cho `supervisor` — một quyết định hoàn toàn hợp lý
 *       về **cấu hình nhà máy** — thì quyền **đọc mã nguồn nền tảng** mở ra theo, trong im lặng.
 *
 * ⇒ Đi theo tiền lệ `VRAM_CONTROL_MODULE` (Pha 5 Task 3b): **một `moduleName` mới**. `moduleName`
 * là `varchar(100)` tự do nên bit mới = **một HÀNG**, không DDL; `category` dùng lại `settings` đã
 * có trong pgEnum nên cũng không đụng enum. Seed: `admin` + `engineer`
 * (`0330_grant_ai_repo_read_engineer.sql` backfill cho tài khoản đã tồn tại;
 * `DEFAULT_ROLE_PERMISSIONS` cấp cho tài khoản mới).
 *
 * ⚠ **`admin` KHÔNG cần hàng nào**: `accessControl.checkPermission` short-circuit `true` cho
 *   `role === "admin"` khi chưa bật `scopedAdmin`. Hàng seed cho admin là để bảng quyền của giao
 *   diện không thiếu mục, không phải để cổng chạy.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ NGÔN NGỮ: **tiếng Việt thuần, KHÔNG khai ô `lang`** — cố ý, đúng khuôn 19 tool của
 *   `readToolRbac.ts`. Xem khối "NGÔN NGỮ" ở đó: câu từ chối dùng chung (`cauTuChoi`) là tiếng
 *   Việt, nên khai `lang` ở đây sẽ tạo một nhánh đa ngữ **không bao giờ chạy được** trên đường từ
 *   chối. Muốn đa ngữ thì phải đa ngữ hoá `cauTuChoi` TRƯỚC.
 */
import { z } from "zod";
import { authCtxParam, authCtxSchema, rbacGate } from "./readToolRbac";
import {
  HAN_GIO_GREP_MS,
  MA_TU_CHOI_HOP_CAT,
  TRAN_BYTE_MOI_PHIEN,
  TRAN_BYTE_MOI_TEP,
  TRAN_DO_SAU,
  TRAN_KET_QUA_GREP,
  TRAN_MUC_LIET_KE,
  TRAN_TEP_QUET,
  duyetTepDocDuoc,
  gocHopCat,
  lietKeTrongHopCat,
  moTepTrongHopCat,
  nganSachConLai,
  tieuNganSach,
  type MaTuChoiHopCat,
} from "./repoSandbox";
import { registerTool, type Tool, type ToolPermission, type ToolResult } from "./toolRegistry";

/** Không thêm thành viên nào vào `ToolResultType` — dùng lại `action_result` như nhóm lập trình. */
const KIEU = "action_result" as const;

/** ★ MỘT nguồn cho cả lời khai lẫn phép cưỡng chế — xem `readToolRbac.rbacGate`. */
const QUYEN: ToolPermission = { module: "ai_repo_read", action: "canView" };

/** Khoá sổ ngân sách byte = danh tính PHIÊN. Model không đổi được nó (`argsWithAuthCtx`). */
function khoaNganSach(raw: unknown): string | undefined {
  const p = authCtxSchema.safeParse(raw);
  return p.success ? `u:${p.data.userId}` : undefined;
}

/**
 * ★★★ doc 79 · TRỤC 2 — GỐC dự án đang chọn, đọc từ `__projectRoot` (server tự tiêm qua
 * `argsWithAuthCtx` từ `execCtx.projectRoot`; client KHÔNG BAO GIỜ đặt được — nó bị XOÁ ở đó rồi gán
 * lại từ phiên). VẮNG ⇒ `gocHopCat()` (dự án mặc định — đường cũ, tương thích ngược). Đây là chỗ
 * DUY NHẤT ba read tool biến id-đã-phân-giải thành gốc; mọi lời gọi hộp cát dưới truyền `goc` này.
 */
function gocTuArgs(raw: Record<string, unknown>): string {
  const g = raw.__projectRoot;
  return typeof g === "string" && g !== "" ? g : gocHopCat();
}

/** Ô dành riêng do server tiêm (`argsWithAuthCtx`). `.strict()` ⇒ phải KHAI để phép tiêm chạy. */
const projectRootParam = z.string().optional();

/**
 * ★ Mã `note` cho một phán quyết của hộp cát — **mỗi mã viết THẲNG bằng hằng chữ**, có chủ ý.
 *
 * ⚠ `toolNoteCensus.test.ts` §1 quét mã nguồn tìm `note:` + hằng chữ VIẾT HOA và bắt mọi mã chưa
 * có phán quyết trong bảng kê; §2 bắt mọi mục trong bảng kê **không còn** ai sinh ra. Nếu ở đây
 * viết `note: BANG[ma]` thì §1 mù (không thấy mã nào) và §2 ĐỎ (bảng kê thành hoá thạch). Viết
 * hằng chữ là cách duy nhất để cả hai vế của lưới ấy nói cùng một sự thật.
 */
function ketQuaTuChoiHopCat<T>(title: string, rong: T, ma: MaTuChoiHopCat, chiTiet: string): ToolResult<T> {
  switch (ma) {
    case "DENIED_SECRET":
      return { type: KIEU, title, data: rong, note: "DENIED_SECRET", textSummary: `Tệp "${chiTiet}" nằm trong danh sách CẤM ĐỌC của hộp cát (tệp bí mật: .env*, khoá riêng, chứng thư). Đây là thiết kế, không phải sự cố — không có đường vòng nào, kể cả cho quản trị viên.` };
    case "DENIED_DIR":
      return { type: KIEU, title, data: rong, note: "DENIED_DIR", textSummary: `Đường dẫn "${chiTiet}" nằm trong một thư mục bị hộp cát loại trừ (node_modules, .git, dist, build, uploads, coverage, knowledge/embeddings…). Hãy hỏi ở cây mã nguồn: server/, client/, shared/, drizzle/, scripts/.` };
    case "DENIED_EXT":
      return { type: KIEU, title, data: rong, note: "DENIED_EXT", textSummary: `Phần mở rộng ${chiTiet} không nằm trong danh sách TRẮNG của hộp cát. Hộp cát chỉ mở cho tệp mã nguồn/cấu hình dạng văn bản; mọi đuôi khác bị từ chối theo mặc định (danh sách TRẮNG, không phải danh sách đen).` };
    case "BUDGET_EXCEEDED":
      return { type: KIEU, title, data: rong, note: "BUDGET_EXCEEDED", textSummary: `Phiên này đã rút hết ngân sách byte của hộp cát (${chiTiet} byte, trần ${TRAN_BYTE_MOI_PHIEN}). Đây là một cái TRẦN, không phải một sự cố: hãy thu hẹp câu hỏi hoặc chờ cửa sổ ngân sách đặt lại.` };
    case "NOT_FOUND":
      return { type: KIEU, title, data: rong, note: "NOT_FOUND", textSummary: `Không có tệp/thư mục "${chiTiet}" trong hộp cát repo.` };
    case "NOT_A_FILE":
      return { type: KIEU, title, data: rong, note: "NOT_A_FILE", textSummary: `"${chiTiet}" không phải một tệp thường (có thể là thư mục). Dùng list_files để liệt kê thư mục.` };
    case "NOT_A_DIRECTORY":
      return { type: KIEU, title, data: rong, note: "NOT_A_DIRECTORY", textSummary: `"${chiTiet}" không phải một thư mục. Dùng read_file để đọc một tệp.` };
    case "READ_ERROR":
      return { type: KIEU, title, data: rong, note: "READ_ERROR", textSummary: `Không đọc được "${chiTiet}" (lỗi hệ tệp). Đây là lỗi ĐỌC THẬT, không phải một lượt từ chối vì chính sách.` };
    case "PATH_REJECTED":
    default:
      return { type: KIEU, title, data: rong, note: "PATH_REJECTED", textSummary: `Đường dẫn bị hộp cát TỪ CHỐI (${chiTiet}). Hộp cát chặn: đường dẫn tuyệt đối, ".." , ký tự NUL, đoạn dạng ổ đĩa "C:" ở BẤT KỲ vị trí nào, symlink/junction trỏ ra ngoài gốc, và tệp có nhiều liên kết cứng. Hãy dùng đường dẫn TƯƠNG ĐỐI so với thư mục repo.` };
  }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 1. read_file
// ══════════════════════════════════════════════════════════════════════════════════════════════

interface DuLieuDocTep {
  path: string | null;
  bytes: number | null;
  truncated: boolean;
  redacted: boolean;
  content: string | null;
}

const RONG_DOC: DuLieuDocTep = { path: null, bytes: null, truncated: false, redacted: false, content: null };

const thamSoDocTep = z
  .object({
    path: z.string().min(1).max(1024),
    maxBytes: z.number().int().min(256).max(TRAN_BYTE_MOI_TEP).optional(),
    __authCtx: authCtxParam,
    __projectRoot: projectRootParam,
  })
  .strict();

const readFileTool: Tool<z.infer<typeof thamSoDocTep>, DuLieuDocTep> = {
  name: "read_file",
  description:
    "Đọc nội dung THẬT của một tệp mã nguồn trong repo nền tảng (đường dẫn TƯƠNG ĐỐI so với thư mục repo, ví dụ " +
    "'server/services/aiLocalTools/toolRegistry.ts'). Hộp cát: chặn đường tuyệt đối, '..', symlink trỏ ra ngoài, " +
    "liên kết cứng; CẤM ĐỌC .env*/khoá riêng/chứng thư/node_modules/.git/dist/uploads; chỉ mở cho đuôi tệp mã " +
    "nguồn; có trần byte mỗi tệp và mỗi phiên; nội dung còn qua một lớp che bí mật. CHỈ ĐỌC, quyền ai_repo_read/canView.",
  parameters: thamSoDocTep,
  /**
   * ★★★ TRIGGER PHẢI **RỜI NHAU** VỚI `read_project_file` — ĐO ĐƯỢC, KHÔNG PHẢI CẨN THẬN THỪA.
   *
   * ⚠⚠ Bản đầu khai cả *"đọc file"*, *"mở file"*, *"xem file"*, *"nội dung file"*, *"read file"*,
   * *"读取文件"* — **trùng nguyên văn** với `read_project_file`. `findToolByTriggers` cộng điểm bằng
   * ĐỘ DÀI trigger và chọn bằng `score > best.score` (so sánh NGẶT) ⇒ hai tool **HOÀ**, và người
   * thắng là **người ĐĂNG KÝ TRƯỚC**, tức thứ tự dòng `import` trong `index.ts`. Lưới cũ
   * (`toolArgCoverage` §"đọc file main.st" ⇒ `read_project_file`) **vẫn XANH** trong tình trạng ấy
   * — nó xanh vì một chi tiết mà không ai coi là hành vi sản phẩm.
   * ⇒ Trigger ở đây nói về **MÃ NGUỒN / REPO**; cụm *"file"* trần thuộc về workspace lập trình.
   *   `repoSandbox.census.test.ts` §F khoá ranh giới ấy bằng hành vi, không bằng lời hứa.
   */
  triggers: [
    "đọc mã nguồn", "xem mã nguồn", "mở mã nguồn", "nội dung mã nguồn", "đọc file mã nguồn",
    "đọc file trong repo", "xem file trong repo", "file nguồn", "xem code file", "cho tôi xem code",
    "read source", "source code", "show source", "读取源码", "查看源码", "源代码",
  ],
  kind: "read",
  requiredPermission: QUYEN,
  handler: async (params) => {
    const title = "Đọc tệp trong repo";
    const raw = params as unknown as Record<string, unknown>;
    const denied = await rbacGate<DuLieuDocTep>(raw.__authCtx, QUYEN, KIEU, title, RONG_DOC);
    if (denied) return denied;

    const duongDan = typeof raw.path === "string" ? raw.path : "";
    if (duongDan === "") {
      return { type: KIEU, title, data: RONG_DOC, note: "MISSING_REQUIRED_ARG", textSummary: "Thiếu tham số bắt buộc `path` (đường dẫn TƯƠNG ĐỐI so với thư mục repo)." };
    }

    const tranByte = typeof raw.maxBytes === "number" ? raw.maxBytes : undefined;
    const kq = moTepTrongHopCat(duongDan, { tranByte, khoaNganSach: khoaNganSach(raw.__authCtx), goc: gocTuArgs(raw) });
    if (!kq.ok) return ketQuaTuChoiHopCat(title, RONG_DOC, kq.ma, kq.chiTiet);

    const data: DuLieuDocTep = {
      path: kq.relPath,
      bytes: kq.byteTrenDia,
      truncated: kq.catBot,
      redacted: kq.daChe,
      content: kq.noiDung,
    };
    const dau =
      `${kq.relPath} — ${kq.byteTrenDia} byte` +
      (kq.catBot ? `, ĐÃ CẮT ở ${kq.noiDung.length} byte (trần mỗi tệp/ngân sách phiên)` : "") +
      (kq.daChe ? ", CÓ chuỗi bí mật đã bị che" : "") +
      ":";
    return { type: KIEU, title, data, textSummary: `${dau}\n${kq.noiDung}` };
  },
};

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 2. list_files
// ══════════════════════════════════════════════════════════════════════════════════════════════

interface MucLietKe {
  path: string;
  kind: string;
  bytes: number | null;
}
interface DuLieuLietKe {
  path: string | null;
  count: number;
  truncated: boolean;
  entries: MucLietKe[];
}

const RONG_LIET_KE: DuLieuLietKe = { path: null, count: 0, truncated: false, entries: [] };

const thamSoLietKe = z
  .object({
    path: z.string().max(1024).optional(),
    depth: z.number().int().min(1).max(3).optional(),
    __authCtx: authCtxParam,
    __projectRoot: projectRootParam,
  })
  .strict();

const listFilesTool: Tool<z.infer<typeof thamSoLietKe>, DuLieuLietKe> = {
  name: "list_files",
  description:
    "Liệt kê tệp/thư mục trong repo nền tảng (đường dẫn TƯƠNG ĐỐI; bỏ trống = thư mục gốc repo), depth 1..3. " +
    "Thư mục bị loại trừ và tệp bí mật KHÔNG hiện ra. Dùng để tìm đường trước khi gọi read_file. " +
    "CHỈ ĐỌC, quyền ai_repo_read/canView.",
  parameters: thamSoLietKe,
  /** ⚠ KHÔNG khai `"ls"`: hai ký tự, `khopTriggerCoBien` vẫn cho nó khớp như một từ, và một trigger
   *  hai ký tự là một cái bẫy bắt nhầm rẻ tiền cho toàn bộ sổ đăng ký. */
  triggers: [
    "liệt kê file", "liệt kê thư mục", "có những file nào", "cây thư mục", "danh sách file",
    "thư mục có gì", "list files", "list directory", "what files", "列出文件", "目录结构",
  ],
  kind: "read",
  requiredPermission: QUYEN,
  handler: async (params) => {
    const title = "Liệt kê tệp trong repo";
    const raw = params as unknown as Record<string, unknown>;
    const denied = await rbacGate<DuLieuLietKe>(raw.__authCtx, QUYEN, KIEU, title, RONG_LIET_KE);
    if (denied) return denied;

    const batDau = typeof raw.path === "string" ? raw.path : "";
    const doSau = Math.min(typeof raw.depth === "number" ? raw.depth : 1, TRAN_DO_SAU);

    const goc = gocTuArgs(raw);
    const dau = lietKeTrongHopCat(batDau, goc, TRAN_MUC_LIET_KE);
    if (!dau.ok) return ketQuaTuChoiHopCat(title, RONG_LIET_KE, dau.ma, dau.chiTiet);

    const muc: MucLietKe[] = [];
    let catBot = dau.catBot;
    const day: Array<{ rel: string; sau: number }> = [];
    for (const e of dau.muc) {
      muc.push({ path: e.relPath, kind: e.kind, bytes: e.bytes });
      if (e.kind === "dir" && doSau > 1) day.push({ rel: e.relPath, sau: 1 });
    }
    while (day.length > 0 && muc.length < TRAN_MUC_LIET_KE) {
      const { rel, sau } = day.shift()!;
      const con = lietKeTrongHopCat(rel, goc, TRAN_MUC_LIET_KE - muc.length);
      if (!con.ok) continue;
      catBot = catBot || con.catBot;
      for (const e of con.muc) {
        if (muc.length >= TRAN_MUC_LIET_KE) {
          catBot = true;
          break;
        }
        muc.push({ path: e.relPath, kind: e.kind, bytes: e.bytes });
        if (e.kind === "dir" && sau + 1 < doSau) day.push({ rel: e.relPath, sau: sau + 1 });
      }
    }

    const data: DuLieuLietKe = { path: dau.relPath, count: muc.length, truncated: catBot, entries: muc };
    if (muc.length === 0) {
      return { type: KIEU, title, data, note: "NOT_FOUND", textSummary: `Thư mục "${dau.relPath || "."}" không có mục nào hộp cát cho phép hiển thị.` };
    }
    const dong = muc.map((m) => `${m.kind === "dir" ? "[D] " : m.kind === "file" ? "[F] " : `[${m.kind[0]!.toUpperCase()}] `}${m.path}${m.bytes !== null ? ` (${m.bytes} B)` : ""}`);
    const than = `${dau.relPath || "."} — ${muc.length} mục${catBot ? ` (ĐÃ CẮT ở trần ${TRAN_MUC_LIET_KE})` : ""}:\n${dong.join("\n")}`;
    // Byte PHÁT RA cũng vào sổ ngân sách — cùng đơn vị đo với `read_file`/`grep_repo`.
    const khoa = khoaNganSach(raw.__authCtx);
    if (khoa !== undefined) tieuNganSach(khoa, than.length);
    return { type: KIEU, title, data, textSummary: than };
  },
};

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 3. grep_repo
// ══════════════════════════════════════════════════════════════════════════════════════════════

interface KetQuaGrep {
  path: string;
  line: number;
  text: string;
}
interface DuLieuGrep {
  pattern: string | null;
  scanned: number;
  count: number;
  truncated: boolean;
  timedOut: boolean;
  matches: KetQuaGrep[];
}

const RONG_GREP: DuLieuGrep = { pattern: null, scanned: 0, count: 0, truncated: false, timedOut: false, matches: [] };

/**
 * ★★★ 2026-08-23 · UX LÔ 1 (C4) — *"Grep 1 kết quả là ĐỊNH NGHĨA mà không ai nói cho tôi 'không
 * nơi nào gọi'."*
 *
 * Người hỏi *"X gọi ở đâu"* nhận về một dòng `export function X(...)` và phải TỰ suy ra rằng đó là
 * chính chỗ khai báo — tức cả repo (trong phạm vi quét) KHÔNG có một điểm gọi nào. Hàm này nói hộ
 * điều ấy, và CHỈ nói khi CHẮC — ba điều kiện, thiếu một là im lặng (`null`, giữ nguyên câu cũ):
 *
 *   1. **Phép quét TRỌN VẸN** (`catBot === false`): một bản cắt (trần tệp/kết quả/hạn giờ) không
 *      cho phép phát biểu "chưa nơi nào gọi" — điểm gọi có thể nằm đúng ở phần chưa quét. Đây là
 *      cùng lý lẽ với `GREP_DEADLINE` ("phép đo BỘ PHẬN không được thành khẳng định TOÀN THỂ").
 *   2. **Mẫu là một ĐỊNH DANH trần** (chữ/số/`_`/`$`): với một regex thật (`log.*Error`) thì khái
 *      niệm "dòng khai báo của nó" không tồn tại.
 *   3. **MỌI dòng khớp đều là dòng KHAI BÁO của đúng định danh ấy** — nhận theo các khuôn khai báo
 *      hẹp (`function|class|interface|type|enum|const|let|var|def|struct|record` + tên). Một dòng
 *      `const kq = X(...)` là ĐIỂM GỌI (tên nằm sau `=` chứ không sau từ khoá khai báo) ⇒ không khớp
 *      khuôn ⇒ cả phép nhận xét tắt. Hẹp là chủ ý: nói sai "chưa ai gọi" đắt hơn nhiều so với không nói.
 *
 * THUẦN, xuất ra để lưới + đột biến đo thẳng (`repoGrepDinhNghia.test.ts`).
 */
export function nhanXetChiThayDinhNghia(
  mau: string,
  matches: ReadonlyArray<{ path: string; line: number; text: string }>,
  catBot: boolean,
): string | null {
  if (catBot || matches.length === 0) return null;
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(mau)) return null;
  // `$` là ký tự regex — thoát trước khi ghép khuôn (định danh JS hợp lệ có thể chứa nó).
  const ten = mau.replace(/\$/g, "\\$");
  const khuonKhaiBao = new RegExp(
    `\\b(?:function\\*?|class|interface|type|enum|const|let|var|def|struct|record)\\s+${ten}\\b`,
  );
  if (!matches.every((m) => khuonKhaiBao.test(m.text))) return null;
  const tep = [...new Set(matches.map((m) => m.path))].join(", ");
  return (
    `⚠ Cả ${matches.length} kết quả đều là dòng KHAI BÁO/ĐỊNH NGHĨA của "${mau}" (${tep}) — ` +
    `trong phạm vi đã quét CHƯA thấy nơi nào GỌI/dùng nó.`
  );
}

/** Trần độ dài MỘT dòng đem đi khớp — xem khối ⚠ ReDoS ở `grepRepoTool`. */
const TRAN_KY_TU_MOI_DONG = 1_000;
/** Số dòng giữa hai lượt hỏi đồng hồ. Hỏi mỗi dòng là tốn; hỏi mỗi tệp là quá thưa. */
const NHIP_HOI_DONG_HO = 64;

const thamSoGrep = z
  .object({
    pattern: z.string().min(1).max(200),
    path: z.string().max(1024).optional(),
    ignoreCase: z.boolean().optional(),
    maxResults: z.number().int().min(1).max(TRAN_KET_QUA_GREP).optional(),
    __authCtx: authCtxParam,
    __projectRoot: projectRootParam,
  })
  .strict();

const grepRepoTool: Tool<z.infer<typeof thamSoGrep>, DuLieuGrep> = {
  name: "grep_repo",
  description:
    "Tìm một BIỂU THỨC CHÍNH QUY trong mã nguồn repo nền tảng và trả về đường dẫn + số dòng + dòng khớp. " +
    "Dùng để trả lời 'hàm này gọi ở đâu', 'ai còn dùng cờ này'. Cùng hộp cát với read_file (cấm .env*, " +
    "node_modules, .git, dist…); có trần số tệp quét, trần số kết quả và HẠN GIỜ — kết quả bị cắt luôn được KHAI. " +
    "CHỈ ĐỌC, quyền ai_repo_read/canView.",
  parameters: thamSoGrep,
  triggers: [
    "tìm trong mã", "tìm trong repo", "grep", "gọi ở đâu", "dùng ở đâu", "ai gọi hàm", "tìm chuỗi",
    "search code", "find in repo", "where is used", "在代码中查找", "全局搜索",
  ],
  kind: "read",
  requiredPermission: QUYEN,
  handler: async (params) => {
    const title = "Tìm trong mã nguồn repo";
    const raw = params as unknown as Record<string, unknown>;
    const denied = await rbacGate<DuLieuGrep>(raw.__authCtx, QUYEN, KIEU, title, RONG_GREP);
    if (denied) return denied;

    const mau = typeof raw.pattern === "string" ? raw.pattern : "";
    if (mau === "") {
      return { type: KIEU, title, data: RONG_GREP, note: "MISSING_REQUIRED_ARG", textSummary: "Thiếu tham số bắt buộc `pattern` (biểu thức chính quy cần tìm)." };
    }
    /**
     * ⚠⚠ KHAI THẲNG GIỚI HẠN — **hạn giờ ở đây chặn "quét quá nhiều tệp", KHÔNG chặn được một
     * biểu thức bệnh lý quay lui trong MỘT lượt khớp.** Engine regex của V8 không cắt ngang được.
     * Ba phép giảm thiểu, và cả ba đều là giảm thiểu chứ không phải bảo đảm:
     *   • mẫu ≤ 200 ký tự (schema);
     *   • dòng đem khớp ≤ 1.000 ký tự — bó không gian quay lui về một hằng;
     *   • hỏi đồng hồ mỗi 64 dòng — một mẫu bình thường dừng đúng hạn.
     * Mô hình đe doạ chấp nhận được vì tool này đứng sau `ai_repo_read` (admin/engineer): kẻ viết
     * mẫu là **model của chính người dùng có quyền**, không phải một người lạ.
     */
    let re: RegExp;
    try {
      re = new RegExp(mau, raw.ignoreCase === true ? "i" : "");
    } catch (e) {
      return { type: KIEU, title, data: { ...RONG_GREP, pattern: mau }, note: "INVALID_PATTERN", textSummary: `Biểu thức chính quy không hợp lệ: ${e instanceof Error ? e.message : String(e)}` };
    }

    const goc = gocTuArgs(raw);
    const batDau = typeof raw.path === "string" ? raw.path : "";
    const tranKetQua = Math.min(typeof raw.maxResults === "number" ? raw.maxResults : TRAN_KET_QUA_GREP, TRAN_KET_QUA_GREP);
    const hanChot = Date.now() + HAN_GIO_GREP_MS;

    // Kiểm THƯ MỤC gốc trước, để một `path` xấu ra mã đúng thay vì "0 kết quả" (im lặng là nói dối).
    const kiemGoc = lietKeTrongHopCat(batDau, goc, 1);
    if (!kiemGoc.ok) return ketQuaTuChoiHopCat(title, { ...RONG_GREP, pattern: mau }, kiemGoc.ma, kiemGoc.chiTiet);

    /**
     * ⚠ NGÂN SÁCH ĐƯỢC HỎI **TRƯỚC**, VÀ CHỈ BỊ TRỪ THEO BYTE **PHÁT RA** — xem khối lý lẽ ở
     * `repoSandbox.TRAN_BYTE_MOI_PHIEN`. Lượt QUÉT không truyền `khoaNganSach`: nó là công việc
     * nội bộ, không byte nào của nó vào cửa sổ chat.
     */
    const khoa = khoaNganSach(raw.__authCtx);
    if (khoa !== undefined) {
      const ns = nganSachConLai(khoa);
      if (ns.conLai <= 0) {
        return ketQuaTuChoiHopCat(title, { ...RONG_GREP, pattern: mau }, MA_TU_CHOI_HOP_CAT.BUDGET_EXCEEDED, `${ns.daDung}/${TRAN_BYTE_MOI_PHIEN}`);
      }
    }

    const duyet = duyetTepDocDuoc(goc, batDau, TRAN_TEP_QUET, hanChot);
    const matches: KetQuaGrep[] = [];
    let quet = 0;
    let hetGio = duyet.hetGio;

    for (const rel of duyet.tep) {
      if (matches.length >= tranKetQua) break;
      if (Date.now() >= hanChot) {
        hetGio = true;
        break;
      }
      // ⚠ doc 79 TRỤC 2 — lượt QUÉT phải bám ĐÚNG gốc dự án; bỏ `goc` ở đây thì grep quét gốc mặc
      //   định trong khi cây tệp/kết quả nói về gốc đang chọn (im lặng sai gốc).
      const kq = moTepTrongHopCat(rel, { goc });
      if (!kq.ok) continue;
      quet++;
      const dong = kq.noiDung.split(/\r?\n/);
      for (let i = 0; i < dong.length; i++) {
        if ((i & (NHIP_HOI_DONG_HO - 1)) === 0 && Date.now() >= hanChot) {
          hetGio = true;
          break;
        }
        const d = dong[i]!;
        const doKhop = d.length > TRAN_KY_TU_MOI_DONG ? d.slice(0, TRAN_KY_TU_MOI_DONG) : d;
        re.lastIndex = 0;
        if (!re.test(doKhop)) continue;
        matches.push({ path: kq.relPath, line: i + 1, text: doKhop.trim().slice(0, 300) });
        if (matches.length >= tranKetQua) break;
      }
      if (hetGio) break;
    }

    const catBot = matches.length >= tranKetQua || duyet.hetTran || hetGio;
    const data: DuLieuGrep = {
      pattern: mau,
      scanned: quet,
      count: matches.length,
      truncated: catBot,
      timedOut: hetGio,
      matches,
    };

    if (hetGio && matches.length === 0) {
      return { type: KIEU, title, data, note: "GREP_DEADLINE", textSummary: `Quá hạn ${HAN_GIO_GREP_MS} ms sau khi quét ${quet} tệp mà chưa có kết quả nào. Đây là một BẢN CẮT vì hết giờ, KHÔNG phải kết luận "mẫu này không có trong repo" — hãy thu hẹp bằng tham số path.` };
    }
    if (matches.length === 0) {
      return { type: KIEU, title, data, note: "NO_MATCH", textSummary: `Đã quét ${quet} tệp trong "${batDau || "."}" và KHÔNG dòng nào khớp /${mau}/. ${duyet.hetTran ? `⚠ Đã chạm trần ${TRAN_TEP_QUET} tệp nên phạm vi quét là MỘT PHẦN, không phải cả repo.` : "Phạm vi quét đã đi hết cây thư mục được phép."}` };
    }

    const canhBao = [
      hetGio ? `quá hạn ${HAN_GIO_GREP_MS} ms` : "",
      duyet.hetTran ? `chạm trần ${TRAN_TEP_QUET} tệp` : "",
      matches.length >= tranKetQua ? `chạm trần ${tranKetQua} kết quả` : "",
    ].filter(Boolean);
    const dongRa = matches.map((m) => `${m.path}:${m.line}: ${m.text}`);
    // ★ (C4) — chỉ-thấy-định-nghĩa: nói hộ điều người dùng phải tự suy; CHẮC mới nói (xem docblock).
    const nhanXet = nhanXetChiThayDinhNghia(mau, matches, catBot);
    const than =
      `/${mau}/ — ${matches.length} kết quả trong ${quet} tệp đã quét` +
      (canhBao.length ? ` (BẢN CẮT: ${canhBao.join(", ")})` : "") +
      `:\n${dongRa.join("\n")}` +
      (nhanXet ? `\n\n${nhanXet}` : "");
    if (khoa !== undefined) tieuNganSach(khoa, than.length);
    return { type: KIEU, title, data, textSummary: than };
  },
};

// ─── đăng ký (guard bất biến, đúng khuôn readToolsProgramming) ─────────────────────────────────

let _daDangKy = false;
export function dangKyRepoReadTools(): void {
  if (_daDangKy) return;
  _daDangKy = true;
  registerTool(readFileTool);
  registerTool(listFilesTool);
  registerTool(grepRepoTool);
}

dangKyRepoReadTools();

export { readFileTool, listFilesTool, grepRepoTool };
