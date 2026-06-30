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
 *   # baseline recall@5 (cosine only) + per-domain table:
 *   node scripts/ai-kb/eval-rag.mjs
 *   # with LLM reranker (loads the fast GGUF text model directly; gated on RAG_RERANKER_ENABLED):
 *   RAG_RERANKER_ENABLED=true node scripts/ai-kb/eval-rag.mjs --rerank
 *   # pool/topN overrides:
 *   node scripts/ai-kb/eval-rag.mjs --rerank --pool 20 --topn 5
 *   # CI gate (exit 1 if overall recall@5 < 0.80 OR any domain < 0.60):
 *   node scripts/ai-kb/eval-rag.mjs --ci
 *   KB_EVAL_MIN=0.85 KB_EVAL_DOMAIN_MIN=0.7 node scripts/ai-kb/eval-rag.mjs   # env-driven gate
 *
 * FLAGS:
 *   --rerank        apply the LLM rerank pass (only takes effect if RAG_RERANKER_ENABLED is truthy)
 *   --no-rerank     force-disable rerank even if --rerank/RAG_RERANKER_ENABLED set (pure embedding recall)
 *   --force-rerank  apply rerank ignoring the RAG_RERANKER_ENABLED gate
 *   --ci            enable the CI gate (also auto-on if KB_EVAL_MIN / KB_EVAL_DOMAIN_MIN set)
 *   --min <f>       overall recall@K floor for --ci (default 0.80; or KB_EVAL_MIN)
 *   --domain-min <f> per-domain recall@K floor for --ci (default 0.60; or KB_EVAL_DOMAIN_MIN)
 *   --pool <n> --topn <n>  rerank pool size / K
 *
 * RERANKER NOTE: production reranking lives in server/services/aiReranker.ts (TS, RAG_RERANKER_ENABLED=true,
 * RAG_RERANKER_MODE=llm). It imports the TS GGUF engine and can't be loaded from this .mjs without a TS
 * loader, so this harness re-implements the SAME llm-scoring prompt locally (llmRerank). The default
 * cosine-only metric therefore measures EMBEDDING retrieval (PRE-rerank) recall@K.
 *
 * OUTPUT: console (per-question + per-domain recall@K table + overall + CI verdict) AND a machine-readable
 * summary at knowledge/rag-eval-results.json (overall + per-domain + timestamp).
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
// W1.2-fix — load repo-root .env BEFORE reading process.env, so GGUF_EMBED_MODEL /
// GGUF_MODELS_DIR match the model the corpus was built with (else query vectors land
// in a different space and recall collapses). dotenv does NOT overwrite set keys.
import "dotenv/config";
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
// --rerank enables the (self-contained, mirrors aiReranker.ts) LLM rerank pass.
// --no-rerank is an explicit stub that force-disables it even if --rerank is passed
// or RAG_RERANKER_ENABLED=true — handy for measuring pure embedding (pre-rerank) recall.
// NOTE: production reranking lives in server/services/aiReranker.ts (RAG_RERANKER_ENABLED=true,
// RAG_RERANKER_MODE=llm). That module imports the TS GGUF engine and cannot be loaded from this
// .mjs without a TS loader, so this harness re-implements the SAME llm scoring prompt locally
// (llmRerank below). Gate it on RAG_RERANKER_ENABLED like production: --rerank only takes effect
// when RAG_RERANKER_ENABLED is truthy (unless --force-rerank is given), mirroring prod behavior.
const RERANKER_ENABLED = /^(1|true|yes|on)$/i.test(process.env.RAG_RERANKER_ENABLED || "");
const DO_RERANK =
  !has("--no-rerank") &&
  (has("--force-rerank") || (has("--rerank") && RERANKER_ENABLED));
const RERANK_REQUESTED = has("--rerank") || has("--force-rerank");
const TOP_K = Number(val("--topn", "5"));
const POOL = Number(val("--pool", "20"));

