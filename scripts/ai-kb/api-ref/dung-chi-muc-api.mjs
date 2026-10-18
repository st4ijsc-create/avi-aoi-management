#!/usr/bin/env node
/**
 * ★ 2026-10-18 — BỘ DỰNG CHỈ MỤC KÝ HIỆU API CỤC BỘ (khuyến nghị #1, `docs/superpowers/audits/2026-10-18-ai-local-nguon-hoc-code.md`).
 * NGOẠI TUYẾN, 0 tải mạng, không model, không GPU: đọc tài liệu API ĐÚNG PHIÊN BẢN đã nằm sẵn trên máy ⇒
 * `knowledge/api-ref/ky-hieu/` (gitignore — tệp SINH, ~trăm MB; `dotnet-using.json` chọn tay cạnh nó VẪN theo dõi).
 *
 *   node scripts/ai-kb/api-ref/dung-chi-muc-api.mjs [--ra <thư mục>] [--chi dotnet,nuget,ts,java,python]
 *
 * Nguồn (tự dò phiên bản mới nhất; vắng ⇒ bỏ qua có cảnh báo, không hỏng cả lượt):
 *   · dotnet  — XML IntelliSense `Microsoft.NETCore.App.Ref` + `Microsoft.AspNetCore.App.Ref` (`%ProgramFiles%\dotnet\packs`)
 *   · nuget   — XML các gói dự án dùng trong `~/.nuget/packages` (SqlClient, OPC UA, MQTTnet, NModbus…), TFM tốt nhất
 *   · ts      — `.d.ts` trong node_modules: lib.*.d.ts của TypeScript, @types/node, @types/react(-dom), zod, drizzle-orm,
 *               @types/express(+serve-static-core), mqtt, node-opcua(+node-opcua-*), modbus-serial
 *   · java    — `src.zip` của JDK mới nhất (`%ProgramFiles%\Java\jdk-*`), chỉ package `exports` không giới hạn của
 *               java.base / java.net.http / java.sql / java.logging / java.xml
 *   · python  — thư viện chuẩn qua `inspect` (tiến trình con `python -I scripts/ai-kb/api-ref/nguon-python.py`; đặt
 *               `PYTHON_API_REF` để đổi trình thông dịch)
 *
 * Ra: `muc.jsonl` + `chi-muc.tsv` + `meta.json` (định dạng ở `phanTich.mjs`) và `dotnet-kieu-ns.json` (kiểu .NET → namespace
 * cho bộ bổ sung `using` sau sinh R2B, `server/services/ai/apiRef/chiMucUsingDotnet.ts`). Dựng vào thư mục tạm rồi đổi chỗ
 * ⇒ máy chủ đang chạy không bao giờ đọc nửa chỉ mục cũ nửa mới.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { mucTuXmlDotnet, mucTuJava, mucTuTs, goiXuatJava, vietChiMuc } from "./phanTich.mjs";

const require = createRequire(import.meta.url);
const DAY = path.dirname(fileURLToPath(import.meta.url));

const thamSo = process.argv.slice(2);
const lay = (k) => {
  const i = thamSo.indexOf(k);
  return i >= 0 ? thamSo[i + 1] : undefined;
};
const RA = path.resolve(lay("--ra") ?? "knowledge/api-ref/ky-hieu");
const CHI = new Set((lay("--chi") ?? "dotnet,nuget,ts,java,python").split(",").map((x) => x.trim()).filter(Boolean));

const soPhienBan = (a, b) => a.localeCompare(b, undefined, { numeric: true });
const moiNhat = (ds) => [...ds].sort(soPhienBan).at(-1);
const coThuMuc = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const canhBao = (s) => console.warn(`  ⚠ ${s}`);

// ─── .NET ───────────────────────────────────────────────────────────────────────────────────────

/** Một bộ tệp XML (cùng gói) ⇒ mục; kiểu lồng nhận diện trên TOÀN gói (kiểu ngoài có thể ở tệp khác). */
function mucTuBoXml(tepDs, nhanTep) {
  const van = tepDs.map((t) => fs.readFileSync(t, "utf8"));
  const kieuBiet = new Set();
  for (const v of van) for (const m of v.matchAll(/<member name="T:([^"]+)"/g)) kieuBiet.add(m[1]);
  return van.flatMap((v, i) => mucTuXmlDotnet(v, { tep: nhanTep(tepDs[i]), kieuBiet }));
}

