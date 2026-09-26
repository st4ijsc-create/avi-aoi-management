/**
 * Doc 34 · P2 — AI Local Tools: PROGRAMMING (Automation Programming Copilot) READ tools.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * These are the SAFE (read/check/lookup) half of the P2 tool set (§II.5, §III.3(f),
 * §5.2). None of them touches a device, mutates the DB, or writes a file:
 *
 *   1. retrieve_programming_kb  → vendor-manual RAG (aiProgrammingKnowledgeService)
 *   2. lookup_error_code        → RAG scoped to a servo/drive/PLC error/alarm code
 *   3. syntax_check_program     → programmingAdapter.validate  (lint; NO device)
 *   4. compile_program          → programmingAdapter.compile   (sandbox build token)
 *   5. simulate_program         → programmingAdapter.simulate  (kinematic/boolean sim)
 *   6. generate_program         → aiProgrammingCopilot.generateProgram (text only)
 *   7. calc                     → a SAFE arithmetic evaluator (NO eval / Function)
 *   8. read_project_file        → read a file CONFINED to the programming workspace
 *
 * SAFETY invariants (all mirror the sibling read-tool waves + §5.2):
 *   - `kind:'read'` with a declared `requiredPermission` that is ALSO enforced inside
 *     the handler via the shared `rbacGate` (fail-safe: a missing/invalid `__authCtx`
 *     OR a denied permission → a no-data "denied" result; NEVER throws, NEVER leaks).
 *     RBAC = machine_monitoring/canView (matches the programming pages / programmingRouter).
 *   - The adapter validate/compile/simulate methods are device-free by contract
 *     (programmingAdapter.ts header) — a build/sim NEVER deploys or runs on hardware.
 *   - `calc` parses a whitelisted arithmetic grammar by hand — there is NO `eval`,
 *     `Function`, or dynamic code execution anywhere in this file.
 *   - `read_project_file` is confined to PROG_WORKSPACE_DIR by the SINGLE shared door
 *     below — `confineTarget()` + `readConfined()` / `writeConfined()`. The write tool
 *     (writeHandlers/programmingFile.ts) goes through that SAME door; it has no disk
 *     access of its own (it imports neither `node:fs` nor `node:path`).
 *     The door rejects, in order: bad path SHAPE (absolute / `..` / NUL / escaping the
 *     root) BEFORE any disk I/O; then a target whose realpath leaves the root (symlink /
 *     NTFS directory junction); then a directory; then `nlink > 1` — an NTFS HARD LINK
 *     keeps its realpath INSIDE the root, so no path check can see it (Pha 5 N13;
 *     measured leak of 57 bytes before the fix). `isFile`/`nlink`/`size` are re-checked
 *     on the OPEN fd, so a stat-then-open swap cannot slip past.
 *
 * Self-registers on import (see index.ts → `import "./readToolsProgramming"`).
 * ════════════════════════════════════════════════════════════════════════════
 */

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { checkPermission } from "../../_core/accessControl";
import { searchProgrammingKb } from "../aiProgrammingKnowledgeService";
import { programmingRegistry, type ProgrammingKind } from "../programming/programmingAdapter";
import { registerTool, type Tool, type ToolResult, type ToolLang } from "./toolRegistry";

// ─── shared helpers (same shape as readToolsP2.ts / analyticsTools.ts) ────────

type Lang = ToolLang;

/** A render-friendly row the FE generic fallback can show as label: value. */
interface RenderRow {
  label: string;
  value: string;
}

const authCtxSchema = z
  .object({
    userId: z.number().int().positive(),
    role: z.string().min(1),
  })
  .strict();
type AuthCtx = z.infer<typeof authCtxSchema>;

function langOf(params: { lang?: unknown }): Lang {
  const l = params.lang;
  return l === "en" || l === "zh" ? l : "vi";
}

function w(lang: Lang, vi: string, en: string, zh: string): string {
  return lang === "en" ? en : lang === "zh" ? zh : vi;
}

const DENY_MSG: Record<Lang, () => string> = {
  vi: () => `Bạn không có quyền dùng công cụ lập trình (machine_monitoring). Vui lòng liên hệ quản trị viên.`,
  en: () => `You do not have permission to use the programming tools (machine_monitoring). Please contact an administrator.`,
  zh: () => `您无权使用编程工具（machine_monitoring）。请联系管理员。`,
};

/** Result type reused for every programming tool (generic action_result — no new
 *  ToolResultType union member added, keeping the shared registry file untouched). */
const RESULT_TYPE = "action_result" as const;

function deniedResult<T>(title: string, fallback: T, lang: Lang): ToolResult<T> {
  return { type: RESULT_TYPE, title, data: fallback, textSummary: DENY_MSG[lang](), note: "PERMISSION_DENIED" };
}

/**
 * RBAC gate shared by every programming READ tool. Returns null when ALLOWED;
 * otherwise a no-data "denied" ToolResult the handler returns as-is. FAIL-SAFE: a
 * missing/invalid `__authCtx` → DENY (never leaks repo/manual content — §III.3(f)).
 */
async function rbacGate<T>(rawAuthCtx: unknown, title: string, fallback: T, lang: Lang): Promise<ToolResult<T> | null> {
  const parsed = authCtxSchema.safeParse(rawAuthCtx);
  if (!parsed.success) return deniedResult(title, fallback, lang);
  const auth: AuthCtx = parsed.data;
  let allowed = false;
  try {
    allowed = await checkPermission(auth.userId, auth.role, "machine_monitoring", "canView");
  } catch {
    allowed = false; // fail-safe on any RBAC lookup error
  }
  if (!allowed) return deniedResult(title, fallback, lang);
  return null;
}

// ─── programming-kind ⇄ language token (mirrors LANG_OF in aiProgrammingCopilot) ─

/** Every ProgrammingKind (exhaustive — a compile check below fails if the union grows). */
const PROGRAMMING_KIND_VALUES = [
  "stub",
  "zmotion-basic",
  "gcode",
  "mitsubishi-engineering",
  "robot-tm",
  "iec61131-st",
  "iec61131-ld",
  "iec61131-pou",
  "ir-flow",
] as const;

// Compile-time exhaustiveness: if `ProgrammingKind` gains a member not listed above,
// this line stops compiling (Exclude<...> becomes a non-`never` type).
type _MissingKind = Exclude<ProgrammingKind, (typeof PROGRAMMING_KIND_VALUES)[number]>;
const _kindsAreExhaustive: _MissingKind extends never ? true : false = true;
void _kindsAreExhaustive;

const kindSchema = z.enum(PROGRAMMING_KIND_VALUES);

const KIND_LANGUAGE: Record<ProgrammingKind, string> = {
  stub: "text",
  "zmotion-basic": "basic",
  gcode: "gcode",
  "mitsubishi-engineering": "device",
  "robot-tm": "tmscript",
  "iec61131-st": "st",
  "iec61131-ld": "ld",
  "iec61131-pou": "pou-json",
  "ir-flow": "ir-json",
};

function languageForKind(kind: ProgrammingKind): string {
  return KIND_LANGUAGE[kind] ?? "text";
}

// ════════════════════════════════════════════════════════════════════════════
// Workspace-path confinement (also consumed by writeHandlers/programmingFile.ts)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Absolute root of the programming workspace (env PROG_WORKSPACE_DIR, read at call-time).
 *
 * ⚠⚠⚠ **KHÔNG export** (review, N-2). Nó từng export cùng `resolveWorkspacePath`, và **ghép hai cái
 * lại là dựng được một đường dẫn tuyệt đối CHƯA CHỨNG MINH** — đúng thứ mà "đổi kiểu" vừa dựng rào
 * để cấm. Tệ hơn: cặp ấy nằm **ngoài tầm cả hai lưới** (census chỉ quét `aiLocalTools/`, canary chỉ
 * thấy tool). Một cửa hậu không ai canh, mở sẵn, **0 người dùng**.
 */
function programmingWorkspaceRoot(): string {
  const raw = (process.env.PROG_WORKSPACE_DIR || "programming-workspace").trim() || "programming-workspace";
  return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(process.cwd(), raw);
}

export type WorkspaceRejectReason = "EMPTY" | "NUL" | "ABSOLUTE" | "TRAVERSAL" | "ESCAPE";