// ─── CI gate (--ci / KB_EVAL_MIN / KB_EVAL_DOMAIN_MIN) ────────────────────────
const DO_CI = has("--ci") || process.env.KB_EVAL_MIN != null || process.env.KB_EVAL_DOMAIN_MIN != null;
const CI_MIN = Number(val("--min", process.env.KB_EVAL_MIN ?? "0.80")); // overall recall@5 floor
const CI_DOMAIN_MIN = Number(val("--domain-min", process.env.KB_EVAL_DOMAIN_MIN ?? "0.60")); // per-domain floor
const RESULTS_FILE = path.join(KDIR, "rag-eval-results.json");

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
  const domainCount = new Set(questions.map((q) => q.domain || "(none)")).size;
  console.log(
    `[eval] corpus: ${embeddings.length} vectors (dim=${corpusDim}), ${questions.length} golden questions across ${domainCount} domains, K=${TOP_K}` +
      (DO_RERANK ? `, rerank pool=${POOL}` : "") +
      (DO_CI ? `, CI gate ON (min=${CI_MIN}, domain-min=${CI_DOMAIN_MIN})` : ""),
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

    // The metric used for per-domain recall + CI = reranked if reranking, else cosine.
    const effHit = DO_RERANK ? rerankHit : baseHit;
    rows.push({
      id: q.id,
      domain: q.domain || "(none)",
      base: baseHit ? "HIT" : "miss",
      rerank: DO_RERANK ? (rerankHit ? "HIT" : "miss") : "-",
      effHit,
      top1: baseTop[0]?.sourcePath ?? "(none)",
    });
  }

  const n = questions.length || 1;
  console.log("\n[eval] per-question:");
  for (const r of rows) {
    console.log(
      `  ${r.id.padEnd(7)} [${r.domain.padEnd(26)}] base=${r.base.padEnd(4)} rerank=${String(r.rerank).padEnd(4)} top1=${r.top1}`,
    );
  }

  // ─── per-domain recall@K ────────────────────────────────────────────────────
  const domains = new Map(); // domain -> { hit, total }
  for (const r of rows) {
    const d = domains.get(r.domain) || { hit: 0, total: 0 };
    d.total++;
    if (r.effHit) d.hit++;
    domains.set(r.domain, d);
  }
  const domainNames = [...domains.keys()].sort();
  const metricLabel = DO_RERANK ? "reranked" : "cosine";

  console.log(`\n[eval] ── per-domain recall@${TOP_K} (${metricLabel}) ──`);
  const failedDomains = [];
  for (const d of domainNames) {
    const { hit, total } = domains.get(d);
    const recall = hit / total;
    const flag = DO_CI && recall < CI_DOMAIN_MIN ? "  ✗ BELOW FLOOR" : "";
    if (DO_CI && recall < CI_DOMAIN_MIN) failedDomains.push({ domain: d, recall, hit, total });
    console.log(`  ${d.padEnd(28)} ${String(hit).padStart(3)}/${String(total).padEnd(3)} = ${recall.toFixed(3)}${flag}`);
  }

  console.log("\n[eval] ── results ──");
  console.log(`  recall@${TOP_K} (cosine baseline): ${baseHits}/${n} = ${(baseHits / n).toFixed(3)}`);
  const effHits = DO_RERANK ? rerankHits : baseHits;
  if (DO_RERANK) {
    console.log(`  recall@${TOP_K} (reranked):        ${rerankHits}/${n} = ${(rerankHits / n).toFixed(3)}`);
    const lift = (rerankHits - baseHits) / n;
    console.log(`  reranker lift:                  ${lift >= 0 ? "+" : ""}${lift.toFixed(3)}`);
  } else if (RERANK_REQUESTED && !DO_RERANK) {
    console.log(
      "  NOTE: --rerank requested but reranker not applied (RAG_RERANKER_ENABLED is not truthy, or --no-rerank set).",
    );
    console.log("        This number is PURE EMBEDDING retrieval recall (pre-rerank). Use --force-rerank to override the gate.");
  } else {
    console.log("  NOTE: cosine-only — this measures EMBEDDING retrieval (pre-rerank) recall@K.");
    console.log("        Production also applies server/services/aiReranker.ts (RAG_RERANKER_ENABLED=true, mode=llm).");
    console.log("        Run with --rerank and RAG_RERANKER_ENABLED=true to approximate the production reranked recall.");
  }

  // ─── machine-readable summary → knowledge/rag-eval-results.json ──────────────
  const summary = {
    metric: metricLabel,
    k: TOP_K,
    overall: { hit: effHits, total: n, recall: Number((effHits / n).toFixed(4)) },
    cosineBaseline: { hit: baseHits, total: n, recall: Number((baseHits / n).toFixed(4)) },
    reranked: DO_RERANK ? { hit: rerankHits, total: n, recall: Number((rerankHits / n).toFixed(4)) } : null,
    perDomain: Object.fromEntries(
      domainNames.map((d) => {
        const { hit, total } = domains.get(d);
        return [d, { hit, total, recall: Number((hit / total).toFixed(4)) }];
      }),
    ),
    gate: DO_CI ? { min: CI_MIN, domainMin: CI_DOMAIN_MIN } : null,
  };
  // Timestamp via the existing pattern: optional, never let it break the run.
  try {
    summary.timestamp = new Date().toISOString();
  } catch {
    /* omit timestamp rather than break */
  }
  try {
    fs.writeFileSync(RESULTS_FILE, JSON.stringify(summary, null, 2) + "\n");
    console.log(`\n[eval] wrote machine-readable summary → ${path.relative(ROOT, RESULTS_FILE)}`);
  } catch (e) {
    console.warn("[eval] could not write results JSON:", e?.message ?? e);
  }

  // ─── CI gate ────────────────────────────────────────────────────────────────
  let ciFail = false;
  if (DO_CI) {
    const overallRecall = effHits / n;
    console.log(`\n[eval] ── CI gate ── (overall min=${CI_MIN}, per-domain floor=${CI_DOMAIN_MIN})`);
    if (overallRecall < CI_MIN) {
      ciFail = true;
      console.log(`  ✗ overall recall@${TOP_K} ${overallRecall.toFixed(3)} < ${CI_MIN}`);
    } else {
      console.log(`  ✓ overall recall@${TOP_K} ${overallRecall.toFixed(3)} ≥ ${CI_MIN}`);
    }
    if (failedDomains.length) {
      ciFail = true;
      console.log(`  ✗ ${failedDomains.length} domain(s) below floor ${CI_DOMAIN_MIN}:`);
      for (const f of failedDomains) {
        console.log(`      - ${f.domain}: ${f.hit}/${f.total} = ${f.recall.toFixed(3)}`);
      }
    } else {
      console.log(`  ✓ all domains ≥ ${CI_DOMAIN_MIN}`);
    }
    console.log(ciFail ? "  RESULT: FAIL" : "  RESULT: PASS");
  }

  try {
    const mod = await import("./_gguf-embed.mjs");
    await mod.disposeGgufEmbed?.();
  } catch {}
  if (_model) { try { await _model.dispose(); } catch {} }
  process.exit(DO_CI && ciFail ? 1 : 0);
}

main().catch((err) => {
  console.error("[eval] failed:", err?.message ?? err);
  process.exit(1);
});
