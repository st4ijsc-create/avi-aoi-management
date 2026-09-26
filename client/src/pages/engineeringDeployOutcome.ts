/**
 * doc 80 Đợt 0 — Task 4 (WS-04) — logic thuần cho deploy/yêu cầu duyệt/rollback ở màn Lập
 * trình thiết bị (EngineeringWorkspace). Tách ra để test được không cần DOM.
 */

/**
 * Khoá idempotency cho MỘT lượt mở/xác nhận của người dùng. Ổn định trong lượt đó (thử lại
 * OTP / double-submit dùng lại cùng khoá ⇒ server dedupe), KHÁC giữa các lượt (bấm lại sau
 * khi bị từ chối ⇒ deploy mới thay vì nhận lại dòng cũ). Cùng mẫu nonce với fleet rollout.
 */
export function newDeployAttemptKey(prefix: string, ...parts: Array<string | number>): string {
  const nonce =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 16)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return [prefix, ...parts, nonce].join("-").slice(0, 128);
}

export type DeployOutcomeLevel = "success" | "warning" | "error" | "info";

export interface DeployOutcome {
  level: DeployOutcomeLevel;
  /** Khoá i18n (vi/en/zh) + câu mặc định. */
  key: string;
  fallback: string;
  /** Lỗi thật từ server (khi bị từ chối / thất bại), hiển thị kèm. */
  detail?: string;
}

/**
 * Toast theo `status` THẬT của hàng deploy server trả về — không luôn "thành công".
 * `kind`: deploy đơn · yêu cầu duyệt (production qua Hộp duyệt) · rollback.
 */
export function deployOutcome(
  row: { status: string; error?: string | null; targetRolledBack?: boolean },
  kind: "deploy" | "request" | "rollback",
): DeployOutcome {
  const detail = row.error ? row.error : undefined;

  if (row.status === "rejected" || row.status === "failed") {
    if (kind === "rollback") {
      return {
        level: "error",
        key: "engineering.rollbackFailed",
        fallback: "Khôi phục KHÔNG thành công — deployment đích giữ nguyên trạng thái",
        detail,
      };
    }
    if (kind === "request") {
      return { level: "error", key: "engineering.deployRequestRejected", fallback: "Yêu cầu deploy bị từ chối", detail };
    }
    return { level: "error", key: "engineering.deployRejected", fallback: "Deploy bị từ chối", detail };
  }

  if (row.status === "pending") {
    return {
      level: "info",
      key: "engineering.deployInProgress",
      fallback: "Lượt deploy với cùng khoá đang được xử lý — xem trạng thái trong bảng deploy",
    };
  }

  if (row.status === "awaiting_approval") {
    return kind === "request"
      ? {
          level: "success",
          key: "engineering.deployRequested",
          fallback: "Đã gửi yêu cầu deploy — chờ người thứ hai duyệt ở Hộp duyệt",
        }
      : {
          level: "info",
          key: "engineering.deployAwaitingApproval",
          fallback: "Deploy đang CHỜ DUYỆT ở Hộp duyệt — chưa chạm thiết bị",
        };
  }

  if (kind === "rollback") {
    if (row.targetRolledBack) {
      return row.status === "simulated"
        ? {
            level: "success",
            key: "engineering.rollbackSimulated",
            fallback: "Đã ghi nhận khôi phục (SIMULATED — không chạm thiết bị)",
          }
        : { level: "success", key: "engineering.rollbackDone", fallback: "Đã khôi phục về phiên bản trước" };
    }
    return {
      level: "warning",
      key: "engineering.rollbackNotApplied",
      fallback:
        "Lượt khôi phục chỉ được ghi nhận mô phỏng — thiết bị KHÔNG đổi, deployment đích giữ nguyên trạng thái",
    };
  }

  switch (row.status) {
    case "verified":
      return { level: "success", key: "engineering.deployVerified", fallback: "Đã deploy & xác minh (read-back khớp)" };
    case "deployed":
      return {
        level: "warning",
        key: "engineering.deployedUnverified",
        fallback: "Đã deploy nhưng CHƯA xác minh read-back (thiết bị vắng / không hỗ trợ đọc lại)",
      };
    case "simulated":
    default:
      return {
        level: "success",
        key: "engineering.deploySimulated",
        fallback: "Đã ghi nhận (SIMULATED — flag OFF / chưa sign-off)",
      };
  }
}
