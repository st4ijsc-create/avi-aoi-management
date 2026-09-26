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
  /**
   * D4 — GIỮ trong hợp đồng đầu vào, KHÔNG còn ghi xuống CSDL (mig 0335).
   *
   * Người gọi (`routeAlert`) vẫn truyền độ tin cậy của lần này; bỏ tham số đi sẽ buộc
   * sửa cả chỗ gọi cho một thứ không liên quan tới lý do sửa. Nhưng cột
   * `predictive_alert_occurrences.confidenceScore` đã bị bỏ vì **không nơi nào đọc** —
   * xem lý do đầy đủ trong mig 0335.
   *
   * ⚠ Nếu sau này cần "xu hướng độ tin cậy qua các lần tái diễn": thêm lại cột VÀ chỗ
   *   đọc TRONG CÙNG một lượt. Thêm cột trước rồi tính đọc sau là đúng cách nó đã thành
   *   cột chết lần đầu.
   */
  confidence?: number | string | null;
}

export interface OccurrenceRow {
  alertId: number;
  occurredAt: Date;
  severity: string;
}

export function buildOccurrence(
  alertId: number | undefined | null,
  incoming: OccurrenceInput,
  now: Date,
): OccurrenceRow | null {
  if (alertId == null) return null;
  return {
    alertId,
    occurredAt: now,
    severity: incoming.severity,
  };
}
