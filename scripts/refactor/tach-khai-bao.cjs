// B8 — TÁCH một dải khai báo cấp cao nhất của aiLocalKnowledgeService.ts sang một module anh em, CƠ HỌC:
// giữ nguyên từng byte thân mã; import của module mới = đúng các import của service mà dải dùng; service
// nhập lại những gì nó còn dùng và RE-EXPORT mọi tên từng export (người gọi/lưới không đổi một dòng).
//   TEP=<tệp nguồn> MO_TA="<mô tả>" node scripts/refactor/tach-khai-bao.cjs <tenDau> <tenCuoi> <tepMoi> <docblock-file>
// Kiểm sau mỗi lần tách: tsc (số lỗi không đổi) + tập lưới chạm tệp nguồn (tập ca đỏ trước/sau GIỐNG HỆT).
const ts = require("typescript");
const fs = require("fs");
const path = require("path");
const F = process.env.TEP || "server/services/aiLocalKnowledgeService.ts";
const [dauTen, cuoiTen, tepMoi, docTep] = process.argv.slice(2);
const goc = fs.readFileSync(F, "utf8");
const eol = goc.includes("\r\n") ? "\r\n" : "\n";
const src = ts.createSourceFile(F, goc, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const ten = (st) =>
  ts.isVariableStatement(st)
    ? st.declarationList.declarations.flatMap((d) => (ts.isIdentifier(d.name) ? [d.name.text] : []))
    : st.name && ts.isIdentifier(st.name) ? [st.name.text] : [];
const stmts = [...src.statements];
const iDau = stmts.findIndex((s) => ten(s).includes(dauTen));
const iCuoi = stmts.findIndex((s) => ten(s).includes(cuoiTen));
if (iDau < 0 || iCuoi < iDau) throw new Error("không thấy dải");
// `export { x } from "…"` nằm lẫn trong dải là RE-EXPORT của service (hợp đồng import cũ) ⇒ ở lại service.
const giuLai = stmts.slice(iDau, iCuoi + 1).filter((s) => ts.isExportDeclaration(s));
const dai = stmts.slice(iDau, iCuoi + 1).filter((s) => !ts.isExportDeclaration(s));
const ngoai = stmts.filter((_, i) => i < iDau || i > iCuoi);
const coExport = (st) => !!st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
const laKieu = (st) => ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st);

// Tên cấp cao nhất
const tenDai = new Map(); dai.forEach((s) => ten(s).forEach((n) => tenDai.set(n, s)));
const tenNgoai = new Map(); ngoai.forEach((s) => { if (!ts.isImportDeclaration(s)) ten(s).forEach((n) => tenNgoai.set(n, s)); });
const dinhDanh = (nodes) => { const set = new Set(); const walk = (n) => { if (ts.isIdentifier(n)) set.add(n.text); ts.forEachChild(n, walk); }; nodes.forEach(walk); return set; };
const dungTrongDai = dinhDanh(dai);
const dungNgoaiDai = dinhDanh(ngoai.filter((s) => !ts.isImportDeclaration(s)));

// 1) import: GIỮ chú thích đi kèm. Module mới: chép nguyên văn (kể cả chú thích dẫn) khi dùng mọi
//    specifier, còn không thì chú thích + đúng các specifier cần. Service: xoá HẲN import không còn dùng
//    (kèm chú thích của nó — lời giải thích đi theo mã sang module mới), hoặc xoá TỪNG specifier thừa.
const importMoi = [];
const suaImportSvc = []; // {tu, den, moi}
for (const s of stmts.filter(ts.isImportDeclaration)) {
  const c = s.importClause;
  const dan = goc.slice(s.getFullStart(), s.getStart()).replace(/^\s*\r?\n/, "");
  if (!c) continue; // import tác dụng phụ: giữ ở service
  const pt = [];
  if (c.name) pt.push({ loc: c.name.text, node: c.name, kieu: "mac" });
  if (c.namedBindings && ts.isNamespaceImport(c.namedBindings)) pt.push({ loc: c.namedBindings.name.text, node: c.namedBindings, kieu: "ns" });
  if (c.namedBindings && ts.isNamedImports(c.namedBindings)) c.namedBindings.elements.forEach((e) => pt.push({ loc: e.name.text, node: e, kieu: "ten" }));
  const moiDung = pt.filter((x) => dungTrongDai.has(x.loc));
  const cuDung = pt.filter((x) => dungNgoaiDai.has(x.loc));
  if (moiDung.length) {
    if (moiDung.length === pt.length) importMoi.push((dan + s.getText()).trimStart());
    else {
      const mac = moiDung.find((x) => x.kieu === "mac");
      const ns = moiDung.find((x) => x.kieu === "ns");
      const ds = moiDung.filter((x) => x.kieu === "ten").map((x) => x.node.getText());
      const phan = [mac?.loc, ns ? `* as ${ns.loc}` : null, ds.length ? `{ ${ds.join(", ")} }` : null].filter(Boolean);
      importMoi.push(`${dan.trimStart()}import ${c.isTypeOnly ? "type " : ""}${phan.join(", ")} from "${s.moduleSpecifier.text}";`);
    }
  }
  // Import ĐẦU TỆP: phần dẫn trước nó là docblock của CẢ TỆP, không phải của import ⇒ không xoá theo (lỗi đã gặp ở bước 2).
  if (cuDung.length === 0) suaImportSvc.push({ tu: s === stmts[0] ? s.getStart() : s.getFullStart(), den: s.end, moi: "" });
  else if (cuDung.length < pt.length) {
    if (pt.some((x) => x.kieu !== "ten" && !cuDung.includes(x))) throw new Error("chưa hỗ trợ bỏ default/ns một phần: " + s.getText());
    for (const x of pt.filter((y) => !cuDung.includes(y))) {
      let den = x.node.end;
      const sau = goc.slice(den).match(/^\s*,/);
      if (sau) den += sau[0].length;
      suaImportSvc.push({ tu: x.node.getFullStart(), den, moi: "" });
    }
  }
}

