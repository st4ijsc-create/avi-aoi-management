#!/usr/bin/env node
/**
 * Pha 0 — bản đồ "ai gọi router/procedure này" bằng AST (không grep thô).
 *
 *   node scripts/pha0/ban-do-client-goi.mjs orchestrationGov twinGov orchestration.getWorkflow ...
 *
 * Mục tiêu "router.xxx" ⇒ mọi chuỗi truy cập thuộc tính có đoạn `xxx` ở vị trí ≥ 1 (sau trpc / utils / caller / api …);
 * "router.proc" ⇒ chuỗi có `router` rồi `proc` liền kề. Đếm RIÊNG:
 *   - gọi (chuỗi kết thúc bằng useQuery · useMutation · query · mutate … hoặc có thêm đoạn ⇒ có người dùng thật),
 *   - khớp chuỗi ký tự "router.proc" (đường /api/trpc/router.proc, batch, mảng đường dẫn — KHÔNG phải bình luận),
 *   - truy cập động `x["router"]` / `x[ten]` trên đối tượng trpc ⇒ báo "KHÔNG CHỨNG MINH ĐƯỢC" (không kết luận 0).
 * Quét: client/src · vscode-extension (không node_modules) · apps · FactoryAlertSystem · e2e · scripts · server (createCaller nội bộ) · shared.
 * Test (*.test.*) tách riêng. Kết luận "0 client-caller" CHỈ khi cột client = 0 VÀ không có truy cập động trên trpc/utils.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const ROOT = process.cwd();
const require = createRequire(path.join(ROOT, "package.json"));
const ts = require("typescript");

const BO_QUA = new Set(["node_modules", "dist", ".git", "uploads", "test-results", ".vite", "_tho_ca_wt", "models", "vendor"]);
const DUOI = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const VUNG = ["client/src", "vscode-extension", "apps", "FactoryAlertSystem", "e2e", "scripts", "server", "shared", "tests"];

const muc = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const json = process.argv.includes("--json");
if (muc.length === 0) {
  console.error("Dùng: node scripts/pha0/ban-do-client-goi.mjs <router|router.proc> ...");
  process.exit(2);
}

function* duyet(dir) {
  let ds;
  try { ds = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const d of ds) {
    if (BO_QUA.has(d.name)) continue;
    const p = path.join(dir, d.name);
    if (d.isDirectory()) yield* duyet(p);
    else if (DUOI.has(path.extname(d.name)) && !d.name.endsWith(".d.ts")) yield p;
  }
}

function loaiVung(rel) {
  const r = rel.replace(/\\/g, "/");
  if (/\.(test|spec)\.[cm]?[tj]sx?$/.test(r) || r.startsWith("tests/") || r.includes("/__tests__/")) return "test";
  if (r.startsWith("client/")) return "client";
  if (r.startsWith("vscode-extension/") || r.startsWith("apps/") || r.startsWith("FactoryAlertSystem/")) return "ngoai";
  if (r.startsWith("server/") || r.startsWith("shared/")) return "server";
  return "kichban"; // scripts · e2e
}

/** Làm phẳng chuỗi truy cập thuộc tính: a.b.c(...).d ⇒ ["a","b","c"] (dừng ở lời gọi). */
function phang(node) {
  const dot = [];
  let n = node;
  for (;;) {
    if (ts.isPropertyAccessExpression(n)) { dot.unshift(n.name.text); n = n.expression; continue; }
    if (ts.isElementAccessExpression(n)) {
      const a = n.argumentExpression;
      dot.unshift(ts.isStringLiteralLike(a) ? a.text : "[*]");
      n = n.expression;
      continue;
    }
    if (ts.isNonNullExpression(n) || ts.isParenthesizedExpression(n)) { n = n.expression; continue; }
    break;
  }
  if (ts.isIdentifier(n)) dot.unshift(n.text);
  else if (ts.isCallExpression(n)) dot.unshift("(call)"); // trpc.useUtils().a.b
  else dot.unshift("?");
  return dot;
}

