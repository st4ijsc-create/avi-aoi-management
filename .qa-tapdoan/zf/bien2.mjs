/** zf/bien2.mjs — như `bien.mjs` nhưng trên `dist-zfva` (bản dựng THẬT từ nguồn đã vá). */
import fs from "node:fs";
import crypto from "node:crypto";
const F = "KhungCanh-BiGwCO3Z.js";
const G = `.qa-tapdoan/zf/goc-va/${F}`;
const D = `.qa-tapdoan/dist-zfva/public/assets/${F}`;
const BIEN = { near01: ["Mt=.1,vt=.5", "Mt=.1,vt=.1"], near04: ["Mt=.1,vt=.5", "Mt=.4,vt=.5"] };
let s = fs.readFileSync(G, "utf8");
for (const t of process.argv.slice(2)) {
  const bv = BIEN[t];
  if (!bv) throw new Error(`biến thể lạ: ${t}`);
  const n = s.split(bv[0]).length - 1;
  if (n !== 1) throw new Error(`${t}: khớp ${n} lần, PHẢI 1 — DỪNG`);
  s = s.split(bv[0]).join(bv[1]);
}
fs.writeFileSync(D, s);
const md5 = (p) => crypto.createHash("md5").update(fs.readFileSync(p)).digest("hex");
console.log(`dist-zfva [${process.argv.slice(2).join("+") || "GỐC"}] · ${F}: ${md5(D)}${md5(D) === md5(G) ? " (=gốc)" : " (ĐÃ VÁ)"}`);
