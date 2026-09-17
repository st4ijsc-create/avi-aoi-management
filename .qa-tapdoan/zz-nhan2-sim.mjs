/**
 * zz-nhan2-sim.mjs — BƯỚC 2: MÔ PHỎNG TRÊN HÌNH HỌC ĐÃ ĐO, TRƯỚC KHI SỬA MÃ.
 *
 * Nạp CHÍNH `datNhanSaBan.ts` (bundle bằng esbuild) rồi phát lại trên hình học
 * đo được ở `zz-nhan2-do1-truoc.json`.
 *
 * ★★★ CỔNG TỰ-KIỂM (đối chứng dương biết kêu): biến thể **V0 = luật hiện hành**
 *   phải TÁI HIỆN đúng chỗ đặt ĐÃ ĐO. Lệch một nhãn ⇒ mô phỏng SAI ⇒ mọi kết
 *   luận rút từ nó đều vứt. In số ca so được, cấm kết luận trên tập rỗng.
 *
 * Quy ước toạ độ: `datNhanSaBan` làm việc trong hệ GỐC CANVAS/SVG (xem
 * `layVungCam`), nên mọi hộp đo bằng `getBoundingClientRect` (hệ TRANG) đều trừ
 * đi gốc canvas trước khi nạp.
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const NGUON = ".qa-tapdoan/zz-nhan2-do1-truoc.json";
const TAM = ".qa-tapdoan/zz-nhan2-datnhan.mjs";
execFileSync(
  "npx",
  [
    "esbuild",
    "client/src/components/twin3d/van-hanh/datNhanSaBan.ts",
    "--format=esm",
    "--bundle",
    `--outfile=${TAM}`,
  ],
  { stdio: "pipe", shell: true },
);
const { datNhanSaBan, KHE_NHAN_PX, TRUOT_TOI_DA_PX } = await import("./zz-nhan2-datnhan.mjs");
console.log(`nạp datNhanSaBan thật: KHE=${KHE_NHAN_PX} TRƯỢT_TỐI_ĐA=${TRUOT_TOI_DA_PX}`);

const J = JSON.parse(fs.readFileSync(NGUON, "utf8"));

/** Đổi hộp hệ TRANG → hệ GỐC CANVAS, và áp đúng phép loại của `layVungCam`. */
function vungCamTu(lopPhu, goc, khung) {
  const ra = [];
  for (const p of lopPhu) {
    const h = { trai: p.trai - goc.trai, phai: p.phai - goc.trai, tren: p.tren - goc.tren, duoi: p.duoi - goc.tren };
    if (h.phai <= 0 || h.duoi <= 0 || h.trai >= khung.rong || h.tren >= khung.cao) continue;
    ra.push({ ...h, ten: p.ten });
  }
  return ra;
}
const doi = (b, goc) => ({ trai: b.trai - goc.trai, phai: b.phai - goc.trai, tren: b.tren - goc.tren, duoi: b.duoi - goc.tren });
const giao = (a, b) => {
  const gx = Math.max(0, Math.min(a.phai, b.phai) - Math.max(a.trai, b.trai));
  const gy = Math.max(0, Math.min(a.duoi, b.duoi) - Math.max(a.tren, b.tren));
  return gx * gy;
};
const hopTu = (d, co) => ({ trai: d.x - co.rong / 2, phai: d.x + co.rong / 2, tren: d.y - co.cao / 2, duoi: d.y + co.cao / 2 });