/**
 * ★★★ 2026-08-18 (doc 78 · PHA A) — **CỬA NÀY NAY NHẬN GỐC LÀM THAM SỐ.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO KHÔNG VIẾT CỬA THỨ HAI CHO HỘP CÁT REPO
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Doc 78 PHA A mở cho LLM tự chọn tệp để đọc **trong chính repo này**. Gốc khác
 * (`process.cwd()` thay vì `PROG_WORKSPACE_DIR`), nhưng **LUẬT thì y hệt**: hình dạng đường dẫn →
 * realpath của cha/target → thư mục? → `nlink > 1`? → rồi mọi byte đi qua `readConfined` trên
 * **chính fd**. Viết bản thứ hai của luật ấy là đúng lớp lỗi *"hai bản sao một vị từ"* mà cả
 * `programmingFileIo.census.test.ts` lẫn `authCtxInjection.test.ts` tồn tại để chặn — và bản sao
 * mới **chắc chắn** sẽ thiếu tầng fd (nó là tầng KHÔNG nhìn thấy được từ đường dẫn).
 *
 * ⇒ Gốc trở thành **tham số tường minh**; `confineTarget()` chỉ là bản ghim sẵn gốc workspace lập
 * trình. `readConfined`/`writeConfined` **không đổi một dòng** — chúng vốn làm việc trên
 * `ConfinedTarget` (đường dẫn tuyệt đối nằm trong `ABS_OF`, ngoài tầm với của mọi module khác).
 *
 * ⚠ Gốc là **tham số của MÃ SERVER**, không bao giờ của người dùng/LLM: nó được tính bởi
 * `repoSandbox.gocHopCat()` hoặc `programmingWorkspaceRoot()`, cả hai đều đọc env + `path.resolve`.
 * Một gốc TƯƠNG ĐỐI sẽ làm mọi phép so tiền tố mất nghĩa ⇒ `chuanHoaGoc()` ép tuyệt đối.
 */
function chuanHoaGoc(root: unknown): string {
  const raw = typeof root === "string" ? root.trim() : "";
  if (raw === "") return programmingWorkspaceRoot();
  return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(process.cwd(), raw);
}

/**
 * ★★★ Pha 5 Task 1 (review, M-1) — `"HARD_LINK"` **PHẢI phát biểu được ở CẢ HAI đường.**
 *
 * ⚠⚠ Vòng trước tôi **cố ý không** mở rộng kiểu này, với lý lẽ *"bên GHI không bao giờ sinh ra
 * `HARD_LINK`"*. Người review bác đúng: **việc bên ghi không sinh ra nó CHÍNH LÀ con bug** — và lý
 * lẽ ấy là chỗ duy nhất trong báo cáo **chủ động bảo vệ một lỗ hổng**. Ghi lại nguyên văn để lớp
 * lập luận này bị nhận ra ngay lần sau: *"bên kia không dùng"* **không bao giờ** là lý do giữ một
 * kiểu hẹp — nó là câu hỏi *"vì sao bên kia không dùng?"*.
 */
export type ConfinementRejectReason = WorkspaceRejectReason | "HARD_LINK";

/** Nội bộ, KHÔNG export — kết quả kiểm HÌNH DẠNG đường dẫn. Xem `confineTarget`. */
interface InternalResolution {
  ok: boolean;
  absPath?: string;
  /** POSIX-style path relative to the workspace root (present only when ok). */
  relPath?: string;
  reason?: WorkspaceRejectReason;
}

/**
 * Kiểm HÌNH DẠNG đường dẫn (rỗng / NUL / tuyệt đối / `..` / thoát root) — **trước mọi I/O đĩa**.
 * Đây là **tầng 1** của `confineTarget()`, không phải một cửa dùng được một mình: nó chỉ nói đường
 * dẫn *trông* hợp lệ, **chưa** nói gì về realpath hay `nlink`.
 */
function resolveInternal(inputPath: unknown, rootIn?: string): InternalResolution {
  if (typeof inputPath !== "string") return { ok: false, reason: "EMPTY" };
  const raw = inputPath.trim();
  if (raw === "") return { ok: false, reason: "EMPTY" };
  if (raw.includes("\0")) return { ok: false, reason: "NUL" };
  // Absolute (POSIX or Windows) or Windows drive-relative "C:foo".
  if (path.isAbsolute(raw) || /^[a-zA-Z]:/.test(raw)) return { ok: false, reason: "ABSOLUTE" };
  // Any explicit parent-dir segment, in either slash convention.
  const segs = raw.replace(/\\/g, "/").split("/");
  if (segs.some((s) => s === "..")) return { ok: false, reason: "TRAVERSAL" };
  /**
   * ★★★ 2026-08-18 — **SOI TỪNG ĐOẠN, KHÔNG SOI ĐẦU CHUỖI.** Tiền lệ ĐO ĐƯỢC cùng ngày ở
   * `server/routes/_uyQuyenAnh.ts:180`: bản đầu của bộ lọc ảnh chỉ soi `/^[A-Za-z]:/` trên **cả
   * chuỗi**, nên `uploads/C:/Windows/win.ini` đi lọt — sau khi cắt tiền tố, đoạn `C:` nằm ở GIỮA.
   *
   * ⚠ Đo lại trên chính máy này (`path.win32.resolve`): `resolve("D:\\repo", "sub/C:/Windows/win.ini")`
   * cho `D:\repo\sub\C:\Windows\win.ini` — `path.relative` vẫn ra `sub\C:\Windows\win.ini`, tức
   * **phép kiểm hình dạng CŨ CHO QUA**. Hôm nay nó không thành một lượt thoát thật vì NTFS coi `C:`
   * giữa đường là cú pháp ADS và `openSync` hỏng ⇒ rơi xuống `NOT_FOUND`. **"Hỏng ở tầng dưới" không
   * phải một hàng rào** — nó là một sự trùng hợp của nền tảng. Chặn ở đúng tầng phát biểu được.
   */
  if (segs.some((s) => /^[a-zA-Z]:/.test(s))) return { ok: false, reason: "ABSOLUTE" };

  const root = chuanHoaGoc(rootIn);
  const candidate = path.resolve(root, raw);
  const rel = path.relative(root, candidate);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return { ok: false, reason: "ESCAPE" };
  return { ok: true, absPath: candidate, relPath: rel.replace(/\\/g, "/") };
}

/**
 * Best-effort symlink hardening: re-verify that a path's REAL path (following symlinks/junctions)
 * is still inside the REAL workspace root. Returns true when safe or when realpath cannot be
 * resolved (target/root may not exist yet).
 * @param allowRootItself `true` cho THƯ MỤC CHA (bản thân root là cha hợp lệ), `false` cho TARGET.
 */
function realpathContained(absPath: string, allowRootItself: boolean, rootIn?: string): boolean {
  try {
    const realRoot = fs.realpathSync(chuanHoaGoc(rootIn));
    const realTarget = fs.realpathSync(absPath);
    const rel = path.relative(realRoot, realTarget);
    return rel === "" ? allowRootItself : !rel.startsWith("..") && !path.isAbsolute(rel);
  } catch {
    return true; // cannot resolve (not created yet) → the shape check already applied
  }
}

// ────────────────────────────────────────────────────────────────────────────
// ★★★ CỬA DUY NHẤT — mọi byte vào/ra thư mục làm việc đều qua đây
// ────────────────────────────────────────────────────────────────────────────

/**
 * Nhãn RIÊNG TƯ: `unique symbol` **không được export**, nên **không mã nào ngoài module này viết ra
 * được** một giá trị hợp kiểu `ConfinedTarget`. Đó là điểm mấu chốt của "đổi kiểu": câu
 * *"ghi vào một đường dẫn chưa chứng minh"* nay **không viết ra được**, chứ không phải "có thêm một
 * ca test canh nó".
 */
declare const PROVEN_CONFINED: unique symbol;

/** Một đích ĐÃ CHỨNG MINH nằm trong workspace. Chỉ `confineTarget()` tạo ra được. */
export interface ConfinedTarget {
  /** POSIX-style, tương đối với workspace root — an toàn để hiển thị. */
  readonly relPath: string;
  /** Đích đã tồn tại trên đĩa hay chưa (chưa tồn tại vẫn hợp lệ cho một lượt GHI). */
  readonly exists: boolean;
  readonly [PROVEN_CONFINED]: true;
}

/**
 * ⚠ Đường dẫn tuyệt đối **KHÔNG nằm trên kiểu** — nó ở đây, ngoài tầm với của mọi module khác.
 * Người gọi cầm `ConfinedTarget` vẫn **không** lấy được chuỗi đường dẫn để tự `fs.*`; họ buộc phải
 * dùng `readConfined()` / `writeConfined()`.
 */
const ABS_OF = new WeakMap<ConfinedTarget, string>();

export type ConfineOutcome =
  | { ok: true; target: ConfinedTarget }
  | { ok: false; kind: "PATH_REJECTED"; reason: ConfinementRejectReason }
  | { ok: false; kind: "NOT_A_FILE" };

