/**
 * AOI Tier-2 — PATCH-LEVEL (pixel-localizing) anomaly verification.
 *
 * Proves the upgrade from a whole-image scalar to a localizing heatmap:
 *   (a) a seeded LOCAL defect produces a heatmap PEAK AT the defect location
 *       (localization), with a hotspot bbox over that region — not just a scalar.
 *   (b) a clean image → a low, flat map (no hotspots).
 *   (c) the image-level score is still returned and is consistent (max of the map).
 *   (d) the degraded tier is labelled (source/tier "heuristic", degraded true).
 *   (e) flag OFF → scoreImage's whole-image path is unchanged (no `patch` field);
 *       flag ON → scoreImage augments with a real patch heatmap.
 * Plus pure-math unit tests (bilinear upsample, connected components, hotspots).
 *
 * No real DB / ONNX / GGUF: a scope-aware in-memory bank mock; sharp makes images.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import sharp from "sharp";

// ── Scope-aware in-memory bank/profile mock (whole-image + patch banks coexist) ──
const store: { banks: Record<string, number[][]>; profiles: Record<string, any> } = {
  banks: {},
  profiles: {},
};

vi.mock("../db/aiAnomaly", () => ({
  clearBank: vi.fn(async (scope: any) => {
    delete store.banks[scope.modelCode];
  }),
  insertBankRows: vi.fn(async (scope: any, rows: any[]) => {
    store.banks[scope.modelCode] = rows.map((r) => r.vector);
    return rows.length;
  }),
  loadBank: vi.fn(async (scope: any) => store.banks[scope.modelCode] ?? []),
  upsertProfile: vi.fn(async (scope: any, input: any) => {
    store.profiles[scope.modelCode] = { ...input };
  }),
  getProfile: vi.fn(async (scope: any) => store.profiles[scope.modelCode] ?? null),
  getBankStats: vi.fn(async () => ({ totalVectors: 0, distinctModelCodes: 0, profiles: [] })),
  deleteScope: vi.fn(async () => {}),
}));

// No ONNX model + no GGUF → forces the heuristic (degraded) patch tier.
vi.mock("./aiGgufEngine", () => ({ isGgufAvailable: vi.fn(async () => false) }));

import {
  isPatchAnomalyEnabled,
  patchAnomalyModelCode,
  extractPatchFeatureGrid,
  buildPatchMemoryBank,
  scoreImagePatch,
  scorePatchMap,
  bilinearUpsample,
  connectedComponentRegions,
  extractHotspots,
} from "./aiPatchAnomaly";
import { scoreImage, buildMemoryBank } from "./aiAnomalyDetection";
import { l2normalize } from "./aiImageEmbedding";

const SIZE = 128;

/** Deterministic grayscale image from a pixel function → PNG buffer. */
async function grayImage(fn: (x: number, y: number) => number): Promise<Buffer> {
  const buf = Buffer.alloc(SIZE * SIZE * 3);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const g = Math.max(0, Math.min(255, Math.round(fn(x, y))));
      const i = (y * SIZE + x) * 3;
      buf[i] = g;
      buf[i + 1] = g;
      buf[i + 2] = g;
    }
  }
  return sharp(buf, { raw: { width: SIZE, height: SIZE, channels: 3 } }).png().toBuffer();
}

/** OK base: ~gray 110 with mild deterministic ±4 texture (in-distribution, seedable). */
function okFn(seed: number): (x: number, y: number) => number {
  return (x, y) => 110 + (((x * 7 + y * 13 + seed * 29) % 9) - 4);
}

/** Defect: OK base + a bright (240) square in a KNOWN region (localization target). */
function defectFn(seed: number, x0: number, y0: number, sz: number): (x: number, y: number) => number {
  const base = okFn(seed);
  return (x, y) => (x >= x0 && x < x0 + sz && y >= y0 && y < y0 + sz ? 240 : base(x, y));
}

async function okBankImages(n: number): Promise<Array<{ buffer: Buffer }>> {
  const out: Array<{ buffer: Buffer }> = [];
  for (let s = 1; s <= n; s++) out.push({ buffer: await grayImage(okFn(s)) });
  return out;
}

beforeEach(() => {
  store.banks = {};
  store.profiles = {};
  delete process.env.ANOMALY_PATCH_ENABLED;
});

// ══════════════════════════════════════════════════════════════════════════════
// Pure math
// ══════════════════════════════════════════════════════════════════════════════

