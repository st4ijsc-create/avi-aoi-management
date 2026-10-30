/**
 * ★★★ SCADA R1b-2b-2b A — C1 (KD-2bA 1.1 + 1.3; điều phối 2026-10-27; fix round 1 I2 — census ĐẢO CHIỀU) — CENSUS bảng `command_log`.
 *
 * Luật (điều phối): KHÔNG thủ tục nào dưới mức "admin / engineer có `machine_control.canEdit`" trả `errorText` / `ackValue` của
 * `command_log` (văn bản lỗi driver có thể mang host:port; ackValue là ledger nội bộ / payload ack thiết bị).
 *
 * ĐẢO CHIỀU (review I2): không đi tìm vài HÌNH đọc cột — đếm MỌI tham chiếu tới BẢNG `commandLog` (kể cả bí danh import `{ commandLog as cl }`,
 * `import * as schema` ⇒ `schema.commandLog`, destructure `{ commandLog } = await import(…)`, `alias(commandLog, …)`) và MỌI chuỗi / template
 * SQL thô có chữ `command_log`, ở MỌI tệp `.ts` của `server/` (trừ test / testkit / `__*`). Mỗi tham chiếu được gán LOẠI:
 *   • `cot_an_toan`      — `T.<cột>` với cột ∉ {errorText, ackValue};
 *   • `cot_ky_thuat`     — `T.errorText` / `T.ackValue`;
 *   • `doc_chieu`        — `.from(T)` / `.*Join(T)` dưới `select({…})` chiếu TƯỜNG MINH (không spread / không cả bảng / không getTableColumns);
 *   • `doc_nguyen_hang`  — `.select()` không đối số, `select({ ...getTableColumns(T) })`, `select({ row: T })`, join dưới các select ấy,
 *                          `getTableColumns(T)`, `T` làm giá trị trong một object (`{ row: T }`), `db.query.commandLog`;
 *   • `ghi`              — `.insert(T)` / `.update(T)` / `.delete(T)`;
 *   • `bi_danh`          — `alias(T, …)` (bí danh được theo dõi tiếp);
 *   • `bang_khac`        — `T` truyền đi chỗ khác (đối số hàm, `${T}` trong sql``, …) — luôn phải phân loại;
 *   • `sql_tho`          — chuỗi / template SQL có `command_log`;
 *   • `sql_tho_nhay_cam` — như trên VÀ có `SELECT *` / `x.*` / `row_to_json` / `to_json(b)` / `"errorText"` / `"ackValue"`.
 * Khoá = `tệp#hàm-bao`; mỗi khoá PHẢI có trong `SO_CAI` với ĐÚNG số đếm từng loại và một PHÂN LOẠI:
 *   • `chi_cot_an_toan` — chỉ được dùng khi các loại ⊆ {cot_an_toan, doc_chieu, ghi};
 *   • `che`             — thủ tục canView trả hàng qua bộ che (`cheHangLenh` / `chiTietKyThuatCua`) — §2 kiểm thân thủ tục;
 *   • `vi_tu`           — hai cột chỉ trong WHERE / FILTER / đếm;
 *   • `suy_ra`          — chỉ suy ra trường an toàn (mã, ledger, intentId số);
 *   • `ghi_canEdit`     — đường ghi / dispatch: kết quả về NGƯỜI RA LỆNH đã qua `machine_control.canEdit`;
 *   • `noi_bo`          — nội bộ, không trả về thủ tục.
 * §3 — thủ tục tRPC CHẠM (qua đồ thị gọi theo TÊN, ≤ 5 bậc) một hàm có loại rủi ro (`cot_ky_thuat` / `doc_nguyen_hang` / `bang_khac` /
 * `sql_tho_nhay_cam`) phải có trong `THU_TUC_CHAM` kèm lý do (quyền của thủ tục / hàm che). Thủ tục mới gọi hàm có sẵn ⇒ khoá LẠ ⇒ đỏ.
 * §4 — mỗi điểm mù review I2 (1–5) có một FIXTURE trên tệp ảo, đỏ đúng chỗ; fix round 2: import động namespace (N1) + cột trần trong sql (N3).
 * ⚠ GIỚI HẠN ĐÃ BIẾT (re-review N4): đồ thị §3 chỉ đi từ thủ tục tRPC dưới `server/routers/` — KHÔNG đi REST (`server/routes/*`, `server/api/**`),
 *   registry tool AI, hay import động; `khai` không gồm hàm là thuộc tính object (`export const svc = { doc: async () => … }`) nên hàm rủi ro kiểu ấy
 *   không thành "rủi ro" cho §3. Tham chiếu TRỰC TIẾP ở các chỗ ấy vẫn bị §1 bắt (quét mọi tệp server/).
 *
 * §5 (KD-2bA 1.3) — chứng minh `requested_value.daXacMinhPhamVi` của lần thử `adapter_id` NULL do MÁY CHỦ đặt: mọi lời gọi ghi lần thử
 * KHÔNG có adapter mà có `requestedValue` đều nằm ở MỘT chỗ (`tuChoiQuaHan`), cờ là biến cục bộ chỉ nhận literal `false` / `true`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const GOC = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

type Loai =
  | "cot_an_toan"
  | "cot_ky_thuat"
  | "doc_chieu"
  | "doc_nguyen_hang"
  | "ghi"
  | "bi_danh"
  | "bang_khac"
  | "sql_tho"
  | "sql_tho_nhay_cam";
type PhanLoai = "chi_cot_an_toan" | "che" | "vi_tu" | "suy_ra" | "ghi_canEdit" | "noi_bo";
const LOAI_AN_TOAN: ReadonlySet<Loai> = new Set(["cot_an_toan", "doc_chieu", "ghi"]);
const LOAI_RUI_RO: ReadonlySet<Loai> = new Set(["cot_ky_thuat", "doc_nguyen_hang", "bang_khac", "sql_tho_nhay_cam"]);

function tepServer(): string[] {
  const ra: string[] = [];
  const di = (d: string) => {
    for (const n of readdirSync(d)) {
      if (n === "node_modules" || n === "dist") continue;
      const p = join(d, n);
      const st = statSync(p);
      if (st.isDirectory()) di(p);
      else if (/\.ts$/.test(n) && !/\.(test|spec)\.ts$/.test(n) && !/testkit/i.test(n) && !n.startsWith("__") && !n.endsWith(".d.ts")) ra.push(p);
    }
  };
  di(join(GOC, "server"));
  return ra.sort();
}

/** Tên hàm / thủ tục bao gần nhất (FunctionDeclaration · MethodDeclaration · VariableDeclaration của arrow/function · PropertyAssignment). */
function hamBao(n: ts.Node): string {
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
    if ((ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p)) && p.name) return p.name.getText();
    if (ts.isVariableDeclaration(p) && p.initializer && (ts.isArrowFunction(p.initializer) || ts.isFunctionExpression(p.initializer))) return p.name.getText();
    if (ts.isPropertyAssignment(p) && (ts.isArrowFunction(p.initializer) || ts.isCallExpression(p.initializer) || ts.isFunctionExpression(p.initializer))) return p.name.getText();
  }
  return "<tep>";
}

