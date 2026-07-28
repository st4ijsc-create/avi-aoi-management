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
  reason?: "own-request" | "unknown-user";
}

export function canDecide(approval: DecideGateInput, currentUserId: number | undefined): DecideGateResult {
  // Fail-closed, nhưng LÝ DO PHẢI TRUNG THỰC: không biết user KHÁC với tự-duyệt.
  // Nói sai lý do chính là cái bệnh mà cả Wave 2 sinh ra để chữa.
  if (currentUserId == null) return { allowed: false, reason: "unknown-user" };
  if (approval.requestedBy === currentUserId) return { allowed: false, reason: "own-request" };
  return { allowed: true };
}
