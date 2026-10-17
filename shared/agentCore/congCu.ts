/**
 * shared/agentCore — bộ tool v1 (schema OpenAI function, tên + mô tả tiếng Anh cho model), kiểm/chuẩn hoá tham số,
 * và `apDungEdits` (phép vá thuần của `edit_file`). Thiết kế: spec Đợt 1 §3; bốn tool ngữ cảnh/trí nhớ của Đợt 2
 * (`find_symbol`, `search_code`, `search_docs`, `remember`): spec `2026-10-17-ai-local-dot2-ngu-canh-tri-nho-design.md` §2.
 *
 * Ràng buộc grammar llama.cpp (xem `timGioiHanGrammar` trong server/services/ai/nativeToolCalls.ts): schema KHÔNG có
 * `pattern`, KHÔNG `maxLength > 1999`. Lưới `congCu.test.ts` chạy chính bộ kiểm đó trên `CONG_CU`.
 */
import type { CheDoAgent, LoiGoiTool, WireTool } from "./kieu";

/**
 * `de-xuat` (Đợt 2): tool KHÔNG tác dụng phụ nào ngoài một ĐỀ XUẤT cho người (`remember` ⇒ sự kiện `de-xuat-nho`).
 * Tách khỏi `ghi` vì nó phải có ở MỌI chế độ (kể cả `hoi`): chỉ người bấm "Nhớ" mới ghi — kể cả ở `tu-dong`.
 */
export type LoaiCongCu = "doc" | "ghi" | "lenh" | "ke-hoach" | "de-xuat";

export const TEN_CONG_CU = [
  "read_file",
  "list_dir",
  "find_files",
  "grep",
  "edit_file",
  "write_file",
  "delete_file",
  "rename_file",
  "run_command",
  "todo_write",
  // ── Đợt 2 ──
  "find_symbol",
  "search_code",
  "search_docs",
  "remember",
] as const;
export type TenCongCu = (typeof TEN_CONG_CU)[number];

export const LOAI_CONG_CU: Record<TenCongCu, LoaiCongCu> = {
  read_file: "doc",
  list_dir: "doc",
  find_files: "doc",
  grep: "doc",
  edit_file: "ghi",
  write_file: "ghi",
  delete_file: "ghi",
  rename_file: "ghi",
  run_command: "lenh",
  todo_write: "ke-hoach",
  find_symbol: "doc",
  search_code: "doc",
  search_docs: "doc",
  remember: "de-xuat",
};

/** Loại ký hiệu `find_symbol` nhận (enum — model chọn sai ⇒ lỗi liệt kê giá trị đúng). */
export const LOAI_KY_HIEU = ["function", "class", "method", "interface", "type", "enum", "variable"] as const;
/** Kho tài liệu `search_docs`: tất cả · tài liệu hãng (PLC/robot…) · kho Training Studio · tham chiếu API (api-ref). */
export const KHO_TAI_LIEU = ["all", "vendor", "studio", "api"] as const;
export const PHAM_VI_NHO = ["project", "user"] as const;
/** Trần một ghi chú `remember` — BẰNG `GIOI_HAN_BAI_HOC.KY_TU_MOI_BAI` (shared/aiCodingLesson.ts; lõi thuần nên chép số). */
export const TRAN_KY_TU_NHO = 400;
/** Trần `k` của `search_code`. */
export const TRAN_K_TIM_MA = 20;

const chuoi = (description: string) => ({ type: "string", description });
const soNguyen = (description: string) => ({ type: "integer", minimum: 1, description });

function tool(name: TenCongCu, description: string, properties: Record<string, unknown>, required: string[]): WireTool {
  return { type: "function", function: { name, description, parameters: { type: "object", properties, required } } };
}

