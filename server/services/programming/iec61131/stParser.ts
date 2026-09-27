/**
 * doc 80 Đợt 1 Task 7 (AI-02) — Structured Text (IEC 61131-3) THẬT: tokenizer + parser đệ quy
 * xuống + kiểm ngữ nghĩa tối thiểu. Thay validator đếm từ khoá `/gi` của `iec61131Adapter.ts`
 * (phụ lục A §1: rác ⇒ ok:true; FB có `VAR_INPUT` ⇒ "Unbalanced VAR/END_VAR"; chú thích chứa
 * "if" ⇒ "Unbalanced IF/END_IF").
 *
 * PHẠM VI (đích là runtime MỞ OpenPLC/matiec — doc 09 §4.5):
 *   • Từ vựng: chú thích `(* *)` `/* *)` `//`, pragma `{ }`, chuỗi `'…'`/`"…"` với escape `$`,
 *     số (thập phân, `_`, `16#/8#/2#`, số thực, mũ), literal có kiểu (`T#2s`, `TIME#…`, `D#`,
 *     `TOD#`, `DT#`, `INT#5`, `BOOL#TRUE`, `Enum#Val`), địa chỉ trực tiếp `%IX0.0`.
 *   • Cú pháp: PROGRAM / FUNCTION_BLOCK / FUNCTION … END_*; TYPE (STRUCT, enum, alias) … END_TYPE;
 *     mọi `VAR*` (+ CONSTANT/RETAIN/…) … END_VAR; `:=` kết thúc `;`; IF/ELSIF/ELSE, CASE,
 *     FOR/BY, WHILE, REPEAT/UNTIL, EXIT/RETURN/CONTINUE; gọi FB/hàm (đối số tên `:=`, ra `=>`,
 *     vị trí); biểu thức AND/OR/XOR/NOT/MOD/&/**, so sánh, một ngôi.
 *   • "Mảnh" (không có POU): khối VAR ở đầu + dãy lệnh — dạng skeleton của Copilot. Lệnh ngoài POU
 *     khi tệp ĐÃ có POU ⇒ lỗi.
 *   • Ngữ nghĩa: định danh chưa khai báo; thành viên không tồn tại của FB chuẩn (TON/TOF/TP/CTU/
 *     CTD/CTUD/R_TRIG/F_TRIG/SR/RS), của FB/STRUCT tự khai báo, của kiểu cơ bản; tham số gọi FB sai
 *     tên/hướng; gán vào hằng; khai báo trùng. Kiểu lạ (thư viện hãng) ⇒ CẢNH BÁO, không đoán.
 *
 * KHÔNG làm: kiểm kiểu biểu thức, OOP CODESYS (METHOD/INTERFACE — matiec không có ⇒ báo lỗi
 * "không hỗ trợ"), CONFIGURATION (bỏ qua + cảnh báo "không kiểm").
 *
 * Mỗi chẩn đoán có `line`/`col` (1-based), `code` (khoá i18n `engineering.stDiag.<code>`) và
 * `params`; `message` tiếng Anh giữ cho lượt tự sửa của model + nhật ký.
 *
 * Không ném `Error` ra ngoài: lỗi cú pháp thu thành chẩn đoán; bên trong dùng `StBail` để phục hồi.
 */

export type StDiagCode =
  | "stEmpty"
  | "stUnexpectedChar"
  | "stUnterminatedComment"
  | "stUnterminatedString"
  | "stBadLiteral"
  | "stExpected"
  | "stExpectedExpr"
  | "stExpectedIdent"
  | "stExpectedType"
  | "stMissingSemicolon"
  | "stUnexpected"
  | "stNotClosed"
  | "stOutsidePou"
  | "stUnsupported"
  | "stUnchecked"
  | "stUndeclared"
  | "stNoMember"
  | "stBadInput"
  | "stBadOutput"
  | "stNotCallable"
  | "stFbTypeCall"
  | "stUnknownType"
  | "stDuplicate"
  | "stAssignConstant"
  | "stNoAssignment"
  | "stNestedComment"
  | "stEdgeNotInput";

export interface StDiagnostic {
  severity: "error" | "warning";
  code: StDiagCode;
  message: string;
  line: number;
  col: number;
  params?: Record<string, string | number>;
}

export interface StCheckOptions {
  /** Ký hiệu khai báo ngoài mã (bảng tag của project) — coi như đã khai báo. */
  symbols?: string[];
}

export interface StCheckResult {
  ok: boolean;
  diagnostics: StDiagnostic[];
  /** Số câu lệnh gán `:=` thật (không đếm trong chú thích/khai báo). */
  assignments: number;
  pous: Array<{ kind: string; name: string }>;
}

// ═════════════════════════════════════════════════════════════════════════════
// Từ vựng
// ═════════════════════════════════════════════════════════════════════════════
type TokKind = "id" | "int" | "real" | "str" | "typed" | "addr" | "op" | "eof";
interface Tok {
  k: TokKind;
  t: string;
  /** Chữ HOA (định danh/từ khoá IEC không phân biệt hoa thường). */
  u: string;
  line: number;
  col: number;
  endLine: number;
  endCol: number;
  /** literal có kiểu: tiền tố (vd `T`, `E_State`) và phần sau `#`. */
  prefix?: string;
  value?: string;
}

const TIME_PREFIX = new Set(["T", "TIME", "LT", "LTIME"]);
const DATE_PREFIX = new Set(["D", "DATE", "LD", "LDATE"]);
const TOD_PREFIX = new Set(["TOD", "TIME_OF_DAY", "LTOD", "LTIME_OF_DAY"]);
const DT_PREFIX = new Set(["DT", "DATE_AND_TIME", "LDT", "LDATE_AND_TIME"]);

const ELEMENTARY_TYPES = new Set([
  "BOOL", "BYTE", "WORD", "DWORD", "LWORD",
  "SINT", "INT", "DINT", "LINT", "USINT", "UINT", "UDINT", "ULINT",
  "REAL", "LREAL",
  "TIME", "LTIME", "DATE", "LDATE", "TIME_OF_DAY", "TOD", "LTOD", "DATE_AND_TIME", "DT", "LDT",
  "STRING", "WSTRING", "CHAR", "WCHAR",
]);
const BIT_ADDRESSABLE = new Set(["BYTE", "WORD", "DWORD", "LWORD", "SINT", "INT", "DINT", "LINT", "USINT", "UINT", "UDINT", "ULINT"]);
const NUMERIC_TYPED_PREFIX = new Set([...ELEMENTARY_TYPES].filter((t) => !TIME_PREFIX.has(t) && !DATE_PREFIX.has(t) && !TOD_PREFIX.has(t) && !DT_PREFIX.has(t) && t !== "STRING" && t !== "WSTRING" && t !== "CHAR" && t !== "WCHAR"));

