/**
 * SCADA R0 (cổng "sau khi nối lại ⇒ good trong ≤ 2 chu kỳ poll") — nối lại NHANH khi đợt mất còn mới.
 *
 * MƯỜI lần nối lại đầu của một đợt mất thử mỗi `max(pollIntervalMs, 500)` ms (không để backoff lũy thừa làm chậm quá một chu kỳ
 * poll khi thiết bị vừa rớt); từ lần thứ 11 trở đi quay về backoff lũy thừa như cũ (bắt đầu lại từ bước đầu, trần không đổi).
 * Bộ đếm là số lần thất bại liên tiếp của từng adapter và về 0 khi nối thành công (đã có sẵn ở supervisor/otManager).
 */
import type { SuKienDoc } from "./otDriver";

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

/**
 * SCADA R0 T12 (D1) — liên kết TREO (TCP nửa mở: cáp rút sau switch, PLC đóng băng) không bao giờ làm `isConnected()` lật false.
 * K tick poll HỎNG LIÊN TIẾP ⇒ người giữ phiên (otManager legacy / ConnectionSupervisor) báo `lost` và HẠ phiên driver để đường nối
 * lại nhanh chạy. Giá phải trả nếu sai: thiết bị sống-nhưng-chậm chập chờn lost/nối lại mỗi ~K chu kỳ (đã chấp nhận).
 */
export const SO_TICK_HONG_DE_MAT = 2;

const moiTagMatLienLac = (e: SuKienDoc): boolean =>
  e.tags.length > 0 && e.tags.every((t) => t.quality === "bad" && t.reason === "comm_lost");

/**
 * Tick hỏng = quá hạn (giao dịch hoặc hạn vòng poll), lỗi comm_lost cho CẢ tick, hoặc tick "ok" mà MỌI tag bad/comm_lost.
 * R1b-1 T4 — `lyDo:"ingest_treo"` (lượt phát mẫu/ghi DB quá hạn) KHÔNG BAO GIỜ hỏng vì cờ timeout của nó: DB chậm không phải thiết bị mất.
 * Tick đó mang lần đọc chính (`ok:true`) ⇒ phán theo tag của lần đọc như mọi tick ok; không mang lần đọc ⇒ không hỏng.
 */
export function laTickHong(e: SuKienDoc): boolean {
  if (e.lyDo === "ingest_treo") return e.ok === true && moiTagMatLienLac(e);
  if (!e.ok) return e.timeout || e.reason === "comm_lost";
  return moiTagMatLienLac(e);
}

/**
 * SCADA R1b-1 T3 — "đọc tốt" = giao dịch đọc THÀNH CÔNG (`ok:true`: thiết bị đã trả lời) và không phải tick mà D1 coi là hỏng.
 * ok:true mà mọi tag bad vì lý do khác mất liên lạc (config_error / device_error / out_of_range…) VẪN là đọc tốt: liên lạc đã thông.
 * ok:true mà MỌI tag bad/comm_lost (laTickHong) KHÔNG phải: D1 đếm nó là tick hỏng, coi nó là đọc tốt sẽ báo connected rồi lost ngay.
 * R1b-1 T4 (chốt) — lần đọc thành công mà lượt phát mẫu treo (`ok:true, lyDo:"ingest_treo"`) VẪN là đọc tốt: thiết bị đã trả lời,
 * "connected" nói về liên kết thiết bị chứ không về DB (đường push của T3 cũng đánh dấu ở mẫu good đầu, TRƯỚC khi sink ghi DB). Báo treo
 * không kèm lần đọc (`ok:false`) thì không.
 */
export function laDocTot(e: SuKienDoc): boolean {
  return e.ok === true && !laTickHong(e);
}

/**
 * Bộ đếm tick hỏng liên tiếp cho MỘT phiên (mỗi lần subscribe một bộ mới). Từ tick hỏng thứ `k` trở đi gọi `khiDat(e)` mỗi tick hỏng
 * (người gọi tự chặn khi phiên không còn là phiên đang hoạt động); tick không hỏng ⇒ về 0.
 * R1b-1 T4 — báo ingest treo KHÔNG kèm lần đọc (`ok:false, lyDo:"ingest_treo"`) là TRUNG TÍNH: không đếm, không về 0 (nó không nói gì
 * về thiết bị; lần đọc của nó đã được báo ở tick riêng). Ingest treo kèm lần đọc chính được phán theo lần đọc (laTickHong).
 */
export function taoDemTickHong(k: number, khiDat: (e: SuKienDoc) => void): (e: SuKienDoc) => void {
  let n = 0;
  return (e) => {
    if (e.lyDo === "ingest_treo" && e.ok !== true) return;
    if (!laTickHong(e)) {
      n = 0;
      return;
    }
    n += 1;
    if (n >= k) khiDat(e);
  };
}
