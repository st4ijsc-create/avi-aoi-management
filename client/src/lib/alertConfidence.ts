/**
 * Wave 3 §4.5 — độ tin cậy là TRỤC RIÊNG, không phải mức độ.
 * `HIGH · bằng chứng vừa đủ (52%)` phải khác `HIGH · bằng chứng vững (88%)`;
 * hiện tại hai cái nhìn giống hệt nhau trên màn hình.
 *
 * Cột `confidenceScore` là decimal của pg ⇒ tRPC trả về CHUỖI, không phải số.
 * Không rõ ⇒ "unknown", tuyệt đối không mặc định thành "cao".
 */
export type ConfidenceBand = "low" | "medium" | "high" | "unknown";

export function confidenceBand(score: number | string | null | undefined): ConfidenceBand {
  if (score == null) return "unknown";
  const n = typeof score === "number" ? score : Number(score);
  if (!Number.isFinite(n)) return "unknown";
  if (n >= 80) return "high";
  if (n >= 60) return "medium";
  return "low";
}