const RE_TIME = /^[+-]?(?:\d[\d_]*(?:\.\d+)?(?:ms|us|ns|d|h|m|s)_?)+/i;
const RE_DATE = /^\d{4}-\d{1,2}-\d{1,2}/;
const RE_TOD = /^\d{1,2}:\d{1,2}(?::\d{1,2}(?:\.\d+)?)?/;
const RE_DT = /^\d{4}-\d{1,2}-\d{1,2}-\d{1,2}:\d{1,2}(?::\d{1,2}(?:\.\d+)?)?/;
const RE_NUMLIT = /^[+-]?(?:(?:2|8|16)#[0-9A-Fa-f_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?|TRUE\b|FALSE\b)/i;
const RE_BASED = /^(?:2#[01_]+|8#[0-7_]+|16#[0-9A-Fa-f_]+)/;
const RE_DECIMAL = /^\d[\d_]*(\.\d[\d_]*)?([eE][+-]?\d+)?/;
const RE_ADDR = /^%[IQM](?:[XBWDL])?(?:\*|\d+(?:\.\d+)*)/i;
const RE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*/;
const OPS2 = [":=", "=>", "<=", ">=", "<>", "**", ".."];
const OPS1 = "()[],;:.+-*/=<>&^#";

function tokenize(src: string, diag: (d: StDiagnostic) => void): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;
  const n = src.length;
  const col = (p: number) => p - lineStart + 1;
  /** Tiến tới vị trí `to`, cập nhật số dòng. */
  const advanceTo = (to: number) => {
    for (; i < to; i++) {
      if (src.charCodeAt(i) === 10) { line++; lineStart = i + 1; }
    }
  };
  const push = (k: TokKind, start: number, text: string, extra?: Partial<Tok>) => {
    const sLine = line, sCol = col(start);
    advanceTo(start + text.length);
    toks.push({ k, t: text, u: text.toUpperCase(), line: sLine, col: sCol, endLine: line, endCol: col(i), ...extra });
  };
  const err = (code: StDiagCode, l: number, c: number, message: string, params?: StDiagnostic["params"]) =>
    diag({ severity: "error", code, message, line: l, col: c, params });

  while (i < n) {
    const ch = src[i];
    if (ch === "\n") { i++; line++; lineStart = i; continue; }
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\f" || ch === "\v" || ch === " " || ch === "﻿") { i++; continue; }

    // Chú thích / pragma
    const two = src.slice(i, i + 2);
    if (two === "(*" || two === "/*") {
      const close = two === "(*" ? "*)" : "*/";
      const end = src.indexOf(close, i + 2);
      if (end < 0) {
        err("stUnterminatedComment", line, col(i), `Comment '${two}' opened here is never closed.`, { open: two });
        advanceTo(n);
        break;
      }
      // Fix round 1 — `(* a (* b *) c *)`: matiec/OpenPLC KHÔNG lồng chú thích, nên chú thích đóng ở
      // `*)` đầu tiên và phần đuôi thành "mã" ⇒ trước đây ra một tràng "Undeclared identifier" sai
      // chỗ. Nếu có `(*` bên trong VÀ cách đọc lồng nhau khép được về 0 ở một `*)` SAU đó (tức tác giả
      // ý định lồng), báo MỘT lỗi đúng lý do tại `(*` bên trong rồi bỏ qua cả khối lồng. `(*` bên trong
      // mà cách đọc lồng không khép được (vd "(* viết (* để mở *)") là chữ thường ⇒ hợp lệ như cũ.
      const inner = src.indexOf(two, i + 2);
      if (inner >= 0 && inner < end) {
        let depth = 1;
        let k = i + 2;
        let nestedEnd = -1;
        while (k < n - 1) {
          const pair = src.slice(k, k + 2);
          if (pair === two) { depth++; k += 2; continue; }
          if (pair === close) { depth--; k += 2; if (depth === 0) { nestedEnd = k; break; } continue; }
          k++;
        }
        if (nestedEnd > end + 2) {
          const between = src.slice(i, inner);
          const nl = between.lastIndexOf("\n");
          const iLine = line + (between.match(/\n/g) ?? []).length;
          const iCol = nl < 0 ? col(i) + (inner - i) : inner - (i + nl + 1) + 1;
          err("stNestedComment", iLine, iCol, `Nested comment '${two}' inside a comment — nested comments are not supported by the target compiler (OpenPLC/matiec closes the comment at the first '${close}').`, { open: two, close });
          advanceTo(nestedEnd);
          continue;
        }
      }
      advanceTo(end + 2);
      continue;
    }
    if (two === "//") {
      const end = src.indexOf("\n", i);
      advanceTo(end < 0 ? n : end);
      continue;
    }
    if (ch === "{") {
      const end = src.indexOf("}", i + 1);
      if (end < 0) {
        err("stUnterminatedComment", line, col(i), "Pragma '{' opened here is never closed.", { open: "{" });
        advanceTo(n);
        break;
      }
      advanceTo(end + 1);
      continue;
    }

    // Chuỗi
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      let closed = false;
      while (j < n) {
        const c = src[j];
        if (c === "\n" || c === "\r") break;
        if (c === "$") { j += 2; continue; }
        if (c === ch) { closed = true; break; }
        j++;
      }
      if (!closed) {
        err("stUnterminatedString", line, col(i), "String literal is not closed on this line.");
        const eol = src.indexOf("\n", i);
        push("str", i, src.slice(i, eol < 0 ? n : eol).replace(/\r$/, ""));
        continue;
      }
      push("str", i, src.slice(i, j + 1));
      continue;
    }

    // Số
    if (ch >= "0" && ch <= "9") {
      const rest = src.slice(i, i + 200);
      const based = RE_BASED.exec(rest);
      if (based) { push("int", i, based[0]); continue; }
      if (/^\d+#/.test(rest)) {
        const bad = /^\d+#[0-9A-Za-z_]*/.exec(rest)![0];
        err("stBadLiteral", line, col(i), `Invalid numeric literal '${bad}'.`, { kind: "#", text: bad });
        push("int", i, bad);
        continue;
      }
      const m = RE_DECIMAL.exec(rest)!;
      push(m[1] || m[2] ? "real" : "int", i, m[0]);
      continue;
    }

    // Định danh / literal có kiểu
    if (/[A-Za-z_]/.test(ch)) {
      const id = RE_IDENT.exec(src.slice(i, i + 256))![0];
      if (src[i + id.length] === "#") {
        const up = id.toUpperCase();
        const after = src.slice(i + id.length + 1, i + id.length + 200);
        let m: RegExpExecArray | null = null;
        let kindName = "";
        if (TIME_PREFIX.has(up)) { m = RE_TIME.exec(after); kindName = "TIME"; }
        else if (DT_PREFIX.has(up)) { m = RE_DT.exec(after); kindName = "DATE_AND_TIME"; }
        else if (DATE_PREFIX.has(up)) { m = RE_DATE.exec(after); kindName = "DATE"; }
        else if (TOD_PREFIX.has(up)) { m = RE_TOD.exec(after); kindName = "TIME_OF_DAY"; }
        else if (NUMERIC_TYPED_PREFIX.has(up)) { m = RE_NUMLIT.exec(after); kindName = up; }
        else { m = RE_IDENT.exec(after); kindName = "enum"; }
        const tail = /^[A-Za-z0-9_.:+-]*/.exec(after)![0];
        // Hợp lệ khi khớp VÀ không còn ký tự chữ/số dính liền phía sau (vd `T#2x`).
        const valid = m !== null && m[0].length > 0 && !/^[A-Za-z0-9_]/.test(after.slice(m[0].length));
        if (!valid) {
          const text = `${id}#${tail}`;
          err("stBadLiteral", line, col(i), `Invalid ${kindName} literal '${text}'.`, { kind: kindName, text });
          push("typed", i, text, { prefix: id, value: tail });
          continue;
        }
        push("typed", i, `${id}#${m![0]}`, { prefix: id, value: m![0] });
        continue;
      }
      push("id", i, id);
      continue;
    }

    // Địa chỉ trực tiếp
    if (ch === "%") {
      const m = RE_ADDR.exec(src.slice(i, i + 64));
      if (m) { push("addr", i, m[0]); continue; }
      err("stBadLiteral", line, col(i), "Invalid direct address.", { kind: "%", text: src.slice(i, i + 8).split(/\s/)[0] });
      i++;
      continue;
    }

    // Toán tử
    if (OPS2.includes(two)) { push("op", i, two); continue; }
    if (OPS1.includes(ch)) { push("op", i, ch); continue; }

    err("stUnexpectedChar", line, col(i), `Unexpected character '${ch}'.`, { ch });
    i++;
  }
  const last = toks[toks.length - 1];
  toks.push({ k: "eof", t: "", u: "", line: last ? last.endLine : 1, col: last ? last.endCol : 1, endLine: last ? last.endLine : 1, endCol: last ? last.endCol : 1 });
  return toks;
}

// ═════════════════════════════════════════════════════════════════════════════
// Cây cú pháp tối thiểu (đủ cho kiểm ngữ nghĩa)
// ═════════════════════════════════════════════════════════════════════════════
type TypeRef =
  | { kind: "named"; name: string; tok: Tok }
  | { kind: "array"; elem: TypeRef }
  | { kind: "string" }
  | { kind: "enum"; values: string[] }
  | { kind: "pointer"; to: TypeRef }
  | { kind: "struct"; fields: Map<string, VarInfo> };

interface VarInfo { name: string; tok: Tok; type: TypeRef; section: string; constant: boolean }

interface CallArg { name?: Tok; dir: "in" | "out" | "pos" }
type Part =
  | { kind: "member"; tok: Tok }
  | { kind: "index" }
  | { kind: "deref" }
  | { kind: "call"; tok: Tok; args: CallArg[] };
interface Designator { base: Tok; parts: Part[] }

interface Ctx {
  kind: "PROGRAM" | "FUNCTION_BLOCK" | "FUNCTION" | "GLOBAL";
  name: string;
  nameTok?: Tok;
  vars: Map<string, VarInfo>;
  retType?: TypeRef;
  refs: Designator[];
  assignTargets: Designator[];
}

interface TypeDef { name: string; tok: Tok; type: TypeRef }

class StBail {}

