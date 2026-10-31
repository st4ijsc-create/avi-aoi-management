/**
 * ★★★ SCADA R1b-2b-2b A — C2 fix round 3 (điều phối 2026-10-31, KD-2bA 2.1 — "né đường vòng") — CENSUS bề mặt CHI TIẾT KỸ THUẬT của adapter
 * trên REST (`server/api/**`, `server/routes/**`) VÀ tRPC (`server/routers/**`).
 *
 * Luật 2.1: `endpoint` / `activeEndpoint` / `connectionOptions` / văn bản `lastError` của adapter (DB `device_adapters`) hay của supervisor / trạng
 * thái RAM (otManager) chỉ cho người được xem chi tiết kỹ thuật (`chiTietKyThuatCua` — admin|engineer + machine_control.canEdit). API key KHÔNG BAO
 * GIỜ được xem. Phát hiện fix 3: `GET /api/v1/assets/:id/health` trả `lastError` thô cho mọi khoá `assets:read` — chính luật 2.1 thoát qua đường vòng.
 *
 * Thiết bị đo (AST, mọi tệp `.ts` không phải test / testkit / `__*` dưới ba gốc bề mặt). Một ĐIỂM CHẠM là:
 *   • `cot_ky_thuat` — `T.endpoint` / `T.lastError` / `T.connectionOptions` (T = bảng `deviceAdapters`: import, destructure, `<x>.deviceAdapters`,
 *                      `alias(T, …)`);
 *   • `nguyen_hang`  — `.from(T)` / `.*Join(T)` dưới `select()` không đối số / spread / `getTableColumns`, `db.query.deviceAdapters`,
 *                      `getTableColumns(T)`, `T` làm giá trị trong object;
 *   • `sql_tho`      — chuỗi / template có `device_adapters` VÀ (`endpoint` | `lastError` | `last_error` | `connectionOptions` |
 *                      `connection_options` | `SELECT *` | `x.*` | `row_to_json`);
 *   • `ram`          — gọi nguồn RAM mang các trường ấy (`NGUON_RAM`: supervisor / trạng thái adapter / RuntimeAdapter của otManager);
 *   • `ket_qua_lenh` — (C2 polish) `<adapter>.sendCommand(…)`: kết quả lệnh thiết bị mang `error` / `detail` (thông điệp driver / controller);
 *   • `dich_vu`      — gọi một hàm XUẤT của `server/services/**` mà thân có điểm chạm DB / RAM (một bậc), qua MỌI hình import (C2 fix 4, review I1 +
 *                      phụ lục điều phối): tên import tĩnh (kể cả `import { fn as g }`), destructure `const { fn } = await import(…)` / `{ fn: g }`,
 *                      không gian `import * as svc` / `const svc = await import(…)` ⇒ `svc.fn()`, gọi thẳng `(await import(…)).fn()`, hàm cục bộ trả
 *                      import `const svc = () => import(…)` ⇒ `(await svc()).fn()`, tái xuất đổi tên `export { fn as g } from "…"` (gọi `g`).
 *   C2 fix 4 (điều phối 2026-11-01): tập bảng quét thêm `orchestration_runs` (error / contextJson) và `orchestration_run_steps` (error / resultJson) —
 *   lỗi bước / run của orchestration cùng họ với `command_log.errorText` (văn bản driver host:port).
 * Khoá = `tệp#đơn-vị`; đơn vị = route Express (`<x>.get|post|…("<đường>", …)` ⇒ `GET /đường`), thủ tục tRPC (`ten: ….query|mutation(…)`
 * ⇒ `proc:ten`), hoặc hàm có tên bao gần nhất. MỖI khoá phải có trong `SO_CAI` với ĐÚNG số đếm từng loại và MỘT phân loại:
 *   • `che`       — đơn vị trả hàng ra ngoài QUA bộ che: thân đơn vị PHẢI gọi mọi hàm trong `qua` (kiểm AST — gỡ lời gọi ⇒ đỏ, nêu tên khoá);
 *   • `mien_tru`  — miễn trừ CÓ LÝ DO (`lyDo`): chỉ admin, nội bộ (dùng để kết nối / so sánh / kiểm / ghi), chỉ trong WHERE, người gọi tự gõ endpoint…
 * Số khoá, số điểm chạm, số `che`, số `mien_tru` và số tệp quét đều GHIM (đo 2026-11-01). Thêm chỗ đọc mới ⇒ khoá LẠ ⇒ đỏ ⇒ phân loại trước.
 * ⚠ GIỚI HẠN ĐÃ BIẾT: `dich_vu` chỉ một bậc (dịch vụ gọi dịch vụ khác không được lần), và chỉ hàm xuất bằng `export function|const` (không theo
 *   thuộc tính object). Socket (`scada:cmd`, `server/services/scada/scadaSocket.ts`) không phải REST / tRPC — review C2 đã rà riêng.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const GOC = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GOC_BE_MAT = ["server/api", "server/routes", "server/routers", "server/_core"] as const;

type Loai = "cot_ky_thuat" | "nguyen_hang" | "sql_tho" | "ram" | "dich_vu" | "ham_cuc_bo" | "ket_qua_lenh";
type Muc = { dem: Partial<Record<Loai, number>> } & ({ phanLoai: "che"; qua: string[]; lyDo?: string } | { phanLoai: "mien_tru"; lyDo: string });

const SQL_NHAY_CAM = /\bendpoint\b|"lastError"|\blast_error\b|"connectionOptions"|\bconnection_options\b|select\s+\*|\b\w+\.\*|row_to_json|to_jsonb?\s*\(/i;
/**
 * Bảng mang chi tiết kỹ thuật + cột kỹ thuật của từng bảng. C2 fix 4 (điều phối 2026-11-01): thêm `orchestration_runs.error` / `contextJson`
 * (lỗi run + `foeResumeState[*].error`) và `orchestration_run_steps.error` / `resultJson` (lỗi bước + `detail` của EquipmentCommandResult).
 */
type BangSpec = { ten: string; cot: ReadonlySet<string>; sqlBang: RegExp; sqlNhay: RegExp };
const SQL_NHAY_FOE_RUN = /"error"|\berror\b|"contextJson"|select\s+\*|\b\w+\.\*|row_to_json|to_jsonb?\s*\(/i;
const SQL_NHAY_FOE_BUOC = /"error"|\berror\b|"resultJson"|select\s+\*|\b\w+\.\*|row_to_json|to_jsonb?\s*\(/i;
const BANG: readonly BangSpec[] = [
  { ten: "deviceAdapters", cot: new Set(["endpoint", "lastError", "connectionOptions"]), sqlBang: /device_adapters/i, sqlNhay: SQL_NHAY_CAM },
  { ten: "orchestrationRuns", cot: new Set(["error", "contextJson"]), sqlBang: /orchestration_runs\b/i, sqlNhay: SQL_NHAY_FOE_RUN },
  { ten: "orchestrationRunSteps", cot: new Set(["error", "resultJson"]), sqlBang: /orchestration_run_steps\b/i, sqlNhay: SQL_NHAY_FOE_BUOC },
];
/** Nguồn RAM (otManager / trangThaiAdapter) trả `activeEndpoint` / `lastError` / `loi` / `endpoint` / `connectionOptions`. */
const NGUON_RAM = new Set([
  "listSupervisorStatuses",
  "getSupervisorStatus",
  "getOtAdapterStatus",
  "listOtAdapterStatuses",
  "layTrangThaiAdapter",
  "getActiveAdapter",
  "listActiveAdapters",
]);

/**
 * C2 polish (điều phối 2026-11-01) — nguồn KẾT QUẢ LỆNH thiết bị: `EquipmentCommandResult.error` / `.detail` (thông điệp driver / controller robot,
 * có thể mang host:port) — mọi lời gọi `<adapter>.sendCommand(…)` là điểm chạm `ket_qua_lenh`.
 */
const NGUON_LENH = new Set(["sendCommand"]);

function tepDuoi(goc: string): string[] {
  const ra: string[] = [];
  const di = (d: string) => {
    for (const n of readdirSync(d)) {
      if (n === "node_modules" || n === "dist") continue;
      const p = join(d, n);
      if (statSync(p).isDirectory()) di(p);
      else if (/\.ts$/.test(n) && !/\.(test|spec)\.ts$/.test(n) && !/testkit/i.test(n) && !n.startsWith("__") && !n.endsWith(".d.ts")) ra.push(p);
    }
  };
  di(join(GOC, goc));
  return ra.sort();
}
const rel = (p: string) => relative(GOC, p).replace(/\\/g, "/");

function vanBan(n: ts.Node): string | null {
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (ts.isTemplateExpression(n)) return n.head.text + n.templateSpans.map((s) => "${}" + s.literal.text).join("");
  return null;
}

const HTTP = /^(get|post|put|patch|delete|all)$/;
const TRPC = /^(query|mutation|subscription)$/;

/** Đơn vị bao gần nhất: route Express ⇒ thủ tục tRPC ⇒ hàm có tên ⇒ `<tep>`. */
function donVi(n: ts.Node): { ten: string; nut: ts.Node | null } {
  let ham: { ten: string; nut: ts.Node } | null = null;
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
    if (
      ts.isCallExpression(p) &&
      ts.isPropertyAccessExpression(p.expression) &&
      HTTP.test(p.expression.name.text) &&
      p.arguments[0] &&
      ts.isStringLiteralLike(p.arguments[0])
    )
      return { ten: `${p.expression.name.text.toUpperCase()} ${p.arguments[0].text}`, nut: p };
    if (
      ts.isPropertyAssignment(p) &&
      ts.isCallExpression(p.initializer) &&
      ts.isPropertyAccessExpression(p.initializer.expression) &&
      TRPC.test(p.initializer.expression.name.text)
    )
      return { ten: `proc:${p.name.getText()}`, nut: p };
    if (!ham) {
      if ((ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p)) && p.name) ham = { ten: p.name.getText(), nut: p };
      else if (ts.isVariableDeclaration(p) && p.initializer && (ts.isArrowFunction(p.initializer) || ts.isFunctionExpression(p.initializer)))
        ham = { ten: p.name.getText(), nut: p };
    }
  }
  if (ham) return ham;
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return { ten: p.name.text, nut: p };
  return { ten: "<tep>", nut: null };
}