function nguonDotnet() {
  const goc = path.join(process.env.ProgramFiles ?? "C:/Program Files", "dotnet", "packs");
  const ra = [];
  for (const [id, goi, nhan] of [
    ["dotnet-core", "Microsoft.NETCore.App.Ref", ".NET"],
    ["dotnet-aspnetcore", "Microsoft.AspNetCore.App.Ref", "ASP.NET Core"],
  ]) {
    const thu = path.join(goc, goi);
    if (!coThuMuc(thu)) {
      canhBao(`không thấy ${thu}`);
      continue;
    }
    const ver = moiNhat(fs.readdirSync(thu).filter((v) => /^\d+\.\d+\.\d+$/.test(v)));
    const refGoc = path.join(thu, ver, "ref");
    const tf = moiNhat(fs.readdirSync(refGoc).filter((d) => /^net\d/.test(d)));
    const thuXml = path.join(refGoc, tf);
    const tep = fs.readdirSync(thuXml).filter((f) => f.endsWith(".xml")).map((f) => path.join(thuXml, f));
    const muc = mucTuBoXml(tep, (t) => path.basename(t));
    ra.push({ id, nn: "csharp", nhan: `${nhan} ${ver} (${goi}, ${tf})`, phienBan: ver, duong: thuXml, muc, soTep: tep.length });
  }
  return ra;
}

/** Gói NuGet dự án dùng (`tools/machine-simulator/src/St4i.EdgeCore`, cs-template, đơn hàng C# + SQL Server). */
const GOI_NUGET = [
  "microsoft.data.sqlclient",
  "system.data.sqlclient",
  "opcfoundation.netstandard.opc.ua.core",
  "opcfoundation.netstandard.opc.ua.types",
  "opcfoundation.netstandard.opc.ua.client",
  "opcfoundation.netstandard.opc.ua.server",
  "opcfoundation.netstandard.opc.ua.configuration",
  "opcfoundation.netstandard.opc.ua.security.certificates",
  "mqttnet",
  "mqttnet.server",
  "nmodbus",
];
const UU_TIEN_TFM = ["net10.0", "net9.0", "net8.0", "net7.0", "net6.0", "netstandard2.1", "netstandard2.0", "netcoreapp3.1", "netcoreapp2.1", "net48", "net472", "net462", "net461"];

function nguonNuget() {
  const goc = process.env.NUGET_PACKAGES ?? path.join(os.homedir(), ".nuget", "packages");
  const ra = [];
  for (const goi of GOI_NUGET) {
    const thu = path.join(goc, goi);
    if (!coThuMuc(thu)) {
      canhBao(`NuGet: chưa có gói ${goi} trong ${goc}`);
      continue;
    }
    const ver = moiNhat(fs.readdirSync(thu).filter((v) => /^\d/.test(v)));
    const lib = path.join(thu, ver, "lib");
    if (!coThuMuc(lib)) continue;
    const tfs = fs.readdirSync(lib);
    const tf = UU_TIEN_TFM.find((t) => tfs.includes(t) && fs.readdirSync(path.join(lib, t)).some((f) => f.endsWith(".xml")));
    if (!tf) {
      canhBao(`NuGet: ${goi} ${ver} không có XML doc`);
      continue;
    }
    const tep = fs.readdirSync(path.join(lib, tf)).filter((f) => f.endsWith(".xml")).map((f) => path.join(lib, tf, f));
    const muc = mucTuBoXml(tep, (t) => `${goi}/${ver}/lib/${tf}/${path.basename(t)}`);
    ra.push({ id: `nuget:${goi}`, nn: "csharp", nhan: `NuGet ${goi} ${ver} (${tf})`, phienBan: ver, duong: path.join(lib, tf), muc });
  }
  return ra;
}