const VAR_KW = new Set(["VAR", "VAR_INPUT", "VAR_OUTPUT", "VAR_IN_OUT", "VAR_TEMP", "VAR_GLOBAL", "VAR_EXTERNAL", "VAR_STAT", "VAR_INST", "VAR_CONFIG", "VAR_ACCESS"]);
const VAR_QUAL = new Set(["CONSTANT", "RETAIN", "NON_RETAIN", "PERSISTENT"]);
const POU_KW: Record<string, string> = { PROGRAM: "END_PROGRAM", FUNCTION_BLOCK: "END_FUNCTION_BLOCK", FUNCTION: "END_FUNCTION" };
const UNSUPPORTED_BLOCKS: Record<string, string> = {
  METHOD: "END_METHOD", PROPERTY: "END_PROPERTY", INTERFACE: "END_INTERFACE", ACTION: "END_ACTION",
};
const RESERVED = new Set([
  ...VAR_KW, ...VAR_QUAL, ...Object.keys(POU_KW), ...Object.values(POU_KW),
  ...Object.keys(UNSUPPORTED_BLOCKS), ...Object.values(UNSUPPORTED_BLOCKS),
  "END_VAR", "AT", "IF", "THEN", "ELSIF", "ELSE", "END_IF", "CASE", "OF", "END_CASE", "FOR", "TO", "BY", "DO",
  "END_FOR", "WHILE", "END_WHILE", "REPEAT", "UNTIL", "END_REPEAT", "EXIT", "RETURN", "CONTINUE",
  "TYPE", "END_TYPE", "STRUCT", "END_STRUCT", "ARRAY", "AND", "OR", "XOR", "NOT", "MOD", "TRUE", "FALSE",
  "CONFIGURATION", "END_CONFIGURATION", "RESOURCE", "END_RESOURCE", "JMP",
]);
/** Từ khoá kết thúc một danh sách lệnh (không bao giờ mở đầu một lệnh). */
const LIST_STOP = new Set([
  "END_IF", "ELSIF", "ELSE", "END_CASE", "END_FOR", "END_WHILE", "UNTIL", "END_REPEAT",
  "END_PROGRAM", "END_FUNCTION", "END_FUNCTION_BLOCK", "END_VAR", "END_TYPE", "END_STRUCT",
  "PROGRAM", "FUNCTION", "FUNCTION_BLOCK", "TYPE", "CONFIGURATION", "END_CONFIGURATION",
  ...VAR_KW, ...Object.keys(UNSUPPORTED_BLOCKS), ...Object.values(UNSUPPORTED_BLOCKS),
]);
/** Điểm dừng khi đồng bộ lại sau lỗi trong một lệnh. */
const SYNC_STOP = new Set([...LIST_STOP, "IF", "CASE", "FOR", "WHILE", "REPEAT"]);

const MAX_NESTING = 200;
/** Toán tử dành riêng có dạng gọi hàm chuẩn (fix round 1). */
const OPERATOR_FUNCS = new Set(["MOD", "AND", "OR", "XOR"]);
const quote = (t: Tok) => (t.k === "eof" ? "end of file" : `'${t.t}'`);
const qParam = (t: Tok) => (t.k === "eof" ? "EOF" : t.t);

// ═════════════════════════════════════════════════════════════════════════════
// Parser
// ═════════════════════════════════════════════════════════════════════════════
class Parser {
  private p = 0;
  readonly pous: Ctx[] = [];
  readonly global: Ctx = { kind: "GLOBAL", name: "", vars: new Map(), refs: [], assignTargets: [] };
  readonly types = new Map<string, TypeDef>();
  readonly fragmentStmts: Tok[] = [];
  assignments = 0;
  private cur: Ctx = this.global;
  /** Các END_* mà khối bao ngoài đang chờ (để không "nuốt" END của khối cha khi phục hồi). */
  private endStack: string[] = [];

  constructor(private toks: Tok[], private diag: (d: StDiagnostic) => void) {}

  // ── tiện ích ──
  private peek(o = 0): Tok { return this.toks[Math.min(this.p + o, this.toks.length - 1)]; }
  private next(): Tok { const t = this.peek(); if (t.k !== "eof") this.p++; return t; }
  private prev(): Tok { return this.toks[Math.max(0, this.p - 1)]; }
  private isOp(t: Tok, op: string) { return t.k === "op" && t.t === op; }
  private isKw(t: Tok, kw: string) { return t.k === "id" && t.u === kw; }
  private isIdent(t: Tok) { return t.k === "id" && !RESERVED.has(t.u); }
  private error(t: Tok, code: StDiagCode, message: string, params?: StDiagnostic["params"], at?: { line: number; col: number }) {
    this.diag({ severity: "error", code, message, line: at?.line ?? t.line, col: at?.col ?? t.col, params });
  }
  /** Vị trí báo cho "thiếu X ở cuối dòng": cuối token trước nếu token hiện tại đã sang dòng mới. */
  private eolPos(): { line: number; col: number } | undefined {
    const cur = this.peek(), pr = this.prev();
    if (this.p > 0 && cur.line !== pr.endLine) return { line: pr.endLine, col: pr.endCol };
    return undefined;
  }
  private expectOp(op: string): Tok {
    const t = this.peek();
    if (this.isOp(t, op)) return this.next();
    this.error(t, "stExpected", `Expected '${op}', found ${quote(t)}.`, { expected: op, found: qParam(t) }, this.eolPos());
    throw new StBail();
  }
  /** Từ khoá "cuối dòng" (THEN/DO/OF/TO) thiếu ⇒ báo rồi đi tiếp như thể có. */
  private expectKwSoft(kw: string): void {
    const t = this.peek();
    if (this.isKw(t, kw)) { this.next(); return; }
    this.error(t, "stExpected", `Expected ${kw}, found ${quote(t)}.`, { expected: kw, found: qParam(t) }, this.eolPos());
  }
  private expectIdent(): Tok {
    const t = this.peek();
    if (this.isIdent(t)) return this.next();
    this.error(t, "stExpectedIdent", `Expected an identifier, found ${quote(t)}.`, { found: qParam(t) });
    throw new StBail();
  }
  private expectSemi(): void {
    const t = this.peek();
    if (this.isOp(t, ";")) { this.next(); return; }
    const pr = this.prev();
    this.error(t, "stMissingSemicolon", `Missing ';' after statement (found ${quote(t)}).`, { found: qParam(t) }, { line: pr.endLine, col: pr.endCol });
  }
  /** Đóng khối: đúng END ⇒ nuốt; END lạ không ai chờ ⇒ báo + nuốt; còn lại ⇒ báo, KHÔNG nuốt. */
  private closeBlock(end: string, open: Tok): void {
    const t = this.peek();
    this.endStack.pop();
    if (this.isKw(t, end)) { this.next(); return; }
    const params = { block: open.u, openLine: open.line, expected: end, found: qParam(t) };
    const msg = `${open.u} opened at line ${open.line} is not closed: expected ${end}, found ${quote(t)}.`;
    this.error(t, "stNotClosed", msg, params);
    if (t.k === "id" && /^END_/.test(t.u) && !this.endStack.includes(t.u)) this.next();
  }
  private skipUntil(stop: (t: Tok) => boolean): void {
    while (this.peek().k !== "eof" && !stop(this.peek())) this.next();
  }
  /** Đồng bộ lại sau lỗi trong một lệnh: tới ';' (nuốt) hoặc từ khoá khối (không nuốt). */
  private syncStatement(): void {
    const startLine = this.peek().line;
    while (true) {
      const t = this.peek();
      if (t.k === "eof") return;
      if (this.isOp(t, ";")) { this.next(); return; }
      if (t.k === "id" && SYNC_STOP.has(t.u)) return;
      // Lệnh gán mới ở dòng sau (`X :=`) — đừng nuốt cả dòng lành phía sau.
      if (t.line > startLine && this.isIdent(t) && this.isOp(this.peek(1), ":=")) return;
      this.next();
    }
  }
  private guard(fn: () => void, stops: string[]): void {
    try { fn(); } catch (e) {
      if (!(e instanceof StBail)) throw e;
      this.skipUntil((t) => (t.k === "id" && (stops.includes(t.u) || LIST_STOP.has(t.u))) || this.isOp(t, ";"));
    }
  }

  // ── đơn vị biên dịch ──
  parseUnit(): void {
    while (this.peek().k !== "eof") {
      const t = this.peek();
      if (t.k === "id" && POU_KW[t.u]) { this.parsePou(); continue; }
      if (this.isKw(t, "TYPE")) { this.parseTypeSection(); continue; }
      if (t.k === "id" && VAR_KW.has(t.u)) { this.cur = this.global; this.parseVarBlock(); continue; }
      if (this.isKw(t, "CONFIGURATION")) { this.skipBlock(t, "END_CONFIGURATION", false); continue; }
      if (t.k === "id" && UNSUPPORTED_BLOCKS[t.u]) { this.skipBlock(t, UNSUPPORTED_BLOCKS[t.u], true); continue; }
      // Lệnh ở cấp cao nhất = "mảnh" (skeleton) — hợp lệ chỉ khi tệp không có POU.
      this.cur = this.global;
      const before = this.p;
      this.fragmentStmts.push(t);
      this.parseStmts(new Set());
      if (this.p === before) {
        const s = this.next();
        this.error(s, "stUnexpected", `Unexpected ${quote(s)}.`, { found: qParam(s) });
      }
    }
  }

