#!/usr/bin/env node
/**
 * Gỡ khối `describe(...)` / `it(...)` / `test(...)` (cả `.skipIf(...)` / `.each`) khỏi tệp test bằng AST, theo TIỀN TỐ của tiêu đề (đối số chuỗi đầu tiên).
 *   node scripts/pha0/go-khoi-test.mjs <tệp> "<tiền tố tiêu đề>" ["<tiền tố khác>" ...] [--dry]
 * Mỗi tiền tố phải khớp ĐÚNG MỘT khối (khớp 0 hoặc >1 ⇒ dừng, không ghi). In tiêu đề + số dòng khối bị cắt để người duyệt đọc diff.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const ts = createRequire(path.join(process.cwd(), "package.json"))("typescript");
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const dry = process.argv.includes("--dry");
const [tep, ...tienTo] = args;
if (!tep || tienTo.length === 0) { console.error("Dùng: go-khoi-test.mjs <tệp> <tiền tố>..."); process.exit(2); }
let src = fs.readFileSync(tep, "utf8");
const sf = ts.createSourceFile(tep, src, ts.ScriptTarget.Latest, true);

const goiKhoi = [];
const laTen = (e) => {
  if (ts.isIdentifier(e)) return ["describe", "it", "test"].includes(e.text);
  if (ts.isPropertyAccessExpression(e)) return laTen(e.expression);
  if (ts.isCallExpression(e)) return laTen(e.expression);
  return false;
};
const visit = (n) => {
  if (ts.isExpressionStatement(n) && ts.isCallExpression(n.expression) && laTen(n.expression.expression)) {
    const a = n.expression.arguments[0];
    if (a && ts.isStringLiteralLike(a)) goiKhoi.push({ n, tieuDe: a.text });
  }
  ts.forEachChild(n, visit);
};
visit(sf);

const cac = tienTo.map((t) => {
  const kh = goiKhoi.filter((g) => g.tieuDe.startsWith(t));
  if (kh.length !== 1) throw new Error(`tiền tố "${t}" khớp ${kh.length} khối (cần đúng 1)`);
  const { n, tieuDe } = kh[0];
  let bat = n.getFullStart();
  const lead = src.slice(bat, n.getStart(sf));
  // giữ chú thích dẫn đầu thuộc về khối? Bỏ cả chú thích liền kề (cùng khối logic); chỉ bỏ khoảng trắng đầu
  { const nl = lead.lastIndexOf("\n"); bat += nl >= 0 ? nl + 1 : lead.match(/^\s*/)[0].length; }
  let ket = n.getEnd();
  while (/[ \t]/.test(src[ket] ?? "")) ket++;
  if (src[ket] === "\r") ket++;
  if (src[ket] === "\n") ket++;
  return { tieuDe, bat, ket };
}).sort((a, b) => b.bat - a.bat);

for (const c of cac) {
  console.log(`--- gỡ "${c.tieuDe.slice(0, 90)}" (${src.slice(c.bat, c.ket).split("\n").length} dòng)`);
  if (!dry) src = src.slice(0, c.bat) + src.slice(c.ket);
}
if (!dry) fs.writeFileSync(tep, src);
