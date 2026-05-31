/**
 * B5 — aiExplainability tests.
 *
 * Pure helpers (không cần ONNX): splitChannels, computeCAM, computeScoreCAM,
 * occlusionMapFromDrops, upscaleNearest. + explain() 3-tier degrade qua mock
 * aiInferenceEngine (feature map giả → score-cam; không feature map → occlusion;
 * không model → pixel-diff degraded:true).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock aiInferenceEngine (tránh nạp onnxruntime-node thật) ──────────────────
const mockRunInference = vi.fn();
const mockRunWithFeatureMap = vi.fn();
vi.mock("./aiInferenceEngine", () => ({
  runInference: (...a: unknown[]) => mockRunInference(...a),
  runInferenceWithFeatureMap: (...a: unknown[]) => mockRunWithFeatureMap(...a),
  // softmaxArray dùng thật (pure).
  softmaxArray: (data: Float32Array | number[]) => {
    const arr = Array.from(data);
    const mx = Math.max(...arr);
    const ex = arr.map((v) => Math.exp(v - mx));
    const s = ex.reduce((a, b) => a + b, 0) || 1;
    return ex.map((v) => v / s);
  },
}));

import {
  splitChannels,
  computeCAM,
  computeScoreCAM,
  occlusionMapFromDrops,
  upscaleNearest,
  explain,
  type ExplainResult,
} from "./aiExplainability";

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Pure helpers ─────────────────────────────────────────────────────────────

describe("splitChannels", () => {
  it("splits NCHW [1,2,2,2] into 2 channel planes", () => {
    // ch0 = [1,2,3,4], ch1 = [5,6,7,8]
    const fm = { name: "feat", data: new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]), dims: [1, 2, 2, 2] };
    const { channels, fh, fw } = splitChannels(fm);
    expect(fh).toBe(2);
    expect(fw).toBe(2);
    expect(Array.from(channels[0])).toEqual([1, 2, 3, 4]);
    expect(Array.from(channels[1])).toEqual([5, 6, 7, 8]);
  });
});

describe("computeCAM", () => {
  it("weighted-sum + ReLU + normalize lights up the high-weight channel region", () => {
    // ch0 hot ở pixel 0; ch1 hot ở pixel 3. weight ưu tiên ch0.
    const ch0 = new Float32Array([10, 0, 0, 0]);
    const ch1 = new Float32Array([0, 0, 0, 10]);
    const cam = computeCAM([ch0, ch1], [1, 0], 4);
    expect(cam[0]).toBeCloseTo(1, 6); // pixel 0 nóng nhất
    expect(cam[3]).toBeCloseTo(0, 6); // pixel 3 lạnh (weight ch1 = 0)
  });

  it("negative contributions are ReLU-clamped (no negative output)", () => {
    const ch0 = new Float32Array([5, -5]);
    const cam = computeCAM([ch0], [1], 2);
    expect(cam.every((v) => v >= 0)).toBe(true);
  });
});

describe("computeScoreCAM", () => {
  it("channel weights take the sign/magnitude of the forward score", async () => {
    const ch0 = new Float32Array([8, 0, 0, 0]);
    const ch1 = new Float32Array([0, 0, 0, 8]);
    // forwardScore: ch0 → 0.9 (quan trọng), ch1 → 0.1
    const scores: Record<number, number> = { 0: 0.9, 1: 0.1 };
    const forward = vi.fn(async (c: number) => scores[c]);
    const { map, weights } = await computeScoreCAM([ch0, ch1], 4, 2, forward);
    expect(weights[0]).toBeCloseTo(0.9, 6);
    expect(weights[1]).toBeCloseTo(0.1, 6);
    // map nóng ở vùng channel có score cao (pixel 0).
    expect(map[0]).toBeGreaterThan(map[3]);
    expect(forward).toHaveBeenCalledTimes(2);
  });
});

describe("occlusionMapFromDrops + upscaleNearest", () => {
  it("region A (large drop) becomes the hottest cell", () => {
    // 2x2 grid: ô (0,0) drop lớn nhất.
    const drops = [0.8, 0.1, 0.0, -0.2];
    const m = occlusionMapFromDrops(drops, 2);
    expect(m[0]).toBeCloseTo(1, 6); // chuẩn hoá → max = 1
    expect(m[3]).toBeCloseTo(0, 6); // drop âm → clamp 0 → min
  });

  it("upscaleNearest expands small grid to full size", () => {
    const small = new Float32Array([1, 0, 0, 0]); // 2x2
    const up = upscaleNearest(small, 2, 2, 4, 4); // → 4x4
    expect(up[0]).toBe(1); // góc trên-trái giữ giá trị ô (0,0)
    expect(up[15]).toBe(0); // góc dưới-phải ô (1,1)=0
  });
});

// ─── explain() 3-tier degrade ────────────────────────────────────────────────

describe("explain — tier 1 (feature map → score-cam, degraded:false)", () => {
  it("uses score-cam when model exposes a feature map", async () => {
    mockRunWithFeatureMap.mockResolvedValue({
      modelCode: "resnet",
      logits: new Float32Array([0.1, 3.0]), // class 1 wins
      logitsDims: [1, 2],
      labels: ["OK", "NG"],
      featureMap: { name: "feature", data: new Float32Array([9, 0, 0, 0, 0, 0, 0, 9]), dims: [1, 2, 2, 2] },
      inputName: "x",
      inputShape: [1, 3, 8, 8],
    });
    // runInference (forwardScore + occlusion baseline) → confidence cao cho NG.
    mockRunInference.mockResolvedValue({
      modelCode: "resnet", modelVersion: "1", predictions: [{ label: "NG", confidence: 0.7 }],
      topLabel: "NG", confidence: 0.7, processingTimeMs: 1, status: "COMPLETED",
    });

    const res: ExplainResult = await explain({ modelId: 1, imageBuffer: await pngBuffer() });
    expect(res.method).toBe("score-cam");
    expect(res.degraded).toBe(false);
    expect(res.approximate).toBe(false);
    expect(res.topLabel).toBe("NG");
    expect(res.heatmapPng.length).toBeGreaterThan(0);
  });
});

describe("explain — tier 2 (no feature map → occlusion, approximate:true)", () => {
  it("falls back to occlusion sensitivity when classifier has no feature map", async () => {
    mockRunWithFeatureMap.mockResolvedValue({
      modelCode: "cls",
      logits: new Float32Array([0.2, 2.5]),
      logitsDims: [1, 2],
      labels: ["OK", "NG"],
      featureMap: null,
      inputName: "x",
      inputShape: [1, 3, 8, 8],
    });
    mockRunInference.mockResolvedValue({
      modelCode: "cls", modelVersion: "1", predictions: [{ label: "NG", confidence: 0.6 }],
      topLabel: "NG", confidence: 0.6, processingTimeMs: 1, status: "COMPLETED",
    });

    const res = await explain({ modelId: 2, imageBuffer: await pngBuffer(), occlusionGrid: 4 });
    expect(res.method).toBe("occlusion");
    expect(res.approximate).toBe(true);
    expect(res.degraded).toBe(false);
    expect(res.heatmapPng.length).toBeGreaterThan(0);
  });
});

describe("explain — tier 3 (no model → pixel-diff, degraded:true)", () => {
  it("degrades to pixel-diff when modelId is undefined", async () => {
    const res = await explain({ imageBuffer: await pngBuffer() });
    expect(res.method).toBe("pixel-diff");
    expect(res.degraded).toBe(true);
    expect(res.topLabel).toBeNull();
    expect(mockRunWithFeatureMap).not.toHaveBeenCalled();
  });

  it("degrades to pixel-diff when feature-map inference throws", async () => {
    mockRunWithFeatureMap.mockRejectedValue(new Error("no onnx"));
    const res = await explain({ modelId: 9, imageBuffer: await pngBuffer() });
    expect(res.method).toBe("pixel-diff");
    expect(res.degraded).toBe(true);
  });
});

// Helper: tạo PNG nhỏ thật để sharp xử lý.
async function pngBuffer(): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  return sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 100, g: 120, b: 140 } } }).png().toBuffer();
}
