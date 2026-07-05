/**
 * W7-C (doc 27 §9 V7 + V15) — golden-diff chain tests (PURE — no DB).
 *
 * Synthetic-image verification of the two claims the production chain makes:
 *  - V15 lighting normalization: the SAME content under a brightness gradient
 *    diffs near-zero WITH normalization and high WITHOUT it.
 *  - V7 align-before-diff: a shifted candidate registers with high confidence
 *    and the post-alignment diff collapses versus the unaligned diff.
 *
 * Uses goldenDiffAgainstGray (the DB-free core of goldenDiffForKey) so no
 * golden row is needed; the DB wrapper is covered by goldenApproval.test.ts.
 */
import { describe, it, expect, beforeAll } from "vitest";
import sharp from "sharp";
import {
  normalizeIllumination,
  goldenDiffAgainstGray,
} from "./aiAdvancedVision";
import type { GrayImage } from "./imageRegistration";

// Deterministic PRNG (mulberry32) — reproducible texture.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MASTER = 280; // master texture; crops of 200×200 avoid border artefacts
const CROP = 200;

let master: Buffer; // raw gray MASTER×MASTER, feature scale ~6-8 px

/** Crop a CROP×CROP window out of the raw master at (x0, y0). */
function cropRaw(x0: number, y0: number): Buffer {
  const out = Buffer.alloc(CROP * CROP);
  for (let y = 0; y < CROP; y++) {
    master.copy(out, y * CROP, (y0 + y) * MASTER + x0, (y0 + y) * MASTER + x0 + CROP);
  }
  return out;
}

function grayImage(data: Buffer): GrayImage {
  return { data, width: CROP, height: CROP };
}

/** Encode a raw gray plane as PNG (goldenDiffAgainstGray takes an ENCODED candidate). */
async function toPng(data: Buffer): Promise<Buffer> {
  return sharp(data, { raw: { width: CROP, height: CROP, channels: 1 } }).png().toBuffer();
}

/** Apply a horizontal multiplicative brightness gradient 0.6 → 1.4 (mean ≈ 1). */
function applyGradient(data: Buffer): Buffer {
  const out = Buffer.alloc(data.length);
  for (let y = 0; y < CROP; y++) {
    for (let x = 0; x < CROP; x++) {
      const gain = 0.6 + 0.8 * (x / (CROP - 1));
      const v = Math.round(data[y * CROP + x] * gain);
      out[y * CROP + x] = v > 255 ? 255 : v;
    }
  }
  return out;
}

beforeAll(async () => {
  // High-contrast blob texture (feature scale ~7 px): random noise → blur σ=3 →
  // binarize at the median (0/230) → light σ=1 soften. Blob EDGES are dense and
  // steep, so a 6-px shift pushes a large share of pixels past the 25-gray diff
  // threshold (decorrelation), while registration has strong gradients to lock on.
  const rand = mulberry32(42);
  const noise = Buffer.alloc(MASTER * MASTER);
  for (let i = 0; i < noise.length; i++) noise[i] = Math.floor(rand() * 256);
  const smooth = await sharp(noise, { raw: { width: MASTER, height: MASTER, channels: 1 } })
    .blur(3)
    .toColourspace("b-w")
    .raw()
    .toBuffer();
  const sorted = Array.from(smooth).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const binary = Buffer.alloc(smooth.length);
  for (let i = 0; i < smooth.length; i++) binary[i] = smooth[i] > median ? 230 : 20;
  master = await sharp(binary, { raw: { width: MASTER, height: MASTER, channels: 1 } })
    .blur(1)
    .toColourspace("b-w")
    .raw()
    .toBuffer();
});

