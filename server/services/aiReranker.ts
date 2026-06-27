/**
 * Phase B2.2 — RAG Reranker.
 *
 * Re-orders a candidate list (already retrieved by bruteforce cosine in
 * aiLocalKnowledgeService) so the most query-relevant chunks float to the top
 * before they reach the LLM prompt. This is the single biggest precision lever
 * for the file-based KB (we keep bruteforce jsonl; pgvector stays off).
 *
 * DESIGN
 * ──────
 * Flag-gated and FAIL-SAFE: when disabled — or on ANY error — `rerank()` returns
 * the input candidates unchanged (truncated to `topN`), so the caller's behavior
 * is identical to plain cosine retrieval. The reranker NEVER throws.
 *
 * Two backends behind RAG_RERANKER_MODE:
 *   (a) "llm"  (DEFAULT) — uses the existing fast GGUF text model (Qwen3-4B) via
 *       aiGgufEngine.generateText with a compact JSON scoring prompt. Needs NO
 *       new model. One generation call scores ALL candidates (cheap, ~1 call).
 *   (b) "gguf" (optional) — if GGUF_RERANKER_MODEL is set, uses a native
 *       cross-encoder ranking context. node-llama-cpp 3.18.1 DOES expose
 *       LlamaRankingContext (model.createRankingContext().rankAll(...)), so this
 *       is implemented. If the configured model isn't a reranker / load fails,
 *       it degrades to the "llm" backend, then to identity.
 *
 * NO model downloads happen here. The "gguf" path only loads a model the user
 * has already placed under GGUF_MODELS_DIR and pointed GGUF_RERANKER_MODEL at.
 */

import path from "node:path";
import fs from "node:fs";

// ─── Public interface ─────────────────────────────────────────────────────────

export interface RerankCandidate {
  /** Stable id (chunk id) — preserved through reranking so the caller can map back. */
  id: string;
  /** The text the reranker scores against the query. */
  text: string;
  /** Original retrieval score (cosine). Used as a tiebreaker / blend signal. */
  score?: number;
  /** Optional title — included in the document the reranker sees. */
  title?: string;
}

export interface RerankResult<T extends RerankCandidate = RerankCandidate> {
  candidate: T;
  /** Reranker relevance score in [0,1]. For identity passthrough this mirrors the input order. */
  rerankScore: number;
}

// ─── Flags / config (all default OFF) ─────────────────────────────────────────

export function isRerankerEnabled(): boolean {
  return (process.env.RAG_RERANKER_ENABLED ?? "false").toLowerCase() === "true";
}

type RerankerMode = "llm" | "gguf";
function getMode(): RerankerMode {
  const m = (process.env.RAG_RERANKER_MODE ?? "llm").toLowerCase();
  return m === "gguf" ? "gguf" : "llm";
}

// Cap on candidates fed to the reranker (cost guard). top-20 in is plenty.
const MAX_CANDIDATES = Number(process.env.RAG_RERANKER_MAX_CANDIDATES ?? 20);
// Per-document char cap so the scoring prompt / ranking ctx stays small.
const DOC_CHAR_CAP = Number(process.env.RAG_RERANKER_DOC_CHARS ?? 480);
// Blend weight: final = blend*rerank + (1-blend)*origCosine. Keeps reranker
// dominant while letting a strong cosine prior break near-ties. 1 = pure rerank.
const BLEND = (() => {
  const n = Number(process.env.RAG_RERANKER_BLEND ?? 0.85);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.85;
})();

function clip(text: string): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t.length > DOC_CHAR_CAP ? t.slice(0, DOC_CHAR_CAP) + "…" : t;
}

function docOf(c: RerankCandidate): string {
  const title = c.title ? c.title.trim() + " — " : "";
  return clip(title + (c.text ?? ""));
}

/**
 * Rerank `candidates` against `query`, returning the top `topN` ranked results.
 *
 * FAIL-SAFE: if disabled or anything goes wrong, returns the first `topN`
 * candidates in their original order (with rerankScore mirroring that order),
 * so the caller's retrieval is unchanged.
 */