export const CONG_CU: WireTool[] = [
  tool(
    "read_file",
    "Read a text file of the project. Returns numbered lines. Use start_line/end_line for large files.",
    {
      path: chuoi("File path relative to the project root, using '/'."),
      start_line: soNguyen("First line to read (1-based, optional)."),
      end_line: soNguyen("Last line to read (inclusive, optional)."),
    },
    ["path"],
  ),
  tool("list_dir", "List the entries of a directory of the project.", { path: chuoi("Directory path relative to the project root; '.' for the root.") }, [
    "path",
  ]),
  tool(
    "find_files",
    "Find files whose name or path matches a glob pattern (e.g. '**/*.test.ts'). At most 200 results.",
    { pattern: chuoi("Glob pattern over file paths relative to the project root.") },
    ["pattern"],
  ),
  tool(
    "grep",
    "Search file contents with a regular expression. Returns matching lines with file path and line number.",
    {
      pattern: chuoi("Regular expression to search for."),
      path: chuoi("Directory or file to search in (optional, default: project root)."),
      include: chuoi("Glob filter on file names, e.g. '*.ts' (optional)."),
    },
    ["pattern"],
  ),
  tool(
    "edit_file",
    "Edit an existing file by exact string replacement. Each old_string must match the current file text exactly " +
      "(including whitespace) and appear exactly once unless replace_all is true. Edits are applied in order. Read the file first.",
    {
      path: chuoi("File path relative to the project root."),
      edits: {
        type: "array",
        description: "Replacements applied in order.",
        items: {
          type: "object",
          properties: {
            old_string: chuoi("Exact text to replace (copy it from read_file output, without line numbers)."),
            new_string: chuoi("Replacement text."),
            replace_all: { type: "boolean", description: "Replace every occurrence (default false)." },
          },
          required: ["old_string", "new_string"],
        },
      },
    },
    ["path", "edits"],
  ),
  tool(
    "write_file",
    "Create a new file, or overwrite an existing file with the full new content. Prefer edit_file for small changes.",
    { path: chuoi("File path relative to the project root."), content: chuoi("The complete file content.") },
    ["path", "content"],
  ),
  tool("delete_file", "Delete a file of the project.", { path: chuoi("File path relative to the project root.") }, ["path"]),
  tool(
    "rename_file",
    "Rename or move a file. The destination must not exist.",
    { from: chuoi("Current path relative to the project root."), to: chuoi("New path relative to the project root.") },
    ["from", "to"],
  ),
  tool(
    "run_command",
    "Run an allowed command (build, test, lint) in the project root and return its output and exit code.",
    { command: chuoi("The command line, e.g. 'npm test'. Must be in the project's allowed command list.") },
    ["command"],
  ),
  tool(
    "todo_write",
    "Write the task plan (the full list each time). Use it for any task with 3 or more steps and keep statuses up to date.",
    {
      todos: {
        type: "array",
        items: {
          type: "object",
          properties: {
            content: chuoi("What to do."),
            status: { type: "string", enum: ["pending", "in_progress", "completed"] },
          },
          required: ["content", "status"],
        },
      },
    },
    ["todos"],
  ),
  // ── Đợt 2: ngữ cảnh + trí nhớ ── (⚠ không `pattern`, không `maxLength` — trần kiểm ở `kiemThamSo`, lỗi nói rõ)
  tool(
    "find_symbol",
    "Find where a symbol (function, class, method, interface, type, enum, variable) is defined in the project — file:line and " +
      "signature — plus a limited list of references (whole-word matches). Faster and more precise than grep for 'where is X " +
      "defined / used'.",
    {
      name: chuoi("Exact symbol name, e.g. 'chayVongAgent' or 'UserService' (no regex)."),
      kind: { type: "string", enum: [...LOAI_KY_HIEU], description: "Optional kind filter." },
    },
    ["name"],
  ),
  tool(
    "search_code",
    "Semantic search over the code of the CURRENT project: describe what the code does (meaning, not exact text), e.g. " +
      "'where is the retry logic for HTTP calls'. Returns real code snippets with file:line.",
    {
      query: chuoi("Natural-language description of the code you are looking for."),
      k: {
        type: "integer",
        minimum: 1,
        maximum: TRAN_K_TIM_MA,
        description: `Number of snippets (optional, default 8, at most ${TRAN_K_TIM_MA}).`,
      },
    },
    ["query"],
  ),
  tool(
    "search_docs",
    "Search reference documentation: vendor programming manuals (PLC, robots…), documents the user uploaded to the training " +
      "studio, and API references. Returns excerpts with their source. Says so plainly when nothing relevant is found.",
    {
      query: chuoi("What you need to know, e.g. 'Mitsubishi MC protocol read D registers' or 'SqlDataReader namespace'."),
      corpus: { type: "string", enum: [...KHO_TAI_LIEU], description: "Which documentation to search (optional, default 'all')." },
    },
    ["query"],
  ),
  tool(
    "remember",
    `Propose a short durable note to remember for future sessions (a project convention or a user preference), at most ` +
      `${TRAN_KY_TU_NHO} characters. Nothing is saved now: the user sees the proposal and it is saved only if they approve it.`,
    {
      note: chuoi(`The fact to remember, one or two sentences, at most ${TRAN_KY_TU_NHO} characters.`),
      scope: {
        type: "string",
        enum: [...PHAM_VI_NHO],
        description: "'project' (default): about this project; 'user': a personal preference of the user.",
      },
    },
    ["note"],
  ),
];

