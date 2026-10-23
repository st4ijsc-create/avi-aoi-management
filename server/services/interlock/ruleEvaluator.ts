/**
 * Sprint F5a — Interlock rule evaluation (PURE, DB-free).
 *
 * These helpers contain ZERO I/O so they can be unit-tested offline. The engine
 * (interlockEngine.ts) does the querying, then passes already-fetched data here.
 *
 * SAFETY: evaluating a condition only returns a boolean. It never raises Andon,
 * never writes a command — those are the engine's (alert-only) responsibility.
 */

export type ComparisonOperator = "lt" | "lte" | "gt" | "gte" | "eq";

/** True when `observed <op> threshold`. NaN/undefined operands → false (safe). */
export function compare(observed: number | null | undefined, operator: ComparisonOperator, threshold: number | null | undefined): boolean {
  if (observed == null || threshold == null || Number.isNaN(observed) || Number.isNaN(threshold)) return false;
  switch (operator) {
    case "lt": return observed < threshold;
    case "lte": return observed <= threshold;
    case "gt": return observed > threshold;
    case "gte": return observed >= threshold;
    case "eq": return observed === threshold;
    default: return false;
  }
}

/**
 * Evaluate a rule condition.
 *
 * - When `consecutiveCount` (>1) is supplied together with a `series` of recent
 *   observations (newest-last), the condition only fires if the LAST
 *   `consecutiveCount` samples ALL satisfy the comparison (e.g. "3 points in a
 *   row above threshold").
 * - Otherwise it is a single-value comparison of `observedValue`.
 */
export function evaluateCondition(
  observedValue: number | null | undefined,
  operator: ComparisonOperator,
  threshold: number | null | undefined,
  consecutiveCount?: number | null,
  series?: Array<number | null | undefined>,
): boolean {
  if (consecutiveCount != null && consecutiveCount > 1 && Array.isArray(series)) {
    if (series.length < consecutiveCount) return false;
    const tail = series.slice(-consecutiveCount);
    return tail.every((v) => compare(v, operator, threshold));
  }
  return compare(observedValue, operator, threshold);
}

/** A single fetched observation passed to deriveObserved(). */
export interface ObservationContext {
  /** Per-sample numeric series within the window (newest-last), when available. */
  series?: Array<number | null | undefined>;
  /** A precomputed scalar (e.g. NG-rate %, latest cpk, latest telemetry value). */
  scalar?: number | null;
  /** Count of qualifying rows in the window (used by spc_violation / process_result). */
  count?: number | null;
  /** SCADA R0 Task 9: nguồn tự phát hiện KHÔNG đánh giá được (vd hàng mới nhất chất lượng xấu) — cổng/engine coi là thiếu dữ liệu. */
  thieuDuLieu?: NonNullable<KetQuaDanhGia["lyDo"]>;
}

export type InterlockSourceType = "spc_violation" | "ng_rate" | "process_result" | "telemetry_tag" | "cpk";

/**
 * Reduce a source's fetched data to the single observedValue compared against
 * the threshold. PURE — the engine performs the queries that fill `ctx`.
 *
 *   spc_violation / process_result → count of qualifying rows in window
 *   ng_rate                        → scalar NG-rate (percent)
 *   cpk / telemetry_tag            → scalar latest value
 */
export function deriveObserved(sourceType: InterlockSourceType, ctx: ObservationContext): number | null {
  switch (sourceType) {
    case "spc_violation":
    case "process_result":
      return ctx.count ?? null;
    case "ng_rate":
    case "cpk":
    case "telemetry_tag":
      return ctx.scalar ?? null;
    default:
      return null;
  }
}

/**
 * SCADA R0 Task 9 (D2) — kết quả đánh giá MỘT luật, tách "đúng/sai" khỏi "không đánh giá được".
 *
 * `compare()` trả false khi quan sát null — đúng cho phép so sánh thuần, NHƯNG khiến "thiếu dữ liệu" trông giống "an toàn" (fail-open).
 * Cổng/engine dùng kiểu này để phân biệt: `thieuDuLieu:true` ⇒ không có kết luận (dung luôn false) và người gọi PHẢI quyết định
 * (cổng inline: chặn theo `khiThieuDuLieu`; engine: không phát hành động, chỉ log).
 *   khong_co_mau     — không có mẫu / giá trị không phải số / lịch sử ngắn hơn consecutiveCount
 *   chat_luong_xau   — mẫu q = bad | uncertain
 *   cu               — mẫu quá hạn (stale)
 *   mo_ho            — nhiều adapter / nhiều deviceId cùng tagKey trên máy (không chọn bừa)
 *   cau_hinh         — luật HỎNG CẤU TRÚC (telemetry_tag thiếu machineId hoặc sourceKey): không bao giờ đánh giá được, cần sửa luật
 */
export interface KetQuaDanhGia {
  dung: boolean;
  thieuDuLieu: boolean;
  lyDo?: "khong_co_mau" | "chat_luong_xau" | "cu" | "mo_ho" | "cau_hinh";
}
