/**
 * WS-G4 — aiLocalKnowledgeService GGUF embedding path (embedQuestion via retrieveKnowledge).
 *
 * embedQuestion() is internal; we exercise it through retrieveKnowledge():
 *  - GGUF default returns a clean 1024-dim vector → semantic similarity is used (>0).
 *  - GGUF dim mismatch → guard returns null; Ollama fallback also fails (no daemon) →
 *    keyword-only retrieval, NO crash, NO NaN.
 *
 * node:fs is mocked to supply a tiny 2-chunk corpus (no dependency on the real
 * knowledge/embeddings.jsonl). aiGgufEngine is mocked (no model/daemon).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Default GGUF path (USE_LEGACY_OLLAMA unset → false).
delete process.env.USE_LEGACY_OLLAMA;
process.env.GGUF_EMBED_DIM = "1024";

const DIM = 1024;

// A 1024-dim unit vector helper. We make chunk #1's embedding equal to the query
// embedding so cosine ≈ 1 (semantic match), chunk #2 orthogonal-ish.
function unit(seed: number): number[] {
  const v = new Array(DIM).fill(0);
  v[seed % DIM] = 1; // one-hot → already unit length
  return v;
}

const QUERY_VEC = unit(0); // matches chunk c1

const chunks = [
  { id: "c1", sourceType: "feature", sourcePath: "domain/knowledge/HUONG_DAN.md", title: "Hướng dẫn A", text: "Nội dung hướng dẫn về kiểm tra AOI.", keywords: ["aoi"] },
  { id: "c2", sourceType: "doc", sourcePath: "docs/OTHER.md", title: "Other", text: "Unrelated content about something else.", keywords: ["other"] },
];
const embeddings = [
  { id: "c1", sourceType: "feature", sourcePath: "domain/knowledge/HUONG_DAN.md", title: "Hướng dẫn A", keywords: ["aoi"], textLength: 30, embeddingDim: DIM, embedding: unit(0) },
  { id: "c2", sourceType: "doc", sourcePath: "docs/OTHER.md", title: "Other", keywords: ["other"], textLength: 30, embeddingDim: DIM, embedding: unit(5) },
];

const chunksJsonl = chunks.map((c) => JSON.stringify(c)).join("\n");
const embeddingsJsonl = embeddings.map((e) => JSON.stringify(e)).join("\n");

vi.mock("node:fs", () => ({
  default: {
    existsSync: () => true,
    readFileSync: (p: string) =>
      String(p).includes("chunks") ? chunksJsonl : embeddingsJsonl,
  },
  existsSync: () => true,
  readFileSync: (p: string) =>
    String(p).includes("chunks") ? chunksJsonl : embeddingsJsonl,
}));

// Avoid pulling real tool handlers / DB.
vi.mock("./aiLocalTools", () => ({
  tryExecuteTool: vi.fn(async () => ({ result: null, decision: { tool: null, args: {}, reason: "EMPTY" } })),
}));

const generateEmbedding = vi.fn();
const isGgufAvailable = vi.fn();
vi.mock("./aiGgufEngine", () => ({
  generateEmbedding: (...a: unknown[]) => generateEmbedding(...a),
  isGgufAvailable: (...a: unknown[]) => isGgufAvailable(...a),
}));

import { retrieveKnowledge, reloadKbArtifacts } from "./aiLocalKnowledgeService";

beforeEach(() => {
  vi.clearAllMocks();
  isGgufAvailable.mockResolvedValue(true);
  reloadKbArtifacts(); // reset the dataCache between tests
});

describe("embedQuestion GGUF default (via retrieveKnowledge)", () => {
  it("uses a clean 1024-dim GGUF vector → semantic similarity drives ranking (no NaN)", async () => {
    generateEmbedding.mockResolvedValue({ embedding: QUERY_VEC, dimensions: DIM, modelId: "mxbai-embed-large-v1-f16" });

    const res = await retrieveKnowledge("hướng dẫn kiểm tra AOI là gì", 5);

    expect(generateEmbedding).toHaveBeenCalledTimes(1);
    // Model id must be passed explicitly (never let it fall to the text model).
    const [, modelArg] = generateEmbedding.mock.calls[0];
    expect(typeof modelArg).toBe("string");
    expect((modelArg as string).length).toBeGreaterThan(0);

    expect(res.citations.length).toBeGreaterThan(0);
    // Chunk c1 (whose stored vector == query vector) should rank first.
    expect(res.citations[0].id).toBe("c1");
    // Confidence is a finite number in [0,1] (no NaN from cosine).
    expect(Number.isNaN(res.confidence)).toBe(false);
    expect(res.confidence).toBeGreaterThanOrEqual(0);
    expect(res.confidence).toBeLessThanOrEqual(1);
  });

  it("guards a dim mismatch → no crash; falls to keyword-only (Ollama fallback unreachable)", async () => {
    // Wrong dimension (e.g. text model returned 3584). Guard → null.
    generateEmbedding.mockResolvedValue({ embedding: [0.1, 0.2, 0.3], dimensions: 3, modelId: "qwen" });
    // Ollama fallback fetch fails (no daemon) → keyword-only.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await retrieveKnowledge("kiểm tra AOI", 5);

    // No throw; results come from keyword scoring (c1 contains "AOI").
    expect(res.citations.length).toBeGreaterThan(0);
    expect(Number.isNaN(res.confidence)).toBe(false);

    fetchSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
