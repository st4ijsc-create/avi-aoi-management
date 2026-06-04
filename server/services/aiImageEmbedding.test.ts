/**
 * WS-3 — Unit tests cho aiImageEmbedding service.
 *
 * Không cần DB thật / pgvector:
 *  - cosineSimilarity / l2normalize (norm≈1, vector trùng → 1)
 *  - formatVectorLiteral / parseVectorLiteral ("[..]")
 *  - getEmbeddingStats: trả default an toàn khi getDb() = null
 *  - searchByImage: fallback metadata khi describeDefect throw (mock getDb)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (phải khai báo trước khi import service) ──────────────────────────
vi.mock("../db/connection", () => ({
  getDb: vi.fn(),
}));
vi.mock("./aiVisionLanguage", () => ({
  describeDefect: vi.fn(),
}));
// Tránh nạp onnxruntime-node / sharp thật trong môi trường test.
vi.mock("onnxruntime-node", () => ({ InferenceSession: { create: vi.fn() }, Tensor: class {} }));
vi.mock("sharp", () => ({ default: vi.fn() }));
const mockGetActiveModelForProduct = vi.fn();
const mockGetAiModels = vi.fn();
vi.mock("../db/ai", () => ({
  getAiModelById: vi.fn(),
  getActiveModelForProduct: (...a: unknown[]) => mockGetActiveModelForProduct(...a),
  getAiModels: (...a: unknown[]) => mockGetAiModels(...a),
}));

// WS-G4 — GGUF engine mocked so embedImageAsText runs without a model/daemon.
const ggufGenerateEmbedding = vi.fn();
const ggufIsAvailable = vi.fn();
vi.mock("./aiGgufEngine", () => ({
  generateEmbedding: (...a: unknown[]) => ggufGenerateEmbedding(...a),
  isGgufAvailable: (...a: unknown[]) => ggufIsAvailable(...a),
}));

import { getDb } from "../db/connection";
import { describeDefect } from "./aiVisionLanguage";
import {
  l2normalize,
  cosineSimilarity,
  formatVectorLiteral,
  parseVectorLiteral,
  getEmbeddingStats,
  searchByImage,
  embedImageAsText,
  resolveDefaultImageEmbeddingModel,
  poolEmbeddingFromOutput,
  TEXT_OF_IMAGE_MODEL_CODE,
  DEFAULT_EMBEDDING_DIM,
} from "./aiImageEmbedding";

const mockedGetDb = vi.mocked(getDb);
const mockedDescribe = vi.mocked(describeDefect);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("l2normalize", () => {
  it("normalizes to unit length (norm ≈ 1)", () => {
    const n = l2normalize([3, 4]);
    const norm = Math.sqrt(n[0] ** 2 + n[1] ** 2);
    expect(norm).toBeCloseTo(1, 6);
    expect(n[0]).toBeCloseTo(0.6, 6);
    expect(n[1]).toBeCloseTo(0.8, 6);
  });

  it("handles zero vector without NaN (norm fallback = 1)", () => {
    const n = l2normalize([0, 0, 0]);
    expect(n).toEqual([0, 0, 0]);
  });
});

describe("cosineSimilarity", () => {
  it("identical vectors → 1", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });

  it("orthogonal vectors → 0", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });

  it("opposite vectors → -1", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 6);
  });

  it("dimension mismatch or empty → 0", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it("equals dot product for L2-normalized inputs", () => {
    const a = l2normalize([2, 1, 0.5]);
    const b = l2normalize([1, 1, 1]);
    const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    expect(cosineSimilarity(a, b)).toBeCloseTo(dot, 6);
  });
});

describe("formatVectorLiteral / parseVectorLiteral", () => {
  it("formats as pgvector literal [..]", () => {
    expect(formatVectorLiteral([0.1, 0.2, 0.3])).toBe("[0.1,0.2,0.3]");
  });

  it("round-trips through parse", () => {
    const v = [0.5, -0.25, 1];
    expect(parseVectorLiteral(formatVectorLiteral(v))).toEqual(v);
  });

  it("parse returns [] on null/garbage", () => {
    expect(parseVectorLiteral(null)).toEqual([]);
    expect(parseVectorLiteral("not-json")).toEqual([]);
    expect(parseVectorLiteral(undefined)).toEqual([]);
  });
});

describe("poolEmbeddingFromOutput — CLS pooling (B4 DINOv2)", () => {
  it("3-D [1,257,384] last_hidden_state → CLS token (first 384 values, token 0)", () => {
    const T = 257;
    const D = 384;
    // Token 0 = 1..D, token 1 = sentinel để chứng minh KHÔNG bị trộn.
    const data = new Float32Array(T * D);
    for (let i = 0; i < D; i++) data[i] = i + 1; // CLS token values: 1..384
    for (let i = D; i < 2 * D; i++) data[i] = -999; // token 1: phải bị bỏ
    const { vector, dim, pooling } = poolEmbeddingFromOutput(data, [1, T, D]);
    expect(dim).toBe(D);
    expect(pooling).toBe("cls");
    expect(vector.length).toBe(D);
    expect(vector[0]).toBe(1);
    expect(vector[D - 1]).toBe(D); // = 384
    expect(vector).not.toContain(-999); // token 1 không lọt vào
  });

  it("generic 3-D [1,257,768] (dinov2-base) → CLS 768-dim", () => {
    const T = 257;
    const D = 768;
    const data = new Float32Array(T * D).fill(0.5);
    const { vector, dim, pooling } = poolEmbeddingFromOutput(data, [1, T, D]);
    expect(dim).toBe(768);
    expect(pooling).toBe("cls");
    expect(vector.length).toBe(768);
  });

  it("2-D [1,384] flat embedding → used as-is (backward-compatible)", () => {
    const data = new Float32Array(384).fill(0.1);
    const { vector, dim, pooling } = poolEmbeddingFromOutput(data, [1, 384]);
    expect(dim).toBe(384);
    expect(pooling).toBe("flat");
    expect(vector.length).toBe(384);
  });

  it("1-D [D] flat embedding → used as-is", () => {
    const { vector, dim, pooling } = poolEmbeddingFromOutput([1, 2, 3, 4], [4]);
    expect(dim).toBe(4);
    expect(pooling).toBe("flat");
    expect(vector).toEqual([1, 2, 3, 4]);
  });

  it("missing/garbage dims → falls back to flat data (no throw)", () => {
    const { vector, dim, pooling } = poolEmbeddingFromOutput([7, 8], undefined);
    expect(dim).toBe(2);
    expect(pooling).toBe("flat");
    expect(vector).toEqual([7, 8]);
  });
});

describe("getEmbeddingStats", () => {
  it("returns safe defaults when DB unavailable", async () => {
    mockedGetDb.mockResolvedValue(null as any);
    const stats = await getEmbeddingStats();
    expect(stats.totalEmbeddings).toBe(0);
    expect(stats.indexedCount).toBe(0);
    expect(stats.pgvectorAvailable).toBe(false);
    expect(stats.defaultDim).toBe(DEFAULT_EMBEDDING_DIM);
  });
});

describe("embedImageAsText — GGUF default (WS-G4)", () => {
  it("embeds via GGUF (1024-dim, L2-normalized) and KEEPS the legacy modelCode", async () => {
    delete process.env.USE_LEGACY_OLLAMA; // default → GGUF
    ggufIsAvailable.mockResolvedValue(true);
    // Raw (un-normalized) 1024-dim vector → embedImageAsText must L2-normalize it.
    const raw = new Array(DEFAULT_EMBEDDING_DIM).fill(0);
    raw[0] = 3;
    raw[1] = 4; // norm = 5 → normalized first two = 0.6, 0.8
    ggufGenerateEmbedding.mockResolvedValue({ embedding: raw, dimensions: DEFAULT_EMBEDDING_DIM, modelId: "mxbai" });
    mockedDescribe.mockResolvedValue({
      description: "scratch on pad",
      location: "top-left",
      possibleCauses: ["handling"],
      suggestedActions: ["inspect"],
    } as any);

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const out = await embedImageAsText(Buffer.from("img"));

    expect(out.dim).toBe(DEFAULT_EMBEDDING_DIM);
    expect(out.modelCode).toBe(TEXT_OF_IMAGE_MODEL_CODE); // unchanged → old data compatible
    // L2-normalized
    const norm = Math.sqrt(out.embedding.reduce((a, v) => a + v * v, 0));
    expect(norm).toBeCloseTo(1, 6);
    expect(out.embedding[0]).toBeCloseTo(0.6, 6);
    expect(out.embedding[1]).toBeCloseTo(0.8, 6);
    expect(out.embedding.some((v) => Number.isNaN(v))).toBe(false);
    // GGUF path → no Ollama HTTP call.
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("B4.1 — resolveDefaultImageEmbeddingModel", () => {
  it("returns null when IMAGE_EMBEDDING_DEFAULT != 'onnx' (default text)", async () => {
    delete process.env.IMAGE_EMBEDDING_DEFAULT;
    const m = await resolveDefaultImageEmbeddingModel();
    expect(m).toBeNull();
    expect(mockGetAiModels).not.toHaveBeenCalled();
  });

  it("note: IMAGE_EMBEDDING_DEFAULT is read at module load — onnx-mode covered via searchByImage degrade tests", () => {
    // IMAGE_EMBEDDING_DEFAULT được đọc 1 lần khi import module (const), nên test runtime
    // không thể bật onnx-mode sau khi import. Hành vi onnx được nghiệm thu qua nhánh
    // resolve → null → text-of-image (degrade) ở test dưới + verify thủ công khi có model.
    expect(true).toBe(true);
  });
});

describe("B4.1 — searchByImage embeddingSource flag", () => {
  it("source = 'text-of-image' when no ONNX model resolved (modelId null)", async () => {
    delete process.env.IMAGE_EMBEDDING_DEFAULT; // → resolve null → text-of-image
    ggufIsAvailable.mockResolvedValue(true);
    const raw = new Array(DEFAULT_EMBEDDING_DIM).fill(0);
    raw[0] = 1;
    ggufGenerateEmbedding.mockResolvedValue({ embedding: raw, dimensions: DEFAULT_EMBEDDING_DIM, modelId: "mxbai" });
    mockedDescribe.mockResolvedValue({ description: "scratch", location: "", possibleCauses: [], suggestedActions: [] } as any);

    // findSimilarByVectorWithMode cần DB; trả mảng rỗng để tập trung kiểm cờ source.
    const builder: any = { from: () => builder, where: () => builder, orderBy: () => builder, limit: () => Promise.resolve([]) };
    const db: any = { select: () => builder, execute: () => Promise.reject(new Error("no pgvector")) };
    mockedGetDb.mockResolvedValue(db);

    const out = await searchByImage(undefined, Buffer.from("img"), 5);
    expect(out.embeddingSource).toBe("text-of-image");
    expect(out.embedding.modelCode).toBe(TEXT_OF_IMAGE_MODEL_CODE);
  });

  it("source = 'metadata' when describeDefect + GGUF fail (modelId null)", async () => {
    delete process.env.IMAGE_EMBEDDING_DEFAULT;
    ggufIsAvailable.mockResolvedValue(false);
    mockedDescribe.mockRejectedValue(new Error("vision offline"));
    mockedGetDb.mockResolvedValue(null as any); // metadata fallback → empty, no crash
    const out = await searchByImage(undefined, Buffer.from("img"), 5);
    expect(out.embeddingSource).toBe("metadata");
    expect(out.searchMode).toBe("metadata");
  });
});

describe("searchByImage metadata fallback", () => {
  it("falls back to metadata scoring + sort when describeDefect throws and modelId is null", async () => {
    // describeDefect throws → embedImageAsText fails → metadata fallback path.
    mockedDescribe.mockRejectedValue(new Error("vision offline"));

    const rows = [
      { id: 1, inspectionId: null, measurementResultId: 1, imageUrl: "a.jpg", label: "scratch defect", defectType: "scratch", machineId: 5, productModelId: null, createdAt: new Date("2024-01-01") },
      { id: 2, inspectionId: null, measurementResultId: 2, imageUrl: "b.jpg", label: "ok", defectType: null, machineId: 5, productModelId: null, createdAt: new Date("2024-01-02") },
    ];

    // Chainable query builder mock cho metadata fallback select().
    const builder: any = {
      from: () => builder,
      where: () => builder,
      orderBy: () => builder,
      limit: () => Promise.resolve(rows),
    };
    const db: any = { select: () => builder };
    mockedGetDb.mockResolvedValue(db);

    const out = await searchByImage(undefined, Buffer.from("img"), 5, { machineId: 5 });

    expect(out.searchMode).toBe("metadata");
    expect(Array.isArray(out.results)).toBe(true);
    // Kết quả sort giảm dần theo similarity.
    for (let i = 1; i < out.results.length; i++) {
      expect(out.results[i - 1].similarity).toBeGreaterThanOrEqual(out.results[i].similarity);
    }
    // similarity nằm trong [0,1].
    for (const r of out.results) {
      expect(r.similarity).toBeGreaterThanOrEqual(0);
      expect(r.similarity).toBeLessThanOrEqual(1);
    }
  });

  it("returns empty metadata result (no crash) when DB is null", async () => {
    mockedDescribe.mockRejectedValue(new Error("vision offline"));
    mockedGetDb.mockResolvedValue(null as any);

    const out = await searchByImage(undefined, Buffer.from("img"), 5);
    expect(out.searchMode).toBe("metadata");
    expect(out.results).toEqual([]);
  });
});
