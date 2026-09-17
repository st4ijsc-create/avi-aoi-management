/**
 * zz-nhan2-ablation.mjs — ABLATION THẬT: bản `de1dc50a` (TRƯỚC vá) vs cây làm việc (SAU vá).
 *
 * ⚠ Bài học vừa trả giá trong chính đợt này: `zz-nhan2-sim.mjs` nạp
 *   `datNhanSaBan.ts` TỪ CÂY LÀM VIỆC, nên sau khi tôi sửa tệp ấy thì cột "V0"
 *   của nó KHÔNG CÒN là luật cũ nữa — nó là luật mới đội lốt luật cũ. Tệp này
 *   lấy bản cũ bằng `git show de1dc50a:<path>` để hai nhánh ablation thật sự khác
 *   nhau, và in md5 của cả hai nguồn để không ai phải tin lời tôi.
 */
import fs from "node:fs";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const DUONG = "client/src/components/twin3d/van-hanh/datNhanSaBan.ts";
const CU_TS = ".qa-tapdoan/zz-nhan2-datnhan-CU.ts";
const CU_JS = ".qa-tapdoan/zz-nhan2-datnhan-CU.mjs";
const MOI_JS = ".qa-tapdoan/zz-nhan2-datnhan-MOI.mjs";

const cuSrc = execFileSync("git", ["show", `de1dc50a:${DUONG}`], { encoding: "buffer" });
fs.writeFileSync(CU_TS, cuSrc);
const moiSrc = fs.readFileSync(DUONG);
const md5 = (b) => crypto.createHash("md5").update(b).digest("hex");
console.log(`nguồn CŨ  (de1dc50a) md5=${md5(cuSrc)}  ${cuSrc.length} B`);
console.log(`nguồn MỚI (cây l/việc) md5=${md5(moiSrc)}  ${moiSrc.length} B`);
if (md5(cuSrc) === md5(moiSrc)) {
  console.log("⛔ HAI NGUỒN GIỐNG NHAU — ablation vô nghĩa. DỪNG.");
  process.exit(1);
}
for (const [vao, ra] of [[CU_TS, CU_JS], [DUONG, MOI_JS]])
  execFileSync("npx", ["esbuild", vao, "--format=esm", "--bundle", `--outfile=${ra}`], { stdio: "pipe", shell: true });
const CU = await import("./zz-nhan2-datnhan-CU.mjs");
const MOI = await import("./zz-nhan2-datnhan-MOI.mjs");

const J = JSON.parse(fs.readFileSync(".qa-tapdoan/zz-nhan2-do1-truoc.json", "utf8"));
const doi = (b, g) => ({ trai: b.trai - g.trai, phai: b.phai - g.trai, tren: b.tren - g.tren, duoi: b.duoi - g.tren });
const giao = (a, b) => Math.max(0, Math.min(a.phai, b.phai) - Math.max(a.trai, b.trai)) * Math.max(0, Math.min(a.duoi, b.duoi) - Math.max(a.tren, b.tren));
const hopTu = (d, co) => ({ trai: d.x - co.rong / 2, phai: d.x + co.rong / 2, tren: d.y - co.cao / 2, duoi: d.y + co.cao / 2 });

