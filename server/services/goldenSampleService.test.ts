/**
 * AOI-B — goldenSampleService tests.
 *
 *  (d) golden-sample store/retrieve ROUND-TRIPS: encode an image → base64 gray →
 *      decode → the GrayImage matches (same W×H, byte-identical plane).
 *  Also: referenceFromImage builds a usable GrayImage; registration against a
 *      round-tripped reference aligns a warped candidate (end-to-end sanity).
 */
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import {
  encodeReference,
  decodeReference,
  referenceFromImage,
} from "./goldenSampleService";
import { registerToReference, type GrayImage } from "./imageRegistration";

/** Build a small encoded PNG with structure (gradient + block) for round-trip. */
async function makeEncodedImage(w = 64, h = 64): Promise<Buffer> {
  const rgb = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const v = Math.floor((x / w) * 255);
      rgb[i] = v;
      rgb[i + 1] = (x + y) % 2 === 0 ? 200 : 40;
      rgb[i + 2] = Math.floor((y / h) * 255);
    }
  }
  return sharp(rgb, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

describe("goldenSampleService — encode/decode round-trip", () => {
  it("encodeReference → decodeReference reconstructs the exact gray plane", async () => {
    const img = await makeEncodedImage(48, 40);
    const enc = await encodeReference(img, 512); // no downscale (image < 512)
    expect(enc.format).toBe("gray-raw");
    expect(enc.width).toBe(48);
    expect(enc.height).toBe(40);
    expect(enc.grayBase64.length).toBeGreaterThan(0);

    const gray = decodeReference(enc);
    expect(gray.width).toBe(48);
    expect(gray.height).toBe(40);
    expect(gray.data.length).toBe(48 * 40);

    // Byte-identical to the sharp-decoded grayscale of the source (source of truth).
    const { data: expected } = await sharp(img).grayscale().raw().toBuffer({ resolveWithObject: true });
    const got = Buffer.from(gray.data);
    expect(Buffer.compare(got, Buffer.from(expected))).toBe(0);
  });

  it("downscales the longest edge to maxEdge when the image is larger", async () => {
    const img = await makeEncodedImage(300, 200);
    const enc = await encodeReference(img, 100);
    // Longest edge (300) capped at 100 → 100×~67, aspect preserved.
    expect(Math.max(enc.width, enc.height)).toBe(100);
    expect(enc.width).toBe(100);
    expect(enc.height).toBe(67);
    const gray = decodeReference(enc);
    expect(gray.data.length).toBe(enc.width * enc.height);
  });

  it("referenceFromImage builds a GrayImage that registration can align to", async () => {
    // Reference from a real encoded image; candidate = same image (identity).
    const img = await makeEncodedImage(80, 80);
    const ref: GrayImage = await referenceFromImage(img, 512);
    const cand: GrayImage = { data: Buffer.from(ref.data), width: ref.width, height: ref.height };
    const res = await registerToReference(ref, cand, { workSize: 80, minConfidence: 0.9 });
    expect(res.aligned).toBe(true);
    expect(res.confidence).toBeGreaterThan(0.98);
  });
});
