#!/usr/bin/env node
/**
 * verify-embedding-cosine.mjs — Kiểm chứng KB không sút khi chuyển embeddings
 * từ Ollama-mxbai (cũ, trong knowledge/embeddings.jsonl) sang GGUF-mxbai (mới).
 *
 *   node scripts/ai-kb/verify-embedding-cosine.mjs [--sample N] [--threshold T] [--all]
 *
 * Với MỖI chunk mẫu: embed lại bằng GGUF (đúng input pipeline = `${title}\n${text}`
 * đã trim 3000) rồi tính cosine với vector Ollama cũ. Cùng model/space → cosine
 * cao = an toàn chuyển USE_LEGACY_OLLAMA=false KHÔNG cần re-embed; thấp = nên
 * re-embed corpus hoặc giữ Ollama.
 *
 * Offline: chỉ cần mxbai GGUF trong uploads/gguf-models (KHÔNG cần Ollama daemon).
 * Chỉ ĐỌC, không sửa gì.
 */
import fs from "node:fs";
import readline from "node:readline";
import { embedTextGguf, disposeGgufEmbed, ggufEmbedModelName } from "./_gguf-embed.mjs";

const C = { reset: "\x1b[0m", green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m", dim: "\x1b[2m", bold: "\x1b[1m" };
const args = process.argv.slice(2);
const getArg = (name, def) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : def; };
const SAMPLE = parseInt(getArg("--sample", "60"), 10);
const THRESHOLD = parseFloat(getArg("--threshold", "0.90"));
const ALL = args.includes("--all");
const MAX_TEXT_CHARS = Number(process.env.KB_EMBED_MAX_TEXT_CHARS ?? 3000);

const EMB_FILE = "knowledge/embeddings.jsonl";
const CHUNK_FILE = "knowledge/chunks.jsonl";

// Replicate generate-embeddings.mjs trimTextForEmbedding (đầu 75% + đuôi) để input KHỚP pipeline cũ.
function trimTextForEmbedding(text, maxChars) {
  if (text.length <= maxChars) return text;
  const keepHead = Math.floor(maxChars * 0.75);
  const keepTail = Math.max(200, maxChars - keepHead);
  return `${text.slice(0, keepHead)}\n\n... [TRUNCATED FOR EMBEDDING] ...\n\n${text.slice(-keepTail)}`;
}
function l2norm(v) { const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1; return v.map((x) => x / n); }

// Budget khớp generate-embeddings.mjs ở chế độ GGUF (min(MAX_TEXT_CHARS,1200)) để input
// embed lại GIỐNG HỆT lúc sinh corpus → so sánh công bằng (không lệch do cắt khác kiểu).
const GGUF_CTX_BUDGET = Math.min(MAX_TEXT_CHARS, 1200);

// mxbai context ~512 token; GGUF NÉM lỗi khi tràn → retry co nhỏ (KHÔNG head-cut riêng,
// vì input đã được trimTextForEmbedding head75%+tail giống generate).
async function embedSafe(text) {
  let t = text;
  for (let i = 0; i < 6; i++) {
    try { return await embedTextGguf(t); }
    catch (e) {
      const msg = String(e?.message || "");
      if (/context size|longer than|context length/i.test(msg) && t.length > 200) {
        t = trimTextForEmbedding(t, Math.floor(t.length * 0.7));
        continue;
      }
      throw e;
    }
  }
  return await embedTextGguf(text.slice(0, 200));
}
function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
function parseVec(e) { return Array.isArray(e) ? e : JSON.parse(e); }
const quantile = (sorted, q) => { const i = (sorted.length - 1) * q; const lo = Math.floor(i), hi = Math.ceil(i); return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo); };

async function readJsonl(file, onLine) {
  const rl = readline.createInterface({ input: fs.createReadStream(file, "utf8"), crlfDelay: Infinity });
  for await (const line of rl) { const t = line.trim(); if (t) onLine(JSON.parse(t)); }
}

async function main() {
  for (const f of [EMB_FILE, CHUNK_FILE]) {
    if (!fs.existsSync(f)) { console.error(`${C.red}Thiếu ${f}${C.reset}`); process.exit(2); }
  }
  console.log(`${C.bold}=== Kiểm chứng cosine: Ollama-mxbai (cũ) ↔ GGUF-mxbai (mới) ===${C.reset}`);
  console.log(`${C.dim}GGUF model: ${ggufEmbedModelName()} · ngưỡng cảnh báo cosine < ${THRESHOLD}${C.reset}\n`);

  // chunks: id → {title,text}
  const chunks = new Map();
  await readJsonl(CHUNK_FILE, (c) => chunks.set(c.id, { title: c.title ?? "", text: c.text ?? "" }));

  // embeddings cũ (chỉ giữ entry có text khớp)
  const entries = [];
  await readJsonl(EMB_FILE, (e) => { if (chunks.has(e.id) && (e.embedding || e.embeddingDim)) entries.push(e); });
  if (!entries.length) { console.error(`${C.red}Không có entry nào khớp id giữa 2 file.${C.reset}`); process.exit(2); }

  // lấy mẫu đều khắp corpus
  let picked = entries;
  if (!ALL && entries.length > SAMPLE) {
    picked = [];
    const stride = entries.length / SAMPLE;
    for (let i = 0; i < SAMPLE; i++) picked.push(entries[Math.floor(i * stride)]);
  }
  console.log(`${C.dim}Tổng ${entries.length} embeddings · kiểm ${picked.length} mẫu...${C.reset}`);

  const cos = [];
  const worst = [];
  let dimMismatch = 0, done = 0;
  for (const e of picked) {
    const { title, text } = chunks.get(e.id);
    const input = trimTextForEmbedding(`${title}\n${text}`, GGUF_CTX_BUDGET);
    let oldVec;
    try { oldVec = l2norm(parseVec(e.embedding)); } catch { continue; }
    const newVec = await embedSafe(input); // đã L2-normalize, cắt vừa context
    if (oldVec.length !== newVec.length) { dimMismatch++; continue; }
    const c = dot(oldVec, l2norm(newVec));
    cos.push(c);
    worst.push({ id: e.id, c, title });
    done++;
    if (done % 10 === 0) process.stdout.write(`\r${C.dim}  ...${done}/${picked.length}${C.reset}`);
  }
  process.stdout.write("\r" + " ".repeat(40) + "\r");
  await disposeGgufEmbed();

  if (!cos.length) { console.error(`${C.red}Không tính được cosine nào (dim mismatch=${dimMismatch}).${C.reset}`); process.exit(2); }

  const sorted = [...cos].sort((a, b) => a - b);
  const mean = cos.reduce((a, x) => a + x, 0) / cos.length;
  const below = cos.filter((c) => c < THRESHOLD).length;
  const belowPct = (below / cos.length) * 100;
  const stats = { min: sorted[0], p5: quantile(sorted, 0.05), p10: quantile(sorted, 0.1), median: quantile(sorted, 0.5), mean, max: sorted[sorted.length - 1] };

  console.log(`${C.bold}Kết quả (${cos.length} mẫu):${C.reset}`);
  const fmt = (x) => x.toFixed(4);
  console.log(`  min=${fmt(stats.min)}  p5=${fmt(stats.p5)}  p10=${fmt(stats.p10)}  median=${fmt(stats.median)}  mean=${C.bold}${fmt(stats.mean)}${C.reset}  max=${fmt(stats.max)}`);
  console.log(`  Số mẫu cosine < ${THRESHOLD}: ${below}/${cos.length} (${belowPct.toFixed(1)}%)`);
  if (dimMismatch) console.log(`  ${C.yellow}! dim mismatch (bỏ qua): ${dimMismatch}${C.reset}`);

  const worstFew = worst.sort((a, b) => a.c - b.c).slice(0, 5);
  console.log(`${C.dim}  5 mẫu thấp nhất:${C.reset}`);
  for (const w of worstFew) console.log(`${C.dim}    ${fmt(w.c)}  ${w.id}  "${(w.title || "").slice(0, 40)}"${C.reset}`);

  // Verdict
  console.log("");
  let exit = 0;
  if (stats.mean >= 0.97 && stats.p10 >= 0.92 && belowPct <= 5) {
    console.log(`${C.green}${C.bold}✅ AN TOÀN${C.reset} — GGUF-mxbai khớp Ollama-mxbai rất cao. Chuyển USE_LEGACY_OLLAMA=false KHÔNG cần re-embed.`);
    console.log(`${C.dim}   → Restart server với .env hiện tại là dùng được 100% local.${C.reset}`);
  } else if (stats.mean >= 0.90 && belowPct <= 20) {
    exit = 1;
    console.log(`${C.yellow}${C.bold}🟡 CẢNH BÁO${C.reset} — phần lớn khớp nhưng có lệch. KB vẫn dùng được, nhưng nên re-embed để đồng nhất corpus + query.`);
    console.log(`${C.dim}   → Re-embed:  set USE_LEGACY_OLLAMA=false rồi  node scripts/ai-kb/generate-embeddings.mjs${C.reset}`);
  } else {
    exit = 1;
    console.log(`${C.red}${C.bold}🔴 RỦI RO${C.reset} — lệch đáng kể giữa 2 backend mxbai. KB retrieval có thể sút nếu trộn vector cũ (Ollama) với query mới (GGUF).`);
    console.log(`${C.dim}   → Chọn 1: (a) RE-EMBED corpus bằng GGUF: USE_LEGACY_OLLAMA=false + node scripts/ai-kb/generate-embeddings.mjs`);
    console.log(`            (b) Giữ Ollama: đặt lại USE_LEGACY_OLLAMA=true (cần Ollama daemon chạy).${C.reset}`);
  }
  console.log(`${C.dim}\nLưu ý: chênh lệch do khác pooling/quantization giữa Ollama mxbai vs GGUF f16; re-embed bằng CÙNG engine sẽ khử hoàn toàn (corpus + query cùng GGUF).${C.reset}`);
  process.exit(exit);
}

main().catch(async (e) => { try { await disposeGgufEmbed(); } catch {} console.error(`${C.red}Lỗi: ${e?.message || e}${C.reset}`); process.exit(2); });