/**
 * ★★★ Chứng minh một đường dẫn NGƯỜI DÙNG ĐƯA nằm trong workspace — **cho cả ĐỌC lẫn GHI**.
 *
 * Bốn tầng, theo đúng thứ tự (mã cụ thể hơn thắng trước):
 *   1. hình dạng đường dẫn (`resolveInternal`) — trước mọi I/O;
 *   2. đích **chưa tồn tại** ⇒ kiểm realpath của **THƯ MỤC CHA** (sẽ tạo file mới ở đó);
 *   3. đích **đã tồn tại** ⇒ kiểm realpath của **CHÍNH TARGET** — đóng bất đối xứng I-2: bên ghi
 *      trước đây chỉ kiểm thư mục cha, nên một **symlink FILE** trong một thư mục cha hợp lệ lọt
 *      qua đường ghi (sống trên Linux / Windows bật Developer Mode);
 *   4. thư mục ⇒ `NOT_A_FILE`; `nlink > 1` ⇒ `HARD_LINK`.
 *
 * ⚠ Đây là phép kiểm **theo đường dẫn**, nên nó là *sàng thô*. Phép kiểm **có thẩm quyền** nằm ở
 * `readConfined`/`writeConfined`, chạy trên **chính fd** sắp đọc/ghi (chống TOCTOU — xem ở đó).
 */
export function confineTarget(inputPath: unknown): ConfineOutcome {
  return confineTargetUnder(programmingWorkspaceRoot(), inputPath);
}

/**
 * ★★★ Cùng bốn tầng của `confineTarget`, nhưng gốc do NGƯỜI GỌI (mã server) khai — xem
 * `chuanHoaGoc`. Đây là mặt tiếp xúc mà **hộp cát repo** (doc 78 PHA A → `repoSandbox.ts`) và mọi
 * pha sau (B: chạy lệnh · C: ghi tệp) dùng lại; **không có cửa thứ hai ra đĩa trong nhóm tool này**
 * (`programmingFileIo.census.test.ts` cưỡng chế điều đó bằng AST trên cả thư mục).
 */
export function confineTargetUnder(root: string, inputPath: unknown): ConfineOutcome {
  const r = resolveInternal(inputPath, root);
  if (!r.ok || !r.absPath || !r.relPath) {
    return { ok: false, kind: "PATH_REJECTED", reason: r.reason ?? "EMPTY" };
  }
  const abs = r.absPath;

  let stat: fs.Stats | null = null;
  try {
    stat = fs.statSync(abs);
  } catch {
    stat = null; // chưa tồn tại (hoặc không stat được) → đích GHI mới
  }

  if (stat === null) {
    if (!realpathContained(path.dirname(abs), true, root)) {
      return { ok: false, kind: "PATH_REJECTED", reason: "ESCAPE" };
    }
  } else {
    if (!realpathContained(abs, false, root)) {
      return { ok: false, kind: "PATH_REJECTED", reason: "ESCAPE" };
    }
    if (!stat.isFile()) return { ok: false, kind: "NOT_A_FILE" };
    if (stat.nlink > 1) return { ok: false, kind: "PATH_REJECTED", reason: "HARD_LINK" };
  }

  const target = { relPath: r.relPath, exists: stat !== null } as ConfinedTarget;
  ABS_OF.set(target, abs);
  return { ok: true, target };
}

export type ConfinedReadOutcome =
  | { ok: true; content: string; size: number; truncated: boolean }
  | { ok: false; kind: "NOT_FOUND" }
  | { ok: false; kind: "NOT_A_FILE" }
  | { ok: false; kind: "PATH_REJECTED"; reason: ConfinementRejectReason }
  | { ok: false; kind: "READ_ERROR"; message: string };

/**
 * ★★★ ĐỌC — **lượt đọc file DUY NHẤT** của nhóm tool lập trình.
 *
 * ⚠⚠ I-1 (TOCTOU): bản trước `statSync(path)` rồi `openSync(path)` — **HAI lượt phân giải đường
 * dẫn**. Mô hình đe doạ của chính N13 đã cho kẻ tấn công quyền tạo file trong workspace, nên nó có
 * thể để `x.st` là file thường lúc `stat` và là hard link lúc `open` ⇒ đọc được bí mật với
 * `note=undefined`. Nay: **`open` TRƯỚC, rồi `fstat(fd)`** — `isFile`/`nlink`/`size` đều hỏi **chính
 * cái file sắp bị đọc**, cùng số syscall, **không còn cửa sổ đua**.
 */
export function readConfined(target: ConfinedTarget, maxBytes: number): ConfinedReadOutcome {
  const abs = ABS_OF.get(target);
  if (abs === undefined) return { ok: false, kind: "READ_ERROR", message: "unproven target" };
  let fd: number;
  try {
    fd = fs.openSync(abs, "r");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return { ok: false, kind: "NOT_FOUND" };
    if (code === "EISDIR") return { ok: false, kind: "NOT_A_FILE" };
    return { ok: false, kind: "READ_ERROR", message: code ?? String(err) };
  }
  try {
    // ⚠ Trên Windows `openSync` MỞ ĐƯỢC một thư mục (đo được) — nên `isFile()` phải hỏi trên fd.
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return { ok: false, kind: "NOT_A_FILE" };
    if (st.nlink > 1) return { ok: false, kind: "PATH_REJECTED", reason: "HARD_LINK" };
    const buf = Buffer.alloc(Math.min(st.size, maxBytes));
    const read = fs.readSync(fd, buf, 0, buf.length, 0);
    return { ok: true, content: buf.toString("utf8", 0, read), size: st.size, truncated: st.size > maxBytes };
  } catch (err) {
    // data-raw-ok: `kind: "READ_ERROR"` ĐÃ là mã máy-đọc-được; chuỗi kèm theo nói rõ tệp
    // nào/vì sao (EACCES, EISDIR…). Người đọc là kỹ sư đang dùng tác nhân lập trình.
    return { ok: false, kind: "READ_ERROR", message: err instanceof Error ? err.message : String(err) };
  } finally {
    fs.closeSync(fd);
  }
}

export type ConfinedWriteOutcome =
  | { ok: true; bytes: number }
  | { ok: false; kind: "NOT_A_FILE" }
  | { ok: false; kind: "PATH_REJECTED"; reason: ConfinementRejectReason }
  | { ok: false; kind: "WRITE_ERROR"; message: string };

/**
 * ★★★ GHI — **lượt ghi file DUY NHẤT** của nhóm tool lập trình.
 *
 * ⚠⚠ C-2 (review, Critical): bản trước `fs.writeFileSync` **không hỏi `nlink` một dòng nào** ⇒ ghi
 * đè xuyên hard link ra ngoài workspace **và trả `ok: true`** — đúng lớp *"làm hỏng rồi BÁO CÁO
 * THÀNH CÔNG"* đã là Critical của Pha 3.
 * ⚠ Mở bằng `O_RDWR | O_CREAT` (**KHÔNG** `O_TRUNC`): kiểm `nlink` trên **chính fd** *trước* khi cắt
 * một byte nào. Đích hợp lệ mới ⇒ tạo rỗng rồi ghi; đích là hard link ⇒ **từ chối khi file vẫn còn
 * NGUYÊN VẸN**. Đây là điểm khác biệt giữa "chặn" và "chặn sau khi đã phá".
 */
