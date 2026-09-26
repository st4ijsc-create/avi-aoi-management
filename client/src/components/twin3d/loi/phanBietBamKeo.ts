/**
 * phanBietBamKeo.ts — BẤM ≠ KÉO trên cảnh 3D (Đợt 47, N2).
 *
 * Cảnh vận hành dùng CÙNG nút chuột trái cho hai cử chỉ: KÉO để xoay camera
 * (OrbitControls) và BẤM để chọn máy. Trình duyệt vẫn phát `click` sau một cú
 * kéo (pointerdown và pointerup rơi cùng phần tử canvas), và R3F chuyển `click`
 * tới `onClick` của vật thể dưới con trỏ kể cả khi con trỏ đã đi 200 px — nó chỉ
 * kèm `e.delta` (khoảng cách pointerdown → click, px, đã làm tròn) để người gọi
 * tự lọc. Không lọc ⇒ xoay camera quanh một máy rồi nhả chuột trên máy đó =
 * điều hướng sang màn Máy ngoài ý muốn.
 *
 * Hai ngưỡng (brief Đợt 47: *"chỉ điều hướng khi pointer-up cách pointer-down
 * < 4 px và < 300 ms; kéo xoay vẫn xuyên qua"*), đặt tên để chủ sở hữu chỉnh
 * được ở MỘT chỗ. Thuần, có lưới; dùng chung cho đường R3F (`LoBatchMay`) và
 * đường DOM (`LopNhan` — bấm lên nhãn).
 */

/** Con trỏ dịch từ ngưỡng này trở lên giữa pointerdown và pointerup ⇒ KÉO, không phải bấm. */
export const NGUONG_BAM_PX = 4;
/** Giữ chuột từ ngưỡng này trở lên ⇒ không phải một cú bấm (kéo xoay chậm, giữ để quan sát). */
export const NGUONG_BAM_MS = 300;

export interface CuChiBam {
  /** Khoảng cách con trỏ giữa pointerdown và pointerup/click, px. */
  lechPx: number;
  /** Thời gian giữ, ms. */
  ms: number;
}

/**
 * Cử chỉ này có phải MỘT CÚ BẤM không.
 *
 * Số không hữu hạn hoặc âm ⇒ `false`: dữ liệu đo hỏng thì THÀ không điều hướng
 * còn hơn điều hướng nhầm (đổi màn là hành động người dùng phải quay lại).
 */
export function laBam(c: CuChiBam, nguongPx = NGUONG_BAM_PX, nguongMs = NGUONG_BAM_MS): boolean {
  if (!Number.isFinite(c.lechPx) || !Number.isFinite(c.ms)) return false;
  if (c.lechPx < 0 || c.ms < 0) return false;
  return c.lechPx < nguongPx && c.ms < nguongMs;
}

/** Khoảng cách Euclid giữa hai điểm màn hình, px. */
export function lechPx(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
