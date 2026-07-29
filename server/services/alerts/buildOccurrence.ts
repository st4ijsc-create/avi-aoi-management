/**
 * Wave 4 §3 — dựng một dòng nhật ký lần-tái-diễn.
 *
 * Tách khỏi routeAlert để test được KHÔNG CẦN DB. Bài học Wave 3: mọi lỗi lọt
 * lưới đều nằm trong mã trộn lẫn I/O.
 *
 * ⚠ `severity` ở đây là mức của CHÍNH LẦN NÀY, KHÔNG phải mức đã gộp của dòng
 * cha. Ghi nhầm sẽ làm phân bố ưu tiên ISA-18.2 sai vĩnh viễn mà con số vẫn
 * "trông hợp lý" nên không ai phát hiện.
 */
export interface OccurrenceInput {
  severity: string;
  confidence: number | string | null | undefined;
}

export interface OccurrenceRow {
  alertId: number;
  occurredAt: Date;
  severity: string;
  confidenceScore: string | null;
}

export function buildOccurrence(
  alertId: number | undefined | null,
  incoming: OccurrenceInput,
  now: Date,
): OccurrenceRow | null {
  if (alertId == null) return null;
  const raw = incoming.confidence;
  const n = raw == null ? NaN : typeof raw === "number" ? raw : Number(raw);
  return {
    alertId,
    occurredAt: now,
    severity: incoming.severity,
    confidenceScore: Number.isFinite(n) ? n.toFixed(2) : null,
  };
}