/** Dựng danh sách mục cho một (vai, chế độ) — ĐÚNG thứ tự sản phẩm đặt: CỤM trước, TOÀ sau. */
function dungMuc(vai, cheDo) {
  const v = J.vai[vai];
  const goc = cheDo === "2d" ? v.d2.hopSvg : v.d3.hopCanvas;
  const khung = { rong: goc.w, cao: goc.h };
  const lopPhu = cheDo === "2d" ? v.d2.lopPhu : v.d3.lopPhu;
  const vungCam = vungCamTu(lopPhu, goc, khung);
  const muc = [];
  if (cheDo === "2d") {
    const nc = new Map(v.d2.nhanCum.map((n) => [n.factoryId, n]));
    for (const c of v.d2.cum) {
      const f = Number(c["data-factory-id"]);
      const n = nc.get(f);
      muc.push({ khoa: `cum-${f}`, chu: n.chu, hop: doi(c.hopPx, goc), co: { rong: n.hopPx.w, cao: n.hopPx.h }, uuTien: "tren", doDuoc: n });
    }
    const nt = new Map(v.d2.nhanToa.map((n) => [n.toaNhaId, n]));
    for (const t of v.d2.toa) {
      const id = Number(t["data-toa-nha-id"]);
      const n = nt.get(id);
      muc.push({ khoa: `toa-${id}`, chu: n.chu, hop: doi(t.hopPx, goc), co: { rong: n.hopPx.w, cao: n.hopPx.h }, uuTien: "trong", doDuoc: n });
    }
  } else {
    // 3D: nhãn CỤM neo bằng `diem`+bề rộng tấm nền chiếu — KHÔNG đo được từ DOM.
    // ⇒ nạp thẳng hộp nhãn cụm ĐÃ ĐO làm `daDat` (chính xác hơn mô phỏng lại), và
    //   chỉ mô phỏng nhãn TOÀ. Nói rõ ra để không ai tưởng cụm cũng được phát lại.
    const nt = new Map();
    for (const n of v.d3.nhanToa) {
      const k = `${n.toaNhaId}`;
      if (!nt.has(k)) nt.set(k, n);
    }
    const coToa = (() => {
      const hien = v.d3.nhanToa.filter((n) => !n.an && n.hop);
      const w = hien.map((n) => n.hop.w).sort((a, b) => a - b);
      const h = hien.map((n) => n.hop.h).sort((a, b) => a - b);
      return { rong: w[Math.floor(w.length / 2)], cao: h[Math.floor(h.length / 2)], mau: hien.length,
        dongNhat: w[0] === w[w.length - 1] && h[0] === h[h.length - 1] };
    })();
    for (const b of v.d3.hopBieuTuong) {
      const n = nt.get(`${b.toaNhaId}`);
      muc.push({ khoa: `toa-${b.toaNhaId}`, chu: n ? n.chu : "?", hop: b.hop, co: { rong: coToa.rong, cao: coToa.cao }, uuTien: "tren", doDuoc: n });
    }
    muc.coToa = coToa;
    muc.daDatSan = v.d3.nhanCum.filter((n) => !n.an && n.hop).map((n) => doi(n.hop, goc));
  }
  return { muc, vungCam, khung, goc, lopPhu };
}

/** Phát lại luật đặt nhãn cho một (vai, chế độ) với một hàm `dat` cho trước. */
function chay(vai, cheDo, dat) {
  const { muc, vungCam, khung, goc } = dungMuc(vai, cheDo);
  const daDat = [...(muc.daDatSan ?? [])];
  const ra = [];
  let ve = 0;
  let an = 0;
  for (const m of muc) {
    const d = dat(m.hop, m.co, [...vungCam, ...daDat], khung, m.uuTien);
    if (d === null) {
      an += 1;
      ra.push({ ...m, ket: null });
      continue;
    }
    ve += 1;
    const hn = hopTu(d, m.co);
    if (m.co.rong > 0 && m.co.cao > 0) daDat.push(hn);
    const dt = m.co.rong * m.co.cao;
    let che = 0;
    for (const z of vungCam) che += giao(hn, z);
    ra.push({ ...m, ket: d, hopNhan: hn, tyLeChe: dt > 0 ? Math.round((che / dt) * 1000) / 10 : 0 });
  }
  return { ra, ve, an, tong: muc.length, vungCam, khung, goc, coToa: muc.coToa };
}

