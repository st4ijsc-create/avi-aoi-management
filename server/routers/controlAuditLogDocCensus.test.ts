/**
 * ★★★ SCADA R1b-2b-2b A — C2 fix round 4 mục 3(c) (điều phối 2026-11-01 — QUYẾT: GIỮ `before.endpoint` trong audit, KHÔNG che) — CENSUS BẤT BIẾN
 * người ĐỌC `control_audit_log`.
 *
 * Vì sao: `scadaDiag.tamTat` (và vài đường cấu hình) ghi `endpoint` của adapter vào `beforeJson` (văn bản chi tiết kỹ thuật). Điều phối giữ nguyên trong
 * sổ audit WORM với điều kiện: KHÔNG thủ tục tRPC / tuyến REST / dịch vụ nào có kết quả về client ĐỌC `beforeJson` / `afterJson`, và không ai đọc NGUYÊN
 * HÀNG (`select()` không cột) của bảng — trừ các chỗ trong danh sách cho phép, ghim theo HÀM kèm lý do (vd `verifyControlAuditChain`: đọc nguyên hàng để
 * băm lại chuỗi, kết quả RÚT GỌN còn `{ ok, checked, brokenAtId, reason }`).
 *
 * Thiết bị đo (AST, mọi `.ts` không phải test / testkit / `__*` dưới `server/`). Điểm chạm RỦI RO:
 *   • `cot_bi_mat`  — `T.beforeJson` / `T.afterJson` (T = `controlAuditLog`: import, destructure, `<x>.controlAuditLog`, alias);
 *   • `nguyen_hang` — `.from(T)` / join dưới `select()` không đối số / spread / `getTableColumns`, `db.query.controlAuditLog`, `getTableColumns(T)`,
 *                     `insert|update|delete(T)…returning()` không đối số, `T` truyền đi chỗ khác (xấp xỉ trên);
 *   • `sql_bi_mat`  — chuỗi / template có `control_audit_log` VÀ (`"beforeJson"` | `"afterJson"` | `before_json` | `after_json` | `SELECT *` | `x.*` |
 *                     `row_to_json` | `to_json`).
 * Tham chiếu AN TOÀN (chiếu cột khác, ghi không returning, đếm) được đếm riêng cho bảo vệ "đi rỗng". Khoá = `tệp#hàm`.
 * Bất biến phụ: ở các gốc bề mặt (`server/api`, `server/routes`, `server/routers`, `server/_core`), kết quả `recordAuditEvent(…)` (hàng vừa ghi, có
 * beforeJson / afterJson) luôn bị BỎ (câu lệnh biểu thức / `void`) — không trả về client.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const GOC = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TEN_BANG = "controlAuditLog";
const COT_BI_MAT = new Set(["beforeJson", "afterJson"]);
const SQL_BI_MAT = /"beforeJson"|"afterJson"|\bbefore_json\b|\bafter_json\b|select\s+\*|\b\w+\.\*|row_to_json|to_jsonb?\s*\(/i;
const GOC_BE_MAT = ["server/api/", "server/routes/", "server/routers/", "server/_core/"];

type Loai = "cot_bi_mat" | "nguyen_hang" | "sql_bi_mat" | "an_toan";

function tepServer(): string[] {
  const ra: string[] = [];
  const di = (d: string) => {
    for (const n of readdirSync(d)) {
      if (n === "node_modules" || n === "dist") continue;
      const p = join(d, n);
      if (statSync(p).isDirectory()) di(p);
      else if (/\.ts$/.test(n) && !/\.(test|spec)\.ts$/.test(n) && !/testkit/i.test(n) && !n.startsWith("__") && !n.endsWith(".d.ts")) ra.push(p);
    }
  };
  di(join(GOC, "server"));
  return ra.sort();
}
const rel = (p: string) => relative(GOC, p).replace(/\\/g, "/");

function hamBao(n: ts.Node): string {
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
    if (ts.isPropertyAssignment(p) && ts.isCallExpression(p.initializer) && ts.isPropertyAccessExpression(p.initializer.expression) && /^(query|mutation|subscription)$/.test(p.initializer.expression.name.text))
      return `proc:${p.name.getText()}`;
    if ((ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p)) && p.name) return p.name.getText();
    if (ts.isVariableDeclaration(p) && p.initializer && (ts.isArrowFunction(p.initializer) || ts.isFunctionExpression(p.initializer))) return p.name.getText();
  }
  return "<tep>";
}

function vanBan(n: ts.Node): string | null {
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (ts.isTemplateExpression(n)) return n.head.text + n.templateSpans.map((s) => "${}" + s.literal.text).join("");
  return null;
}

function tenBang(sf: ts.SourceFile): Set<string> {
  const bang = new Set<string>();
  const tham = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && /drizzle\/schema/.test(n.moduleSpecifier.text)) {
      const nb = n.importClause?.namedBindings;
      if (nb && ts.isNamedImports(nb)) for (const e of nb.elements) if ((e.propertyName ?? e.name).text === TEN_BANG) bang.add(e.name.text);
    }
    if (ts.isBindingElement(n) && ts.isIdentifier(n.name) && ((n.propertyName && n.propertyName.getText() === TEN_BANG) || (!n.propertyName && n.name.text === TEN_BANG)))
      bang.add(n.name.text);
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && ts.isCallExpression(n.initializer) && /(^|\.)alias$/.test(n.initializer.expression.getText())) {
      const a = n.initializer.arguments[0];
      if (a && laBang(a, bang)) bang.add(n.name.text);
    }
    ts.forEachChild(n, tham);
  };
  tham(sf);
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

function traVeNguyenHang(goi: ts.CallExpression): boolean {
  let e: ts.Node = goi;
  for (let i = 0; i < 30 && e.parent; i++) {
    const p = e.parent;
    if (ts.isPropertyAccessExpression(p) && p.expression === e) {
      const c = p.parent;
      if (ts.isCallExpression(c) && c.expression === p) {
        if (p.name.text === "returning") {
          const a = c.arguments[0];
          return !a || !ts.isObjectLiteralExpression(a) || a.properties.some((x) => ts.isSpreadAssignment(x) || /getTableColumns\(|beforeJson|afterJson/.test(x.getText()));
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

function loaiThamChieu(r: ts.Expression, bang: Set<string>): Loai {
  if (ts.isPropertyAccessExpression(r) && ts.isPropertyAccessExpression(r.expression) && r.expression.name.text === "query") return "nguyen_hang";
  const p = r.parent;
  if (ts.isPropertyAccessExpression(p) && p.expression === r) return COT_BI_MAT.has(p.name.text) ? "cot_bi_mat" : "an_toan";
  if (ts.isElementAccessExpression(p) && p.expression === r) return "nguyen_hang";
  if (ts.isCallExpression(p) && p.arguments.includes(r)) {
    const ten = ts.isPropertyAccessExpression(p.expression) ? p.expression.name.text : ts.isIdentifier(p.expression) ? p.expression.text : "";
    if (/^(from|leftJoin|innerJoin|rightJoin|fullJoin|crossJoin)$/.test(ten)) {
      const s = selectGoc(p);
      if (!s || s.arguments.length === 0) return "nguyen_hang";
      const a = s.arguments[0];
      if (!ts.isObjectLiteralExpression(a)) return "nguyen_hang";
      for (const pr of a.properties) {
        if (ts.isSpreadAssignment(pr)) return "nguyen_hang";
        if (ts.isShorthandPropertyAssignment(pr) && bang.has(pr.name.text)) return "nguyen_hang";
        if (ts.isPropertyAssignment(pr) && (laBang(pr.initializer, bang) || /getTableColumns\(/.test(pr.initializer.getText()))) return "nguyen_hang";
      }
      return "an_toan";
    }
    if (ten === "insert" || ten === "update" || ten === "delete") return traVeNguyenHang(p) ? "nguyen_hang" : "an_toan";
    if (ten === "alias" || ten === "getTableName") return "an_toan";
    return "nguyen_hang";
  }
  return "nguyen_hang";
}

/** Quét MỘT nguồn ⇒ `tệp#hàm` → đếm theo loại (cả `an_toan`). */
export function quetAudit(r: string, src: string): Map<string, Partial<Record<Loai, number>>> {
  const sf = ts.createSourceFile(r, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const bang = tenBang(sf);
  const ra = new Map<string, Partial<Record<Loai, number>>>();
  const them = (n: ts.Node, l: Loai) => {
    const k = `${r}#${hamBao(n)}`;
    const m = ra.get(k) ?? {};
    m[l] = (m[l] ?? 0) + 1;
    ra.set(k, m);
  };
  const tham = (n: ts.Node) => {
    if (ts.isIdentifier(n) && bang.has(n.text) && viTriGiaTri(n)) them(n, loaiThamChieu(n, bang));
    else if ((ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) && laBang(n, bang)) {
      them(n, loaiThamChieu(n, bang));
      return;
    }
    const t = vanBan(n);
    if (t !== null && /control_audit_log/i.test(t)) {
      them(n, SQL_BI_MAT.test(t) ? "sql_bi_mat" : "an_toan");
      if (ts.isTemplateExpression(n)) {
        for (const sp of n.templateSpans) tham(sp.expression);
        return;
      }
    }
    ts.forEachChild(n, tham);
  };
  tham(sf);
  return ra;
}

const RUI_RO: ReadonlySet<Loai> = new Set(["cot_bi_mat", "nguyen_hang", "sql_bi_mat"]);
const chiRuiRo = (v: Partial<Record<Loai, number>>) => Object.fromEntries(Object.entries(v).filter(([l]) => RUI_RO.has(l as Loai)).sort(([a], [b]) => a.localeCompare(b)));

/**
 * DANH SÁCH CHO PHÉP (đo 2026-11-01 trên cây feat/scada-2bA-hop-dong). Ghim theo HÀM với ĐÚNG số điểm chạm rủi ro + lý do. Thêm người đọc ⇒ đỏ, nêu tên.
 */
export const CHO_PHEP: Record<string, { dem: Partial<Record<Loai, number>>; lyDo: string }> = {
  "server/services/audit/controlAuditService.ts#verifyControlAuditChain": {
    dem: { nguyen_hang: 1 },
    lyDo: "đọc nguyên hàng để BĂM LẠI chuỗi; kết quả RÚT GỌN { ok, checked, brokenAtId, reason } (securityRouter.verifyAuditChain :33-39, protectedProcedure)",
  },
  "server/services/audit/controlAuditService.ts#recordAuditEvent": {
    dem: { nguyen_hang: 2 },
    lyDo: "NGƯỜI GHI: insert(…).returning() trả hàng vừa ghi cho bên gọi (2 nhánh: thường / chuỗi băm) — §2 ghim mọi bề mặt BỎ kết quả",
  },
  "server/services/audit/controlAuditService.ts#recordAuditEvents": {
    dem: { nguyen_hang: 2 },
    lyDo: "NGƯỜI GHI theo lô: như recordAuditEvent (returning) — bên gọi chỉ là dịch vụ nội bộ",
  },
  "server/services/ot/commissioningService.ts#latestCommissioningRecheck": {
    dem: { cot_bi_mat: 5 },
    lyDo: "nội bộ: chỉ hàng entityType='device_tag_stop_pin' (afterJson trong WHERE + đọc tagKey / autoClearedBy); trả CommissioningRecheck rút gọn (auditId, tagId, tagKey, action, autoClearedBy, actorId, changedAt, signatureId) — :197-250",
  },
  "server/services/engineeringAssignment/assignmentService.ts#<tep>": {
    dem: { nguyen_hang: 1 },
    lyDo: "subquery ĐẾM dòng approve của interlock_rule (`${controlAuditLog}` trong sql``, :64) — không đọc cột nào",
  },
  "server/services/engineeringAssignment/assignmentService.ts#fetchMineSummary": {
    dem: { nguyen_hang: 1 },
    lyDo: "ĐẾM dòng approve theo nhóm entityId (:314) — chỉ entityId + count(*)",
  },
};
/**
 * GHIM (đo 2026-11-01): số khoá rủi ro / số điểm chạm rủi ro trong danh sách cho phép. Người đọc khác của bảng (interlockRouter :521-555, safetyPlcTrust
 * :281-316, totpKhoaSai :440-460, wormTableSizeMonitor :28, các bộ ghi) chỉ chiếu id / actorId / action / count ⇒ loại `an_toan`, không vào đây.
 * Sao lưu (backupRouter / backupService, adminProcedure) chỉ pg_dump toàn DB qua tiến trình ngoài — không đọc bảng bằng drizzle / SQL ở server/.
 */
const GHIM = { khoaRuiRo: 6, diemRuiRo: 12 };

/** Vi phạm của một phép đo so với danh sách cho phép (thuần — dùng cả ở §1 lẫn đột biến §3). */
export function viPham(ruiRo: Map<string, Record<string, unknown>>, choPhep: Record<string, { dem: Partial<Record<Loai, number>> }>): string[] {
  const sai: string[] = [];
  for (const [k, v] of ruiRo) {
    const m = choPhep[k];
    if (!m) sai.push(`NGƯỜI ĐỌC MỚI ${k} ${JSON.stringify(v)}`);
    else if (JSON.stringify(chiRuiRo(m.dem)) !== JSON.stringify(v)) sai.push(`ĐẾM LỆCH ${k}: cho phép ${JSON.stringify(m.dem)} ≠ đo ${JSON.stringify(v)}`);
  }
  for (const k of Object.keys(choPhep)) if (!ruiRo.has(k)) sai.push(`CHẾT ${k}`);
  return sai;
}

describe("★★★ census BẤT BIẾN — không người đọc control_audit_log.beforeJson / afterJson / nguyên hàng ngoài danh sách cho phép (C2 fix 4 mục 3c)", () => {
  const tep = tepServer();
  const DO = new Map<string, Partial<Record<Loai, number>>>();
  for (const p of tep) for (const [k, v] of quetAudit(rel(p), readFileSync(p, "utf8"))) DO.set(k, v);

  const ruiRo = new Map([...DO].map(([k, v]) => [k, chiRuiRo(v)] as const).filter(([, v]) => Object.keys(v).length > 0));

  it("§0 KHÔNG đi rỗng (đo 2026-11-01: 1484 tệp, 11 tệp chạm bảng, 91 tham chiếu): ≥ 1250 tệp server/ quét; ≥ 9 tệp chạm bảng; ≥ 77 tham chiếu (cả an toàn); có loại an_toan VÀ nguyen_hang", () => {
    expect(tep.length).toBeGreaterThanOrEqual(1250);
    expect(new Set([...DO.keys()].map((k) => k.split("#")[0])).size).toBeGreaterThanOrEqual(9);
    expect([...DO.values()].reduce((a, v) => a + Object.values(v).reduce((x, y) => x + (y ?? 0), 0), 0)).toBeGreaterThanOrEqual(77);
    const loai = new Set([...DO.values()].flatMap((v) => Object.keys(v)));
    expect(loai.has("an_toan") && loai.has("nguyen_hang")).toBe(true);
  });

  it("§1 MỌI điểm chạm rủi ro nằm trong danh sách cho phép với ĐÚNG số đếm (người đọc mới ⇒ đỏ, nêu tệp#hàm); không mục chết", () => {
    expect(viPham(ruiRo, CHO_PHEP)).toEqual([]);
    expect({ khoaRuiRo: ruiRo.size, diemRuiRo: [...ruiRo.values()].reduce((a, v) => a + Object.values(v).reduce((x, y) => x + (y as number), 0), 0) }).toEqual(GHIM);
  });

  it("§2 bề mặt: kết quả recordAuditEvent(…) (hàng vừa ghi) luôn bị BỎ — câu lệnh biểu thức / void, không return / gán / truyền tiếp", () => {
    const sai: string[] = [];
    let soGoi = 0;
    for (const p of tep) {
      const r = rel(p);
      if (!GOC_BE_MAT.some((g) => r.startsWith(g))) continue;
      const src = readFileSync(p, "utf8");
      if (!src.includes("recordAuditEvent(")) continue;
      const sf = ts.createSourceFile(r, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const t = (x: ts.Node) => {
        if (ts.isCallExpression(x) && ((ts.isIdentifier(x.expression) && x.expression.text === "recordAuditEvent") || (ts.isPropertyAccessExpression(x.expression) && x.expression.name.text === "recordAuditEvent"))) {
          soGoi++;
          let q: ts.Node = x;
          while (q.parent && (ts.isAwaitExpression(q.parent) || ts.isParenthesizedExpression(q.parent) || ts.isVoidExpression(q.parent))) q = q.parent;
          if (!q.parent || !ts.isExpressionStatement(q.parent)) sai.push(`${r}:${sf.getLineAndCharacterOfPosition(x.getStart()).line + 1}`);
        }
        ts.forEachChild(x, t);
      };
      t(sf);
    }
    expect(soGoi, "số lời gọi recordAuditEvent ở bề mặt (đi rỗng ⇒ đỏ)").toBeGreaterThanOrEqual(20);
    expect(sai).toEqual([]);
  });

  it("§3 FIXTURE / ĐỘT BIẾN — người đọc giả trong tệp ảo bị BẮT (khoá lạ ⇒ §1 đỏ); bỏ mục verifyControlAuditChain ⇒ khoá ấy thành NGƯỜI ĐỌC MỚI", () => {
    const thu = (src: string) => Object.fromEntries([...quetAudit("server/routers/xAo.ts", src)].map(([k, v]) => [k.split("#")[1], chiRuiRo(v)]));
    const SRC = [
      `import { controlAuditLog as cal } from "../../drizzle/schema";`,
      `export const r = router({`,
      `  a: p.query(async () => db.select({ b: cal.beforeJson }).from(cal)),`,
      `  b: p.query(async () => db.select().from(cal)),`,
      "  c: p.query(async () => db.execute(sql`SELECT * FROM control_audit_log`)),",
      `  d: p.query(async () => db.select({ id: cal.id, actorId: cal.actorId }).from(cal)),`,
      `  e: p.mutation(async () => db.insert(cal).values({}).returning()),`,
      `});`,
    ].join("\n");
    expect(thu(SRC)).toEqual({ "proc:a": { cot_bi_mat: 1 }, "proc:b": { nguyen_hang: 1 }, "proc:c": { sql_bi_mat: 1 }, "proc:d": {}, "proc:e": { nguyen_hang: 1 } });
    for (const k of ["proc:a", "proc:b", "proc:c", "proc:e"]) expect(CHO_PHEP[`server/routers/xAo.ts#${k}`]).toBeUndefined();
    // người đọc giả trong tệp ảo, gộp vào phép đo thật ⇒ vi phạm nêu đúng tệp#hàm
    const voiGia = new Map(ruiRo);
    for (const [k, v] of quetAudit("server/routers/xAo.ts", SRC)) if (Object.keys(chiRuiRo(v)).length) voiGia.set(k, chiRuiRo(v));
    expect(viPham(voiGia, CHO_PHEP)).toEqual([
      'NGƯỜI ĐỌC MỚI server/routers/xAo.ts#proc:a {"cot_bi_mat":1}',
      'NGƯỜI ĐỌC MỚI server/routers/xAo.ts#proc:b {"nguyen_hang":1}',
      'NGƯỜI ĐỌC MỚI server/routers/xAo.ts#proc:c {"sql_bi_mat":1}',
      'NGƯỜI ĐỌC MỚI server/routers/xAo.ts#proc:e {"nguyen_hang":1}',
    ]);
    // ĐỘT BIẾN: bỏ mục cho phép của verifyControlAuditChain ⇒ đỏ, nêu đúng hàm
    const kVerify = "server/services/audit/controlAuditService.ts#verifyControlAuditChain";
    const thieuMuc = Object.fromEntries(Object.entries(CHO_PHEP).filter(([k]) => k !== kVerify));
    expect(viPham(ruiRo, thieuMuc)).toEqual([`NGƯỜI ĐỌC MỚI ${kVerify} {"nguyen_hang":1}`]);
  });
});