describe("V15 — illumination (flat-field) normalization", () => {
  it("flattens a smooth brightness gradient on a uniform plane", async () => {
    const flat = Buffer.alloc(CROP * CROP, 128);
    const lit = applyGradient(flat); // 77 → 179 across the width
    const norm = await normalizeIllumination({ data: lit, width: CROP, height: CROP });

    // Compare the horizontal extremes (column means far apart) — the gradient
    // spans ~100 gray levels before normalization and must collapse after.
    const colMean = (img: Buffer, x: number) => {
      let s = 0;
      for (let y = 0; y < CROP; y++) s += img[y * CROP + x];
      return s / CROP;
    };
    const beforeSpread = Math.abs(colMean(lit, CROP - 8) - colMean(lit, 8));
    const afterSpread = Math.abs(colMean(norm.data, CROP - 8) - colMean(norm.data, 8));
    expect(beforeSpread).toBeGreaterThan(60);
    expect(afterSpread).toBeLessThan(10);
  });

  it("same textured image + brightness gradient → diff ~0 WITH normalization, high WITHOUT", async () => {
    const golden = grayImage(cropRaw(30, 30));
    const gradientLit = await toPng(applyGradient(cropRaw(30, 30)));

    const without = await goldenDiffAgainstGray(golden, gradientLit, { normalize: false, align: false });
    const withNorm = await goldenDiffAgainstGray(golden, gradientLit, { normalize: true, align: false });

    // Without normalization the multiplicative gradient pushes a large share of
    // pixels past the diff threshold; with it the planes are near-identical.
    expect(without.diffRatio).toBeGreaterThan(0.15);
    expect(withNorm.diffRatio).toBeLessThan(0.03);
    expect(withNorm.diffRatio).toBeLessThan(without.diffRatio / 5);
    expect(withNorm.normalized).toBe(true);
    expect(without.normalized).toBe(false);
  });
});

describe("V7 — align-before-diff (sub-pixel registration in the golden path)", () => {
  it("shifted candidate: high alignment confidence + low diff after align, high diff without", async () => {
    const golden = grayImage(cropRaw(30, 30));
    // True content shift of (6, 4) px — cropped from the same master so there
    // are no empty borders faking the diff.
    const shifted = await toPng(cropRaw(36, 34));

    const unaligned = await goldenDiffAgainstGray(golden, shifted, { normalize: false, align: false });
    const aligned = await goldenDiffAgainstGray(golden, shifted, { normalize: false, align: true });

    // 6-px shift on ~7-px-scale texture decorrelates → large raw diff.
    expect(unaligned.diffRatio).toBeGreaterThan(0.1);

    // Registration must lock on: gate passed, honest confidence, collapsed diff.
    // Note: the binary-blob texture is worst-case for pixel diffs — its steep
    // 20↔230 edges turn even sub-pixel resampling residue into >25-gray hits,
    // so the absolute bound is 0.08 (not ~0); the RELATIVE collapse (≥3×) is
    // the claim that matters for align-before-diff.
    expect(aligned.aligned).toBe(true);
    expect(aligned.alignment?.confidence ?? 0).toBeGreaterThan(0.7);
    expect(aligned.diffRatio).toBeLessThan(0.08);
    expect(aligned.diffRatio).toBeLessThan(unaligned.diffRatio / 3);

    // Recovered translation magnitude ≈ hypot(6,4) ≈ 7.2 (generous ±3 px band —
    // sub-pixel accuracy is asserted in imageRegistration.test.ts; here we only
    // prove the production wiring recovers the right transform).
    const mag = Math.hypot(aligned.alignment?.dx ?? 0, aligned.alignment?.dy ?? 0);
    expect(mag).toBeGreaterThan(4);
    expect(mag).toBeLessThan(11);
  });

  it("identical images diff to ~0 and produce a valid heatmap PNG", async () => {
    const golden = grayImage(cropRaw(30, 30));
    const same = await toPng(cropRaw(30, 30));
    const r = await goldenDiffAgainstGray(golden, same, { normalize: true, align: true });

    expect(r.diffRatio).toBeLessThan(0.01);
    expect(r.diffScore).toBeLessThan(1);
    expect(r.width).toBe(CROP);
    expect(r.height).toBe(CROP);
    // Heatmap decodes to the golden's exact geometry.
    const meta = await sharp(r.heatmapPng).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(CROP);
    expect(meta.height).toBe(CROP);
  });
});