/** Tên cục bộ chỉ bảng `TEN_BANG` (import / destructure / alias). */
function tenBang(sf: ts.SourceFile, TEN_BANG: string): Set<string> {
  const bang = new Set<string>();
  const tham = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && /drizzle\/schema/.test(n.moduleSpecifier.text)) {
      const nb = n.importClause?.namedBindings;
      if (nb && ts.isNamedImports(nb)) for (const e of nb.elements) if ((e.propertyName ?? e.name).text === TEN_BANG) bang.add(e.name.text);
    }
    if (ts.isBindingElement(n) && ts.isIdentifier(n.name) && ((n.propertyName && n.propertyName.getText() === TEN_BANG) || (!n.propertyName && n.name.text === TEN_BANG)))
      bang.add(n.name.text);
    ts.forEachChild(n, tham);
  };
  tham(sf);
  let doi = true;
  while (doi) {
    doi = false;
    const t2 = (n: ts.Node) => {
      if (
        ts.isVariableDeclaration(n) &&
        ts.isIdentifier(n.name) &&
        n.initializer &&
        ts.isCallExpression(n.initializer) &&
        /(^|\.)alias$/.test(n.initializer.expression.getText()) &&
        n.initializer.arguments[0] &&
        laBang(n.initializer.arguments[0], bang, TEN_BANG) &&
        !bang.has(n.name.text)
      ) {
        bang.add(n.name.text);
        doi = true;
      }
      ts.forEachChild(n, t2);
    };
    t2(sf);
  }
  return bang;
}

function laBang(e: ts.Node, bang: Set<string>, TEN_BANG: string): boolean {
  if (ts.isIdentifier(e)) return bang.has(e.text);
  if (ts.isPropertyAccessExpression(e) && e.name.text === TEN_BANG) return true;
  if (ts.isElementAccessExpression(e) && ts.isStringLiteralLike(e.argumentExpression) && e.argumentExpression.text === TEN_BANG) return true;
  return false;
}

function viTriGiaTri(id: ts.Identifier): boolean {
  const p = id.parent;
  if (ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p) || ts.isBindingElement(p)) return false;
  if ((ts.isVariableDeclaration(p) || ts.isFunctionDeclaration(p) || ts.isParameter(p)) && p.name === id) return false;
  if (ts.isPropertyAssignment(p) && p.name === id) return false;
  if (ts.isPropertyAccessExpression(p) && p.name === id) return false;
  for (let q: ts.Node | undefined = p; q; q = q.parent) if (ts.isTypeNode(q) || ts.isInterfaceDeclaration(q) || ts.isTypeAliasDeclaration(q)) return false;
  return true;
}

function selectGoc(call: ts.CallExpression): ts.CallExpression | null {
  let e: ts.Expression = (call.expression as ts.PropertyAccessExpression).expression;
  for (let i = 0; i < 30; i++) {
    if (ts.isCallExpression(e)) {
      if (ts.isPropertyAccessExpression(e.expression) && /^select(Distinct)?(On)?$/.test(e.expression.name.text)) return e;
      e = e.expression;
    } else if (ts.isPropertyAccessExpression(e)) e = e.expression;
    else if (ts.isAwaitExpression(e) || ts.isParenthesizedExpression(e)) e = e.expression;
    else return null;
  }
  return null;
}

const JOIN = /^(from|leftJoin|innerJoin|rightJoin|fullJoin|crossJoin)$/;

/** `.insert(T)` / `.update(T)` / `.delete(T)` xâu chuỗi tới `.returning()` KHÔNG đối số (hoặc spread / getTableColumns) ⇒ trả nguyên hàng. */
function traVeNguyenHang(goi: ts.CallExpression): boolean {
  let e: ts.Node = goi;
  for (let i = 0; i < 30 && e.parent; i++) {
    const p = e.parent;
    if (ts.isPropertyAccessExpression(p) && p.expression === e) {
      const c = p.parent;
      if (ts.isCallExpression(c) && c.expression === p) {
        if (p.name.text === "returning") {
          const a = c.arguments[0];
          return !a || !ts.isObjectLiteralExpression(a) || a.properties.some((x) => ts.isSpreadAssignment(x) || /getTableColumns\(/.test(x.getText()));
        }
        e = c;
        continue;
      }
      e = p;
      continue;
    }
    return false;
  }
  return false;
}

/** Loại của MỘT tham chiếu bảng `r` — `null` = an toàn (cột không kỹ thuật, select chiếu tường minh, ghi). */
function loaiThamChieu(r: ts.Expression, bang: Set<string>, spec: BangSpec): Loai | null {
  const COT_KY_THUAT = spec.cot;
  if (ts.isPropertyAccessExpression(r) && ts.isPropertyAccessExpression(r.expression) && r.expression.name.text === "query") return "nguyen_hang";
  const p = r.parent;
  if (ts.isPropertyAccessExpression(p) && p.expression === r) return COT_KY_THUAT.has(p.name.text) ? "cot_ky_thuat" : null;
  if (ts.isElementAccessExpression(p) && p.expression === r) return "nguyen_hang";
  if (ts.isCallExpression(p) && p.arguments.includes(r)) {
    const ten = ts.isPropertyAccessExpression(p.expression) ? p.expression.name.text : ts.isIdentifier(p.expression) ? p.expression.text : "";
    if (JOIN.test(ten)) {
      const s = selectGoc(p);
      if (!s || s.arguments.length === 0) return "nguyen_hang";
      const a = s.arguments[0];
      if (!ts.isObjectLiteralExpression(a)) return "nguyen_hang";
      for (const pr of a.properties) {
        if (ts.isSpreadAssignment(pr)) return "nguyen_hang";
        if (ts.isShorthandPropertyAssignment(pr) && bang.has(pr.name.text)) return "nguyen_hang";
        if (ts.isPropertyAssignment(pr) && (laBang(pr.initializer, bang, spec.ten) || /getTableColumns\(/.test(pr.initializer.getText()))) return "nguyen_hang";
      }
      return null; // chiếu tường minh — cột kỹ thuật (nếu có) bị đếm riêng ở cot_ky_thuat
    }
    if (ten === "insert" || ten === "update" || ten === "delete") return traVeNguyenHang(p) ? "nguyen_hang" : null;
    if (ten === "eq" || ten === "inArray") return null;
    if (ten === "getTableColumns") return "nguyen_hang";
    if (ten === "alias") return null; // bí danh được theo dõi tiếp
    return "nguyen_hang"; // bảng truyền đi chỗ khác — xấp xỉ TRÊN
  }
  if (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p) || ts.isSpreadAssignment(p)) return "nguyen_hang";
  return "nguyen_hang";
}

/** Tên được import vào tệp (import tĩnh + destructure `await import(…)`). */
function tenImport(sf: ts.SourceFile): Set<string> {
  const ra = new Set<string>();
  const tham = (n: ts.Node) => {
    if (ts.isImportDeclaration(n)) {
      const nb = n.importClause?.namedBindings;
      if (nb && ts.isNamedImports(nb)) for (const e of nb.elements) ra.add(e.name.text);
    }
    if (ts.isBindingElement(n) && ts.isIdentifier(n.name)) ra.add(n.name.text);
    ts.forEachChild(n, tham);
  };
  tham(sf);
  return ra;
}

/** Bỏ ngoặc / await. */
function boBoc(e: ts.Expression): ts.Expression {
  let x = e;
  while (ts.isParenthesizedExpression(x) || ts.isAwaitExpression(x)) x = x.expression;
  return x;
}
/** `import(…)` hoặc lời gọi một hàm cục bộ chỉ TRẢ `import(…)` (`const svc = () => import(…)` ⇒ `(await svc()).fn()`). */
const laImportDong = (e: ts.Expression, hamImport: ReadonlySet<string> = new Set()) => {
  const x = boBoc(e);
  return ts.isCallExpression(x) && (x.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(x.expression) && hamImport.has(x.expression.text)));
};

