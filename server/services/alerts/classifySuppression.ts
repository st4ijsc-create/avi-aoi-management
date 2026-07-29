/**
 * Wave 3 §4.5 — CHỈ QUAN SÁT. Không đổi ngưỡng, không đổi công thức.
 * Phân loại vì sao một ứng viên KHÔNG được phát, để lần sau hiệu chỉnh ngưỡng
 * bằng bằng chứng thay vì cảm tính. Trước đây ứng viên bị loại biến mất không
 * dấu vết, nên không ai biết ngưỡng đang chặn 3 hay 3000 cảnh báo.
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