// ══════════════════════════════════════════════════════════════════════════
// CỔNG TỰ-KIỂM: V0 (luật hiện hành) phải tái hiện chỗ đặt ĐÃ ĐO
// ══════════════════════════════════════════════════════════════════════════
const CA = [
  ["qatd_admin", "2d"],
  ["qatd_kythuat", "2d"],
  ["qatd_admin", "3d"],
  ["qatd_kythuat", "3d"],
];
console.log("\n══════════ CỔNG TỰ-KIỂM — V0 phải tái hiện phép đo ══════════");
let soSo = 0;
let soLech = 0;
for (const [vai, cheDo] of CA) {
  const { ra, ve, an, tong, goc, coToa } = chay(vai, cheDo, datNhanSaBan);
  if (coToa)
    console.log(
      `  [${vai}/${cheDo}] cỡ nhãn toà lấy TRUNG VỊ của ${coToa.mau} nhãn hiện = ${coToa.rong}×${coToa.cao}` +
        ` (đồng nhất: ${coToa.dongNhat ? "CÓ" : "KHÔNG ⚠"})`,
    );
  let lech = 0;
  let so = 0;
  for (const r of ra) {
    if (!r.doDuoc) continue;
    const anDo = r.doDuoc.an;
    const anSim = r.ket === null;
    so += 1;
    if (anDo !== anSim) {
      lech += 1;
      console.log(`    ✗ ${vai}/${cheDo} "${r.chu}" ẩn đo=${anDo} sim=${anSim}`);
      continue;
    }
    if (anDo) continue;
    const hd = doi(cheDo === "2d" ? r.doDuoc.hopPx : r.doDuoc.hop, goc);
    const dx = Math.abs((hd.trai + hd.phai) / 2 - r.ket.x);
    const dy = Math.abs((hd.tren + hd.duoi) / 2 - r.ket.y);
    if (dx > 1.5 || dy > 1.5) {
      lech += 1;
      console.log(
        `    ✗ ${vai}/${cheDo} "${r.chu}" tâm đo=(${((hd.trai + hd.phai) / 2).toFixed(1)},${((hd.tren + hd.duoi) / 2).toFixed(1)})` +
          ` sim=(${r.ket.x.toFixed(1)},${r.ket.y.toFixed(1)}) mã=${r.ket.ma} Δ=(${dx.toFixed(1)},${dy.toFixed(1)})`,
      );
    }
  }
  soSo += so;
  soLech += lech;
  console.log(`  [${vai}/${cheDo}] so ${so} nhãn · lệch ${lech} · sim {ve:${ve},an:${an},tong:${tong}}`);
}
console.log(`\nTỔNG: so ${soSo} nhãn · lệch ${soLech}`);
if (soSo === 0) {
  console.log("⛔ TẬP RỖNG — mô phỏng không so được gì. DỪNG.");
  process.exit(1);
}
if (soLech > 0) console.log("⛔ MÔ PHỎNG KHÔNG TÁI HIỆN PHÉP ĐO — không được rút kết luận nào từ nó.");
else console.log("✓ Mô phỏng tái hiện đúng phép đo ⇒ dùng được để thử hướng vá.");

// ══════════════════════════════════════════════════════════════════════════
// PHÉP CHIA NGÂN SÁCH CHỖ — admin 2D
// ══════════════════════════════════════════════════════════════════════════
console.log("\n══════════ NGÂN SÁCH CHỖ — admin 2D, nhãn CỤM ══════════");
{
  const { muc, vungCam, khung } = dungMuc("qatd_admin", "2d");
  // Panel CAO SUỐT KHUNG = thứ mà mọi phép trượt DỌC đều bất lực.
  const caoSuot = vungCam.filter((z) => z.tren <= 0.5 && z.duoi >= khung.cao - 0.5);
  console.log(`  lớp phủ CAO SUỐT KHUNG: ${caoSuot.map((z) => `${z.ten}[${z.trai}..${z.phai}]`).join(", ") || "—"}`);
  for (const m of muc.filter((x) => x.khoa.startsWith("cum-"))) {
    // Dải NGANG của tấm nền KHÔNG nằm dưới panel cao-suốt-khung.
    let dai = [{ a: m.hop.trai, b: m.hop.phai }];
    for (const z of caoSuot) {
      const moi = [];
      for (const d of dai) {
        if (z.phai <= d.a || z.trai >= d.b) { moi.push(d); continue; }
        if (z.trai > d.a) moi.push({ a: d.a, b: Math.min(z.trai, d.b) });
        if (z.phai < d.b) moi.push({ a: Math.max(z.phai, d.a), b: d.b });
      }
      dai = moi;
    }
    const rongNhat = dai.reduce((s, d) => Math.max(s, d.b - d.a), 0);
    const du = rongNhat - m.co.rong;
    console.log(
      `  "${m.chu}" nền rộng ${(m.hop.phai - m.hop.trai).toFixed(1)} · dải SẠCH rộng nhất ${rongNhat.toFixed(1)}` +
        ` · nhãn rộng ${m.co.rong.toFixed(1)} ⇒ ${du >= 0 ? `CÒN ${du.toFixed(1)} px` : `THIẾU ${(-du).toFixed(1)} px`}` +
        ` ${du >= 0 ? "" : "⇒ BẤT KHẢ nếu nhãn phải bám nền của chính nó"}`,
    );
  }
}