function dungMuc(vai, cheDo) {
  const v = J.vai[vai];
  const goc = cheDo === "2d" ? v.d2.hopSvg : v.d3.hopCanvas;
  const khung = { rong: goc.w, cao: goc.h };
  const lp = cheDo === "2d" ? v.d2.lopPhu : v.d3.lopPhu;
  const vungCam = [];
  for (const p of lp) {
    const h = doi(p, goc);
    if (h.phai <= 0 || h.duoi <= 0 || h.trai >= khung.rong || h.tren >= khung.cao) continue;
    vungCam.push({ ...h, ten: p.ten });
  }
  const muc = [];
  let daDatSan = [];
  if (cheDo === "2d") {
    const nc = new Map(v.d2.nhanCum.map((n) => [n.factoryId, n]));
    for (const c of v.d2.cum) { const f = +c["data-factory-id"], n = nc.get(f);
      muc.push({ chu: n.chu, hop: doi(c.hopPx, goc), co: { rong: n.hopPx.w, cao: n.hopPx.h }, uuTien: "tren", doDuoc: n }); }
    const nt = new Map(v.d2.nhanToa.map((n) => [n.toaNhaId, n]));
    for (const t of v.d2.toa) { const id = +t["data-toa-nha-id"], n = nt.get(id);
      muc.push({ chu: n.chu, hop: doi(t.hopPx, goc), co: { rong: n.hopPx.w, cao: n.hopPx.h }, uuTien: "trong", doDuoc: n }); }
  } else {
    const nt = new Map();
    for (const n of v.d3.nhanToa) if (!nt.has(`${n.toaNhaId}`)) nt.set(`${n.toaNhaId}`, n);
    const hien = v.d3.nhanToa.filter((n) => !n.an && n.hop);
    const w = hien.map((n) => n.hop.w).sort((a, b) => a - b), h = hien.map((n) => n.hop.h).sort((a, b) => a - b);
    const co = { rong: w[w.length >> 1], cao: h[h.length >> 1] };
    for (const b of v.d3.hopBieuTuong) muc.push({ chu: (nt.get(`${b.toaNhaId}`) || {}).chu ?? "?", hop: b.hop, co, uuTien: "tren", doDuoc: nt.get(`${b.toaNhaId}`) });
    daDatSan = v.d3.nhanCum.filter((n) => !n.an && n.hop).map((n) => doi(n.hop, goc));
  }
  return { muc, vungCam, khung, goc, daDatSan };
}

function chay(vai, cheDo, dat) {
  const { muc, vungCam, khung, goc, daDatSan } = dungMuc(vai, cheDo);
  const daDat = [...daDatSan];
  const ra = [];
  for (const m of muc) {
    const d = dat(m.hop, m.co, [...vungCam, ...daDat], khung, m.uuTien);
    if (d === null) { ra.push({ ...m, ket: null }); continue; }
    const hn = hopTu(d, m.co);
    if (m.co.rong > 0) daDat.push(hn);
    let che = 0; for (const z of vungCam) che += giao(hn, z);
    ra.push({ ...m, ket: d, tyLeChe: Math.round((che / (m.co.rong * m.co.cao)) * 1000) / 10 });
  }
  return { ra, goc };
}

const CA = [["qatd_admin", "2d"], ["qatd_kythuat", "2d"], ["qatd_admin", "3d"], ["qatd_kythuat", "3d"]];

console.log("\n══════ ① CŨ có tái hiện phép đo không? (đối chứng dương: phải 0 lệch) ══════");
let so = 0, lech = 0;
for (const [vai, cheDo] of CA) {
  const { ra, goc } = chay(vai, cheDo, CU.datNhanSaBan);
  for (const r of ra) {
    if (!r.doDuoc) continue;
    so += 1;
    if (r.doDuoc.an !== (r.ket === null)) { lech += 1; console.log(`   ✗ ${vai}/${cheDo} "${r.chu}" ẩn đo=${r.doDuoc.an} cũ=${r.ket === null}`); continue; }
    if (r.doDuoc.an) continue;
    const hd = doi(cheDo === "2d" ? r.doDuoc.hopPx : r.doDuoc.hop, goc);
    if (Math.abs((hd.trai + hd.phai) / 2 - r.ket.x) > 1.5 || Math.abs((hd.tren + hd.duoi) / 2 - r.ket.y) > 1.5) {
      lech += 1; console.log(`   ✗ ${vai}/${cheDo} "${r.chu}" lệch chỗ`);
    }
  }
}
console.log(`   so ${so} nhãn · lệch ${lech} ⇒ ${so > 0 && lech === 0 ? "✓ bản CŨ = bản ĐANG PHỤC VỤ" : "⛔ nền không khớp"}`);

