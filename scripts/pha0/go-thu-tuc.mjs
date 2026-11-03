#!/usr/bin/env node
/**
 * Gỡ thủ tục tRPC khỏi một router bằng AST (cắt đúng thuộc tính của literal trong `router({...})`).
 *   node scripts/pha0/go-thu-tuc.mjs <tệp.ts> <TênRouter> <proc> [<proc> ...] [--dry]
 * <proc> có thể là đường dẫn lồng nhau "models.register" khi `models: router({...})` nằm NGAY trong literal.
 * Cắt từ đầu dòng của thuộc tính (kèm chú thích dẫn đầu liền kề) tới hết dấu phẩy; in dòng bị cắt để người duyệt đọc diff.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const ROOT = process.cwd();
const ts = createRequire(path.join(ROOT, "package.json"))("typescript");
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const dry = process.argv.includes("--dry");
const [tep, ten, ...procs] = args;
if (!tep || !ten || procs.length === 0) { console.error("Dùng: go-thu-tuc.mjs <tệp> <router> <proc...>"); process.exit(2); }

let src = fs.readFileSync(tep, "utf8");
const sf = ts.createSourceFile(tep, src, ts.ScriptTarget.Latest, true);

function timLiteral() {
  let kq = null;
  const visit = (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === ten && n.initializer && ts.isCallExpression(n.initializer)) {
      const a = n.initializer.arguments[0];
      if (a && ts.isObjectLiteralExpression(a)) kq = a;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return kq;
}
const ten2 = (p) => (ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name) ? p.name.text : null);
function timThuocTinh(lit, duong) {
  const [dau, ...con] = duong.split(".");
  const p = lit.properties.find((x) => (ts.isPropertyAssignment(x) || ts.isMethodDeclaration(x) || ts.isShorthandPropertyAssignment(x)) && ten2(x) === dau);
  if (!p) return null;
  if (con.length === 0) return p;
  const init = ts.isPropertyAssignment(p) ? p.initializer : null;
  const inner = init && ts.isCallExpression(init) ? init.arguments[0] : null;
  if (inner && ts.isObjectLiteralExpression(inner)) return timThuocTinh(inner, con.join("."));
  return null; // lồng qua tham chiếu ngoài literal — không xử lý
}

const lit = timLiteral();
if (!lit) { console.error(`không thấy ${ten} = router({...}) trong ${tep}`); process.exit(1); }
const cac = procs.map((pr) => {
  const p = timThuocTinh(lit, pr);
  if (!p) throw new Error(`không thấy thủ tục ${pr} trong ${ten}`);
  // gồm chú thích dẫn đầu (JSDoc / // liền kề) bắt đầu từ getFullStart, lùi về đầu dòng
  let bat = p.getFullStart();
  const kt = p.getEnd();
  let ket = kt;
  while (/[ \t]/.test(src[ket] ?? "")) ket++;
  if (src[ket] === ",") ket++;
  while (/[ \t]/.test(src[ket] ?? "")) ket++;
  if (src[ket] === "\r") ket++;
  if (src[ket] === "\n") ket++;
  // bỏ khoảng trắng đầu chú thích dẫn đầu: bắt đầu từ sau dòng trước
  const tx = src.slice(bat, kt);
  const lead = tx.match(/^\s*/)[0];
  bat += lead.includes("\n") ? lead.lastIndexOf("\n") + 1 : 0;
  return { pr, bat, ket, noiDung: src.slice(bat, ket) };
}).sort((a, b) => b.bat - a.bat);
for (const c of cac) {
  console.log(`--- gỡ ${ten}.${c.pr} (${c.noiDung.split("\n").length} dòng)`);
  if (!dry) src = src.slice(0, c.bat) + src.slice(c.ket);
}
if (!dry) fs.writeFileSync(tep, src);
