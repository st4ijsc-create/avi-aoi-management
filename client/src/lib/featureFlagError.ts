/**
 * F11 (nhóm C 2026-08-14) — nhận diện lỗi "tính năng đang tắt cờ" theo MÃ, không theo chuỗi.
 *
 * ── BỆNH ─────────────────────────────────────────────────────────────────────────
 * Tám màn hình tự viết lại cùng một vị từ:
 *     `e.data?.code === "CONFLICT" && /disabled/i.test(e.message)`
 * Nó khớp chữ **"disabled"** trong message TIẾNG ANH của máy chủ. Cách làm này vốn có
 * mục đích tốt — thay lỗi đỏ doạ người bằng một câu bình tĩnh, actionable ("Preview mode…
 * set X_ENABLED=true") — nhưng phép nhận diện thì mong manh: đổi câu chữ ở máy chủ, hoặc
 * dịch nó, là cả tám chỗ cùng gãy **im lặng** và người dùng lại nhận lỗi đỏ.
 *
 * `FleetOrchestration` còn có tầng thứ hai (`/resource/i.test(e.message)`) để phân biệt
 * hai cờ — trong khi máy chủ đã gửi sẵn khoá chính xác trong `params.feature`.
 *
 * ── CÁCH ĐÚNG ────────────────────────────────────────────────────────────────────
 * Đợt di trú mã lỗi đã gắn `appCode = "FEATURE_DISABLED"` + `params.feature` (17 khoá
 * camelCase: `fleetOrchestration`, `fleetResourceLayer`, `robotAnomalyDetection`, …).
 * Dùng chúng. Giữ phép so chuỗi cũ làm ĐƯỜNG LUI cho tuyến nào chưa di trú.
 */

/** Hình dạng tối thiểu của lỗi tRPC phía client sau khi qua `errorFormatter`. */
interface LoiCoTheCoMa {
  data?: { code?: string; appCode?: string; appParams?: Record<string, unknown> } | null;
  message?: string;
}

/** Lỗi này có phải "tính năng đang tắt cờ" không. */
export function isFeatureDisabledError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as LoiCoTheCoMa;

  if (err.data?.appCode === "FEATURE_DISABLED") return true;

  // Đường lui: tuyến chưa di trú vẫn ném CONFLICT + message tiếng Anh có chữ "disabled".
  return err.data?.code === "CONFLICT" && typeof err.message === "string" && /disabled/i.test(err.message);
}

/**
 * Khoá tính năng máy chủ gửi kèm (`params.feature`), ví dụ `"fleetResourceLayer"`.
 * Trả `undefined` khi tuyến chưa di trú — chỗ gọi phải chịu được điều đó, đừng giả định
 * luôn có. Dùng để phân nhánh khi một màn hình gác NHIỀU cờ.
 */
export function featureKeyOf(e: unknown): string | undefined {
  if (!e || typeof e !== "object") return undefined;
  const feature = (e as LoiCoTheCoMa).data?.appParams?.feature;
  return typeof feature === "string" ? feature : undefined;
}
