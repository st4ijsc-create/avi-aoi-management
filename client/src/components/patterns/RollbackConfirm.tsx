/**
 * Doc 81 Đợt 2 Task 3 — <RollbackConfirm>: xác nhận khôi phục phiên bản dùng chung.
 *
 * Dựng trên `ConfirmWithReason` (2 bước, lý do bắt buộc, độ dài tối thiểu do trang khai) và
 * `useStepUpOtp` (OTP 6 số hỏi SAU bước xác nhận cuối, MỖI lượt — server chạy
 * `deployProcedure` → `requirePerCallFreshTotp`, mã cũ không dùng lại được). Đây đúng là mẫu
 * Orchestration rollback (doc 80 ORC-05, OrchestrationStudio "rollback = deploy") đưa ra dùng chung
 * cho 4 bản viết lại (Workspace, Recipes, Orchestration, EqIntegration) — mỗi trang chuyển ở task
 * của trang đó.
 *
 * `requireOtp` và `minReasonLength` BẮT BUỘC khai ở chỗ gọi — không có mặc định ngầm để một trang
 * không lỡ tay hạ cổng. Huỷ ở hộp OTP ⇒ KHÔNG gọi `onRollback`.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { ConfirmWithReason } from "./ConfirmWithReason";
import { useStepUpOtp } from "@/components/security/StepUpOtpDialog";

export type RollbackPayload = { reason: string; totpCode?: string };

export interface RollbackConfirmProps {
  /** Nút mở (bọc DialogTrigger asChild). */
  trigger: React.ReactNode;
  /** Nhãn phiên bản đích, vd "v3" — dùng trong tiêu đề mặc định. */
  versionLabel: string;
  /** true ⇒ hỏi OTP tươi sau xác nhận (mutation đi qua deployProcedure). */
  requireOtp: boolean;
  /** Độ dài lý do tối thiểu — giữ đúng số của trang cũ (Orchestration: 3). */
  minReasonLength: number;
  /** Gọi mutation. Với requireOtp, chỉ chạy khi đã có mã 6 số. */
  onRollback: (payload: RollbackPayload) => void | Promise<void>;
  title?: string;
  description?: React.ReactNode;
  /** Ghi đè câu impact mặc định (câu mặc định nói rõ có cần OTP hay không). */
  impact?: React.ReactNode;
  confirmLabel?: string;
  riskLevel?: "low" | "high";
  disabled?: boolean;
}

export function RollbackConfirm({
  trigger,
  versionLabel,
  requireOtp,
  minReasonLength,
  onRollback,
  title,
  description,
  impact,
  confirmLabel,
  riskLevel = "low",
  disabled = false,
}: RollbackConfirmProps): React.JSX.Element {
  const { t } = useTranslation();
  const stepUp = useStepUpOtp();
  return (
    <>
      <ConfirmWithReason
        trigger={trigger}
        disabled={disabled}
        title={title ?? t("layoutKit.rollback.title", "Roll back to {{version}}?", { version: versionLabel })}
        description={description}
        impact={
          impact ??
          (requireOtp
            ? t("layoutKit.rollback.impactOtp", "Requires a reason and a fresh OTP code for this action; the reason is recorded in the audit log.")
            : t("layoutKit.rollback.impactNoOtp", "Requires a reason; the reason is recorded in the audit log."))
        }
        riskLevel={riskLevel}
        minReasonLength={minReasonLength}
        confirmLabel={confirmLabel ?? t("layoutKit.rollback.action", "Roll back")}
        onConfirm={async (reason) => {
          if (requireOtp) {
            stepUp.guard((totpCode) => {
              void onRollback({ reason, totpCode });
            });
            return;
          }
          await onRollback({ reason });
        }}
      />
      {stepUp.dialog}
    </>
  );
}

export default RollbackConfirm;