const COT_KY_THUAT = new Set(["errorText", "ackValue"]);
const COT_THO = /"errorText"|"ackValue"|\berror_text\b|\back_value\b/;
const TEN_BANG = "commandLog";

/** Toàn văn một literal chuỗi / template (phần chữ; `${…}` thay bằng `${}`). */
function vanBan(n: ts.Node): string | null {
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (ts.isTemplateExpression(n)) return n.head.text + n.templateSpans.map((s) => "${}" + s.literal.text).join("");
  return null;
}

/** Mọi tên cục bộ chỉ BẢNG commandLog trong một tệp + tên namespace import của schema. */
function tenTheoDoi(sf: ts.SourceFile): { bang: Set<string>; khongGian: Set<string> } {
  const bang = new Set<string>();
  const khongGian = new Set<string>();
  const tham = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && /drizzle\/schema/.test(n.moduleSpecifier.text)) {
      const nb = n.importClause?.namedBindings;
      if (nb && ts.isNamedImports(nb)) for (const e of nb.elements) if ((e.propertyName ?? e.name).text === TEN_BANG) bang.add(e.name.text);
      if (nb && ts.isNamespaceImport(nb)) khongGian.add(nb.name.text);
    }
    // destructure: const { commandLog } = …  /  const { commandLog: cl } = …
    if (ts.isBindingElement(n) && ts.isIdentifier(n.name) && ((n.propertyName && n.propertyName.getText() === TEN_BANG) || (!n.propertyName && n.name.text === TEN_BANG))) bang.add(n.name.text);
    ts.forEachChild(n, tham);
  };
  tham(sf);
  // bí danh drizzle: const r = alias(<bảng>, "r") — lặp tới điểm bất động (bí danh của bí danh)
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
        laThamChieuBang(n.initializer.arguments[0], bang, khongGian) &&
        !bang.has(n.name.text)
      ) {
        bang.add(n.name.text);
        doi = true;
      }
      ts.forEachChild(n, t2);
    };
    t2(sf);
  }
  return { bang, khongGian };
}

/**
 * fix round 2 (N1) — MỌI truy cập `<bất kỳ>.commandLog` / `<bất kỳ>["commandLog"]` là tham chiếu bảng, BẤT KỂ bên nhận (`schema` từ
 * `const schema = await import(…)`, `(await import(…)).commandLog`, `db.query.commandLog`, namespace import…) — xấp xỉ TRÊN, chống mù idiom import
 * động của repo. (`khongGian` giữ cho tương thích — không còn cần cho quyết định.)
 */
function laThamChieuBang(e: ts.Node, bang: Set<string>, _khongGian: Set<string>): boolean {
  if (ts.isIdentifier(e)) return bang.has(e.text);
  if (ts.isPropertyAccessExpression(e) && e.name.text === TEN_BANG) return true;
  if (ts.isElementAccessExpression(e) && ts.isStringLiteralLike(e.argumentExpression) && e.argumentExpression.text === TEN_BANG) return true;
  return false;
}

/** Identifier ở vị trí GIÁ TRỊ (không phải tên khai báo / tên thuộc tính / kiểu). */
function viTriGiaTri(id: ts.Identifier): boolean {
  const p = id.parent;
  if (ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p)) return false;
  if (ts.isBindingElement(p)) return false;
  if ((ts.isVariableDeclaration(p) || ts.isFunctionDeclaration(p) || ts.isParameter(p)) && p.name === id) return false;
  if (ts.isPropertyAssignment(p) && p.name === id) return false;
  if ((ts.isPropertySignature(p) || ts.isPropertyDeclaration(p) || ts.isMethodSignature(p) || ts.isMethodDeclaration(p) || ts.isEnumMember(p)) && p.name === id) return false;
  for (let q: ts.Node | undefined = p; q; q = q.parent) if (ts.isInterfaceDeclaration(q) || ts.isTypeAliasDeclaration(q)) return false;
  if (ts.isPropertyAccessExpression(p) && p.name === id) return false;
  if (ts.isQualifiedName(p) || ts.isTypeReferenceNode(p) || ts.isTypeQueryNode(p)) return false;
  for (let q: ts.Node | undefined = p; q; q = q.parent) if (ts.isTypeNode(q)) return false;
  return true;
}

/** Gọi select gốc của một chuỗi `.from(T)` / `.leftJoin(T, …)` (đi xuống qua các lời gọi xâu chuỗi). */
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

