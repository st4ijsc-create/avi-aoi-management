/**
 * ★★★ `vscode` GIẢ TRÊN ĐĨA THẬT — đủ bề mặt API mà `PhienAgent` + `BoThucThiVscode` + `apBanVa` (mã THẬT của extension)
 * chạm tới, để chạy lõi agent HEADLESS trên một thư mục workspace tạm. Được esbuild tiêm thay cho module `vscode`
 * (`lib/dongGoi.mjs`), nên mọi tệp của extension import ĐÚNG module này.
 *
 * Nguyên tắc: mô phỏng NGỮ NGHĨA VSCode ở những chỗ hàng rào của extension dựa vào, không "dễ dãi" hơn VSCode:
 *   · `workspace.fs.stat/readFile` ném lỗi mang `code: "FileNotFound"` + chữ `EntryNotFound` như FileSystemError thật;
 *   · `applyEdit` kiểm HẾT các thao tác trước rồi mới áp (tạo tệp đã có / xoá tệp không có ⇒ trả `false`, không áp gì);
 *   · `TextDocument` giữ BỘ ĐỆM riêng: `replace` chỉ đổi bộ đệm (bẩn, `version`++), `save()` mới xuống đĩa;
 *   · `createFile`/`renameFile` tự tạo thư mục cha như VSCode.
 * KHÔNG mô phỏng (giới hạn đã biết, ghi ở README): LSP (`find_symbol` rỗng, `get_diagnostics` rỗng), chuẩn hoá EOL của
 * `TextDocument` thật, `files.exclude`/`search.exclude`, editor đang mở (không có `activeTextEditor`).
 *
 * Mọi lượt ghi ĐĨA của tệp này đi qua `fs.*` ⇒ bị `lib/canh.mjs` (vá `fs`) ghi sổ như mọi lượt ghi khác trong tiến trình.
 */
import fs from "node:fs";
import path from "node:path";

// ─── trạng thái do harness điều khiển ────────────────────────────────────────────────────────────

interface TrangThai {
  goc: string[];
  cauHinh: Record<string, unknown>;
  /** ĐỘT BIẾN thiết bị đo (`--dot-bien ho-rao-doc`): đọc tệp khoá ⇒ trả byte của tệp giá trị (lỗ hàng rào giả lập). */
  anhXaDoc: Map<string, string>;
  thaoTac: Array<{ op: string; duong: string; den?: string; ok: boolean }>;
}

const S: TrangThai = { goc: [], cauHinh: {}, anhXaDoc: new Map(), thaoTac: [] };
const docs = new Map<string, TaiLieuGia>();

const khoa = (p: string) => (process.platform === "win32" ? path.resolve(p).toLowerCase() : path.resolve(p));

export function datTrangThai(v: { goc: string[]; cauHinh?: Record<string, unknown>; anhXaDoc?: Record<string, string> }): void {
  S.goc = v.goc.map((g) => path.resolve(g));
  S.cauHinh = { ...(v.cauHinh ?? {}) };
  S.anhXaDoc = new Map(Object.entries(v.anhXaDoc ?? {}).map(([a, b]) => [khoa(a), path.resolve(b)]));
  S.thaoTac = [];
  docs.clear();
}

export function layThaoTac(): TrangThai["thaoTac"] {
  return [...S.thaoTac];
}

// ─── lớp cơ bản ──────────────────────────────────────────────────────────────────────────────────

export class Uri {
  readonly authority = "";
  readonly query = "";
  readonly fragment = "";
  private constructor(
    readonly scheme: string,
    readonly path: string,
    readonly fsPath: string,
  ) {}
  static file(p: string): Uri {
    const abs = path.resolve(p);
    const posixPath = "/" + abs.replace(/\\/g, "/").replace(/^\/+/, "");
    return new Uri("file", posixPath, abs);
  }
  static from(c: { scheme: string; path?: string }): Uri {
    return new Uri(c.scheme, c.path ?? "/", c.scheme === "file" ? path.resolve((c.path ?? "/").replace(/^\/([A-Za-z]:)/, "$1")) : c.path ?? "/");
  }
  static parse(s: string): Uri {
    const m = /^([a-z][a-z0-9+.-]*):(.*)$/i.exec(s);
    if (!m) return Uri.file(s);
    if (m[1] === "file") return Uri.file(decodeURIComponent(m[2].replace(/^\/\/+/, "/")).replace(/^\/([A-Za-z]:)/, "$1"));
    return new Uri(m[1], m[2], m[2]);
  }
  static joinPath(base: Uri, ...p: string[]): Uri {
    return Uri.file(path.join(base.fsPath, ...p));
  }
  with(_c: Record<string, unknown>): Uri {
    return this;
  }
  toString(): string {
    return this.scheme === "file" ? `file://${encodeURI(this.path)}` : `${this.scheme}:${this.path}`;
  }
  toJSON() {
    return { scheme: this.scheme, path: this.path, fsPath: this.fsPath };
  }
}

