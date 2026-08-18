/**
 * Wave 1 — Ngữ cảnh repo CHỈ-ĐỌC cho 4 specialist agent.
 *
 * Vì sao có file này: aiSpecialistAgentService KHÔNG có `fs` — trường `files[]`
 * chỉ được nhét vào prompt dưới dạng TÊN file, nên agent tư vấn mù. Service này
 * nạp nội dung THẬT (có giới hạn), file phụ thuộc (code-graph.json) và mảnh RAG.
 *
 * AN TOÀN: chỉ-đọc, KHÔNG có bất kỳ đường ghi nào. Bí mật bị chặn 2 lớp: theo tên file +
 * redactSecretsOnly().
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ ĐÍNH CHÍNH 2026-08-18 (doc 78 · PHA A) — LỜI KHAI CŨ Ở ĐÂY **NAY SAI**, VÀ ĐÂY LÀ CHỖ NÓ
 *     ĐƯỢC SỬA CHỨ KHÔNG PHẢI CHỖ NÓ ĐƯỢC XOÁ.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Nguyên văn câu cũ: *"KHÔNG đăng ký vào toolRegistry nên LLM không thể tự gọi với tham số tuỳ ý —
 * chỉ service gọi với danh sách file do NGƯỜI DÙNG nhập."*
 *
 * Câu ấy vẫn **đúng về CHÍNH MODULE NÀY** — `gatherRepoContext` hôm nay vẫn không phải một tool, và
 * người gọi nó vẫn là `aiSpecialistAgentRouter` + `aiProgrammingCopilot`. Nhưng **KẾT LUẬN** mà nó
 * ngụ ý — *"vì thế LLM không tự chọn được tệp để đọc"* — đã **hết đúng**: chủ dự án duyệt doc 78
 * PHA A ngày 2026-08-18, và ba tool `read_file`/`list_files`/`grep_repo`
 * (`server/services/aiLocalTools/repoReadTools.ts`) **đã đăng ký vào `toolRegistry`**. LLM nay tự
 * chọn được tệp.
 *
 * ⚠ Để nguyên câu cũ là biến nó thành một **lời khai SAI trong mã an toàn** — nguy hiểm hơn không
 *   có lời khai nào, vì người đọc sau sẽ tin rằng bề mặt "LLM tự chọn tệp" chưa tồn tại và sẽ không
 *   đi tìm hàng rào của nó.
 *
 * ⚠ HAI ĐƯỜNG, HAI LUẬT — đừng nhầm chúng là một:
 *   • ĐƯỜNG NÀY (`gatherRepoContext`): danh sách file do NGƯỜI DÙNG nhập; cấm theo tên/thư mục/đuôi
 *     ngay trong file này (`classifyRepoPath`); trần byte theo tham số của người gọi.
 *   • ĐƯỜNG TOOL (`repoSandbox.ts`): đường dẫn do **LLM** chọn; thêm cửa đĩa dùng chung
 *     (`confineTargetUnder` + `readConfined`: realpath, `nlink > 1`, tầng fd chống TOCTOU), ngân
 *     sách byte theo PHIÊN, và cổng RBAC `ai_repo_read/canView`.
 *   Đường tool CHẶT HƠN ở mọi tầng, đúng như phải thế: nguồn của đường dẫn kém tin cậy hơn hẳn.
 *
 * ⚠ `classifyRepoPath` dưới đây **KHÔNG** phải cửa của đường tool và không được dùng làm cửa ấy:
 *   nó là hàm THUẦN, không biết gì về symlink, hard link hay realpath — ba thứ mà một đường dẫn do
 *   model chọn bắt buộc phải bị kiểm.
 */
import fs from "node:fs";
import path from "node:path";
import { redactSecretsOnly } from "./aiSafety";
// G2-A — MỘT bộ ước lượng token cho cả hệ. KHÔNG viết lại `len/4` ở đây: hằng 2,8 ký tự/token
// là số ĐO THẬT bằng `POST /tokenize` của chính llama-server đang phục vụ (xem
// `KY_TU_MOI_TOKEN_UOC_LUONG`), và cổng từ-chối-trung-thực `kiemNganSachNguCanh()` cân bằng
// CHÍNH hàm này. Hai bộ ước lượng khác nhau ⇒ ngân sách ở đây và cổng ở kia sẽ TRÔI khỏi nhau —
// đúng lớp lỗi "N+1" repo này đã dính nhiều lần.
import { uocLuongSoToken } from "../aiLlamaServerClient";

export type RepoReadRejectReason =
  | "ABSOLUTE" | "TRAVERSAL" | "NUL" | "ESCAPE"
  | "DENIED_SECRET" | "DENIED_DIR" | "DENIED_EXT"
  | "NOT_FOUND" | "NOT_A_FILE" | "BUDGET_EXCEEDED";

