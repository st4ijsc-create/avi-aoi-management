/**
 * n3-sim.mjs — MÔ PHỎNG NGOÀI TRANG, chạy TRƯỚC khi sửa một dòng mã nào.
 *
 *   node .qa-tapdoan/n3-sim.mjs
 *
 * Bốn hướng chủ đợt nêu, cộng một hướng của tôi, chấm bằng CÙNG một thước trên
 * CÙNG hình học đã đo (`n1-truoc.json` + `n2-hinh.json`), cho cả 5 vai có cụm:
 *
 *   A · "bê lớp né lớp phủ của `LopSaBan` sang 2D" — nguyên si: kiểm ĐIỂM NEO,
 *       trượt dọc tối đa 40 px.
 *   B · HỘP CHỮ + DANH SÁCH ỨNG VIÊN (hướng tôi đề xuất): kiểm TÂM HỘP CHỮ, thử
 *       lần lượt trên/trượt/dưới/trong/góc, hết thì ẩn + đếm ra.
 *   C · "cho khung nhìn biết vùng an toàn cũng ở 2D": ép sa bàn vào
 *       `vungDungCanvas` (giữa hai panel, trên dòng thời gian) rồi mới đặt nhãn.
 *   D · "khi chỉ có MỘT cụm thì tên công ty lên thanh tiêu đề cảnh".
 *
 * ★ Thước: một nhãn ĐỌC ĐƯỢC ⇔ được đặt (không bị ẩn) VÀ tâm hộp chữ không nằm
 *   trong lớp phủ nào. Đây là thước NGHIÊM hơn thước của sản phẩm hôm nay (sản
 *   phẩm kiểm ĐIỂM NEO = đáy nhãn), và chính chỗ lệch ấy là một phát hiện: ở
 *   `qatd_giamdoc` 3D có 2 nhãn toà được đếm là "vẽ" trong khi 65-68 % hộp chữ
 *   nằm dưới thẻ Metrics.
 */
import fs from "node:fs";

const N1 = JSON.parse(fs.readFileSync(".qa-tapdoan/n1-truoc.json", "utf8"));
const N2 = JSON.parse(fs.readFileSync(".qa-tapdoan/n2-hinh.json", "utf8"));
const VAI = ["qatd_giamdoc", "qatd_quanly", "qatd_kythuat", "qatd_congnhan", "qatd_admin"];

const KHE = 6;
const TRUOT_TOI_DA = 40; // hằng của `LopSaBan.tsx`
const LE_VUNG_DUNG = 28; // hằng `LE_VUNG_DUNG_PX` của `phamViCanh.ts`

/** Lớp phủ quy về gốc canvas/svg (cả hai chế độ dùng CÙNG khung 968×489 tại 1280×720). */
function lopPhuCuaVai(vai, che) {
  const nguon = che === "3d" ? N1.vai[vai].ba3D : N1.vai[vai].ba2D;
  const goc = che === "3d" ? N1.vai[vai].ba3D.hopCanvas : N1.vai[vai].ba2D.hopSvg;
  return nguon.lopPhu.map((p) => ({
    ten: p.ten,
    trai: p.x - goc.x,
    phai: p.x + p.w - goc.x,
    tren: p.y - goc.y,
    duoi: p.y + p.h - goc.y,
  }));
}

const chePhu = (vc, x, y) => vc.find((z) => x >= z.trai && x <= z.phai && y >= z.tren && y <= z.duoi) ?? null;

/** Tỉ lệ % diện tích hộp bị lớp phủ chiếm (tổng giao, không trừ chồng). */
function tyLeChe(vc, h) {
  const dt = (h.phai - h.trai) * (h.duoi - h.tren);
  if (!(dt > 0)) return 0;
  let s = 0;
  for (const z of vc) {
    const gx = Math.max(0, Math.min(h.phai, z.phai) - Math.max(h.trai, z.trai));
    const gy = Math.max(0, Math.min(h.duoi, z.duoi) - Math.max(h.tren, z.tren));
    s += gx * gy;
  }
  return Math.round((s / dt) * 1000) / 10;
}