/**
 * Bộ tool phơi cho model theo chế độ: `hoi` = đọc (kể cả 3 tool tìm của Đợt 2) + todo_write + remember (chỉ là đề
 * xuất); `sua`/`tu-dong` = đủ 14. Trả BẢN SAO sâu.
 */
export function congCuTheoCheDo(cheDo: CheDoAgent): WireTool[] {
  const chon =
    cheDo === "hoi"
      ? CONG_CU.filter((t) => {
          const loai = LOAI_CONG_CU[t.function.name as TenCongCu];
          return loai === "doc" || loai === "ke-hoach" || loai === "de-xuat";
        })
      : CONG_CU;
  return structuredClone(chon);
}

export const CONG_CU_TODO_WRITE: WireTool = CONG_CU.find((t) => t.function.name === "todo_write")!;

// ─── Kiểm / chuẩn hoá tham số ─────────────────────────────────────────────────────────────────

export type KetQuaKiemThamSo = { ok: true; thamSo: Record<string, unknown> } | { ok: false; loiChoModel: string };

type KieuTruong = "duong" | "chuoi" | "chuoiRong" | "so" | "edits" | "todos" | "enum";
/** `giaTri`: tập hợp lệ của `enum` · `toiDa`: trần ký tự (`chuoi`) hoặc trần giá trị (`so`). */
type MotDacTa = { kieu: KieuTruong; batBuoc: boolean; giaTri?: readonly string[]; toiDa?: number };
type DacTa = Record<string, MotDacTa>;

const B = (kieu: KieuTruong, them: Partial<MotDacTa> = {}): MotDacTa => ({ kieu, batBuoc: true, ...them });
const T = (kieu: KieuTruong, them: Partial<MotDacTa> = {}): MotDacTa => ({ kieu, batBuoc: false, ...them });

const DAC_TA: Record<TenCongCu, DacTa> = {
  read_file: { path: B("duong"), start_line: T("so"), end_line: T("so") },
  list_dir: { path: B("duong") },
  find_files: { pattern: B("chuoi") },
  grep: { pattern: B("chuoi"), path: T("duong"), include: T("chuoi") },
  edit_file: { path: B("duong"), edits: B("edits") },
  write_file: { path: B("duong"), content: B("chuoiRong") },
  delete_file: { path: B("duong") },
  rename_file: { from: B("duong"), to: B("duong") },
  run_command: { command: B("chuoi") },
  todo_write: { todos: B("todos") },
  find_symbol: { name: B("chuoi"), kind: T("enum", { giaTri: LOAI_KY_HIEU }) },
  search_code: { query: B("chuoi"), k: T("so", { toiDa: TRAN_K_TIM_MA }) },
  search_docs: { query: B("chuoi"), corpus: T("enum", { giaTri: KHO_TAI_LIEU }) },
  remember: { note: B("chuoi", { toiDa: TRAN_KY_TU_NHO }), scope: T("enum", { giaTri: PHAM_VI_NHO }) },
};

const VI_DU: Record<TenCongCu, string> = {
  read_file: '{"path":"src/index.ts"}',
  list_dir: '{"path":"."}',
  find_files: '{"pattern":"**/*.test.ts"}',
  grep: '{"pattern":"function main","include":"*.ts"}',
  edit_file: '{"path":"src/a.ts","edits":[{"old_string":"const x = 1;","new_string":"const x = 2;"}]}',
  write_file: '{"path":"src/new.ts","content":"export const a = 1;\\n"}',
  delete_file: '{"path":"src/old.ts"}',
  rename_file: '{"from":"src/a.ts","to":"src/b.ts"}',
  run_command: '{"command":"npm test"}',
  todo_write: '{"todos":[{"content":"Read the code","status":"in_progress"},{"content":"Fix the bug","status":"pending"}]}',
  find_symbol: '{"name":"parseConfig","kind":"function"}',
  search_code: '{"query":"where are HTTP requests retried","k":5}',
  search_docs: '{"query":"Mitsubishi MC protocol read D registers","corpus":"vendor"}',
  remember: '{"note":"This project uses pnpm, not npm.","scope":"project"}',
};

