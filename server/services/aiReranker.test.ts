/**
 * Unit tests for aiReranker — gguf-mode hardening (doc 11 follow-up).
 *
 * These are PURE env/logic tests: no node-llama-cpp model is loaded and no
 * inference runs. We exercise:
 *   - getRerankerStatus() across enabled/disabled, mode=llm, and mode=gguf with
 *     an unset/unresolvable GGUF_RERANKER_MODEL (→ activeBackend falls back to llm)
 *   - rerank() identity passthrough when disabled (no backend touched)
 *   - parseScoreArray tolerance (structured + bare-number forms)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getRerankerStatus, rerank, parseScoreArray, type RerankCandidate } from "./aiReranker";

const ENV_KEYS = [
  "RAG_RERANKER_ENABLED",
  "RAG_RERANKER_MODE",
  "GGUF_RERANKER_MODEL",
  "GGUF_MODELS_DIR",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("getRerankerStatus", () => {
  it("reports identity when reranking is disabled", () => {
    // default: RAG_RERANKER_ENABLED unset → false
    const s = getRerankerStatus();
    expect(s.enabled).toBe(false);
    expect(s.activeBackend).toBe("identity");
  });

  it("reports llm backend when enabled with default mode", () => {
    process.env.RAG_RERANKER_ENABLED = "true";
    const s = getRerankerStatus();
    expect(s.enabled).toBe(true);
    expect(s.mode).toBe("llm");
    expect(s.activeBackend).toBe("llm");
    expect(s.modelConfigured).toBe(false);
  });

  it("falls back to llm when mode=gguf but no model file is configured", () => {
    process.env.RAG_RERANKER_ENABLED = "true";
    process.env.RAG_RERANKER_MODE = "gguf";
    // GGUF_RERANKER_MODEL intentionally unset → cannot resolve a model file.
    const s = getRerankerStatus();
    expect(s.mode).toBe("gguf");
    expect(s.modelConfigured).toBe(false);
    expect(s.modelResolved).toBe(false);
    expect(s.activeBackend).toBe("llm");
  });

  it("reports modelConfigured but not resolved when the file is missing on disk", () => {
    process.env.RAG_RERANKER_ENABLED = "true";
    process.env.RAG_RERANKER_MODE = "gguf";
    process.env.GGUF_RERANKER_MODEL = "Qwen3-Reranker-0.6B-Q8_0.gguf";
    process.env.GGUF_MODELS_DIR = "/nonexistent/dir/that/does/not/exist";
    const s = getRerankerStatus();
    expect(s.modelConfigured).toBe(true);
    expect(s.modelResolved).toBe(false);
    // unresolved → would serve via llm, never crashes
    expect(s.activeBackend).toBe("llm");
  });
});

describe("rerank identity passthrough", () => {
  const candidates: RerankCandidate[] = [
    { id: "a", text: "alpha", score: 0.1 },
    { id: "b", text: "bravo", score: 0.9 },
    { id: "c", text: "charlie", score: 0.5 },
  ];

  it("returns input order unchanged when disabled (no backend touched)", async () => {
    // disabled by default
    const out = await rerank("query", candidates, 3);
    expect(out.map((r) => r.candidate.id)).toEqual(["a", "b", "c"]);
    // descending pseudo-scores so a downstream sort is a no-op
    expect(out[0].rerankScore).toBeGreaterThanOrEqual(out[1].rerankScore);
    expect(out[1].rerankScore).toBeGreaterThanOrEqual(out[2].rerankScore);
  });

  it("returns identity for empty candidates", async () => {
    const out = await rerank("query", [], 5);
    expect(Array.isArray(out)).toBe(true);
  });
});

describe("parseScoreArray", () => {
  it("parses structured [{i,s}] form", () => {
    const r = parseScoreArray('[{"i":0,"s":0.9},{"i":1,"s":0.2}]', 2);
    expect(r).toEqual([0.9, 0.2]);
  });

  it("parses a bare number array in order", () => {
    const r = parseScoreArray("scores: [0.4, 0.7]", 2);
    expect(r).toEqual([0.4, 0.7]);
  });

  it("tolerates a 0-10 scale by dividing", () => {
    const r = parseScoreArray('[{"i":0,"s":8}]', 1);
    expect(r).toEqual([0.8]);
  });

  it("returns null when nothing parseable", () => {
    expect(parseScoreArray("no scores here", 2)).toBeNull();
    expect(parseScoreArray("", 2)).toBeNull();
    expect(parseScoreArray(null, 2)).toBeNull();
  });
});