export const FileType = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 } as const;

export const SymbolKind: Record<string | number, string | number> = {};
[
  "File", "Module", "Namespace", "Package", "Class", "Method", "Property", "Field", "Constructor", "Enum", "Interface",
  "Function", "Variable", "Constant", "String", "Number", "Boolean", "Array", "Object", "Key", "Null", "EnumMember",
  "Struct", "Event", "Operator", "TypeParameter",
].forEach((ten, i) => {
  SymbolKind[ten] = i;
  SymbolKind[i] = ten;
});

export const DiagnosticSeverity = { Error: 0, Warning: 1, Information: 2, Hint: 3 } as const;

export class Position {
  constructor(
    readonly line: number,
    readonly character: number,
  ) {}
}
export class Range {
  readonly start: Position;
  readonly end: Position;
  constructor(a: number | Position, b: number | Position, c?: number, d?: number) {
    if (typeof a === "number") {
      this.start = new Position(a, b as number);
      this.end = new Position(c ?? 0, d ?? 0);
    } else {
      this.start = a;
      this.end = b as Position;
    }
  }
  get isEmpty(): boolean {
    return this.start.line === this.end.line && this.start.character === this.end.character;
  }
}
export class Selection extends Range {}

export class RelativePattern {
  readonly baseUri: Uri;
  readonly base: string;
  constructor(
    base: Uri | string | { uri: Uri },
    readonly pattern: string,
  ) {
    this.baseUri = typeof base === "string" ? Uri.file(base) : base instanceof Uri ? base : base.uri;
    this.base = this.baseUri.fsPath;
  }
}

export class Disposable {
  constructor(private readonly fn: () => void = () => {}) {}
  static from(...ds: Array<{ dispose(): unknown }>): Disposable {
    return new Disposable(() => ds.forEach((d) => d.dispose()));
  }
  dispose(): void {
    this.fn();
  }
}

export class EventEmitter<T> {
  private nghe: Array<(e: T) => void> = [];
  readonly event = (f: (e: T) => void) => {
    this.nghe.push(f);
    return new Disposable(() => (this.nghe = this.nghe.filter((x) => x !== f)));
  };
  fire(e: T): void {
    for (const f of [...this.nghe]) f(e);
  }
  dispose(): void {
    this.nghe = [];
  }
}

// ─── lỗi kiểu FileSystemError ────────────────────────────────────────────────────────────────────

function khongCo(p: string): Error {
  return Object.assign(new Error(`EntryNotFound (FileSystemError): ${p}`), { code: "FileNotFound" });
}
function daCo(p: string): Error {
  return Object.assign(new Error(`EntryExists (FileSystemError): ${p}`), { code: "FileExists" });
}

function loaiTep(st: fs.Stats): number {
  return st.isDirectory() ? FileType.Directory : st.isFile() ? FileType.File : FileType.Unknown;
}

// ─── TextDocument giả ────────────────────────────────────────────────────────────────────────────

class TaiLieuGia {
  version = 1;
  private boDem: string;
  private daLuu: string;
  constructor(public uri: Uri) {
    this.boDem = fs.readFileSync(uri.fsPath, "utf8");
    this.daLuu = this.boDem;
  }
  get fileName(): string {
    return this.uri.fsPath;
  }
  get languageId(): string {
    return path.extname(this.uri.fsPath).slice(1) || "plaintext";
  }
  get isDirty(): boolean {
    return this.boDem !== this.daLuu;
  }
  get isClosed(): boolean {
    return false;
  }
  get eol(): number {
    return this.boDem.includes("\r\n") ? 2 : 1;
  }
  get lineCount(): number {
    return this.boDem.split("\n").length;
  }
  /** Tải lại từ đĩa khi KHÔNG bẩn (VSCode làm vậy khi tệp đổi bên ngoài). */
  napLaiNeuSach(): void {
    if (this.isDirty) return;
    try {
      const d = fs.readFileSync(this.uri.fsPath, "utf8");
      if (d !== this.daLuu) {
        this.boDem = d;
        this.daLuu = d;
        this.version++;
      }
    } catch {
      /* tệp đã mất — giữ nguyên */
    }
  }
  getText(r?: Range): string {
    if (!r) return this.boDem;
    return this.boDem.slice(this.offsetAt(r.start), this.offsetAt(r.end));
  }
  offsetAt(p: Position): number {
    const dong = this.boDem.split("\n");
    let o = 0;
    for (let i = 0; i < Math.min(p.line, dong.length); i++) o += dong[i].length + 1;
    return Math.min(o + p.character, this.boDem.length);
  }
  positionAt(o: number): Position {
    const truoc = this.boDem.slice(0, o).split("\n");
    return new Position(truoc.length - 1, truoc[truoc.length - 1].length);
  }
  validateRange(r: Range): Range {
    return r;
  }
  thayBoDem(noiDung: string): void {
    this.boDem = noiDung;
    this.version++;
  }
  async save(): Promise<boolean> {
    fs.mkdirSync(path.dirname(this.uri.fsPath), { recursive: true });
    fs.writeFileSync(this.uri.fsPath, this.boDem, "utf8");
    this.daLuu = this.boDem;
    S.thaoTac.push({ op: "save", duong: this.uri.fsPath, ok: true });
    return true;
  }
}

