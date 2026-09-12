// ĐỢT 54 — gom số thị giác theo LƯỢC ĐỒ THẬT (G: Đợt 52 từng gom nhầm khoá ⇒ "toàn 0" GIẢ).
import { readFileSync, writeFileSync } from "node:fs";
const tong = {};
for (const L of ["vi", "en"]) {
  const j = JSON.parse(readFileSync(`.qa-dot54/d3-${L}/tong.json`, "utf8"));
  const a = { ca: 0, soCanvasKhac1: 0, nhan: 0, badge: 0, chip: 0, nhanNgoai: 0, badgeNgoai: 0, chipNgoai: 0,
    nhanChe: 0, badgeChe: 0, chipChe: 0, capNN: 0, capBB: 0, capNB: 0, badgeDoiCho: 0, tran: 0, fontThieu: 0,
    veBadgeVsSo: [] };
  for (const vp of Object.keys(j)) for (const ten of Object.keys(j[vp])) {
    const c = j[vp][ten]; if (!c || typeof c !== "object" || !c.url) continue;
    a.ca++;
    if (c.soCanvas !== 1) a.soCanvasKhac1++;
    const N = c.nhan ?? [], B = c.badge ?? [], C = c.chip ?? [];
    a.nhan += N.length; a.badge += B.length; a.chip += C.length;
    a.nhanNgoai += N.filter((x) => x.trongCanvas === false).length;
    a.badgeNgoai += B.filter((x) => x.trongCanvas === false).length;
    a.chipNgoai += C.filter((x) => x.trongCanvas === false).length;
    a.nhanChe += N.filter((x) => (x.biChe ?? []).length > 0).length;
    a.badgeChe += B.filter((x) => (x.biChe ?? []).length > 0).length;
    a.chipChe += C.filter((x) => (x.biChe ?? []).length > 0).length;
    a.capNN += c.capChongNhan ?? 0; a.capBB += c.capChongBadge ?? 0; a.capNB += c.capChongNhanBadge ?? 0;
    a.badgeDoiCho += c.badgeDoiCho ?? 0;
    if (c.tran && (c.tran.docW > c.tran.innerW + 1 || c.tran.docH > c.tran.innerH + 1)) a.tran++;
    if (!(c.font?.faceGeistLoaded >= 1) || c.font?.status !== "loaded") a.fontThieu++;
    const ve = c.demBadge?.ve ?? 0, so = c.demNhan?.soHopBadge ?? 0;
    if (ve !== so) a.veBadgeVsSo.push(`${vp}/${ten}: ve=${ve} so=${so}`);
  }
  tong[L] = a;
}
console.log(JSON.stringify(tong, null, 1));
writeFileSync(".qa-dot54/thigiac-tomtat.json", JSON.stringify(tong, null, 1));