// ─── TypeScript ─────────────────────────────────────────────────────────────────────────────────

function liKeDts(thu) {
  const ra = [];
  const di = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        di(path.join(d, e.name));
      } else if (e.name.endsWith(".d.ts")) ra.push(path.join(d, e.name));
    }
  };
  di(thu);
  return ra.sort();
}

/** Đường tệp trong gói ⇒ module IMPORT được: khoá `exports` dài nhất là thư mục tiền tố; không có ⇒ tên gói. */
export function tenModuleTs(tenGoi, pkg, rel) {
  const r = rel.replace(/\\/g, "/").replace(/\.d\.ts$/, "").replace(/^(dist|lib|build|types|esm|cjs|src)\//, "").replace(/\/index$/, "");
  const khoa = pkg?.exports && typeof pkg.exports === "object" ? Object.keys(pkg.exports).filter((k) => k.startsWith("./") && k !== "./package.json" && !k.includes("*")) : [];
  let tot = "";
  for (const k of khoa) {
    const s = k.slice(2);
    if ((r === s || r.startsWith(`${s}/`)) && s.length > tot.length) tot = s;
  }
  return tot ? `${tenGoi}/${tot}` : tenGoi;
}

/**
 * Tệp `.d.ts` mà GỐC gói xuất lại (`export * from "./x"`, `export { a } from "./x"`, đệ quy) ⇒ ký hiệu của chúng import
 * được từ chính tên gói (`import { inArray } from "drizzle-orm"`), không cần đường con. Chỉ đặc tả TƯƠNG ĐỐI.
 */
function tepXuatTu(thu, vao) {
  const giai = (tu, spec) => {
    const goc = path.resolve(tu, spec.replace(/\.(m|c)?js$/, ""));
    for (const ung of [`${goc}.d.ts`, path.join(goc, "index.d.ts"), goc.endsWith(".d.ts") ? goc : null]) if (ung && fs.existsSync(ung)) return ung;
    return null;
  };
  const ra = new Set();
  const hang = [giai(thu, String(vao).replace(/\.d\.(m|c)?ts$/, ""))];
  while (hang.length) {
    const t = hang.pop();
    if (!t || ra.has(t) || !fs.existsSync(t)) continue;
    ra.add(t);
    const van = fs.readFileSync(t, "utf8");
    for (const m of van.matchAll(/export\s+(?:\*|\{[^}]*\}|\*\s+as\s+\w+)\s+from\s+["'](\.[^"']+)["']/g)) hang.push(giai(path.dirname(t), m[1]));
  }
  return ra;
}

/**
 * Tệp → module import được, theo ĐIỂM VÀO của gói: gốc (`types`/`exports["."]`) rồi từng khoá `exports` (ngắn trước); tệp
 * được một điểm vào xuất lại (`export * from "./x"`, đệ quy) nhận tên module của điểm vào ĐẦU TIÊN tới được nó
 * (`inArray` ⇒ "drizzle-orm", `pgTable` ⇒ "drizzle-orm/pg-core"). Tệp không điểm vào nào tới ⇒ `tenModuleTs`.
 */
