/**
 * check-kb-stale.mjs (doc 11 · W1.2 companion; doc69 Wave 0 W0-A staleness gate)
 * — warn when the AI knowledge base is older than the latest change to its
 * source material, AND warn when the embeddings vector store trails the chunk
 * corpus it's supposed to cover.
 *
 * Check 1 (source-vs-KB): the RAG corpus (knowledge/embeddings.jsonl, via
 * knowledge/embeddings-meta.json `generatedAt`) is built from
 * routers/services/schema/docs/feature-guides. If any of those changed AFTER
 * the last KB build, the assistant may not know about the change until
 * `npm run kb:sync` runs.
 *
 * Check 2 (embeddings-vs-chunks, doc69 W0-A): the RAG corpus went dead once
 * before — knowledge/chunks.jsonl was regenerated (new chunk corpus) while
 * knowledge/embeddings.jsonl lagged months behind, so retrieval was wired but
 * had no vectors for the current corpus. This compares
 * knowledge/embeddings-meta.json `generatedAt` against knowledge/chunks-stats.json
 * `generatedAt` (the chunk corpus's own build timestamp) and warns if embeddings
 * trail chunks by more than KB_EMBED_STALE_HOURS (default 24h).
 *
 *   node scripts/ai-kb/check-kb-stale.mjs
 *
 * Both checks are WARN-ONLY (advisory) — exit code is always 0 by default. Set
 * KB_STALE_STRICT=1 to exit 1 instead if EITHER check reports stale (e.g. for a
 * CI job that should fail on a stale KB). Intended for a git pre-push hook — it
 * never blocks a push by default.
 *
 * No shebang: this file is only ever invoked via `node scripts/ai-kb/check-kb-stale.mjs`
 * (see package.json's `kb:stale-check` script and install-git-hooks.mjs's pre-push
 * hook), never executed directly as `./check-kb-stale.mjs`, so a shebang line isn't
 * functionally needed — and it actively breaks importing this module from a test
 * runner (Vite/vitest's per-module esbuild transform prepends a preamble before the
 * source, which pushes a leading `#!` off column 0 and esbuild then rejects it as
 * `SyntaxError: Invalid or unexpected token`).
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const META = path.join(process.cwd(), "knowledge", "embeddings-meta.json");
const CHUNK_STATS = path.join(process.cwd(), "knowledge", "chunks-stats.json");

// Source paths whose changes should be reflected in the KB.
const SOURCE_PATHS = [
  "server/routers",
  "server/services",
  "drizzle/schema",
  "docs",
  "apidocs",
  "knowledge/domain",
  "knowledge/features",
  "shared/module-registry.ts",
  "client/src/App.tsx",
  "client/src/lib/navigation.tsx",
];

const C = { y: "\x1b[33m", g: "\x1b[32m", dim: "\x1b[2m", b: "\x1b[1m", r: "\x1b[0m" };

function gitLatestSourceCommitISO() {
  try {
    const out = execSync(
      `git log -1 --format=%cI -- ${SOURCE_PATHS.join(" ")}`,
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    return out || null;
  } catch {
    return null; // not a git repo / git unavailable → skip
  }
}

// ── Check 1: source-vs-KB (unchanged behavior, just extracted into its own
// function so main() can run it alongside the new embeddings-vs-chunks check
// instead of returning early from a single monolithic function). ──────────
function checkSourceVsKb() {
  if (!fs.existsSync(META)) {
    // No KB yet — nothing to warn about (a fresh checkout). Stay silent.
    return 0;
  }

  let builtAtISO = null;
  try {
    const meta = JSON.parse(fs.readFileSync(META, "utf8"));
    builtAtISO = meta.generatedAt ?? null;
  } catch {
    return 0;
  }
  if (!builtAtISO) return 0;

  const srcISO = gitLatestSourceCommitISO();
  if (!srcISO) return 0;

  const builtAt = new Date(builtAtISO).getTime();
  const srcAt = new Date(srcISO).getTime();
  if (!Number.isFinite(builtAt) || !Number.isFinite(srcAt)) return 0;

  if (srcAt > builtAt) {
    const days = Math.max(0, Math.round((srcAt - builtAt) / 86_400_000));
    process.stderr.write(
      `\n${C.y}${C.b}⚠ KB có thể đã cũ / KB may be stale${C.r}\n` +
        `${C.dim}  KB built:   ${builtAtISO}\n` +
        `  Source last changed: ${srcISO}${days ? ` (~${days}d newer)` : ""}${C.r}\n` +
        `${C.y}  → Chạy ${C.b}npm run kb:sync${C.r}${C.y} để cập nhật tri thức AI trước khi tin tưởng câu trả lời.${C.r}\n\n`,
    );
    if (process.env.KB_STALE_STRICT === "1") return 1;
    return 0;
  }

  // Fresh — quiet success (a single dim line so the hook shows it ran).
  process.stderr.write(`${C.dim}[kb] knowledge base is up to date (built ${builtAtISO}).${C.r}\n`);
  return 0;
}

// ── Check 2 (doc69 W0-A): embeddings-vs-chunks staleness. ──────────────────

/**
 * Pure staleness comparison between the embeddings vector store and the chunk
 * corpus it's supposed to cover. Takes already-parsed objects (+ threshold) —
 * does NO file IO and NEVER throws, so it's directly unit-testable without
 * touching the filesystem or process.exit. The file-reading wrapper
 * (readJsonSafe + checkEmbeddingsVsChunks below) owns IO and the honest
 * "unknown" fallback on read/parse failure.
 *
 * @param {{ embMeta: object|null, chunkStats: object|null, staleHours: number }} args
 * @returns {{ status: "fresh"|"stale"|"unknown", embeddedAt: string|null, chunksAt: string|null, lagHours: number|null, reason: string|null }}
 */