describe("bilinearUpsample", () => {
  it("upsamples a single hot low-res cell to a peak near that cell", () => {
    // 4x4 low map, hot at (col=1,row=2).
    const gw = 4, gh = 4;
    const low = new Array(gw * gh).fill(0);
    low[2 * gw + 1] = 1; // row 2, col 1
    const outW = 32, outH = 32;
    const up = bilinearUpsample(low, gw, gh, outW, outH);
    let best = -1, bx = -1, by = -1;
    for (let i = 0; i < up.length; i++) if (up[i] > best) { best = up[i]; bx = i % outW; by = Math.floor(i / outW); }
    // Low cell (col1,row2) center maps to ≈ x=(1.5/4)*32=12, y=(2.5/4)*32=20.
    expect(bx).toBeGreaterThanOrEqual(8);
    expect(bx).toBeLessThanOrEqual(16);
    expect(by).toBeGreaterThanOrEqual(16);
    expect(by).toBeLessThanOrEqual(24);
  });

  it("is flat when the low map is flat", () => {
    const up = bilinearUpsample(new Array(16).fill(0.3), 4, 4, 20, 20);
    expect(Math.max(...up)).toBeCloseTo(0.3, 6);
    expect(Math.min(...up)).toBeCloseTo(0.3, 6);
  });
});

describe("connectedComponentRegions", () => {
  it("separates two blobs and reports bbox + peak", () => {
    const w = 10, h = 10;
    const bin = new Uint8Array(w * h);
    const scores = new Array(w * h).fill(0);
    // Blob A: (1,1)-(2,2). Blob B: (7,7)-(8,8).
    for (const [x, y, s] of [[1, 1, 0.4], [2, 1, 0.9], [1, 2, 0.4], [2, 2, 0.4]] as const) { bin[y * w + x] = 1; scores[y * w + x] = s; }
    for (const [x, y] of [[7, 7], [8, 7], [7, 8], [8, 8]] as const) { bin[y * w + x] = 1; scores[y * w + x] = 0.5; }
    const regions = connectedComponentRegions(bin, scores, w, h);
    expect(regions.length).toBe(2);
    const a = regions.find((r) => r.minX === 1)!;
    expect(a.maxX).toBe(2);
    expect(a.maxY).toBe(2);
    expect(a.count).toBe(4);
    expect(a.peak).toBeCloseTo(0.9, 6);
  });
});

describe("extractHotspots", () => {
  it("finds one region over a raised square, bbox covers it, peak reported", () => {
    const w = 20, h = 20;
    const raw = new Array(w * h).fill(0.01);
    for (let y = 5; y < 10; y++) for (let x = 6; x < 12; x++) raw[y * w + x] = 0.8;
    const hs = extractHotspots(raw, w, h, 0.5, { minAreaPx: 1 });
    expect(hs.length).toBe(1);
    expect(hs[0].bbox).toEqual({ x: 6, y: 5, w: 6, h: 5 });
    expect(hs[0].peakScore).toBeCloseTo(0.8, 6);
    expect(hs[0].metrology).toBeTruthy();
    // Centroid inside the square.
    expect(hs[0].centroid.x).toBeGreaterThanOrEqual(6);
    expect(hs[0].centroid.x).toBeLessThan(12);
  });

  it("returns no hotspots when nothing exceeds the threshold (flat map)", () => {
    const hs = extractHotspots(new Array(400).fill(0.02), 20, 20, 0.5, { minAreaPx: 1 });
    expect(hs.length).toBe(0);
  });
});

describe("scorePatchMap", () => {
  it("near patches score low, far patches score high", () => {
    const bank = [l2normalize([1, 0, 0]), l2normalize([0.99, 0.01, 0]), l2normalize([0.98, 0.02, 0])];
    const scores = scorePatchMap([l2normalize([0.99, 0.005, 0]), l2normalize([0, 0, 1])], bank, 2);
    expect(scores[0]).toBeLessThan(0.05);
    expect(scores[1]).toBeGreaterThan(0.5);
  });
});

describe("extractPatchFeatureGrid", () => {
  it("returns grid*grid L2-normalized patch vectors", async () => {
    const vecs = await extractPatchFeatureGrid(await grayImage(okFn(1)), 8);
    expect(vecs.length).toBe(64);
    for (const v of vecs.slice(0, 3)) {
      const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0));
      expect(n).toBeCloseTo(1, 5);
    }
  });

  it("a bright-square patch differs from the surrounding flat patches", async () => {
    const vecs = await extractPatchFeatureGrid(await grayImage(defectFn(1, 16, 16, 32)), 8);
    // Defect cell (row 1-2, col 1-2) vs a clean corner cell (row 7,col 7).
    const defectCell = vecs[1 * 8 + 1];
    const cleanCell = vecs[7 * 8 + 7];
    const dot = defectCell.reduce((a, x, i) => a + x * cleanCell[i], 0);
    expect(1 - dot).toBeGreaterThan(0.1); // cosine distance clearly nonzero
  });
});

