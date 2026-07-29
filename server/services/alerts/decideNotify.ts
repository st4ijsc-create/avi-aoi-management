/**
 * Sprint 5 §2.3 — CÓ GỬI THÔNG BÁO KHÔNG.
 *
 * Tách khỏi routeAlert vì hai lý do:
 *  1. Test được KHÔNG CẦN DB (bài học Wave 2: logic rủi ro nằm lẫn trong hàm có
 *     I/O thì không test nào chạy qua nó).
 *  2. Tách bạch "ghi nhật ký" (LUÔN đủ) khỏi "gửi thông báo" (được phép gộp) —
 *     hai hướng ngược nhau mà Wave 3/4 để dính chung vào cửa sổ Redis 5 phút,
 *     nên A1 (muốn gộp nhiều hơn) và A2 (muốn ghi đủ hơn) mới triệt tiêu nhau.
 *
 * Hàm này KHÔNG quyết định ghi mới hay cập nhật (decideAlertWrite lo việc đó),
 * và KHÔNG quyết định có phát cảnh báo hay không (predictiveMaintenanceService).
 */
import { severityRank, type AlertSeverity } from "./decideAlertWrite";

export type NotifyReason =
  | "first"
  | "critical"
  | "severity-raised"
  | "never-notified"
  | "cooldown-elapsed"
  | "suppressed-cooldown";

export interface NotifyInput {
  action: "insert" | "update";
  /** Mức của LẦN NÀY. */
  incomingSeverity: AlertSeverity;
  /** Mức của dòng ĐANG MỞ TRƯỚC khi update — KHÔNG phải mức đã gộp
   *  (decision.severity). Cùng loại bẫy với buildOccurrence ở Wave 4. */
  previousSeverity: AlertSeverity | null;
  /** ms epoch của lượt gửi gần nhất; null = chưa từng gửi. */
  lastNotifiedAt: number | null;
  now: number;
  cooldownMs: number;
  /** 0 = CRITICAL luôn báo ngay (mặc định sản phẩm). */
  criticalCooldownMs: number;
}

export interface NotifyDecision {
  notify: boolean;
  reason: NotifyReason;
}

export function decideNotify(input: NotifyInput): NotifyDecision {
  // Cảnh báo mới thì không có gì để gộp.
  if (input.action === "insert") return { notify: true, reason: "first" };

  const elapsed = input.lastNotifiedAt == null ? null : input.now - input.lastNotifiedAt;

  // CRITICAL xuyên qua cooldown thường. Van riêng mặc định 0 ⇒ luôn báo.
  if (
    input.incomingSeverity === "CRITICAL" &&
    (elapsed == null || elapsed >= input.criticalCooldownMs)
  ) {
    return { notify: true, reason: "critical" };
  }

  // Tình trạng xấu ĐI ⇒ tin mới, báo ngay bất kể cooldown.
  if (
    input.previousSeverity != null &&
    severityRank(input.incomingSeverity) > severityRank(input.previousSeverity)
  ) {
    return { notify: true, reason: "severity-raised" };
  }

  // FAIL-OPEN: chưa từng gửi thì gửi. Thà báo trùng còn hơn im lặng.
  if (elapsed == null) return { notify: true, reason: "never-notified" };
  if (elapsed >= input.cooldownMs) return { notify: true, reason: "cooldown-elapsed" };

  return { notify: false, reason: "suppressed-cooldown" };
}
