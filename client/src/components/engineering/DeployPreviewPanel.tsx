/**
 * doc 80 Đợt 1 Task 5 (WS-02 / F2) — BẢN XEM TRƯỚC DEPLOY, hiện TRƯỚC khi hỏi OTP.
 *
 * Trước đây header báo "Deploy: ON" nhưng không deploy thật nào thành công, và người dùng chỉ
 * biết điều đó SAU khi nhập OTP. Panel này đọc `programming.deployPreview` (server chạy KHÔ đúng
 * các cổng của deploy thật) và nói trước: ghi THẬT xuống thiết bị / chỉ MÔ PHỎNG / BỊ CHẶN — kèm
 * từng cổng (✓ qua · ✗ chặn · ◐ chỉ mô phỏng · ⏳ chỉ biết lúc deploy) và lý do đã dịch.
 * Thuần hiển thị: không gọi mạng, không tự bấm gì.
 */
import { useTranslation } from "react-i18next";
import { CheckCircle2, XCircle, CircleDashed, Hourglass, ShieldAlert, ShieldCheck, FlaskConical } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export interface DeployPreviewGateView {
  name: string;
  ok: boolean;
  reason: string;
  effect?: "block" | "simulate";
  atDeploy?: boolean;
  params?: Record<string, string | number | boolean | null>;
}

export interface DeployPreviewView {
  verdict: "real" | "simulated" | "blocked";
  gates: DeployPreviewGateView[];
  target: {
    adapterKind: string;
    stage: string;
    deviceId: number | null;
    path: string;
    artifactVersion: number;
  };
}

export function DeployPreviewPanel({
  preview,
  isLoading,
  isError,
}: {
  preview: DeployPreviewView | undefined;
  isLoading: boolean;
  isError: boolean;
}) {
  const { t } = useTranslation();

  if (isLoading) {
    return <Skeleton className="h-16 w-full" data-testid="deploy-preview-loading" />;
  }
  if (isError || !preview) {
    return (
      <div data-testid="deploy-preview-error" className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
        {t("engineering.deployPreview.unavailable", "Không đọc được bản xem trước deploy — chưa biết lượt deploy này sẽ ghi thật hay chỉ mô phỏng.")}
      </div>
    );
  }

  const v = {
    real: {
      cls: "border-success/40 bg-success/10 text-success",
      Icon: ShieldCheck,
      label: t("engineering.deployPreview.verdict.real", "Sẽ GHI THẬT xuống thiết bị"),
    },
    simulated: {
      cls: "border-primary/30 bg-primary/5 text-primary",
      Icon: FlaskConical,
      label: t("engineering.deployPreview.verdict.simulated", "Chỉ ghi nhận MÔ PHỎNG — không ghi thiết bị"),
    },
    blocked: {
      cls: "border-destructive/40 bg-destructive/10 text-destructive",
      Icon: ShieldAlert,
      label: t("engineering.deployPreview.verdict.blocked", "Sẽ BỊ CHẶN — sửa các cổng ✗ trước khi deploy"),
    },
  }[preview.verdict];
  const VIcon = v.Icon;

  return (
    <div data-testid="deploy-preview" data-verdict={preview.verdict} className="space-y-2 rounded-md border bg-muted/20 p-2 text-xs">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {t("engineering.deployPreview.title", "Xem trước deploy (kiểm khô mọi cổng, trước khi hỏi OTP)")}
      </div>
      <div data-testid="deploy-preview-verdict" className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold ${v.cls}`}>
        <VIcon className="h-4 w-4 shrink-0" aria-hidden="true" /> {v.label}
      </div>
      <ul className="space-y-0.5" aria-label={t("engineering.deployPreview.gatesLabel", "Các cổng deploy")}>
        {preview.gates.map((g, i) => {
          const Icon = g.ok ? (g.atDeploy ? Hourglass : CheckCircle2) : g.effect === "block" ? XCircle : CircleDashed;
          const color = g.ok
            ? g.atDeploy ? "text-muted-foreground" : "text-success"
            : g.effect === "block" ? "text-destructive" : "text-primary";
          return (
            <li key={`${g.name}-${i}`} data-testid={`deploy-preview-gate-${g.name}`} data-ok={g.ok ? "1" : "0"} className="flex items-start gap-1.5">
              <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${color}`} aria-hidden="true" />
              <span>
                <span className="font-medium">{t(`engineering.deployPreview.gate.${g.name}`, g.name)}</span>
                {": "}
                <span className="text-muted-foreground">
                  {t(`engineering.deployPreview.reason.${g.reason}`, { defaultValue: g.reason, ...(g.params ?? {}) })}
                </span>
                {g.atDeploy && (
                  <span className="ml-1 italic text-muted-foreground">
                    ({t("engineering.deployPreview.atDeploy", "chỉ biết khi deploy")})
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