  private skipBlock(open: Tok, end: string, unsupported: boolean): void {
    this.next();
    if (unsupported) {
      this.error(open, "stUnsupported", `${open.u} is not supported by the OpenPLC (IEC 61131-3) target.`, { construct: open.u });
    } else {
      this.diag({ severity: "warning", code: "stUnchecked", message: `${open.u} block is not checked.`, line: open.line, col: open.col, params: { construct: open.u } });
    }
    this.skipUntil((t) => this.isKw(t, end));
    if (this.isKw(this.peek(), end)) { this.next(); return; }
    const t = this.peek();
    this.error(t, "stNotClosed", `${open.u} opened at line ${open.line} is not closed: expected ${end}, found ${quote(t)}.`, { block: open.u, openLine: open.line, expected: end, found: qParam(t) });
  }

  private parsePou(): void {
    const kw = this.next();
    const end = POU_KW[kw.u];
    const ctx: Ctx = { kind: kw.u as Ctx["kind"], name: "?", vars: new Map(), refs: [], assignTargets: [] };
    this.pous.push(ctx);
    this.cur = ctx;
    this.endStack.push(end);
    try {
      const nameTok = this.expectIdent();
      ctx.name = nameTok.u;
      ctx.nameTok = nameTok;
      if (kw.u === "FUNCTION") {
        if (this.isOp(this.peek(), ":")) { this.next(); ctx.retType = this.parseTypeSpec(); }
        else { const t = this.peek(); this.error(t, "stExpected", `Expected ':' and a return type after FUNCTION ${nameTok.t}, found ${quote(t)}.`, { expected: ":", found: qParam(t) }); }
      }
      if (kw.u === "FUNCTION_BLOCK" && (this.isKw(this.peek(), "EXTENDS") || this.isKw(this.peek(), "IMPLEMENTS"))) {
        const t = this.next();
        this.error(t, "stUnsupported", `${t.u} is not supported by the OpenPLC (IEC 61131-3) target.`, { construct: t.u });
        this.skipUntil((x) => x.line !== t.line);
      }
    } catch (e) {
      if (!(e instanceof StBail)) throw e;
      this.skipUntil((t) => t.line !== kw.line);
    }
    while (true) {
      while (this.peek().k === "id" && VAR_KW.has(this.peek().u)) this.parseVarBlock();
      this.parseStmts(new Set([end]));
      const t = this.peek();
      if (t.k === "id" && VAR_KW.has(t.u)) {
        this.error(t, "stUnexpected", `Unexpected ${t.u}: declarations must come before the statements.`, { found: t.u });
        continue;
      }
      break;
    }
    this.closeBlock(end, kw);
    this.cur = this.global;
  }

  private parseVarBlock(): void {
    const kw = this.next();
    let constant = false;
    while (this.peek().k === "id" && VAR_QUAL.has(this.peek().u)) {
      if (this.next().u === "CONSTANT") constant = true;
    }
    while (true) {
      const t = this.peek();
      if (t.k === "eof" || this.isKw(t, "END_VAR")) break;
      if (t.k === "id" && (LIST_STOP.has(t.u) || RESERVED.has(t.u))) break;
      if (this.isIdent(t) && (this.isOp(this.peek(1), ":=") || this.isOp(this.peek(1), "(") || this.isOp(this.peek(1), "["))) break;
      try {
        this.parseVarDecl(kw.u, constant, this.cur.vars);
      } catch (e) {
        if (!(e instanceof StBail)) throw e;
        this.skipUntil((x) => this.isOp(x, ";") || (x.k === "id" && (x.u === "END_VAR" || LIST_STOP.has(x.u))));
        if (this.isOp(this.peek(), ";")) this.next();
      }
    }
    if (this.isKw(this.peek(), "END_VAR")) { this.next(); return; }
    const t = this.peek();
    this.error(t, "stNotClosed", `${kw.u} opened at line ${kw.line} is not closed: expected END_VAR, found ${quote(t)}.`, { block: kw.u, openLine: kw.line, expected: "END_VAR", found: qParam(t) });
  }

  private parseVarDecl(section: string, constant: boolean, into: Map<string, VarInfo>): void {
    const names = [this.expectIdent()];
    while (this.isOp(this.peek(), ",")) { this.next(); names.push(this.expectIdent()); }
    if (this.isKw(this.peek(), "AT")) {
      this.next();
      const a = this.peek();
      if (a.k !== "addr") { this.error(a, "stExpected", `Expected a direct address after AT, found ${quote(a)}.`, { expected: "%…", found: qParam(a) }); throw new StBail(); }
      this.next();
    }
    this.expectOp(":");
    const type = this.parseTypeSpec();
    // IEC 61131-3 bảng 16: `clk : BOOL R_EDGE;` / `F_EDGE` — CHỈ trong VAR_INPUT (fix round 1).
    const edge = this.peek();
    if (edge.k === "id" && (edge.u === "R_EDGE" || edge.u === "F_EDGE")) {
      this.next();
      if (section !== "VAR_INPUT") {
        this.error(edge, "stEdgeNotInput", `${edge.u} is only allowed on a VAR_INPUT declaration (found in ${section}).`, { edge: edge.u, section });
      }
    }
    if (this.isOp(this.peek(), ":=")) { this.next(); this.parseInitializer(); }
    for (const nt of names) this.declare(into, { name: nt.u, tok: nt, type, section, constant });
    this.expectSemi();
  }

  private declare(into: Map<string, VarInfo>, v: VarInfo): void {
    if (into.has(v.name)) {
      this.error(v.tok, "stDuplicate", `'${v.tok.t}' is declared more than once.`, { name: v.tok.t });
      return;
    }
    into.set(v.name, v);
  }

  private parseTypeSpec(): TypeRef {
    const t = this.peek();
    if (this.isKw(t, "ARRAY")) {
      this.next();
      this.expectOp("[");
      do {
        if (this.isOp(this.peek(), "*")) { this.next(); continue; }
        this.parseExpr();
        this.expectOp("..");
        this.parseExpr();
      } while (this.isOp(this.peek(), ",") && this.next());
      this.expectOp("]");
      if (!this.isKw(this.peek(), "OF")) { const x = this.peek(); this.error(x, "stExpected", `Expected OF, found ${quote(x)}.`, { expected: "OF", found: qParam(x) }); throw new StBail(); }
      this.next();
      return { kind: "array", elem: this.parseTypeSpec() };
    }
    if (this.isOp(t, "(")) {
      this.next();
      const values: string[] = [];
      do {
        values.push(this.expectIdent().u);
        if (this.isOp(this.peek(), ":=")) { this.next(); this.parseExpr(); }
      } while (this.isOp(this.peek(), ",") && this.next());
      this.expectOp(")");
      return { kind: "enum", values };
    }
    if (this.isKw(t, "STRUCT")) {
      this.next();
      const fields = new Map<string, VarInfo>();
      while (!this.isKw(this.peek(), "END_STRUCT") && this.peek().k !== "eof" && !(this.peek().k === "id" && LIST_STOP.has(this.peek().u))) {
        try { this.parseVarDecl("STRUCT", false, fields); } catch (e) {
          if (!(e instanceof StBail)) throw e;
          this.skipUntil((x) => this.isOp(x, ";") || this.isKw(x, "END_STRUCT") || (x.k === "id" && LIST_STOP.has(x.u)));
          if (this.isOp(this.peek(), ";")) this.next();
        }
      }
      if (this.isKw(this.peek(), "END_STRUCT")) this.next();
      else { const x = this.peek(); this.error(x, "stNotClosed", `STRUCT opened at line ${t.line} is not closed: expected END_STRUCT, found ${quote(x)}.`, { block: "STRUCT", openLine: t.line, expected: "END_STRUCT", found: qParam(x) }); }
      return { kind: "struct", fields };
    }
    if (t.k === "id" && (t.u === "POINTER" || t.u === "REFERENCE")) {
      this.next();
      if (!this.isKw(this.peek(), "TO")) { const x = this.peek(); this.error(x, "stExpected", `Expected TO, found ${quote(x)}.`, { expected: "TO", found: qParam(x) }); throw new StBail(); }
      this.next();
      return { kind: "pointer", to: this.parseTypeSpec() };
    }
    if (t.k === "id" && t.u === "REF_TO") { this.next(); return { kind: "pointer", to: this.parseTypeSpec() }; }
    if (t.k === "id" && (t.u === "STRING" || t.u === "WSTRING")) {
      this.next();
      if (this.isOp(this.peek(), "[")) { this.next(); this.parseExpr(); this.expectOp("]"); }
      else if (this.isOp(this.peek(), "(")) { this.next(); this.parseExpr(); this.expectOp(")"); }
      return { kind: "string" };
    }
    if (this.isIdent(t)) {
      this.next();
      // Kiểu khoảng con: INT (0..100)
      if (this.isOp(this.peek(), "(") && ELEMENTARY_TYPES.has(t.u)) {
        this.next(); this.parseExpr(); this.expectOp(".."); this.parseExpr(); this.expectOp(")");
      }
      return { kind: "named", name: t.u, tok: t };
    }
    this.error(t, "stExpectedType", `Expected a type, found ${quote(t)}.`, { found: qParam(t) });
    throw new StBail();
  }

