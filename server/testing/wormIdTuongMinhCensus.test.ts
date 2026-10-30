/**
 * ★★★ SCADA R1b-2b-2b A — C1 fix round 1 (review I4; nguyên nhân sự cố I3 2026-10-30) — CENSUS: test KHÔNG BAO GIỜ chèn `id` TƯỜNG MINH vào bảng
 * mà vai test không xoá được.
 *
 * Sự cố: một test ghi `command_log` với id tường minh (quanh 10^6 … 10^9) rồi "dọn" — vai `avi_app` không có DELETE (mig 0279) ⇒ 480 hàng ở lại
 * `_test`, `max(id)` vọt lên 1e9 ⇒ test dùng `max(id)` làm mốc (`otMoPhong.db.test.ts`) XANH GIẢ và sequence sẽ va hàng đó.
 *
 * Tập bảng KHÔNG viết tay — SUY từ migration `drizzle/*.sql` (đã bỏ chú thích `--`):
 *   • trigger WORM: `CREATE TRIGGER <tên>` mà tên trigger hoặc hàm `EXECUTE FUNCTION <hàm>` chứa `worm` ⇒ bảng sau `ON` (chặn cả owner);
 *   • `REVOKE … DELETE … ON <bảng> FROM avi_app` (kể cả trong chuỗi `EXECUTE '…'`) ⇒ vai test không xoá được (đúng loại của `command_log`).
 * Hình bị bắt trong `*.test.ts(x)` (server / shared / client / scripts):
 *   • `sql_id`        — SQL thô `INSERT INTO <bảng> (… id …)`;
 *   • `sql_cot_dong`  — danh sách cột có `${…}` (cột dựng động — đúng hình của sự cố: `${sql.raw("id, ")}`);
 *   • `sql_khong_cot` — `INSERT INTO <bảng> VALUES / SELECT` không danh sách cột (mọi cột, kể cả id);
 *   • `drizzle_id`    — `.insert(<bảng>).values({ id: … })` / `values([{ id: … }])` (theo cả tên import đổi tên / namespace).
 * Vi phạm hiện có (của phiên khác) được GHIM theo `tệp:dòng` (ratchet) — không sửa test của phiên khác.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const GOC = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Bảng WORM / không-xoá-được suy từ văn bản migration. Xuất cho ca đột biến. */
