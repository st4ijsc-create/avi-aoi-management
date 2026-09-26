/**
 * Wave 2 đường A — luật Phân tách trách nhiệm (SoD) phía client.
 *
 * QUAN TRỌNG: đây CHỈ là lớp hiển thị. Máy chủ vẫn là nơi thực thi thật
 * (thresholdApprovalRouter kiểm decidedBy ≠ requestedBy). Hàm này tồn tại để
 * KHOÁ nút và NÓI RÕ LÝ DO thay vì để người dùng bấm rồi nhận lỗi khó hiểu.
 * Fail-closed: không xác định được user ⇒ không cho quyết định.
 */
export interface DecideGateInput {
  requestedBy: number;
}

export interface DecideGateResult {
  allowed: boolean;
  reason?: "own-request" | "unknown-user" | "no-permission";
}

/**
 * Vòng sửa 1 (review Task 2) — thêm rào "no-permission": `approve`/`reject` là
 * `qualityProcedure` ở server (settings_alerts.canEdit); trước khi có rào này,
 * ai cũng thấy nút "Duyệt" trông bấm được rồi nhận FORBIDDEN khó hiểu.
 *
 * `canApproveThresholds` được TRUYỀN VÀO tường minh (không gọi usePermissions()
 * bên trong) để hàm này giữ nguyên tính THUẦN — test được mà không cần mock hook.
 *
 * Thứ tự kiểm CỐ Ý: chưa biết user → thiếu quyền → tự-duyệt. Thiếu quyền là rào
 * chặn TRƯỚC SoD: một người thiếu quyền quality mà vô tình cũng là người tạo đề
 * xuất phải thấy lý do "thiếu quyền" (rào thật, áp dụng cho MỌI đề xuất của họ),
 * không phải "tự-duyệt" (rào chỉ áp dụng cho đúng đề xuất này).
 */
export function canDecide(
  approval: DecideGateInput,
  currentUserId: number | undefined,
  canApproveThresholds: boolean,
): DecideGateResult {
  // Fail-closed, nhưng LÝ DO PHẢI TRUNG THỰC: không biết user KHÁC với tự-duyệt.
  // Nói sai lý do chính là cái bệnh mà cả Wave 2 sinh ra để chữa.
  if (currentUserId == null) return { allowed: false, reason: "unknown-user" };
  if (!canApproveThresholds) return { allowed: false, reason: "no-permission" };
  if (approval.requestedBy === currentUserId) return { allowed: false, reason: "own-request" };
  return { allowed: true };
}
