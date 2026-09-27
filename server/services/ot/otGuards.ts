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
const tsDropStats = { droppedInvalidTs: 0, droppedFutureSkew: 0, droppedNoTimezone: 0 };

/** Đợt 1C Task 6 — `noTimezone`: mẫu mang `ts` chuỗi KHÔNG múi giờ (ruling R-1C-a, reason `ts_no_timezone`). */
export function recordTsDrops(invalidTs: number, futureSkew: number, noTimezone = 0): void {
  tsDropStats.droppedInvalidTs += invalidTs;
  tsDropStats.droppedFutureSkew += futureSkew;
  tsDropStats.droppedNoTimezone += noTimezone;
}

export function getTsDropStats(): { droppedInvalidTs: number; droppedFutureSkew: number; droppedNoTimezone: number } {
  return { ...tsDropStats };
}

/** Xoá bộ đếm (test). */
export function _resetTsDropStats(): void {
  tsDropStats.droppedInvalidTs = 0;
  tsDropStats.droppedFutureSkew = 0;
  tsDropStats.droppedNoTimezone = 0;
  skewTheoThietBi.clear();
}

/**
 * Độ lệch tương lai tối đa của `ts` (ms). Mặc định 24 h — luật chủ dự án giữ nguyên (Đợt 1C, quyết
 * định d). Đọc lúc gọi. Sống ở đây (module không phụ thuộc) để cổng cảm biến dùng CHUNG với telemetryBus.
 */
export function maxFutureSkewMs(): number {
  const n = parseInt(String(process.env.OT_INGEST_MAX_FUTURE_SKEW_MS ?? ""), 10);
  return Number.isFinite(n) && n >= 1 ? n : 24 * 60 * 60 * 1000;
}

// ── Đợt 1C Task 6 — SỐ ĐO LỆCH GIỜ THEO THIẾT BỊ ────────────────────────────────────────────────
//
// Bộ đếm tổng ở trên nói "bao nhiêu mẫu bị loại", không nói THIẾT BỊ NÀO lệch. Mỗi mẫu mang `ts` do
// thiết bị khai (không phải giờ server đóng dấu) được ghi độ lệch `ts − giờ server lúc nhận` (ms, có
// dấu: dương = thiết bị chạy NHANH/đi trước). Kể cả mẫu bị loại vì > 24 h — đó chính là thiết bị cần
// tìm. Cửa sổ trượt LECH_CUA_SO mẫu gần nhất mỗi thiết bị ⇒ trung vị/lớn nhất/nhỏ nhất phản ánh HIỆN
// TRẠNG; số mẫu và số bị loại là TÍCH LUỸ. Tối đa LECH_TOI_DA_THIET_BI khoá (deviceId giả mạo không làm
// phình bộ nhớ) — đầy thì bỏ khoá lâu không thấy nhất. ⚠ Giờ server tự nó có thể lệch NTP (đo 2026-09-28:
// server chậm ~6,1 s, đồng hồ "Free-running") — số này là lệch SO VỚI SERVER, không phải so với NTP.
export const LECH_CUA_SO = 256;
export const LECH_TOI_DA_THIET_BI = 500;

interface LechTichLuy {
  deviceId: string | null;
  machineId: number | null;
  samples: number;
  window: number[];
  lastSkewMs: number | null;
  lastSeenAt: number;
  droppedFutureSkew: number;
  droppedInvalidTs: number;
  droppedNoTimezone: number;
}

const skewTheoThietBi = new Map<string, LechTichLuy>();

/** Thiết bị (deviceId hoặc machineId) mà một mẫu thuộc về. */
export interface ThietBiCuaMau {
  deviceId?: string | null;
  machineId?: number | null;
}

function khoaThietBi(tb: ThietBiCuaMau): string {
  if (tb.deviceId) return `d:${tb.deviceId}`;
  if (tb.machineId != null) return `m:${tb.machineId}`;
  return "?";
}