export async function rerank<T extends RerankCandidate>(
  query: string,
  candidates: T[],
  topN = 5,
): Promise<RerankResult<T>[]> {
  const identity = (): RerankResult<T>[] =>
    candidates.slice(0, Math.max(1, topN)).map((candidate, i) => ({
      candidate,
      // Descending pseudo-score so downstream sort-by-rerankScore is a no-op.
      rerankScore: candidates.length > 0 ? 1 - i / Math.max(1, candidates.length) : 0,
    }));

  if (!isRerankerEnabled()) return identity();
  if (!Array.isArray(candidates) || candidates.length === 0) return identity();

  const pool = candidates.slice(0, MAX_CANDIDATES);

  try {
    let scores: number[] | null = null;
    if (getMode() === "gguf") {
      scores = await rankWithGguf(query, pool);
      // gguf backend may decline (model not a reranker / unavailable) → fall back.
      if (!scores) scores = await rankWithLlm(query, pool);
    } else {
      scores = await rankWithLlm(query, pool);
    }
    if (!scores || scores.length !== pool.length) return identity();

    const blended = pool.map((candidate, i) => {
      const orig = typeof candidate.score === "number" ? clamp01(candidate.score) : 0;
      const rr = clamp01(scores![i]);
      const rerankScore = BLEND * rr + (1 - BLEND) * orig;
      return { candidate, rerankScore };
    });
    blended.sort((a, b) => b.rerankScore - a.rerankScore);
    return blended.slice(0, Math.max(1, topN));
  } catch (err) {
    console.warn("[aiReranker] rerank failed, returning original order:", err);
    return identity();
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// ─── Backend (a): LLM scoring via the fast GGUF model ─────────────────────────

/**
 * Score every candidate in ONE generation call. We ask the fast model for a JSON
 * array of {i, s} where s ∈ [0,1] is relevance. Robust parse: tolerate fenced
 * JSON, missing entries (default 0), and out-of-range scores.
 */
async function rankWithLlm(query: string, pool: RerankCandidate[]): Promise<number[] | null> {
  const { generateText, isGgufAvailable } = await import("./aiGgufEngine");
  if (!(await isGgufAvailable())) return null;

  const docs = pool
    .map((c, i) => `[${i}] ${docOf(c)}`)
    .join("\n");

  const systemPrompt =
    "You are a precise search reranker. Score how well each document answers the user query. " +
    "Output ONLY a compact JSON array, no prose.";

  const prompt =
    `Query: ${query.replace(/\s+/g, " ").trim().slice(0, 400)}\n\n` +
    `Documents:\n${docs}\n\n` +
    `For each document index, output its relevance to the Query as a number from 0.0 (irrelevant) ` +
    `to 1.0 (directly answers it). Respond with ONLY a JSON array of objects ` +
    `like [{"i":0,"s":0.9},{"i":1,"s":0.2}] covering every index 0..${pool.length - 1}.`;

  const maxTokens = Math.min(900, 40 + pool.length * 14);
  const result = await generateText({
    systemPrompt,
    prompt,
    maxTokens,
    temperature: 0,
    topP: 1,
    jsonMode: true,
  });

  const parsed = parseScoreArray(result.text, pool.length);
  return parsed;
}

/**
 * Tolerant parser: extracts the first JSON array of {i,s} (or bare numbers) from
 * the model output. Returns a dense score[] of length `n` (missing → 0).
 */
export function parseScoreArray(text: string | undefined | null, n: number): number[] | null {
  if (!text) return null;
  const scores = new Array<number>(n).fill(0);
  let any = false;

  // Prefer a structured [{i,s}] array.
  const objRe = /\{\s*"?i"?\s*:\s*(\d+)\s*,\s*"?s"?\s*:\s*([0-9]*\.?[0-9]+)\s*\}/g;
  let m: RegExpExecArray | null;
  while ((m = objRe.exec(text)) !== null) {
    const idx = Number(m[1]);
    const s = Number(m[2]);
    if (idx >= 0 && idx < n && Number.isFinite(s)) {
      scores[idx] = s > 1 ? s / 10 : s; // tolerate a 0–10 scale
      any = true;
    }
  }
  if (any) return scores;

  // Fallback: a bare array of numbers in order, e.g. [0.9, 0.1, 0.5].
  const arrMatch = text.match(/\[[\s\S]*?\]/);
  if (arrMatch) {
    const nums = arrMatch[0].match(/[0-9]*\.?[0-9]+/g);
    if (nums && nums.length >= 1) {
      for (let i = 0; i < Math.min(n, nums.length); i++) {
        const s = Number(nums[i]);
        if (Number.isFinite(s)) {
          scores[i] = s > 1 ? s / 10 : s;
          any = true;
        }
      }
    }
  }
  return any ? scores : null;
}

// ─── Backend (b): native cross-encoder GGUF ranking context ───────────────────
//
// node-llama-cpp 3.18.1 exposes LlamaRankingContext via
// model.createRankingContext(). rankAll(query, docs[]) returns scores in [0,1].
// We load the reranker model directly here (separate from aiGgufEngine's slot
// manager — we MUST NOT edit aiGgufEngine) and cache a single ranking context.
// If the configured model is not a reranker, createRankingContext throws and we
// fall back to the LLM backend.

let _rankLlama: unknown = null;
let _rankModel: unknown = null;
let _rankCtx: { rankAll: (q: string, docs: string[]) => Promise<number[]> } | null = null;
let _rankCtxFailed = false;

function resolveRerankerModelPath(): string | null {
  const raw = process.env.GGUF_RERANKER_MODEL;
  if (!raw) return null;
  const file = raw.endsWith(".gguf") ? raw : `${raw}.gguf`;
  if (path.isAbsolute(file) && fs.existsSync(file)) return file;
  const dir = process.env.GGUF_MODELS_DIR
    ? path.resolve(process.env.GGUF_MODELS_DIR)
    : path.join(process.cwd(), "uploads", "gguf-models");
  const full = path.join(dir, file);
  return fs.existsSync(full) ? full : null;
}

async function getRankingContext(): Promise<typeof _rankCtx> {
  if (_rankCtx) return _rankCtx;
  if (_rankCtxFailed) return null;

  const modelPath = resolveRerankerModelPath();
  if (!modelPath) {
    _rankCtxFailed = true;
    return null;
  }

  try {
    const { getLlama } = (await import("node-llama-cpp")) as {
      getLlama: (opts?: { gpu?: false | "auto" }) => Promise<unknown>;
    };
    const llama = (await getLlama({
      gpu: process.env.GGUF_GPU === "false" ? false : "auto",
    })) as { loadModel: (o: { modelPath: string; gpuLayers?: number }) => Promise<unknown> };
    _rankLlama = llama;
    const model = (await llama.loadModel({ modelPath, gpuLayers: -1 })) as {
      createRankingContext: (o?: { contextSize?: "auto" | number }) => Promise<{
        rankAll: (q: string, docs: string[]) => Promise<number[]>;
      }>;
    };
    _rankModel = model;
    _rankCtx = await model.createRankingContext({ contextSize: "auto" });
    return _rankCtx;
  } catch (err) {
    // Most common cause: the model isn't a reranker (no rank head) → llama.cpp
    // throws on createRankingContext. Mark failed so we don't retry per-query.
    console.warn(
      "[aiReranker] native GGUF ranking context unavailable (model not a reranker?) — " +
        "falling back to LLM reranker:",
      err,
    );
    _rankCtxFailed = true;
    return null;
  }
}

async function rankWithGguf(query: string, pool: RerankCandidate[]): Promise<number[] | null> {
  const ctx = await getRankingContext();
  if (!ctx) return null;
  try {
    const docs = pool.map((c) => docOf(c));
    const scores = await ctx.rankAll(query.slice(0, 1000), docs);
    if (!Array.isArray(scores) || scores.length !== pool.length) return null;
    return scores.map((s) => clamp01(Number(s)));
  } catch (err) {
    console.warn("[aiReranker] GGUF rankAll failed, falling back:", err);
    return null;
  }
}

/** Free the native ranking context/model (best-effort; not normally needed). */
export async function disposeReranker(): Promise<void> {
  try {
    const ctx = _rankCtx as unknown as { dispose?: () => Promise<void> } | null;
    if (ctx && typeof ctx.dispose === "function") {
      await ctx.dispose();
    }
  } catch {
    /* best-effort */
  }
  try {
    if (_rankModel && typeof (_rankModel as { dispose?: () => Promise<void> }).dispose === "function") {
      await (_rankModel as { dispose: () => Promise<void> }).dispose();
    }
  } catch {
    /* best-effort */
  }
  _rankCtx = null;
  _rankModel = null;
  _rankLlama = null;
  _rankCtxFailed = false;
}