function loaiDoc(call: ts.CallExpression, bang: Set<string>, khongGian: Set<string>): Loai {
  const s = selectGoc(call);
  if (!s || s.arguments.length === 0) return "doc_nguyen_hang";
  const a = s.arguments[0];
  if (!ts.isObjectLiteralExpression(a)) return "doc_nguyen_hang";
  for (const p of a.properties) {
    if (ts.isSpreadAssignment(p)) return "doc_nguyen_hang";
    if (ts.isShorthandPropertyAssignment(p) && bang.has(p.name.text)) return "doc_nguyen_hang";
    if (ts.isPropertyAssignment(p) && (laThamChieuBang(p.initializer, bang, khongGian) || /getTableColumns\(/.test(p.initializer.getText()))) return "doc_nguyen_hang";
  }
  return "doc_chieu";
}

const JOIN = /^(from|leftJoin|innerJoin|rightJoin|fullJoin|crossJoin|leftJoinLateral|innerJoinLateral)$/;

function loaiThamChieu(r: ts.Expression, bang: Set<string>, khongGian: Set<string>): Loai {
  // db.query.commandLog.* — API quan hệ trả nguyên hàng
  if (ts.isPropertyAccessExpression(r) && ts.isPropertyAccessExpression(r.expression) && r.expression.name.text === "query") return "doc_nguyen_hang";
  const p = r.parent;
  if (ts.isPropertyAccessExpression(p) && p.expression === r) return COT_KY_THUAT.has(p.name.text) ? "cot_ky_thuat" : "cot_an_toan";
  if (ts.isElementAccessExpression(p) && p.expression === r) return "bang_khac";
  if (ts.isCallExpression(p) && p.arguments.includes(r)) {
    const ten = ts.isPropertyAccessExpression(p.expression) ? p.expression.name.text : ts.isIdentifier(p.expression) ? p.expression.text : "";
    if (JOIN.test(ten)) return loaiDoc(p, bang, khongGian);
    if (ten === "insert" || ten === "update" || ten === "delete") return "ghi";
    if (ten === "alias") return "bi_danh";
    if (ten === "getTableColumns" || ten === "getTableConfig") return "doc_nguyen_hang";
    return "bang_khac";
  }
  if (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p) || ts.isSpreadAssignment(p)) return "doc_nguyen_hang";
  return "bang_khac";
}

/** Quét MỘT nguồn ⇒ `tệp#hàm` → đếm theo loại. */
export function quetNguon(rel: string, src: string): Map<string, Partial<Record<Loai, number>>> {
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const { bang, khongGian } = tenTheoDoi(sf);
  const ra = new Map<string, Partial<Record<Loai, number>>>();
  // polish (re-review R1) — cả tệp chỉ chạm bảng bằng SQL thô (`command_log` trong chuỗi, vd edgeResolutionService) cũng bật kiểm cột trần
  const coThamChieu = bang.size > 0 || /\.commandLog\b|\["commandLog"\]|command_log/i.test(src);
  const them = (n: ts.Node, loai: Loai) => {
    const k = `${rel}#${hamBao(n)}`;
    const m = ra.get(k) ?? {};
    m[loai] = (m[loai] ?? 0) + 1;
    ra.set(k, m);
  };
  const tham = (n: ts.Node) => {
    if (ts.isIdentifier(n) && bang.has(n.text) && viTriGiaTri(n)) them(n, loaiThamChieu(n, bang, khongGian));
    else if ((ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) && laThamChieuBang(n, bang, khongGian)) {
      them(n, loaiThamChieu(n, bang, khongGian));
      return; // không đếm lại phần trong
    }
    const t = vanBan(n);
    // fix round 2 (N3) — chuỗi SQL có tên cột kỹ thuật trần ("errorText" / "ackValue" / error_text / ack_value) trong tệp có tham chiếu bảng
    // ⇒ nhạy cảm, KHÔNG BAO GIỜ là đọc an toàn (vd `select({ e: sql\`"errorText"\` }).from(commandLog)`)
    if (t !== null && !/command_log/i.test(t) && coThamChieu && COT_THO.test(t)) them(n, "sql_tho_nhay_cam");
    if (t !== null && /command_log/i.test(t)) {
      them(n, /select\s+\*|\b\w+\.\*|row_to_json|to_jsonb?\s*\(|"errorText"|"ackValue"/i.test(t) ? "sql_tho_nhay_cam" : "sql_tho");
      if (ts.isTemplateExpression(n)) {
        for (const sp of n.templateSpans) tham(sp.expression); // ${…} vẫn được quét (vd ${commandLog.errorText})
        return;
      }
    }
    ts.forEachChild(n, tham);
  };
  tham(sf);
  return ra;
}

// ─── đồ thị gọi theo TÊN (§3) ──────────────────────────────────────────────────────────────────────────────────────────────────
interface ChiMuc {
  /** tên hàm → các tên được gọi trong thân (gộp mọi định nghĩa trùng tên — xấp xỉ TRÊN) */
  goi: Map<string, Set<string>>;
  /** `tệp#thủ tục` (router tRPC) → các tên được gọi */
  thuTuc: Map<string, Set<string>>;
  /** `tệp#tên` của mọi hàm KHAI BÁO (function / const arrow / method) — hàm rủi ro phải là một hàm thật, không phải tên thủ tục */
  khai: Set<string>;
}
function tenDuocGoi(goc: ts.Node): Set<string> {
  const ra = new Set<string>();
  const t = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      if (ts.isIdentifier(n.expression)) ra.add(n.expression.text);
      else if (ts.isPropertyAccessExpression(n.expression)) ra.add(n.expression.name.text);
    }
    ts.forEachChild(n, t);
  };
  t(goc);
  return ra;
}
export function lapChiMuc(nguon: Array<{ rel: string; src: string }>): ChiMuc {
  const goi = new Map<string, Set<string>>();
  const thuTuc = new Map<string, Set<string>>();
  const khai = new Set<string>();
  const gop = (ten: string, s: Set<string>) => {
    const c = goi.get(ten) ?? new Set<string>();
    for (const x of s) c.add(x);
    goi.set(ten, c);
  };
  for (const { rel, src } of nguon) {
    const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const laRouter = rel.startsWith("server/routers/");
    const t = (n: ts.Node) => {
      if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name && n.body) {
        gop(n.name.getText(), tenDuocGoi(n.body));
        khai.add(`${rel}#${n.name.getText()}`);
      }
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) {
        gop(n.name.text, tenDuocGoi(n.initializer));
        khai.add(`${rel}#${n.name.text}`);
      }
      if (laRouter && ts.isPropertyAssignment(n) && ts.isCallExpression(n.initializer) && /\.(query|mutation|subscription)\(/.test(n.initializer.getText())) {
        thuTuc.set(`${rel}#${n.name.getText()}`, tenDuocGoi(n.initializer));
      }
      ts.forEachChild(n, t);
    };
    t(sf);
  }
  return { goi, thuTuc, khai };
}
/** Thủ tục → các hàm RỦI RO chạm tới (≤ `bac` bậc theo tên). */
export function thuTucCham(cm: ChiMuc, ruiRo: ReadonlySet<string>, bac = 5): Map<string, string[]> {
  const ra = new Map<string, string[]>();
  for (const [k, goi] of cm.thuTuc) {
    const gap = new Set<string>();
    const da = new Set<string>();
    let bien = [...goi];
    for (let b = 0; b < bac && bien.length; b++) {
      const sau: string[] = [];
      for (const ten of bien) {
        if (da.has(ten)) continue;
        da.add(ten);
        if (ruiRo.has(ten)) gap.add(ten);
        for (const x of cm.goi.get(ten) ?? []) sau.push(x);
      }
      bien = sau;
    }
    if (gap.size) ra.set(k, [...gap].sort());
  }
  return ra;
}