/**
 * ───────── SP3D · ĐÚNG mã sản phẩm hôm nay (`LopSaBan.choDat`) ─────────
 * Nhãn toà neo bằng ĐÁY (`translate(-50%,-100%)`) tại `hop.tren - 4`; phép thử
 * che chạy trên ĐIỂM NEO ấy. Trả về TÂM HỘP CHỮ để mọi hướng được chấm chung
 * một thước — và chính chỗ lệch giữa "điểm neo" và "tâm hộp" là phát hiện: trượt
 * xuống `che.duoi + 6` đặt ĐÁY nhãn dưới thẻ, nên 2/3 hộp chữ vẫn nằm trên thẻ.
 */
function datSanPham3D(hop, co, vc, khung) {
  const x = (hop.trai + hop.phai) / 2;
  const y0 = hop.tren - 4;
  if (!chePhu(vc, x, y0)) return { x, y: y0 - co.cao / 2, ma: "neo" };
  const z = chePhu(vc, x, y0);
  for (const y of [z.duoi + KHE, z.tren - KHE]) {
    if (Math.abs(y - y0) > TRUOT_TOI_DA) continue;
    if (y < 0 || y > khung.cao) continue;
    if (!chePhu(vc, x, y)) return { x, y: y - co.cao / 2, ma: "truot" };
  }
  return null;
}

/**
 * ───────── A · "bê lớp né của `LopSaBan` sang 2D" — đọc theo nghĩa RỘNG NHẤT
 * (có lợi nhất cho hướng A): một ứng viên gốc + trượt dọc ≤ 40 px, chấm bằng
 * TÂM HỘP CHỮ. Nếu A vẫn hỏng ở cách đọc rộng nhất thì nó hỏng ở mọi cách đọc.
 */
function datA(hop, co, vc, khung) {
  const x = (hop.trai + hop.phai) / 2;
  const y0 = hop.tren - KHE - co.cao / 2;
  if (!chePhu(vc, x, y0)) return { x, y: y0, ma: "neo" };
  const z = chePhu(vc, x, y0);
  for (const y of [z.duoi + KHE + co.cao / 2, z.tren - KHE - co.cao / 2]) {
    if (Math.abs(y - y0) > TRUOT_TOI_DA) continue;
    if (y - co.cao / 2 < 0 || y + co.cao / 2 > khung.cao) continue;
    if (!chePhu(vc, x, y)) return { x, y, ma: "truot" };
  }
  return null;
}

/** Hộp chữ khi TÂM ở (x, y). */
const hopChu = (x, y, co) => ({ trai: x - co.rong / 2, phai: x + co.rong / 2, tren: y - co.cao / 2, duoi: y + co.cao / 2 });

/** ───────── B · HỘP CHỮ + DANH SÁCH ỨNG VIÊN ───────── */
function datB(hop, co, vc, khung) {
  const gx = (hop.trai + hop.phai) / 2;
  const trenY = hop.tren - KHE - co.cao / 2;
  const duoiY = hop.duoi + KHE + co.cao / 2;
  const ungVien = [
    ["tren-giua", gx, trenY],
    ["duoi-giua", gx, duoiY],
    ["trong-duoi", gx, hop.duoi - KHE - co.cao / 2],
    ["trong-tren", gx, hop.tren + KHE + co.cao / 2],
    ["tren-phai", hop.phai - co.rong / 2, trenY],
    ["tren-trai", hop.trai + co.rong / 2, trenY],
    ["duoi-phai", hop.phai - co.rong / 2, duoiY],
    ["duoi-trai", hop.trai + co.rong / 2, duoiY],
  ];
  // Trượt dọc khỏi ĐÚNG lớp phủ đang chắn ứng viên đầu — giữ luật cũ, nhưng theo TÂM HỘP.
  const z0 = chePhu(vc, gx, trenY);
  if (z0) {
    for (const y of [z0.duoi + KHE + co.cao / 2, z0.tren - KHE - co.cao / 2])
      if (Math.abs(y - trenY) <= TRUOT_TOI_DA) ungVien.splice(1, 0, ["truot", gx, y]);
  }
  for (const [ma, x, y] of ungVien) {
    const h = hopChu(x, y, co);
    if (h.trai < 0 || h.phai > khung.rong || h.tren < 0 || h.duoi > khung.cao) continue;
    if (chePhu(vc, x, y)) continue;
    return { x, y, ma };
  }
  return null;
}