const TRANG_THAI_TODO = ["pending", "in_progress", "completed"] as const;

const laObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function docJson(s: string): { ok: true; v: unknown } | { ok: false; loi: string } {
  let t = s.trim();
  if (t === "") return { ok: true, v: {} };
  const rao = /^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/.exec(t);
  if (rao) t = rao[1];
  try {
    return { ok: true, v: JSON.parse(t) };
  } catch (e) {
    return { ok: false, loi: e instanceof Error ? e.message : String(e) };
  }
}

class LoiThamSo extends Error {}

function epBool(v: unknown, ten: string): boolean | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  throw new LoiThamSo(`"${ten}" must be a boolean (true or false)`);
}

function kiemTruong(dt: MotDacTa, v: unknown, ten: string): unknown {
  switch (dt.kieu) {
    case "duong":
      if (typeof v !== "string") throw new LoiThamSo(`"${ten}" must be a string (a path relative to the project root)`);
      if (v.trim() === "") throw new LoiThamSo(`"${ten}" must not be empty`);
      if (v.includes("\u0000")) throw new LoiThamSo(`"${ten}" must not contain NUL characters`);
      return v.trim();
    case "chuoi":
      if (typeof v !== "string") throw new LoiThamSo(`"${ten}" must be a string`);
      if (v.trim() === "") throw new LoiThamSo(`"${ten}" must not be empty`);
      if (dt.toiDa !== undefined && v.trim().length > dt.toiDa)
        throw new LoiThamSo(`"${ten}" must be at most ${dt.toiDa} characters (got ${v.trim().length}); shorten it`);
      return dt.toiDa !== undefined ? v.trim() : v;
    case "enum": {
      const ds = dt.giaTri ?? [];
      if (typeof v !== "string" || !ds.includes(v.trim())) throw new LoiThamSo(`"${ten}" must be one of: ${ds.join(", ")}`);
      return v.trim();
    }
    case "chuoiRong":
      if (typeof v !== "string") throw new LoiThamSo(`"${ten}" must be a string`);
      return v;
    case "so": {
      const n = typeof v === "string" && /^\s*\d+\s*$/.test(v) ? Number(v) : v;
      if (typeof n !== "number" || !Number.isInteger(n) || n < 1) throw new LoiThamSo(`"${ten}" must be a positive integer`);
      if (dt.toiDa !== undefined && n > dt.toiDa) throw new LoiThamSo(`"${ten}" must be at most ${dt.toiDa}`);
      return n;
    }
    case "edits": {
      let ds = v;
      if (typeof ds === "string") {
        const p = docJson(ds);
        if (!p.ok) throw new LoiThamSo(`"${ten}" must be an array of {old_string, new_string, replace_all?} objects`);
        ds = p.v;
      }
      if (!Array.isArray(ds) || ds.length === 0)
        throw new LoiThamSo(`"${ten}" must be a non-empty array of {old_string, new_string, replace_all?} objects`);
      return ds.map((e, i) => {
        const k = `${ten}[${i}]`;
        if (!laObject(e)) throw new LoiThamSo(`"${k}" must be an object {old_string, new_string, replace_all?}`);
        if (typeof e.old_string !== "string") throw new LoiThamSo(`"${k}.old_string" is missing or not a string`);
        if (typeof e.new_string !== "string") throw new LoiThamSo(`"${k}.new_string" is missing or not a string`);
        const ra: Record<string, unknown> = { old_string: e.old_string, new_string: e.new_string };
        const tatCa = epBool(e.replace_all, `${k}.replace_all`);
        if (tatCa !== undefined) ra.replace_all = tatCa;
        return ra;
      });
    }
    case "todos": {
      let ds = v;
      if (typeof ds === "string") {
        const p = docJson(ds);
        ds = p.ok ? p.v : ds;
      }
      if (!Array.isArray(ds)) throw new LoiThamSo(`"${ten}" must be an array of {content, status} objects`);
      return ds.map((e, i) => {
        const k = `${ten}[${i}]`;
        if (!laObject(e)) throw new LoiThamSo(`"${k}" must be an object {content, status}`);
        if (typeof e.content !== "string" || e.content.trim() === "")
          throw new LoiThamSo(`"${k}.content" must be a non-empty string`);
        if (!TRANG_THAI_TODO.includes(e.status as (typeof TRANG_THAI_TODO)[number]))
          throw new LoiThamSo(`"${k}.status" must be one of: ${TRANG_THAI_TODO.join(", ")}`);
        return { content: e.content, status: e.status };
      });
    }
  }
}