function layTichLuy(tb: ThietBiCuaMau, now: number): LechTichLuy {
  const k = khoaThietBi(tb);
  let acc = skewTheoThietBi.get(k);
  if (!acc) {
    if (skewTheoThietBi.size >= LECH_TOI_DA_THIET_BI) {
      let cuNhat: string | null = null;
      let luc = Infinity;
      for (const [kk, v] of skewTheoThietBi) if (v.lastSeenAt < luc) { luc = v.lastSeenAt; cuNhat = kk; }
      if (cuNhat !== null) skewTheoThietBi.delete(cuNhat);
    }
    acc = {
      deviceId: tb.deviceId ?? null,
      machineId: tb.machineId ?? null,
      samples: 0,
      window: [],
      lastSkewMs: null,
      lastSeenAt: now,
      droppedFutureSkew: 0,
      droppedInvalidTs: 0,
      droppedNoTimezone: 0,
    };
    skewTheoThietBi.set(k, acc);
  }
  if (tb.machineId != null) acc.machineId = tb.machineId;
  acc.lastSeenAt = now;
  return acc;
}

/**
 * Ghi MỘT quan sát của cổng `ts` cho thiết bị: `skewMs` (ts thiết bị − giờ server) khi thiết bị có
 * khai `ts` đọc được; `bi` = lý do nếu mẫu bị loại. Mẫu không khai `ts` (giờ server) KHÔNG gọi hàm này.
 */
export function recordTsObservation(
  tb: ThietBiCuaMau,
  skewMs: number | null,
  bi: "ts_too_far_future" | "invalid_ts" | "ts_no_timezone" | null,
  now: number = Date.now(),
): void {
  const acc = layTichLuy(tb, now);
  if (skewMs !== null && Number.isFinite(skewMs)) {
    acc.samples += 1;
    acc.window.push(skewMs);
    if (acc.window.length > LECH_CUA_SO) acc.window.shift();
    acc.lastSkewMs = skewMs;
  }
  if (bi === "ts_too_far_future") acc.droppedFutureSkew += 1;
  else if (bi === "invalid_ts") acc.droppedInvalidTs += 1;
  else if (bi === "ts_no_timezone") acc.droppedNoTimezone += 1;
}

/** Một hàng số đo lệch giờ của một thiết bị (đơn vị ms, có dấu: dương = thiết bị đi trước server). */
export interface TsSkewThietBi {
  deviceId: string | null;
  machineId: number | null;
  /** Số mẫu có `ts` do thiết bị khai đã quan sát (tích luỹ). */
  samples: number;
  /** Số mẫu trong cửa sổ trượt dùng cho trung vị/lớn nhất/nhỏ nhất (≤ LECH_CUA_SO). */
  windowSize: number;
  medianSkewMs: number | null;
  maxSkewMs: number | null;
  minSkewMs: number | null;
  lastSkewMs: number | null;
  lastSeenAt: string;
  droppedFutureSkew: number;
  droppedInvalidTs: number;
  droppedNoTimezone: number;
}

function trungVi(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Bảng lệch giờ theo thiết bị, thiết bị lệch NHIỀU nhất (|lớn nhất| hoặc |nhỏ nhất| trong cửa sổ, rồi số
 * mẫu bị loại) xếp đầu. `limit` mặc định 100. Không I/O.
 */
export function getTsSkewByDevice(limit = 100): TsSkewThietBi[] {
  const hang: Array<TsSkewThietBi & { _muc: number }> = [];
  for (const v of skewTheoThietBi.values()) {
    const max = v.window.length ? Math.max(...v.window) : null;
    const min = v.window.length ? Math.min(...v.window) : null;
    hang.push({
      deviceId: v.deviceId,
      machineId: v.machineId,
      samples: v.samples,
      windowSize: v.window.length,
      medianSkewMs: trungVi(v.window),
      maxSkewMs: max,
      minSkewMs: min,
      lastSkewMs: v.lastSkewMs,
      lastSeenAt: new Date(v.lastSeenAt).toISOString(),
      droppedFutureSkew: v.droppedFutureSkew,
      droppedInvalidTs: v.droppedInvalidTs,
      droppedNoTimezone: v.droppedNoTimezone,
      _muc: Math.max(Math.abs(max ?? 0), Math.abs(min ?? 0)),
    });
  }
  hang.sort(
    (a, b) =>
      b._muc - a._muc ||
      b.droppedFutureSkew + b.droppedNoTimezone + b.droppedInvalidTs - (a.droppedFutureSkew + a.droppedNoTimezone + a.droppedInvalidTs),
  );
  return hang.slice(0, Math.max(0, limit)).map(({ _muc: _bo, ...r }) => r);
}
