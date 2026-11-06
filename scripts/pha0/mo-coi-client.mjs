#!/usr/bin/env node
/**
 * Pha 0 — tệp client MỒ CÔI bằng đồ thị import AST (bao gồm import động React.lazy, export-from, require).
 *   node scripts/pha0/mo-coi-client.mjs [--json] [tiền-tố-lọc ...]
 * Gốc: client/src/main.tsx (+ mọi tệp *.test.* / *.stories.* coi như KHÔNG phải gốc ⇒ test không giữ sống mã).
 * Mồ côi = không với tới được từ gốc. Cũng in "chỉ test import" (sống nhờ test) để người duyệt biết.
 * Giới hạn: chuỗi động (`import(\`./x/${a}\`)`, glob `import.meta.glob`) KHÔNG được theo ⇒ tệp trong thư mục bị glob được liệt vào "nghi glob" thay vì mồ côi.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const ROOT = process.cwd();
const require = createRequire(path.join(ROOT, "package.json"));
const ts = require("typescript");
const SRC = path.join(ROOT, "client/src");
const DUOI = [".ts", ".tsx", ".mts", ".js", ".jsx"];
const json = process.argv.includes("--json");
const loc = process.argv.slice(2).filter((a) => !a.startsWith("--"));

const tatCa = [];
(function duyet(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules") duyet(p); }
    else if (DUOI.includes(path.extname(e.name)) && !e.name.endsWith(".d.ts")) tatCa.push(p);
  }
})(SRC);
const tap = new Set(tatCa);

function giai(tu, spec) {
  let base;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith("./") || spec.startsWith("../")) base = path.resolve(path.dirname(tu), spec);
  else if (spec.startsWith("@shared/") || spec.startsWith("@server/")) return null;
  else return null;
  const ung = [base, ...DUOI.map((x) => base + x), ...DUOI.map((x) => path.join(base, "index" + x))];
  return ung.find((u) => tap.has(u)) ?? null;
}

const laTest = (f) => /\.(test|spec|stories)\.[tj]sx?$/.test(f) || f.includes(`${path.sep}__tests__${path.sep}`);
const canh = new Map();
const glob = new Set();
for (const f of tatCa) {
  const src = fs.readFileSync(f, "utf8");
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, f.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const ra = new Set();
  const them = (s) => { const g = giai(f, s); if (g) ra.add(g); };
  const visit = (n) => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteralLike(n.moduleSpecifier)) them(n.moduleSpecifier.text);
    if (ts.isCallExpression(n)) {
      const a = n.arguments[0];
      if (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === "require")) {
        if (a && ts.isStringLiteralLike(a)) them(a.text);
        else if (a && (ts.isTemplateExpression(a) || ts.isIdentifier(a))) glob.add(path.relative(ROOT, f).replace(/\\/g, "/"));
      }
      if (ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "glob" && n.expression.expression.getText(sf).includes("import.meta")) glob.add(path.relative(ROOT, f).replace(/\\/g, "/"));
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  canh.set(f, ra);
}

const goc = [path.join(SRC, "main.tsx")].filter((g) => tap.has(g));
if (goc.length === 0) { console.error("không thấy client/src/main.tsx"); process.exit(2); }
const thay = new Set(goc);
const hang = [...goc];
while (hang.length) {
  const f = hang.pop();
  for (const t of canh.get(f) ?? []) if (!thay.has(t) && !laTest(f)) { thay.add(t); hang.push(t); }
}
const rel = (f) => path.relative(ROOT, f).replace(/\\/g, "/");
const khongThay = tatCa.filter((f) => !thay.has(f) && !laTest(f));
const loLoc = (f) => loc.length === 0 || loc.some((p) => rel(f).startsWith(p));
const importer = new Map();
for (const [f, ra] of canh) for (const t of ra) { if (!importer.has(t)) importer.set(t, []); importer.get(t).push(f); }
const ra = khongThay.filter(loLoc).map((f) => ({
  tep: rel(f),
  dong: fs.readFileSync(f, "utf8").split("\n").length,
  chiTestImport: (importer.get(f) ?? []).length > 0 && (importer.get(f) ?? []).every(laTest),
  nguoiImport: (importer.get(f) ?? []).map(rel),
}));
if (json) console.log(JSON.stringify({ moCoi: ra, tepCoGlobDong: [...glob].sort() }, null, 1));
else {
  console.log(`mồ côi (${ra.length}), tổng ${ra.reduce((a, x) => a + x.dong, 0)} dòng; tệp có import động không giải được: ${glob.size}`);
  for (const x of ra) console.log(`${x.tep}  (${x.dong})${x.chiTestImport ? "  [chỉ test import]" : ""}${x.nguoiImport.length && !x.chiTestImport ? "  <- " + x.nguoiImport.join(", ") : ""}`);
}
