/**
 * B4.2 — Golden-sample alignment trước pixel-diff (thuần JS/sharp, KHÔNG thêm dep).
 *
 * `alignToReference(refGray, testGray, opts)` ước lượng dịch (dx,dy) + xoay nhỏ
 * (angle) để căn `test` ↔ `reference`, trả luôn buffer đã căn (grayscale raw).
 *
 * Thuật toán (offline-first, không OpenCV / không FFT external):
 *   1. Coarse rotation search ±maxAngle (bước angleStep°) — xoay test bằng sharp.
 *   2. Với mỗi góc: template-matching NCC (normalized cross-correlation) trên ảnh
 *      DOWNSCALE trong dải dịch ±maxShift px → tìm (dx,dy) NCC cao nhất.
 *   3. Chọn (angle,dx,dy) NCC tổng cao nhất; confidence = NCC tốt nhất ∈ [0,1].
 *
 * GIỚI HẠN CỨNG (ghi rõ): sharp chỉ rotate + translate (+scale đều nếu muốn),
 * KHÔNG warp affine tổng quát → KHÔNG bù skew/perspective. Đây là alignment thô.
 *
 * Tất cả buffer raw là grayscale 1-channel (Uint8). Hàm thuần, dễ unit-test.
 */

import sharp from "sharp";

export interface GrayImage {
  data: Buffer | Uint8Array;
  width: number;
  height: number;
}

export interface AlignOptions {
  /** Dải dịch tìm kiếm (px) trên ảnh ĐÃ downscale. Default 16. */
  maxShift?: number;
  /** Biên độ xoay coarse search (độ). Default 5. */
  maxAngle?: number;
  /** Bước xoay (độ). Default 1. */
  angleStep?: number;
  /** Kích thước cạnh dài khi downscale để dò NCC (nhanh). Default 128. */
  searchSize?: number;
  /** Ngưỡng confidence để coi là align thành công (caller tự quyết dùng hay không). Default 0.3. */
  minConfidence?: number;
}

export interface AlignmentResult {
  dx: number;
  dy: number;
  angle: number;
  /** NCC tốt nhất ∈ [-1,1] kẹp về [0,1] cho UI; >0 nghĩa là tương quan dương. */
  confidence: number;
  /** test đã căn (rotate+translate) về hệ toạ độ reference, grayscale raw cùng W×H reference. */
  alignedBuffer: Buffer;
  alignedWidth: number;
  alignedHeight: number;
  /** true nếu confidence >= minConfidence (caller dùng kết quả align); false → nên dùng diff cũ. */
  aligned: boolean;
}

/** Resize 1-channel grayscale raw → kích thước mới (fit:fill) bằng sharp. */
async function resizeGray(
  img: GrayImage,
  w: number,
  h: number,
): Promise<Uint8Array> {
  // Kích thước đã khớp → trả thẳng (tránh sharp resample làm nhoè cấu trúc tần số cao).
  if (img.width === w && img.height === h) {
    return img.data instanceof Uint8Array && !Buffer.isBuffer(img.data)
      ? img.data
      : new Uint8Array(img.data);
  }
  const out = await sharp(Buffer.from(img.data), {
    raw: { width: img.width, height: img.height, channels: 1 },
  })
    .resize(w, h, { fit: "fill" })
    .raw()
    .toBuffer();
  return new Uint8Array(out);
}

/**
 * NCC của `test` so với `ref` tại dịch (sx, sy): chỉ tính trên vùng overlap.
 * Cả hai là grayscale w×h. Trả NCC ∈ [-1,1] (0 nếu vùng overlap rỗng/phẳng).
 */