type Dem = Partial<Record<Loai, number>>;
/**
 * ★ SỔ CÁI — ĐO 2026-10-30 trên feat/scada-r1b2b2 (7435501a1 + fix round 1). `tệp#hàm` → [đếm theo loại, phân loại, lý do].
 */
const SO_CAI: Record<string, [Dem, PhanLoai, string]> = {
  // ── commandLogRouter ──
  "server/routers/commandLogRouter.ts#<tep>": [{ cot_an_toan: 1 }, "chi_cot_an_toan", "AT_LENH = to_char(createdAt)"],
  "server/routers/commandLogRouter.ts#list": [{ cot_an_toan: 6, doc_nguyen_hang: 1 }, "che", "select() nguyên hàng ⇒ rows.map(cheHangLenh(r, chiTietKyThuatCua(ctx)))"],
  "server/routers/commandLogRouter.ts#get": [{ cot_an_toan: 1, doc_nguyen_hang: 1 }, "che", "cheHangLenh(row, chiTietKyThuatCua(ctx))"],
  "server/routers/commandLogRouter.ts#nhatKy": [{ cot_an_toan: 20, cot_ky_thuat: 2, doc_chieu: 1 }, "che", "ackValue chỉ trong vị từ notIntent; errorText ⇒ loi chỉ khi duocXem, ngược lại reasonCode = maLoiCua (mã)"],
  "server/routers/commandLogRouter.ts#stats": [{ cot_an_toan: 6, cot_ky_thuat: 2, doc_chieu: 3, sql_tho_nhay_cam: 1 }, "vi_tu", "isIntent / notIntent + count FILTER r.\"ackValue\"->>'intentId' — chỉ đếm"],
  "server/routers/commandLogRouter.ts#avgDurations": [{ cot_an_toan: 10, doc_chieu: 1 }, "chi_cot_an_toan", "chiếu commandType + thời lượng"],
  "server/routers/_adapterPhamVi.ts#dieuKienLenhTrongPhamVi": [{ cot_an_toan: 2 }, "chi_cot_an_toan", "vị từ phạm vi machineId / adapterId"],
  // ── dispatcher (đường ghi — kết quả về người ra lệnh đã qua canEdit) ──
  "server/services/ot/commandDispatcher.ts#dispatchCore": [{ cot_an_toan: 3, doc_nguyen_hang: 2, ghi: 1 }, "ghi_canEdit", "idempotency (probe + lệnh sau) select() ⇒ cachedResult.reason = errorText cho NGƯỜI GỌI dispatch"],
  "server/services/ot/commandDispatcher.ts#reserveRealWrite": [{ cot_an_toan: 4, doc_chieu: 1, doc_nguyen_hang: 1, ghi: 1 }, "ghi_canEdit", "prior trong tx ⇒ cachedResult cho người gọi dispatch"],
  "server/services/ot/commandDispatcher.ts#writeAll": [{ cot_an_toan: 1, ghi: 1 }, "chi_cot_an_toan", "insert sổ từ chối"],
  "server/services/ot/commandDispatcher.ts#writeSimulated": [{ cot_an_toan: 1, ghi: 1 }, "chi_cot_an_toan", "insert sổ mô phỏng"],
  "server/services/ot/commandDispatcher.ts#auditPinnedStopOverride": [{ sql_tho: 1 }, "noi_bo", "chuỗi log `command_log #id`"],
  "server/services/ot/commandDispatcher.ts#khiLoiAuditStopGhim": [{ sql_tho: 1 }, "noi_bo", "chuỗi log `command_log #id`"],
  "server/services/ot/ghiTreoCoTran.ts#bo": [{ sql_tho: 1 }, "noi_bo", "chuỗi log nhắc tên bảng"],
  "server/services/ops/wormTableSizeMonitor.ts#<tep>": [{ sql_tho: 1 }, "noi_bo", "danh sách tên bảng WORM để đo kích thước"],
  // ── lenhHmi ──
  "server/services/scada/lenhHmi.ts#trangThaiYeuCauGhi": [{ cot_an_toan: 11, cot_ky_thuat: 2, doc_chieu: 1 }, "suy_ra", "chủ yêu cầu: ma = mã tiền tố errorText; ledger = ackValue.ledger — không trả nguyên cột"],
  "server/services/scada/lenhHmi.ts#xacNhanGhiTag": [{ cot_an_toan: 2, doc_chieu: 1 }, "chi_cot_an_toan", "đọc readBackValue"],
  // ── edge ──
  "server/services/edge/edgeReportsCentral.ts#applyLedger": [{ ghi: 1 }, "chi_cot_an_toan", "insert kết quả edge"],
  "server/services/edge/edgeReportsCentral.ts#applySweepStop": [{ ghi: 1 }, "chi_cot_an_toan", "insert STOP quét (eff.note ⇒ errorText; fan-out cảnh báo admin ở cùng hàm — ghi chú báo cáo M1)"],
  "server/services/edge/edgeReportsCentral.ts#authUseEvidence": [{ cot_an_toan: 2, doc_chieu: 1, sql_tho: 1 }, "noi_bo", "chiếu id; chuỗi 'command_log' là nhãn bảng bằng chứng"],
  "server/services/edge/edgeResolutionService.ts#listEdgeResolutionItems": [{ sql_tho_nhay_cam: 2 }, "suy_ra", "canView: vị từ ledger + ackValue->>'intentId' / 'lateAfterResolutionId' (số) — không trả ackValue / errorText"],
  "server/services/edge/edgeResolutionService.ts#resolveOrphanedIntent": [{ sql_tho_nhay_cam: 1 }, "vi_tu", "EXISTS … ackValue->>'ledger' (supervisor + canEdit)"],
  "server/services/edge/edgeResolutionService.ts#reviewLateResult": [{ sql_tho_nhay_cam: 1 }, "ghi_canEdit", "supervisor + canEdit; ackValue chỉ đọc ledger / intentId vào audit"],
};

