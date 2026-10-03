/**
 * Doc 81 Đợt 2 Task 3 — <RollbackConfirm>: xác nhận khôi phục phiên bản dùng chung.
 *
 * Hai hợp đồng (Ruling R-2-g: mỗi trang giữ đúng hợp đồng HIỆN TẠI; siết thêm là quyết định riêng
 * của chủ dự án):
 * - `requireReason` (mặc định true): dựng trên `ConfirmWithReason` (2 bước, lý do bắt buộc, độ dài
 *   tối thiểu BẮT BUỘC khai — Orchestration: 3). Đây là mẫu Orchestration rollback (doc 80 ORC-05).
 * - `requireReason={false}`: một AlertDialog xác nhận phá huỷ, không lý do — hợp đồng của
 *   Workspace (EngineeringWorkspace rollback deployment — dùng component này từ final wave R-2-z3), Recipes,
 *   EqIntegration hôm nay.
 *
 * `requireOtp` (BẮT BUỘC khai) áp cho cả hai: OTP 6 số hỏi SAU bước xác nhận, MỖI lượt một mã
 * (`useStepUpOtp`; server `deployProcedure` → `requirePerCallFreshTotp`). Huỷ OTP ⇒ không gọi
 * `onRollback`.
 *
 * ⚠ Ruling R-2-q (Đợt 2 Task 11) — với thủ tục đứng trên `deployProcedure`, MẪU ĐƯỢC DUYỆT là
 * `requireOtp={false}` + `stepUp.guard` CỦA TRANG ngay trong `onRollback`:
 *   `onRollback={({ reason }) => stepUp.guard((totpCode) => m.mutate({ …, reason, totpCode }))}`.
 * `requireOtp={false}` ở đây KHÔNG bỏ OTP: OTP vẫn hỏi tươi mỗi lượt, chỉ là do guard của trang (một lần,
 * không hỏi đôi). Lý do: lưới step-up `vramPanelStepUp.unit.test.ts` §I-3 đòi mọi điểm gọi `.mutate(` của
 * một `deployProcedure` nằm TRONG `stepUp.guard` và gửi `totpCode` ở CÙNG file với `useMutation` — guard
 * nằm trong component này thì lưới không thấy và báo đỏ (đúng). `requireOtp` (guard ở đây) chỉ dành cho
 * thủ tục KHÔNG thuộc tập lưới đó.
 *
 * `onRollback` trả promise bị reject ⇒ lỗi hiện qua `toastTrpcError` (không bị nuốt);
 * trang nào đã tự toast trong `onError` của mutation thì gọi `mutate` (không trả promise) để khỏi
 * báo đôi.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useStepUpOtp } from "@/components/security/StepUpOtpDialog";
import { toastTrpcError } from "@/lib/trpcErrors";
import { ConfirmWithReason } from "./ConfirmWithReason";

export type RollbackPayload = { reason?: string; totpCode?: string };

interface RollbackConfirmBase {
  /** Nút mở. */
  trigger: React.ReactNode;
  /** Nhãn phiên bản đích, vd "v3" — dùng trong tiêu đề mặc định. */
  versionLabel: string;
  /** true ⇒ hỏi OTP tươi sau xác nhận (mutation đi qua deployProcedure). */
  requireOtp: boolean;
  /** Gọi mutation. Với requireOtp, chỉ chạy khi đã có mã 6 số. */
  onRollback: (payload: RollbackPayload) => void | Promise<void>;
  title?: string;
  description?: React.ReactNode;
  /** Ghi đè câu impact mặc định (câu mặc định nói rõ có cần OTP/lý do hay không). */
  impact?: React.ReactNode;
  confirmLabel?: string;
  disabled?: boolean;
  /**
   * final wave (R-2-z3) — báo mở/đóng cho trang (chỉ nhánh `requireReason={false}`): IDE sinh khoá thử
   * (idempotency) MỚI mỗi lần MỞ hộp (doc 80 WS-04) và dọn khi đóng. Không đổi hợp đồng xác nhận.
   */
  onOpenChange?: (open: boolean) => void;
}

export type RollbackConfirmProps = RollbackConfirmBase &
  (
    | {
        /** Mặc định true: lý do bắt buộc (ConfirmWithReason). */
        requireReason?: true;
        /** Độ dài lý do tối thiểu — giữ đúng số của trang cũ (Orchestration: 3). */
        minReasonLength: number;
        riskLevel?: "low" | "high";
        /** Chuỗi phải gõ khi riskLevel="high" (chuyển thẳng cho ConfirmWithReason). */
        confirmText?: string;
      }
    | {
        /** false: AlertDialog không lý do — hợp đồng hiện tại của Workspace/Recipes/EqIntegration. */
        requireReason: false;
        minReasonLength?: never;
        riskLevel?: never;
        confirmText?: never;
      }
  );

export function RollbackConfirm(props: RollbackConfirmProps): React.JSX.Element {
  const { trigger, versionLabel, requireOtp, onRollback, title, description, impact, confirmLabel, disabled = false, onOpenChange } = props;
  const { t } = useTranslation();
  const stepUp = useStepUpOtp();
  const [open, setOpen] = React.useState(false);

  /** Gọi onRollback; promise reject ⇒ toastTrpcError, rồi ném lại cho chỗ chờ (nếu có). */
  const call = React.useCallback(
    (payload: RollbackPayload): Promise<void> =>
      Promise.resolve()
        .then(() => onRollback(payload))
        .catch((e: unknown) => {
          toastTrpcError(e);
          throw e;
        }),
    [onRollback],
  );
  /** Chạy sau xác nhận: qua OTP nếu cần. Đường OTP không có ai chờ ⇒ nuốt sau khi đã toast. */
  const run = (base: RollbackPayload): Promise<void> | void => {
    if (requireOtp) {
      stepUp.guard((totpCode) => {
        call({ ...base, totpCode }).catch(() => undefined);
      });
      return;
    }
    return call(base);
  };

  const heading = title ?? t("layoutKit.rollback.title", "Roll back to {{version}}?", { version: versionLabel });
  const action = confirmLabel ?? t("layoutKit.rollback.action", "Roll back");

  if (props.requireReason === false) {
    return (
      <>
        <AlertDialog open={open} onOpenChange={(o) => { setOpen(o); onOpenChange?.(o); }}>
          <AlertDialogTrigger asChild disabled={disabled}>
            {trigger}
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{heading}</AlertDialogTitle>
              {description != null ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
            </AlertDialogHeader>
            {impact != null && <div className="text-sm text-muted-foreground">{impact}</div>}
            <AlertDialogFooter>
              <AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  const p = run({});
                  if (p) p.catch(() => undefined);
                }}
              >
                {action}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {stepUp.dialog}
      </>
    );
  }

  return (
    <>
      <ConfirmWithReason
        trigger={trigger}
        disabled={disabled}
        title={heading}
        description={description}
        impact={
          impact ??
          (requireOtp
            ? t("layoutKit.rollback.impactOtp", "Requires a reason and a fresh OTP code for this action; the reason is recorded in the audit log.")
            : t("layoutKit.rollback.impactNoOtp", "Requires a reason; the reason is recorded in the audit log."))
        }
        riskLevel={props.riskLevel ?? "low"}
        confirmText={props.confirmText}
        minReasonLength={props.minReasonLength}
        confirmLabel={action}
        onConfirm={async (reason) => {
          // Không OTP: chờ kết quả — reject giữ ConfirmWithReason mở (lỗi đã toast).
          await run({ reason });
        }}
      />
      {stepUp.dialog}
    </>
  );
}

export default RollbackConfirm;
