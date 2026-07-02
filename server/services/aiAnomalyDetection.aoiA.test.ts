/**
 * AOI-A (c) — anomaly detection runs END-TO-END on the DEGRADED tier and LABELS it.
 *
 * With NO ONNX model + GGUF unavailable, getEmbeddingForAnomaly falls to the sharp-only
 * heuristic tier. This test builds a memory bank from real heuristic vectors (via a mocked
 * DB layer), then scores images and asserts:
 *   • the embedding tier is reported: source === "heuristic", degraded === true
 *   • a real score is produced (near-bank OK image low; far/altered image higher)
 *   • the pipeline never throws and never fabricates an "onnx" label when no model is present
 *
 * No real DB / ONNX / GGUF — the bank lives in an in-memory mock; sharp does the features.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import sharp from "sharp";

// In-memory bank + profile so buildBankFromVectors / scoreFromVector run without Postgres.
const mockState: { bank: number[][]; profile: any } = { bank: [], profile: null };

vi.mock("../db/aiAnomaly", () => ({
  clearBank: vi.fn(async () => {}),
  insertBankRows: vi.fn(async (_scope: any, rows: any[]) => {
    mockState.bank = rows.map((r) => r.vector);
    return rows.length;
  }),
  loadBank: vi.fn(async () => mockState.bank),
  upsertProfile: vi.fn(async (_scope: any, input: any) => {
    mockState.profile = { ...input, threshold: Number(input.threshold) };
  }),
  getProfile: vi.fn(async () => mockState.profile),
  getBankStats: vi.fn(async () => ({ totalVectors: mockState.bank.length, distinctModelCodes: 1, profiles: [] })),
  deleteScope: vi.fn(async () => {}),
}));

// No ONNX model, no GGUF → forces the heuristic (degraded) tier.
vi.mock("./aiGgufEngine", () => ({ isGgufAvailable: vi.fn(async () => false) }));

import {
  getEmbeddingForAnomaly,
  buildMemoryBank,
  scoreImage,
  anomalyModelCode,
} from "./aiAnomalyDetection";

// Deterministic synthetic images so the heuristic features are stable across runs.
async function solidImage(gray: number, size = 64): Promise<Buffer> {
  return sharp({
    create: { width: size, height: size, channels: 3, background: { r: gray, g: gray, b: gray } },
  })
    .png()
    .toBuffer();
}

async function noisyImage(size = 64): Promise<Buffer> {
  const px = Buffer.alloc(size * size * 3);
  for (let i = 0; i < px.length; i++) px[i] = (i * 97 + 13) % 256; // structured "noise"
  return sharp(px, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
}

beforeEach(() => {
  mockState.bank = [];
  mockState.profile = null;
});

describe("AOI-A (c) — degraded embedding tier is used AND labelled", () => {
  it("getEmbeddingForAnomaly with no model/GGUF → source 'heuristic', degraded true, real vector", async () => {
    const img = await solidImage(128);
    const emb = await getEmbeddingForAnomaly(img, { modelId: null });
    expect(emb.source).toBe("heuristic");
    expect(emb.degraded).toBe(true);
    expect(emb.vector.length).toBeGreaterThan(0);
    // L2-normalized (‖v‖ ≈ 1) — a real handcrafted vector, not fabricated.
    const norm = Math.sqrt(emb.vector.reduce((a, v) => a + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
    expect(emb.vector.some((v) => Number.isNaN(v))).toBe(false);
  });

  it("anomalyModelCode labels the heuristic scope (no fake onnx code)", () => {
    expect(anomalyModelCode("heuristic", null)).toBe("anomaly:heuristic");
    expect(anomalyModelCode("text-of-image", null)).toBe("anomaly:text-of-image");
    expect(anomalyModelCode("onnx", 7)).toBe("anomaly:onnx:7");
  });

  it("build (degraded) → score returns a tier-labelled, scored result (no throw)", async () => {
    // Build an OK bank from several near-identical solid images on the heuristic tier.
    const okImages = await Promise.all([120, 122, 124, 126, 128, 130].map((g) => solidImage(g)));
    const built = await buildMemoryBank({
      machineId: 1,
      productModelId: null,
      modelId: null, // → degraded heuristic tier
      images: okImages.map((buffer) => ({ buffer, imageUrl: null })),
      coresetRatio: 1,
      k: 2,
    });
    expect(built.source).toBe("heuristic");
    expect(built.degraded).toBe(true);
    expect(built.bankSize).toBeGreaterThan(0);
    expect(mockState.profile).not.toBeNull();

    // Score an OK-like image → scored result, still labelled heuristic/degraded.
    const okScore = await scoreImage({ buffer: await solidImage(125), machineId: 1, productModelId: null, modelId: null });
    expect(okScore.source).toBe("heuristic");
    expect(okScore.degraded).toBe(true);
    expect(okScore.bankSize).toBeGreaterThan(0);
    expect(okScore.threshold).not.toBeNull();
    expect(Number.isFinite(okScore.score)).toBe(true);
    expect(typeof okScore.isAnomaly).toBe("boolean");

    // Score a structurally very different image → higher distance than the OK one.
    const oddScore = await scoreImage({ buffer: await noisyImage(), machineId: 1, productModelId: null, modelId: null });
    expect(oddScore.source).toBe("heuristic");
    expect(oddScore.degraded).toBe(true);
    expect(oddScore.score).toBeGreaterThanOrEqual(okScore.score);
  });

  it("scoreImage with no bank yet → safe degraded result, honest reason, no throw", async () => {
    const r = await scoreImage({ buffer: await solidImage(100), machineId: 99, productModelId: null, modelId: null });
    // No profile/bank for this scope → safe, labelled, not an anomaly, with a clear reason.
    expect(r.isAnomaly).toBe(false);
    expect(r.degraded).toBe(true);
    expect(["no_profile", "empty_bank"]).toContain(r.reason);
    expect(r.source).toBe("heuristic"); // embedding tier still honestly reported
  });
});
