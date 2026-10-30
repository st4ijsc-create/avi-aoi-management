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

/** Tên export drizzle → tên bảng (`export const x = pgTable("ten", …)`). */
function bangDrizzle(): Map<string, string> {
  const ra = new Map<string, string>();
  const d = join(GOC, "drizzle", "schema");
  for (const n of readdirSync(d)) {
    if (!n.endsWith(".ts")) continue;
    for (const m of readFileSync(join(d, n), "utf8").matchAll(/export const (\w+)\s*=\s*pgTable\(\s*"(\w+)"/g)) ra.set(m[1], m[2]);
  }
  return ra;
}

type Hinh = "sql_id" | "sql_cot_dong" | "sql_khong_cot" | "drizzle_id";

const vanBan = (n: ts.Node): string | null => {
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (ts.isTemplateExpression(n)) return n.head.text + n.templateSpans.map((s) => "${}" + s.literal.text).join("");
  return null;
};

/** Quét MỘT tệp test ⇒ danh sách `tệp:dòng hình bảng`. */
export function quetTest(rel: string, src: string, worm: ReadonlyMap<string, string>, drizzle: ReadonlyMap<string, string>): string[] {
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, rel.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const ra: string[] = [];
  const dong = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  // tên cục bộ → export drizzle (import đổi tên) + namespace import của schema
  const ten = new Map<string, string>();
  const khongGian = new Set<string>();
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && /drizzle\/schema/.test(st.moduleSpecifier.text)) {
      const nb = st.importClause?.namedBindings;
      if (nb && ts.isNamedImports(nb)) for (const e of nb.elements) ten.set(e.name.text, (e.propertyName ?? e.name).text);
      if (nb && ts.isNamespaceImport(nb)) khongGian.add(nb.name.text);
    }
  }
  const bangCuaBieuThuc = (e: ts.Expression): string | null => {
    let exp: string | undefined;
    if (ts.isIdentifier(e)) exp = ten.get(e.text);
    else if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && khongGian.has(e.expression.text)) exp = e.name.text;
    const b = exp ? drizzle.get(exp) : undefined;
    return b && worm.has(b) ? b : null;
  };
  const coId = (o: ts.Expression): boolean => {
    const ds = ts.isArrayLiteralExpression(o) ? o.elements : [o];
    return ds.some((x) => ts.isObjectLiteralExpression(x) && x.properties.some((p) => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name.getText().replace(/["']/g, "") === "id"));
  };
  const tham = (n: ts.Node) => {
    const t = vanBan(n);
    if (t !== null) {
      for (const m of t.matchAll(/INSERT\s+INTO\s+((?:"?\w+"?\.)?"?\w+"?)\s*(\(([^)]*)\)|VALUES\b|SELECT\b)/gi)) {
        const b = m[1].replace(/"/g, "").replace(/^public\./i, "").toLowerCase();
        if (!worm.has(b)) continue;
        if (m[3] === undefined) ra.push(`${rel}:${dong(n)} sql_khong_cot ${b}`);
        else {
          const cot = m[3].split(",").map((c) => c.trim().replace(/"/g, ""));
          if (cot.some((c) => c.includes("${}"))) ra.push(`${rel}:${dong(n)} sql_cot_dong ${b}`);
          else if (cot.includes("id")) ra.push(`${rel}:${dong(n)} sql_id ${b}`);
        }
      }
    }
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "values" && n.arguments[0]) {
      let e: ts.Expression = n.expression.expression;
      while (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression) && e.expression.name.text !== "insert") e = e.expression.expression;
      if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression) && e.expression.name.text === "insert" && e.arguments[0]) {
        const b = bangCuaBieuThuc(e.arguments[0]);
        if (b && coId(n.arguments[0])) ra.push(`${rel}:${dong(n)} drizzle_id ${b}`);
      }
    }
    ts.forEachChild(n, tham);
  };
  tham(sf);
  return ra;
}

function tepTest(): string[] {
  const ra: string[] = [];
  const di = (d: string) => {
    for (const n of readdirSync(d)) {
      if (n === "node_modules" || n === "dist" || n.startsWith(".")) continue;
      const p = join(d, n);
      const st = statSync(p);
      if (st.isDirectory()) di(p);
      else if (/\.test\.tsx?$/.test(n) && n !== "wormIdTuongMinhCensus.test.ts") ra.push(p); // tệp này: chuỗi fixture của §2
    }
  };
  for (const g of ["server", "shared", "client/src", "scripts"]) di(join(GOC, g));
  return ra.sort();
}

const SQLS = readdirSync(join(GOC, "drizzle"))
  .filter((n) => n.endsWith(".sql"))
  .map((n) => ({ ten: n, van: readFileSync(join(GOC, "drizzle", n), "utf8") }));
const WORM = bangKhongXoaDuoc(SQLS);
const DRIZZLE = bangDrizzle();

/**
 * ★ RATCHET — vi phạm CÓ SẴN (đo 2026-10-30, feat/scada-r1b2b2), của phiên khác: GHIM, không sửa. Số chỉ được GIẢM.
 */
const GHIM: readonly string[] = [
  // (rỗng — đo 2026-10-30: 0 vi phạm ngoài fixture của chính tệp này; bản đầu của commandLogRouter.nhatKy.r1b2b2b.db.test.ts — `${sql.raw("id, ")}` —
  // đã được viết lại ở 7435501a1 trước census này)
];

describe("★★★ census — test không chèn id TƯỜNG MINH vào bảng WORM / không-xoá-được (review I4, nguyên nhân I3)", () => {
  const vp = tepTest().flatMap((p) => {
    const src = readFileSync(p, "utf8");
    if (!/insert/i.test(src)) return [];
    return quetTest(relative(GOC, p).replace(/\\/g, "/"), src, WORM, DRIZZLE);
  });

  it("§0 tập bảng SUY từ migration có đúng các bảng của sự cố (command_log qua REVOKE, scada_command_attempts qua trigger)", () => {
    if (process.env.IN_WORM === "1") {
      console.log("WORM=" + JSON.stringify([...WORM].sort()));
      console.log("VP=" + JSON.stringify(vp));
    }
    expect(WORM.get("command_log")).toMatch(/0279.*REVOKE/);
    expect(WORM.get("scada_command_attempts")).toMatch(/trigger/);
    expect(WORM.size).toBeGreaterThanOrEqual(10);
    expect(DRIZZLE.get("commandLog")).toBe("command_log");
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