// ══════════════════════════════════════════════════════════════════════════
// V1 — ĐỀ XUẤT: trần trượt đo từ CHÍNH ỨNG VIÊN mà phép trượt cứu,
//      và MỌI neo chính đều được sinh ứng viên trượt (không chỉ neo đầu).
// ══════════════════════════════════════════════════════════════════════════
const chePhu = (vc, x, y) => vc.find((z) => x >= z.trai && x <= z.phai && y >= z.tren && y <= z.duoi) ?? null;
function giaoLopPhu(vc, x, y, co) {
  const t = x - co.rong / 2, p = x + co.rong / 2, tr = y - co.cao / 2, d = y + co.cao / 2;
  return vc.find((z) => z.trai < p && z.phai > t && z.tren < d && z.duoi > tr) ?? null;
}
function danhSach(hop, co, uuTien) {
  const gX = (hop.trai + hop.phai) / 2, gY = (hop.tren + hop.duoi) / 2;
  const nC = co.cao / 2, nR = co.rong / 2;
  const yT = hop.tren - KHE_NHAN_PX - nC, yD = hop.duoi + KHE_NHAN_PX + nC;
  const oT = ["tren-giua", gX, yT], oD = ["duoi-giua", gX, yD], oI = ["trong-giua", gX, gY];
  const dau = uuTien === "tren" ? [oT, oD] : uuTien === "duoi" ? [oD, oT] : [oI, oT, oD];
  return { dau, duoi: [
    ["trong-duoi", gX, hop.duoi - KHE_NHAN_PX - nC], ["trong-tren", gX, hop.tren + KHE_NHAN_PX + nC],
    ["tren-phai", hop.phai - nR, yT], ["tren-trai", hop.trai + nR, yT],
    ["duoi-phai", hop.phai - nR, yD], ["duoi-trai", hop.trai + nR, yD]] };
}
function datV1(hop, co, vungCam, khung, uuTien, vet) {
  const { dau, duoi } = danhSach(hop, co, uuTien);
  const [maDau, xDau, yDau] = dau[0];
  if (!(khung.rong > 0) || !(khung.cao > 0)) return { x: xDau, y: yDau, ma: maDau };
  const ungVien = [];
  for (const uv of dau) {
    ungVien.push(uv);
    const [, x, y] = uv;
    const them = [];
    const themTruot = (z) => {
      if (!z) return;
      // ★ Trần đo từ `y` của CHÍNH ứng viên này, không từ neo ưu tiên.
      for (const yy of [z.duoi + KHE_NHAN_PX + co.cao / 2, z.tren - KHE_NHAN_PX - co.cao / 2])
        if (Math.abs(yy - y) <= TRUOT_TOI_DA_PX) them.push(["truot", x, yy]);
    };
    const ch = giaoLopPhu(vungCam, x, y, co);
    themTruot(ch);
    const ct = chePhu(vungCam, x, y);
    if (ct && ct !== ch) themTruot(ct);
    ungVien.push(...them);
  }
  ungVien.push(...duoi);
  const trongKhung = (x, y) => x >= 0 && x <= khung.rong && y >= 0 && y <= khung.cao;
  for (const [ma, x, y] of ungVien) {
    if (vet) vet.push([ma, +x.toFixed(1), +y.toFixed(1), !trongKhung(x, y) ? "NGOÀI KHUNG" : giaoLopPhu(vungCam, x, y, co) ? "giao:" + (giaoLopPhu(vungCam, x, y, co).ten ?? "nhãn-đã-đặt") : "SẠCH TRỌN"]);
    if (!trongKhung(x, y)) continue;
    if (giaoLopPhu(vungCam, x, y, co)) continue;
    return { x, y, ma };
  }
  for (const [ma, x, y] of ungVien) {
    if (!trongKhung(x, y)) continue;
    if (chePhu(vungCam, x, y)) continue;
    return { x, y, ma };
  }
  return null;
}

