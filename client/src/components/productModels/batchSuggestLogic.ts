/**
 * Wave 2 đường A — Task 3: chia kết quả đề xuất hàng loạt thành "gửi được" và
 * "thiếu dữ liệu", và ánh xạ MỘT kết quả recommendForPoint (thô) sang dạng
 * BatchSuggestItem mà partitionBatch hiểu.
 *
 * Nguyên tắc TRUNG THỰC (bắt buộc theo kế hoạch Wave 2 đường A):
 *   - Điểm không đủ mẫu (sampleSize < ngưỡng tối thiểu, mặc định 300 —
 *     server/services/aiThresholdAdvisor.ts:37-40, `minSamples()`) PHẢI rơi
 *     vào nhóm "insufficient" kèm lý do THẬT (lấy nguyên văn `note` do server
 *     tính), TUYỆT ĐỐI không bịa proposedLsl/proposedUsl/proposedNominal cho nó.
 *   - `needsReview` (server đánh dấu dữ liệu đo lệch xa giới hạn hiện tại —
 *     khả năng sai đơn vị/cấu hình điểm đo) CŨNG bị coi là "insufficient" ở
 *     đây dù đủ mẫu: số liệu không đáng tin để tự động gửi hàng loạt mà
 *     không ai xem qua trước — cùng nguyên tắc chặn mà
 *     AIThresholdSuggestButton áp dụng cho đường đơn-điểm
 *     (`disabled={busy || needsReview}`, client/src/components/AIThresholdSuggestButton.tsx).
 *   - `disabled` (trợ lý chưa bật) hay lỗi mạng/tính toán cũng KHÔNG được
 *     lặng lẽ biến thành "không có gì để gửi" — chúng vẫn hiện tên điểm + lý
 *     do trong nhóm "insufficient" (xem BatchSuggestDialog).
 */
export interface BatchSuggestItem {
  pointDefId: number;
  ok: boolean;
  sampleCount: number;
  reason?: string;
  proposedLsl?: number;
  proposedUsl?: number;
  proposedNominal?: number;
}

export interface BatchPartition {
  ready: BatchSuggestItem[];
  insufficient: BatchSuggestItem[];
}

export function partitionBatch(items: BatchSuggestItem[]): BatchPartition {
  const ready: BatchSuggestItem[] = [];
  const insufficient: BatchSuggestItem[] = [];
  for (const it of items ?? []) {
    if (it.ok) ready.push(it);
    else insufficient.push(it);
  }
  return { ready, insufficient };
}

/**
 * Hình dạng tối thiểu cần thiết từ trpc.aiThresholdAdvisor.recommendForPoint
 * (PointRecommendation thật ở server/services/aiThresholdAdvisor.ts). Khai
 * báo lại (thay vì `import type` từ server) để file này thuần logic, không
 * kéo theo phụ thuộc runtime nào — PointRecommendation thật vẫn khớp cấu
 * trúc (structural typing của TS), nên truyền thẳng response tRPC vào đây
 * là hợp lệ mà không cần ép kiểu.
 */
export interface AdvisorRecommendationLike {
  ok: boolean;
  disabled?: boolean;
  degraded?: boolean;
  needsReview?: boolean;
  sampleSize?: number;
  note?: string;
  recommended?: { lsl: number; usl: number; target: number };
}

/**
 * Ánh xạ MỘT kết quả recommendForPoint (thô, có thể null nếu chưa gọi xong)
 * sang BatchSuggestItem. `errorMessage` dành cho lỗi tầng gọi mạng
 * (utils.aiThresholdAdvisor.recommendForPoint.fetch bị reject) — ưu tiên cao
 * nhất vì khi đó `rec` không đáng tin (undefined/không tồn tại).
 */
export function toBatchItem(
  pointDefId: number,
  rec: AdvisorRecommendationLike | null | undefined,
  errorMessage?: string,
): BatchSuggestItem {
  if (errorMessage) {
    return { pointDefId, ok: false, sampleCount: 0, reason: errorMessage };
  }
  if (!rec) {
    return { pointDefId, ok: false, sampleCount: 0 };
  }
  // ok=false (điểm không tìm thấy / lỗi tính toán), disabled (trợ lý chưa
  // bật), degraded (thiếu mẫu), hoặc needsReview (dữ liệu lệch xa giới hạn)
  // đều là "chưa đủ dữ liệu ĐỂ TỰ ĐỘNG GỬI HÀNG LOẠT" — không bịa số đề xuất.
  if (!rec.ok || rec.disabled || rec.degraded || rec.needsReview || !rec.recommended) {
    return { pointDefId, ok: false, sampleCount: rec.sampleSize ?? 0, reason: rec.note };
  }
  return {
    pointDefId,
    ok: true,
    sampleCount: rec.sampleSize ?? 0,
    proposedLsl: rec.recommended.lsl,
    proposedUsl: rec.recommended.usl,
    proposedNominal: rec.recommended.target,
  };
}
