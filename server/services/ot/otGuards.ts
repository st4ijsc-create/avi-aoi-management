/**
 * doc 81 Đợt 1B Task 7 — LOG GỘP cho đường ingest / WAL.
 *
 * Một thiết bị gửi `ts` hỏng liên tục, hay một đĩa WAL hỏng, sẽ lặp CÙNG một cảnh báo ở mỗi
 * lô — hàng trăm dòng mỗi giây (BE3 đã đo 730.200 dòng / 154 MB trong ~1 phút ở một đường
 * tương tự). Hàm này giữ tối đa MỘT dòng mỗi khoá trong một cửa sổ; các lần bị nén được ĐẾM
 * và in kèm ở dòng kế tiếp — nén chứng cứ lặp, không giấu tin.
 */
export const LOG_GOP_WINDOW_MS = 10_000;

const state = new Map<string, { last: number; suppressed: number }>();

/** console.warn tối đa một lần mỗi `windowMs` cho mỗi `key`; số lần bị nén in ở dòng sau. */
export function warnGop(key: string, message: string, windowMs = LOG_GOP_WINDOW_MS): void {
  const now = Date.now();
  const st = state.get(key);
  if (st && now - st.last < windowMs) {
    st.suppressed += 1;
    return;
  }
  const extra = st && st.suppressed > 0 ? ` (+${st.suppressed} lần tương tự đã gộp)` : "";
  state.set(key, { last: now, suppressed: 0 });
  console.warn(message + extra);
}

/** Xoá trạng thái gộp (test). */
export function _resetLogGop(): void {
  state.clear();
}

/**
 * Lỗi do DỮ LIỆU của dòng (SQLSTATE lớp 22 "data exception" / 23 "integrity constraint"), KHÁC lỗi
 * kết nối / DB vắng. drizzle bọc lỗi postgres.js trong DrizzleQueryError ⇒ SQLSTATE nằm ở `cause.code`.
 * Dùng để CÁCH LY đúng dòng hỏng thay vì coi cả lô là "DB sập" (đệm mãi / kẹt WAL mãi).
 */
export function isPgDataError(err: unknown): boolean {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = typeof e?.code === "string" ? e.code : typeof e?.cause?.code === "string" ? e.cause.code : "";
  return /^2[23][0-9A-Z]{3}$/.test(code);
}

/** 0001-01-01T00:00:00Z — dưới mốc này chuỗi ISO của JS có dạng năm mở rộng mà Postgres không đọc. */
export const MIN_PG_TS_MS = -62135596800000;

/**
 * T7 fix r1 — bộ đếm TÍCH LUỸ số mẫu bị cổng `ts` của telemetryBus loại (mọi đầu đọc, mọi đường).
 * Log của cổng bị GỘP ⇒ không có con số này thì một thiết bị lệch đồng hồ bị loại hàng triệu mẫu
 * chỉ để lại vài dòng log. Hiện ra qua storeForward.getStatus() (droppedInvalidTs, droppedFutureSkew).
 */
const tsDropStats = { droppedInvalidTs: 0, droppedFutureSkew: 0 };

export function recordTsDrops(invalidTs: number, futureSkew: number): void {
  tsDropStats.droppedInvalidTs += invalidTs;
  tsDropStats.droppedFutureSkew += futureSkew;
}

export function getTsDropStats(): { droppedInvalidTs: number; droppedFutureSkew: number } {
  return { ...tsDropStats };
}

/** Xoá bộ đếm (test). */
export function _resetTsDropStats(): void {
  tsDropStats.droppedInvalidTs = 0;
  tsDropStats.droppedFutureSkew = 0;
}
