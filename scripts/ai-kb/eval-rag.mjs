/**
 * Phase B2.5 — RAG golden-set eval (recall@5 + reranker lift).
 *
 * Measures retrieval quality of the FILE-BASED KB (knowledge/embeddings.jsonl)
 * against knowledge/rag-eval-goldenset.json. Self-contained: re-implements the
 * same bruteforce cosine retrieval the server uses (semantic 0.72 + keyword 0.28
 * blend is NOT replicated here — this harness measures pure semantic recall,
 * which is the signal the reranker operates on), then optionally applies the
 * LLM reranker and reports the lift.
 *
 * USAGE (run manually; do NOT need the server running):
 *   # baseline recall@5 (cosine only):
 *   node scripts/ai-kb/eval-rag.mjs
 *   # with LLM reranker (loads the fast GGUF text model directly):
 *   RAG_RERANKER_ENABLED=true node scripts/ai-kb/eval-rag.mjs --rerank
 *   # pool/topN overrides:
 *   node scripts/ai-kb/eval-rag.mjs --rerank --pool 20 --topn 5
 *
 * ENV (reuses the server's GGUF config):
 *   GGUF_MODELS_DIR, GGUF_EMBED_MODEL  → query embeddings (MUST match the model the
 *       corpus was built with, or query vectors land in a different space and recall
 *       collapses). This corpus = Qwen3-Embedding-0.6B-f16 (see embeddings-meta.json),
 *       so on this machine run with:
 *         GGUF_MODELS_DIR=D:/SOURCES/16.AI GGUF_EMBED_MODEL=Qwen3-Embedding-0.6B-f16.gguf node scripts/ai-kb/eval-rag.mjs
 *       (the default uploads/gguf-models/mxbai model is a DIFFERENT space → wrong numbers.)
 *   GGUF_FAST_MODEL                    → text model used by the --rerank pass
 *   GGUF_GPU=false                     → force CPU
 *
 * Measured baseline (this corpus, 2026-06): recall@5 = 12/12 = 1.000 with the
 * correct Qwen3 embed model. The golden set is grounded so retrieval already
 * saturates recall@5; the reranker's value here is ORDERING precision (top-1
 * correctness), not recall — extend the golden set with harder distractor
 * questions to expose reranker lift on recall.
 *
 * A HIT for a question = at least one of the top-K retrieved chunks has a
 * sourcePath containing any expectSourceContains entry (case-insensitive) OR a
 * chunk text containing any expectKeywords entry. recall@5 = hits / total.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const KDIR = path.join(ROOT, "knowledge");
const EMB_FILE = path.join(KDIR, "embeddings.jsonl");
const CHUNKS_FILE = path.join(KDIR, "chunks.jsonl");
const GOLDEN_FILE = path.join(KDIR, "rag-eval-goldenset.json");

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const DO_RERANK = has("--rerank");
const TOP_K = Number(val("--topn", "5"));
const POOL = Number(val("--pool", "20"));

function parseJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function cosine(a, b) {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot;
}

function isHit(chunk, q) {
  const sp = (chunk.sourcePath || "").toLowerCase();
  const tx = (chunk.text || "").toLowerCase();
  const srcOk = (q.expectSourceContains || []).some((s) => sp.includes(s.toLowerCase()));
  const kwOk = (q.expectKeywords || []).some((k) => tx.includes(k.toLowerCase()));
  return srcOk || kwOk;
}

// ─── Fast text model loader for the optional --rerank pass ────────────────────
let _llama = null;
let _model = null;
let _session = null;

async function loadFastModel() {
  if (_session) return _session;
  const { getLlama, LlamaChatSession } = await import("node-llama-cpp");
  _llama = await getLlama({ gpu: process.env.GGUF_GPU === "false" ? false : "auto" });
  const dir = process.env.GGUF_MODELS_DIR
    ? path.resolve(process.env.GGUF_MODELS_DIR)
    : path.join(ROOT, "uploads", "gguf-models");
  const raw = process.env.GGUF_FAST_MODEL || "Qwen3-4B-Instruct-2507-UD-Q4_K_XL.gguf";
  const file = raw.endsWith(".gguf") ? raw : `${raw}.gguf`;
  const modelPath = path.isAbsolute(file) ? file : path.join(dir, file);
  if (!fs.existsSync(modelPath)) {
    throw new Error(`Fast model not found for rerank: ${modelPath}`);
  }
  _model = await _llama.loadModel({ modelPath, gpuLayers: -1 });
  const ctx = await _model.createContext({ contextSize: { min: 2048, max: 8192 } });
  _session = new LlamaChatSession({ contextSequence: ctx.getSequence() });
  return _session;
}

// Mirrors aiReranker.ts: ONE scoring call returns [{i,s}] per candidate.
async function llmRerank(query, pool, topN) {
  const session = await loadFastModel();
  const docs = pool
    .map((c, i) => `[${i}] ${(c.title ? c.title + " — " : "") + (c.text || "").replace(/\s+/g, " ").slice(0, 480)}`)
    .join("\n");
  const prompt =
    `You are a precise search reranker. Score how well each document answers the query.\n` +
    `Query: ${query.slice(0, 400)}\n\nDocuments:\n${docs}\n\n` +
    `Output ONLY a JSON array like [{"i":0,"s":0.9},{"i":1,"s":0.2}] covering every index 0..${pool.length - 1}, ` +
    `where s is relevance from 0.0 to 1.0.`;
  let out = "";
  try {
    out = await session.prompt(prompt, { temperature: 0, maxTokens: Math.min(900, 40 + pool.length * 14) });
  } catch (e) {
    console.warn("  [rerank] generation failed, keeping cosine order:", e?.message ?? e);
    return pool.slice(0, topN);
  }
  const scores = new Array(pool.length).fill(0);
  let any = false;
  const re = /\{\s*"?i"?\s*:\s*(\d+)\s*,\s*"?s"?\s*:\s*([0-9]*\.?[0-9]+)\s*\}/g;
  let m;
  while ((m = re.exec(out)) !== null) {
    const idx = Number(m[1]);
    let s = Number(m[2]);
    if (idx >= 0 && idx < pool.length && Number.isFinite(s)) {
      if (s > 1) s = s / 10;
      scores[idx] = s;
      any = true;
    }
  }
  if (!any) return pool.slice(0, topN);
  return pool
    .map((c, i) => ({ c, s: 0.85 * scores[i] + 0.15 * (c._cos ?? 0) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, topN)
    .map((x) => x.c);
}

async function main() {
  const embeddings = parseJsonl(EMB_FILE);
  const chunks = parseJsonl(CHUNKS_FILE);
  const byId = new Map(chunks.map((c) => [c.id, c]));
  const golden = JSON.parse(fs.readFileSync(GOLDEN_FILE, "utf8"));
  const questions = golden.questions || [];

  if (!embeddings.length) throw new Error("No embeddings. Run kb:embed first.");
  const corpusDim = embeddings[0].embedding.length;
  console.log(
    `[eval] corpus: ${embeddings.length} vectors (dim=${corpusDim}), ${questions.length} golden questions, K=${TOP_K}` +
      (DO_RERANK ? `, rerank pool=${POOL}` : ""),
  );

  const { embedTextGguf } = await import("./_gguf-embed.mjs");

  let baseHits = 0;
  let rerankHits = 0;
  const rows = [];

  for (const q of questions) {
    const qVec = await embedTextGguf(q.question);
    if (qVec.length !== corpusDim) {
      console.warn(`  [warn] query dim ${qVec.length} ≠ corpus dim ${corpusDim} — check GGUF_EMBED_MODEL`);
    }
    const scored = embeddings.map((e) => ({
      id: e.id,
      cos: cosine(qVec, e.embedding),
    }));
    scored.sort((a, b) => b.cos - a.cos);

    const baseTop = scored.slice(0, TOP_K).map((s) => byId.get(s.id)).filter(Boolean);
    const baseHit = baseTop.some((c) => isHit(c, q));
    if (baseHit) baseHits++;

    let rerankHit = baseHit;
    if (DO_RERANK) {
      const pool = scored.slice(0, POOL).map((s) => {
        const c = byId.get(s.id);
        return c ? { ...c, _cos: s.cos } : null;
      }).filter(Boolean);
      const rr = await llmRerank(q.question, pool, TOP_K);
      rerankHit = rr.some((c) => isHit(c, q));
      if (rerankHit) rerankHits++;
    }

    rows.push({
      id: q.id,
      base: baseHit ? "HIT" : "miss",
      rerank: DO_RERANK ? (rerankHit ? "HIT" : "miss") : "-",
      top1: baseTop[0]?.sourcePath ?? "(none)",
    });
  }

  const n = questions.length || 1;
  console.log("\n[eval] per-question:");
  for (const r of rows) {
    console.log(`  ${r.id.padEnd(4)} base=${r.base.padEnd(4)} rerank=${String(r.rerank).padEnd(4)} top1=${r.top1}`);
  }
  console.log("\n[eval] ── results ──");
  console.log(`  recall@${TOP_K} (cosine baseline): ${baseHits}/${n} = ${(baseHits / n).toFixed(3)}`);
  if (DO_RERANK) {
    console.log(`  recall@${TOP_K} (reranked):        ${rerankHits}/${n} = ${(rerankHits / n).toFixed(3)}`);
    const lift = (rerankHits - baseHits) / n;
    console.log(`  reranker lift:                  ${lift >= 0 ? "+" : ""}${lift.toFixed(3)}`);
  } else {
    console.log("  (run with --rerank and RAG_RERANKER_ENABLED=true to measure reranker lift)");
  }

  try {
    const mod = await import("./_gguf-embed.mjs");
    await mod.disposeGgufEmbed?.();
  } catch {}
  if (_model) { try { await _model.dispose(); } catch {} }
  process.exit(0);
}

main().catch((err) => {
  console.error("[eval] failed:", err?.message ?? err);
  process.exit(1);
});
