// ĐỢT 48 — TỔNG HỢP kết cục từ TỆP THÔ (người đọc tự đếm lại được). node .qa-dot48/tomtat-48.mjs
import { existsSync, readFileSync, readdirSync } from "node:fs";
const Q = ".qa-dot48";
const j = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null);
const t = (f) => (existsSync(f) ? readFileSync(f, "utf8").replace(/\x1b\[[0-9;]*m/g, "") : "");
const dem = (s, re) => (s.match(re) ?? []).length;
const dong = (s) => s.split(/\r?\n/);
const out = [];
const H = (s) => out.push(`\n### ${s}`);
const L = (s) => out.push(s);

// ── K7 kết cục gốc ─────────────────────────────────────────────────────────
H("K7 — kết cục gốc đúng đường người dùng (`.qa-dot48/k7/k7-*.json`)");
const k7 = j(`${Q}/k7/k7-tong.json`);
if (k7) {
  L(`Tổng ${k7.ca.length} ca: ${JSON.stringify(k7.dem)}`);
  L("| Ca | Màn | vp | PQ | Số đo |\n|---|---|---|---|---|");
  for (const c of k7.ca) L(`| ${c.ma} | ${c.man} | ${c.vp} | **${c.pq}** | ${c.so.replace(/\|/g, "⁄").slice(0, 230)} |`);
} else L("(chưa có k7-tong.json)");

// ── K7-NC census ───────────────────────────────────────────────────────────
H("K7-NC — census tâm khối bị nhãn máy KHÁC phủ (`.qa-dot48/k7/nc-*.json`)");
const nc = j(`${Q}/k7/nc-tong.json`);
if (nc) {
  L("| Màn | vp | Khung | Trong khung | Bấm được | Tâm bị nhãn máy khác phủ | Bấm thử ⇒ đích |\n|---|---|---|---|---|---|---|");
  for (const [k, v] of Object.entries(nc)) {
    if (v.census) { L(`| /factory-command 3D | ${v.vp} | mặc định | ${v.census.soTrongKhung} | ${v.census.soBamDuoc} | ${v.census.biNhanKhacPhu.length} | (tâm khác nhau ${v.soTamKhacNhau}, cụm 20px lớn nhất ${v.cumLonNhat}) |`); continue; }
    for (const [kh, c] of [["mặc định", v.macDinh], ["sau kéo 60px", v.sauKeo]]) if (c) L(`| ${v.duong} | ${v.vp} | ${kh} | ${c.soTrongKhung} | ${c.soBamDuoc} | ${c.biNhanKhacPhu.length} ${c.biNhanKhacPhu.map((x) => `${x.id}←${x.nhan.map((n) => n.split(":")[0]).join("/")}`).join(" ").slice(0, 120)} | ${kh === "sau kéo 60px" && v.bamBiPhu ? `máy ${v.bamBiPhu.may} ⇒ /twin/may/${v.bamBiPhu.dich} (${v.bamBiPhu.dichLaNhan ? "NHÃN thắng" : v.bamBiPhu.dichLaKhoi ? "khối" : "khác"})` : "—"} |`);
  }
} else L("(chưa có nc-tong.json)");

// ── lệch lớp ───────────────────────────────────────────────────────────────
H("Lệch lớp-vs-canvas (`.qa-dot48/lop/lop.json`)");
const lop = j(`${Q}/lop/lop.json`);
if (lop) {
  L("| Màn | vp | canvas | lop-nhan (dx,dy,dw,dh) | lop-canh-bao (dx,dy,dw,dh) | div absolute = canvas |\n|---|---|---|---|---|---|");
  for (const [k, d] of Object.entries(lop)) { const f = (l) => (l ? `(${l.lech.dx},${l.lech.dy},${l.lech.dw},${l.lech.dh})` : "không có"); L(`| ${k.replace(/^\d+x\d+/, "")} | ${k.match(/^\d+x\d+/)[0]} | ${JSON.stringify(d.canvas)} | ${f(d.lop["lop-nhan-twin3d"])} | ${f(d.lop["lop-canh-bao"])} | ${d.fullscreen.length}: ${d.fullscreen.map((x) => `(${x.lech.dx},${x.lech.dy})`).join(" ")} |`); }
}

// ── thị giác 22 trạng thái ─────────────────────────────────────────────────
H("Thị giác 22 trạng thái (`.qa-dot48/d3-vi/*.json`)");
if (existsSync(`${Q}/d3-vi`)) {
  const fs = readdirSync(`${Q}/d3-vi`).filter((f) => f.endsWith(".json")).sort().filter((f) => Array.isArray(j(`${Q}/d3-vi/${f}`)?.nhan));
  L("| Trạng thái | nhãn | ngoàiCanvas | bịChe | cặpChồng | badge | ẩn (soAn) | badge bịChe | badge cặpChồng | nhãn×badge | chip (trong canvas / bị che) |\n|---|---|---|---|---|---|---|---|---|---|---|");
  let ok = 0;
  for (const f of fs) { const d = j(`${Q}/d3-vi/${f}`); const nc_ = d.nhan.filter((n) => !n.trongCanvas).length, nche = d.nhan.filter((n) => n.biChe.length).length, bche = d.badge.filter((b) => b.biChe.length).length; const chipOk = d.chip.every((c) => c.trongCanvas && !c.biChe.length); const dat = nc_ === 0 && nche === 0 && d.capChongNhan === 0 && bche === 0 && d.capChongBadge === 0 && d.capChongNhanBadge === 0 && chipOk; if (dat) ok++; L(`| ${f.replace(".json", "")} | ${d.nhan.length} | ${nc_} | ${nche} | ${d.capChongNhan} | ${d.badge.length} | ${d.demBadge?.soAn ?? "—"} | ${bche} | ${d.capChongBadge} | ${d.capChongNhanBadge} | ${d.chip.map((c) => `"${c.chu}" ${c.trongCanvas ? "trong" : "NGOÀI"}${c.biChe.length ? " CHE" : ""}`).join("; ") || "—"} ${dat ? "" : "⚠"} |`); }
  L(`ĐẠT ${ok}/${fs.length} (tiêu chí: ngoàiCanvas 0 · bịChe 0 · cặpChồng 0 · nhãn×badge 0 · chip trong canvas không bị che)`);
}

// ── bbox 34 ────────────────────────────────────────────────────────────────
H("bbox 34 mục (`.qa-dot48/run-bbox-qa7.log`)");
{ const s = t(`${Q}/run-bbox-qa7.log`); const ls = dong(s).filter((l) => /\] M\d+/.test(l)); L(`ĐẠT ${ls.filter((l) => / ĐẠT/.test(l)).length} · TRƯỢT ${ls.filter((l) => / TRƯỢT/.test(l)).length} — ${(s.match(/=== bbox45 .*===/) ?? ["(chưa)"])[0]}`); for (const l of ls.filter((l) => / TRƯỢT/.test(l))) L(`  - ${l.trim().slice(0, 220)}`); }

