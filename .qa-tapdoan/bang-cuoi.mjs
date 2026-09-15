/** Sinh bảng ca × kỳ vọng × số đo × phán quyết từ tho/CUOI/*.json. */
import { readFileSync, existsSync } from "node:fs";
const THO = ".qa-tapdoan/tho/CUOI";
const doc = (t) => (existsSync(`${THO}/${t}.json`) ? JSON.parse(readFileSync(`${THO}/${t}.json`, "utf8")) : null);
const THU_TU = ["P1", "P2", "P2b", "P3", "P4", "P5", "P5b", "P6", "P7", "P7b", "P8", "P8b", "N1", "N2", "N2b", "N3", "N4", "N5", "N5b", "N6", "H1", "H2", "H3", "H3b", "T1", "T2", "T3"];
const esc = (s) => String(s == null ? "—" : s).replace(/\|/g, "\\|").replace(/\n/g, " ").replace(/\s+/g, " ").trim();
const rows = [];
let khong = 0;
for (const t of THU_TU) {
  const r = doc(t);
  if (!r) { rows.push(`| ${t} | — | KHÔNG CÓ TỆP THÔ | (không có phán quyết) | tệp \`${THO}/${t}.json\` vắng |`); khong += 1; continue; }
  if (!r.pq) { rows.push(`| ${t} | ${esc(r.deBai)} | — | (không có phán quyết) | tệp thô không mang trường \`pq\` |`); khong += 1; continue; }
  rows.push(`| **${t}** | ${esc(r.deBai)} | ${esc(JSON.stringify(r.thay || r.loiLuu || r.ketCuc || r.tomTat || "")).slice(0, 420)} | **${r.pq}** | ${esc(r.vi).slice(0, 460)} |`);
}
const dem = {};
for (const t of THU_TU) { const r = doc(t); const k = r && r.pq ? r.pq : "(không có phán quyết)"; dem[k] = (dem[k] || 0) + 1; }
console.log("| ca | kỳ vọng | số đo | phán quyết | vì sao |");
console.log("|---|---|---|---|---|");
for (const x of rows) console.log(x);
console.log("");
console.log("**Tổng:** " + Object.entries(dem).map(([k, v]) => `${k} ${v}`).join(" · "));
console.log("");
console.log(`**Ô không có phán quyết: ${khong}**`);