function moduleTheoDiemVao(thu, tenGoi, pkg) {
  const typesCua = (v) => (typeof v === "string" ? v : v && typeof v === "object" ? v.types ?? v.import?.types ?? v.require?.types ?? v.default?.types ?? null : null);
  const vao = [["", pkg?.types ?? pkg?.typings ?? typesCua(pkg?.exports?.["."]) ?? "index.d.ts"]];
  const ex = pkg?.exports && typeof pkg.exports === "object" ? pkg.exports : {};
  for (const k of Object.keys(ex).filter((k) => k.startsWith("./") && !k.includes("*") && k !== "./package.json").sort((a, b) => a.length - b.length)) {
    const t = typesCua(ex[k]) ?? k;
    if (/\.d\.(m|c)?ts$/.test(t) || !/\.\w+$/.test(t)) vao.push([k.slice(2), t]);
  }
  const ra = new Map();
  for (const [sub, t] of vao) for (const tep of tepXuatTu(thu, t)) if (!ra.has(tep)) ra.set(tep, sub ? `${tenGoi}/${sub}` : tenGoi);
  return ra;
}

function nguonTs() {
  let ts;
  try {
    ts = require("typescript");
  } catch {
    canhBao("không nạp được gói typescript ⇒ bỏ nguồn TS");
    return [];
  }
  const nm = path.resolve("node_modules");
  const ra = [];
  const docPkg = (thu) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(thu, "package.json"), "utf8"));
    } catch {
      return null;
    }
  };
  // TypeScript lib (JS/DOM chuẩn) — chỉ lib.*.d.ts, không API trình biên dịch
  const thuTs = path.join(nm, "typescript", "lib");
  if (coThuMuc(thuTs)) {
    const ver = docPkg(path.join(nm, "typescript"))?.version ?? "?";
    const muc = fs
      .readdirSync(thuTs)
      .filter((f) => /^lib\..*\.d\.ts$/.test(f))
      .sort()
      .flatMap((f) => mucTuTs(ts, fs.readFileSync(path.join(thuTs, f), "utf8"), { tep: `typescript/lib/${f}`, module: "" }));
    ra.push({ id: "ts:typescript-lib", nn: "typescript", nhan: `TypeScript ${ver} lib.*.d.ts (JS + DOM)`, phienBan: ver, duong: thuTs, muc });
  }
  const goiDs = [
    ["@types/node", "node"],
    ["@types/react", "react"],
    ["@types/react-dom", "react-dom"],
    ["zod", "zod"],
    ["drizzle-orm", "drizzle-orm"],
    ["@types/express", "express"],
    ["@types/express-serve-static-core", "express-serve-static-core"],
    ["mqtt", "mqtt"],
    ["modbus-serial", "modbus-serial"],
    ["node-opcua", "node-opcua"],
    ...fs
      .readdirSync(nm)
      .filter((d) => d.startsWith("node-opcua-"))
      .sort()
      .map((d) => [d, d]),
  ];
  for (const [thuGoi, tenGoi] of goiDs) {
    const thu = path.join(nm, thuGoi);
    if (!coThuMuc(thu)) {
      canhBao(`node_modules: chưa có ${thuGoi}`);
      continue;
    }
    const pkg = docPkg(thu);
    const tep = liKeDts(thu);
    if (tep.length === 0) continue;
    const muc = [];
    const theoVao = moduleTheoDiemVao(thu, tenGoi, pkg);
    for (const t of tep) {
      const rel = path.relative(thu, t).replace(/\\/g, "/");
      try {
        // @types/node: tệp script `declare module "fs"` ⇒ ns lấy từ khai báo; module mặc định "" (toàn cục)
        const mod = thuGoi === "@types/node" ? "" : theoVao.get(t) ?? tenModuleTs(tenGoi, pkg, rel);
        muc.push(...mucTuTs(ts, fs.readFileSync(t, "utf8"), { tep: `${thuGoi}/${rel}`, module: mod }));
      } catch (e) {
        canhBao(`TS ${thuGoi}/${rel}: ${e?.message ?? e}`);
      }
    }
    ra.push({ id: `ts:${thuGoi}`, nn: "typescript", nhan: `${thuGoi} ${pkg?.version ?? "?"}`, phienBan: pkg?.version, duong: thu, muc });
  }
  // gộp node-opcua-* thành MỘT nguồn (62 gói) để meta gọn
  const opc = ra.filter((x) => x.id.startsWith("ts:node-opcua-"));
  if (opc.length > 1) {
    const gop = { id: "ts:node-opcua-*", nn: "typescript", nhan: `node-opcua-* (${opc.length} gói, ${opc[0].phienBan ?? "?"})`, phienBan: opc[0].phienBan, duong: nm, muc: opc.flatMap((x) => x.muc) };
    return [...ra.filter((x) => !x.id.startsWith("ts:node-opcua-")), gop];
  }
  return ra;
}