function nccAtShift(
  ref: Uint8Array,
  test: Uint8Array,
  w: number,
  h: number,
  sx: number,
  sy: number,
): number {
  // Lấy mẫu vùng overlap: với mỗi pixel ref(x,y) so test(x - sx, y - sy).
  let n = 0;
  let sumR = 0;
  let sumT = 0;
  let sumRR = 0;
  let sumTT = 0;
  let sumRT = 0;

  const x0 = Math.max(0, sx);
  const x1 = Math.min(w, w + sx);
  const y0 = Math.max(0, sy);
  const y1 = Math.min(h, h + sy);

  for (let y = y0; y < y1; y++) {
    const ty = y - sy;
    for (let x = x0; x < x1; x++) {
      const tx = x - sx;
      const r = ref[y * w + x];
      const t = test[ty * w + tx];
      sumR += r;
      sumT += t;
      sumRR += r * r;
      sumTT += t * t;
      sumRT += r * t;
      n++;
    }
  }
  if (n === 0) return 0;
  const meanR = sumR / n;
  const meanT = sumT / n;
  const cov = sumRT / n - meanR * meanT;
  const varR = sumRR / n - meanR * meanR;
  const varT = sumTT / n - meanT * meanT;
  const denom = Math.sqrt(varR * varT);
  if (denom < 1e-6) return 0; // ảnh phẳng → NCC không xác định
  return cov / denom;
}

/**
 * Tìm (dx,dy) trong dải ±maxShift cho NCC cao nhất giữa ref & test (đã cùng W×H).
 *
 * Bỏ qua các dịch có overlap quá nhỏ (< minOverlapFrac diện tích): NCC trên cửa sổ
 * overlap nhỏ dễ cho điểm cao GIẢ (bias cửa sổ nhỏ), kéo kết quả về biên maxShift.
 */
function bestShift(
  ref: Uint8Array,
  test: Uint8Array,
  w: number,
  h: number,
  maxShift: number,
  minOverlapFrac = 0.5,
): { dx: number; dy: number; ncc: number } {
  const fullArea = w * h;
  let best = { dx: 0, dy: 0, ncc: -Infinity };
  for (let sy = -maxShift; sy <= maxShift; sy++) {
    const ovH = h - Math.abs(sy);
    for (let sx = -maxShift; sx <= maxShift; sx++) {
      const ovW = w - Math.abs(sx);
      if ((ovW * ovH) / fullArea < minOverlapFrac) continue; // overlap quá nhỏ → bỏ
      const ncc = nccAtShift(ref, test, w, h, sx, sy);
      if (ncc > best.ncc) best = { dx: sx, dy: sy, ncc };
    }
  }
  // Nếu mọi shift bị loại (maxShift quá lớn so với ảnh), fallback shift 0.
  if (best.ncc === -Infinity) best = { dx: 0, dy: 0, ncc: nccAtShift(ref, test, w, h, 0, 0) };
  return best;
}

/**
 * Căn `test` ↔ `reference`. Trả (dx,dy,angle,confidence) + buffer test đã căn về hệ
 * toạ độ reference (grayscale raw, cùng W×H reference).
 *
 * dx,dy được quy đổi về toạ độ ĐỘ PHÂN GIẢI GỐC reference (scale ngược từ searchSize).
 */
