/** zf/bien3.mjs — ORACLE "lưới vẽ ĐỦ" cho màn Studio (`CanhThietKe`), trên dist-zfva. */
import fs from "node:fs";
const F = "TwinStudio-DHipwymY.js";
const G = `.qa-tapdoan/zf/goc-va2/${F}`;
const D = `.qa-tapdoan/dist-zfva/public/assets/${F}`;
const TIM = 'CanhThietKe.tsx:215",args:[i,Math.max(4,Math.round(i)),c,r],position:[t/2,0,e/2]';
const THAY = TIM + ',renderOrder:1,"material-depthWrite":!1,"material-depthTest":!1';
let s = fs.readFileSync(G, "utf8");
if (process.argv[2] === "oracle") {
  const n = s.split(TIM).length - 1;
  if (n !== 1) throw new Error(`khớp ${n} lần, PHẢI 1 — DỪNG`);
  s = s.split(TIM).join(THAY);
}
fs.writeFileSync(D, s);
console.log(`Studio [${process.argv[2] ?? "GỐC"}] · ${F} ${s.length} byte`);
