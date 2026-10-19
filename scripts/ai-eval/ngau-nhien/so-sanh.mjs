/**
 * GOM nhiều lượt đo (đường a/b) theo tiền tố nhãn ⇒ bảng ngôn ngữ × lượt, kèm số cụt và KIỂM VÂN TAY: một bài có vân tay
 * khác nhau giữa các lượt ⇒ bài đã bị sửa giữa chừng ⇒ hai lượt KHÔNG so được trên bài đó (in cảnh báo, loại khỏi so).
 *
 *   node scripts/ai-eval/ngau-nhien/so-sanh.mjs NN-a-raw- NN-a-pipe- NN-b-agent-
 * Mỗi tiền tố khớp `reports/<tiền tố><số>.json` (nhãn kết thúc bằng số lượt).
 */
import fs from "node:fs";
import { BO } from "./lib/moiTruong.mjs";
import { NGON_NGU } from "./lib/kho.mjs";

const tienTo = process.argv.slice(2);
if (!tienTo.length) { console.error("cách dùng: so-sanh.mjs <tiền tố nhãn> …"); process.exit(2); }
const dir = `${BO}/reports`;
const vanTay = new Map();
const nhom = tienTo.map((t) => {
  const tep = fs.readdirSync(dir).filter((f) => f.startsWith(t) && /^\d+\.json$/.test(f.slice(t.length)));
  const rows = [];
  for (const f of tep) {
    const j = JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8"));
    for (const r of j.rows ?? []) {
      rows.push({ ...r, nhan: f, seed: j.seed });
      if (!vanTay.has(r.id)) vanTay.set(r.id, new Set());
      vanTay.get(r.id).add(r.vanTay);
    }
  }
  return { t, tep, rows };
});
const doi = [...vanTay].filter(([, s]) => s.size > 1).map(([id]) => id);
if (doi.length) console.log(`⚠ ${doi.length} bài có VÂN TAY khác nhau giữa các lượt (bị sửa) — loại khỏi so: ${doi.join(", ")}`);
const hop = (r) => !doi.includes(r.id);

console.log(`| ngôn ngữ | ${nhom.map((g) => `${g.t}* (${g.tep.length} lượt)`).join(" | ")} |`);
console.log(`|---|${nhom.map(() => "---").join("|")}|`);
for (const l of [...NGON_NGU, null]) {
  const o = nhom.map((g) => {
    const x = g.rows.filter(hop).filter((r) => !l || r.lang === l);
    if (!x.length) return "—";
    const d = x.filter((r) => r.dat).length;
    const c = x.filter((r) => r.cut).length;
    return `${d}/${x.length} = ${Math.round((100 * d) / x.length)} %${c ? ` (cụt ${c})` : ""}`;
  });
  if (o.every((v) => v === "—")) continue;
  console.log(`| ${l ?? "**TỔNG**"} | ${o.join(" | ")} |`);
}
for (const g of nhom) console.log(` ${g.t}: seed ${[...new Set(g.rows.map((r) => r.seed))].join(", ") || "—"}`);
