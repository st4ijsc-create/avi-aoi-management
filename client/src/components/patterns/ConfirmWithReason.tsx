/**
 * Doc 44 G5.4 — <ConfirmWithReason>: xác nhận 2 bước + lý do bắt buộc cho hành
 * động rủi ro (dừng line, tắt/xoá rule an toàn, xoá hàng loạt, …).
 *
 * Bước 1: mô tả hành động + impact + ô "lý do" bắt buộc (min length).
 * Bước 2: xác nhận cuối kèm tóm tắt hành động + lý do; riskLevel "high" còn
 *         yêu cầu gõ đúng chuỗi xác nhận (mặc định "XÁC NHẬN") mới bấm được.
 *
 * Reason được truyền vào onConfirm(reason) — caller đưa vào mutation nếu
 * backend nhận; nếu không thì log/audit client-side. Component không tự toast
 * (đồng bộ với ConfirmDeleteDialog); giữ dialog mở khi onConfirm reject.
 * i18n: key `confirmWithReason.*` (đủ en/vi/zh).
 *
 * ── Dùng ───────────────────────────────────────────────────────────────────────
 *   <ConfirmWithReason
 *     trigger={<Button variant="destructive">Dừng line</Button>}
 *     title="Dừng line SMT-1?"
 *     description="Toàn bộ máy trên line sẽ ngừng nhận lệnh mới."
 *     impact="~120 board WIP sẽ bị giữ lại tại trạm hiện tại."
 *     riskLevel="high"
 *     onConfirm={async (reason) => { await stopLine.mutateAsync({ id, reason }); }}
 *   />
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ArrowLeft, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export interface ConfirmWithReasonProps {
  /** Nút mở dialog (bọc DialogTrigger asChild). */
  trigger: React.ReactNode;
  /** Tiêu đề — nêu rõ hành động, ví dụ `Xoá rule "Stop line khi NG > 5%"?`. */
  title: string;
  /** Mô tả hành động (bước 1). */
  description?: React.ReactNode;
  /** Impact — hệ quả cụ thể của hành động (khối cảnh báo vàng ở bước 1). */
  impact?: React.ReactNode;
  /** "low" (mặc định): 2 bước + lý do. "high": thêm gõ chuỗi xác nhận ở bước 2. */
  riskLevel?: "low" | "high";
  /** Chuỗi phải gõ đúng khi riskLevel="high". Mặc định theo locale ("XÁC NHẬN"). */
  confirmText?: string;
  /** Độ dài tối thiểu của lý do. Mặc định 10. */
  minReasonLength?: number;
  /** Chạy khi xác nhận cuối. Dialog giữ loading tới khi resolve; giữ mở khi lỗi. */
  onConfirm: (reason: string) => Promise<void> | void;
  /** Nhãn nút xác nhận cuối (mặc định "Xác nhận thực hiện"). */
  confirmLabel?: string;
  disabled?: boolean;
}

export function ConfirmWithReason({
  trigger,
  title,
  description,
  impact,
  riskLevel = "low",
  confirmText,
  minReasonLength = 10,
  onConfirm,
  confirmLabel,
  disabled = false,
}: ConfirmWithReasonProps): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState<1 | 2>(1);
  const [reason, setReason] = React.useState("");
  const [typed, setTyped] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const requiredText = confirmText ?? t("confirmWithReason.defaultConfirmText", "XÁC NHẬN");
  const reasonOk = reason.trim().length >= minReasonLength;
  const typedOk = riskLevel !== "high" || typed.trim() === requiredText;

  const reset = React.useCallback(() => {
    setStep(1);
    setReason("");
    setTyped("");
  }, []);

  const handleConfirm = React.useCallback(async () => {
    if (!reasonOk || !typedOk) return;
    setLoading(true);
    try {
      await onConfirm(reason.trim());
      setOpen(false);
      reset();
    } catch {
      // Giữ dialog mở khi lỗi; caller đã toast qua onError.
    } finally {
      setLoading(false);
    }
  }, [onConfirm, reason, reasonOk, typedOk, reset]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (loading) return; // không cho đóng khi đang xử lý
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild disabled={disabled}>
        {trigger}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        {step === 1 ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {riskLevel === "high" && (
                  <AlertTriangle className="size-4 shrink-0 text-destructive" aria-hidden="true" />
                )}
                {title}
              </DialogTitle>
              {description && <DialogDescription>{description}</DialogDescription>}
            </DialogHeader>

            {impact && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>{impact}</span>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="cwr-reason">
                {t("confirmWithReason.reasonLabel", "Lý do (bắt buộc)")}
              </Label>
              <Textarea
                id="cwr-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t(
                  "confirmWithReason.reasonPlaceholder",
                  "Vì sao bạn thực hiện hành động này? (ghi vào audit)",
                )}
                rows={3}
                autoFocus
              />
              {!reasonOk && reason.trim().length > 0 && (
                <p className="text-xs text-destructive">
                  {t("confirmWithReason.reasonTooShort", "Lý do cần tối thiểu {{min}} ký tự", {
                    min: minReasonLength,
                  })}
                </p>
              )}
            </div>

            <DialogFooter>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className={cn(buttonVariants({ variant: "outline" }))}
              >
                {t("confirmWithReason.cancel", "Huỷ")}
              </button>
              <button
                type="button"
                disabled={!reasonOk}
                onClick={() => setStep(2)}
                className={cn(buttonVariants({ variant: "default" }))}
              >
                {t("confirmWithReason.continue", "Tiếp tục")}
              </button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>
                {t("confirmWithReason.finalTitle", "Xác nhận lần cuối")}
              </DialogTitle>
              <DialogDescription>
                {t(
                  "confirmWithReason.finalDescription",
                  "Kiểm tra lại tóm tắt bên dưới trước khi thực hiện.",
                )}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-1 rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <p>
                <span className="font-medium">
                  {t("confirmWithReason.summaryAction", "Hành động")}:
                </span>{" "}
                {title}
              </p>
              <p className="break-words">
                <span className="font-medium">
                  {t("confirmWithReason.summaryReason", "Lý do")}:
                </span>{" "}
                {reason.trim()}
              </p>
            </div>

            {riskLevel === "high" && (
              <div className="space-y-2">
                <Label htmlFor="cwr-typed">
                  {t("confirmWithReason.typeToConfirm", 'Gõ "{{text}}" để xác nhận', {
                    text: requiredText,
                  })}
                </Label>
                <Input
                  id="cwr-typed"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder={requiredText}
                  autoComplete="off"
                  autoFocus
                />
              </div>
            )}

            <DialogFooter>
              <button
                type="button"
                disabled={loading}
                onClick={() => setStep(1)}
                className={cn(buttonVariants({ variant: "outline" }))}
              >
                <ArrowLeft className="size-4" aria-hidden="true" />
                {t("confirmWithReason.back", "Quay lại")}
              </button>
              <button
                type="button"
                disabled={loading || !typedOk}
                onClick={handleConfirm}
                className={cn(buttonVariants({ variant: "destructive" }))}
              >
                {loading && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                {confirmLabel ?? t("confirmWithReason.confirm", "Xác nhận thực hiện")}
              </button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default ConfirmWithReason;
