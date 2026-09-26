import type { VramEstimateSource } from "./types";

/** Số THẬT gần nhất đã quan sát cho mỗi owner. Đây là thứ làm harness tự sinh (spec §7). */
const learned = new Map<string, number>();

/**
 * Ghi số THẬT quan sát được. `bytes === 0` VẪN được ghi — 0 là số liệu THẬT (vd. owner đo
 * được không chiếm VRAM riêng), không phải "chưa đo". Nhất quán với `vramBroker.ts:16`
 * `leaseBytes()`, nơi CỐ Ý dùng `??` (không `||`) vì cùng lý do: `actualBytes = 0` hợp lệ.
 * Chỉ chặn giá trị âm/không hữu hạn — đó mới thật sự là dữ liệu hỏng, không phải "0".
 */
export function recordActual(owner: string, bytes: number): void {
  if (Number.isFinite(bytes) && bytes >= 0) learned.set(owner, bytes);
}

/**
 * Bốn nấc, theo thứ tự tin cậy giảm dần:
 *   1. learned         — đã đo thật lượt trước ⇒ dùng luôn
 *   2. file-size        — kích thước file trên đĩa, xấp xỉ trọng số
 *   3. config-default   — hằng số. ⚠ Cảnh báo, vì đây chính là thứ đã trôi 4 lần.
 *   4. unknown          — KHÔNG có căn cứ nào (không learned, không file, không hằng số).
 *      ⚠ Phải tách khỏi "config-default": nhánh này KHÔNG hề dùng hằng số nào, tự nhận
 *      "config-default" sẽ làm Task 7 (đọc estimateSource để trả lời "chỗ nào còn dựa
 *      hằng số") chỉ SAI địa chỉ. "Xin chỗ mà không biết bao nhiêu" đáng lo hơn "dùng
 *      hằng số cũ" — vẫn console.warn, cùng mức độ với nấc config-default.
 */
export async function estimateBytesFor(
  owner: string,
  opts: { fileBytes?: number; configDefaultBytes?: number },
): Promise<{ bytes: number; source: VramEstimateSource }> {
  const known = learned.get(owner);
  if (known !== undefined) return { bytes: known, source: "learned" };
  if (opts.fileBytes !== undefined) return { bytes: opts.fileBytes, source: "file-size" };
  if (opts.configDefaultBytes !== undefined) {
    console.warn(`[vram] "${owner}" đang dùng HẰNG SỐ cấu hình — chưa có số đo thật.`);
    return { bytes: opts.configDefaultBytes, source: "config-default" };
  }
  console.warn(`[vram] "${owner}" KHÔNG CÓ CĂN CỨ NÀO để ước lượng — không learned, không file, không hằng số. Ước lượng = 0.`);
  return { bytes: 0, source: "unknown" };
}

export function __resetEstimatorForTests(): void { learned.clear(); }