/** Ánh xạ viewBox → px cho `preserveAspectRatio="xMidYMid meet"`. */
function anhXa2D(viewBox, svgPx) {
  const [vx, vy, vw, vh] = viewBox.split(/\s+/).map(Number);
  const s = Math.min(svgPx.w / vw, svgPx.h / vh);
  return {
    s,
    tx: (svgPx.w - vw * s) / 2 - vx * s,
    ty: (svgPx.h - vh * s) / 2 - vy * s,
    px: (x, y) => ({ x: (svgPx.w - vw * s) / 2 - vx * s + x * s, y: (svgPx.h - vh * s) / 2 - vy * s + y * s }),
  };
}

/** Vùng dùng được = giao(dải ngang không bị lớp phủ CAO SUỐT, dải dọc không bị lớp phủ RỘNG SUỐT). */
function vungDung(vc, khung) {
  const doanTrong = (tong, chan) => {
    const ds = chan.filter((d) => d.den > d.tu).sort((a, b) => a.tu - b.tu);
    let tot = null;
    let moc = 0;
    const xet = (tu, den) => {
      if (den - tu > (tot ? tot.den - tot.tu : 0)) tot = { tu, den };
    };
    for (const d of ds) {
      if (d.tu > moc) xet(moc, d.tu);
      if (d.den > moc) moc = d.den;
    }
    if (moc < tong) xet(moc, tong);
    return tot;
  };
  const ng = doanTrong(
    khung.rong,
    vc.filter((z) => z.tren <= 0 && z.duoi >= khung.cao).map((z) => ({ tu: z.trai, den: z.phai })),
  );
  const dc = doanTrong(
    khung.cao,
    vc.filter((z) => z.trai <= 0 && z.phai >= khung.rong).map((z) => ({ tu: z.tren, den: z.duoi })),
  );
  return { trai: ng.tu, phai: ng.den, tren: dc.tu, duoi: dc.den };
}