/**
 * Parse an toàn + kiểm + chuẩn hoá tham số của một lời gọi tool. KHÔNG ném: lỗi ⇒ `loiChoModel` (tiếng Anh, nêu
 * cụ thể sai gì + một ví dụ đúng) để model tự sửa ở lượt sau. Khoá lạ bị bỏ. Tool ngoài bộ 14 (bộ thực thi có thể
 * phơi thêm) chỉ bị đòi là một JSON object — bộ thực thi tự kiểm phần còn lại.
 */
export function kiemThamSo(ten: string, thamSoTho: unknown): KetQuaKiemThamSo {
  const dacTa = (DAC_TA as Record<string, DacTa>)[ten];
  const viDu = (VI_DU as Record<string, string>)[ten];
  const loi = (s: string): KetQuaKiemThamSo => ({
    ok: false,
    loiChoModel: `Invalid arguments for ${ten}: ${s}.${viDu ? ` Example of valid arguments: ${viDu}` : ""}`,
  });

  let v: unknown = thamSoTho ?? {};
  if (typeof v === "string") {
    const p = docJson(v);
    if (!p.ok) return loi(`arguments are not valid JSON (${p.loi}). Send ONE JSON object matching the tool schema`);
    v = p.v;
  }
  if (!laObject(v)) return loi("arguments must be a JSON object");
  if (!dacTa) return { ok: true, thamSo: v };

  const vao: Record<string, unknown> = { ...v };
  // edit_file dạng phẳng {path, old_string, new_string, replace_all?} — thói quen phổ biến của model ⇒ edits[1]
  if (ten === "edit_file" && vao.edits === undefined && vao.old_string !== undefined) {
    vao.edits = [{ old_string: vao.old_string, new_string: vao.new_string, replace_all: vao.replace_all }];
  }

  const ra: Record<string, unknown> = {};
  try {
    for (const [truong, dt] of Object.entries(dacTa)) {
      const gt = vao[truong];
      if (gt === undefined || gt === null) {
        if (dt.batBuoc) throw new LoiThamSo(`missing required field "${truong}"`);
        continue;
      }
      ra[truong] = kiemTruong(dt, gt, truong);
    }
  } catch (e) {
    if (e instanceof LoiThamSo) return loi(e.message);
    throw e;
  }
  return { ok: true, thamSo: ra };
}

/** Chuỗi chuẩn (khoá sắp xếp) của tham số — dùng phát hiện lặp lại. */
export function chuanHoaThamSo(v: unknown): string {
  const sap = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(sap);
    if (laObject(x)) {
      const o: Record<string, unknown> = {};
      for (const k of Object.keys(x).sort()) o[k] = sap(x[k]);
      return o;
    }
    return x;
  };
  return JSON.stringify(sap(v)) ?? "null";
}

/**
 * Nhãn NGUỒN ngắn của một lời gọi tool (cho cảnh báo "nội dung đáng ngờ" + cờ thẻ duyệt): `read_file` ⇒ chính đường
 * tệp; tool khác ⇒ `<tên> <tham số chính>`. Một dòng, ≤ 160 ký tự. Thuần — server, extension và lõi dùng CHUNG.
 */
export function nhanNguonGoi(goi: Pick<LoiGoiTool, "ten" | "thamSo">): string {
  const t = goi.thamSo ?? {};
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const chinh = s(t.path) || s(t.pattern) || s(t.name) || s(t.query) || s(t.command) || s(t.from);
  const nhan = goi.ten === "read_file" && chinh ? chinh : `${goi.ten}${chinh ? ` ${chinh}` : ""}`;
  return nhan.replace(/[\r\n\t]+/g, " ").trim().slice(0, 160) || goi.ten;
}