/**
 * C2 fix 4 (review fix 3 I1 + phụ lục điều phối) — các HÌNH gọi dịch vụ qua import:
 *   • `goc`: tên cục bộ → tên XUẤT gốc — `import { fn as g }`, `const { fn } = await import(…)`, `const { fn: g } = await import(…)` (đổi tên);
 *   • `khongGian`: biến mang CẢ module — `import * as svc`, `const svc = await import(…)` / `= import(…)` ⇒ `svc.fn()`;
 *   • lời gọi THẲNG trên import động `(await import(…)).fn()` được nhận ở `tenDichVuGoi`.
 */
type BangImport = { goc: Map<string, string>; khongGian: Set<string>; hamImport: Set<string> };
function bangImport(sf: ts.SourceFile): BangImport {
  const goc = new Map<string, string>();
  const khongGian = new Set<string>();
  const hamImport = new Set<string>();
  // hàm cục bộ trả import động: `const svc = () => import(…)` / `async () => import(…)` / `function svc() { return import(…) }`
  const traImport = (f: ts.Node): boolean => {
    if ((ts.isArrowFunction(f) || ts.isFunctionExpression(f) || ts.isFunctionDeclaration(f)) && f.body) {
      if (!ts.isBlock(f.body)) return laImportDong(f.body);
      return f.body.statements.some((st) => ts.isReturnStatement(st) && !!st.expression && laImportDong(st.expression));
    }
    return false;
  };
  const thamHam = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && traImport(n.initializer)) hamImport.add(n.name.text);
    if (ts.isFunctionDeclaration(n) && n.name && traImport(n)) hamImport.add(n.name.text);
    ts.forEachChild(n, thamHam);
  };
  thamHam(sf);
  const tham = (n: ts.Node) => {
    if (ts.isImportDeclaration(n)) {
      const nb = n.importClause?.namedBindings;
      if (nb && ts.isNamedImports(nb)) for (const e of nb.elements) goc.set(e.name.text, (e.propertyName ?? e.name).text);
      if (nb && ts.isNamespaceImport(nb)) khongGian.add(nb.name.text);
    }
    if (ts.isVariableDeclaration(n) && n.initializer && laImportDong(n.initializer, hamImport)) {
      if (ts.isIdentifier(n.name)) khongGian.add(n.name.text);
      else if (ts.isObjectBindingPattern(n.name))
        for (const e of n.name.elements) if (ts.isIdentifier(e.name)) goc.set(e.name.text, e.propertyName ? e.propertyName.getText() : e.name.text);
    }
    ts.forEachChild(n, tham);
  };
  tham(sf);
  return { goc, khongGian, hamImport };
}

/** Tên XUẤT gốc của một lời gọi đi qua import (tĩnh đổi tên / destructure / không gian / import động thẳng) — `null` nếu không phải hình ấy. */
function tenDichVuGoi(c: ts.CallExpression, bi: BangImport): string | null {
  const e = c.expression;
  if (ts.isIdentifier(e)) return bi.goc.get(e.text) ?? null;
  if (ts.isPropertyAccessExpression(e)) {
    const obj = boBoc(e.expression);
    if (laImportDong(obj, bi.hamImport)) return e.name.text;
    if (ts.isIdentifier(obj) && bi.khongGian.has(obj.text)) return e.name.text;
  }
  return null;
}

/**
 * Tái xuất (phụ lục điều phối): `export { fn as g } from "…"` ⇒ gọi `g` qua module tái xuất ≡ gọi `fn`; `export { fn } from` / `export * from` giữ TÊN
 * (đã bắt theo tên khi import / destructure / không gian). Trả tên MỚI → tên gốc cho mọi tên gốc thuộc `dichVu`.
 */
export function biDanhTaiXuat(nguon: Iterable<[string, string]>, dichVu: ReadonlySet<string>): Map<string, string> {
  const ra = new Map<string, string>();
  for (const [r, src] of nguon) {
    if (!/export\s*\{[^}]*\}\s*from/.test(src)) continue;
    const sf = ts.createSourceFile(r, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    for (const st of sf.statements)
      if (ts.isExportDeclaration(st) && st.moduleSpecifier && st.exportClause && ts.isNamedExports(st.exportClause))
        for (const e of st.exportClause.elements) {
          const g = (e.propertyName ?? e.name).text;
          if (dichVu.has(g) && e.name.text !== g) ra.set(e.name.text, g);
        }
  }
  return ra;
}

function tenGoi(c: ts.CallExpression): string {
  const e = c.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return "";
}

/** Hàm cấp đỉnh của tệp (khai báo `function` / `const x = () => …` / `const x = function …`) ⇒ nút. */
function hamCapDinh(sf: ts.SourceFile): Map<string, ts.Node> {
  const ra = new Map<string, ts.Node>();
  for (const s of sf.statements) {
    if (ts.isFunctionDeclaration(s) && s.name) ra.set(s.name.text, s);
    if (ts.isVariableStatement(s))
      for (const d of s.declarationList.declarations)
        if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) ra.set(d.name.text, d);
  }
  return ra;
}

/** Tên mọi lời gọi trong một nút. */
function goiTrong(n: ts.Node): Set<string> {
  const g = new Set<string>();
  const t = (x: ts.Node) => {
    if (ts.isCallExpression(x)) g.add(tenGoi(x));
    ts.forEachChild(x, t);
  };
  t(n);
  return g;
}

/** Tập hàm cấp đỉnh "chạm" — trực tiếp (`trucTiep`) hoặc gọi theo tên một hàm chạm khác cùng tệp (điểm bất động). */
function lanTrongTep(ham: Map<string, ts.Node>, trucTiep: Iterable<string>): Set<string> {
  const cham = new Set([...trucTiep].filter((t) => ham.has(t)));
  const goi = new Map([...ham].map(([t, n]) => [t, goiTrong(n)] as const));
  let doi = true;
  while (doi) {
    doi = false;
    for (const [t, g] of goi) if (!cham.has(t) && [...g].some((x) => cham.has(x))) (cham.add(t), (doi = true));
  }
  return cham;
}

type KetQuaQuet = { dem: Map<string, Partial<Record<Loai, number>>>; nut: Map<string, ts.Node | null> };

/**
 * Quét MỘT nguồn ⇒ `tệp#đơn-vị` → đếm theo loại (+ nút đơn vị cho §2). `dichVu` = tên hàm dịch vụ nguồn (một bậc).
 * `cucBo` (bề mặt): lời gọi TRỰC TIẾP (định danh) tới một hàm cấp đỉnh CÙNG tệp có điểm chạm ⇒ `ham_cuc_bo` ở đơn vị gọi — thủ tục dùng helper đọc
 * cột kỹ thuật (vd `adapterTrongPhamVi` của scadaDiag) không trốn được sau tên helper.
 */
export function quetNguon(r: string, src: string, dichVu: ReadonlySet<string>, cucBo = true): KetQuaQuet {
  const sf = ts.createSourceFile(r, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const bangs = BANG.map((spec) => ({ spec, ten: tenBang(sf, spec.ten) }));
  const imp = tenImport(sf);
  const bi = bangImport(sf);
  const dem = new Map<string, Partial<Record<Loai, number>>>();
  const nut = new Map<string, ts.Node | null>();
  const them = (n: ts.Node, loai: Loai) => {
    const dv = donVi(n);
    const k = `${r}#${dv.ten}`;
    const m = dem.get(k) ?? {};
    m[loai] = (m[loai] ?? 0) + 1;
    dem.set(k, m);
    nut.set(k, dv.nut);
  };
  const tham = (n: ts.Node) => {
    for (const { spec, ten: bang } of bangs) {
      if (ts.isIdentifier(n) && bang.has(n.text) && viTriGiaTri(n)) {
        const l = loaiThamChieu(n, bang, spec);
        if (l) them(n, l);
      } else if ((ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) && laBang(n, bang, spec.ten)) {
        const l = loaiThamChieu(n, bang, spec);
        if (l) them(n, l);
        return;
      }
    }
    if (ts.isCallExpression(n)) {
      const t = tenGoi(n);
      const g = tenDichVuGoi(n, bi);
      if (NGUON_RAM.has(t) || (g !== null && NGUON_RAM.has(g))) them(n, "ram");
      else if (NGUON_LENH.has(t) && ts.isPropertyAccessExpression(n.expression)) them(n, "ket_qua_lenh");
      else if ((dichVu.has(t) && imp.has(t)) || (g !== null && dichVu.has(g))) them(n, "dich_vu");
    }
    const t = vanBan(n);
    if (t !== null && bangs.some(({ spec }) => spec.sqlBang.test(t) && spec.sqlNhay.test(t))) them(n, "sql_tho");
    ts.forEachChild(n, tham);
  };
  tham(sf);
  if (cucBo) {
    const ham = hamCapDinh(sf);
    const cham = lanTrongTep(ham, [...dem.keys()].map((k) => k.slice(r.length + 1)));
    const t2 = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && cham.has(n.expression.text) && donVi(n).ten !== n.expression.text) them(n, "ham_cuc_bo");
      ts.forEachChild(n, t2);
    };
    t2(sf);
  }
  return { dem, nut };
}

