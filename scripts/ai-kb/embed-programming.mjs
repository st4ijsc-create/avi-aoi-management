/**
 * Doc 34 P1 — Embed the programming (vendor-manual) knowledge collections.
 *
 * Reads   knowledge/programming/<vendor>/chunks.jsonl   (from ingest-manuals.mjs)
 * Writes  knowledge/programming/<vendor>/embeddings.jsonl  → { id, vector }
 *         (1024-dim, L2-normalized, Qwen3-Embedding-0.6B space — matches manifest.embedModel
 *          and the query embedding used by aiProgrammingKnowledgeService.)
 *
 * Loads node-llama-cpp DIRECTLY with gpuLayers:"max" so the embed model runs on
 * the GPU (the shared helper _gguf-embed.mjs uses gpuLayers:-1 which node-llama-cpp
 * 3.x silently treats as 0 = CPU; that is the ~23min-per-2k-chunks slow path).
 *
 * Incremental: skips chunk ids already present in embeddings.jsonl.
 *
 * Flags:
 *   --only <vendorSlug>     embed just one collection (dir name under PROG_KB_DIR)
 *   --max-per-doc <N>       cap chunks embedded per source doc (volume control; 0 = no cap)
 *   --measure <N>           embed at most N chunks total, then stop + print rate (dry: no write)
 *   --limit <N>             embed at most N chunks total (writes)
 *
 * ENV: PROG_KB_DIR (default knowledge/programming), GGUF_MODELS_DIR, GGUF_EMBED_MODEL,
 *      GGUF_GPU ("false" → CPU).
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const ROOT = process.cwd();
const PROG_KB_DIR = path.resolve(process.env.PROG_KB_DIR || path.join("knowledge", "programming"));
const GGUF_MODELS_DIR = process.env.GGUF_MODELS_DIR
  ? path.resolve(process.env.GGUF_MODELS_DIR)
  : path.join(ROOT, "uploads", "gguf-models");
const EMBED_FILE = (() => {
  const raw = process.env.GGUF_EMBED_MODEL || "Qwen3-Embedding-0.6B-f16.gguf";
  return raw.endsWith(".gguf") ? raw : `${raw}.gguf`;
})();

function arg(name, def = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}
const ONLY = arg("--only");
const MAX_PER_DOC = parseInt(arg("--max-per-doc", "0"), 10) || 0;
const MEASURE = parseInt(arg("--measure", "0"), 10) || 0;
const LIMIT = parseInt(arg("--limit", "0"), 10) || 0;

function resolveEmbedModelPath() {
  if (path.isAbsolute(EMBED_FILE) && fs.existsSync(EMBED_FILE)) return EMBED_FILE;
  const p = path.join(GGUF_MODELS_DIR, EMBED_FILE);
  if (fs.existsSync(p)) return p;
  throw new Error(`Embed model not found: ${EMBED_FILE} (looked in ${GGUF_MODELS_DIR})`);
}

function l2norm(vec) {
  const n = Math.sqrt(vec.reduce((a, v) => a + v * v, 0)) || 1;
  return vec.map((v) => v / n);
}

async function readExistingIds(file) {
  const ids = new Set();
  if (!fs.existsSync(file)) return ids;
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    const t = line.trim();
    if (!t) continue;
    try { const o = JSON.parse(t); if (o.id) ids.add(o.id); } catch { /* skip */ }
  }
  return ids;
}

async function* readChunks(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    const t = line.trim();
    if (!t) continue;
    try { yield JSON.parse(t); } catch { /* skip */ }
  }
}

function listCollections() {
  if (!fs.existsSync(PROG_KB_DIR)) return [];
  return fs.readdirSync(PROG_KB_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((v) => !ONLY || v.toLowerCase() === ONLY.toLowerCase())
    .filter((v) => fs.existsSync(path.join(PROG_KB_DIR, v, "chunks.jsonl")));
}

async function main() {
  const collections = listCollections();
  if (!collections.length) {
    console.error(`[prog-embed] no collections under ${PROG_KB_DIR}${ONLY ? ` matching --only ${ONLY}` : ""}`);
    process.exit(1);
  }
  console.log(`[prog-embed] model=${EMBED_FILE} dir=${PROG_KB_DIR}`);
  console.log(`[prog-embed] collections: ${collections.join(", ")}`);
  if (MEASURE) console.log(`[prog-embed] MEASURE mode: embed up to ${MEASURE} chunks, no write`);

  const { getLlama } = await import("node-llama-cpp");
  const llama = await getLlama({ gpu: process.env.GGUF_GPU === "false" ? false : "auto" });
  const model = await llama.loadModel({ modelPath: resolveEmbedModelPath(), gpuLayers: "max" });
  const ctx = await model.createEmbeddingContext({ contextSize: "auto" });
  console.log(`[prog-embed] gpu=${llama.gpu} vram=${JSON.stringify(await llama.getVramState().catch(() => ({})))}`);

  let totalDone = 0;
  const t0 = Date.now();
  outer:
  for (const vendor of collections) {
    const dir = path.join(PROG_KB_DIR, vendor);
    const chunksFile = path.join(dir, "chunks.jsonl");
    const embFile = path.join(dir, "embeddings.jsonl");
    const existing = MEASURE ? new Set() : await readExistingIds(embFile);
    const out = MEASURE ? null : fs.createWriteStream(embFile, { flags: "a" });
    const perDoc = new Map();
    let vDone = 0, vSkip = 0;

    for await (const ch of readChunks(chunksFile)) {
      if (!ch.id || !ch.text) continue;
      if (existing.has(ch.id)) { vSkip++; continue; }
      if (MAX_PER_DOC) {
        const k = ch.sourcePath || ch.docTitle || "";
        const c = perDoc.get(k) || 0;
        if (c >= MAX_PER_DOC) continue;
        perDoc.set(k, c + 1);
      }
      let vec;
      try {
        const r = await ctx.getEmbeddingFor(ch.text);
        vec = l2norm(Array.from(r.vector));
      } catch (e) {
        console.warn(`[prog-embed] embed failed id=${ch.id}: ${e?.message ?? e}`);
        continue;
      }
      if (out) out.write(JSON.stringify({ id: ch.id, vector: vec }) + "\n");
      vDone++; totalDone++;
      if (totalDone % 250 === 0) {
        const rate = totalDone / ((Date.now() - t0) / 1000);
        console.log(`[prog-embed] ${vendor}: +${vDone} (total ${totalDone}, ${rate.toFixed(1)}/s)`);
      }
      if (MEASURE && totalDone >= MEASURE) { if (out) out.end(); break outer; }
      if (LIMIT && totalDone >= LIMIT) { if (out) out.end(); break outer; }
    }
    if (out) out.end();
    console.log(`[prog-embed] ${vendor}: embedded ${vDone}, skipped(existing) ${vSkip}`);
  }

  const secs = (Date.now() - t0) / 1000;
  console.log(`[prog-embed] DONE: ${totalDone} chunks in ${secs.toFixed(1)}s (${(totalDone / secs).toFixed(1)}/s)`);
  try { await ctx.dispose(); await model.dispose(); } catch { /* best-effort */ }
}

main().catch((e) => { console.error("[prog-embed] FATAL", e); process.exit(1); });