// ── e2e spec47 ─────────────────────────────────────────────────────────────
H("e2e/twin-dot47-bam-canh.spec.ts trên 3048 (`.qa-dot48/run-e2e-spec47.log`)");
{ const s = t(`${Q}/run-e2e-spec47.log`); L(`${(s.match(/\d+ passed.*|\d+ failed.*/g) ?? ["(chưa)"]).join(" · ")} · ${(s.match(/exit=\d+/) ?? [""])[0]} · khôi phục .qa-dot47/e2e: ${t(`${Q}/e2e-spec47-khoiphuc.txt`).trim() || "(chưa)"}`); }

// ── nguồn khung 40 s ───────────────────────────────────────────────────────
H("40 s đứng yên — khung/rAF/commit theo renderer (`.qa-dot48/run-nguon-khung-*.log`, `.qa-dot48/nguon-khung/*.json`)");
for (const m of ["twin", "line", "may"]) { const s = dong(t(`${Q}/run-nguon-khung-${m}.log`))[0]; L(`- ${m}: ${s ? s.slice(0, 260) : "(chưa)"}`); }
H("p1 40 s (`.qa-dot48/p1/p1-*-1600x900.json`)");
for (const m of ["twin", "line", "may"]) { const d = j(`${Q}/p1/p1-${m}-1600x900.json`); L(d ? `- ${m}: ${d.tong40s} khung/40 s cửa sổ 4 s ${JSON.stringify(d.cuaSo4s)} · camĐổi ${d.camDoi} · kéo ${d.keo?.khungKhiKeo ?? "-"} khung/1,5 s · canvasDom ${d.canvasDom} __soCanvas ${d.__soCanvas}` : `- ${m}: (chưa)`); }