console.log("\n══════════ VẾT ỨNG VIÊN — vì sao luật HIỆN HÀNH không thoát ══════════");
for (const [vai, cheDo, ten] of [["qatd_kythuat", "3d", "Toà 2"], ["qatd_admin", "2d", "Nhà máy ảo (SIM)"], ["qatd_admin", "2d", "Công ty A"]]) {
  const { muc, vungCam, khung } = dungMuc(vai, cheDo);
  const daDat = [...(muc.daDatSan ?? [])];
  for (const m of muc) {
    const vet = [];
    const d = datV1(m.hop, m.co, [...vungCam, ...daDat], khung, m.uuTien, m.chu === ten ? vet : null);
    if (m.chu === ten) {
      console.log(`\n  [${vai}/${cheDo}] "${ten}" nền=[${m.hop.trai.toFixed(1)}..${m.hop.phai.toFixed(1)}]×[${m.hop.tren.toFixed(1)}..${m.hop.duoi.toFixed(1)}] nhãn=${m.co.rong}×${m.co.cao} ưuTiên=${m.uuTien}`);
      for (const [ma, x, y, kq] of vet) console.log(`     ${ma.padEnd(12)} (${String(x).padStart(7)},${String(y).padStart(7)})  ${kq}`);
      break;
    }
    if (d && m.co.rong > 0) daDat.push(hopTu(d, m.co));
  }
}

console.log("\n══════════ SO V0 (hiện hành) vs V1 (đề xuất) ══════════");
let tongCheV0 = 0, tongCheV1 = 0, tongNhan = 0;
for (const [vai, cheDo] of CA) {
  const a = chay(vai, cheDo, datNhanSaBan);
  const b = chay(vai, cheDo, (h, c, v, k, u) => datV1(h, c, v, k, u, null));
  const cheA = a.ra.filter((r) => r.ket && r.tyLeChe > 0);
  const cheB = b.ra.filter((r) => r.ket && r.tyLeChe > 0);
  tongCheV0 += cheA.length; tongCheV1 += cheB.length; tongNhan += a.tong;
  console.log(
    `  [${vai}/${cheDo}] V0 {ve:${a.ve},an:${a.an}} che-một-phần ${cheA.length} → V1 {ve:${b.ve},an:${b.an}} che-một-phần ${cheB.length}` +
      `  ‖ ve+an===tong: V0 ${a.ve + a.an === a.tong ? "✓" : "✗"} V1 ${b.ve + b.an === b.tong ? "✓" : "✗"}`,
  );
  for (const r of cheA) console.log(`      V0 che "${r.chu}" ${r.tyLeChe}%`);
  for (const r of cheB) console.log(`      V1 che "${r.chu}" ${r.tyLeChe}%`);
  // HỒI QUY: nhãn nào V0 SẠCH mà V1 hoá che/ẩn?
  for (let i = 0; i < a.ra.length; i++) {
    const x = a.ra[i], y = b.ra[i];
    const sachX = x.ket && x.tyLeChe === 0, sachY = y.ket && y.tyLeChe === 0;
    if (sachX && !sachY) console.log(`      ⚠ HỒI QUY "${x.chu}": V0 sạch → V1 ${y.ket ? y.tyLeChe + "% che" : "ẨN"}`);
    if (!x.ket && y.ket) console.log(`      + CỨU "${x.chu}": V0 ẩn → V1 ${y.tyLeChe}% che`);
    if (x.ket && !y.ket) console.log(`      ⚠ MẤT "${x.chu}": V0 vẽ → V1 ẨN`);
  }
}
console.log(`\n  TỔNG 4 ca: nhãn ${tongNhan} · che-một-phần V0 ${tongCheV0} → V1 ${tongCheV1}`);

