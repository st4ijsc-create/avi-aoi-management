// Backlog 2 (2026-09-24) — so các "cổng" tách nguồn ĐÚNG khỏi câu NGOÀI corpus trên bộ vàng Studio, theo TỔNG LỖI
// (nguồn đúng bị loại + câu ngoài lọt), và độ đúng top‑1. Đầu vào = dòng JSON của `rerank-tach.ts` (điểm THÔ):
//   npx tsx scripts/ai-eval/rerank-tach.ts st4i-may-aoi 2>/dev/null | grep '^{' > /tmp/bge.jsonl
//   GGUF_RERANKER_MODEL=Qwen3-Reranker-0.6B-Q8_0.gguf npx tsx scripts/ai-eval/rerank-tach.ts st4i-may-aoi … > /tmp/qwen.jsonl
//   node scripts/ai-eval/rerank-tach-quet.mjs /tmp/bge.jsonl /tmp/qwen.jsonl
import fs from "node:fs";
const doc = (f) => fs.readFileSync(f, "utf8").trim().split(/\r?\n/).map((l) => JSON.parse(l));
function quet(ten, rows, keyDung, keyNgoai, nguongSx) {
  const dung = rows.filter((r) => !r.ngoai && r[keyDung] != null).map((r) => r[keyDung]);
  const nhieu = rows.filter((r) => r.ngoai).map((r) => r[keyNgoai]);
  let best = null;
  for (const t of [...new Set([...dung, ...nhieu])].sort((a, b) => a - b)) {
    const mat = dung.filter((s) => s < t).length, lot = nhieu.filter((s) => s >= t).length;
    if (!best || mat + lot < best.loi) best = { t, mat, lot, loi: mat + lot };
  }
  const sx = nguongSx == null ? "" : ` · @${nguongSx}: mất ${dung.filter((s) => s < nguongSx).length} + lọt ${nhieu.filter((s) => s >= nguongSx).length}`;
  console.log(`${ten.padEnd(20)} đúng ${dung.length} · ngoài ${nhieu.length} · tốt nhất @${best.t.toFixed(3)}: mất ${best.mat} + lọt ${best.lot} = ${best.loi}${sx}`);
}
const [fBge, fQwen] = process.argv.slice(2);
const bge = doc(fBge);
quet("cosine", bge, "cosDung", "cosTop", 0.44);
quet("reranker 1 (thô)", bge, "rrDung", "rrTop");
if (fQwen) quet("reranker 2 (thô)", doc(fQwen), "rrDung", "rrTop");
const top1 = (rows) => `${rows.filter((r) => !r.ngoai && r.top1Dung).length}/${rows.filter((r) => !r.ngoai).length}`;
console.log(`top‑1 đúng nguồn sau xếp lại THÔ: reranker 1 ${top1(bge)}${fQwen ? ` · reranker 2 ${top1(doc(fQwen))}` : ""}`);