export function embeddingsVsChunksStaleness({ embMeta, chunkStats, staleHours } = {}) {
  const thresholdHours = Number.isFinite(Number(staleHours)) ? Number(staleHours) : 24;

  const embeddedAtISO = embMeta && typeof embMeta === "object" ? (embMeta.generatedAt ?? null) : null;
  const chunksAtISO = chunkStats && typeof chunkStats === "object" ? (chunkStats.generatedAt ?? null) : null;

  if (!embeddedAtISO || !chunksAtISO) {
    return {
      status: "unknown",
      embeddedAt: embeddedAtISO,
      chunksAt: chunksAtISO,
      lagHours: null,
      reason: "missing generatedAt on embeddings-meta.json and/or chunks-stats.json",
    };
  }

  const embeddedAt = new Date(embeddedAtISO).getTime();
  const chunksAt = new Date(chunksAtISO).getTime();
  if (!Number.isFinite(embeddedAt) || !Number.isFinite(chunksAt)) {
    return {
      status: "unknown",
      embeddedAt: embeddedAtISO,
      chunksAt: chunksAtISO,
      lagHours: null,
      reason: "unparseable generatedAt date on embeddings-meta.json and/or chunks-stats.json",
    };
  }

  const lagHours = Math.round((chunksAt - embeddedAt) / 3_600_000);

  if (chunksAt - embeddedAt > thresholdHours * 3_600_000) {
    return {
      status: "stale",
      embeddedAt: embeddedAtISO,
      chunksAt: chunksAtISO,
      lagHours,
      reason: `embeddings trail the chunk corpus by ~${lagHours}h (threshold ${thresholdHours}h)`,
    };
  }

  return {
    status: "fresh",
    embeddedAt: embeddedAtISO,
    chunksAt: chunksAtISO,
    lagHours,
    reason: null,
  };
}

function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function checkEmbeddingsVsChunks() {
  const embMeta = readJsonSafe(META);
  const chunkStats = readJsonSafe(CHUNK_STATS);

  const rawStaleHours = Number(process.env.KB_EMBED_STALE_HOURS);
  const staleHours = Number.isFinite(rawStaleHours) ? rawStaleHours : 24;

  const result = embeddingsVsChunksStaleness({ embMeta, chunkStats, staleHours });

  if (result.status === "stale") {
    process.stderr.write(
      `\n${C.y}${C.b}⚠ Embeddings có thể đã cũ so với kho chunk / embeddings may trail the chunk corpus${C.r}\n` +
        `${C.dim}  Embeddings built: ${result.embeddedAt}\n` +
        `  Chunks built:     ${result.chunksAt} (~${result.lagHours}h newer)${C.r}\n` +
        `${C.y}  → Chạy ${C.b}npm run kb:embed:inc${C.r}${C.y} để tái tạo vector trước khi tin tưởng câu trả lời.${C.r}\n\n`,
    );
    if (process.env.KB_STALE_STRICT === "1") return 1;
    return 0;
  }

  if (result.status === "fresh") {
    // Fresh — quiet success (a single dim line so the hook shows it ran).
    process.stderr.write(`${C.dim}[kb] embeddings cover the current chunk corpus (embedded ${result.embeddedAt}).${C.r}\n`);
    return 0;
  }

  // unknown — honest degradation: missing/unparseable stats is NOT a scary
  // warning and never blocks anything, strict mode or not.
  process.stderr.write(`${C.dim}[kb] embeddings/chunks freshness could not be determined (missing stats).${C.r}\n`);
  return 0;
}

function main() {
  const sourceVsKbExit = checkSourceVsKb();
  const embeddingsVsChunksExit = checkEmbeddingsVsChunks();
  return sourceVsKbExit || embeddingsVsChunksExit ? 1 : 0;
}

// Only run (and process.exit) when this file is executed directly, e.g.
// `node scripts/ai-kb/check-kb-stale.mjs` — NOT when imported (e.g. by
// check-kb-stale.test.mjs importing embeddingsVsChunksStaleness). Without this
// guard, `process.exit(main())` at module scope would fire on import and kill
// the test runner.
const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMainModule) {
  process.exit(main());
}