/** Hàm XUẤT của `server/services/**` có điểm chạm DB / RAM trong thân (nguồn `dich_vu`). */
function nguonDichVu(): Map<string, string[]> {
  const ra = new Map<string, string[]>();
  for (const p of tepDuoi("server/services")) {
    const src = readFileSync(p, "utf8");
    if (!/deviceAdapters|device_adapters|orchestrationRuns|orchestrationRunSteps|orchestration_run|\.sendCommand\(|listSupervisorStatuses|getSupervisorStatus|OtAdapterStatus|layTrangThaiAdapter|getActiveAdapter|listActiveAdapters/.test(src)) continue;
    const r = rel(p);
    const { dem } = quetNguon(r, src, new Set(), false);
    const sf = ts.createSourceFile(r, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const xuat = new Set<string>();
    for (const s of sf.statements) {
      const coExport = ts.canHaveModifiers(s) && (ts.getModifiers(s) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (!coExport) continue;
      if (ts.isFunctionDeclaration(s) && s.name) xuat.add(s.name.text);
      if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name)) xuat.add(d.name.text);
    }
    // lan TRONG tệp: hàm xuất gọi (theo tên) hàm đọc nội bộ ⇒ cũng là nguồn
    const cham = lanTrongTep(hamCapDinh(sf), [...dem.keys()].map((k) => k.slice(r.length + 1)));
    for (const ten of cham) if (xuat.has(ten) && !NGUON_RAM.has(ten)) ra.set(ten, [...(ra.get(ten) ?? []), r]);
  }
  return ra;
}

function doTatCa(): { dem: Map<string, Partial<Record<Loai, number>>>; soTep: Record<string, number>; dichVu: Map<string, string[]>; taiXuat: Map<string, string> } {
  const dichVu = nguonDichVu();
  // tái xuất đổi tên (mọi tệp server/, tiền lọc bằng regex) ⇒ tên mới cũng là nguồn dịch vụ
  const taiXuat = biDanhTaiXuat(
    tepDuoi("server").map((p) => [rel(p), readFileSync(p, "utf8")] as [string, string]),
    new Set(dichVu.keys()),
  );
  const ten = new Set([...dichVu.keys(), ...taiXuat.keys()]);
  const dem = new Map<string, Partial<Record<Loai, number>>>();
  const soTep: Record<string, number> = {};
  for (const g of GOC_BE_MAT) {
    const tep = tepDuoi(g);
    soTep[g] = tep.length;
    for (const p of tep) for (const [k, v] of quetNguon(rel(p), readFileSync(p, "utf8"), ten).dem) dem.set(k, v);
  }
  return { dem, soTep, dichVu, taiXuat };
}

const sapXep = (o: Partial<Record<Loai, number>>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

/** Thiếu lời gọi nào trong `qua` ở thân đơn vị (AST — tên gọi trực tiếp hoặc `.ten(`). Đơn vị không tìm thấy ⇒ coi như thiếu tất cả. */
export function thieuLoiGoi(nut: ts.Node | null | undefined, qua: readonly string[]): string[] {
  if (!nut) return [...qua];
  const g = goiTrong(nut);
  return qua.filter((q) => !g.has(q));
}

// ── SỔ CÁI (đo 2026-11-01 trên cây feat/scada-2bA-hop-dong @ 34f236452 + fix 3) ───────────────────────────────────────────────────────────
const MT_WHERE = "chỉ trong WHERE / subquery chọn id adapter (lọc phạm vi) — không trả cột nào của adapter";
const MT_FOE =
  "foe (getRun / abortRun / resumeRun): hàng adapter chỉ dùng NỘI BỘ cho binding digest + khả năng checksum chương trình; view trả run + digest + programChecks (id / nhãn mã / status / checksum / reason mã) — không endpoint / connectionOptions / lastError";
const MT_MAPPING =
  "mappingAsCode: tệp mapping KHÔNG mang endpoint / credentials (đầu tệp mappingAsCode.ts, import không đổi endpoint); hàng adapter chỉ để lấy code / protocol / máy";
const MT_KHOI_DONG = "khởi động / lịch nền (startOt, sweep, publisher) — không phải bề mặt trả dữ liệu cho người gọi";
const MT_KY_SU = "thủ tục kySuProcedure (vai admin|engineer) + requirePermission(machine_control, canEdit) — đúng tập người xem chi tiết kỹ thuật";
// C2 fix 4 (điều phối 2026-11-01)
const MT_START_RUN =
  "StartRunResult: ok / status / runId / message do MÁY CHỦ soạn (không chép lỗi bước / run) / reason mã / stepIds / abortStops (chỉ id bước) — không văn bản driver";
const MT_VISIBLE = "chỉ dùng runIdVisibleTo / filterRunsVisibleTo / resolveVisiblePendingRunIds (boolean / id) — không trả error / contextJson / resultJson";
const MT_EDGE =
  "edge-node principal (edge token, requireEdgeNode) owns the adapter / run it executes; not an API key / user — nút cần đúng dữ liệu của chính nó để chạy (§2d ghim `auth` = requireEdgeNode())";
const MT_EDGE_CONFIG =
  "requires edge token + the node owns the adapter; if this route ever accepts an API key or a user session ⇒ re-decide (trả endpoint + connectionOptions ĐÃ GIẢI MÃ cho nút sở hữu — currentNodeConfig / buildNodeConfigContent; §2d ghim `auth` = requireEdgeNode())";

export const SO_CAI: Record<string, Muc> = {
  // ── REST /api/v1 ──
  "server/api/v1/assets.ts#GET /assets/:id/health": {
    dem: { cot_ky_thuat: 2 },
    phanLoai: "che",
    qua: ["redactAdapterRow", "maLoiAdapterCua", "tamKhoaAdapter"],
    lyDo: "C2 fix 3 — khoá API không bao giờ xem chi tiết kỹ thuật (chiTietKyThuat: false)",
  },
  "server/api/v1/assets.ts#GET /assets/:id/config-drift": {
    dem: { dich_vu: 1 },
    phanLoai: "mien_tru",
    lyDo: "checkAdapterDrift ⇒ AdapterDriftView: hash + status + summary không bí mật (mã / tên / protocol / số tag) — không endpoint / lastError / connectionOptions",
  },
  "server/api/v1/assets.ts#POST /assets/:id/config-drift/approve": { dem: { dich_vu: 1 }, phanLoai: "mien_tru", lyDo: "trả adapterId / adapterCode / approvedHash / status — không cột kỹ thuật" },
  "server/api/v1/assets.ts#POST /adapters/:id/restart": {
    dem: { dich_vu: 1, nguyen_hang: 1 },
    phanLoai: "mien_tru",
    lyDo: "hàng adapter chỉ để kiểm phạm vi (machineId) + lấy code; trả adapterId / adapterCode / restarted (cờ V1_ADAPTER_RESTART_ENABLED mặc định TẮT)",
  },
  "server/api/v1/router.ts#GET /orchestration/runs/:id": {
    dem: { dich_vu: 1 },
    phanLoai: "che",
    qua: ["cheRunView"],
    lyDo: "C2 fix 4 — steps[*].error / result.detail / run.error ⇒ mã cho khoá API (cheRunView(view, false)); adapter chỉ dùng nội bộ cho digest (" + MT_FOE + ")",
  },
  "server/api/v1/router.ts#POST /equipment/:id/commands": {
    dem: { ket_qua_lenh: 1 },
    phanLoai: "che",
    qua: ["cheKetQuaLenh"],
    lyDo: "C2 polish — result.error ⇒ mã, result.detail ⇒ danh sách trắng chung với bước orchestration (cheKetQuaLenh(result, false)); khoá API không bao giờ là người xem",
  },
  "server/api/v1/router.ts#POST /orchestration/runs": { dem: { dich_vu: 1, ham_cuc_bo: 1 }, phanLoai: "mien_tru", lyDo: "trả { runId, status, accepted }; webhook mang { runId, workflowRef, status } — " + MT_START_RUN },
  "server/api/v1/router.ts#orchestrationRunWebhookAudience": { dem: { dich_vu: 1 }, phanLoai: "mien_tru", lyDo: "vị từ người nhận webhook — " + MT_VISIBLE },
  "server/api/v1/router.ts#POST /edge/sync": { dem: { dich_vu: 2 }, phanLoai: "mien_tru", lyDo: "khoá edge GHI kết quả run của chính nó (error do NÓ gửi lên); trả { runId, stepsApplied, abortRequested, stale } + message máy chủ" },
  "server/api/v1/edgeNodeRoutes.ts#POST /edge/node/config": { dem: { dich_vu: 1 }, phanLoai: "mien_tru", lyDo: MT_EDGE_CONFIG },
  "server/api/v1/edgeNodeRoutes.ts#POST /edge/node/pull": { dem: { dich_vu: 2 }, phanLoai: "mien_tru", lyDo: MT_EDGE },
  "server/api/v1/edgeNodeRoutes.ts#POST /edge/node/runs/:runId/claim": { dem: { dich_vu: 1 }, phanLoai: "mien_tru", lyDo: MT_EDGE },
  "server/api/v1/edgeNodeRoutes.ts#POST /edge/node/runs/:runId/progress": { dem: { dich_vu: 2 }, phanLoai: "mien_tru", lyDo: MT_EDGE },
  "server/api/v1/edgeNodeRoutes.ts#POST /edge/node/runs/:runId/complete": { dem: { dich_vu: 2 }, phanLoai: "mien_tru", lyDo: MT_EDGE },
  "server/api/v1/edgeNodeRoutes.ts#POST /edge/node/runs/:runId/release": { dem: { dich_vu: 2 }, phanLoai: "mien_tru", lyDo: MT_EDGE },
  "server/api/v1/edgeNodeRoutes.ts#POST /edge/node/runs/:runId/interrupted": { dem: { dich_vu: 2 }, phanLoai: "mien_tru", lyDo: MT_EDGE },
  "server/api/v1/edgeNodeRoutes.ts#POST /edge/node/runs/:runId/authorize": { dem: { dich_vu: 1 }, phanLoai: "mien_tru", lyDo: MT_EDGE },
  "server/api/v1/edgeNodeRoutes.ts#POST /edge/node/runs/:runId/report": { dem: { dich_vu: 1 }, phanLoai: "mien_tru", lyDo: MT_EDGE },
  "server/api/v1/edgeNodeRoutes.ts#POST /edge/node/locks/events": { dem: { dich_vu: 1 }, phanLoai: "mien_tru", lyDo: MT_EDGE },
  // ── REST ngoài /api/v1 ──
  "server/routes/observabilityRoutes.ts#GET /api/observability/health": {
    dem: { ram: 1 },
    phanLoai: "che",
    qua: ["chiTietKyThuatCua", "maLoiAdapterCua"],
    lyDo: "C2 fix 3 — cổng nhận cả vai supervisor (không phải người xem chi tiết kỹ thuật); cùng luật systemHealth.connectionSupervisors",
  },
  // ── tRPC ──
  "server/routers/_adapterPhamVi.ts#dieuKienLenhTrongPhamVi": { dem: { nguyen_hang: 1 }, phanLoai: "mien_tru", lyDo: MT_WHERE },
  "server/routers/commandLogRouter.ts#adapterCuaMay": { dem: { nguyen_hang: 1 }, phanLoai: "mien_tru", lyDo: MT_WHERE },
  "server/routers/commandLogRouter.ts#dieuKienThuTrongPhamVi": { dem: { ham_cuc_bo: 1 }, phanLoai: "mien_tru", lyDo: MT_WHERE },
  "server/routers/commandLogRouter.ts#proc:nhatKy": { dem: { ham_cuc_bo: 3 }, phanLoai: "mien_tru", lyDo: MT_WHERE },
  "server/routers/deviceAdapterRouter.ts#proc:list": { dem: { nguyen_hang: 1 }, phanLoai: "che", qua: ["hangAnToan"] },
  "server/routers/deviceAdapterRouter.ts#proc:get": { dem: { nguyen_hang: 1 }, phanLoai: "che", qua: ["hangAnToan"] },
  "server/routers/deviceAdapterRouter.ts#proc:create": { dem: { nguyen_hang: 1 }, phanLoai: "che", qua: ["hangAnToan"] },
  "server/routers/deviceAdapterRouter.ts#proc:update": { dem: { nguyen_hang: 3 }, phanLoai: "che", qua: ["hangAnToan"] },
  "server/routers/deviceAdapterRouter.ts#proc:testConnection": {
    dem: { nguyen_hang: 1 },
    phanLoai: "che",
    qua: ["chiTietKyThuatCua"],
    lyDo: "C2 fix 2 — endpoint đã lưu chỉ để dò; người bị che không nhận khoá error (theoNguoiXem)",
  },
  "server/routers/deviceAdapterRouter.ts#proc:delete": {
    dem: { nguyen_hang: 1 },
    phanLoai: "mien_tru",
    lyDo: "hàng FOR UPDATE chỉ để kiểm (phạm vi dưới khoá / còn bật / cổng adapter); trả { success: true }",
  },
  "server/routers/edgeDeploymentRouter.ts#proc:getUnifiedFleetStatus": {
    dem: { dich_vu: 1, nguyen_hang: 1 },
    phanLoai: "che",
    qua: ["chiTietKyThuatCua", "redactAdapterRow", "maLoiAdapterCua", "tamKhoaAdapter"],
    lyDo: "C2 fix 4 (review fix 3 M1) — admin KHÔNG canEdit bị che (luật hai điều kiện); nguyen_hang = `s.deviceAdapters` (thuộc tính kết quả, xấp xỉ trên)",
  },
  "server/routers/edgeRuntimeRouter.ts#proc:nodeStatus": { dem: { dich_vu: 1 }, phanLoai: "che", qua: ["chiTietKyThuatCua", "cheHangRun"], lyDo: "C2 fix 4 — hàng run nguyên (error / contextJson) của nút" },
  "server/routers/edgeRuntimeRouter.ts#proc:deleteNode": { dem: { dich_vu: 1 }, phanLoai: "mien_tru", lyDo: "trả { id } / message máy chủ — không hàng run / adapter" },
  "server/routers/edgeRuntimeRouter.ts#proc:assignRun": { dem: { dich_vu: 2 }, phanLoai: "mien_tru", lyDo: "trả { runId, edgeNodeId } / message máy chủ; " + MT_VISIBLE },
  "server/routers/edgeRuntimeRouter.ts#proc:syncRunResult": { dem: { dich_vu: 2 }, phanLoai: "mien_tru", lyDo: "người gọi GHI kết quả (error do chính họ gửi); trả { runId, stepsApplied, abortRequested, stale }" },
  "server/routers/engineeringAssignmentRouter.ts#proc:assign": { dem: { dich_vu: 2 }, phanLoai: "mien_tru", lyDo: MT_VISIBLE + "; trả bản ghi giao việc" },
  "server/routers/engineeringAssignmentRouter.ts#proc:unassign": { dem: { dich_vu: 1 }, phanLoai: "mien_tru", lyDo: MT_VISIBLE + "; trả bản ghi giao việc" },
  "server/routers/engineeringAssignmentRouter.ts#proc:assignableUsers": { dem: { dich_vu: 1 }, phanLoai: "mien_tru", lyDo: MT_VISIBLE + "; trả danh sách người" },
  "server/routers/orchestrationGovRouter.ts#proc:runEvents": {
    dem: { dich_vu: 1 },
    phanLoai: "mien_tru",
    lyDo: "orchestration_run_events: mọi appendRunEvent chỉ mang { status } / { workflowRef, edgeNodeId } (foeEngine / foeRunStore) — không lỗi bước; " + MT_VISIBLE,
  },
  "server/routers/orchestrationGovRouter.ts#proc:replayRun": { dem: { dich_vu: 1 }, phanLoai: "mien_tru", lyDo: "trạng thái suy từ cùng sổ sự kiện (không lỗi bước); " + MT_VISIBLE },
  "server/routers/oversightRouter.ts#proc:pendingSummary": { dem: { dich_vu: 1 }, phanLoai: "mien_tru", lyDo: "mẫu run chỉ { id, workflowRef, status, currentStepId } + đếm; " + MT_VISIBLE },
  "server/routers/edgeResolutionRouter.ts#proc:list": {
    dem: { dich_vu: 1 },
    phanLoai: "mien_tru",
    lyDo: "listEdgeResolutionItems: SQL chỉ lấy a.code / factoryId của adapter (`v.*` / `i.*` là của bảng edge, không phải device_adapters)",
  },
  "server/routers/equipmentIntegrationRouter.ts#euromapOpcuaAllowlistedHosts": { dem: { cot_ky_thuat: 1 }, phanLoai: "mien_tru", lyDo: "endpoint ⇒ tập host allowlist NỘI BỘ (chống SSRF), không trả ra" },
  "server/routers/equipmentIntegrationRouter.ts#proc:testEuromapOpcuaConnection": { dem: { ham_cuc_bo: 1 }, phanLoai: "mien_tru", lyDo: "adminProcedure; người gọi TỰ gõ endpoint; allowlist chỉ để kiểm" },
  "server/routers/mappingAsCodeRouter.ts#proc:exportAll": { dem: { dich_vu: 1 }, phanLoai: "mien_tru", lyDo: MT_MAPPING },
  "server/routers/mappingAsCodeRouter.ts#proc:exportOne": { dem: { dich_vu: 1 }, phanLoai: "mien_tru", lyDo: MT_MAPPING },
  "server/routers/mappingAsCodeRouter.ts#proc:preview": { dem: { dich_vu: 1 }, phanLoai: "mien_tru", lyDo: MT_MAPPING },
  "server/routers/mappingAsCodeRouter.ts#proc:applyImport": { dem: { dich_vu: 1 }, phanLoai: "mien_tru", lyDo: MT_MAPPING },
  "server/routers/orchestrationRouter.ts#proc:getRun": {
    dem: { dich_vu: 1 },
    phanLoai: "che",
    qua: ["chiTietKyThuatCua", "cheRunView"],
    lyDo: "C2 fix 4 — steps[*].error / result.detail / run.error / foeResumeState ⇒ mã cho người không xem chi tiết kỹ thuật",
  },
  "server/routers/orchestrationRouter.ts#proc:listRuns": {
    dem: { cot_ky_thuat: 1, dich_vu: 1 },
    phanLoai: "che",
    qua: ["chiTietKyThuatCua", "cheHangRun"],
    lyDo: "C2 fix 4 — hàng run (error / contextJson) qua cheHangRun; resultJson chỉ vào summarizeRunDispatch (tóm tắt simulated / sent)",
  },
  "server/routers/orchestrationRouter.ts#proc:runListMeta": { dem: { dich_vu: 1 }, phanLoai: "mien_tru", lyDo: "trả { truncated } (boolean)" },
  "server/routers/orchestrationRouter.ts#proc:startRun": { dem: { dich_vu: 1 }, phanLoai: "mien_tru", lyDo: MT_START_RUN },
  "server/routers/orchestrationRouter.ts#proc:abortRun": { dem: { dich_vu: 1 }, phanLoai: "mien_tru", lyDo: MT_START_RUN + "; " + MT_FOE },
  "server/routers/orchestrationRouter.ts#proc:resumeRun": { dem: { dich_vu: 1 }, phanLoai: "mien_tru", lyDo: MT_START_RUN + "; " + MT_FOE },
  "server/routers/orchestrationRouter.ts#proc:deleteWorkflow": { dem: { nguyen_hang: 1 }, phanLoai: "mien_tru", lyDo: "hàng run chỉ để kiểm còn run chưa kết thúc + xoá; trả { ok, id, ref, removedRuns }" },
  "server/routers/programmingRouter.ts#proc:deployPreview": { dem: { dich_vu: 1 }, phanLoai: "mien_tru", lyDo: "previewDeploy: hàng adapter chỉ để kiểm isEnabled; trả danh sách cổng (mã)" },
  "server/routers/scadaDiagRouter.ts#cotAdapter": {
    dem: { cot_ky_thuat: 2 },
    phanLoai: "mien_tru",
    lyDo: "khai báo cột; mọi `.from` dưới select(cotAdapter) bị đếm nguyen_hang ở đơn vị dùng",
  },
  "server/routers/scadaDiagRouter.ts#adapterTrongPhamVi": { dem: { nguyen_hang: 1 }, phanLoai: "mien_tru", lyDo: "helper nội bộ; mọi thủ tục gọi nó có khoá riêng (ham_cuc_bo) bên dưới" },
  "server/routers/scadaDiagRouter.ts#tomTatTheoPhamVi": {
    dem: { cot_ky_thuat: 1, nguyen_hang: 3, ram: 1 },
    phanLoai: "mien_tru",
    lyDo: "lastError / RAM chỉ để suy trạng thái rồi ĐẾM; trả số",
  },
  "server/routers/scadaDiagRouter.ts#proc:danhSach": { dem: { nguyen_hang: 1, ram: 1 }, phanLoai: "che", qua: ["chiTietKyThuatCua", "maLoiAdapterCua", "tamKhoaAdapter"] },
  "server/routers/scadaDiagRouter.ts#proc:tomTatTruyenThong": { dem: { ham_cuc_bo: 1 }, phanLoai: "mien_tru", lyDo: "chip n/m — chỉ số đếm (tomTatTheoPhamVi)" },
  "server/routers/scadaDiagRouter.ts#proc:tagCuaAdapter": { dem: { ham_cuc_bo: 1 }, phanLoai: "mien_tru", lyDo: "chỉ dùng a.id của helper; trả tag + giá trị" },
  "server/routers/scadaDiagRouter.ts#proc:mauTho": { dem: { ham_cuc_bo: 1 }, phanLoai: "mien_tru", lyDo: "chỉ dùng a.id / code / machineId; trả mẫu telemetry" },
  "server/routers/scadaDiagRouter.ts#proc:ketNoiLai": {
    dem: { dich_vu: 1, ham_cuc_bo: 1, ram: 3 },
    phanLoai: "mien_tru",
    lyDo: MT_KY_SU + " (kq.error của resetAdapterSession chỉ tới kỹ sư)",
  },
  "server/routers/scadaDiagRouter.ts#proc:tamTat": { dem: { ham_cuc_bo: 1, nguyen_hang: 1 }, phanLoai: "mien_tru", lyDo: MT_KY_SU + "; trả { daGo }" },
  "server/routers/scadaDiagRouter.ts#proc:datLoiStub": {
    dem: { ham_cuc_bo: 1, sql_tho: 1 },
    phanLoai: "mien_tru",
    lyDo: MT_KY_SU + "; endpoint chỉ trong WHERE / tra stub; trả { apDung }",
  },
  "server/routers/systemHealthRouter.ts#proc:connectionSupervisors": { dem: { ram: 1 }, phanLoai: "che", qua: ["chiTietKyThuatCua", "maLoiAdapterCua"] },
  // ── server/_core ──
  "server/_core/backgroundJobs.ts#runWorkerProcess": { dem: { ham_cuc_bo: 1 }, phanLoai: "mien_tru", lyDo: MT_KHOI_DONG },
  "server/_core/backgroundJobs.ts#startBackgroundSchedulers": { dem: { dich_vu: 1 }, phanLoai: "mien_tru", lyDo: MT_KHOI_DONG },
  "server/_core/index.ts#<tep>": { dem: { ham_cuc_bo: 1 }, phanLoai: "mien_tru", lyDo: MT_KHOI_DONG },
  "server/_core/index.ts#startServer": { dem: { dich_vu: 3 }, phanLoai: "mien_tru", lyDo: MT_KHOI_DONG },
};

/**
 * GHIM số khoá / điểm chạm / che / miễn trừ. Đổi ⇒ phân loại khoá mới trước, cập nhật cùng ngày + lý do. Không nới.
 *   • fix 3 (đo 2026-11-01): { khoa 43, diemCham 63, che 9, mienTru 34 }.
 *   • fix 4 (đo 2026-11-01): { khoa 70, diemCham 102, che 14, mienTru 56 } — +27 khoá: 10 tuyến edgeNodeRoutes (I1: hình `(await import(…)).fn()` /
 *     `(await svc()).fn()` nay thấy được), bảng orchestration_runs / orchestration_run_steps vào tập quét (+15 khoá foe / edge / oversight / giao việc);
 *     che +5 (getRun, listRuns, REST runs/:id, nodeStatus, fleet status — fleet chuyển từ miễn trừ), miễn trừ +22.
 *   • polish (đo 2026-11-01): { khoa 71, diemCham 103, che 15, mienTru 56 } — +1 khoá che: REST `POST /equipment/:id/commands` (loại mới `ket_qua_lenh`:
 *     `<adapter>.sendCommand(…)` — EquipmentCommandResult.error / .detail).
 */
const GHIM = { khoa: 71, diemCham: 103, che: 15, mienTru: 56 };
/** Bảo vệ "đi rỗng" (đo 2026-11-01: api 30, routes 26, routers 239, _core 82 tệp; nguồn dịch vụ 80 hàm sau fix 4 — 55 ở fix 3). Ngưỡng dưới ~85 % số đo. */
const SAN_TEP: Record<(typeof GOC_BE_MAT)[number], number> = { "server/api": 25, "server/routes": 22, "server/routers": 200, "server/_core": 70 };
const SAN_NGUON_DICH_VU = 68;

/** Hàm che GHÉP phải tự gọi bộ che nguyên thuỷ (tệp → hàm → phải gọi). */
const HAM_CHE_GHEP: Record<string, { tep: string; phaiGoi: string[] }> = {
  hangAnToan: { tep: "server/routers/deviceAdapterRouter.ts", phaiGoi: ["chiTietKyThuatCua", "redactAdapterRow", "maLoiAdapterCua", "tamKhoaAdapter"] },
};

const docTep = (tep: string) => readFileSync(join(GOC, tep), "utf8");

/**
 * MIỄN TRỪ ĐÃ QUYẾT ngoài bề mặt REST / tRPC (C2 fix 4 mục 3a / 3b — điều phối QUYẾT 2026-11-01). Có NGÀY + BẰNG CHỨNG; §5 kiểm bằng chứng còn đúng.
 */
export const MIEN_TRU_DA_QUYET = [
  {
    ngay: "2026-11-01",
    ma: "audit_before_endpoint",
    noiDung: "scadaDiag.tamTat ghi before.endpoint (văn bản chi tiết kỹ thuật) vào control_audit_log — GIỮ trong audit, KHÔNG che",
    bangChung: [
      "recordAuditEvent (server/services/audit/controlAuditService.ts:113) chỉ ghi control_audit_log (beforeJson thô)",
      "securityRouter.verifyAuditChain (securityRouter.ts:33-39, protectedProcedure) chỉ trả { ok, checked, brokenAtId, reason }",
      "commissioningService.latestCommissioningRecheck (:197-250) nội bộ, chỉ hàng device_tag_stop_pin, trả bản rút gọn",
      "interlockRouter (:521-555), safetyPlcTrust (:281-316), assignmentService (:64, :314), totpKhoaSai (:440-460), wormTableSizeMonitor (:28) chỉ chọn id / actorId / count",
      "backupRouter / backupService (adminProcedure): pg_dump toàn DB; sao lưu theo nhóm không gồm bảng này",
      "BẤT BIẾN được ghim tự động: server/routers/controlAuditLogDocCensus.test.ts (danh sách cho phép theo hàm, người đọc mới ⇒ đỏ)",
    ],
  },
  {
    ngay: "2026-11-01",
    ma: "mcp_cuc_bo",
    noiDung: "MCP local dev tool — known reader, outside app permissions",
    bangChung: [
      "vai mcp_chi_doc (scripts/mcp-cuc-bo.ts, server/services/mcpCucBo/dbChiDoc.ts, cấp bởi scripts/mcp-cuc-bo-vai-tro.mjs) SELECT mọi bảng, chỉ ẩn cột khớp RE_NHAY_CAM + COT_AN_TUONG_MINH ⇒ ĐỌC ĐƯỢC control_audit_log.beforeJson và device_adapters.endpoint / lastError",
      "chỉ 127.0.0.1, bearer; công cụ của nhà phát triển trên chính máy, không phải kênh người dùng của ứng dụng",
      "không tệp nào trong server/ import nó ngoài module của chính nó; bí mật trong connectionOptions đã niêm phong (sealConnectionOptionSecrets)",
      "QUYẾT LẠI nếu MCP từng được mở ra ngoài loopback. KHÔNG đổi vai MCP trong lát này.",
    ],
  },
] as const;

describe("★★★ census — chi tiết kỹ thuật adapter (endpoint / activeEndpoint / connectionOptions / lastError) trên REST + tRPC (KD-2bA 2.1, C2 fix 3)", () => {
  const DO = doTatCa();
  const tenDv = new Set(DO.dichVu.keys());
  const tong = (o: Partial<Record<Loai, number>>) => Object.values(o).reduce((a, b) => a + (b ?? 0), 0);

  it("§0 thiết bị đo KHÔNG đi rỗng: đủ tệp mỗi gốc, nguồn dịch vụ không rỗng, mỗi loại điểm chạm xuất hiện", () => {
    for (const g of GOC_BE_MAT) expect(DO.soTep[g], `số tệp quét dưới ${g}`).toBeGreaterThanOrEqual(SAN_TEP[g]);
    expect(DO.dichVu.size, "số hàm dịch vụ nguồn").toBeGreaterThanOrEqual(SAN_NGUON_DICH_VU);
    const loai = new Set([...DO.dem.values()].flatMap((v) => Object.keys(v)));
    for (const l of ["cot_ky_thuat", "nguyen_hang", "sql_tho", "ram", "dich_vu", "ham_cuc_bo", "ket_qua_lenh"]) expect(loai.has(l), `loại ${l}`).toBe(true);
    expect(DO.dem.size).toBeGreaterThan(0);
  });

  it("§1 MỌI điểm chạm có trong sổ cái với ĐÚNG số đếm (chỗ mới ⇒ phân loại trước); sổ cái không có khoá chết", () => {
    const la: string[] = [];
    for (const [k, v] of DO.dem) {
      const m = SO_CAI[k];
      if (!m) la.push(`LẠ ${k} ${JSON.stringify(sapXep(v))}`);
      else if (JSON.stringify(sapXep(m.dem)) !== JSON.stringify(sapXep(v))) la.push(`ĐẾM LỆCH ${k}: sổ ${JSON.stringify(sapXep(m.dem))} ≠ đo ${JSON.stringify(sapXep(v))}`);
    }
    for (const k of Object.keys(SO_CAI)) if (!DO.dem.has(k)) la.push(`CHẾT ${k} (sổ cái có, đo không thấy)`);
    expect(la).toEqual([]);
  });

  it("§2 mỗi khoá `che` GỌI đủ bộ che trong thân đơn vị (gỡ một lời gọi ⇒ đỏ, nêu tên khoá)", () => {
    const thieu: string[] = [];
    const nutTheoTep = new Map<string, Map<string, ts.Node | null>>();
    for (const [k, m] of Object.entries(SO_CAI)) {
      if (m.phanLoai !== "che") continue;
      const tep = k.split("#")[0];
      if (!nutTheoTep.has(tep)) nutTheoTep.set(tep, quetNguon(tep, docTep(tep), tenDv).nut);
      const t = thieuLoiGoi(nutTheoTep.get(tep)!.get(k), m.qua);
      if (t.length) thieu.push(`${k} thiếu ${t.join(", ")}`);
    }
    expect(thieu).toEqual([]);
  });

  it("§2b hàm che ghép (hangAnToan) tự gọi bộ che nguyên thuỷ (redactAdapterRow + chiTietKyThuatCua + maLoiAdapterCua + tamKhoaAdapter)", () => {
    for (const [ten, { tep, phaiGoi }] of Object.entries(HAM_CHE_GHEP)) {
      const sf = ts.createSourceFile(tep, docTep(tep), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      expect(thieuLoiGoi(hamCapDinh(sf).get(ten), phaiGoi), `${tep}#${ten}`).toEqual([]);
    }
  });

  it("§2c REST /api/v1: mọi khoá `che` gọi bộ che với người xem `false` TƯỜNG MINH — redactAdapterRow({ chiTietKyThuat: false }) / cheRunView(v, false) (khoá API không bao giờ là người xem)", () => {
    const sai: string[] = [];
    for (const [k, m] of Object.entries(SO_CAI)) {
      if (m.phanLoai !== "che" || !k.startsWith("server/api/")) continue;
      const tep = k.split("#")[0];
      const nut = quetNguon(tep, docTep(tep), tenDv).nut.get(k);
      let thay = 0;
      let dung = 0;
      const t = (x: ts.Node) => {
        if (ts.isCallExpression(x) && tenGoi(x) === "redactAdapterRow") {
          thay++;
          const a = x.arguments[1];
          if (
            a &&
            ts.isObjectLiteralExpression(a) &&
            a.properties.some((p) => ts.isPropertyAssignment(p) && p.name.getText() === "chiTietKyThuat" && p.initializer.kind === ts.SyntaxKind.FalseKeyword)
          )
            dung++;
        }
        if (ts.isCallExpression(x) && ["cheRunView", "cheHangRun", "cheBuocRun", "cheKetQuaLenh"].includes(tenGoi(x))) {
          thay++;
          if (x.arguments[1]?.kind === ts.SyntaxKind.FalseKeyword) dung++;
        }
        ts.forEachChild(x, t);
      };
      if (nut) t(nut);
      if (thay === 0 || dung !== thay) sai.push(`${k}: lời gọi che ${thay} lần, người xem false ${dung}`);
    }
    expect(sai).toEqual([]);
  });

  it("§2d edgeNodeRoutes: MỌI khoá miễn trừ theo edge-node principal nằm sau `auth` = requireEdgeNode() (nhận khoá API / phiên người dùng ⇒ quyết lại)", () => {
    const tep = "server/api/v1/edgeNodeRoutes.ts";
    const sf = ts.createSourceFile(tep, docTep(tep), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    let authLaEdge = false;
    const tuyen = new Map<string, string>();
    const t = (x: ts.Node) => {
      if (ts.isVariableDeclaration(x) && x.name.getText() === "auth" && x.initializer && ts.isCallExpression(x.initializer) && tenGoi(x.initializer) === "requireEdgeNode")
        authLaEdge = true;
      if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression) && HTTP.test(x.expression.name.text) && x.arguments[0] && ts.isStringLiteralLike(x.arguments[0]))
        tuyen.set(`${tep}#${x.expression.name.text.toUpperCase()} ${x.arguments[0].text}`, x.arguments[1]?.getText() ?? "");
      ts.forEachChild(x, t);
    };
    t(sf);
    expect(authLaEdge, "`const auth = requireEdgeNode()`").toBe(true);
    const khoa = Object.keys(SO_CAI).filter((k) => k.startsWith(tep + "#"));
    expect(khoa.length).toBe(10);
    for (const k of khoa) expect(tuyen.get(k), k).toBe("auth");
  });

  it("§3 GHIM số khoá / điểm chạm / che / miễn trừ (đo 2026-11-01); miễn trừ nào cũng có lý do", () => {
    const muc = Object.values(SO_CAI);
    expect({
      khoa: DO.dem.size,
      diemCham: [...DO.dem.values()].reduce((a, v) => a + tong(v), 0),
      che: muc.filter((m) => m.phanLoai === "che").length,
      mienTru: muc.filter((m) => m.phanLoai === "mien_tru").length,
    }).toEqual(GHIM);
    for (const [k, m] of Object.entries(SO_CAI)) if (m.phanLoai === "mien_tru") expect(m.lyDo.trim().length, `lý do ${k}`).toBeGreaterThan(10);
  });

  it("§4 FIXTURE tệp ảo — mỗi hình rò bị BẮT đúng loại, đúng đơn vị (là khoá LẠ ⇒ đỏ ở §1); thiếu bộ che ⇒ thieuLoiGoi nêu tên", () => {
    const thu = (r: string, src: string, dv = new Set<string>()) => Object.fromEntries([...quetNguon(r, src, dv).dem].map(([k, v]) => [k.split("#")[1], sapXep(v)]));
    const REST = [
      `import { deviceAdapters } from "../../../drizzle/schema";`,
      `export function dang(r: any, d: any) {`,
      `  r.get("/ro/:id", async (req: any, res: any) => { res.json(await d.select({ e: deviceAdapters.lastError, x: deviceAdapters.endpoint }).from(deviceAdapters)); });`,
      `  r.get("/nguyen", async (req: any, res: any) => { res.json(await d.select().from(deviceAdapters)); });`,
      `  r.post("/tra-ve", async (req: any, res: any) => { res.json(await d.insert(deviceAdapters).values({}).returning()); });`,
      `  r.get("/an-toan", async (req: any, res: any) => { res.json(await d.select({ id: deviceAdapters.id }).from(deviceAdapters)); });`,
      `}`,
    ].join("\n");
    expect(thu("server/api/v1/xAo.ts", REST)).toEqual({ "GET /ro/:id": { cot_ky_thuat: 2 }, "GET /nguyen": { nguyen_hang: 1 }, "POST /tra-ve": { nguyen_hang: 1 } });
    const TRPC = [
      `import { layHang } from "../services/x";`,
      `const { deviceAdapters: da } = await import("../../drizzle/schema");`,
      `async function docMot(id: number) { return (await db.select().from(da).limit(1))[0]; }`,
      `export const x = router({`,
      `  hl: p.query(async () => { const { listSupervisorStatuses } = await import("../services/ot/otManager"); return listSupervisorStatuses(); }),`,
      `  qua: p.query(async () => docMot(1)),`,
      "  tho: p.query(async () => db.execute(sql`SELECT endpoint FROM device_adapters`)),",
      `  dv: p.query(async () => layHang()),`,
      `});`,
    ].join("\n");
    expect(thu("server/routers/xAo.ts", TRPC, new Set(["layHang"]))).toEqual({
      docMot: { nguyen_hang: 1 },
      "proc:hl": { ram: 1 },
      "proc:qua": { ham_cuc_bo: 1 },
      "proc:tho": { sql_tho: 1 },
      "proc:dv": { dich_vu: 1 },
    });
    for (const k of ["server/api/v1/xAo.ts#GET /ro/:id", "server/routers/xAo.ts#proc:hl"]) expect(SO_CAI[k]).toBeUndefined();
    // thiếu bộ che ⇒ nêu đúng tên lời gọi thiếu
    const sf = ts.createSourceFile("y.ts", `r.get("/h", async () => { const a = 1; return a; });`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const route = (sf.statements[0] as ts.ExpressionStatement).expression;
    expect(thieuLoiGoi(route, ["redactAdapterRow", "maLoiAdapterCua"])).toEqual(["redactAdapterRow", "maLoiAdapterCua"]);
    expect(thieuLoiGoi(undefined, ["redactAdapterRow"])).toEqual(["redactAdapterRow"]);
  });

  it("§5a miễn trừ ĐÃ QUYẾT audit before.endpoint (2026-11-01): còn đúng — tamTat vẫn ghi endpoint vào before; census bất biến người đọc audit tồn tại", () => {
    const m = MIEN_TRU_DA_QUYET.find((x) => x.ma === "audit_before_endpoint")!;
    expect(m.ngay).toBe("2026-11-01");
    const sf = ts.createSourceFile("s.ts", docTep("server/routers/scadaDiagRouter.ts"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    let coGhi = false;
    const t = (x: ts.Node) => {
      if (ts.isPropertyAssignment(x) && x.name.getText() === "tamTat" && /before:\s*\{[^}]*endpoint:\s*cu\.endpoint/.test(x.getText())) coGhi = true;
      ts.forEachChild(x, t);
    };
    t(sf);
    expect(coGhi, "nếu tamTat thôi ghi endpoint thì bỏ mục miễn trừ này").toBe(true);
    expect(docTep("server/routers/controlAuditLogDocCensus.test.ts")).toContain("export const CHO_PHEP");
  });

  it("§5b miễn trừ ĐÃ QUYẾT MCP (2026-11-01): ĐÚNG câu chữ; chỉ loopback; không tệp server/ nào ngoài mcpCucBo import nó", () => {
    const m = MIEN_TRU_DA_QUYET.find((x) => x.ma === "mcp_cuc_bo")!;
    expect(m.noiDung).toBe("MCP local dev tool — known reader, outside app permissions");
    expect(docTep("scripts/mcp-cuc-bo.ts")).toMatch(/\.listen\(\s*cong\s*,\s*"127\.0\.0\.1"/);
    const ngoai = tepDuoi("server")
      .map(rel)
      .filter((r) => !r.startsWith("server/services/mcpCucBo/") && /["'][^"']*mcpCucBo[^"']*["']/.test(docTep(r)));
    expect(ngoai).toEqual([]);
    expect(docTep("server/routers/deviceAdapterRouter.ts")).toContain("sealConnectionOptionSecrets(");
  });

  it("§4b FIXTURE (C2 fix 4, review I1 + phụ lục điều phối) — MỖI hình gọi dịch vụ qua import là một khoá `dich_vu` LẠ, đúng đơn vị", () => {
    const dv = new Set(["configForNode"]);
    const thu = (src: string, them: ReadonlySet<string> = dv) =>
      Object.fromEntries([...quetNguon("server/api/v1/xAo.ts", src, them).dem].map(([k, v]) => [k.split("#")[1], sapXep(v)]));
    const ROUTE = (than: string) => `export function dang(r: any) {\n  r.post("/ro", async (req: any, res: any) => { ${than} });\n}`;
    // (1) gọi thẳng trên import động
    expect(thu(ROUTE(`res.json(await (await import("../../services/edge/edgeConfigCentral")).configForNode(1, {}, null));`))).toEqual({ "POST /ro": { dich_vu: 1 } });
    // (2) destructure, (2b) destructure ĐỔI TÊN
    expect(thu(ROUTE(`const { configForNode } = await import("../../services/edge/edgeConfigCentral"); res.json(await configForNode(1, {}, null));`))).toEqual({
      "POST /ro": { dich_vu: 1 },
    });
    expect(thu(ROUTE(`const { configForNode: g } = await import("../../services/edge/edgeConfigCentral"); res.json(await g(1, {}, null));`))).toEqual({
      "POST /ro": { dich_vu: 1 },
    });
    // (3) không gian: biến = await import(…), import * as, hàm cục bộ trả import
    expect(thu(ROUTE(`const svc = await import("../../services/edge/edgeConfigCentral"); res.json(await svc.configForNode(1, {}, null));`))).toEqual({
      "POST /ro": { dich_vu: 1 },
    });
    expect(thu(`import * as svc from "../../services/edge/edgeConfigCentral";\n` + ROUTE(`res.json(await svc.configForNode(1, {}, null));`))).toEqual({
      "POST /ro": { dich_vu: 1 },
    });
    expect(thu(`const svc = () => import("../../services/edge/edgeConfigCentral");\n` + ROUTE(`res.json(await (await svc()).configForNode(1, {}, null));`))).toEqual({
      "POST /ro": { dich_vu: 1 },
    });
    // (3b) import tĩnh ĐỔI TÊN
    expect(thu(`import { configForNode as cfg } from "../../services/edge/edgeConfigCentral";\n` + ROUTE(`res.json(await cfg(1, {}, null));`))).toEqual({
      "POST /ro": { dich_vu: 1 },
    });
    // (4) tái xuất: `export { configForNode as layCauHinh } from "…services…"` ⇒ gọi `layCauHinh` qua module tái xuất ≡ nguồn; `export *` giữ tên
    const tx = biDanhTaiXuat([["server/lib/taiXuat.ts", `export { configForNode as layCauHinh } from "../services/edge/edgeConfigCentral";\nexport * from "../services/edge/edgeCoordinator";`]], dv);
    expect([...tx]).toEqual([["layCauHinh", "configForNode"]]);
    const voiTaiXuat = new Set([...dv, ...tx.keys()]);
    expect(thu(`import { layCauHinh } from "../../lib/taiXuat";\n` + ROUTE(`res.json(await layCauHinh(1, {}, null));`), voiTaiXuat)).toEqual({ "POST /ro": { dich_vu: 1 } });
    expect(thu(`import { configForNode } from "../../lib/taiXuat";\n` + ROUTE(`res.json(await configForNode(1, {}, null));`))).toEqual({ "POST /ro": { dich_vu: 1 } }); // export *
    // đối chứng: thiếu tái xuất trong tập ⇒ KHÔNG bắt (chứng minh bước tái xuất là cần)
    expect(thu(`import { layCauHinh } from "../../lib/taiXuat";\n` + ROUTE(`res.json(await layCauHinh(1, {}, null));`))).toEqual({});
    // (5) bảng orchestration: cột error / resultJson, hàng nguyên, SQL thô
    const FOE = [
      `import { orchestrationRunSteps, orchestrationRuns } from "../../../drizzle/schema";`,
      `export function dang(r: any, d: any) {`,
      `  r.get("/buoc", async (req: any, res: any) => res.json(await d.select({ e: orchestrationRunSteps.error }).from(orchestrationRunSteps)));`,
      `  r.get("/run", async (req: any, res: any) => res.json(await d.select().from(orchestrationRuns)));`,
      "  r.get(\"/tho\", async (req: any, res: any) => res.json(await d.execute(sql`SELECT s.\"error\" FROM orchestration_run_steps s`)));",
      `}`,
    ].join("\n");
    expect(thu(FOE, new Set())).toEqual({ "GET /buoc": { cot_ky_thuat: 1 }, "GET /run": { nguyen_hang: 1 }, "GET /tho": { sql_tho: 1 } });
  });
});