const bang = [];
for (const vai of VAI) {
  const g = N2[vai];
  const khung = { rong: g.svgPx.w, cao: g.svgPx.h };
  const vc2 = lopPhuCuaVai(vai, "2d");
  const vc3 = lopPhuCuaVai(vai, "3d");
  const m = anhXa2D(g.viewBox, g.svgPx);

  // Hộp MÀN HÌNH của tấm nền cụm & khối toà ở chế độ 2D (bố cục hiện tại).
  const padHienTai = g.cum.map((c) => {
    const a = m.px(c.x, c.y);
    return { factoryId: c.factoryId, trai: a.x, phai: a.x + c.w * m.s, tren: a.y, duoi: a.y + c.h * m.s };
  });
  const toaHienTai = g.toa.map((t) => {
    const a = m.px(t.x, t.y);
    return { toaNhaId: t.toaNhaId, trai: a.x, phai: a.x + t.w * m.s, tren: a.y, duoi: a.y + t.h * m.s };
  });
  // Cỡ hộp chữ THẬT đã đo trên trình duyệt (n1) — không ước lượng.
  const n1c = N1.vai[vai].ba2D.nhanCum;
  const n1t = N1.vai[vai].ba2D.nhanToa;
  const coCum = { rong: n1c[0]?.hop.w ?? 60, cao: n1c[0]?.hop.h ?? 16 };
  const coToa = { rong: n1t[0]?.hop.w ?? 40, cao: n1t[0]?.hop.h ?? 14 };

  // ── Hướng C: ép sa bàn vào vùng dùng (giữ nguyên tỉ lệ), rồi đặt nhãn kiểu B.
  const vung = vungDung(vc2, khung);
  const bbox = g.cum.reduce(
    (o, c) => ({
      trai: Math.min(o.trai, c.x),
      phai: Math.max(o.phai, c.x + c.w),
      tren: Math.min(o.tren, c.y),
      duoi: Math.max(o.duoi, c.y + c.h),
    }),
    { trai: Infinity, phai: -Infinity, tren: Infinity, duoi: -Infinity },
  );
  const rongDung = vung.phai - vung.trai - 2 * LE_VUNG_DUNG;
  const caoDung = vung.duoi - vung.tren - 2 * LE_VUNG_DUNG;
  const sC = Math.min(rongDung / (bbox.phai - bbox.trai), caoDung / (bbox.duoi - bbox.tren));
  const tamX = (vung.trai + vung.phai) / 2;
  const dayY = vung.duoi - LE_VUNG_DUNG;
  const pxC = (x, y) => ({
    x: tamX + (x - (bbox.trai + bbox.phai) / 2) * sC,
    y: dayY - (bbox.duoi - y) * sC,
  });
  const padC = g.cum.map((c) => {
    const a = pxC(c.x, c.y);
    return { factoryId: c.factoryId, trai: a.x, phai: a.x + c.w * sC, tren: a.y, duoi: a.y + c.h * sC };
  });
  const toaC = g.toa.map((t) => {
    const a = pxC(t.x, t.y);
    return { toaNhaId: t.toaNhaId, trai: a.x, phai: a.x + t.w * sC, tren: a.y, duoi: a.y + t.h * sC };
  });

  const dem = (ds, co, ham, vc) => {
    const ra = ds.map((h) => ({ h, dat: ham(h, co, vc, khung) }));
    const ok = ra.filter((r) => r.dat && !chePhu(vc, r.dat.x, r.dat.y));
    return { docDuoc: ok.length, tong: ds.length, chiTiet: ra };
  };

  const rongToa2D = toaHienTai.length ? Math.min(...toaHienTai.map((t) => t.phai - t.trai)) : 0;
  const rongToaC = toaC.length ? Math.min(...toaC.map((t) => t.phai - t.trai)) : 0;

  const A = dem(padHienTai, coCum, datA, vc2);
  const B = dem(padHienTai, coCum, datB, vc2);
  const C = dem(padC, coCum, datB, vc2);
  const Bt = dem(toaHienTai, coToa, datB, vc2);

  // ── 3D: nhãn toà (hộp khối đã đo), mã sản phẩm hôm nay vs hướng B.
  const khoi3D = N1.vai[vai].ba3D.hopBieuTuong.map((b) => b.hop);
  const co3D = { rong: 37.7, cao: 18.5 };
  const A3 = dem(khoi3D, co3D, datSanPham3D, vc3);
  const B3 = dem(khoi3D, co3D, datB, vc3);

  bang.push({ vai, A, B, C, Bt, A3, B3, rongToa2D, rongToaC, sC, vung });

  console.log(`\n══════ ${vai} ══════  (vùng dùng 2D = x ${Math.round(vung.trai)}..${Math.round(vung.phai)}, y ${Math.round(vung.tren)}..${Math.round(vung.duoi)})`);
  console.log(
    `  2D TÊN CÔNG TY đọc được:  A(né 3D nguyên si) ${A.docDuoc}/${A.tong}` +
      `  ·  B(hộp chữ + ứng viên) ${B.docDuoc}/${B.tong}` +
      `  ·  C(ép vào vùng dùng + B) ${C.docDuoc}/${C.tong}`,
  );
  console.log(`  2D bề rộng toà nhỏ nhất: hiện tại ${Math.round(rongToa2D * 10) / 10} px → hướng C ${Math.round(rongToaC * 10) / 10} px (trần ≥ 24)`);
  console.log(`  2D nhãn toà (hướng B): ${Bt.docDuoc}/${Bt.tong} đọc được`);
  console.log(`  3D nhãn toà: SP(mã sản phẩm hôm nay) ${A3.docDuoc}/${A3.tong}  ·  B ${B3.docDuoc}/${B3.tong}`);
  for (const r of B.chiTiet)
    console.log(
      `     cụm ${r.h.factoryId}: A=${JSON.stringify(A.chiTiet.find((q) => q.h === r.h)?.dat?.ma ?? null)}` +
        ` B=${r.dat ? r.dat.ma + "@" + Math.round(r.dat.x) + "," + Math.round(r.dat.y) : "ẨN"}`,
    );
}

fs.writeFileSync(".qa-tapdoan/n3-sim.json", JSON.stringify(bang, null, 1));
console.log("\n→ .qa-tapdoan/n3-sim.json");
console.log("\n╔══ TỔNG (tên công ty đọc được / tổng cụm) ══╗");
console.log("vai".padEnd(16), "2D-hiện", "2D-A", "2D-B", "2D-C", "| 3D-toà SP", "3D-toà B");
for (const b of bang) {
  const hienTai = N1.vai[b.vai].tomTat.tenCongTyDocDuoc2D;
  console.log(
    b.vai.padEnd(16),
    `${hienTai}/${b.A.tong}`.padEnd(8),
    `${b.A.docDuoc}/${b.A.tong}`.padEnd(5),
    `${b.B.docDuoc}/${b.B.tong}`.padEnd(5),
    `${b.C.docDuoc}/${b.C.tong}`.padEnd(5),
    `| ${b.A3.docDuoc}/${b.A3.tong}`.padEnd(10),
    `${b.B3.docDuoc}/${b.B3.tong}`,
  );
}
