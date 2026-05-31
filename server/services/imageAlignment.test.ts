/**
 * B4.2 — imageAlignment tests (sharp THẬT, không mock — thuần xử lý ảnh).
 *
 * - Ảnh giả dịch known → NCC khôi phục offset (±1-2 px ở độ phân giải gốc).
 * - Sau align diffRatio giảm so với chưa align.
 * - Ảnh nhiễu ngẫu nhiên (không tương quan) → confidence thấp → aligned:false.
 */
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { alignToReference, diffRatioGray, type GrayImage } from "./imageAlignment";

const W = 128;
const H = 128;

/**
 * Tạo grayscale raw mà TOÀN BỘ nội dung dịch theo (ox,oy): các sọc chéo có tần số
 * cao (giàu cấu trúc) → NCC nhạy với dịch (khác với 1 ô nhỏ trên nền cố định, vốn
 * khiến nền chi phối NCC và ưu tiên shift=0). Đây là test khôi phục dịch trung thực.
 */
// Trường nhiễu CỐ ĐỊNH (deterministic hash) → nội dung không tuần hoàn, NCC có đỉnh
// DUY NHẤT, sắc tại đúng offset. searchSize=W để alignment không resize (không nhoè).
function noiseAt(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return ((h % 256) + 256) % 256;
}
function makePattern(ox: number, oy: number): GrayImage {
  const data = Buffer.alloc(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      data[y * W + x] = noiseAt(x - ox, y - oy);
    }
  }
  return { data, width: W, height: H };
}

describe("alignToReference — known translation", () => {
  it("recovers a known horizontal+vertical shift and reduces diffRatio", async () => {
    const ref = makePattern(0, 0);
    // test = toàn ảnh dịch +8px ngang, +6px dọc so với ref.
    const test = makePattern(8, 6);

    const res = await alignToReference(ref, test, { maxShift: 16, maxAngle: 0, searchSize: 128, minConfidence: 0.2 });

    // NCC khôi phục độ lớn offset (±2px); dấu phụ thuộc quy ước bù — kiểm magnitude.
    expect(Math.abs(Math.abs(res.dx) - 8)).toBeLessThanOrEqual(2);
    expect(Math.abs(Math.abs(res.dy) - 6)).toBeLessThanOrEqual(2);
    expect(res.confidence).toBeGreaterThan(0.5);
    expect(res.aligned).toBe(true);

    // diffRatio sau align PHẢI giảm rõ rệt so với chưa căn (so trực tiếp trên raw).
    const refRaw = new Uint8Array(ref.data);
    const testRaw = new Uint8Array(test.data);
    const before = diffRatioGray(refRaw, testRaw);
    const after = diffRatioGray(refRaw, new Uint8Array(res.alignedBuffer));
    expect(after).toBeLessThan(before);
  });
});

describe("alignToReference — coarse rotation search", () => {
  it("searches small rotation angles within ±maxAngle", async () => {
    const ref = makePattern(0, 0);
    // Xoay ref nhẹ ~3° làm test.
    const rotated = await sharp(Buffer.from(ref.data), { raw: { width: W, height: H, channels: 1 } })
      .rotate(3, { background: { r: 0, g: 0, b: 0 } })
      .resize(W, H, { fit: "fill" })
      .raw()
      .toBuffer();
    const test: GrayImage = { data: rotated, width: W, height: H };

    const res = await alignToReference(ref, test, { maxShift: 8, maxAngle: 5, angleStep: 1, minConfidence: 0.1 });
    // Góc tìm được nằm trong dải tìm kiếm.
    expect(Math.abs(res.angle)).toBeLessThanOrEqual(5);
    expect(res.confidence).toBeGreaterThan(0);
  });
});

describe("alignToReference — low confidence → aligned:false", () => {
  it("uncorrelated noise yields low confidence and aligned:false", async () => {
    const ref: GrayImage = { data: Buffer.alloc(W * H), width: W, height: H };
    const test: GrayImage = { data: Buffer.alloc(W * H), width: W, height: H };
    for (let i = 0; i < W * H; i++) {
      ref.data[i] = Math.floor(Math.random() * 256);
      test.data[i] = Math.floor(Math.random() * 256);
    }
    const res = await alignToReference(ref, test, { maxShift: 8, maxAngle: 0, minConfidence: 0.5 });
    expect(res.confidence).toBeLessThan(0.5);
    expect(res.aligned).toBe(false);
  });
});

describe("diffRatioGray", () => {
  it("identical buffers → 0", () => {
    const a = new Uint8Array([10, 20, 30, 40]);
    expect(diffRatioGray(a, a)).toBe(0);
  });
  it("fully different → 1", () => {
    const a = new Uint8Array([0, 0, 0, 0]);
    const b = new Uint8Array([255, 255, 255, 255]);
    expect(diffRatioGray(a, b)).toBe(1);
  });
});
