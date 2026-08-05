/**
 * ★★★ Pha 4 Task 4 (review vòng 1, I-1) — **NÚT CHỈ ĐƯỢC HIỆN KHI LỆNH THẬT SỰ VỚI TỚI.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO FILE NÀY TỒN TẠI: MỘT DẤU `||` ĐÃ VÔ HIỆU HOÁ TÍN HIỆU VỪA DỰNG
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bản đầu của `VramBrokerPanel` viết:
 *
 *     canRetry = retryReach.kind === "reachable-here" || status.kind === "deferring" || "exceeded"
 *
 * ⇒ nút *"Thử lại ngay"* hiện cho **5/6 hộ** mà lệnh `vram.retryDeferred` **LUÔN** từ chối
 * (`no-retry-mechanism-for-this-host`). Đó **đúng** lỗi mà bàn giao (D) của review Task 2 được dựng
 * ra để đóng — *"mặt đọc hứa nhiều hơn mặt lệnh"* — chỉ khác là nó bò lên tầng UI, nơi
 * `retryReach` (thứ vừa được dựng để trả lời chính xác câu ấy) bị một dấu `||` ghi đè.
 *
 * ⇒ Vị từ nay **CHỈ** đọc `retryReach.kind`, và nó là một **bảng VÉT CẠN theo KIỂU**: thêm một
 * phạm trù `retryReach` mà quên khai ở đây là **lỗi `tsc`**, không phải một nút hiện sai âm thầm.
 *
 * ⚠ File này **KHÔNG import React, không import trpc** — cố ý: nó là một vị từ THUẦN, kiểm được
 * bằng ca test thật (repo có **0 file `*.test.tsx`**, nên một vị từ nằm trong `.tsx` là một vị từ
 * **không ai kiểm được**).
 */

/** Ba phạm trù của `VramAgentDeferHostView.retryReach` (mặt đọc — `server/services/vram/vramReadModel.ts`). */
export type VramDeferRetryReachKind = "reachable-here" | "unreachable" | "unknown";

/**
 * ★★★ BẢNG VÉT CẠN. Mỗi phạm trù **phải** khai, và chỉ **một** phạm trù cho phép bấm.
 *
 * ⚠ `"unknown"` (ô trạng thái cron đọc không được) ⇒ **KHÔNG** cho bấm: chiều CHẶT. Ta không biết
 * lệnh có với tới không, và một nút bấm được là một lời hứa.
 */
const CHO_BAM: Record<VramDeferRetryReachKind, boolean> = {
  "reachable-here": true,
  unreachable: false,
  unknown: false,
};

/**
 * *"Nút `vram.retryDeferred` có được hiện cho hộ này không"* — **CHỈ** theo `retryReach.kind` mà
 * máy chủ tính bằng cùng vị từ với lệnh (`coCoCheDanhThucNgoai` + `coChuTriCronODay`).
 *
 * ⚠⚠ TUYỆT ĐỐI KHÔNG `||` thêm một điều kiện *"đang hoãn"*: một hộ ĐANG HOÃN THẬT mà không có cơ
 * chế đánh thức từ ngoài thì lệnh **vẫn** từ chối — chuỗi chờ nằm trong ngăn xếp của chính job đó.
 * "Đang hoãn" trả lời *"nó có chờ không"*; `retryReach` trả lời *"ta có gọi nó dậy được không"*.
 * Hai câu hỏi khác nhau; trộn chúng bằng `||` là quay lại đúng lỗi (D).
 */
export function vramRetryButtonEnabled(retryReachKind: VramDeferRetryReachKind): boolean {
  return CHO_BAM[retryReachKind];
}