const DENIED_FILE_PATTERNS: RegExp[] = [
  /^\.env$/i, /^\.env\./i, /\.pem$/i, /\.key$/i,
  /\.p12$/i, /\.pfx$/i, /\.keystore$/i, /^id_rsa/i,
];

const DENIED_DIR_PREFIXES = [
  "node_modules/", ".git/", "dist/", "uploads/",
  "knowledge/embeddings", ".superpowers/", ".playwright-mcp/",
];

const ALLOWED_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".sql", ".md", ".css", ".yml", ".yaml",
]);

/** Chuẩn hoá `\` → `/` và bỏ `./` đầu chuỗi. */
export function normalizeRepoPath(input: string): string {
  return input.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

/**
 * Phân loại đường dẫn tương đối. Trả `null` nghĩa là HỢP LỆ để đọc.
 * Hàm thuần — không chạm đĩa (kiểm tra tồn tại là việc của gatherRepoContext).
 */
export function classifyRepoPath(input: string): RepoReadRejectReason | null {
  if (input.includes(String.fromCharCode(0))) return "NUL";
  const rel = normalizeRepoPath(input);
  if (!rel) return "NOT_FOUND";
  if (rel.startsWith("/") || /^[a-zA-Z]:\//.test(rel)) return "ABSOLUTE";
  if (rel.split("/").includes("..")) return "TRAVERSAL";

  const lower = rel.toLowerCase();
  for (const prefix of DENIED_DIR_PREFIXES) {
    if (lower.startsWith(prefix)) return "DENIED_DIR";
  }
  const base = rel.slice(rel.lastIndexOf("/") + 1);
  for (const pattern of DENIED_FILE_PATTERNS) {
    if (pattern.test(base)) return "DENIED_SECRET";
  }
  const ext = path.extname(base).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) return "DENIED_EXT";
  return null;
}

export interface RepoFileRead {
  path: string;
  content: string;
  bytes: number;
  truncated: boolean;
  redacted: boolean;
}

export interface RepoContextResult {
  files: RepoFileRead[];
  skipped: Array<{ path: string; reason: RepoReadRejectReason }>;
  dependencies: string[];
  ragSnippets: Array<{ sourcePath: string; text: string; score: number }>;
  totalBytes: number;
}

export interface GatherRepoContextInput {
  files?: string[];
  objective?: string;
  includeRag?: boolean;
  includeDependencies?: boolean;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  ragTopK?: number;
  /** Test seam — mặc định process.cwd(). */
  repoRoot?: string;
  /** Test seam — mặc định <repoRoot>/knowledge/code-graph.json. */
  codeGraphPath?: string;
  /**
   * Final-fix round, Task 6 (SECURITY) — the REAL authenticated RBAC role of whoever triggered
   * this repo-context gather, forwarded into retrieveKnowledge()'s Studio-corpus gate (see
   * kbStudioAccess.ts). Caller-populated only — this module has no auth awareness of its own.
   */
  callerRole?: string;
}

export const DEFAULT_MAX_FILE_BYTES = 65_536;
export const DEFAULT_MAX_TOTAL_BYTES = 262_144;

/** Đọc file phụ thuộc từ code-graph.json. Fail-safe: lỗi/thiếu ⇒ []. */
function readDependencies(codeGraphPath: string, files: string[]): string[] {
  try {
    if (!fs.existsSync(codeGraphPath)) return [];
    const raw = JSON.parse(fs.readFileSync(codeGraphPath, "utf8"));
    if (!Array.isArray(raw)) return [];
    const wanted = new Set(files.map(normalizeRepoPath));
    const out = new Set<string>();
    for (const edge of raw) {
      const from = typeof edge?.from === "string" ? normalizeRepoPath(edge.from) : null;
      const to = typeof edge?.to === "string" ? normalizeRepoPath(edge.to) : null;
      if (from && to && wanted.has(from)) out.add(to);
    }
    return [...out];
  } catch {
    return [];
  }
}

export async function gatherRepoContext(input: GatherRepoContextInput): Promise<RepoContextResult> {
  const repoRoot = input.repoRoot ?? process.cwd();
  const maxFileBytes = input.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxTotalBytes = input.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const wantRag = input.includeRag ?? Boolean(input.objective);
  const wantDeps = input.includeDependencies ?? Boolean(input.files?.length);

  const files: RepoFileRead[] = [];
  const skipped: Array<{ path: string; reason: RepoReadRejectReason }> = [];
  let totalBytes = 0;

  for (const raw of input.files ?? []) {
    const rel = normalizeRepoPath(raw);
    const reason = classifyRepoPath(raw);
    if (reason) {
      skipped.push({ path: raw, reason });
      continue;
    }
    if (totalBytes >= maxTotalBytes) {
      skipped.push({ path: rel, reason: "BUDGET_EXCEEDED" });
      continue;
    }
    try {
      const abs = path.resolve(repoRoot, rel);
      // Chốt chặn 1 (thuần chuỗi): sau resolve vẫn phải nằm trong gốc repo.
      const rootResolved = path.resolve(repoRoot);
      if (abs !== rootResolved && !abs.startsWith(rootResolved + path.sep)) {
        skipped.push({ path: rel, reason: "ESCAPE" });
        continue;
      }
      // Chốt chặn 2 (M-1): `statSync`/`readFileSync` ĐI THEO symlink, nên một
      // symlink/junction NẰM TRONG repo mà trỏ ra ngoài vẫn lọt chốt chặn 1
      // (đường dẫn danh nghĩa vẫn có tiền tố gốc repo) rồi đọc được file ngoài
      // repo. So lại tiền tố sau khi ĐÃ GIẢI HẾT symlink của cả file lẫn gốc
      // repo (giải cả hai vì bản thân gốc repo cũng có thể nằm sau symlink —
      // vd. /tmp trên macOS — nếu chỉ giải một phía thì mọi đường dẫn hợp lệ
      // đều bị coi là ESCAPE). `realpathSync` ném khi đường dẫn không tồn tại
      // ⇒ rơi xuống catch thành NOT_FOUND, đúng như trước.
      const realRoot = fs.realpathSync(rootResolved);
      const realAbs = fs.realpathSync(abs);
      if (realAbs !== realRoot && !realAbs.startsWith(realRoot + path.sep)) {
        skipped.push({ path: rel, reason: "ESCAPE" });
        continue;
      }
      const stat = fs.statSync(realAbs);
      if (!stat.isFile()) {
        skipped.push({ path: rel, reason: "NOT_A_FILE" });
        continue;
      }
      const original = fs.readFileSync(realAbs, "utf8");
      const budgetLeft = maxTotalBytes - totalBytes;
      const limit = Math.min(maxFileBytes, budgetLeft);
      const truncated = original.length > limit;
      const sliced = truncated ? original.slice(0, limit) : original;
      const red = redactSecretsOnly(sliced);
      files.push({
        path: rel,
        content: red.text,
        bytes: stat.size,
        truncated,
        redacted: red.text !== sliced,
      });
      totalBytes += sliced.length;
    } catch {
      skipped.push({ path: rel, reason: "NOT_FOUND" });
    }
  }

  const dependencies = wantDeps
    ? readDependencies(input.codeGraphPath ?? path.join(repoRoot, "knowledge", "code-graph.json"), input.files ?? [])
    : [];

  let ragSnippets: RepoContextResult["ragSnippets"] = [];
  if (wantRag && input.objective) {
    try {
      const { retrieveKnowledge } = await import("../aiLocalKnowledgeService");
      // Final-fix round, Task 6 (SECURITY) — thread the REAL RBAC role through so
      // retrieveKnowledge's Studio-corpus gate sees who's asking. Today every caller of
      // gatherRepoContext (aiSpecialistAgentRouter.ts's run/runWorkflowChain/runModuleAudit) is
      // already behind `roleProcedure("admin","engineer")`, so `input.callerRole` is always
      // "admin"/"engineer" in practice — this is defense-in-depth (and keeps the gate from
      // silently starving the Specialist Studio of legitimate Studio citations by defaulting
      // to fail-closed when no role is threaded at all).
      const kb = await retrieveKnowledge(input.objective, input.ragTopK ?? 5, { callerRole: input.callerRole });
      ragSnippets = (kb.contexts ?? []).map((text, i) => ({
        sourcePath: (kb.citations?.[i] as any)?.sourcePath ?? "(unknown)",
        text,
        score: Number((kb.citations?.[i] as any)?.score ?? 0),
      }));
    } catch {
      ragSnippets = [];
    }
  }

  return { files, skipped, dependencies, ragSnippets, totalBytes };
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// G2-A (2026-08-16) — CHỈ MỤC REPO CHO **COPILOT LẬP TRÌNH**, CÓ NGÂN SÁCH TOKEN.
//
// ─── VÌ SAO ────────────────────────────────────────────────────────────────────────────────
// `knowledge/chunks.jsonl` (7.306 chunk: 328 router · 1.177 service · 923 type · 121 bảng ·
// 4.233 doc) + `knowledge/embeddings.jsonl` mô tả CHÍNH nền tảng này, và đã tươi. Nhưng trước
// G2-A `gatherRepoContext()` chỉ có MỘT nhóm người gọi (aiSpecialistAgentRouter) — copilot lập
// trình (`aiProgrammingCopilot.generateProgram`) MÙ hoàn toàn với kho đó: nó chỉ thấy KB manual
// hãng + đúng một buffer người dùng dán tay.
//
// ─── HÀM NÀY LÀM GÌ (và cố tình KHÔNG làm gì) ──────────────────────────────────────────────
// Nó là một lớp mỏng TRÊN `gatherRepoContext()` (KHÔNG mở đường truy hồi thứ hai — cùng
// `retrieveKnowledge`, cùng cổng RBAC `callerRole`, cùng đường fail-safe) và thêm đúng ba thứ mà
// một prompt sinh mã bắt buộc phải có:
//   1. NGƯỠNG LIÊN QUAN — `minScore`. Kho này nói về TypeScript/tRPC/Drizzle của nền tảng, còn
//      phần lớn câu hỏi của copilot là cú pháp PLC/robot của HÃNG. Nhét top-N vô điều kiện là
//      đổ nhiễu vào đúng chỗ mô hình đang cần tập trung ⇒ dưới ngưỡng thì KHÔNG chèn gì cả.
//   2. NGÂN SÁCH TOKEN CỨNG — `maxTokens`. Một chunk tối đa 1.800 ký tự ≈ 643 token; 5 chunk là
//      ~3.200 token, tức HƠN MỘT NỬA cửa sổ 8.192 của tầng code. Không có trần thì tính năng này
//      biến copilot thành "luôn từ chối" (cổng `kiemNganSachNguCanh`) hoặc tràn ctx in-process.
//   3. KHỐI VĂN BẢN ĐÁNH SỐ [R n] — tách hẳn khỏi trích dẫn manual hãng `[n]`, để mô hình (và
//      người đọc log) không lẫn "mã nền tảng" với "tài liệu hãng".
// Nó KHÔNG đọc file theo tên (đó là `gatherRepoContext({files})` cho Specialist Studio), KHÔNG
// ghi, KHÔNG ném — mọi nhánh hỏng đều trả một kết quả RỖNG có lý do đọc được.
// ════════════════════════════════════════════════════════════════════════════════════════════

/** Cờ bật/tắt — đọc TẠI CHỖ GỌI (test lật env theo từng ca). Xem `REPO_INDEX_DEFAULT_ON`. */
export const REPO_INDEX_FLAG = "AI_COPILOT_REPO_INDEX_ENABLED";

/**
 * ★ MẶC ĐỊNH **TẮT** — và đây là một kết luận từ PHÉP ĐO, không phải sự rụt rè.
 *
 * Đo 2026-08-16 trên đúng 29 ca của `scripts/ai-eval/codegen-cases.json`, cấu hình sản xuất
 * (rerank gguf bật): truy hồi CHẠY TỐT (ấm 412–705 ms) và **bắn trúng thật** ở những `kind` mà
 * ĐỊNH DẠNG ĐÍCH do CHÍNH repo này định nghĩa —
 *   • `zm-shuttle-loop` → `server/services/programming/zmotion/zmotionBasicAdapter.ts` (0,643)
 *   • `pou-*`           → `iec61131/pouToSt.ts`, `pouModel.ts` (0,55–0,60)
 * nhưng cũng bắn TRẬT với điểm CAO ở nơi chỉ trùng từ vựng —
 *   • `tm-*` → `drizzle/schema/robot.ts` (0,70) và `knowledge/operational/robot-control.md`
 *     (0,725): đó là bảng DB/màn hình điều khiển robot của NỀN TẢNG, không phải cú pháp TMscript.
 *
 * ⇒ Truy hồi CÓ tín hiệu, nhưng độ chính xác CHƯA đủ để tự tin bật cho mọi người; và chỉ số kết
 * cục (`validPassRate` của eval-codegen) **KHÔNG đo được trong phiên này**: tầng code cần
 * Qwen3-Coder-30B (~17 GB trọng số) trong khi GPU chỉ còn ~3,5 GB trống. "Chưa đo được kết cục"
 * ⇒ TẮT. Đường bật: `AI_COPILOT_REPO_INDEX_ENABLED=true`.
 */
export const REPO_INDEX_DEFAULT_ON = false;

/** Số đoạn xin từ tầng truy hồi TRƯỚC khi lọc ngưỡng + cắt ngân sách. */
export const REPO_INDEX_DEFAULT_TOP_K = 5;

/**
 * ★ Ngưỡng liên quan — **ĐO, không đoán**. Điểm là điểm hoà (0,72·cosine + 0,28·keyword, có thể
 * đã qua rerank) của `aiLocalKnowledgeService`, thang ~0..1.
 *
 * Phép đo 2026-08-16 (29 ca eval + 5 câu hỏi về repo):
 *   • câu hỏi CÚ PHÁP HÃNG (`iec61131-st`, `iec61131-ld`, `mitsubishi-*`): điểm cao nhất
 *     0,459–0,589 — và MỌI đoạn đó đều là tài liệu sản phẩm/vận hành, tức NHIỄU;
 *   • câu hỏi VỀ CHÍNH REPO: 0,580–0,782, đoạn trúng đích thật.
 * ⇒ 0,60 là chỗ tách hai phân bố đó. Bản nháp đầu đặt 0,35 và hệ quả đo được là **29/29 ca eval
 * đều bị chèn ngữ cảnh**, gần hết là nhiễu — tức ngưỡng 0,35 KHÔNG phải một cổng, nó là một cái
 * cửa mở.
 */
export const REPO_INDEX_DEFAULT_MIN_SCORE = 0.6;

/**
 * ★ Chỉ nhận đoạn đến từ **MÃ NGUỒN**, không nhận tài liệu.
 *
 * Vì sao cần cổng thứ hai bên cạnh ngưỡng điểm: điểm KHÔNG phân biệt được "file định nghĩa định
 * dạng đích" với "tài liệu tình cờ trùng từ vựng". Đo được: `tm-pick-place` cho
 * `knowledge/operational/robot-control.md` **0,715** — cao hơn cả `zmotionBasicAdapter.ts`
 * (0,643) vốn là đoạn ĐÚNG cho ca zmotion. Một cổng chỉ-điểm sẽ luôn nuốt loại nhiễu này.
 *
 * Ranh giới ở đây là ranh giới VAI TRÒ, không phải mẹo lọc: `knowledge/**` và `docs/**` là kho
 * của trợ lý VẬN HÀNH (ops KB đã phục vụ chúng ở chỗ khác); thứ một copilot LẬP TRÌNH cần là mã
 * thật — adapter, schema, router, type. Đúng như tiêu đề khối tự khai: *"mã nguồn của CHÍNH nền
 * tảng này"*.
 */
export const REPO_INDEX_SOURCE_PREFIXES: readonly string[] = ["server/", "client/", "shared/", "drizzle/", "scripts/"];

/** `true` ⇔ đường dẫn thuộc vùng MÃ NGUỒN (xem `REPO_INDEX_SOURCE_PREFIXES`). */
export function laDuongDanMaNguon(sourcePath: string, prefixes: readonly string[] = REPO_INDEX_SOURCE_PREFIXES): boolean {
  const p = normalizeRepoPath(String(sourcePath ?? "")).toLowerCase();
  if (!p) return false;
  return prefixes.some((pre) => p.startsWith(pre.toLowerCase()));
}

/** Trần token mặc định cho TOÀN BỘ khối chỉ mục repo trong một prompt. */
export const REPO_INDEX_DEFAULT_MAX_TOKENS = 900;

/** Tiêu đề khối — hằng số vì cả prompt lẫn test lẫn log đều phải nói CÙNG một chuỗi. */
export const REPO_INDEX_BLOCK_HEADER =
  "NGỮ CẢNH TỪ CHỈ MỤC REPO (mã nguồn của CHÍNH nền tảng này; trích dẫn theo [R n] — KHÁC [n] của manual hãng):";

/** Dấu hiệu một đoạn đã bị cắt vì hết ngân sách — hiện ra prompt để mô hình biết là bản cắt. */
export const REPO_INDEX_TRUNCATION_MARK = "\n…(đã cắt theo ngân sách token)";

/**
 * Số token TỐI THIỂU còn lại thì mới đáng đi truy hồi. Dưới mức này, ngay cả tiêu đề khối cũng
 * không lọt (hoặc lọt xong chẳng còn chỗ cho một mẩu mã nào có nghĩa) ⇒ đi embed + rerank rồi
 * vứt kết quả là đốt GPU/CPU cho một khối RỖNG. Đây là "cổng rẻ trước cổng tốn" ở đúng chỗ nó
 * phải nằm: bên trong hàm, để MỌI người gọi đều được bảo vệ, không phải nhớ tự kiểm ở ngoài.
 */
export const REPO_INDEX_MIN_SNIPPET_TOKENS = 60;

/**
 * ★ HẠN GIỜ cho lượt truy hồi.
 *
 * ─── PHÉP ĐO ĐỨNG SAU CON SỐ (2026-08-16, máy thật, GPU còn ~5,7 GB trống) ─────────────────
 *   • lượt LẠNH (nạp `knowledge/embeddings.jsonl` 162 MB + nạp embedder) = **14.351 ms**
 *   • lượt ẤM (cache module-level) = **245–283 ms** (6/6 truy vấn)
 * ⇒ 20 s để lượt ĐẦU TIÊN sau khi khởi động vẫn kịp (nó vốn đã đứng cạnh `warmCodeModel()` mất
 * hàng chục giây), còn từ lượt thứ hai trở đi hạn giờ này thực tế không bao giờ chạm tới.
 *
 * ─── VÌ SAO VẪN PHẢI CÓ HẠN GIỜ (dù đo thấy nhanh) ─────────────────────────────────────────
 * Lớp lỗi "một `await` KHÔNG resolve và KHÔNG reject" đã xảy ra THẬT ở đúng ngăn xếp này: khi
 * thiếu VRAM, `warmModel()` hỏng bên trong node-llama-cpp và `generateProgram()` treo vĩnh viễn
 * (đo bằng keep-alive: 300 s chưa settle — xem
 * `scripts/ai-eval/reports/codegen-coder30b-2026-08-16-INCOMPLETE.json`). Chỉ mục repo là ngữ
 * cảnh PHỤ TRỢ: thà sinh mã KHÔNG có nó còn hơn treo cả lượt sinh mã.
 *
 * ⚠ Khai thẳng giới hạn: hạn giờ này GIẢI PHÓNG người gọi chứ KHÔNG HUỶ được việc đang chạy dưới
 * (`retrieveKnowledge` không có đường huỷ); lượt nạp kia vẫn tiếp tục và sẽ ấm cache cho lần sau.
 * Nó chặn "treo", không chặn "tốn".
 * ⚠ Và một đính chính về CHÍNH THIẾT BỊ ĐO: bản nháp đầu của phép đo này báo "> 35 phút chưa
 * trả". SAI — đó là stdout của tiến trình nền bị đệm, không phải tiến trình treo. Chỉ khi ghi log
 * bằng `appendFileSync` mới thấy nó đã xong từ giây thứ 17.
 */
export const REPO_INDEX_DEFAULT_TIMEOUT_MS = 20_000;

function envBool(name: string, macDinh: boolean): boolean {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return macDinh;
  if (raw === "true" || raw === "1" || raw === "yes" || raw === "on") return true;
  if (raw === "false" || raw === "0" || raw === "no" || raw === "off") return false;
  return macDinh;
}

function envNum(name: string, macDinh: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? n : macDinh;
}

/** Cờ G2-A có đang BẬT không. Vị từ DUY NHẤT — mọi nơi khác phải gọi hàm này, không tự đọc env. */
export function repoIndexContextEnabled(): boolean {
  return envBool(REPO_INDEX_FLAG, REPO_INDEX_DEFAULT_ON);
}

export interface RepoIndexSnippet {
  sourcePath: string;
  text: string;
  score: number;
  /** true khi đoạn bị cắt bớt để vừa ngân sách. */
  truncated: boolean;
}

export type RepoIndexReason =
  /** có ít nhất một đoạn được chèn */
  | "ok"
  /** cờ tắt */
  | "flag-off"
  /** không còn token nào cho khối này (các phần ưu tiên cao hơn đã ăn hết) */
  | "no-budget"
  /** không có câu hỏi để truy hồi */
  | "no-query"
  /** truy hồi ra kết quả nhưng KHÔNG đoạn nào đạt ngưỡng liên quan */
  | "below-threshold"
  /** kho rỗng / truy hồi không trả gì */
  | "empty"
  /** truy hồi quá hạn giờ — xem `REPO_INDEX_DEFAULT_TIMEOUT_MS` */
  | "timeout";

export interface RepoIndexContextResult {
  /** Khối văn bản đã sẵn sàng chèn vào prompt. Chuỗi RỖNG khi không chèn gì. */
  block: string;
  /** Token ƯỚC LƯỢNG của `block` (0 khi rỗng) — dùng để trừ vào ngân sách chung. */
  tokens: number;
  snippets: RepoIndexSnippet[];
  reason: RepoIndexReason;
  /** Số đoạn truy hồi được TRƯỚC khi lọc ngưỡng — để log biết ngưỡng đang cắt bao nhiêu. */
  retrieved: number;
}

function ketQuaRong(reason: RepoIndexReason, retrieved = 0): RepoIndexContextResult {
  return { block: "", tokens: 0, snippets: [], reason, retrieved };
}

export interface GatherRepoIndexContextInput {
  /** Câu hỏi/ý định — thứ quyết định đoạn nào LIÊN QUAN. */
  query: string;
  /** Trần token cho toàn khối. ≤0 ⇒ không truy hồi (cổng RẺ, chặn trước cả lượt embed). */
  maxTokens?: number;
  topK?: number;
  minScore?: number;
  /** Vai RBAC thật của người gọi — xuyên xuống cổng corpus Studio của `retrieveKnowledge`. */
  callerRole?: string;
  /** Hạn giờ cho lượt truy hồi (ms). ≤0 = không đặt hạn. Xem `REPO_INDEX_DEFAULT_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** Seam cho test: thay hàm truy hồi (mặc định `gatherRepoContext`). */
  gather?: typeof gatherRepoContext;
}

/**
 * Cắt một đoạn văn bản cho vừa `maxTokens`, theo RANH GIỚI KÝ TỰ suy ra từ cùng hằng 2,8.
 * Trả nguyên văn khi đã vừa. Luôn gắn `REPO_INDEX_TRUNCATION_MARK` khi có cắt — một đoạn mã bị
 * cụt mà KHÔNG khai là cụt thì mô hình sẽ tưởng đó là toàn bộ sự thật.
 */
export function catTheoNganSachToken(
  text: string,
  maxTokens: number,
  /**
   * Giữ ĐẦU hay ĐUÔI khi phải cắt. Không có mặc định "đúng cho mọi chỗ": với một buffer đang soạn
   * dở (mode="complete") thì ĐUÔI là chỗ con trỏ đứng — cắt đuôi là vứt đúng thứ cần; với một
   * chương trình đem đi dịch/giải thích thì ĐẦU (khai báo biến, header) mới là thứ không bỏ được.
   */
  giu: "dau" | "cuoi" = "dau",
): { text: string; truncated: boolean } {
  const s = String(text ?? "");
  if (maxTokens <= 0) return { text: "", truncated: s.length > 0 };
  if (uocLuongSoToken(s) <= maxTokens) return { text: s, truncated: false };
  const markTokens = uocLuongSoToken(REPO_INDEX_TRUNCATION_MARK);
  const conLai = Math.max(0, maxTokens - markTokens);
  // 2,8 ký tự/token — nhân bằng SỐ NGUYÊN (×28/10) để không lệ thuộc dấu phẩy động, cùng lý do
  // như `uocLuongSoToken` (một cái thước không tất định đã làm repo này trả giá một lần).
  const soKyTu = Math.max(0, Math.floor((conLai * 28) / 10));
  if (soKyTu === 0) return { text: "", truncated: true };
  return giu === "cuoi"
    ? { text: REPO_INDEX_TRUNCATION_MARK + s.slice(s.length - soKyTu), truncated: true }
    : { text: s.slice(0, soKyTu) + REPO_INDEX_TRUNCATION_MARK, truncated: true };
}

/**
 * Truy hồi ngữ cảnh từ CHỈ MỤC REPO cho một câu hỏi, đã lọc theo ngưỡng liên quan và đã cắt cho
 * vừa ngân sách token. FAIL-SAFE tuyệt đối: mọi lỗi ⇒ kết quả rỗng, KHÔNG BAO GIỜ ném — một lượt
 * truy hồi hỏng không được phép làm mất một lượt sinh mã vốn vẫn chạy được mà không có nó.
 */
export async function gatherRepoIndexContext(
  input: GatherRepoIndexContextInput,
): Promise<RepoIndexContextResult> {
  if (!repoIndexContextEnabled()) return ketQuaRong("flag-off");

  const query = String(input?.query ?? "").trim();
  if (!query) return ketQuaRong("no-query");

  const maxTokens = Math.floor(input?.maxTokens ?? envNum("AI_COPILOT_REPO_INDEX_MAX_TOKENS", REPO_INDEX_DEFAULT_MAX_TOKENS));
  // Cổng RẺ TRƯỚC cổng TỐN: không đủ chỗ cho (tiêu đề + một mẩu có nghĩa) thì KHÔNG embed,
  // KHÔNG đọc đĩa, KHÔNG rerank — đi truy hồi rồi vứt là đốt tài nguyên cho một khối rỗng.
  const toiThieu = uocLuongSoToken(REPO_INDEX_BLOCK_HEADER) + REPO_INDEX_MIN_SNIPPET_TOKENS;
  if (maxTokens < toiThieu) return ketQuaRong("no-budget");

  const topK = Math.max(1, Math.floor(input?.topK ?? envNum("AI_COPILOT_REPO_INDEX_TOP_K", REPO_INDEX_DEFAULT_TOP_K)));
  const minScore = input?.minScore ?? envNum("AI_COPILOT_REPO_INDEX_MIN_SCORE", REPO_INDEX_DEFAULT_MIN_SCORE);

  const timeoutMs = Math.floor(input?.timeoutMs ?? envNum("AI_COPILOT_REPO_INDEX_TIMEOUT_MS", REPO_INDEX_DEFAULT_TIMEOUT_MS));

  let ragSnippets: RepoContextResult["ragSnippets"] = [];
  try {
    const gather = input?.gather ?? gatherRepoContext;
    const chay = gather({
      objective: query,
      includeRag: true,
      includeDependencies: false,
      ragTopK: topK,
      callerRole: input?.callerRole,
    });
    // Hạn giờ — xem `REPO_INDEX_DEFAULT_TIMEOUT_MS` về phép đo đứng sau con số này.
    // `unref()` để cái hẹn giờ KHÔNG tự nó giữ tiến trình sống (một script CLI kết thúc sớm hơn
    // hạn giờ vẫn phải thoát được; đó chính là lớp lỗi "harness treo" ở hướng ngược lại).
    const ctx = timeoutMs > 0
      ? await Promise.race([
          chay,
          new Promise<null>((resolve) => {
            const t = setTimeout(() => resolve(null), timeoutMs);
            (t as unknown as { unref?: () => void }).unref?.();
          }),
        ])
      : await chay;
    if (ctx === null) {
      console.warn(
        `[repoContextService] G2-A truy hồi chỉ mục repo QUÁ HẠN ${timeoutMs} ms — đi tiếp KHÔNG có ngữ cảnh repo ` +
          `(lượt sinh mã không bị treo; xem REPO_INDEX_DEFAULT_TIMEOUT_MS).`,
      );
      return ketQuaRong("timeout");
    }
    ragSnippets = ctx?.ragSnippets ?? [];
  } catch (e) {
    console.warn("[repoContextService] G2-A truy hồi chỉ mục repo hỏng (bỏ qua, không ảnh hưởng sinh mã):", (e as Error)?.message ?? e);
    return ketQuaRong("empty");
  }

  const retrieved = ragSnippets.length;
  if (retrieved === 0) return ketQuaRong("empty");

  // HAI cổng, không phải một (xem REPO_INDEX_SOURCE_PREFIXES về vì sao ngưỡng điểm chưa đủ):
  //   (1) VÙNG — chỉ mã nguồn, không phải tài liệu vận hành;
  //   (2) ĐIỂM — đủ liên quan tới chính câu hỏi này.
  const prefixes = process.env.AI_COPILOT_REPO_INDEX_PREFIXES
    ? process.env.AI_COPILOT_REPO_INDEX_PREFIXES.split(",").map((s) => s.trim()).filter(Boolean)
    : REPO_INDEX_SOURCE_PREFIXES;
  const lienQuan = ragSnippets
    .filter(
      (s) =>
        Number.isFinite(s?.score) &&
        s.score >= minScore &&
        typeof s?.text === "string" &&
        s.text.trim().length > 0 &&
        laDuongDanMaNguon(s?.sourcePath ?? "", prefixes),
    )
    .sort((a, b) => b.score - a.score);
  if (lienQuan.length === 0) return ketQuaRong("below-threshold", retrieved);

  // Đóng gói THEO THỨ HẠNG. Đoạn nào không vừa phần còn lại thì DỪNG (không nhảy cóc xuống đoạn
  // kém liên quan hơn chỉ vì nó ngắn — như thế thứ hạng mất nghĩa). NGOẠI LỆ: nếu ngay đoạn ĐẦU
  // đã không vừa thì cắt nó, vì "trả rỗng vì đoạn hạng 1 hơi dài" là hành vi tệ nhất có thể.
  const header = REPO_INDEX_BLOCK_HEADER;
  let conLai = maxTokens - uocLuongSoToken(header);
  const snippets: RepoIndexSnippet[] = [];
  const dong: string[] = [];

  for (const s of lienQuan) {
    const nhan = `[R${snippets.length + 1}] ${s.sourcePath} (score ${s.score.toFixed(3)})\n`;
    const chiPhiNhan = uocLuongSoToken(nhan);
    if (conLai - chiPhiNhan <= 0) break;
    const nganSachThan = conLai - chiPhiNhan;
    const vua = uocLuongSoToken(s.text) <= nganSachThan;
    if (!vua && snippets.length > 0) break;
    const { text, truncated } = vua ? { text: s.text, truncated: false } : catTheoNganSachToken(s.text, nganSachThan);
    if (!text) break;
    dong.push(nhan + text);
    snippets.push({ sourcePath: s.sourcePath, text, score: s.score, truncated });
    conLai -= chiPhiNhan + uocLuongSoToken(text);
  }

  if (snippets.length === 0) return ketQuaRong("no-budget", retrieved);

  const block = `${header}\n${dong.join("\n\n")}`;
  return { block, tokens: uocLuongSoToken(block), snippets, reason: "ok", retrieved };
}