  private parseInitializer(): void {
    const t = this.peek();
    if (this.isOp(t, "[")) {
      this.next();
      if (!this.isOp(this.peek(), "]")) {
        do {
          if (this.peek().k === "int" && this.isOp(this.peek(1), "(")) {
            this.next(); this.next();
            if (!this.isOp(this.peek(), ")")) this.parseInitializer();
            this.expectOp(")");
          } else {
            this.parseInitializer();
          }
        } while (this.isOp(this.peek(), ",") && this.next());
      }
      this.expectOp("]");
      return;
    }
    if (this.isOp(t, "(") && this.isIdent(this.peek(1)) && this.isOp(this.peek(2), ":=")) {
      this.next();
      do {
        this.expectIdent();
        this.expectOp(":=");
        this.parseInitializer();
      } while (this.isOp(this.peek(), ",") && this.next());
      this.expectOp(")");
      return;
    }
    this.parseExpr();
  }

  private parseTypeSection(): void {
    const kw = this.next();
    this.cur = this.global;
    while (!this.isKw(this.peek(), "END_TYPE") && this.peek().k !== "eof") {
      const t = this.peek();
      if (t.k === "id" && LIST_STOP.has(t.u)) break;
      try {
        const name = this.expectIdent();
        this.expectOp(":");
        const type = this.parseTypeSpec();
        if (this.isOp(this.peek(), ":=")) { this.next(); this.parseInitializer(); }
        if (this.types.has(name.u)) this.error(name, "stDuplicate", `'${name.t}' is declared more than once.`, { name: name.t });
        else this.types.set(name.u, { name: name.u, tok: name, type });
        this.expectSemi();
      } catch (e) {
        if (!(e instanceof StBail)) throw e;
        this.skipUntil((x) => this.isOp(x, ";") || this.isKw(x, "END_TYPE") || (x.k === "id" && LIST_STOP.has(x.u)));
        if (this.isOp(this.peek(), ";")) this.next();
      }
    }
    if (this.isKw(this.peek(), "END_TYPE")) { this.next(); return; }
    const x = this.peek();
    this.error(x, "stNotClosed", `TYPE opened at line ${kw.line} is not closed: expected END_TYPE, found ${quote(x)}.`, { block: "TYPE", openLine: kw.line, expected: "END_TYPE", found: qParam(x) });
  }

  // ── lệnh ──
  private isCaseLabelStart(): boolean {
    const t = this.peek(), n1 = this.peek(1);
    if (t.k === "int" || t.k === "typed" || this.isOp(t, "-")) return true;
    if (this.isIdent(t)) {
      if (this.isOp(n1, ":") || this.isOp(n1, ",") || this.isOp(n1, "..")) return true;
      if (this.isOp(n1, ".") && this.isIdent(this.peek(2)) && (this.isOp(this.peek(3), ":") || this.isOp(this.peek(3), ","))) return true;
    }
    return false;
  }

  private parseStmts(terms: Set<string>, caseMode = false): void {
    while (true) {
      const t = this.peek();
      if (t.k === "eof") return;
      if (t.k === "id" && terms.has(t.u)) return;
      if (caseMode && this.isCaseLabelStart()) return;
      if (t.k === "id" && LIST_STOP.has(t.u)) {
        // END_* không khối nào đang chờ ⇒ END lạc: báo + bỏ qua. Còn lại ⇒ trả cho khối cha.
        if (/^END_/.test(t.u) && !this.endStack.includes(t.u) && !terms.has(t.u) && !["END_VAR", "END_TYPE", "END_STRUCT"].includes(t.u)) {
          this.error(t, "stUnexpected", `Unexpected ${t.u}.`, { found: t.u });
          this.next();
          if (this.isOp(this.peek(), ";")) this.next();
          continue;
        }
        return;
      }
      const before = this.p;
      const depth = this.endStack.length;
      try {
        this.parseStmt();
      } catch (e) {
        if (!(e instanceof StBail)) throw e;
        this.endStack.length = depth;
        this.syncStatement();
      }
      if (this.p === before) this.next();
    }
  }

  private parseStmt(): void {
    const t = this.peek();
    if (this.isOp(t, ";")) { this.next(); return; }
    if (t.k === "id" && this.endStack.length > MAX_NESTING && ["IF", "CASE", "FOR", "WHILE", "REPEAT"].includes(t.u)) {
      this.error(t, "stUnexpected", `Statements nested too deeply (more than ${MAX_NESTING} levels).`, { found: qParam(t) });
      throw new StBail();
    }
    if (t.k === "id") {
      switch (t.u) {
        case "IF": return this.parseIf();
        case "CASE": return this.parseCase();
        case "FOR": return this.parseFor();
        case "WHILE": return this.parseWhile();
        case "REPEAT": return this.parseRepeat();
        case "EXIT": case "RETURN": case "CONTINUE":
          this.next(); this.expectSemi(); return;
      }
    }
    if (!(this.isIdent(t) || t.k === "addr")) {
      this.error(t, "stUnexpected", `Unexpected ${quote(t)} at the start of a statement.`, { found: qParam(t) });
      throw new StBail();
    }
    const d = this.parseDesignator();
    const n = this.peek();
    if (this.isOp(n, ":=")) {
      this.next();
      this.parseExpr();
      this.cur.assignTargets.push(d);
      this.assignments++;
      this.expectSemi();
      return;
    }
    const last = d.parts[d.parts.length - 1];
    if (last && last.kind === "call") { this.expectSemi(); return; }
    this.error(n, "stExpected", `Expected ':=' or a call after '${t.t}', found ${quote(n)}.`, { expected: ":=", found: qParam(n) }, this.eolPos());
    throw new StBail();
  }

  private parseIf(): void {
    const kw = this.next();
    this.endStack.push("END_IF");
    this.guard(() => this.parseExpr(), ["THEN"]);
    this.expectKwSoft("THEN");
    this.parseStmts(new Set(["ELSIF", "ELSE", "END_IF"]));
    while (this.isKw(this.peek(), "ELSIF")) {
      this.next();
      this.guard(() => this.parseExpr(), ["THEN"]);
      this.expectKwSoft("THEN");
      this.parseStmts(new Set(["ELSIF", "ELSE", "END_IF"]));
    }
    if (this.isKw(this.peek(), "ELSE")) { this.next(); this.parseStmts(new Set(["END_IF"])); }
    this.closeBlock("END_IF", kw);
  }

  private parseCase(): void {
    const kw = this.next();
    this.endStack.push("END_CASE");
    this.guard(() => this.parseExpr(), ["OF"]);
    this.expectKwSoft("OF");
    while (true) {
      const t = this.peek();
      if (this.isKw(t, "ELSE")) { this.next(); this.parseStmts(new Set(["END_CASE"])); break; }
      if (this.isKw(t, "END_CASE") || t.k === "eof") break;
      if (t.k === "id" && LIST_STOP.has(t.u)) break;
      const before = this.p;
      try {
        do {
          this.parseExpr();
          if (this.isOp(this.peek(), "..")) { this.next(); this.parseExpr(); }
        } while (this.isOp(this.peek(), ",") && this.next());
        this.expectOp(":");
      } catch (e) {
        if (!(e instanceof StBail)) throw e;
        this.syncStatement();
        if (this.p === before) this.next();
        continue;
      }
      this.parseStmts(new Set(["ELSE", "END_CASE"]), true);
    }
    this.closeBlock("END_CASE", kw);
  }

  private parseFor(): void {
    const kw = this.next();
    this.endStack.push("END_FOR");
    this.guard(() => {
      const v = this.expectIdent();
      this.cur.refs.push({ base: v, parts: [] });
      this.cur.assignTargets.push({ base: v, parts: [] });
      this.expectOp(":=");
      this.parseExpr();
      if (!this.isKw(this.peek(), "TO")) { const x = this.peek(); this.error(x, "stExpected", `Expected TO, found ${quote(x)}.`, { expected: "TO", found: qParam(x) }); throw new StBail(); }
      this.next();
      this.parseExpr();
      if (this.isKw(this.peek(), "BY")) { this.next(); this.parseExpr(); }
    }, ["DO"]);
    this.expectKwSoft("DO");
    this.parseStmts(new Set(["END_FOR"]));
    this.closeBlock("END_FOR", kw);
  }