export function writeConfined(target: ConfinedTarget, content: string): ConfinedWriteOutcome {
  const abs = ABS_OF.get(target);
  if (abs === undefined) return { ok: false, kind: "WRITE_ERROR", message: "unproven target" };
  let fd: number;
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fd = fs.openSync(abs, fs.constants.O_RDWR | fs.constants.O_CREAT);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "EISDIR") return { ok: false, kind: "NOT_A_FILE" };
    // data-raw-ok: như trên — lỗi hệ thống tệp của công cụ đọc mã.
    return { ok: false, kind: "WRITE_ERROR", message: err instanceof Error ? err.message : String(err) };
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return { ok: false, kind: "NOT_A_FILE" };
    if (st.nlink > 1) return { ok: false, kind: "PATH_REJECTED", reason: "HARD_LINK" };
    const buf = Buffer.from(content, "utf8");
    fs.ftruncateSync(fd, 0);
    fs.writeSync(fd, buf, 0, buf.length, 0);
    return { ok: true, bytes: buf.length };
  } catch (err) {
    // data-raw-ok: như trên — lỗi hệ thống tệp của công cụ đọc mã.
    return { ok: false, kind: "WRITE_ERROR", message: err instanceof Error ? err.message : String(err) };
  } finally {
    fs.closeSync(fd);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// ★★★ 2026-08-18 (doc 78 · PHA A) — CỬA **LIỆT KÊ THƯ MỤC**, cùng bốn tầng, cùng module
// ────────────────────────────────────────────────────────────────────────────
/**
 * ⚠⚠ VÌ SAO NÓ Ở ĐÂY CHỨ KHÔNG Ở `repoSandbox.ts`: bất biến giữ cho cả cụm này an toàn là
 * *"đường dẫn TUYỆT ĐỐI không bao giờ rời module này"* (xem `ABS_OF` + `PROVEN_CONFINED`). Một hàm
 * liệt kê ở module khác buộc phải cầm chuỗi tuyệt đối để `readdirSync` — tức phá đúng bất biến ấy,
 * và mở lại con đường mà khối "KHÔNG export `programmingWorkspaceRoot`" (N-2) vừa đóng.
 *
 * ⚠ `readdirSync`/`statSync` **không** phải API chở byte, nên chúng nằm ngoài
 * `programmingFileIo.census.test.ts` một cách CÓ CHỦ Ý (bảng `API_CHO_BYTE` ở đó nói rõ vì sao):
 * chúng trả TÊN và KÍCH THƯỚC, không trả nội dung. Nội dung vẫn chỉ đi qua `readConfined`.
 */
declare const PROVEN_CONFINED_DIR: unique symbol;

/** Một THƯ MỤC đã chứng minh nằm trong gốc. Chỉ `confineDirUnder()` tạo ra được. */
export interface ConfinedDir {
  /** POSIX-style, tương đối với gốc; `""` nghĩa là chính gốc. */
  readonly relPath: string;
  readonly [PROVEN_CONFINED_DIR]: true;
}

const ABS_OF_DIR = new WeakMap<ConfinedDir, string>();

export type ConfineDirOutcome =
  | { ok: true; dir: ConfinedDir }
  | { ok: false; kind: "PATH_REJECTED"; reason: ConfinementRejectReason }
  | { ok: false; kind: "NOT_FOUND" }
  | { ok: false; kind: "NOT_A_DIRECTORY" };

/**
 * Chứng minh một THƯ MỤC do người dùng đưa nằm trong `root`.
 * `""`, `"."`, `"./"` ⇒ **chính gốc** (hợp lệ) — `resolveInternal` cố ý coi `rel === ""` là ESCAPE
 * vì với một FILE thì "chính gốc" là vô nghĩa; với một THƯ MỤC thì đó là ca thường gặp nhất.
 */
export function confineDirUnder(root: string, inputPath: unknown): ConfineDirOutcome {
  const raw = typeof inputPath === "string" ? inputPath.trim() : "";
  const laGoc = raw === "" || raw === "." || raw === "./" || raw === ".\\";

  let abs: string;
  let rel: string;
  if (laGoc) {
    abs = chuanHoaGoc(root);
    rel = "";
  } else {
    const r = resolveInternal(inputPath, root);
    if (!r.ok || !r.absPath || !r.relPath) {
      return { ok: false, kind: "PATH_REJECTED", reason: r.reason ?? "EMPTY" };
    }
    abs = r.absPath;
    rel = r.relPath;
  }

  let stat: fs.Stats | null = null;
  try {
    stat = fs.statSync(abs);
  } catch {
    return { ok: false, kind: "NOT_FOUND" };
  }
  // realpath TRƯỚC `isDirectory` — một junction trỏ RA NGOÀI vẫn là "thư mục".
  if (!realpathContained(abs, true, root)) return { ok: false, kind: "PATH_REJECTED", reason: "ESCAPE" };
  if (!stat.isDirectory()) return { ok: false, kind: "NOT_A_DIRECTORY" };

  const dir = { relPath: rel } as ConfinedDir;
  ABS_OF_DIR.set(dir, abs);
  return { ok: true, dir };
}

export interface ConfinedEntry {
  /** Tên trong thư mục cha. */
  readonly name: string;
  /** POSIX-style, tương đối với GỐC hộp cát — dùng thẳng lại được cho `confineTargetUnder`. */
  readonly relPath: string;
  /**
   * `"symlink"` là một loại RIÊNG, không gộp vào `file`/`dir`: `withFileTypes` dùng ngữ nghĩa
   * `lstat`, nên một symlink trỏ RA NGOÀI gốc vẫn hiện ra ở đây. Nó được **khai đúng bản chất** và
   * người gọi phải tự quyết; lượt ĐỌC sau đó vẫn phải qua `confineTargetUnder` (realpath) nên
   * không có đường nào lách.
   */
  readonly kind: "file" | "dir" | "symlink" | "other";
  readonly bytes: number | null;
}

/** Tách ra để kiểu `Dirent` được SUY RA (đời `@types/node` này để `Dirent` là kiểu tổng quát). */
function docThuMuc(abs: string) {
  return fs.readdirSync(abs, { withFileTypes: true });
}

/** Liệt kê MỘT nấc. Không đệ quy — người gọi tự quyết độ sâu và tự chịu trần của mình. */
export function listConfined(
  dir: ConfinedDir,
  max: number,
): { ok: true; entries: ConfinedEntry[]; truncated: boolean } | { ok: false; kind: "READ_ERROR"; message: string } {
  const abs = ABS_OF_DIR.get(dir);
  if (abs === undefined) return { ok: false, kind: "READ_ERROR", message: "unproven dir" };
  let raw: ReturnType<typeof docThuMuc>;
  try {
    raw = docThuMuc(abs);
  } catch (err) {
    return { ok: false, kind: "READ_ERROR", message: (err as NodeJS.ErrnoException)?.code ?? String(err) };
  }
  raw.sort((a, b) => a.name.localeCompare(b.name));
  const entries: ConfinedEntry[] = [];
  const gioiHan = Math.max(0, Math.floor(max));
  for (const e of raw) {
    if (entries.length >= gioiHan) return { ok: true, entries, truncated: true };
    const kind: ConfinedEntry["kind"] = e.isSymbolicLink()
      ? "symlink"
      : e.isDirectory()
        ? "dir"
        : e.isFile()
          ? "file"
          : "other";
    let bytes: number | null = null;
    if (kind === "file") {
      try {
        bytes = fs.statSync(path.join(abs, e.name)).size;
      } catch {
        bytes = null;
      }
    }
    entries.push({
      name: e.name,
      relPath: (dir.relPath ? `${dir.relPath}/` : "") + e.name,
      kind,
      bytes,
    });
  }
  return { ok: true, entries, truncated: false };
}

/**
 * ★★★ Pha 5 Task 1 (N13) — **CÂU TỪ CHỐI, MỘT BẢNG DUY NHẤT cho CẢ HAI đường.**
 *
 * ⚠ Bản trước có **hai bản sao giống nhau từng byte** (một ở đây, một ở `writeHandlers/
 * programmingFile.ts`), khác đúng một alias kiểu. Nay chỉ còn bản này; bên ghi **import** nó.
 *
 * ⚠ VÌ SAO `HARD_LINK` KHÔNG MƯỢN CÂU `ESCAPE`: câu ESCAPE nói *"đường dẫn thoát khỏi thư mục làm
 * việc"* — **SAI SỰ THẬT** ở lớp này. Đường dẫn **KHÔNG** thoát; `realpath` của hard link nằm gọn
 * trong workspace. Người vận hành đọc câu ESCAPE sẽ đi soi đường dẫn, **không thấy gì sai**, rồi
 * kết luận là báo động giả — tức lưới **chỉ đường tới bản vá sai**.
 * ⚠ Mã từ chối vẫn là `PATH_REJECTED` **y như cũ** — không đẻ mã mới; chỉ **câu chữ** nói đúng lý do.
 */
export function confinementRejectMsg(reason: ConfinementRejectReason, lang: Lang): string {
  switch (reason) {
    case "HARD_LINK":
      return w(
        lang,
        "File có nhiều liên kết cứng (hard link) nên nội dung của nó có thể nằm ngoài thư mục làm việc — bị từ chối. " +
          "Hãy chép nội dung thành một file thường trong thư mục làm việc rồi thao tác lại.",
        "This file has multiple hard links, so its content may live outside the workspace — rejected. " +
          "Copy it into the workspace as a regular file and try again.",
        "该文件存在多个硬链接，其内容可能位于工作区之外——已拒绝。请先将其复制为工作区内的普通文件再操作。",
      );
    case "ABSOLUTE":
      return w(lang, "Đường dẫn tuyệt đối không được phép.", "Absolute paths are not allowed.", "不允许使用绝对路径。");
    case "TRAVERSAL":
      return w(lang, "Đường dẫn chứa '..' (thoát thư mục) bị từ chối.", "Path contains '..' (traversal) — rejected.", "路径包含 '..'（越界）——已拒绝。");
    case "ESCAPE":
      return w(lang, "Đường dẫn thoát khỏi thư mục làm việc bị từ chối.", "Path escapes the workspace root — rejected.", "路径越出工作区根目录——已拒绝。");
    case "NUL":
      return w(lang, "Đường dẫn chứa ký tự NUL không hợp lệ.", "Path contains an invalid NUL byte.", "路径包含无效的 NUL 字符。");
    case "EMPTY":
    default:
      return w(lang, "Đường dẫn trống hoặc không hợp lệ.", "Empty or invalid path.", "路径为空或无效。");
  }
}

// ─── size caps ────────────────────────────────────────────────────────────────
const READ_FILE_MAX_BYTES = 256 * 1024; // hard cap on file read
const READ_FILE_SUMMARY_CHARS = 6000; // content injected into textSummary (LLM context)

// ════════════════════════════════════════════════════════════════════════════
// 1. retrieve_programming_kb — vendor-manual RAG (cited)
// ════════════════════════════════════════════════════════════════════════════

interface KbCitationOut {
  vendor: string;
  docTitle: string;
  page: number | null;
  section: string | null;
  score: number;
}
interface KbData {
  enabled: boolean;
  semanticUsed: boolean;
  count: number;
  citations: KbCitationOut[];
  rows: RenderRow[];
}

const retrieveKbParams = z
  .object({
    query: z.string().min(1).max(500),
    vendor: z.string().min(1).max(64).optional(),
    lang: z.string().min(1).max(16).optional(),
    topK: z.number().int().min(1).max(20).optional().default(8),
    __authCtx: authCtxSchema.optional(),
  })
  .strict();

const retrieveProgrammingKb: Tool<z.infer<typeof retrieveKbParams>, KbData> = {
  name: "retrieve_programming_kb",
  description:
    "Tra cứu tài liệu lập trình hãng (PLC/robot/motion manual) qua RAG có trích dẫn số trang. " +
    "Retrieve vendor programming-manual passages with page citations. READ-ONLY, RBAC machine_monitoring/canView.",
  parameters: retrieveKbParams,
  triggers: [
    "tra cứu tài liệu", "manual", "hướng dẫn lập trình", "tài liệu hãng", "cú pháp lệnh",
    "programming manual", "vendor manual", "how to program", "编程手册", "查手册",
  ],
  kind: "read",
  requiredPermission: { module: "machine_monitoring", action: "canView" },
  handler: async (params) => {
    const lang = langOf(params);
    const kbLang = params.lang && ["vi", "en", "zh"].includes(params.lang.toLowerCase()) ? params.lang.toLowerCase() : params.lang;
    const empty: KbData = { enabled: false, semanticUsed: false, count: 0, citations: [], rows: [] };
    const title = w(lang, "Tài liệu lập trình", "Programming manual", "编程手册");
    const denied = await rbacGate<KbData>((params as any).__authCtx, title, empty, lang);
    if (denied) return denied;

    const res = await searchProgrammingKb({ query: params.query, vendor: params.vendor, lang: kbLang, topK: params.topK });
    if (!res.enabled) {
      return { type: RESULT_TYPE, title, data: { ...empty, enabled: false }, textSummary: w(lang, "Cơ sở tri thức lập trình đang tắt (PROG_KB_ENABLED).", "Programming knowledge base is disabled (PROG_KB_ENABLED).", "编程知识库已禁用 (PROG_KB_ENABLED)。"), note: "PROG_KB_DISABLED" };
    }
    const citations: KbCitationOut[] = res.citations.map((c) => ({ vendor: c.vendor, docTitle: c.docTitle, page: c.page, section: c.section, score: c.score }));
    const rows: RenderRow[] = citations.map((c) => ({ label: `${c.docTitle} (${c.vendor}${c.page != null ? `, p.${c.page}` : ""})`, value: `score ${c.score}` }));
    const data: KbData = { enabled: true, semanticUsed: res.semanticUsed, count: citations.length, citations, rows };
    if (citations.length === 0) {
      return { type: RESULT_TYPE, title, data, textSummary: w(lang, `Không tìm thấy tài liệu khớp "${params.query}".`, `No manual passages matched "${params.query}".`, `未找到与 "${params.query}" 匹配的手册内容。`), note: "NOT_FOUND" };
    }
    // The cited answerContext IS the LLM-facing payload (numbered passages + page refs).
    return { type: RESULT_TYPE, title, data, textSummary: res.answerContext };
  },
};

// ════════════════════════════════════════════════════════════════════════════
// 2. lookup_error_code — RAG scoped to a servo/drive/PLC fault code
// ════════════════════════════════════════════════════════════════════════════

const lookupErrorParams = z
  .object({
    code: z.string().min(1).max(64),
    vendor: z.string().min(1).max(64).optional(),
    lang: z.string().min(1).max(16).optional(),
    __authCtx: authCtxSchema.optional(),
  })
  .strict();

const lookupErrorCode: Tool<z.infer<typeof lookupErrorParams>, KbData> = {
  name: "lookup_error_code",
  description:
    "Tra mã lỗi/cảnh báo servo·drive·PLC trong tài liệu hãng, trả về đoạn giải thích + trang. " +
    "Look up a servo/drive/PLC error/alarm code in the vendor manuals; returns the passage + page. READ-ONLY, RBAC machine_monitoring/canView.",
  parameters: lookupErrorParams,
  triggers: [
    "mã lỗi", "lỗi servo", "alarm", "error code", "báo lỗi", "mã cảnh báo",
    "fault code", "alarm code", "错误代码", "报警代码", "故障代码",
  ],
  kind: "read",
  requiredPermission: { module: "machine_monitoring", action: "canView" },
  handler: async (params) => {
    const lang = langOf(params);
    const kbLang = params.lang && ["vi", "en", "zh"].includes(params.lang.toLowerCase()) ? params.lang.toLowerCase() : params.lang;
    const empty: KbData = { enabled: false, semanticUsed: false, count: 0, citations: [], rows: [] };
    const title = w(lang, `Mã lỗi ${params.code}`, `Error code ${params.code}`, `错误代码 ${params.code}`);
    const denied = await rbacGate<KbData>((params as any).__authCtx, title, empty, lang);
    if (denied) return denied;

    // Scope the query to the code + fault vocabulary so the RAG hits the alarm tables.
    const query = `${params.code} error alarm fault code lỗi cảnh báo 报警 错误`;
    const res = await searchProgrammingKb({ query, vendor: params.vendor, lang: kbLang, topK: 5 });
    if (!res.enabled) {
      return { type: RESULT_TYPE, title, data: { ...empty }, textSummary: w(lang, "Cơ sở tri thức lập trình đang tắt (PROG_KB_ENABLED).", "Programming knowledge base is disabled (PROG_KB_ENABLED).", "编程知识库已禁用 (PROG_KB_ENABLED)。"), note: "PROG_KB_DISABLED" };
    }
    const citations: KbCitationOut[] = res.citations.map((c) => ({ vendor: c.vendor, docTitle: c.docTitle, page: c.page, section: c.section, score: c.score }));
    const rows: RenderRow[] = citations.map((c) => ({ label: `${c.docTitle} (${c.vendor}${c.page != null ? `, p.${c.page}` : ""})`, value: `score ${c.score}` }));
    const data: KbData = { enabled: true, semanticUsed: res.semanticUsed, count: citations.length, citations, rows };
    if (citations.length === 0) {
      return { type: RESULT_TYPE, title, data, textSummary: w(lang, `Không tìm thấy mã lỗi "${params.code}" trong tài liệu.`, `Error code "${params.code}" not found in the manuals.`, `手册中未找到错误代码 "${params.code}"。`), note: "NOT_FOUND" };
    }
    return { type: RESULT_TYPE, title, data, textSummary: res.answerContext };
  },
};

// ════════════════════════════════════════════════════════════════════════════
// 3–5. syntax_check / compile / simulate — programmingAdapter (device-free)
// ════════════════════════════════════════════════════════════════════════════

const kindCodeParams = z
  .object({
    kind: kindSchema,
    code: z.string().min(1).max(200_000),
    lang: z.enum(["vi", "en", "zh"]).optional(),
    __authCtx: authCtxSchema.optional(),
  })
  .strict();
type KindCodeParams = z.infer<typeof kindCodeParams>;

interface DiagnosticOut {
  severity: "error" | "warning" | "info";
  message: string;
  line?: number;
  col?: number;
}
interface SyntaxData {
  kind: string;
  ok: boolean;
  errorCount: number;
  warningCount: number;
  diagnostics: DiagnosticOut[];
  rows: RenderRow[];
}

function adapterUnavailable<T>(kind: ProgrammingKind, title: string, fallback: T, lang: Lang, note: string): ToolResult<T> {
  return {
    type: RESULT_TYPE,
    title,
    data: fallback,
    textSummary: w(lang, `Chưa có bộ điều hợp cho "${kind}".`, `No adapter available for "${kind}".`, `暂无 "${kind}" 的适配器。`),
    note,
  };
}

const syntaxCheckProgram: Tool<KindCodeParams, SyntaxData> = {
  name: "syntax_check_program",
  description:
    "Kiểm tra cú pháp (lint/parse) một chương trình qua programmingAdapter.validate — AN TOÀN, không chạm thiết bị. " +
    "Syntax-check a program via the programming adapter (no device). READ-ONLY, RBAC machine_monitoring/canView.",
  parameters: kindCodeParams,
  triggers: [
    "kiểm tra cú pháp", "syntax check", "lint", "validate program", "kiểm tra chương trình",
    "check syntax", "语法检查", "校验程序",
  ],
  kind: "read",
  requiredPermission: { module: "machine_monitoring", action: "canView" },
  handler: async (params) => {
    const lang = langOf(params);
    const empty: SyntaxData = { kind: params.kind, ok: false, errorCount: 0, warningCount: 0, diagnostics: [], rows: [] };
    const title = w(lang, "Kiểm tra cú pháp", "Syntax check", "语法检查");
    const denied = await rbacGate<SyntaxData>((params as any).__authCtx, title, empty, lang);
    if (denied) return denied;

    if (!programmingRegistry.isImplemented(params.kind)) return adapterUnavailable(params.kind, title, empty, lang, "ADAPTER_NOT_IMPLEMENTED");
    try {
      const adapter = programmingRegistry.getAdapter(params.kind);
      const v = await adapter.validate({ kind: params.kind, language: languageForKind(params.kind), content: params.code });
      const diagnostics: DiagnosticOut[] = v.diagnostics.map((d) => ({ severity: d.severity, message: d.message, line: d.line, col: d.col }));
      const errorCount = diagnostics.filter((d) => d.severity === "error").length;
      const warningCount = diagnostics.filter((d) => d.severity === "warning").length;
      const rows: RenderRow[] = diagnostics.slice(0, 20).map((d) => ({ label: `${d.severity}${d.line != null ? ` @${d.line}` : ""}`, value: d.message }));
      const data: SyntaxData = { kind: params.kind, ok: v.ok, errorCount, warningCount, diagnostics, rows };
      const summary = v.ok
        ? w(lang, `Cú pháp hợp lệ (${warningCount} cảnh báo).`, `Syntax OK (${warningCount} warning(s)).`, `语法有效（${warningCount} 个警告）。`)
        : w(lang, `Cú pháp KHÔNG hợp lệ: ${errorCount} lỗi, ${warningCount} cảnh báo.`, `Syntax INVALID: ${errorCount} error(s), ${warningCount} warning(s).`, `语法无效：${errorCount} 个错误，${warningCount} 个警告。`);
      const detail = diagnostics.slice(0, 8).map((d, i) => `${i + 1}. [${d.severity}]${d.line != null ? ` line ${d.line}` : ""} ${d.message}`).join("; ");
      return { type: RESULT_TYPE, title, data, textSummary: detail ? `${summary} ${detail}` : summary };
    } catch (err) {
      return adapterUnavailable(params.kind, title, empty, lang, "VALIDATE_ERROR");
    }
  },
};

interface CompileData {
  kind: string;
  ok: boolean;
  buildToken: string | null;
  bytes: number | null;
  errorCount: number;
  diagnostics: DiagnosticOut[];
  rows: RenderRow[];
}

const compileProgram: Tool<KindCodeParams, CompileData> = {
  name: "compile_program",
  description:
    "Biên dịch chương trình trong sandbox qua programmingAdapter.compile — trả build token/lỗi, KHÔNG BAO GIỜ nạp thiết bị. " +
    "Compile a program in a sandbox (returns a build token/errors; never deploys). READ-ONLY, RBAC machine_monitoring/canView.",
  parameters: kindCodeParams,
  triggers: [
    "biên dịch", "compile", "build program", "dịch chương trình", "编译程序", "构建",
  ],
  kind: "read",
  requiredPermission: { module: "machine_monitoring", action: "canView" },
  handler: async (params) => {
    const lang = langOf(params);
    const empty: CompileData = { kind: params.kind, ok: false, buildToken: null, bytes: null, errorCount: 0, diagnostics: [], rows: [] };
    const title = w(lang, "Biên dịch", "Compile", "编译");
    const denied = await rbacGate<CompileData>((params as any).__authCtx, title, empty, lang);
    if (denied) return denied;

    if (!programmingRegistry.isImplemented(params.kind)) return adapterUnavailable(params.kind, title, empty, lang, "ADAPTER_NOT_IMPLEMENTED");
    try {
      const adapter = programmingRegistry.getAdapter(params.kind);
      const b = await adapter.compile({ kind: params.kind, language: languageForKind(params.kind), content: params.code });
      const diagnostics: DiagnosticOut[] = b.diagnostics.map((d) => ({ severity: d.severity, message: d.message, line: d.line, col: d.col }));
      const errorCount = diagnostics.filter((d) => d.severity === "error").length;
      const rows: RenderRow[] = diagnostics.slice(0, 20).map((d) => ({ label: `${d.severity}${d.line != null ? ` @${d.line}` : ""}`, value: d.message }));
      const data: CompileData = { kind: params.kind, ok: b.ok, buildToken: b.outputRef ?? null, bytes: b.bytes ?? null, errorCount, diagnostics, rows };
      const summary = b.ok
        ? w(lang, `Biên dịch OK → token ${b.outputRef ?? "?"} (${b.bytes ?? 0} byte).`, `Compiled OK → token ${b.outputRef ?? "?"} (${b.bytes ?? 0} bytes).`, `编译成功 → 令牌 ${b.outputRef ?? "?"}（${b.bytes ?? 0} 字节）。`)
        : w(lang, `Biên dịch THẤT BẠI: ${errorCount} lỗi.`, `Compile FAILED: ${errorCount} error(s).`, `编译失败：${errorCount} 个错误。`);
      const detail = diagnostics.slice(0, 6).map((d, i) => `${i + 1}. [${d.severity}] ${d.message}`).join("; ");
      return { type: RESULT_TYPE, title, data, textSummary: detail ? `${summary} ${detail}` : summary };
    } catch (err) {
      return adapterUnavailable(params.kind, title, empty, lang, "COMPILE_ERROR");
    }
  },
};

interface SimStepOut {
  index: number;
  label: string;
  startMs: number;
  endMs: number;
}
interface SimData {
  kind: string;
  ok: boolean;
  supported: boolean;
  totalDurationMs: number;
  stepCount: number;
  warnings: string[];
  timeline: SimStepOut[];
  rows: RenderRow[];
}

const simulateProgram: Tool<KindCodeParams, SimData> = {
  name: "simulate_program",
  description:
    "Mô phỏng chương trình (động học/boolean, nơi hỗ trợ) qua programmingAdapter — AN TOÀN, không chạm thiết bị. " +
    "Simulate a program (kinematic/boolean where supported) via the adapter (no device). READ-ONLY, RBAC machine_monitoring/canView.",
  parameters: kindCodeParams,
  triggers: [
    "mô phỏng", "simulate", "chạy thử", "sim program", "mô phỏng chương trình", "仿真", "模拟运行",
  ],
  kind: "read",
  requiredPermission: { module: "machine_monitoring", action: "canView" },
  handler: async (params) => {
    const lang = langOf(params);
    const empty: SimData = { kind: params.kind, ok: false, supported: false, totalDurationMs: 0, stepCount: 0, warnings: [], timeline: [], rows: [] };
    const title = w(lang, "Mô phỏng chương trình", "Program simulation", "程序仿真");
    const denied = await rbacGate<SimData>((params as any).__authCtx, title, empty, lang);
    if (denied) return denied;

    if (!programmingRegistry.isImplemented(params.kind)) return adapterUnavailable(params.kind, title, empty, lang, "ADAPTER_NOT_IMPLEMENTED");
    try {
      const adapter = programmingRegistry.getAdapter(params.kind);
      if (typeof adapter.simulate !== "function") {
        return { type: RESULT_TYPE, title, data: empty, textSummary: w(lang, `Bộ điều hợp "${params.kind}" không hỗ trợ mô phỏng.`, `Adapter "${params.kind}" does not support simulation.`, `适配器 "${params.kind}" 不支持仿真。`), note: "SIMULATE_UNSUPPORTED" };
      }
      // Compile first to obtain a BuildResult, then simulate it (both device-free).
      const build = await adapter.compile({ kind: params.kind, language: languageForKind(params.kind), content: params.code });
      const sim = await adapter.simulate(build, {});
      const timeline: SimStepOut[] = sim.timeline.slice(0, 200).map((s) => ({ index: s.index, label: s.label, startMs: s.startMs, endMs: s.endMs }));
      const rows: RenderRow[] = timeline.slice(0, 20).map((s) => ({ label: `#${s.index} ${s.label}`, value: `${s.startMs}–${s.endMs} ms` }));
      const data: SimData = { kind: params.kind, ok: sim.ok, supported: true, totalDurationMs: sim.totalDurationMs, stepCount: sim.timeline.length, warnings: sim.warnings, timeline, rows };
      const summary = w(
        lang,
        `Mô phỏng ${sim.ok ? "OK" : "có cảnh báo"}: ${sim.timeline.length} bước, ~${sim.totalDurationMs} ms${sim.warnings.length ? ` (${sim.warnings.length} cảnh báo)` : ""}.`,
        `Simulation ${sim.ok ? "OK" : "with warnings"}: ${sim.timeline.length} step(s), ~${sim.totalDurationMs} ms${sim.warnings.length ? ` (${sim.warnings.length} warning(s))` : ""}.`,
        `仿真${sim.ok ? "成功" : "有警告"}：${sim.timeline.length} 步，约 ${sim.totalDurationMs} 毫秒${sim.warnings.length ? `（${sim.warnings.length} 个警告）` : ""}。`,
      );
      return { type: RESULT_TYPE, title, data, textSummary: summary };
    } catch (err) {
      return adapterUnavailable(params.kind, title, empty, lang, "SIMULATE_ERROR");
    }
  },
};

// ════════════════════════════════════════════════════════════════════════════
// 6. generate_program — aiProgrammingCopilot.generateProgram (text only)
// ════════════════════════════════════════════════════════════════════════════
// The copilot is authored by a CONCURRENT agent; import it DEFENSIVELY (dynamic +
// runtime typeof check) so this file type-checks and runs whether or not the
// `generateProgram` export exists yet. It produces text + validation + citations —
// it touches NO DB, NO device, NO files.

interface GenerateProgramInput {
  kind: string;
  request: string;
  mode?: string;
  vendor?: string;
  contextCode?: string;
  targetKind?: string;
}
interface GenerateProgramResult {
  ok: boolean;
  refused: boolean;
  reason?: string;
  kind: string;
  code?: string;
  validation?: unknown;
  citations?: unknown;
  explanation?: string;
  note?: string;
}
type GenerateProgramFn = (input: GenerateProgramInput) => Promise<GenerateProgramResult>;

async function resolveGenerateProgram(): Promise<GenerateProgramFn | null> {
  try {
    const mod = (await import("../programming/aiProgrammingCopilot")) as unknown as Record<string, unknown>;
    const fn = mod["generateProgram"];
    return typeof fn === "function" ? (fn as GenerateProgramFn) : null;
  } catch {
    return null;
  }
}

interface GenerateData {
  kind: string;
  ok: boolean;
  refused: boolean;
  code: string | null;
  explanation: string | null;
  validation: unknown;
  citations: unknown;
  rows: RenderRow[];
}

const generateParams = z
  .object({
    kind: kindSchema,
    request: z.string().min(1).max(4000),
    vendor: z.string().min(1).max(64).optional(),
    mode: z.string().min(1).max(32).optional(),
    lang: z.enum(["vi", "en", "zh"]).optional(),
    __authCtx: authCtxSchema.optional(),
  })
  .strict();

const generateProgramTool: Tool<z.infer<typeof generateParams>, GenerateData> = {
  name: "generate_program",
  description:
    "Sinh mã tự động hóa từ yêu cầu (đề xuất, có validate + trích dẫn) — AI CHỈ ĐỀ XUẤT, người duyệt & kiểm thử; " +
    "từ chối logic an toàn (E-stop/interlock/SIL); không nạp thiết bị. " +
    "Generate automation code from a request (proposal only; validated + cited). READ-ONLY, RBAC machine_monitoring/canView.",
  parameters: generateParams,
  triggers: [
    "sinh mã", "viết chương trình", "tạo chương trình", "generate program", "viết code plc",
    "write program", "code cho robot", "生成程序", "编写程序",
  ],
  kind: "read",
  requiredPermission: { module: "machine_monitoring", action: "canView" },
  handler: async (params) => {
    const lang = langOf(params);
    const empty: GenerateData = { kind: params.kind, ok: false, refused: false, code: null, explanation: null, validation: null, citations: null, rows: [] };
    const title = w(lang, "Sinh mã lập trình", "Generated program", "生成程序");
    const denied = await rbacGate<GenerateData>((params as any).__authCtx, title, empty, lang);
    if (denied) return denied;

    const generate = await resolveGenerateProgram();
    if (!generate) {
      return { type: RESULT_TYPE, title, data: empty, textSummary: w(lang, "Chức năng sinh mã chưa sẵn sàng.", "Program generation is not available yet.", "程序生成功能尚未就绪。"), note: "GENERATE_UNAVAILABLE" };
    }
    try {
      const res = await generate({ kind: params.kind, request: params.request, vendor: params.vendor, mode: params.mode });
      const data: GenerateData = {
        kind: res.kind ?? params.kind,
        ok: !!res.ok,
        refused: !!res.refused,
        code: res.code ?? null,
        explanation: res.explanation ?? null,
        validation: res.validation ?? null,
        citations: res.citations ?? null,
        rows: [],
      };
      if (res.refused) {
        return { type: RESULT_TYPE, title, data, textSummary: res.reason ?? w(lang, "Đã từ chối sinh mã (logic an toàn).", "Generation refused (safety logic).", "已拒绝生成（安全逻辑）。"), note: "REFUSED" };
      }
      const summaryParts: string[] = [];
      if (res.explanation) summaryParts.push(res.explanation);
      if (res.code) summaryParts.push("```\n" + res.code.slice(0, 4000) + "\n```");
      const textSummary = summaryParts.join("\n\n") || res.reason || w(lang, "Không sinh được mã.", "No program was generated.", "未生成程序。");
      return { type: RESULT_TYPE, title, data, textSummary, note: res.ok ? undefined : res.note ?? "GENERATE_FAILED" };
    } catch (err) {
      return { type: RESULT_TYPE, title, data: empty, textSummary: w(lang, "Sinh mã gặp lỗi.", "Program generation failed.", "程序生成出错。"), note: "GENERATE_ERROR" };
    }
  },
};

// ════════════════════════════════════════════════════════════════════════════
// 7. calc — SAFE arithmetic evaluator (NO eval / Function / dynamic code)
// ════════════════════════════════════════════════════════════════════════════

const MATH_FUNCS: Record<string, (...a: number[]) => number> = {
  abs: Math.abs, sqrt: Math.sqrt, cbrt: Math.cbrt,
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  log: Math.log, log2: Math.log2, log10: Math.log10, exp: Math.exp,
  floor: Math.floor, ceil: Math.ceil, round: Math.round, trunc: Math.trunc, sign: Math.sign,
  min: Math.min, max: Math.max, pow: Math.pow, hypot: Math.hypot,
};
const MATH_CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };

