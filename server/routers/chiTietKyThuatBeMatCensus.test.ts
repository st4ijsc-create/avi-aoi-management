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
 *   • `dich_vu`      — gọi (theo TÊN, tên phải được import trong tệp) một hàm XUẤT của `server/services/**` mà thân có điểm chạm DB / RAM (một bậc).
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

type Loai = "cot_ky_thuat" | "nguyen_hang" | "sql_tho" | "ram" | "dich_vu" | "ham_cuc_bo";
type Muc = { dem: Partial<Record<Loai, number>> } & ({ phanLoai: "che"; qua: string[]; lyDo?: string } | { phanLoai: "mien_tru"; lyDo: string });

const TEN_BANG = "deviceAdapters";
const COT_KY_THUAT = new Set(["endpoint", "lastError", "connectionOptions"]);
const SQL_NHAY_CAM = /\bendpoint\b|"lastError"|\blast_error\b|"connectionOptions"|\bconnection_options\b|select\s+\*|\b\w+\.\*|row_to_json|to_jsonb?\s*\(/i;
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

/** Tên cục bộ chỉ bảng `deviceAdapters` (import / destructure / alias). */
function tenBang(sf: ts.SourceFile): Set<string> {
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
        laBang(n.initializer.arguments[0], bang) &&
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

function laBang(e: ts.Node, bang: Set<string>): boolean {
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
function loaiThamChieu(r: ts.Expression, bang: Set<string>): Loai | null {
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
        if (ts.isPropertyAssignment(pr) && (laBang(pr.initializer, bang) || /getTableColumns\(/.test(pr.initializer.getText()))) return "nguyen_hang";
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
  const bang = tenBang(sf);
  const imp = tenImport(sf);
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
    if (ts.isIdentifier(n) && bang.has(n.text) && viTriGiaTri(n)) {
      const l = loaiThamChieu(n, bang);
      if (l) them(n, l);
    } else if ((ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) && laBang(n, bang)) {
      const l = loaiThamChieu(n, bang);
      if (l) them(n, l);
      return;
    }
    if (ts.isCallExpression(n)) {
      const t = tenGoi(n);
      if (NGUON_RAM.has(t)) them(n, "ram");
      else if (dichVu.has(t) && imp.has(t)) them(n, "dich_vu");
    }
    const t = vanBan(n);
    if (t !== null && /device_adapters/i.test(t) && SQL_NHAY_CAM.test(t)) them(n, "sql_tho");
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
    if (!/deviceAdapters|device_adapters|listSupervisorStatuses|getSupervisorStatus|OtAdapterStatus|layTrangThaiAdapter|getActiveAdapter|listActiveAdapters/.test(src)) continue;
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

function doTatCa(): { dem: Map<string, Partial<Record<Loai, number>>>; soTep: Record<string, number>; dichVu: Map<string, string[]> } {
  const dichVu = nguonDichVu();
  const ten = new Set(dichVu.keys());
  const dem = new Map<string, Partial<Record<Loai, number>>>();
  const soTep: Record<string, number> = {};
  for (const g of GOC_BE_MAT) {
    const tep = tepDuoi(g);
    soTep[g] = tep.length;
    for (const p of tep) for (const [k, v] of quetNguon(rel(p), readFileSync(p, "utf8"), ten).dem) dem.set(k, v);
  }
  return { dem, soTep, dichVu };
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
  "server/api/v1/router.ts#GET /orchestration/runs/:id": { dem: { dich_vu: 1 }, phanLoai: "mien_tru", lyDo: MT_FOE },
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
  "server/routers/edgeDeploymentRouter.ts#proc:getUnifiedFleetStatus": { dem: { dich_vu: 1 }, phanLoai: "mien_tru", lyDo: "adminProcedure (vai admin) — review C2 đã rà fleetStatusService" },
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
  "server/routers/orchestrationRouter.ts#proc:getRun": { dem: { dich_vu: 1 }, phanLoai: "mien_tru", lyDo: MT_FOE },
  "server/routers/orchestrationRouter.ts#proc:abortRun": { dem: { dich_vu: 1 }, phanLoai: "mien_tru", lyDo: MT_FOE },
  "server/routers/orchestrationRouter.ts#proc:resumeRun": { dem: { dich_vu: 1 }, phanLoai: "mien_tru", lyDo: MT_FOE },
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

/** GHIM (đo 2026-11-01): số khoá / điểm chạm / che / miễn trừ. Đổi ⇒ phân loại khoá mới trước, cập nhật cùng ngày + lý do. Không nới. */
const GHIM = { khoa: 43, diemCham: 63, che: 9, mienTru: 34 };
/** Bảo vệ "đi rỗng" (đo 2026-11-01: api 30, routes 26, routers 239, _core 82 tệp; nguồn dịch vụ 55 hàm). Ngưỡng dưới ~85 % số đo. */
const SAN_TEP: Record<(typeof GOC_BE_MAT)[number], number> = { "server/api": 25, "server/routes": 22, "server/routers": 200, "server/_core": 70 };
const SAN_NGUON_DICH_VU = 47;

/** Hàm che GHÉP phải tự gọi bộ che nguyên thuỷ (tệp → hàm → phải gọi). */
const HAM_CHE_GHEP: Record<string, { tep: string; phaiGoi: string[] }> = {
  hangAnToan: { tep: "server/routers/deviceAdapterRouter.ts", phaiGoi: ["chiTietKyThuatCua", "redactAdapterRow", "maLoiAdapterCua", "tamKhoaAdapter"] },
};

const docTep = (tep: string) => readFileSync(join(GOC, tep), "utf8");

describe("★★★ census — chi tiết kỹ thuật adapter (endpoint / activeEndpoint / connectionOptions / lastError) trên REST + tRPC (KD-2bA 2.1, C2 fix 3)", () => {
  const DO = doTatCa();
  const tenDv = new Set(DO.dichVu.keys());
  const tong = (o: Partial<Record<Loai, number>>) => Object.values(o).reduce((a, b) => a + (b ?? 0), 0);

  it("§0 thiết bị đo KHÔNG đi rỗng: đủ tệp mỗi gốc, nguồn dịch vụ không rỗng, mỗi loại điểm chạm xuất hiện", () => {
    for (const g of GOC_BE_MAT) expect(DO.soTep[g], `số tệp quét dưới ${g}`).toBeGreaterThanOrEqual(SAN_TEP[g]);
    expect(DO.dichVu.size, "số hàm dịch vụ nguồn").toBeGreaterThanOrEqual(SAN_NGUON_DICH_VU);
    const loai = new Set([...DO.dem.values()].flatMap((v) => Object.keys(v)));
    for (const l of ["cot_ky_thuat", "nguyen_hang", "sql_tho", "ram", "dich_vu", "ham_cuc_bo"]) expect(loai.has(l), `loại ${l}`).toBe(true);
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

  it("§2c REST /api/v1: mọi khoá `che` gọi redactAdapterRow với người xem `chiTietKyThuat: false` TƯỜNG MINH (khoá API không bao giờ là người xem)", () => {
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
        ts.forEachChild(x, t);
      };
      if (nut) t(nut);
      if (thay === 0 || dung !== thay) sai.push(`${k}: redactAdapterRow ${thay} lần, chiTietKyThuat:false ${dung}`);
    }
    expect(sai).toEqual([]);
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
});