  private parseWhile(): void {
    const kw = this.next();
    this.endStack.push("END_WHILE");
    this.guard(() => this.parseExpr(), ["DO"]);
    this.expectKwSoft("DO");
    this.parseStmts(new Set(["END_WHILE"]));
    this.closeBlock("END_WHILE", kw);
  }

  private parseRepeat(): void {
    const kw = this.next();
    this.endStack.push("END_REPEAT");
    this.parseStmts(new Set(["UNTIL", "END_REPEAT"]));
    if (this.isKw(this.peek(), "UNTIL")) {
      this.next();
      this.guard(() => this.parseExpr(), ["END_REPEAT"]);
    } else {
      const t = this.peek();
      this.error(t, "stExpected", `REPEAT opened at line ${kw.line} has no UNTIL condition (found ${quote(t)}).`, { expected: "UNTIL", found: qParam(t) });
    }
    this.closeBlock("END_REPEAT", kw);
  }

  // ── biểu thức ──
  private parseDesignator(): Designator {
    const base = this.next();
    const d: Designator = { base, parts: [] };
    while (true) {
      const t = this.peek();
      if (this.isOp(t, ".")) {
        this.next();
        const m = this.peek();
        if (m.k === "id" || m.k === "int" || m.k === "addr") { this.next(); d.parts.push({ kind: "member", tok: m }); continue; }
        this.error(m, "stExpectedIdent", `Expected a member name after '.', found ${quote(m)}.`, { found: qParam(m) });
        throw new StBail();
      }
      if (this.isOp(t, "[")) {
        this.next();
        do { this.parseExpr(); } while (this.isOp(this.peek(), ",") && this.next());
        this.expectOp("]");
        d.parts.push({ kind: "index" });
        continue;
      }
      if (this.isOp(t, "^")) { this.next(); d.parts.push({ kind: "deref" }); continue; }
      if (this.isOp(t, "(")) {
        this.next();
        const args: CallArg[] = [];
        if (!this.isOp(this.peek(), ")")) {
          do {
            const a = this.peek();
            if (this.isIdent(a) && this.isOp(this.peek(1), ":=")) {
              this.next(); this.next();
              this.parseExpr();
              args.push({ name: a, dir: "in" });
            } else if (this.isIdent(a) && this.isOp(this.peek(1), "=>")) {
              this.next(); this.next();
              const target = this.peek();
              if (!(this.isIdent(target) || target.k === "addr")) {
                this.error(target, "stExpectedIdent", `Expected a variable after '=>', found ${quote(target)}.`, { found: qParam(target) });
                throw new StBail();
              }
              const out = this.parseDesignator();
              this.cur.assignTargets.push(out);
              args.push({ name: a, dir: "out" });
            } else {
              this.parseExpr();
              args.push({ dir: "pos" });
            }
          } while (this.isOp(this.peek(), ",") && this.next());
        }
        this.expectOp(")");
        d.parts.push({ kind: "call", tok: t, args });
        continue;
      }
      break;
    }
    this.cur.refs.push(d);
    return d;
  }

  private depth = 0;
  parseExpr(): void {
    // Chặn tràn ngăn xếp với lồng bệnh lý (vd hàng nghìn '(') — lỗi cú pháp, không phải RangeError.
    if (++this.depth > MAX_NESTING) {
      this.depth--;
      const t = this.peek();
      this.error(t, "stUnexpected", `Expression nested too deeply (more than ${MAX_NESTING} levels).`, { found: qParam(t) });
      throw new StBail();
    }
    try { this.parseBinary(0); } finally { this.depth--; }
  }

  private static readonly LEVELS: Array<(p: Parser, t: Tok) => boolean> = [
    (p, t) => p.isKw(t, "OR"),
    (p, t) => p.isKw(t, "XOR"),
    (p, t) => p.isKw(t, "AND") || p.isOp(t, "&"),
    (p, t) => p.isOp(t, "=") || p.isOp(t, "<>"),
    (p, t) => p.isOp(t, "<") || p.isOp(t, ">") || p.isOp(t, "<=") || p.isOp(t, ">="),
    (p, t) => p.isOp(t, "+") || p.isOp(t, "-"),
    (p, t) => p.isOp(t, "*") || p.isOp(t, "/") || p.isKw(t, "MOD"),
    (p, t) => p.isOp(t, "**"),
  ];

  private parseBinary(level: number): void {
    if (level >= Parser.LEVELS.length) { this.parseUnary(); return; }
    this.parseBinary(level + 1);
    while (Parser.LEVELS[level](this, this.peek())) {
      this.next();
      this.parseBinary(level + 1);
    }
  }

  private parseUnary(): void {
    const t = this.peek();
    if (this.isOp(t, "-") || this.isOp(t, "+") || this.isKw(t, "NOT")) { this.next(); this.parseUnary(); return; }
    this.parsePrimary();
  }