function moTaiLieu(uri: Uri): TaiLieuGia {
  const k = khoa(uri.fsPath);
  let d = docs.get(k);
  if (d) {
    d.napLaiNeuSach();
    return d;
  }
  if (!fs.existsSync(uri.fsPath)) throw khongCo(uri.fsPath);
  d = new TaiLieuGia(uri);
  docs.set(k, d);
  return d;
}

// ─── WorkspaceEdit ───────────────────────────────────────────────────────────────────────────────

type OpSua =
  | { k: "replace"; uri: Uri; r: Range; nd: string }
  | { k: "create"; uri: Uri; o: { overwrite?: boolean; ignoreIfExists?: boolean; contents?: Uint8Array } }
  | { k: "delete"; uri: Uri; o: { recursive?: boolean; ignoreIfNotExists?: boolean } }
  | { k: "rename"; uri: Uri; den: Uri; o: { overwrite?: boolean; ignoreIfExists?: boolean } };

export class WorkspaceEdit {
  readonly ops: OpSua[] = [];
  replace(uri: Uri, r: Range, nd: string): void {
    this.ops.push({ k: "replace", uri, r, nd });
  }
  insert(uri: Uri, p: Position, nd: string): void {
    this.ops.push({ k: "replace", uri, r: new Range(p, p), nd });
  }
  createFile(uri: Uri, o: { overwrite?: boolean; ignoreIfExists?: boolean; contents?: Uint8Array } = {}): void {
    this.ops.push({ k: "create", uri, o });
  }
  deleteFile(uri: Uri, o: { recursive?: boolean; ignoreIfNotExists?: boolean } = {}): void {
    this.ops.push({ k: "delete", uri, o });
  }
  renameFile(uri: Uri, den: Uri, o: { overwrite?: boolean; ignoreIfExists?: boolean } = {}): void {
    this.ops.push({ k: "rename", uri, den, o });
  }
  get size(): number {
    return this.ops.length;
  }
}

async function apDungSua(we: WorkspaceEdit): Promise<boolean> {
  // Kiểm trước TẤT CẢ (VSCode từ chối cả gói khi một thao tác tệp không hợp lệ).
  for (const o of we.ops) {
    const co = fs.existsSync(o.uri.fsPath);
    if (o.k === "create" && co && !o.o.overwrite && !o.o.ignoreIfExists) return false;
    if (o.k === "delete" && !co && !o.o.ignoreIfNotExists) return false;
    if (o.k === "rename" && (!co || (fs.existsSync(o.den.fsPath) && !o.o.overwrite && !o.o.ignoreIfExists))) return false;
    if (o.k === "replace" && !co && !docs.has(khoa(o.uri.fsPath))) return false;
  }
  for (const o of we.ops) {
    const k = khoa(o.uri.fsPath);
    if (o.k === "replace") {
      const d = moTaiLieu(o.uri);
      const toan = d.getText();
      const dau = d.offsetAt(o.r.start);
      const cuoi = d.offsetAt(o.r.end);
      d.thayBoDem(toan.slice(0, dau) + o.nd + toan.slice(cuoi));
      S.thaoTac.push({ op: "replace(bo-dem)", duong: o.uri.fsPath, ok: true });
    } else if (o.k === "create") {
      if (fs.existsSync(o.uri.fsPath) && o.o.ignoreIfExists && !o.o.overwrite) continue;
      fs.mkdirSync(path.dirname(o.uri.fsPath), { recursive: true });
      fs.writeFileSync(o.uri.fsPath, Buffer.from(o.o.contents ?? new Uint8Array()));
      docs.delete(k);
      S.thaoTac.push({ op: "create", duong: o.uri.fsPath, ok: true });
    } else if (o.k === "delete") {
      if (!fs.existsSync(o.uri.fsPath)) continue;
      fs.rmSync(o.uri.fsPath, { recursive: !!o.o.recursive });
      docs.delete(k);
      S.thaoTac.push({ op: "delete", duong: o.uri.fsPath, ok: true });
    } else {
      fs.mkdirSync(path.dirname(o.den.fsPath), { recursive: true });
      fs.renameSync(o.uri.fsPath, o.den.fsPath);
      docs.delete(k);
      S.thaoTac.push({ op: "rename", duong: o.uri.fsPath, den: o.den.fsPath, ok: true });
    }
  }
  return true;
}