type CalcTok =
  | { t: "num"; v: number }
  | { t: "op"; v: string }
  | { t: "lp" }
  | { t: "rp" }
  | { t: "comma" }
  | { t: "id"; v: string };

function calcTokenize(s: string): CalcTok[] {
  const toks: CalcTok[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") { i++; continue; }
    const isDigit = ch >= "0" && ch <= "9";
    if (isDigit || (ch === "." && /\d/.test(s[i + 1] ?? ""))) {
      let j = i + 1;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      if (s[j] === "e" || s[j] === "E") {
        let k = j + 1;
        if (s[k] === "+" || s[k] === "-") k++;
        if (/\d/.test(s[k] ?? "")) { j = k + 1; while (j < s.length && /\d/.test(s[j])) j++; }
      }
      const num = Number(s.slice(i, j));
      if (!Number.isFinite(num)) throw new Error("invalid number");
      toks.push({ t: "num", v: num });
      i = j; continue;
    }
    if ("+-*/%^".includes(ch)) { toks.push({ t: "op", v: ch }); i++; continue; }
    if (ch === "(") { toks.push({ t: "lp" }); i++; continue; }
    if (ch === ")") { toks.push({ t: "rp" }); i++; continue; }
    if (ch === ",") { toks.push({ t: "comma" }); i++; continue; }
    if (/[a-zA-Z_]/.test(ch)) {
      let j = i + 1;
      while (j < s.length && /[a-zA-Z0-9_]/.test(s[j])) j++;
      toks.push({ t: "id", v: s.slice(i, j).toLowerCase() });
      i = j; continue;
    }
    throw new Error(`illegal character '${ch}'`);
  }
  return toks;
}