  private parsePrimary(): void {
    const t = this.peek();
    if (t.k === "int" || t.k === "real" || t.k === "str" || t.k === "typed") { this.next(); return; }
    if (this.isKw(t, "TRUE") || this.isKw(t, "FALSE")) { this.next(); return; }
    if (this.isOp(t, "(")) { this.next(); this.parseExpr(); this.expectOp(")"); return; }
    // Dạng HÀM của toán tử dành riêng (IEC bảng 24/26): `MOD(a, b)`, `AND(a, b)`, `OR(…)`, `XOR(…)`.
    // Chỉ ở vị trí toán hạng + ngay sau là '(' — `a AND (b)` đã được vòng nhị phân nuốt AND trước.
    // (`NOT(x)` đã đúng qua nhánh một ngôi.)
    if (t.k === "id" && OPERATOR_FUNCS.has(t.u) && this.isOp(this.peek(1), "(")) {
      this.next();
      this.next();
      if (!this.isOp(this.peek(), ")")) {
        do {
          if (this.isIdent(this.peek()) && this.isOp(this.peek(1), ":=")) { this.next(); this.next(); }
          this.parseExpr();
        } while (this.isOp(this.peek(), ",") && this.next());
      }
      this.expectOp(")");
      return;
    }
    if (this.isIdent(t) || t.k === "addr") { this.parseDesignator(); return; }
    this.error(t, "stExpectedExpr", `Expected an expression, found ${quote(t)}.`, { found: qParam(t) });
    throw new StBail();
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Ngữ nghĩa tối thiểu
// ═════════════════════════════════════════════════════════════════════════════
interface StdFb { inputs: Record<string, string>; outputs: Record<string, string> }
/** FB chuẩn IEC 61131-3 (bảng 43–45): tên tham số → kiểu. */
export const STD_FB: Record<string, StdFb> = {
  TON: { inputs: { IN: "BOOL", PT: "TIME" }, outputs: { Q: "BOOL", ET: "TIME" } },
  TOF: { inputs: { IN: "BOOL", PT: "TIME" }, outputs: { Q: "BOOL", ET: "TIME" } },
  TP: { inputs: { IN: "BOOL", PT: "TIME" }, outputs: { Q: "BOOL", ET: "TIME" } },
  CTU: { inputs: { CU: "BOOL", R: "BOOL", PV: "INT" }, outputs: { Q: "BOOL", CV: "INT" } },
  CTD: { inputs: { CD: "BOOL", LD: "BOOL", PV: "INT" }, outputs: { Q: "BOOL", CV: "INT" } },
  CTUD: { inputs: { CU: "BOOL", CD: "BOOL", R: "BOOL", LD: "BOOL", PV: "INT" }, outputs: { QU: "BOOL", QD: "BOOL", CV: "INT" } },
  R_TRIG: { inputs: { CLK: "BOOL" }, outputs: { Q: "BOOL" } },
  F_TRIG: { inputs: { CLK: "BOOL" }, outputs: { Q: "BOOL" } },
  SR: { inputs: { S1: "BOOL", R: "BOOL" }, outputs: { Q1: "BOOL" } },
  RS: { inputs: { S: "BOOL", R1: "BOOL" }, outputs: { Q1: "BOOL" } },
};

/**
 * Hàm chuẩn IEC 61131-3 (ed.2 bảng 22–36 + ed.3) và hàm matiec/OpenPLC ship sẵn. Danh sách THIẾU = lỗi
 * cứng "Undeclared" trên chương trình hợp lệ (fix round 1: ADD_TIME…, DATE_AND_TIME_TO_TIME_OF_DAY) —
 * thêm hàm chuẩn vào đây, đừng nới mẫu thành "mọi thứ".
 */
const STD_FUNCTIONS = new Set([
  // số học / lượng giác (bảng 23–24) + dạng hàm của toán tử
  "ABS", "SQRT", "LN", "LOG", "EXP", "SIN", "COS", "TAN", "ASIN", "ACOS", "ATAN", "ATAN2", "EXPT",
  "ADD", "SUB", "MUL", "DIV", "MOD", "MOVE",
  // bit (bảng 25–26): dịch/xoay + dạng hàm của toán tử logic
  "SHL", "SHR", "ROL", "ROR", "AND", "OR", "XOR", "NOT",
  // chọn (bảng 27) + so sánh (bảng 28)
  "SEL", "MAX", "MIN", "LIMIT", "MUX", "GT", "GE", "EQ", "LE", "LT", "NE",
  // chuỗi (bảng 29)
  "LEN", "LEFT", "RIGHT", "MID", "CONCAT", "INSERT", "DELETE", "REPLACE", "FIND",
  // thời gian (bảng 30) — tên ed.2 + ed.3 (L* = 64 bit)
  "ADD_TIME", "ADD_LTIME", "SUB_TIME", "SUB_LTIME", "MULTIME", "DIVTIME", "MUL_TIME", "DIV_TIME", "MUL_LTIME", "DIV_LTIME",
  "ADD_TOD_TIME", "ADD_LTOD_LTIME", "ADD_DT_TIME", "ADD_LDT_LTIME",
  "SUB_DATE_DATE", "SUB_LDATE_LDATE", "SUB_TOD_TIME", "SUB_LTOD_LTIME", "SUB_TOD_TOD", "SUB_LTOD_LTOD",
  "SUB_DT_TIME", "SUB_LDT_LTIME", "SUB_DT_DT", "SUB_LDT_LDT",
  "CONCAT_DATE_TOD", "CONCAT_DATE_LTOD", "CONCAT_DATE", "CONCAT_TOD", "CONCAT_LTOD", "CONCAT_DT", "CONCAT_LDT",
  "SPLIT_DATE", "SPLIT_TOD", "SPLIT_LTOD", "SPLIT_DT", "SPLIT_LDT", "DAY_OF_WEEK",
  // chuyển đổi đặc biệt (bảng 22) — `*_TO_*` nhận theo mẫu bên dưới
  "TRUNC", "ROUND", "IS_VALID", "IS_VALID_BCD", "LOWER_BOUND", "UPPER_BOUND",
  // không chuẩn nhưng có trong matiec/CODESYS
  "SIZEOF", "ADR", "REF",
]);
const isStdFunction = (u: string) =>
  STD_FUNCTIONS.has(u) ||
  /^[A-Z_]+_TO_[A-Z_]+$/.test(u) ||                 // INT_TO_REAL, DATE_AND_TIME_TO_TIME_OF_DAY, WORD_BCD_TO_INT
  /^(?:TO|FROM)_[A-Z_]+$/.test(u) ||                // TO_INT, TO_BIG_ENDIAN, FROM_LITTLE_ENDIAN
  /^(?:[A-Z]+_)?TRUNC_[A-Z]+$/.test(u) ||           // TRUNC_INT, REAL_TRUNC_DINT
  ELEMENTARY_TYPES.has(u);

type Resolved =
  | { kind: "stdfb"; name: string }
  | { kind: "userfb"; pou: Ctx }
  | { kind: "struct"; name: string; fields: Map<string, VarInfo> }
  | { kind: "enum"; name: string; values: string[] }
  | { kind: "elem"; name: string }
  | { kind: "array"; elem: TypeRef }
  | { kind: "pointer"; to: TypeRef }
  | { kind: "unknown" };

function analyse(parser: Parser, opts: StCheckOptions, diag: (d: StDiagnostic) => void): void {
  const pouByName = new Map(parser.pous.map((p) => [p.name, p]));
  const enumValues = new Set<string>();
  for (const td of parser.types.values()) if (td.type.kind === "enum") for (const v of td.type.values) enumValues.add(v);
  // enum khai báo tại chỗ trong VAR (vd `State : (Idle, Run);`)
  const collectInlineEnums = (vars: Map<string, VarInfo>) => {
    for (const v of vars.values()) if (v.type.kind === "enum") for (const e of v.type.values) enumValues.add(e);
  };
  collectInlineEnums(parser.global.vars);
  for (const p of parser.pous) collectInlineEnums(p.vars);
  const symbols = new Set((opts.symbols ?? []).map((s) => s.toUpperCase()));

  const err = (t: Tok, code: StDiagCode, message: string, params?: StDiagnostic["params"]) =>
    diag({ severity: "error", code, message, line: t.line, col: t.col, params });

  const resolveType = (t: TypeRef, depth = 0): Resolved => {
    if (depth > 16) return { kind: "unknown" };
    switch (t.kind) {
      case "array": return { kind: "array", elem: t.elem };
      case "string": return { kind: "elem", name: "STRING" };
      case "enum": return { kind: "enum", name: "(enum)", values: t.values };
      case "pointer": return { kind: "pointer", to: t.to };
      case "struct": return { kind: "struct", name: "STRUCT", fields: t.fields };
      case "named": {
        if (STD_FB[t.name]) return { kind: "stdfb", name: t.name };
        if (ELEMENTARY_TYPES.has(t.name)) return { kind: "elem", name: t.name };
        const pou = pouByName.get(t.name);
        if (pou && pou.kind === "FUNCTION_BLOCK") return { kind: "userfb", pou };
        const td = parser.types.get(t.name);
        if (td) {
          if (td.type.kind === "struct") return { kind: "struct", name: td.tok.t, fields: td.type.fields };
          if (td.type.kind === "enum") return { kind: "enum", name: td.tok.t, values: td.type.values };
          return resolveType(td.type, depth + 1);
        }
        return { kind: "unknown" };
      }
    }
  };
  const elemOfStd = (typeName: string): Resolved => ({ kind: "elem", name: typeName });

  // Kiểu lạ trong khai báo ⇒ CẢNH BÁO một lần/kiểu (thư viện hãng — không đoán, không chặn).
  const warnedTypes = new Set<string>();
  const checkDeclaredType = (t: TypeRef) => {
    if (t.kind === "array") return checkDeclaredType(t.elem);
    if (t.kind === "pointer") return checkDeclaredType(t.to);
    if (t.kind === "struct") { for (const f of t.fields.values()) checkDeclaredType(f.type); return; }
    if (t.kind !== "named") return;
    if (STD_FB[t.name] || ELEMENTARY_TYPES.has(t.name) || parser.types.has(t.name)) return;
    const pou = pouByName.get(t.name);
    if (pou && pou.kind === "FUNCTION_BLOCK") return;
    if (warnedTypes.has(t.name)) return;
    warnedTypes.add(t.name);
    diag({
      severity: "warning", code: "stUnknownType",
      message: `Unknown type '${t.tok.t}' — not a standard type or declared in this source; its members are not checked.`,
      line: t.tok.line, col: t.tok.col, params: { name: t.tok.t },
    });
  };
  for (const v of parser.global.vars.values()) checkDeclaredType(v.type);
  for (const td of parser.types.values()) checkDeclaredType(td.type);
  for (const p of parser.pous) {
    for (const v of p.vars.values()) checkDeclaredType(v.type);
    if (p.retType) checkDeclaredType(p.retType);
  }

  const memberNames = (r: Resolved): string[] => {
    if (r.kind === "stdfb") return [...Object.keys(STD_FB[r.name].inputs), ...Object.keys(STD_FB[r.name].outputs)];
    if (r.kind === "userfb") return [...r.pou.vars.values()].filter((v) => v.section !== "VAR_TEMP").map((v) => v.tok.t);
    if (r.kind === "struct") return [...r.fields.values()].map((v) => v.tok.t);
    return [];
  };
  const typeLabel = (r: Resolved): string =>
    r.kind === "stdfb" ? r.name
      : r.kind === "userfb" ? (r.pou.nameTok?.t ?? r.pou.name)
      : r.kind === "struct" || r.kind === "enum" || r.kind === "elem" ? r.name
      : r.kind === "array" ? "ARRAY" : r.kind === "pointer" ? "POINTER" : "?";

  const checkCall = (target: Resolved | { kind: "userfn"; pou: Ctx }, call: Extract<Part, { kind: "call" }>, label: string) => {
    let ins: string[] = [], outs: string[] = [];
    if (target.kind === "stdfb") { ins = Object.keys(STD_FB[target.name].inputs); outs = Object.keys(STD_FB[target.name].outputs); }
    else if (target.kind === "userfb" || target.kind === "userfn") {
      const vs = [...target.pou.vars.values()];
      ins = vs.filter((v) => v.section === "VAR_INPUT" || v.section === "VAR_IN_OUT").map((v) => v.tok.t);
      outs = vs.filter((v) => v.section === "VAR_OUTPUT").map((v) => v.tok.t);
    } else return;
    for (const a of call.args) {
      if (!a.name) continue;
      const list = a.dir === "in" ? ins : outs;
      if (list.some((x) => x.toUpperCase() === a.name!.u)) continue;
      const code: StDiagCode = a.dir === "in" ? "stBadInput" : "stBadOutput";
      const dirWord = a.dir === "in" ? "input" : "output";
      err(a.name, code, `'${label}' has no ${dirWord} parameter '${a.name.t}' (valid: ${list.join(", ") || "none"}).`, { type: label, param: a.name.t, valid: list.join(", ") || "-" });
    }
  };

  const checkCtx = (ctx: Ctx) => {
    const reported = new Set<string>();
    const lookup = (u: string): VarInfo | undefined => ctx.vars.get(u) ?? parser.global.vars.get(u);
    const seen = new Set<Designator>();
    for (const d of ctx.refs) {
      if (seen.has(d)) continue;
      seen.add(d);
      if (d.base.k === "addr") continue;
      const u = d.base.u;
      let cur: Resolved;
      const v = lookup(u);
      const firstCall = d.parts[0]?.kind === "call" ? (d.parts[0] as Extract<Part, { kind: "call" }>) : undefined;
      if (v) {
        cur = resolveType(v.type);
      } else if (ctx.kind === "FUNCTION" && u === ctx.name && ctx.retType) {
        cur = resolveType(ctx.retType);
      } else if (symbols.has(u)) {
        cur = { kind: "unknown" };
      } else if (parser.types.has(u) && parser.types.get(u)!.type.kind === "enum") {
        // `E_State.Idle` — tham chiếu enum có tiền tố kiểu
        const td = parser.types.get(u)!;
        const m = d.parts[0];
        if (m && m.kind === "member" && td.type.kind === "enum" && !td.type.values.includes(m.tok.u)) {
          err(m.tok, "stNoMember", `'${td.tok.t}' has no member '${m.tok.t}' (valid: ${td.type.values.join(", ")}).`, { type: td.tok.t, member: m.tok.t, valid: td.type.values.join(", ") });
        }
        continue;
      } else if (pouByName.has(u)) {
        const pou = pouByName.get(u)!;
        if (pou.kind === "FUNCTION") {
          if (firstCall) checkCall({ kind: "userfn", pou }, firstCall, pou.nameTok?.t ?? u);
          continue;
        }
        if (pou.kind === "FUNCTION_BLOCK") {
          err(d.base, "stFbTypeCall", `'${d.base.t}' is a function block type — declare an instance and use that.`, { name: d.base.t });
          continue;
        }
        continue; // PROGRAM: truy cập instance chương trình — không kiểm
      } else if (STD_FB[u]) {
        err(d.base, "stFbTypeCall", `'${d.base.t}' is a function block type — declare an instance and use that.`, { name: d.base.t });
        continue;
      } else if (firstCall && isStdFunction(u)) {
        continue;
      } else if (enumValues.has(u) && d.parts.length === 0) {
        continue;
      } else {
        if (!reported.has(u)) {
          reported.add(u);
          err(d.base, "stUndeclared", `Undeclared identifier '${d.base.t}'.`, { name: d.base.t });
        }
        continue;
      }

      let label = v ? v.tok.t : d.base.t;
      for (let i = 0; i < d.parts.length; i++) {
        const part = d.parts[i];
        if (cur.kind === "unknown") break;
        if (part.kind === "member") {
          const m = part.tok;
          if (cur.kind === "elem") {
            if (m.k === "int" && BIT_ADDRESSABLE.has(cur.name)) { cur = { kind: "elem", name: "BOOL" }; continue; }
            err(m, "stNoMember", `'${label}' is of type ${cur.name} and has no member '${m.t}'.`, { type: cur.name, member: m.t, valid: "-" });
            break;
          }
          if (cur.kind === "stdfb") {
            const fb = STD_FB[cur.name];
            const all = { ...fb.inputs, ...fb.outputs };
            if (m.k !== "id" || !(m.u in all)) {
              err(m, "stNoMember", `'${cur.name}' has no member '${m.t}' (valid: ${Object.keys(all).join(", ")}).`, { type: cur.name, member: m.t, valid: Object.keys(all).join(", ") });
              break;
            }
            cur = elemOfStd(all[m.u]);
            label = `${label}.${m.t}`;
            continue;
          }
          if (cur.kind === "userfb" || cur.kind === "struct") {
            const fields: Map<string, VarInfo> = cur.kind === "userfb" ? cur.pou.vars : cur.fields;
            const f = m.k === "id" ? fields.get(m.u) : undefined;
            if (!f || f.section === "VAR_TEMP") {
              const valid = memberNames(cur).join(", ");
              err(m, "stNoMember", `'${typeLabel(cur)}' has no member '${m.t}' (valid: ${valid}).`, { type: typeLabel(cur), member: m.t, valid: valid || "-" });
              break;
            }
            cur = resolveType(f.type);
            label = `${label}.${m.t}`;
            continue;
          }
          if (cur.kind === "array" || cur.kind === "enum") {
            err(m, "stNoMember", `'${label}' (${typeLabel(cur)}) has no member '${m.t}'.`, { type: typeLabel(cur), member: m.t, valid: "-" });
            break;
          }
          cur = { kind: "unknown" };
          continue;
        }
        if (part.kind === "index") {
          cur = cur.kind === "array" ? resolveType(cur.elem) : { kind: "unknown" };
          continue;
        }
        if (part.kind === "deref") {
          cur = cur.kind === "pointer" ? resolveType(cur.to) : { kind: "unknown" };
          continue;
        }
        if (part.kind === "call") {
          if (cur.kind === "stdfb" || cur.kind === "userfb") {
            checkCall(cur, part, cur.kind === "stdfb" ? cur.name : typeLabel(cur));
            cur = { kind: "unknown" };
            continue;
          }
          if (cur.kind === "pointer") { cur = { kind: "unknown" }; continue; }
          // Tên biến trùng (không phân biệt hoa thường) một hàm chuẩn: `Len : INT` rồi gọi `LEN(…)`.
          const hides = i === 0 && isStdFunction(u) ? ` (the variable '${label}' hides the standard function ${u})` : "";
          err(part.tok, "stNotCallable", `'${label}' is not a function or function block instance${hides}.`, { name: label });
          break;
        }
      }
    }
    // Gán vào hằng
    for (const d of ctx.assignTargets) {
      if (d.base.k !== "id" || d.parts.length > 0) continue;
      const v = lookup(d.base.u);
      if (v && v.constant) err(d.base, "stAssignConstant", `Cannot assign to constant '${d.base.t}'.`, { name: d.base.t });
    }
  };

  checkCtx(parser.global);
  for (const p of parser.pous) checkCtx(p);
}

// ═════════════════════════════════════════════════════════════════════════════
// API
// ═════════════════════════════════════════════════════════════════════════════
const MAX_DIAGNOSTICS = 60;

/** Kiểm một nguồn ST: cú pháp + ngữ nghĩa tối thiểu. Thuần, không I/O, không ném. */
export function checkStructuredText(src: string, opts: StCheckOptions = {}): StCheckResult {
  const diagnostics: StDiagnostic[] = [];
  const seen = new Set<string>();
  const push = (d: StDiagnostic) => {
    const key = `${d.line}:${d.col}:${d.severity}`;
    // Một lỗi mỗi vị trí — lỗi thứ hai cùng chỗ gần như luôn là hệ quả của lỗi đầu.
    if (d.severity === "error" && seen.has(key)) return;
    seen.add(key);
    diagnostics.push(d);
  };
  const toks = tokenize(src, push);
  const parser = new Parser(toks, push);
  parser.parseUnit();

  if (toks.length === 1) {
    push({ severity: "error", code: "stEmpty", message: "No POU or statement found (only comments/whitespace).", line: 1, col: 1 });
  }
  if (parser.pous.length > 0 && parser.fragmentStmts.length > 0) {
    const t = parser.fragmentStmts[0];
    push({ severity: "error", code: "stOutsidePou", message: "Statement outside of a PROGRAM / FUNCTION_BLOCK / FUNCTION.", line: t.line, col: t.col });
  }
  analyse(parser, opts, push);

  diagnostics.sort((a, b) => a.line - b.line || a.col - b.col);
  const capped = diagnostics.slice(0, MAX_DIAGNOSTICS);
  return {
    ok: !diagnostics.some((d) => d.severity === "error"),
    diagnostics: capped,
    assignments: parser.assignments,
    pous: parser.pous.map((p) => ({ kind: p.kind, name: p.nameTok?.t ?? p.name })),
  };
}