/**
 * ★ THỦ TỤC CHẠM hàm rủi ro (§3) — ĐO 2026-10-30. `routerTệp#thủ tục` → [hàm rủi ro chạm tới, lý do].
 */
const THU_TUC_CHAM: Record<string, [string[], string]> = {
  "server/routers/edgeResolutionRouter.ts#list": [["listEdgeResolutionItems"], "canView; hàm chỉ suy ra intentId số (suy_ra)"],
  "server/routers/edgeResolutionRouter.ts#resolveIntent": [["resolveOrphanedIntent"], "supervisorProcedure + machine_control.canEdit"],
  "server/routers/edgeResolutionRouter.ts#reviewLateResult": [["reviewLateResult"], "supervisorProcedure + machine_control.canEdit"],
  "server/routers/programmingRouter.ts#approveDeployment": [["dispatchCore"], "đường ghi: deployProcedure (MOD_ENGINEERING) + machine_control.canCreate — kết quả dispatch về người ra lệnh"],
  "server/routers/programmingRouter.ts#deployBuild": [["dispatchCore"], "đường ghi: deployProcedure (MOD_ENGINEERING) — kết quả dispatch về người ra lệnh"],
  "server/routers/robotRouter.ts#actuate": [["dispatchCore"], "đường ghi: actuationProcedure + machine_control.canEdit"],
  "server/routers/robotRouter.ts#consoleStop": [["dispatchCore"], "STOP: robotStopProcedure (canEdit / degraded auth) — kết quả về người bấm"],
  "server/routers/scadaCommandsRouter.ts#confirm": [["dispatchCore", "reserveRealWrite"], "đường ghi: canEdit kiểm trong handler (kiemCongVaiTro) — kết quả về chủ yêu cầu"],
  "server/routers/scadaCommandsRouter.ts#dungMay": [["dispatchCore", "reserveRealWrite"], "STOP: sàn vai mức 1 + canEdit trong handler — kết quả về người bấm"],
  "server/routers/scadaCommandsRouter.ts#trangThai": [["trangThaiYeuCauGhi"], "chủ yêu cầu; hàm chỉ trả ma / ledger suy ra (suy_ra)"],
};

const NGUON = tepServer().map((p) => ({ rel: relative(GOC, p).replace(/\\/g, "/"), src: readFileSync(p, "utf8") }));

function doCay(nguon = NGUON): Map<string, Dem> {
  const tong = new Map<string, Dem>();
  for (const { rel, src } of nguon) {
    if (!/commandLog|command_log/i.test(src)) continue;
    for (const [k, v] of quetNguon(rel, src)) {
      const m = tong.get(k) ?? {};
      for (const [l, n] of Object.entries(v) as Array<[Loai, number]>) m[l] = (m[l] ?? 0) + n;
      tong.set(k, m);
    }
  }
  return tong;
}
/** Tên các HÀM KHAI BÁO (trong chính tệp của nó) có loại rủi ro. */
const ruiRoCua = (d: Map<string, Dem>, cm: ChiMuc): Set<string> =>
  new Set([...d].filter(([k, v]) => cm.khai.has(k) && (Object.keys(v) as Loai[]).some((l) => LOAI_RUI_RO.has(l))).map(([k]) => k.split("#")[1]));
const sapXep = (m: Dem): Dem => Object.fromEntries(Object.entries(m).sort(([a], [b]) => (a < b ? -1 : 1)));

