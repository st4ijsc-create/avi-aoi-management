// Đo tương phản WCAG từ token.css (đọc giá trị thật, không chép tay). Chạy: node tuong-phan.mjs > tuong-phan.md
import { readFileSync } from "node:fs";
const css = readFileSync(new URL("./token.css", import.meta.url), "utf8");
const tok = {};
for (const m of css.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\b/gi)) tok[m[1]] = m[2];
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const L = (h) => { const n = parseInt(h.slice(1), 16); return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
const cr = (a, b) => { const [x, y] = [L(a), L(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
// [chữ, nền, mô tả, ngưỡng]   (3,0 = chỉ cho glyph/đồ hoạ lớn ≥ 3:1 theo WCAG 1.4.11; 4,5 = chữ/giá trị)
const T = 4.5;
const P = [];
for (const n of ["text-1", "text-2", "text-3"]) for (const b of ["isa-field", "isa-surface", "isa-surface-2", "isa-graphic"]) P.push([n, b, `${n} trên ${b}`, T]);
for (const k of [1, 2, 3, 4]) {
  P.push([`alarm-p${k}-ink`, `alarm-p${k}-soft`, `chữ P${k} trên nền nhạt P${k}`, T]);
  P.push([`alarm-p${k}-ink`, "isa-surface", `chữ P${k} đậm trên thẻ`, T]);
  P.push([`alarm-p${k}`, "isa-surface", `glyph/viền P${k} trên thẻ (đồ hoạ)`, 3]);
  P.push(["accent-ink", `alarm-p${k}`, `chữ trắng trên ô đặc P${k}`, T]);
}
P.push(["stale", "isa-surface", "giá trị tím (cũ) trên thẻ", T], ["stale-ink", "stale-soft", "chữ trên nền nhạt tím", T], ["stale", "isa-graphic", "giá trị tím trên khung đồ hoạ", T]);
P.push(["sim-ink", "sim-soft", "chữ pill MÔ PHỎNG", T], ["accent-ink", "sim", "chữ trắng trên banner MÔ PHỎNG đặc", T], ["sim", "isa-field", "viền MÔ PHỎNG 4 px (đồ hoạ)", 3], ["qa", "qa-soft", "chữ nhãn QA", T]);
P.push(["accent", "isa-surface", "liên kết/nút viền accent trên thẻ", T], ["accent-ink", "accent", "chữ nút accent", T], ["accent", "accent-soft", "chữ accent trên nền accent nhạt (tab chọn)", T]);
P.push(["rail-ink".replace("rail-ink", "isa-rail-ink"), "isa-rail", "chữ rail", T], ["isa-rail-ink-2", "isa-rail", "chữ rail phụ", T], ["isa-rail-ink", "isa-rail-2", "chữ rail mục chọn", T]);
P.push(["rail-lt-ink", "rail-lt-bg", "chữ rail xám sáng", T], ["rail-lt-ink-2", "rail-lt-bg", "chữ rail xám sáng phụ", T], ["rail-lt-ink", "rail-lt-bg-2", "chữ rail xám sáng mục chọn", T], ["accent", "rail-lt-bg-2", "chữ accent trên mục chọn rail sáng", T]);
for (const s of ["execute", "idle", "resetting", "held", "suspended", "stopped", "aborted"]) P.push([`packml-${s}`, "isa-surface", `trạng thái PackML ${s} (chữ)`, T]);
for (const k of [1, 3, 4, 5]) P.push([`actuation-${k}-ink`, `actuation-${k}`, `chữ mức tác động ${k}`, T]);
P.push(["stop-ink", "stop", "chữ nút DỪNG MÁY", T], ["isa-line-strong", "isa-surface", "viền ô số (đồ hoạ)", 3]);
let fail = 0;
const rows = P.map(([f, b, d, min]) => { const r = cr(tok[f], tok[b]); const ok = r >= min; if (!ok) fail++; return `| ${d} | \`${f}\` ${tok[f]} | \`${b}\` ${tok[b]} | ${r.toFixed(2)}:1 | ≥ ${min}:1 | ${ok ? "ĐẠT" : "**KHÔNG ĐẠT**"} |`; });
console.log(`# Đo tương phản — token.css\n\nSinh bằng \`node tuong-phan.mjs\` (WCAG 2.x, đọc hex từ token.css). Chữ/giá trị ≥ 4,5:1; đồ hoạ ≥ 3:1.\n\n| Cặp | Màu chữ/đồ hoạ | Nền | Tỉ lệ | Ngưỡng | KQ |\n|---|---|---|---|---|---|\n${rows.join("\n")}\n\n**${P.length} cặp, ${fail} không đạt.**`);
process.exitCode = fail ? 1 : 0;
