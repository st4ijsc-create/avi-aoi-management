// DOT 56 — tom tat 24 trang thai thi giac theo CAC O BAT BIEN (doc tu tong.json).
import { readFileSync, writeFileSync, renameSync } from "node:fs";
const LANG = process.argv[2] ?? "vi";
const d = JSON.parse(readFileSync(`.qa-dot56/d3-${LANG}/tong.json`, "utf8"));
let n = 0; const viPham = [];
let tongNhan = 0, tongBadge = 0;
for (const [vp, states] of Object.entries(d)) {
  for (const [ten, s] of Object.entries(states)) {
    n++;
    const nhan = Array.isArray(s.nhan) ? s.nhan : [];
    const badge = Array.isArray(s.badge) ? s.badge : [];
    tongNhan += nhan.length; tongBadge += badge.length;
    const loi = [];
    // BAT BIEN 1: moi nhan/badge phai NAM TRONG canvas
    const nOut = nhan.filter((x) => x.trongCanvas === false).length;
    const bOut = badge.filter((x) => x.trongCanvas === false).length;
    if (nOut) loi.push(`nhan ngoai canvas=${nOut}`);
    if (bOut) loi.push(`badge ngoai canvas=${bOut}`);
    // BAT BIEN 2: khong bi lop phu DE LEN
    const nChe = nhan.filter((x) => (x.biChe ?? []).length > 0).length;
    const bChe = badge.filter((x) => (x.biChe ?? []).length > 0).length;
    if (nChe) loi.push(`nhan bi che=${nChe}`);
    if (bChe) loi.push(`badge bi che=${bChe}`);
    // BAT BIEN 3: khong cap chong
    for (const k of ["capChongNhan", "capChongBadge", "capChongNhanBadge"]) {
      const v = Array.isArray(s[k]) ? s[k].length : (s[k] ?? 0);
      if (v > 0) loi.push(`${k}=${v}`);
    }
    // BAT BIEN 4: dung 1 canvas
    if (s.soCanvas !== 1 && !ten.startsWith("studio")) loi.push(`soCanvas=${s.soCanvas}`);
    // BAT BIEN 5: khong tran khung nhin
    const tr = s.tran ?? {};
    if (tr.W != null && tr.Wmax != null && tr.W > tr.Wmax) loi.push(`tran W ${tr.W}>${tr.Wmax}`);
    if (tr.H != null && tr.Hmax != null && tr.H > tr.Hmax) loi.push(`tran H ${tr.H}>${tr.Hmax}`);
    if (loi.length) viPham.push(`${vp} ${ten}: ${loi.join(" · ")}`);
  }
}
const ra = `=== DOT 56 · thi giac lang=${LANG} tren dist MOI (cong 3056) ===
so trang thai do : ${n}
tong nhan do     : ${tongNhan}
tong badge do    : ${tongBadge}
VI PHAM          : ${viPham.length}
${viPham.length ? viPham.map((x) => "  ✗ " + x).join("\n") : "  (0 — moi nhan/badge trong canvas, khong bi che, khong cap chong, 1 canvas, khong tran)"}
`;
writeFileSync(`.qa-dot56/C4-thigiac-${LANG}-tomtat.txt.tmp`, ra);
renameSync(`.qa-dot56/C4-thigiac-${LANG}-tomtat.txt.tmp`, `.qa-dot56/C4-thigiac-${LANG}-tomtat.txt`);
console.log(ra);