/** Evaluate a whitelisted arithmetic expression. Throws on anything non-arithmetic. */
export function evaluateArithmetic(expr: string): number {
  if (typeof expr !== "string") throw new Error("expression must be a string");
  if (expr.length > 400) throw new Error("expression too long");
  const toks = calcTokenize(expr);
  if (toks.length === 0) throw new Error("empty expression");
  let pos = 0;
  const peek = (): CalcTok | undefined => toks[pos];
  const next = (): CalcTok => toks[pos++];
  const expect = (t: CalcTok["t"]): void => {
    const tk = toks[pos];
    if (!tk || tk.t !== t) throw new Error(`expected '${t}'`);
    pos++;
  };

  function parseExpr(): number {
    let val = parseTerm();
    for (;;) {
      const tk = peek();
      if (tk && tk.t === "op" && (tk.v === "+" || tk.v === "-")) { next(); const r = parseTerm(); val = tk.v === "+" ? val + r : val - r; }
      else break;
    }
    return val;
  }
  function parseTerm(): number {
    let val = parsePower();
    for (;;) {
      const tk = peek();
      if (tk && tk.t === "op" && (tk.v === "*" || tk.v === "/" || tk.v === "%")) { next(); const r = parsePower(); val = tk.v === "*" ? val * r : tk.v === "/" ? val / r : val % r; }
      else break;
    }
    return val;
  }
  function parsePower(): number {
    const base = parseUnary();
    const tk = peek();
    if (tk && tk.t === "op" && tk.v === "^") { next(); const exp = parsePower(); return Math.pow(base, exp); }
    return base;
  }
  function parseUnary(): number {
    const tk = peek();
    if (tk && tk.t === "op" && (tk.v === "+" || tk.v === "-")) { next(); const v = parseUnary(); return tk.v === "-" ? -v : v; }
    return parsePrimary();
  }
  function parsePrimary(): number {
    const tk = peek();
    if (!tk) throw new Error("unexpected end of expression");
    if (tk.t === "num") { next(); return tk.v; }
    if (tk.t === "lp") { next(); const v = parseExpr(); expect("rp"); return v; }
    if (tk.t === "id") {
      next();
      const name = tk.v;
      const after = peek();
      if (after && after.t === "lp") {
        // hasOwnProperty guard → an inherited name like "constructor"/"toString"
        // can NEVER resolve to a callable (no prototype-chain escape).
        const fn = Object.prototype.hasOwnProperty.call(MATH_FUNCS, name) ? MATH_FUNCS[name] : undefined;
        if (typeof fn !== "function") throw new Error(`unknown function '${name}'`);
        next(); // consume '('
        const args: number[] = [];
        if (!(peek() && peek()!.t === "rp")) {
          args.push(parseExpr());
          while (peek() && peek()!.t === "comma") { next(); args.push(parseExpr()); }
        }
        expect("rp");
        return fn(...args);
      }
      if (Object.prototype.hasOwnProperty.call(MATH_CONSTS, name)) return MATH_CONSTS[name];
      throw new Error(`unknown identifier '${name}'`);
    }
    throw new Error("unexpected token");
  }

  const result = parseExpr();
  if (pos !== toks.length) throw new Error("unexpected trailing tokens");
  if (!Number.isFinite(result)) throw new Error("result is not a finite number");
  return result;
}