console.log("\n══════════ VẾT: 4 nhãn admin/2D còn che một phần ══════════");
{
  const { muc, vungCam, khung } = dungMuc("qatd_admin", "2d");
  const caoSuot = vungCam.filter((z) => z.tren <= 0.5 && z.duoi >= khung.cao - 0.5);
  const daDat = [];
  for (const m of muc) {
    const quanTam = ["Công ty B", "Toà 1", "Toà 3", "Toà 4"].includes(m.chu);
    const vet = [];
    const d = datV1(m.hop, m.co, [...vungCam, ...daDat], khung, m.uuTien, quanTam ? vet : null);
    if (quanTam) {
      // dải NGANG sạch panel cao-suốt-khung của CHÍNH hộp này
      let dai = [{ a: m.hop.trai, b: m.hop.phai }];
      for (const z of caoSuot) {
        const moi = [];
        for (const g of dai) {
          if (z.phai <= g.a || z.trai >= g.b) { moi.push(g); continue; }
          if (z.trai > g.a) moi.push({ a: g.a, b: Math.min(z.trai, g.b) });
          if (z.phai < g.b) moi.push({ a: Math.max(z.phai, g.a), b: g.b });
        }
        dai = moi;
      }
      const rongNhat = dai.reduce((s, g) => Math.max(s, g.b - g.a), 0);
      console.log(`\n  "${m.chu}" hộp=[${m.hop.trai.toFixed(1)}..${m.hop.phai.toFixed(1)}] nhãn rộng ${m.co.rong}` +
        ` · dải sạch panel rộng nhất ${rongNhat.toFixed(1)} ⇒ ${rongNhat >= m.co.rong ? "CÓ THỂ vừa" : `THIẾU ${(m.co.rong - rongNhat).toFixed(1)} px ⇒ BẤT KHẢ`}`);
      for (const [ma, x, y, kq] of vet) console.log(`     ${ma.padEnd(12)} (${String(x).padStart(7)},${String(y).padStart(7)})  ${kq}`);
    }
    if (d && m.co.rong > 0) daDat.push(hopTu(d, m.co));
  }
}

// ══════════════════════════════════════════════════════════════════════════
// V2 — trượt DỒN XUỐNG CUỐI (sau `phu`). Phương án NHỎ HƠN V1: nó không đổi
//      thứ hạng của bất kỳ ứng viên cũ nào, chỉ THÊM chỗ ở cuối hàng.
// ══════════════════════════════════════════════════════════════════════════
function datV2(hop, co, vungCam, khung, uuTien) {
  const { dau, duoi: phu } = danhSach(hop, co, uuTien);
  const [maDau, xDau, yDau] = dau[0];
  if (!(khung.rong > 0) || !(khung.cao > 0)) return { x: xDau, y: yDau, ma: maDau };
  const ungVien = [], truot = [];
  for (const uv of dau) {
    ungVien.push(uv);
    const [, x, y] = uv;
    const themTruot = (z) => {
      if (!z) return;
      for (const yy of [z.duoi + KHE_NHAN_PX + co.cao / 2, z.tren - KHE_NHAN_PX - co.cao / 2])
        if (Math.abs(yy - y) <= TRUOT_TOI_DA_PX) truot.push(["truot", x, yy]);
    };
    const ch = giaoLopPhu(vungCam, x, y, co);
    themTruot(ch);
    const ct = chePhu(vungCam, x, y);
    if (ct && ct !== ch) themTruot(ct);
  }
  ungVien.push(...phu, ...truot);
  const trongKhung = (x, y) => x >= 0 && x <= khung.rong && y >= 0 && y <= khung.cao;
  for (const [ma, x, y] of ungVien) { if (!trongKhung(x, y)) continue; if (giaoLopPhu(vungCam, x, y, co)) continue; return { x, y, ma }; }
  for (const [ma, x, y] of ungVien) { if (!trongKhung(x, y)) continue; if (chePhu(vungCam, x, y)) continue; return { x, y, ma }; }
  return null;
}