// ─── Java ───────────────────────────────────────────────────────────────────────────────────────

const MODULE_JAVA = ["java.base", "java.net.http", "java.sql", "java.logging", "java.xml"];

async function nguonJava() {
  const goc = path.join(process.env.ProgramFiles ?? "C:/Program Files", "Java");
  if (!coThuMuc(goc)) {
    canhBao(`không thấy ${goc}`);
    return [];
  }
  const jdk = moiNhat(fs.readdirSync(goc).filter((d) => /^jdk-?\d/.test(d) && fs.existsSync(path.join(goc, d, "lib", "src.zip"))));
  if (!jdk) {
    canhBao("không có JDK kèm lib/src.zip");
    return [];
  }
  const zipTep = path.join(goc, jdk, "lib", "src.zip");
  const release = fs.existsSync(path.join(goc, jdk, "release")) ? fs.readFileSync(path.join(goc, jdk, "release"), "utf8") : "";
  const ver = /JAVA_VERSION="([^"]+)"/.exec(release)?.[1] ?? jdk;
  const JSZip = require("jszip");
  const zip = await JSZip.loadAsync(fs.readFileSync(zipTep));
  const ra = [];
  for (const mod of MODULE_JAVA) {
    const mi = zip.file(`${mod}/module-info.java`);
    if (!mi) {
      canhBao(`src.zip không có ${mod}`);
      continue;
    }
    const xuat = goiXuatJava(await mi.async("string"));
    const tep = Object.keys(zip.files)
      .filter((f) => f.startsWith(`${mod}/`) && f.endsWith(".java") && !f.endsWith("module-info.java") && !f.endsWith("package-info.java"))
      .filter((f) => xuat.has(path.posix.dirname(f.slice(mod.length + 1)).replace(/\//g, ".")))
      .sort();
    const muc = [];
    for (const f of tep) muc.push(...mucTuJava(await zip.file(f).async("string"), { tep: f }));
    ra.push({ id: `java:${mod}`, nn: "java", nhan: `JDK ${ver} ${mod}`, phienBan: ver, duong: zipTep, muc, soTep: tep.length });
  }
  return ra;
}

// ─── Python ─────────────────────────────────────────────────────────────────────────────────────

function nguonPython() {
  const macDinh = path.join(os.homedir(), "AppData", "Local", "Python", "bin", "python.exe");
  const py = process.env.PYTHON_API_REF ?? (fs.existsSync(macDinh) ? macDinh : "python");
  // CPU, vài giây; `-I` = cô lập (không đọc PYTHON* env, không thêm cwd vào sys.path). Điểm sinh tiến trình DUY NHẤT của bộ dựng.
  const r = spawnSync(py, ["-I", path.join(DAY, "nguon-python.py")], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024, timeout: 600_000 });
  if (r.error || r.status !== 0) {
    canhBao(`python stdlib: ${r.error?.message ?? `mã thoát ${r.status}`} ${String(r.stderr ?? "").slice(-400)}`);
    return [];
  }
  const muc = [];
  for (const d of String(r.stdout).split(/\r?\n/)) {
    if (!d.startsWith("{")) continue;
    try {
      muc.push(JSON.parse(d));
    } catch {
      /* dòng in ra của module khi nhập — bỏ */
    }
  }
  let meta = {};
  for (const d of String(r.stderr ?? "").split(/\r?\n/).reverse()) {
    try {
      meta = JSON.parse(d)._meta ?? {};
      break;
    } catch {
      /* cảnh báo của module */
    }
  }
  const ver = meta.phienBan ?? "?";
  if (meta.loi?.length) console.log(`  python: ${meta.soModule} module; không nhập được ${meta.loi.length} (module POSIX/nền tảng khác)`);
  return [{ id: "python:stdlib", nn: "python", nhan: `Python ${ver} stdlib`, phienBan: ver, duong: py, muc }];
}

// ─── bảng kiểu .NET → namespace (R2B) ──────────────────────────────────────────────────────────

/** Kiểu .NET top-level ⇒ namespace, từ MỌI nguồn csharp TRỪ gói cũ System.Data.SqlClient (bảng chọn tay coi nó tương đương). */
function bangKieuNs(nguonCs) {
  const kieu = {};
  const nsBiet = new Set();
  for (const ng of nguonCs) {
    for (const m of ng.muc) {
      if (m.ns) nsBiet.add(m.ns);
      if (ng.id === "nuget:system.data.sqlclient") continue;
      if (m.loai !== "type" || !m.ns || m.ten.includes(".")) continue;
      const ds = (kieu[m.ten] ??= []);
      if (!ds.includes(m.ns)) ds.push(m.ns);
    }
  }
  return { nguon: nguonCs.filter((n) => n.id !== "nuget:system.data.sqlclient").map((n) => n.nhan), kieu, moRong: {}, nsBiet: [...nsBiet].sort() };
}

// ─── chạy ───────────────────────────────────────────────────────────────────────────────────────

const t0 = Date.now();
const nguon = [];
const buoc = async (ten, fn) => {
  if (!CHI.has(ten)) return;
  const t = Date.now();
  const r = await fn();
  console.log(`· ${ten}: ${r.length} nguồn, ${r.reduce((a, b) => a + b.muc.length, 0).toLocaleString("vi-VN")} mục (${((Date.now() - t) / 1000).toFixed(1)} s)`);
  nguon.push(...r);
};
await buoc("dotnet", nguonDotnet);
await buoc("nuget", nguonNuget);
await buoc("ts", nguonTs);
await buoc("java", nguonJava);
await buoc("python", nguonPython);

const tam = `${RA}.dang-dung`;
fs.rmSync(tam, { recursive: true, force: true });
const meta = vietChiMuc(tam, nguon, { taoLuc: new Date().toISOString(), lenh: "node scripts/ai-kb/api-ref/dung-chi-muc-api.mjs", chi: [...CHI] });
const cs = nguon.filter((n) => n.nn === "csharp");
if (cs.length) fs.writeFileSync(path.join(tam, "dotnet-kieu-ns.json"), JSON.stringify(bangKieuNs(cs)) + "\n");
const cu = `${RA}.cu`;
fs.rmSync(cu, { recursive: true, force: true });
if (fs.existsSync(RA)) fs.renameSync(RA, cu);
fs.renameSync(tam, RA);
fs.rmSync(cu, { recursive: true, force: true });

const kb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
const kt = (f) => (fs.existsSync(path.join(RA, f)) ? fs.statSync(path.join(RA, f)).size : 0);
console.log(`\n→ ${RA}`);
for (const n of meta.nguon) console.log(`  ${String(n.soMuc).padStart(8)}  ${n.nn.padEnd(10)} ${n.nhan}`);
console.log(`  ${String(meta.soMuc).padStart(8)}  TỔNG · ${meta.soKhoa.toLocaleString("vi-VN")} khoá`);
console.log(`  muc.jsonl ${kb(kt("muc.jsonl"))} · chi-muc.tsv ${kb(kt("chi-muc.tsv"))} · dotnet-kieu-ns.json ${kb(kt("dotnet-kieu-ns.json"))} · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