export async function alignToReference(
  reference: GrayImage,
  test: GrayImage,
  opts?: AlignOptions,
): Promise<AlignmentResult> {
  const maxShift = opts?.maxShift ?? 16;
  const maxAngle = opts?.maxAngle ?? 5;
  const angleStep = opts?.angleStep ?? 1;
  const searchSize = opts?.searchSize ?? 128;
  const minConfidence = opts?.minConfidence ?? 0.3;

  const W = reference.width;
  const H = reference.height;

  // Downscale reference về searchSize (giữ vuông để xoay an toàn).
  const sw = Math.min(searchSize, W);
  const sh = Math.min(searchSize, H);
  const refSmall = await resizeGray(reference, sw, sh);

  // Chuẩn bị danh sách góc thử (0 trước để ưu tiên không xoay khi hoà NCC).
  const angles: number[] = [0];
  for (let a = angleStep; a <= maxAngle + 1e-9; a += angleStep) {
    angles.push(a, -a);
  }

  let best = { dx: 0, dy: 0, angle: 0, ncc: -Infinity };

  for (const angle of angles) {
    // Xoay test (ở độ phân giải gốc) rồi downscale → tránh nội suy kép quá xấu.
    let testSmall: Uint8Array;
    if (angle === 0) {
      testSmall = await resizeGray(test, sw, sh);
    } else {
      const rotated = await sharp(Buffer.from(test.data), {
        raw: { width: test.width, height: test.height, channels: 1 },
      })
        .rotate(angle, { background: { r: 0, g: 0, b: 0 } })
        .resize(sw, sh, { fit: "fill" })
        .raw()
        .toBuffer();
      testSmall = new Uint8Array(rotated);
    }
    const { dx, dy, ncc } = bestShift(refSmall, testSmall, sw, sh, maxShift);
    if (ncc > best.ncc) best = { dx, dy, angle, ncc };
  }

  // Quy đổi dịch về độ phân giải gốc reference.
  const scaleX = W / sw;
  const scaleY = H / sh;
  const dxFull = Math.round(best.dx * scaleX);
  const dyFull = Math.round(best.dy * scaleY);
  const confidence = Math.max(0, Math.min(1, best.ncc));
  const aligned = confidence >= minConfidence;

  // Dựng buffer test đã căn về hệ reference (rotate trước, rồi translate dx,dy, resize W×H).
  const alignedBuffer = await warpTest(test, best.angle, dxFull, dyFull, W, H);

  return {
    dx: dxFull,
    dy: dyFull,
    angle: best.angle,
    confidence: Number(confidence.toFixed(4)),
    alignedBuffer,
    alignedWidth: W,
    alignedHeight: H,
    aligned,
  };
}

/**
 * Áp transform (rotate angle + dịch dx,dy) lên test → grayscale raw W×H về hệ reference.
 * Dịch dương dx nghĩa test bị lệch sang phải so ref → ta dịch test LÊN/SANG-TRÁI -dx để bù.
 * Dùng extract/extend trên canvas có padding để tránh mất pixel khi dịch.
 */
async function warpTest(
  test: GrayImage,
  angle: number,
  dx: number,
  dy: number,
  W: number,
  H: number,
): Promise<Buffer> {
  // Bước 1: đưa test về W×H (rotate nếu cần). Tránh resize thừa khi đã đúng kích thước
  // & không xoay (sharp resample cùng-size vẫn làm nhoè → hỏng căn translation thuần).
  let base: Buffer;
  if (angle === 0 && test.width === W && test.height === H) {
    base = Buffer.from(test.data);
  } else {
    let pipe = sharp(Buffer.from(test.data), {
      raw: { width: test.width, height: test.height, channels: 1 },
    });
    if (angle !== 0) {
      const rotated = await pipe.rotate(angle, { background: { r: 0, g: 0, b: 0 } }).raw().toBuffer({ resolveWithObject: true });
      pipe = sharp(rotated.data, {
        raw: { width: rotated.info.width, height: rotated.info.height, channels: 1 },
      });
    }
    base = await pipe.resize(W, H, { fit: "fill" }).raw().toBuffer();
  }
  // Bước 2: dịch thuần JS để bù lệch. bestShift tìm (dx,dy) sao cho
  // ref(x,y) ≈ test(x-dx, y-dy) → aligned(x,y) = test(x-dx, y-dy) = base[y-dy][x-dx].
  if (dx === 0 && dy === 0) return base;
  const out = Buffer.alloc(W * H, 0);
  for (let y = 0; y < H; y++) {
    const srcY = y - dy;
    if (srcY < 0 || srcY >= H) continue;
    for (let x = 0; x < W; x++) {
      const srcX = x - dx;
      if (srcX < 0 || srcX >= W) continue;
      out[y * W + x] = base[srcY * W + srcX];
    }
  }
  return out;
}

/**
 * Tính tỉ lệ pixel khác biệt giữa 2 grayscale raw cùng W×H (ngưỡng threshold).
 * Tiện cho test verify "sau align diffRatio giảm".
 */
export function diffRatioGray(
  a: Uint8Array | Buffer,
  b: Uint8Array | Buffer,
  threshold = 25,
): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let diff = 0;
  for (let i = 0; i < n; i++) {
    if (Math.abs(a[i] - b[i]) > threshold) diff++;
  }
  return diff / n;
}