// ─── glob tối thiểu cho findFiles ────────────────────────────────────────────────────────────────

function globSangRegex(g: string): RegExp {
  let i = 0;
  let re = "";
  const doc = (): string => {
    let ra = "";
    while (i < g.length) {
      const c = g[i];
      if (c === "*") {
        if (g[i + 1] === "*") {
          i += 2;
          if (g[i] === "/") {
            i++;
            ra += "(?:.*/)?";
          } else ra += ".*";
        } else {
          i++;
          ra += "[^/]*";
        }
      } else if (c === "?") {
        i++;
        ra += "[^/]";
      } else if (c === "{") {
        i++;
        const nhanh: string[] = [];
        let cur = "";
        let sau = 0;
        while (i < g.length && !(g[i] === "}" && sau === 0)) {
          if (g[i] === "{") sau++;
          if (g[i] === "}") sau--;
          if (g[i] === "," && sau === 0) {
            nhanh.push(cur);
            cur = "";
          } else cur += g[i];
          i++;
        }
        i++;
        nhanh.push(cur);
        ra += `(?:${nhanh.map((n) => globSangRegex(n).source.slice(1, -1)).join("|")})`;
      } else if (c === "}" || c === ",") {
        return ra;
      } else {
        i++;
        ra += c.replace(/[.+^$()|[\]\\]/g, "\\$&");
      }
    }
    return ra;
  };
  re = doc();
  return new RegExp(`^${re}$`, process.platform === "win32" ? "i" : "");
}

function duyetCay(goc: string, ra: string[], tran: number): void {
  const ngan: string[] = [goc];
  while (ngan.length && ra.length < tran * 4) {
    const d = ngan.pop()!;
    let muc: fs.Dirent[];
    try {
      muc = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of muc) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) ngan.push(p);
      else if (e.isFile()) ra.push(p);
    }
  }
}

async function timTep(include: RelativePattern | string, exclude?: string | RelativePattern | null, maxResults?: number): Promise<Uri[]> {
  const tran = maxResults ?? 10_000;
  const goc = typeof include === "string" ? S.goc : [include.base];
  const mau = globSangRegex(typeof include === "string" ? include : include.pattern);
  const loai = exclude ? globSangRegex(typeof exclude === "string" ? exclude : exclude.pattern) : null;
  const ra: Uri[] = [];
  for (const g of goc) {
    const tep: string[] = [];
    duyetCay(g, tep, tran);
    for (const p of tep.sort()) {
      const rel = path.relative(g, p).replace(/\\/g, "/");
      if (loai && loai.test(rel)) continue;
      if (!mau.test(rel)) continue;
      ra.push(Uri.file(p));
      if (ra.length >= tran) return ra;
    }
  }
  return ra;
}

// ─── namespace `workspace` ───────────────────────────────────────────────────────────────────────

