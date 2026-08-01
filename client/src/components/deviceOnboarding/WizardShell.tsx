// Doc 56 Đ2b nhóm 1 — khung stepper + Card dùng chung cho nhánh automation & iot
// của Wizard "Thêm thiết bị" V2. Tái dùng NGUYÊN mẫu stepper của
// AoiOnboardingWizard (vòng tròn bước + thanh nối), thêm nút "Đổi loại thiết bị"
// để quay lại Bước 0. State do component nhánh quản lý; shell chỉ render khung.
import type { LucideIcon } from "lucide-react";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface WizardShellProps {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  steps: string[];
  step: number;
  stepDescription?: string;
  /** Quay lại Bước 0 (chọn loại thiết bị). */
  onChangeClass?: () => void;
  changeClassLabel?: string;
  children: React.ReactNode;
}

export function WizardShell({
  title,
  subtitle,
  icon: Icon,
  steps,
  step,
  stepDescription,
  onChangeClass,
  changeClassLabel,
  children,
}: WizardShellProps): React.JSX.Element {
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            {Icon && <Icon className="h-5 w-5 text-primary" />}
            {title}
          </h2>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {onChangeClass && (
          <Button variant="ghost" size="sm" onClick={onChangeClass} className="shrink-0">
            <ArrowLeft className="h-4 w-4 mr-1" />
            {changeClassLabel}
          </Button>
        )}
      </div>

      {/* Stepper (mirrors AoiOnboardingWizard) */}
      <div className="flex items-center justify-between">
        {steps.map((title, i) => (
          <div key={i} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  "h-8 w-8 rounded-full flex items-center justify-center text-sm font-medium border",
                  i < step
                    ? "bg-success text-success-foreground border-success"
                    : i === step
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {i < step ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
              </div>
              <span className="text-xs mt-1 text-center w-20">{title}</span>
            </div>
            {i < steps.length - 1 && (
              <div className={cn("h-0.5 flex-1 mx-2", i < step ? "bg-success" : "bg-muted")} />
            )}
          </div>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{steps[step]}</CardTitle>
          {stepDescription && <CardDescription>{stepDescription}</CardDescription>}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  );
}

interface StepNavProps {
  onBack?: () => void;
  onNext?: () => void;
  nextDisabled?: boolean;
  backLabel: string;
  nextLabel: string;
  /** Ẩn nút Quay lại ở bước đầu. */
  hideBack?: boolean;
  nextTestId?: string;
}

/** Hàng nút Quay lại / Tiếp theo dùng chung cuối mỗi bước. */
export function StepNav({
  onBack,
  onNext,
  nextDisabled,
  backLabel,
  nextLabel,
  hideBack,
  nextTestId,
}: StepNavProps): React.JSX.Element {
  return (
    <div className={cn("flex", hideBack ? "justify-end" : "justify-between")}>
      {!hideBack && (
        <Button variant="outline" onClick={onBack}>
          {backLabel}
        </Button>
      )}
      {onNext && (
        <Button onClick={onNext} disabled={nextDisabled} data-testid={nextTestId}>
          {nextLabel}
        </Button>
      )}
    </div>
  );
}