export function bangKhongXoaDuoc(sqls: Array<{ ten: string; van: string }>): Map<string, string> {
  const ra = new Map<string, string>(); // bảng → nguồn (tệp + lý do)
  const trigger = new Set<string>();
  const bo = (t: string) => t.replace(/^"|"$/g, "").replace(/^public\./i, "").replace(/^"|"$/g, "").toLowerCase();
  // theo THỨ TỰ migration (tên tệp) và thứ tự trong tệp: REVOKE DELETE|ALL thêm; GRANT … DELETE|ALL … ON <bảng> TO avi_app SAU đó gỡ
  // (trừ bảng có trigger WORM — chặn cả owner, không GRANT nào mở lại)
  for (const { ten, van } of [...sqls].sort((x, y) => (x.ten < y.ten ? -1 : 1))) {
    const s = van.replace(/--[^\n]*/g, "");
    for (const m of s.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\s+("?[\w]+"?)([\s\S]*?);/gi)) {
      const ham = /EXECUTE\s+(?:FUNCTION|PROCEDURE)\s+([\w."]+)/i.exec(m[2])?.[1] ?? "";
      if (!/worm/i.test(m[1]) && !/worm/i.test(ham)) continue;
      const on = /\bON\s+(?:ONLY\s+)?((?:"?\w+"?\.)?"?\w+"?)/i.exec(m[2]);
      if (on) {
        ra.set(bo(on[1]), `${ten}: trigger ${m[1].replace(/"/g, "")}`);
        trigger.add(bo(on[1]));
      }
    }
    for (const m of s.matchAll(/\b(REVOKE|GRANT)\s+([^;']*?)\s+ON\s+(?:TABLE\s+)?((?:"?\w+"?\.)?"?\w+"?)\s+(FROM|TO)\s+avi_app/gi)) {
      if (!/\b(DELETE|ALL)\b/i.test(m[2])) continue;
      const b = bo(m[3]);
      if (m[1].toUpperCase() === "REVOKE") {
        if (!ra.has(b)) ra.set(b, `${ten}: REVOKE ${m[2].trim()} FROM avi_app`);
      } else if (!trigger.has(b)) ra.delete(b);
    }
  }
  return ra;
}

const vanBan = (n: ts.Node): string | null => {
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (ts.isTemplateExpression(n)) return n.head.text + n.templateSpans.map((s) => "${}" + s.literal.text).join("");
  return null;
};

/**
 * Tên export drizzle → các bảng (`[export] const x = pgTable("ten", …)`) ở MỌI tệp `.ts` (không test) dưới `drizzle/`, `server/`, `shared/`
 * (fix round 2 N2 — trước chỉ `drizzle/schema/*.ts` ⇒ 11/28 bảng WORM; bảng edge / orchestration định nghĩa trong `server/services/**`).
 */
export function bangDrizzle(nguon?: Array<{ rel: string; src: string }>): Map<string, Set<string>> {
  const ra = new Map<string, Set<string>>();
  const tep = nguon ?? tepTs(["drizzle", "server", "shared"]).map((p) => ({ rel: relative(GOC, p), src: readFileSync(p, "utf8") }));
  for (const { src } of tep) {
    if (!src.includes("pgTable(")) continue;
    for (const m of src.matchAll(/\bconst\s+(\w+)\s*=\s*pgTable\(\s*"(\w+)"/g)) {
      const s = ra.get(m[1]) ?? new Set<string>();
      s.add(m[2]);
      ra.set(m[1], s);
    }
  }
  return ra;
}

function tepTs(goc: string[], laTest = false): string[] {
  const ra: string[] = [];
  const di = (d: string) => {
    for (const n of readdirSync(d)) {
      if (n === "node_modules" || n === "dist" || n.startsWith(".")) continue;
      const p = join(d, n);
      const st = statSync(p);
      if (st.isDirectory()) di(p);
      else if (laTest ? /\.test\.tsx?$/.test(n) && n !== "wormIdTuongMinhCensus.test.ts" : /\.ts$/.test(n) && !/\.(test|spec)\.tsx?$/.test(n) && !n.endsWith(".d.ts")) ra.push(p);
    }
  };
  for (const g of goc) di(join(GOC, g));
  return ra.sort();
}

type Hinh = "sql_id" | "sql_cot_dong" | "sql_khong_cot" | "sql_bang_dong" | "drizzle_id" | "drizzle_bien";

/**
 * Quét MỘT tệp test ⇒ danh sách `tệp:dòng hình bảng`.
 *   • tên cục bộ → export: import có tên từ MỌI module (đổi tên theo), namespace `import * as s` / `const s = await import(…)` (MỌI module),
 *     destructure `const { x: y } = await import(…)`, và định danh trần trùng tên export (xấp xỉ TRÊN);
 *   • `INSERT INTO ${e}` (bảng nội suy): e phân giải ra bảng drizzle ⇒ xét như tên bảng; phân giải được và KHÔNG WORM ⇒ bỏ qua; không phân giải
 *     được (`${sql.raw(x)}` …) ⇒ `sql_bang_dong` (fix round 2 N5);
 *   • `.insert(<WORM>).values(<không phải literal>)` / literal có spread ⇒ `drizzle_bien` (không biết có id hay không — N5).
 */
export function quetTest(rel: string, src: string, worm: ReadonlyMap<string, string>, drizzle: ReadonlyMap<string, ReadonlySet<string>>): string[] {
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, rel.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const ra: string[] = [];
  const dong = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const them = (n: ts.Node, h: Hinh, b: string) => ra.push(`${rel}:${dong(n)} ${h} ${b}`);
  const ten = new Map<string, string>();
  const khongGian = new Set<string>();
  const laImportDong = (e: ts.Expression | undefined): boolean => {
    let x = e;
    while (x && (ts.isAwaitExpression(x) || ts.isParenthesizedExpression(x))) x = x.expression;
    return !!x && ts.isCallExpression(x) && x.expression.kind === ts.SyntaxKind.ImportKeyword;
  };
  const nhat = (n: ts.Node) => {
    if (ts.isImportDeclaration(n)) {
      const nb = n.importClause?.namedBindings;
      if (nb && ts.isNamedImports(nb)) for (const e of nb.elements) ten.set(e.name.text, (e.propertyName ?? e.name).text);
      if (nb && ts.isNamespaceImport(nb)) khongGian.add(nb.name.text);
    }
    if (ts.isVariableDeclaration(n) && laImportDong(n.initializer)) {
      if (ts.isIdentifier(n.name)) khongGian.add(n.name.text);
      else if (ts.isObjectBindingPattern(n.name))
        for (const e of n.name.elements) if (ts.isIdentifier(e.name)) ten.set(e.name.text, e.propertyName ? e.propertyName.getText() : e.name.text);
    }
    ts.forEachChild(n, nhat);
  };
  nhat(sf);
  /** Các bảng mà một biểu thức chỉ tới (rỗng = không phân giải được). */
  const bangCua = (e: ts.Expression): Set<string> => {
    let x = e;
    while (ts.isParenthesizedExpression(x) || ts.isAwaitExpression(x)) x = x.expression;
    let exp: string | undefined;
    if (ts.isIdentifier(x)) exp = ten.get(x.text) ?? x.text;
    else if (ts.isPropertyAccessExpression(x)) {
      const r = x.expression;
      if ((ts.isIdentifier(r) && khongGian.has(r.text)) || laImportDong(r) || ts.isParenthesizedExpression(r)) exp = x.name.text;
    }
    return new Set(exp ? [...(drizzle.get(exp) ?? [])] : []);
  };
  const wormCua = (s: Set<string>) => [...s].find((b) => worm.has(b)) ?? null;
  const coId = (o: ts.ObjectLiteralExpression) =>
    o.properties.some((p) => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name.getText().replace(/["']/g, "") === "id");
  const xetCot = (n: ts.Node, b: string, sau: string) => {
    const m = /^\s*(\(([^)]*)\)|VALUES\b|SELECT\b)/i.exec(sau);
    if (!m) return;
    if (m[2] === undefined) return them(n, "sql_khong_cot", b);
    const cot = m[2].split(",").map((c) => c.trim().replace(/"/g, ""));
    if (cot.some((c) => c.includes("${}"))) them(n, "sql_cot_dong", b);
    else if (cot.includes("id")) them(n, "sql_id", b);
  };
  const tham = (n: ts.Node) => {
    const t = vanBan(n);
    if (t !== null) {
      for (const m of t.matchAll(/INSERT\s+INTO\s+((?:"?\w+"?\.)?"?\w+"?)(?=[\s(])/gi)) {
        const b = m[1].replace(/"/g, "").replace(/^public\./i, "").toLowerCase();
        if (worm.has(b)) xetCot(n, b, t.slice((m.index ?? 0) + m[0].length));
      }
    }
    // N5 — INSERT INTO ${e}
    if (ts.isTemplateExpression(n)) {
      let truoc = n.head.text;
      for (const sp of n.templateSpans) {
        if (/INSERT\s+INTO\s+(?:public\.)?$/i.test(truoc)) {
          const bs = bangCua(sp.expression);
          if (bs.size === 0) them(n, "sql_bang_dong", sp.expression.getText().slice(0, 60).replace(/\s+/g, " "));
          else {
            const b = wormCua(bs);
            if (b) xetCot(n, b, sp.literal.text);
          }
        }
        truoc = sp.literal.text;
      }
    }
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "values" && n.arguments[0]) {
      let e: ts.Expression = n.expression.expression;
      while (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression) && e.expression.name.text !== "insert") e = e.expression.expression;
      if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression) && e.expression.name.text === "insert" && e.arguments[0]) {
        const b = wormCua(bangCua(e.arguments[0]));
        if (b) {
          const a = n.arguments[0];
          const ds = ts.isArrayLiteralExpression(a) ? [...a.elements] : [a];
          if (ds.some((x) => ts.isObjectLiteralExpression(x) && coId(x))) them(n, "drizzle_id", b);
          else if (ds.some((x) => !ts.isObjectLiteralExpression(x) || x.properties.some((p) => ts.isSpreadAssignment(p)))) them(n, "drizzle_bien", b);
        }
      }
    }
    ts.forEachChild(n, tham);
  };
  tham(sf);
  return ra;
}

const tepTest = (): string[] => tepTs(["server", "shared", "client/src", "scripts"], true);

const SQLS = readdirSync(join(GOC, "drizzle"))
  .filter((n) => n.endsWith(".sql"))
  .map((n) => ({ ten: n, van: readFileSync(join(GOC, "drizzle", n), "utf8") }));
const WORM = bangKhongXoaDuoc(SQLS);
const DRIZZLE = bangDrizzle();

/**
 * ★ RATCHET — vi phạm CÓ SẴN (đo 2026-10-30, feat/scada-r1b2b2), của phiên khác: GHIM, không sửa. Số chỉ được GIẢM.
 */
const GHIM: readonly string[] = [
  // fix round 2 (N5) — bảng nội suy `INSERT INTO ${sql.raw(bang)} (code, name, "factoryCode")`: helper `hang()` gọi với bảng cấu hình theo nhà máy
  // (không WORM); danh sách cột KHÔNG có id. Không phân giải tĩnh được tên bảng ⇒ ghim (đo 2026-10-30).
  "server/routers/phamViGhiDoW7.db.test.ts:34 sql_bang_dong sql.raw(bang)",
];

/**
 * Bảng WORM / không-xoá-được KHÔNG có định nghĩa drizzle (`pgTable`) ở đâu trong drizzle/ · server/ · shared/ (đo 2026-10-30) — chỉ ghi / đọc bằng
 * SQL thô (hàm SQL `ot_write_late_result_review`, `safety_*` của mig 0368/0371, `edge_stop_ack_refusals` của 0374) ⇒ hình `drizzle_id` không áp
 * được; hình SQL thô vẫn canh. Bảng WORM mới thiếu pgTable mà không có ở đây ⇒ §0 ĐỎ kèm tên.
 */
const KHONG_DRIZZLE: Record<string, string> = {
  safety_plc_poll_state: "mig 0368 — chỉ SQL thô (bộ đọc safety PLC)",
  safety_event_trust: "mig 0371 — chỉ SQL thô",
  edge_stop_ack_refusals: "mig 0374 — chỉ SQL thô (edge)",
  ot_write_late_result_reviews: "mig 0374 — chỉ qua hàm SQL ot_write_late_result_review()",
};
/** Sàn số tệp test quét được (đo 2026-10-30: 2566 tệp, 692 có chữ "insert") — glob / đường đi hỏng ⇒ ĐỎ thay vì xanh rỗng. */
const SAN_TEP = 2000;
const SAN_CO_INSERT = 500;

describe("★★★ census — test không chèn id TƯỜNG MINH vào bảng WORM / không-xoá-được (review I4, nguyên nhân I3)", () => {
  const TEP = tepTest();
  let soCoInsert = 0;
  const vp = TEP.flatMap((p) => {
    const src = readFileSync(p, "utf8");
    if (!/insert/i.test(src)) return [];
    soCoInsert++;
    return quetTest(relative(GOC, p).replace(/\\/g, "/"), src, WORM, DRIZZLE);
  });

  it("§0 tập bảng SUY từ migration có đúng các bảng của sự cố (command_log qua REVOKE, scada_command_attempts qua trigger)", () => {
    if (process.env.IN_WORM === "1") {
      console.log("WORM=" + JSON.stringify([...WORM].sort()));
      console.log("VP=" + JSON.stringify(vp));
      console.log("SO_TEP=" + TEP.length + " CO_INSERT=" + soCoInsert);
      console.log("KHONG_MAP=" + JSON.stringify([...WORM.keys()].filter((b) => ![...DRIZZLE.values()].some((s2) => s2.has(b)))));
    }
    expect(WORM.get("command_log")).toMatch(/0279.*REVOKE/);
    expect(WORM.get("scada_command_attempts")).toMatch(/trigger/);
    expect(WORM.size).toBeGreaterThanOrEqual(10);
    expect([...(DRIZZLE.get("commandLog") ?? [])]).toEqual(["command_log"]);
  });

  it("§0b MỌI bảng WORM suy ra có định nghĩa drizzle (pgTable) HOẶC có tên trong KHONG_DRIZZLE (fix round 2 N2)", () => {
    const coMap = (b: string) => [...DRIZZLE.values()].some((x) => x.has(b));
    const thieu = [...WORM.keys()].filter((b) => !coMap(b) && !(b in KHONG_DRIZZLE));
    expect(thieu, "bảng WORM không có pgTable và không được ghim").toEqual([]);
    for (const b of Object.keys(KHONG_DRIZZLE)) {
      expect(WORM.has(b), `${b} không còn là WORM — gỡ khỏi KHONG_DRIZZLE`).toBe(true);
      expect(coMap(b), `${b} đã có pgTable — gỡ khỏi KHONG_DRIZZLE`).toBe(false);
    }
    // bảng edge / orchestration định nghĩa ngoài drizzle/schema được ánh xạ
    expect([...(DRIZZLE.get("edgeNodeReportRecords") ?? [])]).toEqual(["edge_node_report_records"]);
    expect([...(DRIZZLE.get("apiKeyHolderChanges") ?? [])]).toEqual(["api_key_holder_changes"]);
    expect([...(DRIZZLE.get("runEdgeAssignments") ?? [])]).toEqual(["orchestration_run_edge_assignments"]);
  });

  it("§0c đường quét test KHÔNG rỗng: số tệp test và số tệp có insert vượt sàn đo được (N5)", () => {
    expect(TEP.length).toBeGreaterThan(SAN_TEP);
    expect(soCoInsert).toBeGreaterThan(SAN_CO_INSERT);
  });

  it("§1 vi phạm đo được ĐÚNG BẰNG ratchet (mới ⇒ đỏ; đã sửa ⇒ gỡ khỏi ghim)", () => {
    expect([...vp].sort()).toEqual([...GHIM].sort());
  });

  it("§2 ĐỘT BIẾN — mỗi hình bị bắt (tệp ảo), kể cả import đổi tên / namespace; đối chứng không id ⇒ sạch", () => {
    const q = (src: string) => quetTest("server/xAo.test.ts", src, WORM, DRIZZLE).map((x) => x.replace(/^server\/xAo\.test\.ts:\d+ /, ""));
    expect(q("sql`INSERT INTO command_log (id, \"adapterId\") VALUES (5, 1)`;")).toEqual(["sql_id command_log"]);
    expect(q("sql`INSERT INTO public.\"scada_command_attempts\" (\"id\", user_id) VALUES (5, 1)`;")).toEqual(["sql_id scada_command_attempts"]);
    expect(q("sql`INSERT INTO command_log (${sql.raw(\"id, \")}\"adapterId\") VALUES (${1})`;")).toEqual(["sql_cot_dong command_log"]);
    expect(q("sql`INSERT INTO command_log VALUES (1, 2)`;")).toEqual(["sql_khong_cot command_log"]);
    expect(q('import { commandLog } from "../drizzle/schema";\nawait db.insert(commandLog).values({ id: 9, adapterId: 1 });')).toEqual(["drizzle_id command_log"]);
    expect(q('import { commandLog as cl } from "../drizzle/schema";\nawait db.insert(cl).values([{ adapterId: 1 }, { id: 9 }]).returning();')).toEqual(["drizzle_id command_log"]);
    expect(q('import * as s from "../drizzle/schema";\nawait db.insert(s.scadaCommandAttempts).values({ id: 9 });')).toEqual(["drizzle_id scada_command_attempts"]);
    // đối chứng
    expect(q('import { commandLog } from "../drizzle/schema";\nawait db.insert(commandLog).values({ adapterId: 1 });\nsql`INSERT INTO command_log ("adapterId") VALUES (1)`;')).toEqual([]);
    expect(q("sql`INSERT INTO factories (id, code) VALUES (1, 'x')`;")).toEqual([]); // bảng xoá được
    // fix round 2 N2 — bảng WORM định nghĩa ngoài drizzle/schema (edgeControlSchema), cả import tĩnh lẫn namespace import động
    expect(q('import { edgeNodeReportRecords } from "../services/edge/edgeControlSchema";\nawait db.insert(edgeNodeReportRecords).values({ id: 7, nodeId: 1 });')).toEqual([
      "drizzle_id edge_node_report_records",
    ]);
    expect(q('const s = await import("../services/edge/edgeControlSchema");\nawait db.insert(s.edgeAuthSigningKeys).values({ id: 7 });')).toEqual(["drizzle_id edge_auth_signing_keys"]);
    expect(q('const { deviceOwnerChanges: d } = await import("../services/edge/edgeControlSchema");\nawait db.insert(d).values([{ id: 7 }]);')).toEqual(["drizzle_id device_owner_changes"]);
    expect(q('import { edgeNodeReportRecords } from "../services/edge/edgeControlSchema";\nawait db.insert(edgeNodeReportRecords).values({ nodeId: 1 });')).toEqual([]);
    // fix round 2 N5 — bảng nội suy + values(biến) / spread
    expect(q('import { commandLog } from "../drizzle/schema";\nsql`INSERT INTO ${commandLog} (id, "adapterId") VALUES (1, 2)`;')).toEqual(["sql_id command_log"]);
    expect(q('import { factories } from "../drizzle/schema";\nsql`INSERT INTO ${factories} (id, code) VALUES (1, 2)`;')).toEqual([]); // phân giải được, không WORM
    expect(q("sql`INSERT INTO ${sql.raw(bang)} (code) VALUES (1)`;")).toEqual(["sql_bang_dong sql.raw(bang)"]);
    expect(q('import { commandLog } from "../drizzle/schema";\nawait db.insert(commandLog).values(hang);')).toEqual(["drizzle_bien command_log"]);
    expect(q('import { commandLog } from "../drizzle/schema";\nawait db.insert(commandLog).values({ ...mau, adapterId: 1 });')).toEqual(["drizzle_bien command_log"]);
  });

  it("§3 ĐỘT BIẾN — tập bảng thật sự SUY từ migration: trigger worm mới / REVOKE DELETE mới ⇒ bảng mới; chú thích bị bỏ qua", () => {
    const m = bangKhongXoaDuoc([
      { ten: "x1.sql", van: "CREATE TRIGGER trg_moi_worm BEFORE UPDATE OR DELETE ON public.\"bang_moi\" FOR EACH ROW EXECUTE FUNCTION public.moi_worm();" },
      { ten: "x2.sql", van: "CREATE TRIGGER trg_a BEFORE DELETE ON bang_hai FOR EACH ROW EXECUTE FUNCTION bang_hai_worm();" },
      { ten: "x3.sql", van: "DO $$ BEGIN EXECUTE 'REVOKE UPDATE, DELETE ON public.bang_ba FROM avi_app'; END $$;" },
      { ten: "x4.sql", van: "-- CREATE TRIGGER trg_x_worm BEFORE DELETE ON bang_chu_thich FOR EACH ROW EXECUTE FUNCTION x_worm();\nREVOKE INSERT ON bang_bon FROM avi_app;" },
      // REVOKE ALL rồi GRANT lại DELETE (migration sau) ⇒ xoá được ⇒ KHÔNG vào tập; trigger WORM thì GRANT không gỡ
      { ten: "x5.sql", van: "REVOKE ALL ON public.bang_nam FROM avi_app; GRANT SELECT, INSERT, UPDATE, DELETE ON public.bang_nam TO avi_app;" },
      { ten: "x6.sql", van: "GRANT SELECT, INSERT, DELETE ON public.bang_moi TO avi_app;" },
    ]);
    expect([...m.keys()].sort()).toEqual(["bang_ba", "bang_hai", "bang_moi"]);
  });
});
