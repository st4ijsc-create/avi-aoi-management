import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const KNOWLEDGE_DIR = path.join(ROOT, "knowledge");
const CHUNKS_FILE = path.join(KNOWLEDGE_DIR, "chunks.jsonl");
const OUT_FILE = path.join(KNOWLEDGE_DIR, "embeddings.jsonl");

const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/$/, "");
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL ?? "mxbai-embed-large";
const LIMIT = Number(process.env.KB_EMBED_LIMIT ?? 0);
const MAX_TEXT_CHARS = Number(process.env.KB_EMBED_MAX_TEXT_CHARS ?? 3000);

// WS-G4 — default to in-process GGUF embeddings (no Ollama daemon). Set
// USE_LEGACY_OLLAMA=true to use the legacy Ollama HTTP path (rollback).
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

async function embedWithApiEmbed(input) {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_EMBED_MODEL,
      input,
    }),
  });

  if (!res.ok) {
    throw new Error(`Ollama /api/embed failed: ${res.status} ${await res.text()}`);
  }

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
    body: JSON.stringify({
      model: OLLAMA_EMBED_MODEL,
      prompt,
    }),
  });

  if (!res.ok) {
    throw new Error(`Ollama /api/embeddings failed: ${res.status} ${await res.text()}`);
  }

  const json = await res.json();
  const vec = json.embedding;
  if (!Array.isArray(vec) || !vec.length) {
    throw new Error("Ollama /api/embeddings returned empty embedding");
  }
  return vec;
}

// Lazily-loaded GGUF helper (only imported when not using legacy Ollama, so the
// Ollama path keeps zero native deps).
let _embedTextGguf = null;
async function getGgufEmbedder() {
  if (_embedTextGguf) return _embedTextGguf;
  const mod = await import("./_gguf-embed.mjs");
  _embedTextGguf = mod.embedTextGguf;
  return _embedTextGguf;
}

async function embed(text) {
  if (!USE_LEGACY_OLLAMA) {
    // _gguf-embed already L2-normalizes; l2norm() below is idempotent on a unit vector.
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
  // Keep beginning and ending context instead of only prefix.
  const keepHead = Math.floor(maxChars * 0.75);
  const keepTail = Math.max(200, maxChars - keepHead);
  return `${text.slice(0, keepHead)}\n\n... [TRUNCATED FOR EMBEDDING] ...\n\n${text.slice(-keepTail)}`;
}

async function embedWithRetry(text) {
  let candidate = trimTextForEmbedding(text, MAX_TEXT_CHARS);

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      return await embed(candidate);
    } catch (err) {
      const msg = String(err?.message ?? "");
      const tooLong =
        msg.includes("exceeds the context length") ||
        msg.includes("input length") ||
        msg.includes("context length") ||
        msg.includes("too large") ||
        msg.includes("failed: 500");

      if (!tooLong || candidate.length < 1000 || attempt === 4) {
        throw err;
      }

      candidate = trimTextForEmbedding(candidate, Math.floor(candidate.length * 0.7));
    }
  }

  throw new Error("Unreachable embedding retry path");
}

function l2norm(vec) {
  const sum = vec.reduce((acc, v) => acc + v * v, 0);
  const norm = Math.sqrt(sum) || 1;
  return vec.map((v) => v / norm);
}

async function run() {
  if (!fs.existsSync(CHUNKS_FILE)) {
    throw new Error("Missing knowledge/chunks.jsonl. Run kb:chunk first.");
  }

  const chunks = parseJsonl(CHUNKS_FILE);
  const slice = LIMIT > 0 ? chunks.slice(0, LIMIT) : chunks;

  if (!slice.length) {
    throw new Error("No chunks found to embed.");
  }

  const output = fs.createWriteStream(OUT_FILE, { flags: "w", encoding: "utf8" });
  const startedAt = Date.now();

  let skipped = 0;
  for (let i = 0; i < slice.length; i += 1) {
    const c = slice[i];
    const text = `${c.title}\n${c.text}`;
    let vector;
    try {
      vector = l2norm(await embedWithRetry(text));
    } catch (err) {
      skipped += 1;
      console.warn(`[kb] SKIP chunk ${c.id} (${c.sourcePath}) after retries: ${err?.message ?? err}`);
      continue;
    }

    output.write(
      JSON.stringify({
        id: c.id,
        sourceType: c.sourceType,
        sourcePath: c.sourcePath,
        title: c.title,
        keywords: c.keywords,
        textLength: c.text.length,
        embeddingDim: vector.length,
        embedding: vector,
      }) + "\n",
    );

    if ((i + 1) % 20 === 0 || i === slice.length - 1) {
      console.log(`[kb] Embedded ${i + 1}/${slice.length} (skipped ${skipped})`);
    }
  }

  output.end();

  // WS-G4 — record the embedding engine/model actually used, so cosine-compat can be audited.
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
    totalEmbedded: slice.length,
    elapsedMs: Date.now() - startedAt,
    outputFile: "knowledge/embeddings.jsonl",
  };

  fs.writeFileSync(path.join(KNOWLEDGE_DIR, "embeddings-meta.json"), JSON.stringify(meta, null, 2));

  console.log("[kb] Embeddings generation complete");
  console.log(`[kb] Output: ${meta.outputFile}`);
}

run().catch((err) => {
  console.error("[kb] Embedding generation failed:", err.message);
  process.exit(1);
});
