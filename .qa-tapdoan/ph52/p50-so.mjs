/**
 * p50-so.mjs — SO TRƯỚC ↔ SAU trên CÙNG bộ dữ liệu, CÙNG script đo (`n1-do.mjs`).
 *   node .qa-tapdoan/p50-so.mjs <nhanTruoc> <nhanSau>
 * In đúng các ô nghiệm thu chủ đợt nêu, và ô nào TỤT thì ghi "TỤT".
 */
import fs from "node:fs";
const A = JSON.parse(fs.readFileSync(`.qa-tapdoan/n1-${process.argv[2] ?? "p50truoc"}.json`, "utf8"));
const B = JSON.parse(fs.readFileSync(`.qa-tapdoan/n1-${process.argv[3] ?? "p50sau"}.json`, "utf8"));

const demChe = (J) => {
  let tong = 0, che = 0; const ds = [];
  for (const [vai, v] of Object.entries(J.vai))
    for (const c of ["ba3D", "ba2D"]) {
      const b = v[c]; if (!b) continue;
      for (const g of ["nhanCum", "nhanToa"]) for (const n of b[g] ?? []) {
        tong += 1;
        if (!n.an && (n.tyLeChe ?? 0) > 0) { che += 1; ds.push(`${vai}/${c}/${n.chu}=${n.tyLeChe}%`); }
      }
    }
  return { tong, che, ds };
};

const bang = [];
for (const vai of Object.keys(A.vai)) {
  const a = A.vai[vai], b = B.vai[vai];
  const r = (x, che) => {
    const s = che === "3d" ? x?.ba3D : x?.ba2D;
    const w = che === "3d" ? s?.rongPxBieuTuong : s?.rongToa2D;
    return w && w.length ? `${Math.min(...w)}..${Math.max(...w)}` : "—";
  };
  bang.push({
    vai: vai.replace("qatd_", ""),
    "cụm 3D": `${a.tomTat.soCum3D}→${b.tomTat.soCum3D}`,
    "tên 3D (sạch trọn)": `${a.tomTat.tenTronVen3D}/${a.tomTat.soCum3D} → ${b.tomTat.tenTronVen3D}/${b.tomTat.soCum3D}`,
    "tên 2D (sạch trọn)": `${a.tomTat.tenTronVen2D}/${a.tomTat.soCum2D} → ${b.tomTat.tenTronVen2D}/${b.tomTat.soCum2D}`,
    "rộng px 3D": `${r(a, "3d")} → ${r(b, "3d")}`,
    "rộng px 2D": `${r(a, "2d")} → ${r(b, "2d")}`,
    "3D ve+an=tổng": [a, b].map((x) => {
      const s = x.tomTat.soNhan3D; return s ? (s.ve + s.an === s.tong ? `${s.ve}+${s.an}=${s.tong} ✓` : `${s.ve}+${s.an}≠${s.tong} ✗`) : "—";
    }).join(" → "),
    "2D ve+an=tổng": [a, b].map((x) => {
      const s = x.ba2D?.demNhan; return s ? (s.ve + s.an === s.tong ? `${s.ve}+${s.an}=${s.tong} ✓` : `${s.ve}+${s.an}≠${s.tong} ✗`) : "—";
    }).join(" → "),
    "viewBox 2D": `${a.ba2D?.viewBox ?? "—"} → ${b.ba2D?.viewBox ?? "—"}`,
  });
}
console.table(bang);
const ca = demChe(A), cb = demChe(B);
console.log(`\nTOÀN CỤC ${ca.tong} nhãn → ${cb.tong} nhãn · hiện-mà-bị-che-một-phần ${ca.che} → ${cb.che} (trần 4)`);
console.log("  TRƯỚC: " + (ca.ds.join(" · ") || "—"));
console.log("  SAU  : " + (cb.ds.join(" · ") || "—"));

// Quan hệ cụm × toà, đo bằng `sinh-summary.json` (nguồn ngoài sản phẩm).
for (const [ten, J] of [["TRƯỚC", A], ["SAU", B]]) {
  const d = Object.entries(J.vai)
    .filter(([, v]) => v.ba3D?.toaTheoFactory)
    .map(([vai, v]) => `${vai.replace("qatd_", "")}=${JSON.stringify(v.ba3D.toaTheoFactory)}`)
    .join(" · ");
  console.log(`quan hệ cụm×toà 3D ${ten}: ${d}`);
}
