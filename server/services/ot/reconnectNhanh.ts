/**
 * SCADA R0 (cổng "sau khi nối lại ⇒ good trong ≤ 2 chu kỳ poll") — nối lại NHANH khi đợt mất còn mới.
 *
 * MƯỜI lần nối lại đầu của một đợt mất thử mỗi `max(pollIntervalMs, 500)` ms (không để backoff lũy thừa làm chậm quá một chu kỳ
 * poll khi thiết bị vừa rớt); từ lần thứ 11 trở đi quay về backoff lũy thừa như cũ (bắt đầu lại từ bước đầu, trần không đổi).
 * Bộ đếm là số lần thất bại liên tiếp của từng adapter và về 0 khi nối thành công (đã có sẵn ở supervisor/otManager).
 */
export const NOI_LAI_NHANH_SO_LAN = 10;
export const NOI_LAI_NHANH_TOI_THIEU_MS = 500;

/** Khoảng chờ giữa hai lần nối lại trong pha nhanh. */
export function khoangNoiLaiNhanhMs(pollIntervalMs: number): number {
  const poll = Number.isFinite(pollIntervalMs) && pollIntervalMs > 0 ? pollIntervalMs : 0;
  return Math.max(poll, NOI_LAI_NHANH_TOI_THIEU_MS);
}

/**
 * Chọn khoảng chờ sau lần thất bại thứ `failures` (≥ 1). `expDelay(n)` là backoff lũy thừa hiện có theo số lần thất bại n.
 * Pha nhanh (failures ≤ 10): min(backoff cũ, khoảng nhanh) — không bao giờ CHẬM hơn cấu hình cũ. Sau đó: expDelay(failures − 10).
 */
export function khoangNoiLaiMs(failures: number, pollIntervalMs: number, expDelay: (n: number) => number): number {
  if (failures <= NOI_LAI_NHANH_SO_LAN) return Math.min(expDelay(failures), khoangNoiLaiNhanhMs(pollIntervalMs));
  return expDelay(failures - NOI_LAI_NHANH_SO_LAN);
}
