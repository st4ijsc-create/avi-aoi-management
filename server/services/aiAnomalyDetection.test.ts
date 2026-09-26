/**
 * B3 — Unsupervised anomaly detection verification tests.
 *
 * Covers:
 *  • Algorithm: kNN scoring (near → low score / not anomaly; far → high score >
 *    threshold), percentile threshold correctness, greedy coreset reduces size.
 *  • Degrade: getDb null → scoreImage safe (no throw); isGgufAvailable=false +
 *    no modelId → heuristic source/degraded; build/score wiring via mocked db.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock the DB layer so the algorithm runs without Postgres ──────────────────
const mockState: {
  bank: number[][];
  profile: any;
  dbNull: boolean;
} = { bank: [], profile: null, dbNull: false };

vi.mock("../db/aiAnomaly", () => ({
  clearBank: vi.fn(async () => {}),
  insertBankRows: vi.fn(async (_scope: any, rows: any[]) => {
    mockState.bank = rows.map((r) => r.vector);
    return rows.length;
  }),
  loadBank: vi.fn(async () => (mockState.dbNull ? [] : mockState.bank)),
  upsertProfile: vi.fn(async (_scope: any, input: any) => {
    mockState.profile = { ...input, threshold: input.threshold.toFixed(8) };
  }),
  getProfile: vi.fn(async () => (mockState.dbNull ? null : mockState.profile)),
  getBankStats: vi.fn(async () => ({ totalVectors: mockState.bank.length, distinctModelCodes: 1, profiles: [] })),
  deleteScope: vi.fn(async () => {}),
}));

// ── Mock GGUF availability + ONNX embedding (no model in test env) ────────────
vi.mock("./aiGgufEngine", () => ({
  isGgufAvailable: vi.fn(async () => false),
}));

vi.mock("./aiImageEmbedding", async () => {
  const actual = await vi.importActual<any>("./aiImageEmbedding");
  return {
    ...actual,
    extractEmbedding: vi.fn(async () => {
      throw new Error("no onnx model in test");
    }),
    embedImageAsText: vi.fn(async () => {
      throw new Error("gguf disabled in test");
    }),
  };
});

import {
  knnScore,
  quantileSorted,
  computeDistStats,
  greedyCoreset,
  cosineDistance,
  getEmbeddingForAnomaly,
  buildMemoryBank,
  scoreImage,
  scoreFromVector,
  extractHandcraftedFeatures,
  anomalyModelCode,
  shouldEscalateToVision,
  getVisionEscalationMeter,
} from "./aiAnomalyDetection";
import { l2normalize } from "./aiImageEmbedding";
import sharp from "sharp";

beforeEach(() => {
  mockState.bank = [];
  mockState.profile = null;
  mockState.dbNull = false;
});

// ── Pure algorithm tests ──────────────────────────────────────────────────────

describe("quantileSorted", () => {
  it("p99 of 0..99 ≈ 98.01 (linear interp)", () => {
    const arr = Array.from({ length: 100 }, (_, i) => i);
    expect(quantileSorted(arr, 99)).toBeCloseTo(98.01, 2);
  });
  it("p50 of [0..10] = 5", () => {
    const arr = Array.from({ length: 11 }, (_, i) => i);
    expect(quantileSorted(arr, 50)).toBe(5);
  });
  it("empty → 0, single → that value", () => {
    expect(quantileSorted([], 99)).toBe(0);
    expect(quantileSorted([7], 99)).toBe(7);
  });
});

describe("computeDistStats", () => {
  it("matches hand-computed stats", () => {
    const s = computeDistStats([0, 1, 2, 3, 4]);
    expect(s.count).toBe(5);
    expect(s.min).toBe(0);
    expect(s.max).toBe(4);
    expect(s.mean).toBeCloseTo(2, 5);
    expect(s.p50).toBeCloseTo(2, 5);
  });
});

describe("knnScore", () => {
  const a = l2normalize([1, 0, 0]);
  const b = l2normalize([0.99, 0.01, 0]);
  const far = l2normalize([0, 0, 1]);

  it("query near the bank → low score", () => {
    const bank = [a, b, l2normalize([0.98, 0.02, 0])];
    const score = knnScore(b, bank, 2);
    expect(score).toBeLessThan(0.05);
  });

  it("query far from the bank → high score", () => {
    const bank = [a, b, l2normalize([0.98, 0.02, 0])];
    const score = knnScore(far, bank, 2);
    expect(score).toBeGreaterThan(0.5);
  });

  it("empty bank → 0", () => {
    expect(knnScore(a, [], 3)).toBe(0);
  });
});

describe("greedyCoreset", () => {
  it("reduces size by the ratio", () => {
    const vectors = Array.from({ length: 20 }, (_, i) => l2normalize([Math.cos(i), Math.sin(i), 0]));
    const idx = greedyCoreset(vectors, 0.25);
    expect(idx.length).toBe(5);
    expect(new Set(idx).size).toBe(5); // distinct
  });
  it("ratio>=1 keeps all; empty → empty", () => {
    const vectors = [l2normalize([1, 0]), l2normalize([0, 1])];
    expect(greedyCoreset(vectors, 1).length).toBe(2);
    expect(greedyCoreset([], 0.5).length).toBe(0);
  });
  it("picks spread-out points (includes a far outlier)", () => {
    const cluster = Array.from({ length: 10 }, () => l2normalize([1, 0.001, 0]));
    const outlier = l2normalize([0, 0, 1]);
    const vectors = [...cluster, outlier];
    const idx = greedyCoreset(vectors, 0.2); // keep ~2
    expect(idx).toContain(vectors.length - 1); // outlier kept as farthest point
  });
});

// ── Handcrafted features ──────────────────────────────────────────────────────

async function solidImage(gray: number): Promise<Buffer> {
  return sharp({ create: { width: 64, height: 64, channels: 3, background: { r: gray, g: gray, b: gray } } })
    .png()
    .toBuffer();
}

async function noisyImage(): Promise<Buffer> {
  const w = 64, h = 64;
  const buf = Buffer.alloc(w * h * 3);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256);
  return sharp(buf, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

describe("extractHandcraftedFeatures", () => {
  it("returns a fixed-length L2-normalized vector", async () => {
    const v = await extractHandcraftedFeatures(await solidImage(128));
    const norm = Math.sqrt(v.reduce((a, x) => a + x * x, 0));
    expect(v.length).toBeGreaterThan(0);
    expect(norm).toBeCloseTo(1, 5);
  });
  it("distinguishes a flat image from a noisy image (distance > 0)", async () => {
    const flat = await extractHandcraftedFeatures(await solidImage(128));
    const noisy = await extractHandcraftedFeatures(await noisyImage());
    expect(cosineDistance(flat, noisy)).toBeGreaterThan(0.01);
  });
});

// ── 3-tier embedding degrade ──────────────────────────────────────────────────

describe("getEmbeddingForAnomaly degrade", () => {
  it("no modelId + GGUF unavailable → heuristic, degraded=true", async () => {
    const r = await getEmbeddingForAnomaly(await solidImage(100), { modelId: null });
    expect(r.source).toBe("heuristic");
    expect(r.degraded).toBe(true);
    expect(r.vector.length).toBeGreaterThan(0);
  });
});

// ── Build + score end-to-end (heuristic tier, mocked db) ──────────────────────

describe("buildMemoryBank + scoreImage (heuristic tier)", () => {
  it("builds a bank of OK images and flags an out-of-distribution image", async () => {
    // OK images: similar flat grays.
    const okImages = await Promise.all([110, 112, 108, 111, 109, 113].map((g) => solidImage(g)));
    const build = await buildMemoryBank({
      productModelId: 1,
      machineId: 1,
      modelId: null,
      images: okImages.map((b) => ({ buffer: b })),
      coresetRatio: 1,
      k: 2,
    });
    expect(build.source).toBe("heuristic");
    expect(build.degraded).toBe(true);
    expect(build.bankSize).toBeGreaterThan(0);
    expect(build.threshold).toBeGreaterThanOrEqual(0);

    // Score an OK-like image → not anomaly.
    const okScore = await scoreImage({ buffer: await solidImage(110), productModelId: 1, machineId: 1, modelId: null });
    expect(okScore.source).toBe("heuristic");
    expect(okScore.isAnomaly).toBe(false);

    // Score a very different (noisy) image → anomaly.
    const ngScore = await scoreImage({ buffer: await noisyImage(), productModelId: 1, machineId: 1, modelId: null });
    expect(ngScore.score).toBeGreaterThan(okScore.score);
    expect(ngScore.isAnomaly).toBe(true);
  });

  it("coreset ratio reduces stored bank size", async () => {
    const okImages = await Promise.all(
      Array.from({ length: 12 }, (_, i) => solidImage(100 + i)),
    );
    const build = await buildMemoryBank({
      productModelId: 2,
      machineId: 2,
      modelId: null,
      images: okImages.map((b) => ({ buffer: b })),
      coresetRatio: 0.5,
      k: 2,
    });
    expect(build.rawCount).toBe(12);
    expect(build.bankSize).toBe(6);
  });
});

// ── Degrade: getDb null → safe ────────────────────────────────────────────────

describe("scoreImage degrade safety", () => {
  it("getDb null (no profile/bank) → safe result, no throw", async () => {
    mockState.dbNull = true;
    const r = await scoreImage({ buffer: await solidImage(100), productModelId: 9, machineId: 9, modelId: null });
    expect(r.isAnomaly).toBe(false);
    expect(r.threshold).toBeNull();
    expect(r.reason).toBe("no_profile");
    expect(r.source).toBe("heuristic");
  });

  it("empty bank → safe result", async () => {
    mockState.profile = { threshold: "0.50000000", k: 5, degraded: true };
    mockState.bank = [];
    const r = await scoreImage({ buffer: await solidImage(100), productModelId: 1, machineId: 1, modelId: null });
    expect(r.isAnomaly).toBe(false);
    expect(r.reason).toBe("empty_bank");
  });
});

// ── F3/D2 (doc69 G9) — scorer uses calibratedThreshold when present, else the
// existing fixed p99 `threshold` (behaviour-preserving fallback). ──────────────

describe("scoreFromVector — calibrated threshold vs p99 fallback", () => {
  // bank=[[1,0,0]], query=[3,4,0] → cosineSimilarity = dot/(|a||b|) = 3/(5*1) = 0.6
  // → cosineDistance = 0.4 exactly. knnScore(k=1) = 0.4.
  const bank = [[1, 0, 0]];
  const query = [3, 4, 0];
  const scope = { productModelId: 1, machineId: 1, modelCode: "anomaly:onnx:1" };

  it("no calibratedThreshold on the profile → uses p99 threshold, unchanged", async () => {
    mockState.profile = { threshold: "0.50000000", k: 1, degraded: false };
    mockState.bank = bank;
    const r = await scoreFromVector(query, scope);
    expect(r.score).toBeCloseTo(0.4, 10);
    expect(r.threshold).toBe(0.5);
    expect(r.calibrated).toBe(false);
    expect(r.isAnomaly).toBe(false); // 0.4 is NOT > 0.5
  });

  it("calibratedThreshold present → overrides p99, flips the isAnomaly verdict", async () => {
    mockState.profile = { threshold: "0.50000000", calibratedThreshold: "0.10000000", k: 1, degraded: false };
    mockState.bank = bank;
    const r = await scoreFromVector(query, scope);
    expect(r.score).toBeCloseTo(0.4, 10);
    expect(r.threshold).toBe(0.1);
    expect(r.calibrated).toBe(true);
    expect(r.isAnomaly).toBe(true); // 0.4 IS > 0.1
  });
});

describe("anomalyModelCode scope separation", () => {
  it("separates onnx (by id) from text-of-image and heuristic", () => {
    expect(anomalyModelCode("onnx", 7)).toBe("anomaly:onnx:7");
    expect(anomalyModelCode("text-of-image", null)).toBe("anomaly:text-of-image");
    expect(anomalyModelCode("heuristic", null)).toBe("anomaly:heuristic");
  });
});

// ── B3.2 / B8ter — VL escalation gate (the 2-10% gate enforcement) ────────────

describe("shouldEscalateToVision gate", () => {
  it("disabled flag → never escalates", () => {
    const d = shouldEscalateToVision(99, "NG", { enabled: false, profileThreshold: 0.1 });
    expect(d.escalate).toBe(false);
    expect(d.reason).toBe("disabled");
  });

  it("OK image below threshold → does NOT escalate (the 90-98% common case)", () => {
    const d = shouldEscalateToVision(0.05, "OK", { enabled: true, profileThreshold: 0.5, ignoreRateLimit: true });
    expect(d.escalate).toBe(false);
    expect(d.reason).toBe("below_threshold");
  });

  it("suspect anomaly above threshold → escalates", () => {
    const d = shouldEscalateToVision(0.9, "OK", { enabled: true, profileThreshold: 0.5, ignoreRateLimit: true });
    expect(d.escalate).toBe(true);
    expect(d.reason).toBe("anomaly_suspect");
  });

  it("NG classification → escalates even with low score / no threshold", () => {
    const d = shouldEscalateToVision(0, "NG", { enabled: true, profileThreshold: null, ignoreRateLimit: true });
    expect(d.escalate).toBe(true);
    expect(d.reason).toBe("ng_classified");
  });

  it("no threshold + OK → no_threshold, no escalate", () => {
    const d = shouldEscalateToVision(0.9, "OK", { enabled: true, profileThreshold: null, ignoreRateLimit: true });
    expect(d.escalate).toBe(false);
    expect(d.reason).toBe("no_threshold");
  });

  it("meter counts seen vs escalated (gate is observable)", () => {
    const before = getVisionEscalationMeter().totalSeen;
    shouldEscalateToVision(0.05, "OK", { enabled: true, profileThreshold: 0.5, ignoreRateLimit: true });
    shouldEscalateToVision(0.9, "OK", { enabled: true, profileThreshold: 0.5, ignoreRateLimit: true });
    const m = getVisionEscalationMeter();
    expect(m.totalSeen).toBeGreaterThanOrEqual(before + 2);
    expect(m.escalationRate).toBeGreaterThanOrEqual(0);
    expect(m.escalationRate).toBeLessThanOrEqual(1);
  });
});
