/**
 * Doc 81 Đợt 2 Task 3 — <WizardDialog> / <WizardFrame>: luồng nhiều bước (vd deploy wizard 4 bước
 * của IDE gồm canary — doc 81 §1.2) với trạng thái từng bước, Quay lại / Tiếp / Hoàn tất.
 *
 * - Hiện dưới dạng SHEET phải (flyout), không phải dialog giữa màn. `WizardFrame` là phần thân để
 *   nhúng vào một lớp `FlyoutHost` khi trang đã có stack flyout.
 * - Trạng thái bước: `complete` (trước bước hiện tại) · `current` (aria-current="step") ·
 *   `upcoming` · `error` (bước khai `error`, thắng các trạng thái khác).
 * - `canProceed=false` khoá Tiếp/Hoàn tất của bước đó. Validation nghiệp vụ vẫn ở trang.
 * - `dirty` ⇒ đóng (Esc/nút X/bấm ra ngoài) phải qua "Bỏ thay đổi chưa lưu?".
 * - Mở lại ⇒ về bước 1.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Check, Loader2, X as XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { UnsavedChangesConfirm } from "./UnsavedChangesConfirm";

export interface WizardStep {
  id: string;
  title: React.ReactNode;
  content: React.ReactNode;
  /** false ⇒ khoá Tiếp/Hoàn tất ở bước này. Mặc định true. */
  canProceed?: boolean;
  /** Bước có lỗi (validation trang). */
  error?: boolean;
}

export type WizardStepStatus = "complete" | "current" | "upcoming" | "error";

export function wizardStepStatus(index: number, current: number, step: Pick<WizardStep, "error">): WizardStepStatus {
  if (step.error) return "error";
  if (index < current) return "complete";
  if (index === current) return "current";
  return "upcoming";
}

export interface WizardFrameProps {
  steps: readonly WizardStep[];
  index: number;
  onIndexChange: (i: number) => void;
  onFinish: () => void | Promise<void>;
  finishLabel?: React.ReactNode;
  pending?: boolean;
  className?: string;
}

export function WizardFrame({ steps, index, onIndexChange, onFinish, finishLabel, pending = false, className }: WizardFrameProps) {
  const { t } = useTranslation();
  const step = steps[index];
  const last = index === steps.length - 1;
  const canProceed = step?.canProceed !== false;
  const statusLabel: Record<WizardStepStatus, string> = {
    complete: t("layoutKit.wizard.status.complete", "done"),
    current: t("layoutKit.wizard.status.current", "current"),
    upcoming: t("layoutKit.wizard.status.upcoming", "upcoming"),
    error: t("layoutKit.wizard.status.error", "has errors"),
  };
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)} data-wizard="">
      <ol aria-label={t("layoutKit.wizard.stepsLabel", "Steps")} className="flex flex-wrap items-center gap-1 border-b px-4 py-2">
        {steps.map((s, i) => {
          const st = wizardStepStatus(i, index, s);
          return (
            <li
              key={s.id}
              data-step-status={st}
              aria-current={i === index ? "step" : undefined}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
                st === "current" && "border-primary bg-primary/10 font-medium text-primary",
                st === "complete" && "border-success/40 text-success",
                st === "error" && "border-destructive/50 bg-destructive/10 text-destructive",
                st === "upcoming" && "text-muted-foreground",
              )}
            >
              {st === "complete" ? <Check className="h-3 w-3" aria-hidden="true" /> : st === "error" ? <XIcon className="h-3 w-3" aria-hidden="true" /> : <span aria-hidden="true">{i + 1}</span>}
              <span>{s.title}</span>
              <span className="sr-only">({statusLabel[st]})</span>
            </li>
          );
        })}
      </ol>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <p className="mb-2 text-xs text-muted-foreground">
          {t("layoutKit.wizard.stepOf", "Step {{current}} of {{total}}", { current: index + 1, total: steps.length })}
        </p>
        {step?.content}
      </div>
      <div className="flex items-center justify-between gap-2 border-t px-4 py-3">
        <Button variant="outline" disabled={index === 0 || pending} onClick={() => onIndexChange(index - 1)}>
          {t("layoutKit.wizard.back", "Back")}
        </Button>
        {last ? (
          <Button disabled={!canProceed || pending} onClick={() => void onFinish()}>
            {pending && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />}
            {finishLabel ?? t("layoutKit.wizard.finish", "Finish")}
          </Button>
        ) : (
          <Button disabled={!canProceed || pending} onClick={() => onIndexChange(index + 1)}>
            {t("layoutKit.wizard.next", "Next")}
          </Button>
        )}
      </div>
    </div>
  );
}

export interface WizardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  steps: readonly WizardStep[];
  onFinish: () => void | Promise<void>;
  finishLabel?: React.ReactNode;
  pending?: boolean;
  /** Form trong wizard còn dữ liệu chưa lưu ⇒ hỏi trước khi đóng. */
  dirty?: boolean;
  size?: "md" | "lg";
}

export function WizardDialog({ open, onOpenChange, title, description, steps, onFinish, finishLabel, pending, dirty = false, size = "md" }: WizardDialogProps) {
  const [index, setIndex] = React.useState(0);
  const [asking, setAsking] = React.useState(false);
  React.useEffect(() => {
    if (open) setIndex(0);
  }, [open]);
  const requestClose = () => {
    if (pending) return;
    if (dirty) setAsking(true);
    else onOpenChange(false);
  };
  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(o) => {
          if (!o) requestClose();
        }}
      >
        <SheetContent
          side="right"
          data-wizard-dialog=""
          aria-describedby={undefined}
          className={cn("flex w-[92vw] flex-col gap-0 p-0", size === "lg" ? "sm:max-w-[720px]" : "sm:max-w-[560px]")}
        >
          <SheetHeader className="border-b px-4 py-3 pr-10">
            <SheetTitle className="text-base">{title}</SheetTitle>
            {description ? <SheetDescription>{description}</SheetDescription> : null}
          </SheetHeader>
          <WizardFrame
            steps={steps}
            index={Math.min(index, Math.max(0, steps.length - 1))}
            onIndexChange={setIndex}
            onFinish={onFinish}
            finishLabel={finishLabel}
            pending={pending}
          />
        </SheetContent>
      </Sheet>
      <UnsavedChangesConfirm
        open={asking}
        onKeep={() => setAsking(false)}
        onDiscard={() => {
          setAsking(false);
          onOpenChange(false);
        }}
      />
    </>
  );
}

export default WizardDialog;
