/**
 * ★ Census AST (2026-10-23) — MỌI chỗ TẠO `product_models` trong mã sản phẩm phải tạo biến thể BASE (doc55 PV0).
 *
 * Quét `server/**` + `scripts/**` (bỏ *.test.ts): mỗi `.insert(productModels)` / chuỗi `INSERT INTO product_models` phải nằm trong một hàm (hoặc hàm bao ngoài nó) có gọi
 * `insertBaseVariantInTx` hoặc `ensureBaseVariant`. Thêm đường tạo model mới mà quên BASE ⇒ ĐỎ. Đường miễn (chỉ kèm lý do) ở `MIEN`.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const GOC = path.resolve(__dirname, "../..");
const THU_MUC = ["server", "scripts"];
const BO_QUA = new Set(["node_modules", ".git", "dist"]);
const HAM_BASE = new Set(["insertBaseVariantInTx", "ensureBaseVariant"]);

/** Miễn: "tệp::lý do". Rỗng — mọi đường hiện có đã tạo BASE. */
const MIEN: ReadonlyArray<{ tep: string; lyDo: string }> = [];

const RE_INSERT_SQL = /INSERT\s+INTO\s+(public\.)?"?product_models"?\b/i;

/** Trả các vị trí tạo model KHÔNG có lời gọi tạo BASE trong hàm bao quanh. */
export function quetNguon(ten: string, nguon: string): number[] {
  const sf = ts.createSourceFile(ten, nguon, ts.ScriptTarget.Latest, true);
  const loi: number[] = [];
  const goiBase = (n: ts.Node): boolean => {
    let co = false;
    const di = (x: ts.Node) => {
      if (co) return;
      if (ts.isCallExpression(x)) {
        const e = x.expression;
        const ten = ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : "";
        if (HAM_BASE.has(ten)) co = true;
      }
      ts.forEachChild(x, di);
    };
    di(n);
    return co;
  };
  const coBaoNgoai = (n: ts.Node): boolean => {
    for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
      if (ts.isFunctionLike(p) && goiBase(p)) return true;
    }
    return false;
  };
  const di = (n: ts.Node) => {
    let tao = false;
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "insert") {
      const a = n.arguments[0];
      if (a && ts.isIdentifier(a) && a.text === "productModels") tao = true;
    }
    if ((ts.isTemplateExpression(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isStringLiteral(n)) && RE_INSERT_SQL.test(n.getText(sf))) tao = true;
    if (tao && !coBaoNgoai(n)) loi.push(sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1);
    ts.forEachChild(n, di);
  };
  di(sf);
  return loi;
}

function lietKe(): string[] {
  const kq: string[] = [];
  const di = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (BO_QUA.has(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) di(p);
      else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name)) kq.push(path.relative(GOC, p).split(path.sep).join("/"));
    }
  };
  for (const t of THU_MUC) if (fs.existsSync(path.join(GOC, t))) di(path.join(GOC, t));
  return kq;
}

describe("census — mọi đường tạo product_models đều tạo BASE", () => {
  it("★ không đường tạo model nào thiếu BASE (ngoài danh sách miễn có lý do)", () => {
    const mien = new Set(MIEN.map((m) => m.tep));
    const loi: string[] = [];
    for (const f of lietKe()) {
      if (mien.has(f)) continue;
      const nguon = fs.readFileSync(path.join(GOC, f), "utf8");
      if (!/productModels|product_models/.test(nguon)) continue; // nhanh: bỏ tệp không nhắc tới
      for (const dong of quetNguon(f, nguon)) loi.push(`${f}:${dong}`);
    }
    expect(loi, "đường tạo product_models thiếu insertBaseVariantInTx/ensureBaseVariant").toEqual([]);
  });

  it("★ mỗi mục miễn có lý do và tệp còn tồn tại", () => {
    for (const m of MIEN) {
      expect(m.lyDo.length).toBeGreaterThan(10);
      expect(fs.existsSync(path.join(GOC, m.tep)), m.tep).toBe(true);
    }
  });

  it.each([
    ["insert Drizzle không BASE", "async function f(db){ await db.insert(productModels).values({}); }", 1],
    ["insert Drizzle trong tx, có BASE", "async function f(db){ await db.transaction(async (tx)=>{ const [r]=await tx.insert(productModels).values({}).returning(); await insertBaseVariantInTx(tx, r.id); }); }", 0],
    ["ensureBaseVariant sau insert cùng hàm", "async function f(db){ const [r]=await db.insert(productModels).values({}); await ensureBaseVariant(r.id); }", 0],
    ["SQL thô không BASE", "async function f(sql){ await sql`INSERT INTO product_models (code) VALUES (1)`; }", 1],
    ["SQL thô có public.", "async function f(sql){ await sql`insert into public.product_models (code) values (1)`; }", 1],
    ["bảng khác", "async function f(db){ await db.insert(machines).values({}); }", 0],
    ["tên gần giống", "async function f(sql){ await sql`INSERT INTO product_models_archive (a) VALUES (1)`; }", 0],
    ["BASE ở hàm KHÁC cùng tệp (không tính)", "async function a(db){ await db.insert(productModels).values({}); } async function b(){ await ensureBaseVariant(1); }", 1],
  ])("bộ quét: %s", (_t, nguon, mongDoi) => {
    expect(quetNguon("x.ts", nguon as string)).toHaveLength(mongDoi as number);
  });
});
