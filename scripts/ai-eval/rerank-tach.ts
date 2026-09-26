//   npx tsx scripts/ai-eval/rerank-tach.ts [corpus]   (đổi model: GGUF_RERANKER_MODEL=…; cửa sổ: RAG_RERANKER_DOC_CHARS=…)
// Thí nghiệm mục 3/4 (training): điểm reranker bge THÔ có tách "đoạn đúng" khỏi "câu ngoài corpus cùng miền" không,
// khi cosine (embedding) KHÔNG tách được (đúng 0,340–0,429 < ngưỡng 0,44 < nhiễu 0,46–0,57).
// ⚠ 2026-09-24: `rerank()` trả điểm TRỘN `BLEND·rr + (1−BLEND)·cosine` (`.env` RAG_RERANKER_BLEND=0.20 ⇒ 80 % là cosine).
// Muốn điểm reranker THÔ phải ép BLEND=1 TRƯỚC khi nạp aiReranker (hằng đọc lúc nạp module). Mặc định nay = 1;
// truyền RAG_RERANKER_BLEND=… trên dòng lệnh để đo điểm trộn như sản xuất.
process.env.RAG_RERANKER_BLEND = process.argv.includes("--tron") ? (process.env.RAG_RERANKER_BLEND ?? "0.20") : "1";
import "dotenv/config";
import fs from "node:fs";
console.error(`[rerank-tach] RAG_RERANKER_BLEND=${process.env.RAG_RERANKER_BLEND} (${process.env.RAG_RERANKER_BLEND === "1" ? "điểm THÔ" : "điểm TRỘN"})`);
const corpus = process.argv[2] ?? "st4i-may-aoi";
const bo = fs.readFileSync(`knowledge/studio-golden/${corpus}.jsonl`, "utf8").trim().split(/\r?\n/).map((l) => JSON.parse(l));
const { embedQuestion } = await import("../../server/services/aiLocalKnowledgeService");
const { searchCorpus } = await import("../../server/services/kbVectorStore");
const { rerank } = await import("../../server/services/aiReranker");
const ra: any[] = [];
for (const c of bo) {
  const v = await embedQuestion(c.cauHoi);
  const hits = await searchCorpus(corpus, v!, 5);
  const cands = hits.map((h: any) => ({ id: String(h.id), text: h.text, score: h.score, title: h.sourceRef, src: h.sourceRef }));
  const rr = await rerank(c.cauHoi, cands, 5);
  const khop = (s: string) => c.nguon.some((n: string) => s.endsWith(n));
  const top = rr[0];
  const dung = rr.find((x) => khop(x.candidate.src));
  ra.push({ id: c.id, ngoai: c.nguon.length === 0, cosTop: hits[0]?.score, rrTop: top?.rerankScore, rrTopSrc: top?.candidate.src,
    rrDung: dung?.rerankScore ?? null, cosDung: dung?.candidate.score ?? null, top1Dung: top ? khop(top.candidate.src) : false });
}
for (const x of ra) console.log(JSON.stringify(x));
const trong = ra.filter((x) => !x.ngoai && x.rrDung !== null), ngoai = ra.filter((x) => x.ngoai);
const minDung = Math.min(...trong.map((x) => x.rrDung)), maxNgoai = Math.max(...ngoai.map((x) => x.rrTop));
const minCos = Math.min(...trong.map((x) => x.cosDung)), maxCosNgoai = Math.max(...ngoai.map((x) => x.cosTop));
console.log(`TÓM: rerank đúng min=${minDung.toFixed(3)} · ngoài max=${maxNgoai.toFixed(3)} ⇒ ${minDung > maxNgoai ? "TÁCH ĐƯỢC" : "CHỒNG"}`);
console.log(`TÓM: cosine đúng min=${minCos.toFixed(3)} · ngoài max=${maxCosNgoai.toFixed(3)} ⇒ ${minCos > maxCosNgoai ? "TÁCH ĐƯỢC" : "CHỒNG"}`);
console.log(`top1 theo rerank đúng nguồn: ${ra.filter((x) => !x.ngoai && x.top1Dung).length}/${ra.filter((x) => !x.ngoai).length}`);
process.exit(0);