console.log("\n══════ ② CŨ vs MỚI trên cùng hình học ══════");
let cheCu = 0, cheMoi = 0, anCu = 0, anMoi = 0, tong = 0;
for (const [vai, cheDo] of CA) {
  const a = chay(vai, cheDo, CU.datNhanSaBan), b = chay(vai, cheDo, MOI.datNhanSaBan);
  const nc = a.ra.filter((r) => r.ket && r.tyLeChe > 0), nm = b.ra.filter((r) => r.ket && r.tyLeChe > 0);
  const ac = a.ra.filter((r) => !r.ket).length, am = b.ra.filter((r) => !r.ket).length;
  cheCu += nc.length; cheMoi += nm.length; anCu += ac; anMoi += am; tong += a.ra.length;
  console.log(`  [${vai}/${cheDo}] che-một-phần ${nc.length} → ${nm.length} · ẩn ${ac} → ${am} · ve+an=tong ${b.ra.length === a.ra.length ? "✓" : "✗"}`);
  for (const r of nc) console.log(`       CŨ che "${r.chu}" ${r.tyLeChe}%`);
  for (const r of nm) console.log(`       MỚI che "${r.chu}" ${r.tyLeChe}%`);
  for (let i = 0; i < a.ra.length; i++) {
    const x = a.ra[i], y = b.ra[i];
    if (x.ket && x.tyLeChe === 0 && (!y.ket || y.tyLeChe > 0)) console.log(`       ⚠ HỒI QUY "${x.chu}"`);
    if (!x.ket && y.ket) console.log(`       + CỨU "${x.chu}" → ${y.tyLeChe}% che`);
    if (x.ket && !y.ket) console.log(`       ⚠ MẤT "${x.chu}"`);
    if (x.ket && y.ket && (Math.abs(x.ket.x - y.ket.x) > 1.5 || Math.abs(x.ket.y - y.ket.y) > 1.5))
      console.log(`       ↻ DỜI "${x.chu}" ${x.ket.ma}→${y.ket.ma}`);
  }
}
console.log(`  TỔNG (${tong} nhãn): che-một-phần ${cheCu} → ${cheMoi} · ẩn ${anCu} → ${anMoi}`);

console.log("\n══════ ③ Hai khẳng định ĐANG TRANH CHẤP của lưới cũ (ca ⑦) ══════");
{
  const THE = { trai: 0, phai: 470, tren: 34, duoi: 400 }, KHOI = { trai: 420, phai: 560, tren: 300, duoi: 380 };
  const CO = { rong: 60, cao: 18 }, KHUNG = { rong: 968, cao: 489 };
  for (const [ten, M] of [["CŨ", CU], ["MỚI", MOI]]) {
    const d = M.datNhanSaBan(KHOI, CO, [THE], KHUNG, "trong");
    const h = hopTu(d, CO);
    console.log(`  ${ten.padEnd(4)}: ${JSON.stringify(d)} · giao với lớp phủ = ${giao(h, THE)} px²` +
      ` · khẳng định "x-30 ≥ 470" ${d.x - 30 >= 470 ? "ĐÚNG" : "SAI"} · "x ≠ 490" ${Math.abs(d.x - 490) > 1e-6 ? "ĐÚNG" : "SAI"}`);
  }
}

console.log("\n══════ ④ Ca THẬT `qatd_kythuat` 3D “Toà 2” ══════");
{
  const K2 = { trai: 356.3, phai: 445.1, tren: 182.7, duoi: 245.3 }, CT = { rong: 37.7, cao: 18.5 };
  const KPI = { trai: 232, phai: 470, tren: 34, duoi: 254.3 }, KHUNG = { rong: 968, cao: 489 };
  for (const [ten, M] of [["CŨ", CU], ["MỚI", MOI]]) {
    const d = M.datNhanSaBan(K2, CT, [KPI], KHUNG, "tren");
    const h = hopTu(d, CT);
    const pc = Math.round((giao(h, KPI) / (CT.rong * CT.cao)) * 1000) / 10;
    console.log(`  ${ten.padEnd(4)}: ${JSON.stringify(d)} · bị thẻ Metrics ăn ${pc}% ⇒ ${pc === 0 ? "SẠCH TRỌN ✓" : "CÒN CHE ✗"}`);
  }
}