// ─── apDungEdits ──────────────────────────────────────────────────────────────────────────────

export interface MotEdit {
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

export type KetQuaApDungEdits =
  | { ok: true; noiDung: string; soThayThe: number }
  | {
      ok: false;
      ma: "RONG" | "KHONG_DOI" | "KHONG_TIM_THAY" | "NHIEU_LAN";
      loi: string;
      /** chỉ số (0-based) của edit hỏng */
      chiSo: number;
      soLan?: number;
    };

const thoatRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Kiểu xuống dòng trội của tệp; `null` nếu tệp không có dòng mới. */
function eolTroi(s: string): "\r\n" | "\n" | null {
  const crlf = (s.match(/\r\n/g) ?? []).length;
  const lf = (s.match(/\n/g) ?? []).length - crlf;
  if (crlf === 0 && lf === 0) return null;
  return crlf > lf ? "\r\n" : "\n";
}

function timViTri(noiDung: string, cu: string): Array<[number, number]> {
  const ra: Array<[number, number]> = [];
  // 1) khớp nguyên văn
  for (let i = noiDung.indexOf(cu); i !== -1; i = noiDung.indexOf(cu, i + cu.length)) ra.push([i, i + cu.length]);
  if (ra.length > 0 || !/[\r\n]/.test(cu)) return ra;
  // 2) khớp bỏ qua khác biệt CRLF/LF: mỗi dòng mới của old_string khớp \r?\n trong tệp — phần không bị sửa giữ nguyên byte
  const re = new RegExp(cu.replace(/\r\n/g, "\n").split("\n").map(thoatRegex).join("\\r?\\n"), "g");
  for (let m = re.exec(noiDung); m; m = re.exec(noiDung)) ra.push([m.index, m.index + m[0].length]);
  return ra;
}

/**
 * Áp các edit của `edit_file` TUẦN TỰ lên nội dung tệp (thuần). `old_string` phải xuất hiện đúng 1 lần, trừ khi
 * `replace_all`. Xuống dòng: khớp được dù model dùng LF trên tệp CRLF (hay ngược lại); `new_string` được ghi theo kiểu
 * xuống dòng TRỘI của tệp; mọi byte ngoài vùng thay giữ nguyên (kể cả tệp lẫn lộn CRLF/LF).
 */
export function apDungEdits(noiDung: string, edits: MotEdit[]): KetQuaApDungEdits {
  let hienTai = noiDung;
  let soThayThe = 0;
  for (let i = 0; i < edits.length; i++) {
    const { old_string: cu, new_string: moi, replace_all } = edits[i];
    const so = `edit #${i + 1}`;
    if (cu === "")
      return { ok: false, ma: "RONG", chiSo: i, loi: `old_string is empty (${so}). To create or overwrite a whole file use write_file.` };
    if (cu === moi)
      return { ok: false, ma: "KHONG_DOI", chiSo: i, loi: `old_string and new_string are identical (${so}); nothing to change.` };
    const viTri = timViTri(hienTai, cu);
    if (viTri.length === 0)
      return {
        ok: false,
        ma: "KHONG_TIM_THAY",
        chiSo: i,
        loi: `old_string not found in the file (${so}). Read the file again and copy the exact current text, including whitespace and indentation, without line numbers.`,
      };
    if (viTri.length > 1 && !replace_all)
      return {
        ok: false,
        ma: "NHIEU_LAN",
        chiSo: i,
        soLan: viTri.length,
        loi: `old_string appears ${viTri.length} times in the file (${so}). Include more surrounding lines to make it unique, or set "replace_all": true to replace every occurrence.`,
      };
    const eol = eolTroi(hienTai);
    const moiTheoTep = eol === null ? moi : moi.replace(/\r\n/g, "\n").replace(/\n/g, eol);
    let ra = "";
    let truoc = 0;
    for (const [dau, cuoi] of viTri) {
      ra += hienTai.slice(truoc, dau) + moiTheoTep;
      truoc = cuoi;
    }
    hienTai = ra + hienTai.slice(truoc);
    soThayThe += viTri.length;
  }
  return { ok: true, noiDung: hienTai, soThayThe };
}
