// W1.2-fix — load repo-root .env BEFORE reading process.env (KB_GRAPH_* tuning).
// dotenv (a project dependency) does NOT overwrite already-set process.env keys.
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const KNOWLEDGE_DIR = path.join(ROOT, "knowledge");
const EMBEDDINGS_FILE = path.join(KNOWLEDGE_DIR, "embeddings.jsonl");
const OUT_FILE = path.join(KNOWLEDGE_DIR, "semantic-graph.json");

const MAX_NODES = Number(process.env.KB_GRAPH_MAX_NODES ?? 1200);
const TOP_K = Number(process.env.KB_GRAPH_TOP_K ?? 3);
const MIN_SIM = Number(process.env.KB_GRAPH_MIN_SIM ?? 0.72);

function parseJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function cosine(a, b) {
  let s = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) s += a[i] * b[i];
  return s;
}

function run() {
  const all = parseJsonl(EMBEDDINGS_FILE);
  if (!all.length) {
    throw new Error("Missing knowledge/embeddings.jsonl or empty file.");
  }

  const nodes = all.slice(0, Math.max(1, MAX_NODES));

  const graphNodes = nodes.map((n) => ({
    id: n.id,
    sourceType: n.sourceType,
    sourcePath: n.sourcePath,
    title: n.title,
    keywords: n.keywords ?? [],
    embeddingDim: n.embeddingDim,
  }));

  const edges = [];

  for (let i = 0; i < nodes.length; i += 1) {
    const base = nodes[i];
    const scored = [];

    for (let j = 0; j < nodes.length; j += 1) {
      if (i === j) continue;
      const target = nodes[j];
      const sim = cosine(base.embedding, target.embedding);
      if (sim >= MIN_SIM) {
        scored.push({
          from: base.id,
          to: target.id,
          similarity: Number(sim.toFixed(6)),
        });
      }
    }

    scored.sort((a, b) => b.similarity - a.similarity);
    edges.push(...scored.slice(0, TOP_K));

    if ((i + 1) % 100 === 0 || i === nodes.length - 1) {
      console.log(`[kb] Graph progress ${i + 1}/${nodes.length}`);
    }
  }

  const graph = {
    generatedAt: new Date().toISOString(),
    settings: {
      maxNodes: MAX_NODES,
      topK: TOP_K,
      minSimilarity: MIN_SIM,
    },
    totals: {
      nodes: graphNodes.length,
      edges: edges.length,
    },
    nodes: graphNodes,
    edges,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(graph, null, 2));
  console.log("[kb] Semantic graph generated");
  console.log(`[kb] Nodes: ${graph.totals.nodes}, Edges: ${graph.totals.edges}`);
}

try {
  run();
} catch (error) {
  console.error("[kb] Semantic graph generation failed:", error.message);
  process.exit(1);
}