const kq = muc.map((m) => ({ muc: m, parts: m.split("."), goi: [], chuoi: [], dong: [] }));

for (const vung of VUNG) {
  for (const f of duyet(path.join(ROOT, vung))) {
    const rel = path.relative(ROOT, f);
    const loai = loaiVung(rel);
    let src;
    try { src = fs.readFileSync(f, "utf8"); } catch { continue; }
    if (!kq.some((k) => src.includes(k.parts[0]))) {
      // nhanh: tệp không nhắc tên router ⇒ chỉ cần kiểm truy cập động
      if (!/\[\s*[^\]"'`\d][^\]]*\]/.test(src) || !/trpc|useUtils|createCaller|caller/i.test(src)) continue;
    }
    const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, f.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const viTri = (n) => { const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf)); return `${rel.replace(/\\/g, "/")}:${line + 1}`; };

    const visit = (n) => {
      if (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) {
        // chỉ xử lý nút NGOÀI CÙNG của chuỗi (cha không phải truy cập tiếp trên cùng chuỗi)
        const cha = n.parent;
        const tiep = cha && (ts.isPropertyAccessExpression(cha) || ts.isElementAccessExpression(cha)) && cha.expression === n;
        if (!tiep) {
          const c = phang(n);
          for (const k of kq) {
            const [r, p] = k.parts;
            for (let i = 1; i < c.length; i++) {
              if (c[i] !== r) continue;
              if (p === undefined || c[i + 1] === p) { k.goi.push({ loai, vt: viTri(n), chuoi: c.join(".") }); break; }
            }
          }
          if (c.length >= 2 && c.includes("[*]") && /^(trpc|utils|u|api|caller|trpcClient|(?:[a-z]*)Utils)$/i.test(c[0])) {
            const idx = c.indexOf("[*]");
            if (idx <= 2) for (const k of kq) k.dong.push({ loai, vt: viTri(n), chuoi: c.join(".") });
          }
        }
      }
      const chaDuongDan = n.parent && (ts.isImportDeclaration(n.parent) || ts.isExportDeclaration(n.parent) || (ts.isCallExpression(n.parent) && (n.parent.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.parent.expression) && n.parent.expression.text === "require"))) || ts.isExternalModuleReference(n.parent) || ts.isLiteralTypeNode(n.parent));
      if ((ts.isStringLiteralLike(n) || ts.isNoSubstitutionTemplateLiteral(n)) && !chaDuongDan) {
        for (const k of kq) {
          const t = k.parts.join(".");
          const re = new RegExp(`(^|[^A-Za-z0-9_])${t.replace(/\./g, "\\.")}([^A-Za-z0-9_]|$)`);
          if (re.test(n.text) && !/^(\s*)$/.test(n.text)) k.chuoi.push({ loai, vt: viTri(n), tr: n.text.slice(0, 80) });
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
}

if (json) {
  console.log(JSON.stringify(kq, null, 1));
} else {
  for (const k of kq) {
    const dem = (a) => a.reduce((m, x) => ((m[x.loai] = (m[x.loai] ?? 0) + 1), m), {});
    console.log(`\n=== ${k.muc}`);
    console.log("  gọi (chuỗi truy cập AST):", JSON.stringify(dem(k.goi)));
    console.log("  khớp chuỗi ký tự        :", JSON.stringify(dem(k.chuoi)));
    console.log("  truy cập động trpc/utils:", JSON.stringify(dem(k.dong)));
    for (const x of k.goi.filter((x) => x.loai !== "test")) console.log(`   GOI [${x.loai}] ${x.vt}  ${x.chuoi}`);
    for (const x of k.chuoi.filter((x) => x.loai !== "test")) console.log(`   STR [${x.loai}] ${x.vt}  "${x.tr}"`);
    for (const x of k.dong.filter((x) => x.loai !== "test")) console.log(`   DONG[${x.loai}] ${x.vt}  ${x.chuoi}`);
    const t = k.goi.filter((x) => x.loai === "test").length + k.chuoi.filter((x) => x.loai === "test").length;
    if (t) console.log(`   (test nhắc: ${t})`);
  }
}