// 2) tên module mới cần TỪ service (khai ở ngoài dải) ⇒ service phải export chúng
const canTuService = [...dungTrongDai].filter((n) => tenNgoai.has(n) && !tenDai.has(n));
const kieuTuService = canTuService.filter((n) => laKieu(tenNgoai.get(n)));
const giaTriTuService = canTuService.filter((n) => !laKieu(tenNgoai.get(n)));
// 3) tên service cần TỪ dải ⇒ module mới export
const serviceCan = [...dungNgoaiDai].filter((n) => tenDai.has(n));
const exportCu = dai.filter(coExport).flatMap(ten);

// Văn bản dải, thêm `export` cho khai báo service cần mà chưa export
let vanBan = goc.slice(dai[0].getFullStart(), dai[dai.length - 1].end);
const vanBanGiuLai = giuLai.map((s) => goc.slice(s.getFullStart(), s.end));
for (const g of vanBanGiuLai) vanBan = vanBan.replace(g, "");
const canThemExport = dai.filter((s) => !coExport(s) && ten(s).some((n) => serviceCan.includes(n)));
// chèn từ cuối lên để vị trí không trôi
const offset0 = dai[0].getFullStart();
for (const s of [...canThemExport].sort((a, b) => b.getStart() - a.getStart())) {
  const p = s.getStart() - offset0;
  vanBan = vanBan.slice(0, p) + "export " + vanBan.slice(p);
}
const tenSvc = "./" + path.basename(F, ".ts");
const dauModule = [
  fs.readFileSync(docTep, "utf8").trimEnd().replace(/\r?\n/g, eol),
  ...importMoi,
  kieuTuService.length ? `import type { ${kieuTuService.sort().join(", ")} } from "${tenSvc}";` : null,
  giaTriTuService.length ? `import { ${giaTriTuService.sort().join(", ")} } from "${tenSvc}";` : null,
].filter(Boolean).join(eol);
fs.writeFileSync(path.join(path.dirname(F), tepMoi + ".ts"), dauModule + eol + vanBan.replace(/^\r?\n/, eol) + eol);

// 4) service: bỏ dải; export những tên module mới cần; import + re-export
let svc = goc;
// thêm export cho khai báo ngoài dải mà module mới cần (chưa export)
const svcThemExport = ngoai.filter((s) => !ts.isImportDeclaration(s) && !coExport(s) && ten(s).some((n) => canTuService.includes(n)));
const suaVung = [];
suaVung.push({ tu: dai[0].getFullStart(), den: dai[dai.length - 1].end, moi: "" });
svcThemExport.forEach((s) => suaVung.push({ tu: s.getStart(), den: s.getStart(), moi: "export " }));
suaImportSvc.forEach((v) => suaVung.push(v));
const imps = stmts.filter(ts.isImportDeclaration);
const importTuMoi = serviceCan.filter((n) => !exportCu.includes(n) || true);
const kieuMoiCan = importTuMoi.filter((n) => laKieu(tenDai.get(n)));
const giaTriMoiCan = importTuMoi.filter((n) => !laKieu(tenDai.get(n)));
const khoiImport = [
  `// ★ B8 — ${process.env.MO_TA || "một phần"} đã tách sang \`./${tepMoi}.ts\` (xem docblock đầu tệp đó).`,
  giaTriMoiCan.length ? `import { ${giaTriMoiCan.sort().join(", ")} } from "./${tepMoi}";` : null,
  kieuMoiCan.length ? `import type { ${kieuMoiCan.sort().join(", ")} } from "./${tepMoi}";` : null,
].filter(Boolean).join(eol);
const cuoiImport = imps[imps.length - 1].end;
suaVung.push({ tu: cuoiImport, den: cuoiImport, moi: eol + khoiImport });
suaVung.sort((x, y) => y.tu - x.tu || y.den - x.den).forEach((v) => { svc = svc.slice(0, v.tu) + v.moi + svc.slice(v.den); });
// re-export các tên từng export (người gọi ngoài + lưới) — và cả tên service tự dùng trong số đó
const exportGiaTri = dai.filter((s) => coExport(s) && !laKieu(s)).flatMap(ten);
const exportKieu = dai.filter((s) => coExport(s) && laKieu(s)).flatMap(ten);
const reExport = [
  eol,
  ...vanBanGiuLai.map((g) => g.trim()),
  `// ★ B8 — ${dai.length} khai báo đã chuyển sang \`./${tepMoi}.ts\`; re-export để mọi người gọi/lưới cũ không đổi một dòng.`,
  exportGiaTri.length ? `export { ${exportGiaTri.sort().join(", ")} } from "./${tepMoi}";` : null,
  exportKieu.length ? `export type { ${exportKieu.sort().join(", ")} } from "./${tepMoi}";` : null,
].filter(Boolean).join(eol);
fs.writeFileSync(F, svc.trimEnd() + reExport + eol);
console.log(JSON.stringify({ soKhaiBao: dai.length, dongMoi: vanBan.split(/\r?\n/).length, canTuService, serviceCan, exportCu, svcThemExport: svcThemExport.flatMap(ten) }, null, 1));