describe("patchAnomalyModelCode", () => {
  it("is distinct from the whole-image bank and carries source + grid", () => {
    expect(patchAnomalyModelCode("heuristic", null, 8)).toBe("anomaly:patch:heuristic:g8");
    expect(patchAnomalyModelCode("onnx", 7, 16)).toBe("anomaly:patch:onnx:7:g16");
    expect(patchAnomalyModelCode("heuristic", null, 8)).not.toBe("anomaly:heuristic");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// End-to-end build + score (heuristic tier, scope-aware mocked DB)
// ══════════════════════════════════════════════════════════════════════════════

describe("patch build + localize", () => {
  const GRID = 8;

  async function buildBank() {
    return buildPatchMemoryBank({
      productModelId: 1,
      machineId: 1,
      modelId: null,
      images: await okBankImages(8),
      grid: GRID,
      coresetRatio: 1, // keep all patches → clean OK image matches exactly
      k: 3,
    });
  }

  it("(d) build labels the degraded heuristic tier honestly", async () => {
    const b = await buildBank();
    expect(b.source).toBe("heuristic");
    expect(b.degraded).toBe(true);
    expect(b.grid).toBe(GRID);
    expect(b.bankSize).toBeGreaterThan(0);
    expect(b.rawPatchCount).toBe(64 * 8);
    expect(store.profiles[b.scope.modelCode]).toBeTruthy();
  });

  it("(a) a seeded local defect peaks AT the defect location + yields a hotspot there", async () => {
    await buildBank();
    // Defect square at x∈[16,48), y∈[16,48) → cells rows1-2/cols1-2 → top-left quadrant.
    const defect = await grayImage(defectFn(3, 16, 16, 32));
    const r = await scoreImagePatch({
      buffer: defect, productModelId: 1, machineId: 1, modelId: null, grid: GRID,
      includeHeatmapArray: true, includeHeatmapPng: true,
    });

    expect(r.heatmap).toBeTruthy();
    expect(r.isAnomaly).toBe(true);
    expect(r.hotspots.length).toBeGreaterThanOrEqual(1);

    // Low-res argmax lands on a defect cell (rows/cols 1-2).
    const low = r.heatmap!.lowRes.raw;
    let li = 0; for (let i = 1; i < low.length; i++) if (low[i] > low[li]) li = i;
    const gx = li % GRID, gy = Math.floor(li / GRID);
    expect(gx).toBeGreaterThanOrEqual(1); expect(gx).toBeLessThanOrEqual(2);
    expect(gy).toBeGreaterThanOrEqual(1); expect(gy).toBeLessThanOrEqual(2);

    // Full-res heatmap argmax is in the top-left quadrant (localized, not global).
    const data = r.heatmap!.data!;
    const W = r.heatmap!.width, H = r.heatmap!.height;
    let bi = 0; for (let i = 1; i < data.length; i++) if (data[i] > data[bi]) bi = i;
    const bx = bi % W, by = Math.floor(bi / W);
    expect(bx).toBeLessThan(W / 2);
    expect(by).toBeLessThan(H / 2);

    // Top hotspot centroid also in the top-left quadrant.
    const top = r.hotspots[0];
    expect(top.centroid.x).toBeLessThan(W / 2);
    expect(top.centroid.y).toBeLessThan(H / 2);
    expect(top.peakScore).toBeGreaterThan(r.threshold ?? 0);

    // The heatmap is a real image (PNG rendered) — not a scalar.
    expect(typeof r.heatmap!.pngBase64).toBe("string");
    expect((r.heatmap!.pngBase64 ?? "").length).toBeGreaterThan(100);
  });

  it("(b) a clean image → low, flat map with no hotspots", async () => {
    await buildBank();
    const clean = await grayImage(okFn(3)); // identical to a bank member → exact matches
    const r = await scoreImagePatch({
      buffer: clean, productModelId: 1, machineId: 1, modelId: null, grid: GRID,
      includeHeatmapArray: true,
    });
    expect(r.heatmap).toBeTruthy();
    expect(r.isAnomaly).toBe(false);
    expect(r.hotspots.length).toBe(0);
    const maxNorm = Math.max(...r.heatmap!.data!);
    expect(maxNorm).toBeLessThan(0.5); // flat / dark
    expect(r.imageScore).toBeLessThanOrEqual(r.threshold ?? 0);
  });

  it("(c) image-level score is still returned and consistent (= max of the map)", async () => {
    await buildBank();
    const defect = await grayImage(defectFn(3, 16, 16, 32));
    const rDefect = await scoreImagePatch({ buffer: defect, productModelId: 1, machineId: 1, modelId: null, grid: GRID });
    const clean = await grayImage(okFn(3));
    const rClean = await scoreImagePatch({ buffer: clean, productModelId: 1, machineId: 1, modelId: null, grid: GRID });

    // imageScore equals the max of the low-res map (canonical PatchCore image score).
    const lowMax = Math.max(...rDefect.heatmap!.lowRes.raw);
    expect(rDefect.imageScore).toBeCloseTo(lowMax, 6);
    expect(Number.isFinite(rDefect.imageScore)).toBe(true);
    // A defect scores strictly higher than a clean image.
    expect(rDefect.imageScore).toBeGreaterThan(rClean.imageScore);
  });

  it("(d) score result labels the degraded heuristic tier", async () => {
    await buildBank();
    const r = await scoreImagePatch({ buffer: await grayImage(okFn(2)), productModelId: 1, machineId: 1, modelId: null, grid: GRID });
    expect(r.source).toBe("heuristic");
    expect(r.tier).toBe("heuristic");
    expect(r.degraded).toBe(true);
  });

  it("no patch bank → safe result, no throw (fail-safe)", async () => {
    const r = await scoreImagePatch({ buffer: await grayImage(okFn(1)), productModelId: 9, machineId: 9, modelId: null, grid: GRID });
    expect(r.isAnomaly).toBe(false);
    expect(r.heatmap).toBeNull();
    expect(r.reason).toBe("no_patch_profile");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// (e) Flag gating — whole-image path unchanged when OFF; augmented when ON
// ══════════════════════════════════════════════════════════════════════════════

describe("ANOMALY_PATCH_ENABLED flag gating", () => {
  it("isPatchAnomalyEnabled reflects the env flag", () => {
    delete process.env.ANOMALY_PATCH_ENABLED;
    expect(isPatchAnomalyEnabled()).toBe(false);
    process.env.ANOMALY_PATCH_ENABLED = "true";
    expect(isPatchAnomalyEnabled()).toBe(true);
    delete process.env.ANOMALY_PATCH_ENABLED;
  });

  it("(e) flag OFF → scoreImage returns the whole-image result with NO patch field", async () => {
    delete process.env.ANOMALY_PATCH_ENABLED;
    // Build the whole-image (non-patch) bank so scoreImage has something to score.
    await buildMemoryBank({
      productModelId: 5, machineId: 5, modelId: null,
      images: await okBankImages(6).then((imgs) => imgs.map((i) => ({ buffer: i.buffer }))),
      coresetRatio: 1, k: 2,
    });
    const r = await scoreImage({ buffer: await grayImage(okFn(2)), productModelId: 5, machineId: 5, modelId: null });
    expect(r.source).toBe("heuristic");
    expect((r as any).patch).toBeUndefined(); // whole-image path unchanged
  });

  it("(e) flag ON → scoreImage augments with a real patch heatmap", async () => {
    // Whole-image bank AND patch bank (scope-aware mock keeps both).
    await buildMemoryBank({
      productModelId: 7, machineId: 7, modelId: null,
      images: (await okBankImages(6)).map((i) => ({ buffer: i.buffer })),
      coresetRatio: 1, k: 2,
    });
    await buildPatchMemoryBank({
      productModelId: 7, machineId: 7, modelId: null,
      images: await okBankImages(8), grid: 8, coresetRatio: 1, k: 3,
    });
    process.env.ANOMALY_PATCH_ENABLED = "true";
    const defect = await grayImage(defectFn(3, 16, 16, 32));
    const r = await scoreImage({ buffer: defect, productModelId: 7, machineId: 7, modelId: null });
    delete process.env.ANOMALY_PATCH_ENABLED;

    expect((r as any).patch).toBeTruthy();
    expect(r.patch!.heatmap).toBeTruthy();
    expect(r.patch!.hotspots.length).toBeGreaterThanOrEqual(1);
    expect(r.patch!.tier).toBe("heuristic");
    // Whole-image scalar is still the primary result.
    expect(typeof r.score).toBe("number");
  });
});