// ── hồi quy D-1/D-2/F1 ─────────────────────────────────────────────────────
H("Hồi quy D-1 48 ca (`.qa-dot48/tomtat-D1.txt`)");
{ const s = t(`${Q}/tomtat-D1.txt`); const tail = dong(s.trim()).slice(-2); L(s ? tail.map((x) => x.slice(0, 700)).join("\n") : "(chưa)"); }
H("Hồi quy D-2 chan (K/E/I/P) (`.qa-dot48/run-D2-chan.log`)");
{ const s = t(`${Q}/run-D2-chan.log`); L(s ? `✓ ${dem(s, /✓/g)} · ✗ ${dem(s, /✗/g)} · ĐẠT ${dem(s, /ĐẠT/g)} · TRƯỢT ${dem(s, /TRƯỢT/g)} · LOI ${dem(s, /LOI/g)}` : "(chưa)"); if (s) for (const l of dong(s).filter((x) => /✗|TRƯỢT|LOI/.test(x))) L(`  - ${l.trim().slice(0, 220)}`); }
H("F1 fonts 4 mạng (`.qa-dot48/run-F1*.log`)");
for (const f of ["run-F1.log", "run-F1-thuong.log", "run-F1-cham-treo.log"]) { const s = t(`${Q}/${f}`); L(`- ${f}: ${s ? `✓ ${dem(s, /✓/g)} · ✗ ${dem(s, /✗/g)}` : "(chưa)"}`); if (s) for (const l of dong(s).filter((x) => /✗/.test(x))) L(`  - ${l.trim().slice(0, 220)}`); }

// ── D-4 API ────────────────────────────────────────────────────────────────
H("D-4 API × vai (`.qa-dot48/api-vai/*.json`)");
L("| Vai | user | n | 200 | 403 | 404 | 200 rỗng | dấu vết SIM | dấu vết T12 |\n|---|---|---|---|---|---|---|---|---|");
for (const v of ["A", "B", "C", "D", "M", "ADM"]) { const d = j(`${Q}/api-vai/${v}.json`); if (!d) continue; const st = (c) => d.ds.filter((r) => r.status === c).length; const rong = d.ds.filter((r) => r.status === 200 && (r.n === 0 || /"json":(\[\]|null|\{\})/.test(r.tho.slice(0, 60)))).length; L(`| ${v} | ${d.user} | ${d.ds.length} | ${st(200)} | ${st(403)} | ${st(404)} | ${rong} | ${d.ds.filter((r) => r.coSIM).length} | ${d.ds.filter((r) => r.coT12).length} |`); }
{ const s = t(`${Q}/run-D4-api.log`); for (const l of dong(s).filter((x) => /\[socket |\[http-v1\]/.test(x))) L(`- ${l.trim().slice(0, 200)}`); }

// ── cổng nguồn ─────────────────────────────────────────────────────────────
H("Cổng nguồn (`.qa-dot48/cong-nguon.log`)");
L("```\n" + dong(t(`${Q}/cong-nguon.log`)).filter((x) => /Test Files|Tests |FAIL|exit=|ĐẠT|placeholder|===/.test(x)).map((x) => x.slice(0, 200)).join("\n") + "\n```");
console.log(out.join("\n"));
