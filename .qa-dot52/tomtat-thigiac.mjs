// ĐỢT 52 — tóm tắt THỊ GIÁC từ d3-*/ THEO ĐÚNG LƯỢC ĐỒ JSON.
// ⚠ Bản đầu của tôi gom nhầm khoá (nhan.ngoaiCanvas, badgeDoiCho coi là mảng…) ⇒ "toàn 0" GIẢ.
//   Đã đối chiếu với chính dòng in của harness (thigiac52.mjs:126) rồi mới viết lại.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
const ds = (x) => (Array.isArray(x) ? x : x && typeof x === "object" ? Object.values(x) : []);
const ra = { luc: new Date().toISOString(), lang: {} };
for (const L of ["vi", "en"]) {
  const dir = `.qa-dot52/d3-${L}`;
  const tep = readdirSync(dir).filter((x) => x.endsWith(".json")).sort();
  const t = { soTep: tep.length, nhanTong: 0, badgeTong: 0, nhanNgoai: 0, badgeNgoai: 0, nhanChe: 0, badgeChe: 0, chongNhan: 0, chongBadge: 0, nhanXBadge: 0, badgeDoiCho: 0, chipTong: 0, chipNgoai: 0, chipChe: 0, tran: 0, cat: 0, catKhongTitle: 0, selCat: 0, selTong: 0, deKhoiKhac: 0, deKhoiKhacDoLai: 0, demBadgeSoAn: 0, demBadgeBiChe: 0, geistThieu: 0, xau: [] };
  for (const f of tep) {
    const j = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
    const nhan = ds(j.nhan), badge = ds(j.badge), chip = ds(j.chip), cat = ds(j.cat), sel = ds(j.sel);
    const nN = nhan.filter((n) => !n.trongCanvas).length, bN = badge.filter((n) => !n.trongCanvas).length;
    const nC = nhan.filter((n) => ds(n.biChe).length > 0).length, bC = badge.filter((n) => ds(n.biChe).length > 0).length;
    const cN = ds(j.capChongNhan).length, cB = ds(j.capChongBadge).length, cNB = ds(j.capChongNhanBadge).length;
    t.nhanTong += nhan.length; t.badgeTong += badge.length; t.nhanNgoai += nN; t.badgeNgoai += bN; t.nhanChe += nC; t.badgeChe += bC;
    t.chongNhan += cN; t.chongBadge += cB; t.nhanXBadge += cNB;
    t.badgeDoiCho += Number(j.badgeDoiCho ?? 0);
    t.chipTong += chip.length; t.chipNgoai += chip.filter((c) => !c.trongCanvas).length; t.chipChe += chip.filter((c) => ds(c.biChe).length > 0).length;
    t.cat += cat.length; t.catKhongTitle += cat.filter((c) => !c.title && !c.titleCha).length;
    t.selTong += sel.length; t.selCat += sel.filter((s) => s.biCat).length;
    t.deKhoiKhac += Number(j.demNhan?.deKhoiKhac ?? 0); t.deKhoiKhacDoLai += Number(j.demNhan?.deKhoiKhacDoLai ?? 0);
    t.demBadgeSoAn += Number(j.demBadge?.soAn ?? 0); t.demBadgeBiChe += Number(j.demBadge?.biChe ?? 0);
    if (j.tran && (j.tran.docW > j.tran.innerW || j.tran.docH > j.tran.innerH)) t.tran++;
    if ((j.font?.faceGeistLoaded ?? 0) < 1) t.geistThieu++;
    if (nN || bN || nC || bC || cN || cB || cNB || chip.some((c) => !c.trongCanvas || ds(c.biChe).length)) t.xau.push(`${f}: nhãn ngoài ${nN} bịChe ${nC} · badge ngoài ${bN} bịChe ${bC} · chồng nhãn ${cN} badge ${cB} nhãn×badge ${cNB}`);
  }
  ra.lang[L] = t;
  console.log(`${L}: ${t.soTep} trạng-thái×vp · nhãn ${t.nhanTong} badge ${t.badgeTong} chip ${t.chipTong}`);
  console.log(`    NGOÀI canvas nhãn ${t.nhanNgoai} badge ${t.badgeNgoai} chip ${t.chipNgoai} · BỊ CHE nhãn ${t.nhanChe} badge ${t.badgeChe} chip ${t.chipChe}`);
  console.log(`    cặp CHỒNG: nhãn×nhãn ${t.chongNhan} · badge×badge ${t.chongBadge} · nhãn×badge ${t.nhanXBadge} · badge dời chỗ ${t.badgeDoiCho}`);
  console.log(`    nhãn ĐÈ KHỐI máy khác (demNhan.deKhoiKhac) ${t.deKhoiKhac} · đo lại ${t.deKhoiKhacDoLai} · badge soAn ${t.demBadgeSoAn} biChe ${t.demBadgeBiChe}`);
  console.log(`    tràn trang ${t.tran} · Geist thiếu ${t.geistThieu} · cắt chữ ${t.cat} (không title/titleCha ${t.catKhongTitle}) · select cắt ${t.selCat}/${t.selTong}`);
  for (const x of t.xau) console.log(`    ⚠ ${x}`);
}
writeFileSync(".qa-dot52/thigiac-tomtat.json", JSON.stringify(ra, null, 1));
