/**
 * Lịch sử: Wave 3 §4.5 sinh ra hàm này CHỈ ĐỂ QUAN SÁT — phân loại vì sao một
 * ứng viên KHÔNG được phát, để lần sau hiệu chỉnh ngưỡng bằng bằng chứng thay
 * vì cảm tính (trước đó ứng viên bị loại biến mất không dấu vết, không ai biết
 * ngưỡng đang chặn 3 hay 3000 cảnh báo).
 *
 * HIỆN TRẠNG (Sprint 5 §5, backlog B1): không còn "chỉ quan sát" nữa. Trước
 * đây `predictiveMaintenanceService.ts` có một biểu thức phát cảnh báo VIẾT
 * TAY riêng, tách khỏi hàm này — và hai đường đã lệch thật (thiếu
 * `Number.isFinite` khiến `predictedTimeframeHours = -Infinity` được phát dù
 * bị đếm là đã chặn). Hai đường nay đã HỢP NHẤT: `predictiveMaintenanceService.ts`
 * gọi thẳng hàm này và chỉ phát khi kết quả là `"emit"`. Vì vậy:
 *
 * ⚠ Đây giờ là NGUỒN DUY NHẤT quyết định có phát cảnh báo bảo trì dự đoán hay
 *   không. Đổi ngưỡng hoặc công thức ở file này = đổi hành vi phát cảnh báo
 *   trên production, KHÔNG còn vô hại như trước.
 *
 * Lưới canh: `classifySuppression.equivalence.test.ts` khoá ngữ nghĩa mong
 * muốn của "được phát" bằng oracle độc lập (`shouldEmit`) và canh drift để
 * biểu thức phát viết-tay-riêng kể trên không mọc lại ở `predictiveMaintenanceService.ts`.
 */
export type SuppressionReason = "emit" | "low-risk" | "low-confidence" | "out-of-timeframe";

export interface SuppressionInput {
  failureRisk: number;
  confidenceScore: number;
  predictedTimeframeHours: number | null | undefined;
}

export interface SuppressionThresholds {
  risk: number;
  confidence: number;
  timeframeHours: number;
}

export function classifySuppression(input: SuppressionInput, th: SuppressionThresholds): SuppressionReason {
  // Thứ tự cố định để số đếm không nhập nhằng khi nhiều điều kiện cùng trượt.
  if (!(input.failureRisk >= th.risk)) return "low-risk";
  if (!(input.confidenceScore >= th.confidence)) return "low-confidence";
  const hours = input.predictedTimeframeHours;
  if (hours == null || !Number.isFinite(hours) || hours > th.timeframeHours) return "out-of-timeframe";
  return "emit";
}