console.log("\n══════════ CỔNG TỰ-KIỂM V2 — có tái hiện phép đo baseline không? ══════════");
let soSoV2 = 0, soLechV2 = 0;
for (const [vai, cheDo] of CA) {
  const { ra, goc } = chay(vai, cheDo, datV2);
  let lech = 0, so = 0;
  for (const r of ra) {
    if (!r.doDuoc) continue;
    so += 1;
    const anDo = r.doDuoc.an, anSim = r.ket === null;
    // "Toà 2"/"Toà 1" là hai nhãn bản vá CỐ Ý đổi — tách riêng, không tính là lệch.
    const coYDoi = (vai === "qatd_kythuat" && ((cheDo === "3d" && ["Toà 2", "Toà 1"].includes(r.chu)) || (cheDo === "2d" && r.chu === "Toà 2")));
    if (anDo !== anSim) { if (!coYDoi) { lech += 1; console.log(`    ✗ ${vai}/${cheDo} "${r.chu}" ẩn đo=${anDo} sim=${anSim}`); } continue; }
    if (anDo) continue;
    const hd = doi(cheDo === "2d" ? r.doDuoc.hopPx : r.doDuoc.hop, goc);
    const dx = Math.abs((hd.trai + hd.phai) / 2 - r.ket.x), dy = Math.abs((hd.tren + hd.duoi) / 2 - r.ket.y);
    if (dx > 1.5 || dy > 1.5) {
      if (coYDoi) { console.log(`    ↻ CỐ Ý ĐỔI ${vai}/${cheDo} "${r.chu}" → mã=${r.ket.ma}`); continue; }
      lech += 1;
      console.log(`    ✗ ${vai}/${cheDo} "${r.chu}" tâm đo=(${((hd.trai+hd.phai)/2).toFixed(1)},${((hd.tren+hd.duoi)/2).toFixed(1)}) sim=(${r.ket.x.toFixed(1)},${r.ket.y.toFixed(1)}) mã=${r.ket.ma}`);
    }
  }
  soSoV2 += so; soLechV2 += lech;
  console.log(`  [${vai}/${cheDo}] so ${so} · lệch NGOÀI Ý ĐỊNH ${lech}`);
}
console.log(`TỔNG V2: so ${soSoV2} · lệch ngoài ý định ${soLechV2} ⇒ ${soLechV2 === 0 ? "✓ chỉ đổi đúng thứ định đổi" : "⛔ có đổi ngoài ý định"}`);

console.log("\n══════════ BẢNG CUỐI — V0 / V1 / V2 ══════════");
let t0 = 0, t1 = 0, t2 = 0, tn = 0;
for (const [vai, cheDo] of CA) {
  const a = chay(vai, cheDo, datNhanSaBan);
  const b = chay(vai, cheDo, (h, c, v, k, u) => datV1(h, c, v, k, u, null));
  const c2 = chay(vai, cheDo, datV2);
  const n = (r) => r.ra.filter((x) => x.ket && x.tyLeChe > 0).length;
  t0 += n(a); t1 += n(b); t2 += n(c2); tn += a.tong;
  console.log(`  [${vai}/${cheDo}] che-một-phần  V0 ${n(a)} · V1 ${n(b)} · V2 ${n(c2)}   ‖ ẩn V0 ${a.an} · V1 ${b.an} · V2 ${c2.an}` +
    `  ‖ ve+an===tong V2 ${c2.ve + c2.an === c2.tong ? "✓" : "✗"}`);
}
console.log(`  TỔNG 4 ca (${tn} nhãn): che-một-phần V0 ${t0} · V1 ${t1} · V2 ${t2}`);