export const workspace = {
  get workspaceFolders() {
    return S.goc.map((g, index) => ({ uri: Uri.file(g), name: path.basename(g), index }));
  },
  get textDocuments() {
    return [...docs.values()];
  },
  getConfiguration(section?: string) {
    return {
      get<T>(k: string, macDinh?: T): T {
        const v = S.cauHinh[section ? `${section}.${k}` : k];
        return (v === undefined ? macDinh : v) as T;
      },
      has: (k: string) => (section ? `${section}.${k}` : k) in S.cauHinh,
      update: async () => {},
      inspect: () => undefined,
    };
  },
  fs: {
    async stat(uri: Uri) {
      let st: fs.Stats;
      try {
        st = fs.statSync(uri.fsPath);
      } catch {
        throw khongCo(uri.fsPath);
      }
      return { type: loaiTep(st), ctime: st.ctimeMs, mtime: st.mtimeMs, size: st.size };
    },
    async readFile(uri: Uri): Promise<Uint8Array> {
      const anh = S.anhXaDoc.get(khoa(uri.fsPath));
      const p = anh ?? uri.fsPath;
      try {
        return new Uint8Array(fs.readFileSync(p));
      } catch {
        throw khongCo(uri.fsPath);
      }
    },
    async readDirectory(uri: Uri): Promise<[string, number][]> {
      let muc: fs.Dirent[];
      try {
        muc = fs.readdirSync(uri.fsPath, { withFileTypes: true });
      } catch {
        throw khongCo(uri.fsPath);
      }
      return muc.map((e) => [e.name, e.isDirectory() ? FileType.Directory : e.isFile() ? FileType.File : FileType.Unknown]);
    },
    async writeFile(uri: Uri, nd: Uint8Array) {
      fs.mkdirSync(path.dirname(uri.fsPath), { recursive: true });
      fs.writeFileSync(uri.fsPath, Buffer.from(nd));
      S.thaoTac.push({ op: "fs.writeFile", duong: uri.fsPath, ok: true });
    },
    async createDirectory(uri: Uri) {
      fs.mkdirSync(uri.fsPath, { recursive: true });
      S.thaoTac.push({ op: "fs.createDirectory", duong: uri.fsPath, ok: true });
    },
    async delete(uri: Uri, o: { recursive?: boolean } = {}) {
      if (!fs.existsSync(uri.fsPath)) throw khongCo(uri.fsPath);
      fs.rmSync(uri.fsPath, { recursive: !!o.recursive });
      S.thaoTac.push({ op: "fs.delete", duong: uri.fsPath, ok: true });
    },
    async rename(a: Uri, b: Uri, o: { overwrite?: boolean } = {}) {
      if (!fs.existsSync(a.fsPath)) throw khongCo(a.fsPath);
      if (fs.existsSync(b.fsPath) && !o.overwrite) throw daCo(b.fsPath);
      fs.renameSync(a.fsPath, b.fsPath);
      S.thaoTac.push({ op: "fs.rename", duong: a.fsPath, den: b.fsPath, ok: true });
    },
  },
  findFiles: timTep,
  async openTextDocument(uri: Uri) {
    return moTaiLieu(uri);
  },
  applyEdit: apDungSua,
  onDidChangeConfiguration: () => new Disposable(),
  onDidChangeWorkspaceFolders: () => new Disposable(),
  onDidSaveTextDocument: () => new Disposable(),
  onDidChangeTextDocument: () => new Disposable(),
  registerTextDocumentContentProvider: () => new Disposable(),
  asRelativePath(p: string | Uri) {
    const abs = typeof p === "string" ? p : p.fsPath;
    for (const g of S.goc) {
      const r = path.relative(g, abs);
      if (!r.startsWith("..") && !path.isAbsolute(r)) return r.replace(/\\/g, "/");
    }
    return abs;
  },
};

// ─── namespace còn lại ───────────────────────────────────────────────────────────────────────────

export const languages = {
  /** Không có LSP headless ⇒ không có chẩn đoán nào (giới hạn đã biết). */
  getDiagnostics(uri?: Uri): unknown {
    return uri ? [] : [];
  },
  registerInlineCompletionItemProvider: () => new Disposable(),
  registerCodeActionsProvider: () => new Disposable(),
};

export const commands = {
  async executeCommand(lenh: string, ..._a: unknown[]): Promise<unknown> {
    if (lenh === "vscode.executeWorkspaceSymbolProvider" || lenh === "vscode.executeReferenceProvider") return [];
    return undefined;
  },
  registerCommand: () => new Disposable(),
};

const kenhRong = { appendLine() {}, append() {}, show() {}, clear() {}, dispose() {} };
export const window = {
  activeTextEditor: undefined,
  visibleTextEditors: [],
  showInformationMessage: async () => undefined,
  showWarningMessage: async () => undefined,
  showErrorMessage: async () => undefined,
  showInputBox: async () => undefined,
  showQuickPick: async () => undefined,
  createOutputChannel: () => kenhRong,
  setStatusBarMessage: () => new Disposable(),
  onDidChangeActiveTextEditor: () => new Disposable(),
};

export const env = {
  clipboard: { writeText: async () => {}, readText: async () => "" },
  machineId: "vscode-e2e",
  language: "vi",
  appName: "vscode-e2e (headless)",
  openExternal: async () => false,
};

export const version = "1.99.0-e2e-headless";

export const ViewColumn = { Active: -1, Beside: -2, One: 1, Two: 2 } as const;
export const StatusBarAlignment = { Left: 1, Right: 2 } as const;
export const EndOfLine = { LF: 1, CRLF: 2 } as const;