describe("★★★ census — bảng command_log: MỌI tham chiếu có phân loại; errorText / ackValue không ra dưới mức canEdit kỹ sư (KD-2bA 1.1, fix round 1 I2)", () => {
  const DO = doCay();
  const CM = lapChiMuc(NGUON);
  // hàm rủi ro = TÊN HÀM ĐÃ KHAI (function / const arrow / method) — thủ tục router (list/get/…) không phải "hàm được gọi"
  const CHAM = thuTucCham(CM, ruiRoCua(DO, CM));

  it("§0 thiết bị đo thấy dữ liệu: ≥ 5 tệp, có cot_ky_thuat, doc_nguyen_hang, ghi, sql_tho", () => {
    if (process.env.IN_SO_CAI === "1") {
      console.log("SO_CAI=" + JSON.stringify(Object.fromEntries([...DO].sort().map(([k, v]) => [k, sapXep(v)]))));
      console.log("CHAM=" + JSON.stringify(Object.fromEntries([...CHAM].sort())));
    }
    expect(new Set([...DO.keys()].map((k) => k.split("#")[0])).size).toBeGreaterThanOrEqual(5);
    const loai = new Set([...DO.values()].flatMap((v) => Object.keys(v)));
    for (const l of ["cot_ky_thuat", "doc_nguyen_hang", "ghi", "sql_tho"]) expect(loai.has(l), l).toBe(true);
  });

  it("§1 MỌI hàm tham chiếu bảng có trong sổ cái với ĐÚNG số đếm từng loại (chỗ mới ⇒ phân loại trước)", () => {
    const lech: string[] = [];
    for (const [k, v] of DO) {
      const so = SO_CAI[k];
      if (!so) lech.push(`${k}: đo ${JSON.stringify(sapXep(v))}, không có trong sổ`);
      else if (JSON.stringify(sapXep(so[0])) !== JSON.stringify(sapXep(v))) lech.push(`${k}: đo ${JSON.stringify(sapXep(v))}, sổ ${JSON.stringify(sapXep(so[0]))}`);
    }
    for (const k of Object.keys(SO_CAI)) if (!DO.has(k)) lech.push(`${k}: có trong sổ, đo không thấy (gỡ khỏi sổ)`);
    expect(lech, "tham chiếu command_log lệch sổ cái").toEqual([]);
  });

  it("§1b phân loại khớp loại: chi_cot_an_toan CHỈ khi mọi loại ⊆ {cot_an_toan, doc_chieu, ghi}; loại rủi ro ⇒ phân loại khác chi_cot_an_toan", () => {
    const sai: string[] = [];
    for (const [k, [dem, pl]] of Object.entries(SO_CAI)) {
      const loai = Object.keys(dem) as Loai[];
      const anToan = loai.every((l) => LOAI_AN_TOAN.has(l));
      if (pl === "chi_cot_an_toan" && !anToan) sai.push(`${k}: chi_cot_an_toan nhưng có ${loai.filter((l) => !LOAI_AN_TOAN.has(l)).join(",")}`);
      if (pl !== "chi_cot_an_toan" && anToan) sai.push(`${k}: chỉ loại an toàn — phân loại phải là chi_cot_an_toan (đang ${pl})`);
    }
    expect(sai).toEqual([]);
  });

  it("§2 mọi thủ tục của commandLogRouter đọc nguyên hàng / cột kỹ thuật ĐỀU gọi bộ che trong thân", () => {
    const rel = "server/routers/commandLogRouter.ts";
    const sf = ts.createSourceFile(rel, readFileSync(join(GOC, rel), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const than = new Map<string, string>();
    const tham = (n: ts.Node) => {
      if (ts.isPropertyAssignment(n) && ts.isCallExpression(n.initializer) && /\.query\(/.test(n.initializer.getText())) than.set(n.name.getText(), n.initializer.getText());
      ts.forEachChild(n, tham);
    };
    tham(sf);
    expect([...than.keys()].sort()).toEqual(["avgDurations", "get", "list", "nhatKy", "stats"]);
    const canChe = Object.entries(SO_CAI).filter(([k, v]) => k.startsWith(rel + "#") && v[1] === "che").map(([k]) => k.split("#")[1]).sort();
    expect(canChe).toEqual(["get", "list", "nhatKy"]);
    for (const t of canChe) expect(than.get(t), `thủ tục ${t} không gọi chiTietKyThuatCua`).toMatch(/chiTietKyThuatCua\(ctx\)/);
    for (const t of ["list", "get"]) expect(than.get(t), `thủ tục ${t} không qua cheHangLenh`).toMatch(/cheHangLenh\(/);
    expect(than.get("nhatKy")).toMatch(/loi: duocXem \? \(r\.errorText \?\? null\) : null/);
    expect(than.get("nhatKy")).not.toMatch(/ackValue:/);
  });

  it("§3 MỌI thủ tục tRPC chạm hàm rủi ro (đồ thị gọi theo tên ≤ 5 bậc) có trong THU_TUC_CHAM, đúng tập hàm", () => {
    const lech: string[] = [];
    for (const [k, v] of CHAM) {
      const so = THU_TUC_CHAM[k];
      if (!so) lech.push(`${k}: chạm ${v.join(",")}, không có trong sổ`);
      else if (so[0].join(",") !== v.join(",")) lech.push(`${k}: chạm ${v.join(",")}, sổ ${so[0].join(",")}`);
    }
    for (const k of Object.keys(THU_TUC_CHAM)) if (!CHAM.has(k)) lech.push(`${k}: có trong sổ, đo không chạm (gỡ)`);
    expect(lech).toEqual([]);
  });

  it("§4 ĐIỂM MÙ review I2 — mỗi hình có fixture tệp ảo, bị BẮT đúng loại và là khoá LẠ (đỏ ở §1)", () => {
    const thu = (src: string) => Object.fromEntries([...quetNguon("server/routers/xAo.ts", src)].map(([k, v]) => [k.split("#")[1], sapXep(v)]));
    const imp = `import { commandLog } from "../../drizzle/schema";\n`;
    // (1) SQL thô không nêu cột: SELECT * / cl.* / row_to_json
    expect(thu(`export const r = router({ a: p.query(() => db.execute(sql\`SELECT * FROM command_log\`)), b: p.query(() => db.execute(sql\`SELECT cl.* FROM command_log cl WHERE cl.id = \${1}\`)), c: p.query(() => db.execute(sql\`SELECT row_to_json(x) FROM command_log x\`)) });`)).toEqual({
      a: { sql_tho_nhay_cam: 1 },
      b: { sql_tho_nhay_cam: 1 },
      c: { sql_tho_nhay_cam: 1 },
    });
    // (2) cả bảng trong phép chiếu
    expect(thu(imp + `export const r = router({ a: p.query(() => db.select({ ...getTableColumns(commandLog) }).from(commandLog)), b: p.query(() => db.select({ row: commandLog }).from(commandLog)) });`)).toEqual({
      a: { doc_nguyen_hang: 2 },
      b: { doc_nguyen_hang: 2 },
    });
    // (3) join (không phải from) dưới select() / select chiếu tường minh
    expect(thu(imp + `export const r = router({ a: p.query(() => db.select().from(x).leftJoin(commandLog, eq(x.id, commandLog.id))), b: p.query(() => db.select({ id: x.id, s: commandLog.status }).from(x).innerJoin(commandLog, eq(x.id, commandLog.id))) });`)).toEqual({
      a: { cot_an_toan: 1, doc_nguyen_hang: 1 },
      b: { cot_an_toan: 2, doc_chieu: 1 },
    });
    // (4) bí danh: alias(...) và import đổi tên, namespace import, destructure động
    expect(thu(imp + `const r2 = alias(commandLog, "r");\nexport const r = router({ a: p.query(() => db.select({ e: r2.errorText }).from(r2)) });`)).toEqual({
      "<tep>": { bi_danh: 1 },
      a: { cot_ky_thuat: 1, doc_chieu: 1 },
    });
    expect(thu(`import { commandLog as cl } from "../../drizzle/schema";\nexport const r = router({ a: p.query(() => db.select({ e: cl.ackValue }).from(cl)) });`)).toEqual({ a: { cot_ky_thuat: 1, doc_chieu: 1 } });
    expect(thu(`import * as s from "../../drizzle/schema";\nexport const r = router({ a: p.query(() => db.select().from(s.commandLog)) });`)).toEqual({ a: { doc_nguyen_hang: 1 } });
    expect(thu(`export const r = router({ a: p.query(async () => { const { commandLog: t } = await import("../../drizzle/schema"); return db.select().from(t); }), b: p.query(() => db.query.commandLog.findMany()) });`)).toEqual({
      a: { doc_nguyen_hang: 1 },
      b: { doc_nguyen_hang: 1 },
    });
    // fix round 2 N1 — import động namespace (idiom của repo) / truy cập ngay kết quả await import / phần tử ["commandLog"] / destructure từ object bất kỳ
    expect(thu(`export const r = router({ a: p.query(async () => { const schema = await import("../../drizzle/schema"); return db.select().from(schema.commandLog); }) });`)).toEqual({
      a: { doc_nguyen_hang: 1 },
    });
    expect(thu(`export const r = router({ a: p.query(async () => db.select({ e: (await import("../../drizzle/schema")).commandLog.errorText }).from(x)) });`)).toEqual({ a: { cot_ky_thuat: 1 } });
    expect(thu(`export const r = router({ a: p.query(async () => db.select().from(s2["commandLog"])) });`)).toEqual({ a: { doc_nguyen_hang: 1 } });
    expect(thu(`export const r = router({ a: p.query(async () => { const { commandLog: t } = bangMoi; return db.select({ k: t.ackValue }).from(t); }) });`)).toEqual({ a: { cot_ky_thuat: 1, doc_chieu: 1 } });
    // fix round 2 N3 — cột kỹ thuật TRẦN trong sql`` của phép chiếu ⇒ nhạy cảm (không thể là chi_cot_an_toan)
    expect(thu(imp + `export const r = router({ a: p.query(() => db.select({ e: sql\`"errorText"\`, id: commandLog.id }).from(commandLog)) });`)).toEqual({
      a: { cot_an_toan: 1, doc_chieu: 1, sql_tho_nhay_cam: 1 },
    });
    // polish (R1) — tệp chỉ chạm bảng bằng SQL thô: cột trần ở một template KHÁC (không nhắc command_log) vẫn nhạy cảm
    expect(thu(`const q0 = sql\`SELECT id FROM command_log\`;\nexport const r = router({ b: p.query(() => db.execute(sql\`SELECT "errorText" FROM t\`)) });`)).toEqual({
      "<tep>": { sql_tho: 1 },
      b: { sql_tho_nhay_cam: 1 },
    });
    // đối chứng: chiếu cột an toàn ⇒ chỉ loại an toàn
    expect(thu(imp + `export const r = router({ a: p.query(() => db.select({ id: commandLog.id }).from(commandLog)) });`)).toEqual({ a: { cot_an_toan: 1, doc_chieu: 1 } });
    // (5) thủ tục MỚI chỉ gọi một hàm rủi ro CÓ SẴN (không tham chiếu bảng) ⇒ §3 bắt (khoá lạ)
    const cm = lapChiMuc([...NGUON, { rel: "server/routers/xAo.ts", src: `export const r = router({ moi: p.query(({ ctx }) => trangThaiYeuCauGhi(ctx, {})) });` }]);
    const cham = thuTucCham(cm, ruiRoCua(DO, cm));
    expect(cham.get("server/routers/xAo.ts#moi")).toContain("trangThaiYeuCauGhi");
    expect(THU_TUC_CHAM["server/routers/xAo.ts#moi"]).toBeUndefined();
    // mọi khoá fixture đều LẠ với sổ cái
    for (const k of Object.keys(SO_CAI)) expect(k.startsWith("server/routers/xAo.ts")).toBe(false);
  });
});

describe("★★ KD-2bA 1.3 — `daXacMinhPhamVi` của lần thử adapter NULL do MÁY CHỦ đặt, client không đặt được", () => {
  const tepGhi = tepServer().filter((p) => readFileSync(p, "utf8").includes("scadaCommandAttempts") || readFileSync(p, "utf8").includes("ghiThuLenh"));

  it("chỉ lenhHmi.ts INSERT vào scada_command_attempts (2 chỗ: chenDongTongKet, ghiThuLenh)", () => {
    const cho: string[] = [];
    for (const p of tepGhi) {
      const rel = relative(GOC, p).replace(/\\/g, "/");
      const sf = ts.createSourceFile(rel, readFileSync(p, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const tham = (n: ts.Node) => {
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "insert" && n.arguments[0]?.getText() === "scadaCommandAttempts") cho.push(`${rel}#${hamBao(n)}`);
        ts.forEachChild(n, tham);
      };
      tham(sf);
    }
    expect(cho.sort()).toEqual(["server/services/scada/lenhHmi.ts#chenDongTongKet", "server/services/scada/lenhHmi.ts#ghiThuLenh"]);
  });

  it("mọi lời gọi ghiThuLenh / ghiThuCoHan KHÔNG adapterId mà CÓ requestedValue: đúng MỘT chỗ (tuChoiQuaHan); cờ là biến cục bộ chỉ nhận literal", () => {
    const kq = kiemCoXacMinh(readFileSync(join(GOC, "server/services/scada/lenhHmi.ts"), "utf8"));
    expect(kq.soLoiGoi).toBeGreaterThanOrEqual(10); // thiết bị đo thấy dữ liệu
    expect(kq.khongAdapterCoGiaTri).toEqual(["tuChoiQuaHan"]);
    expect(kq.viPham).toEqual([]);
  });

  it("ĐỘT BIẾN (trong bộ nhớ, không chạm lenhHmi.ts trên đĩa) — cờ lấy từ input / gán từ biến khác / dòng thử NULL mới mang input.value ⇒ đỏ", () => {
    const goc = readFileSync(join(GOC, "server/services/scada/lenhHmi.ts"), "utf8");
    const dot = (tu: string, thanh: string) => {
      expect(goc.includes(tu), `mẫu đột biến không còn khớp: ${tu}`).toBe(true);
      return kiemCoXacMinh(goc.replace(tu, thanh));
    };
    // (a) cờ trong requested_value lấy từ input client
    expect(dot("requestedValue: { machineId: input.machineId, daXacMinhPhamVi, buoc", "requestedValue: { machineId: input.machineId, daXacMinhPhamVi: (input as any).daXacMinhPhamVi, buoc").viPham.length).toBeGreaterThan(0);
    // (b) biến cờ được gán từ thứ khác literal
    expect(dot("daXacMinhPhamVi = true;", "daXacMinhPhamVi = Boolean((input as any).xacMinh);").viPham.length).toBeGreaterThan(0);
    // (c) lời gọi ghi lần thử KHÔNG adapter mới mang giá trị client
    const c = dot(
      'await ghiThuLenh(db, { userId, stage: "request", outcome: "rejected", reasonCode: "NOT_FOUND", lyDo: input.lyDo });',
      'await ghiThuLenh(db, { userId, stage: "request", outcome: "rejected", reasonCode: "NOT_FOUND", lyDo: input.lyDo, requestedValue: input.value });',
    );
    expect(c.khongAdapterCoGiaTri.length).toBe(2);
    expect(c.viPham.length).toBeGreaterThan(0);
  });
});

/**
 * KD-2bA 1.3 — kiểm nguồn lenhHmi: (1) mọi lời gọi ghi lần thử KHÔNG `adapterId` mà CÓ `requestedValue` ⇒ giá trị là object literal máy chủ
 * dựng, `daXacMinhPhamVi` viết tắt (biến cục bộ); (2) mọi khai báo biến `daXacMinhPhamVi` khởi tạo `false`, mọi phép gán chỉ literal true/false.
 */
function kiemCoXacMinh(src: string): { viPham: string[]; soLoiGoi: number; khongAdapterCoGiaTri: string[] } {
  const sf = ts.createSourceFile("lenhHmi.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const viPham: string[] = [];
  const khaiBao = new Map<string, ts.ObjectLiteralExpression>();
  const nhat = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && ts.isObjectLiteralExpression(n.initializer)) khaiBao.set(n.name.text, n.initializer);
    ts.forEachChild(n, nhat);
  };
  nhat(sf);
  const coThuocTinh = (o: ts.ObjectLiteralExpression, ten: string): ts.ObjectLiteralElementLike | undefined =>
    o.properties.find((p) => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name.getText() === ten) ??
    o.properties
      .filter(ts.isSpreadAssignment)
      .map((sp) => (ts.isIdentifier(sp.expression) ? khaiBao.get(sp.expression.text) : undefined))
      .map((k) => (k ? coThuocTinh(k, ten) : undefined))
      .find(Boolean);
  const khongAdapterCoGiaTri: string[] = [];
  let soLoiGoi = 0;
  const khai: string[] = [];
  const gan: string[] = [];
  const tham = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && (n.expression.text === "ghiThuLenh" || n.expression.text === "ghiThuCoHan")) {
      const o = n.arguments[1];
      if (o && ts.isObjectLiteralExpression(o)) {
        soLoiGoi++;
        const ad = coThuocTinh(o, "adapterId");
        const rv = coThuocTinh(o, "requestedValue");
        if (!ad && rv) {
          const ten = hamBao(n);
          khongAdapterCoGiaTri.push(ten);
          if (!(ts.isPropertyAssignment(rv) && ts.isObjectLiteralExpression(rv.initializer))) viPham.push(`${ten}: requestedValue không phải object literal máy chủ dựng (${rv.getText().slice(0, 60)})`);
          else {
            const co = coThuocTinh(rv.initializer, "daXacMinhPhamVi");
            if (!co || !ts.isShorthandPropertyAssignment(co)) viPham.push(`${ten}: daXacMinhPhamVi không phải biến cục bộ (${co?.getText().slice(0, 60) ?? "vắng"})`);
          }
        }
      }
    }
    if (ts.isVariableDeclaration(n) && n.name.getText() === "daXacMinhPhamVi") khai.push(n.initializer?.getText() ?? "");
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && n.left.getText() === "daXacMinhPhamVi") gan.push(n.right.getText());
    ts.forEachChild(n, tham);
  };
  tham(sf);
  if (khai.length === 0) viPham.push("không thấy khai báo daXacMinhPhamVi");
  for (const k of khai) if (k !== "false") viPham.push(`khai báo daXacMinhPhamVi = ${k}`);
  if (gan.length === 0) viPham.push("không thấy phép gán daXacMinhPhamVi = true sau kiểm phạm vi");
  for (const g of gan) if (g !== "true" && g !== "false") viPham.push(`gán daXacMinhPhamVi = ${g}`);
  return { viPham, soLoiGoi, khongAdapterCoGiaTri };
}
