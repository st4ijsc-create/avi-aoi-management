import type { VramEstimateSource } from "./types";

/** Số THẬT gần nhất đã quan sát cho mỗi owner. Đây là thứ làm harness tự sinh (spec §7). */
const learned = new Map<string, number>();

export function recordActual(owner: string, bytes: number): void {
  if (bytes > 0) learned.set(owner, bytes);
}

/**
 * Ba nấc, theo thứ tự tin cậy giảm dần:
 *   1. learned      — đã đo thật lượt trước ⇒ dùng luôn
 *   2. file-size    — kích thước file trên đĩa, xấp xỉ trọng số
 *   3. config-default — hằng số. ⚠ Cảnh báo, vì đây chính là thứ đã trôi 4 lần.
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
  return { bytes: 0, source: "config-default" };
}

export function __resetEstimatorForTests(): void { learned.clear(); }
