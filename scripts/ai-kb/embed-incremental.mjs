/**
 * C1a — KB incremental embedding (hash-based).
 *
 * Re-embeds ONLY the chunks whose id is new or whose `hash` changed; reuses the
 * existing vector for unchanged chunks; drops vectors of deleted chunks. This
 * avoids the ~23.5 min full re-embed when only a few KB files changed.
 *
 * Requires:
 *   - knowledge/chunks.jsonl  built with stable ids + `hash`
 *     (scripts/ai-kb/build-knowledge-chunks.mjs).
 *   - knowledge/embeddings.jsonl  carrying `id` + `hash` per row
 *     (scripts/ai-kb/generate-embeddings.mjs, or a prior run of this script).
 *
 * One-time migration note: the FIRST run after switching to stable ids will
 * treat every chunk as "added" (old embeddings.jsonl has no matching id/hash),
 * i.e. a full re-embed. After that, reuse-by-hash kicks in.
 *
 * Vector-space consistency: embeds the SAME string (`title\ntext`), with the
 * SAME trim/retry policy and L2 normalization as generate-embeddings.mjs, using
 * the SAME GGUF mxbai model — so reused and freshly-embedded vectors share one
 * space. Offline-first (GGUF, no Ollama); set USE_LEGACY_OLLAMA=true to fall
 * back to the legacy Ollama HTTP path.
 *
 * Output rows match generate-embeddings.mjs schema:
 *   { id, hash, sourceType, sourcePath, title, keywords, textLength,
 *     embeddingDim, embedding }
 * written in the order of the new chunks.jsonl.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = process.cwd();
const KNOWLEDGE_DIR = path.join(ROOT, "knowledge");
const CHUNKS_FILE = path.join(KNOWLEDGE_DIR, "chunks.jsonl");
const EMBEDDINGS_FILE = path.join(KNOWLEDGE_DIR, "embeddings.jsonl");
const META_FILE = path.join(KNOWLEDGE_DIR, "embeddings-meta.json");

const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/$/, "");
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL ?? "mxbai-embed-large";
const MAX_TEXT_CHARS = Number(process.env.KB_EMBED_MAX_TEXT_CHARS ?? 3000);
const USE_LEGACY_OLLAMA = (process.env.USE_LEGACY_OLLAMA ?? "false").toLowerCase() === "true";

function parseJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

// Same canonical hash as build-knowledge-chunks.makeChunk (sha256 of `title\ntext`).
function chunkHash(title, text) {
  return crypto.createHash("sha256").update(`${title}\n${text}`, "utf8").digest("hex");
}

// ─── Embedding (mirrors generate-embeddings.mjs to keep one vector space) ──────
async function embedWithApiEmbed(input) {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: OLLAMA_EMBED_MODEL, input }),
  });
  if (!res.ok) throw new Error(`Ollama /api/embed failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  const vectors = json.embeddings ?? [];
  if (!Array.isArray(vectors) || !vectors.length) {
    throw new Error("Ollama /api/embed returned no embeddings");
  }
  return vectors[0];
}

async function embedWithApiEmbeddings(prompt) {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: OLLAMA_EMBED_MODEL, prompt }),
  });
  if (!res.ok) throw new Error(`Ollama /api/embeddings failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  const vec = json.embedding;
  if (!Array.isArray(vec) || !vec.length) {
    throw new Error("Ollama /api/embeddings returned empty embedding");
  }
  return vec;
}

let _embedTextGguf = null;
async function getGgufEmbedder() {
  if (_embedTextGguf) return _embedTextGguf;
  const mod = await import("./_gguf-embed.mjs");
  _embedTextGguf = mod.embedTextGguf;
  return _embedTextGguf;
}

async function embed(text) {
  if (!USE_LEGACY_OLLAMA) {
    const embedTextGguf = await getGgufEmbedder();
    return embedTextGguf(text);
  }
  try {
    return await embedWithApiEmbed(text);
  } catch {
    return await embedWithApiEmbeddings(text);
  }
}

function trimTextForEmbedding(text, maxChars) {
  if (text.length <= maxChars) return text;
  const keepHead = Math.floor(maxChars * 0.75);
  const keepTail = Math.max(200, maxChars - keepHead);
  return `${text.slice(0, keepHead)}\n\n... [TRUNCATED FOR EMBEDDING] ...\n\n${text.slice(-keepTail)}`;
}

async function embedWithRetry(text) {
  const startMax = USE_LEGACY_OLLAMA ? MAX_TEXT_CHARS : Math.min(MAX_TEXT_CHARS, 1200);
  let candidate = trimTextForEmbedding(text, startMax);

  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      return await embed(candidate);
    } catch (err) {
      const msg = String(err?.message ?? "").toLowerCase();
      const tooLong =
        msg.includes("exceeds the context length") ||
        msg.includes("input length") ||
        msg.includes("context length") ||
        msg.includes("context size") ||
        msg.includes("longer than the context") ||
        msg.includes("too large") ||
        msg.includes("failed: 500");

      if (!tooLong || candidate.length < 250 || attempt === 6) throw err;
      candidate = trimTextForEmbedding(candidate, Math.floor(candidate.length * 0.7));
    }
  }
  throw new Error("Unreachable embedding retry path");
}

function l2norm(vec) {
  const norm = Math.sqrt(vec.reduce((acc, v) => acc + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

async function run() {
  if (!fs.existsSync(CHUNKS_FILE)) {
    throw new Error("Missing knowledge/chunks.jsonl. Run kb:chunk first.");
  }

  const chunks = parseJsonl(CHUNKS_FILE);
  if (!chunks.length) throw new Error("No chunks found to embed.");

  // Old vectors keyed by id; remember each row's hash for reuse decisions.
  const oldRows = parseJsonl(EMBEDDINGS_FILE);
  const oldById = new Map();
  for (const row of oldRows) {
    if (row && typeof row.id === "string") oldById.set(row.id, row);
  }

  const startedAt = Date.now();
  let added = 0;
  let changed = 0;
  let unchanged = 0;
  let skipped = 0;

  const newIds = new Set();
  const outLines = [];

  for (let i = 0; i < chunks.length; i += 1) {
    const c = chunks[i];
    newIds.add(c.id);
    const hash = c.hash ?? chunkHash(c.title, c.text);
    const prev = oldById.get(c.id);

    // Reuse only when id matches AND hash matches AND a usable vector exists.
    if (prev && prev.hash === hash && Array.isArray(prev.embedding) && prev.embedding.length) {
      unchanged += 1;
      outLines.push(
        JSON.stringify({
          id: c.id,
          hash,
          sourceType: c.sourceType,
          sourcePath: c.sourcePath,
          title: c.title,
          keywords: c.keywords,
          textLength: c.text.length,
          embeddingDim: prev.embedding.length,
          embedding: prev.embedding,
        }),
      );
      continue;
    }

    const isNew = !prev;
    const text = `${c.title}\n${c.text}`;
    let vector;
    try {
      vector = l2norm(await embedWithRetry(text));
    } catch (err) {
      skipped += 1;
      console.warn(`[kb] SKIP chunk ${c.id} (${c.sourcePath}) after retries: ${err?.message ?? err}`);
      continue;
    }

    if (isNew) added += 1;
    else changed += 1;

    outLines.push(
      JSON.stringify({
        id: c.id,
        hash,
        sourceType: c.sourceType,
        sourcePath: c.sourcePath,
        title: c.title,
        keywords: c.keywords,
        textLength: c.text.length,
        embeddingDim: vector.length,
        embedding: vector,
      }),
    );

    const done = added + changed;
    if (done % 20 === 0) {
      console.log(`[kb] Re-embedded ${done} (added ${added}, changed ${changed}, skipped ${skipped})`);
    }
  }

  // Removed = old ids not present in the new chunk set.
  let removed = 0;
  for (const id of oldById.keys()) {
    if (!newIds.has(id)) removed += 1;
  }

  fs.writeFileSync(EMBEDDINGS_FILE, outLines.join("\n") + "\n", "utf8");

  // Resolve engine/model for meta and free the GGUF model if it was loaded.
  let modelName = OLLAMA_EMBED_MODEL;
  let engine = "ollama";
  if (!USE_LEGACY_OLLAMA) {
    engine = "gguf";
    try {
      const mod = await import("./_gguf-embed.mjs");
      modelName = mod.ggufEmbedModelName();
      await mod.disposeGgufEmbed();
    } catch {
      modelName = process.env.GGUF_EMBED_MODEL ?? "mxbai-embed-large-v1-f16";
    }
  }

  const meta = {
    generatedAt: new Date().toISOString(),
    engine,
    model: modelName,
    baseUrl: USE_LEGACY_OLLAMA ? OLLAMA_BASE_URL : undefined,
    mode: "incremental",
    totalEmbedded: outLines.length,
    added,
    changed,
    unchanged,
    removed,
    skipped,
    elapsedMs: Date.now() - startedAt,
    outputFile: "knowledge/embeddings.jsonl",
  };
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2));

  console.log("[kb] Incremental embedding complete");
  console.log(
    `[kb] added=${added} changed=${changed} unchanged=${unchanged} removed=${removed} skipped=${skipped} total=${outLines.length}`,
  );
  console.log(`[kb] Output: ${meta.outputFile} (${meta.elapsedMs} ms)`);
}

run().catch((err) => {
  console.error("[kb] Incremental embedding failed:", err.message);
  process.exit(1);
});
