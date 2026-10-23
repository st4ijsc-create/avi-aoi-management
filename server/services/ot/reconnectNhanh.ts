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

/** Tối thiểu (ms) liên kết phải giữ vững sau một lần nối LẠI thì mới coi là ổn định (bộ đếm thất bại về 0, đợt mất kết thúc). */
export const NOI_LAI_ON_DINH_TOI_THIEU_MS = 5_000;

/**
 * Thời gian ổn định `max(3 × poll, 5000)` ms. Một liên kết nối được rồi rớt ngay (thiết bị chạm giới hạn kết nối: chấp nhận rồi
 * đóng) KHÔNG được xoá bộ đếm thất bại — nếu không backoff không bao giờ tích luỹ và vòng nối lại chạy mãi mỗi 500 ms.
 */
export function thoiGianOnDinhMs(pollIntervalMs: number): number {
  const poll = Number.isFinite(pollIntervalMs) && pollIntervalMs > 0 ? pollIntervalMs : 0;
  return Math.max(3 * poll, NOI_LAI_ON_DINH_TOI_THIEU_MS);
}

/**
 * Hạn cứng (ms) cho MỘT lần đọc của vòng poll, do otManager truyền xuống driver (SCADA R0 C5):
 * `max(2 × poll, (timeoutMs ?? 5000) + 1000)`. KHÔNG buộc vào chu kỳ poll: hạn ngắn theo chu kỳ sẽ cắt oan lần đọc chậm-nhưng-khoẻ.
 * Phát hiện nhanh việc rút cáp đến từ timeout từng giao dịch + huỷ ở tầng liên kết, không từ hạn này.
 */
export function tinhDeadlineMs(pollIntervalMs: number, timeoutMs?: number): number {
  const poll = Number.isFinite(pollIntervalMs) && pollIntervalMs > 0 ? pollIntervalMs : 0;
  const t = typeof timeoutMs === "number" && Number.isFinite(timeoutMs) ? timeoutMs : 5000;
  return Math.max(2 * poll, t + 1000);
}