interface CalcData {
  expression: string;
  value: number | null;
  error: string | null;
}

const calcParams = z
  .object({
    expression: z.string().min(1).max(400),
    lang: z.enum(["vi", "en", "zh"]).optional(),
    __authCtx: authCtxSchema.optional(),
  })
  .strict();

const calcTool: Tool<z.infer<typeof calcParams>, CalcData> = {
  name: "calc",
  description:
    "Tính một biểu thức số học AN TOÀN (số, + - * / % ^, ngoặc, hàm Math cơ bản) cho cycle-time/tốc độ/đổi đơn vị. " +
    "KHÔNG dùng eval — chỉ số học được whitelist. Evaluate a safe arithmetic expression. READ-ONLY, RBAC machine_monitoring/canView.",
  parameters: calcParams,
  triggers: [
    "tính", "tính toán", "calc", "calculate", "bằng bao nhiêu", "cycle time", "đổi đơn vị", "计算",
  ],
  kind: "read",
  requiredPermission: { module: "machine_monitoring", action: "canView" },
  handler: async (params) => {
    const lang = langOf(params);
    const title = w(lang, "Máy tính", "Calculator", "计算器");
    const empty: CalcData = { expression: params.expression, value: null, error: null };
    const denied = await rbacGate<CalcData>((params as any).__authCtx, title, empty, lang);
    if (denied) return denied;

    try {
      const value = evaluateArithmetic(params.expression);
      return { type: RESULT_TYPE, title, data: { expression: params.expression, value, error: null }, textSummary: `${params.expression} = ${value}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        type: RESULT_TYPE,
        title,
        data: { expression: params.expression, value: null, error: msg },
        textSummary: w(lang, `Biểu thức không hợp lệ: ${msg}`, `Invalid expression: ${msg}`, `表达式无效：${msg}`),
        note: "INVALID_EXPRESSION",
      };
    }
  },
};

// ════════════════════════════════════════════════════════════════════════════
// 8. read_project_file — read a file CONFINED to the programming workspace
// ════════════════════════════════════════════════════════════════════════════

interface FileReadData {
  path: string | null;
  bytes: number | null;
  truncated: boolean;
  content: string | null;
}

const readFileParams = z
  .object({
    path: z.string().min(1).max(1024),
    lang: z.enum(["vi", "en", "zh"]).optional(),
    __authCtx: authCtxSchema.optional(),
  })
  .strict();

const readProjectFile: Tool<z.infer<typeof readFileParams>, FileReadData> = {
  name: "read_project_file",
  description:
    "Đọc một file NẰM TRONG thư mục làm việc lập trình (PROG_WORKSPACE_DIR). Từ chối đường dẫn tuyệt đối/'..'/thoát thư mục, " +
    "và từ chối cả file có liên kết cứng (hard link) vì nội dung của nó có thể nằm ngoài thư mục làm việc. " +
    "Read a file confined to the programming workspace root; hard-linked files are refused too. READ-ONLY, RBAC machine_monitoring/canView.",
  parameters: readFileParams,
  triggers: [
    "đọc file", "mở file", "xem file", "read file", "open file", "nội dung file", "读取文件", "打开文件",
  ],
  kind: "read",
  requiredPermission: { module: "machine_monitoring", action: "canView" },
  handler: async (params) => {
    const lang = langOf(params);
    const title = w(lang, "Đọc file dự án", "Read project file", "读取项目文件");
    const empty: FileReadData = { path: null, bytes: null, truncated: false, content: null };
    const denied = await rbacGate<FileReadData>((params as any).__authCtx, title, empty, lang);
    if (denied) return denied;

    const notAFile = (): ToolResult<FileReadData> => ({
      type: RESULT_TYPE, title, data: empty,
      textSummary: w(lang, "Đường dẫn không phải một file.", "Path is not a file.", "路径不是文件。"), note: "NOT_A_FILE",
    });
    const notFound = (): ToolResult<FileReadData> => ({
      type: RESULT_TYPE, title, data: empty,
      textSummary: w(lang, `Không tìm thấy file "${params.path}".`, `File "${params.path}" not found.`, `未找到文件 "${params.path}"。`), note: "NOT_FOUND",
    });
    const rejected = (reason: ConfinementRejectReason): ToolResult<FileReadData> => ({
      type: RESULT_TYPE, title, data: empty, textSummary: confinementRejectMsg(reason, lang), note: "PATH_REJECTED",
    });

    // ★★★ CỬA DUY NHẤT. Không còn `absPath` trần, không còn phép kiểm tự bịa tại chỗ.
    const confined = confineTarget(params.path);
    if (!confined.ok) return confined.kind === "NOT_A_FILE" ? notAFile() : rejected(confined.reason);

    const rd = readConfined(confined.target, READ_FILE_MAX_BYTES);
    if (!rd.ok) {
      if (rd.kind === "NOT_FOUND") return notFound();
      if (rd.kind === "NOT_A_FILE") return notAFile();
      if (rd.kind === "PATH_REJECTED") return rejected(rd.reason);
      return { type: RESULT_TYPE, title, data: empty, textSummary: w(lang, "Không đọc được file.", "Could not read the file.", "无法读取文件。"), note: "READ_ERROR" };
    }

    const data: FileReadData = { path: confined.target.relPath, bytes: rd.size, truncated: rd.truncated, content: rd.content };
    const header = w(
      lang,
      `Đọc "${data.path}" (${rd.size} byte${rd.truncated ? ", đã cắt bớt" : ""}):`,
      `Read "${data.path}" (${rd.size} bytes${rd.truncated ? ", truncated" : ""}):`,
      `已读取 "${data.path}"（${rd.size} 字节${rd.truncated ? "，已截断" : ""}）：`,
    );
    const body = rd.content.length > READ_FILE_SUMMARY_CHARS ? `${rd.content.slice(0, READ_FILE_SUMMARY_CHARS)}\n…` : rd.content;
    return { type: RESULT_TYPE, title, data, textSummary: `${header}\n${body}` };
  },
};

// ─── register (idempotent guard, mirrors readToolsP2) ─────────────────────────

let _registeredProgRead = false;
export function registerProgrammingReadTools(): void {
  if (_registeredProgRead) return;
  _registeredProgRead = true;
  registerTool(retrieveProgrammingKb);
  registerTool(lookupErrorCode);
  registerTool(syntaxCheckProgram);
  registerTool(compileProgram);
  registerTool(simulateProgram);
  registerTool(generateProgramTool);
  registerTool(calcTool);
  registerTool(readProjectFile);
}

registerProgrammingReadTools();

export {
  retrieveProgrammingKb,
  lookupErrorCode,
  syntaxCheckProgram,
  compileProgram,
  simulateProgram,
  generateProgramTool,
  calcTool,
  readProjectFile,
};
