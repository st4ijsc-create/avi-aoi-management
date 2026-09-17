/**
 * zz-nhan2-so.mjs — SO NỀN vs SAU VÁ trên CÙNG bộ thước, in cả hai số.
 * Nền = `.qa-tapdoan/n1-zf-sau.json` (bản `de1dc50a` đang phục vụ).
 * Sau  = `.qa-tapdoan/n1-zz-sau2.json`.
 */
import fs from "node:fs";
const A = JSON.parse(fs.readFileSync(".qa-tapdoan/n1-zf-sau.json", "utf8"));
const B = JSON.parse(fs.readFileSync(".qa-tapdoan/n1-zz-sau2.json", "utf8"));
const VAI = Object.keys(A.vai);

/** Một nhãn "hiện mà bị che một phần" = không ẩn, tyLeChe > 0. */
const cheMotPhan = (ds) => (ds || []).filter((n) => !n.an && n.tyLeChe > 0);
const hien = (ds) => (ds || []).filter((n) => !n.an);

function gom(J) {
  let tong = 0, che = 0;
  const chiTiet = [];
  for (const vai of VAI) {
    const o = J.vai[vai];
    if (!o || !o.tomTat) continue;
    for (const [cd, ba] of [["3d", o.ba3D], ["2d", o.ba2D]]) {
      if (!ba || (cd === "2d" && !ba.coSvg)) continue;
      const ds = [...(ba.nhanCum || []), ...(ba.nhanToa || [])];
      tong += hien(ds).length;
      for (const n of cheMotPhan(ds)) { che += 1; chiTiet.push(`${vai}/${cd} "${n.chu}" ${n.tyLeChe}%`); }
    }
  }
  return { tong, che, chiTiet };
}
const gA = gom(A), gB = gom(B);
console.log("══════════ TOÀN CỤC — nhãn HIỆN mà bị che một phần (thước SẠCH TRỌN) ══════════");
console.log(`  NỀN  : ${gA.che}/${gA.tong} = ${((gA.che / gA.tong) * 100).toFixed(2)} %`);
for (const s of gA.chiTiet) console.log(`          ${s}`);
console.log(`  SAU  : ${gB.che}/${gB.tong} = ${((gB.che / gB.tong) * 100).toFixed(2)} %`);
for (const s of gB.chiTiet) console.log(`          ${s}`);
console.log(`  ⇒ ${gB.che / gB.tong < gA.che / gA.tong ? "GIẢM ✓" : "KHÔNG GIẢM ✗"}`);

console.log("\n══════════ TÊN CÔNG TY — SẠCH TRỌN (thước kết luận) ══════════");
for (const vai of VAI) {
  const a = A.vai[vai].tomTat, b = B.vai[vai].tomTat;
  if (!a) continue;
  const mark = (x, y) => (x === y ? "=" : y > x ? "↑" : "↓ TỤT");
  console.log(
    `  ${vai.padEnd(16)} 3D ${a.tenTronVen3D}/${a.soCum3D} → ${b.tenTronVen3D}/${b.soCum3D} ${mark(a.tenTronVen3D, b.tenTronVen3D)}` +
      `   ‖ 2D ${a.tenTronVen2D}/${a.soCum2D} → ${b.tenTronVen2D}/${b.soCum2D} ${mark(a.tenTronVen2D, b.tenTronVen2D)}`,
  );
}

console.log("\n══════════ ve + an === tong (mọi vai, cả hai chế độ) ══════════");
let hongA = 0, hongB = 0;
for (const vai of VAI) {
  for (const [ten, J, dem] of [["NỀN", A, 0], ["SAU", B, 0]]) {
    const o = J.vai[vai];
    const s3 = o.ba3D && o.ba3D.soNhan;
    const s2 = o.ba2D && o.ba2D.demNhan;
    const ok3 = !s3 || s3.ve + s3.an === s3.tong;
    const ok2 = !s2 || s2.ve + s2.an === s2.tong;
    if (!ok3 || !ok2) { if (ten === "NỀN") hongA++; else hongB++;
      console.log(`  ✗ ${ten} ${vai} 3D=${JSON.stringify(s3)} 2D=${JSON.stringify(s2)}`); }
  }
}
console.log(`  NỀN hỏng ${hongA} · SAU hỏng ${hongB} ⇒ ${hongB === 0 ? "✓ đúng ở MỌI vai, cả hai chế độ" : "✗"}`);
for (const vai of VAI) {
  const o = B.vai[vai];
  const s3 = o.ba3D && o.ba3D.soNhan, s2 = o.ba2D && o.ba2D.demNhan;
  if (s3 || s2) console.log(`     ${vai.padEnd(16)} 3D ${s3 ? `${s3.ve}+${s3.an}=${s3.tong}` : "—"}  ‖ 2D ${s2 ? `${s2.ve}+${s2.an}=${s2.tong}` : "—"}`);
}

console.log("\n══════════ KHÔNG HỒI QUY — biểu tượng / cụm×toà / lệnh vẽ / tam giác / nhãn ══════════");
let bt = [];
for (const vai of VAI) {
  const a = A.vai[vai].ba3D, b = B.vai[vai].ba3D;
  if (!a || !a.rongPxBieuTuong || a.rongPxBieuTuong.length === 0) continue;
  bt.push(...b.rongPxBieuTuong);
  const sameToa = JSON.stringify(a.toaTheoFactory) === JSON.stringify(b.toaTheoFactory);
  console.log(
    `  ${vai.padEnd(16)} biểuTượng ${a.soBieuTuong}→${b.soBieuTuong}` +
      ` rộng [${Math.min(...a.rongPxBieuTuong)}..${Math.max(...a.rongPxBieuTuong)}]→[${Math.min(...b.rongPxBieuTuong)}..${Math.max(...b.rongPxBieuTuong)}]` +
      ` · cụm×toà ${sameToa ? "0 lệch ✓" : "LỆCH ✗ " + JSON.stringify(b.toaTheoFactory)}` +
      ` · calls ${a.thongKe && a.thongKe.calls}→${b.thongKe && b.thongKe.calls}` +
      ` · tri ${a.thongKe && a.thongKe.triangles}→${b.thongKe && b.thongKe.triangles}` +
      ` · nhãn ${a.soNhan && a.soNhan.tong}→${b.soNhan && b.soNhan.tong}`,
  );
}
console.log(`  biểu tượng SAU: [${Math.min(...bt)} .. ${Math.max(...bt)}] px (yêu cầu 41,1–236,1)`);
