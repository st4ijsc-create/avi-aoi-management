/**
 * doc 44 W3-B4 / G5.10 — Panel readiness (Line View, spec LDS-L3 §6.2):
 * render checklist checks[] {passed/skipped/detail} từ lineController.readiness
 * + nút "Kiểm tra lại" (refetch chạy checklist MỚI, không cache).
 *
 * ReadinessChecklist được export riêng để tái dùng trong dialog kết quả lệnh
 * (TransitionResult NOT_READY trả cùng shape checks).
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { CheckCircle2, Loader2, MinusCircle, RefreshCw, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/patterns";

/** Mirror ReadinessCheck (server/services/lineController/lineReadiness.ts). */
export interface ReadinessCheckView {
  name: string;
  passed: boolean;
  skipped?: boolean;
  detail: string;
}

export interface ReadinessResultView {
  lineId: number;
  ready: boolean;
  checks: ReadinessCheckView[];
  checkedAt: string;
}

/** Nhãn i18n cho 5 check v1 — fallback token thô (honest) khi server thêm check mới. */
function checkLabel(t: TFunction, name: string): string {
  const known: Record<string, string> = {
    machines_online: t("lineView.check.machines_online", "Máy của tuyến online"),
    no_machine_faulted: t("lineView.check.no_machine_faulted", "Không máy nào lỗi"),
    feeder_verify: t("lineView.check.feeder_verify", "Feeder setup run-ready"),
    safety_read: t("lineView.check.safety_read", "Safety (đọc advisory)"),
    recipe_loaded: t("lineView.check.recipe_loaded", "Recipe set đã nạp"),
  };
  return known[name] ?? name;
}

export function ReadinessChecklist({
  checks,
  className,
}: {
  checks: ReadinessCheckView[];
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <ul className={cn("space-y-2", className)}>
      {checks.map((c) => (
        <li key={c.name} className="flex items-start gap-2 text-sm">
          {c.skipped ? (
            <MinusCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          ) : c.passed ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
          ) : (
            <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
          )}
          <div className="min-w-0">
            <p className={cn("font-medium", c.skipped && "text-muted-foreground")}>
              {checkLabel(t, c.name)}
              {c.skipped && (
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  ({t("lineView.readiness.skipped", "bỏ qua")})
                </span>
              )}
            </p>
            <p className="break-words text-xs text-muted-foreground">{c.detail}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export interface ReadinessPanelProps {
  readiness: ReadinessResultView | undefined;
  isLoading: boolean;
  isFetching: boolean;
  onRecheck: () => void;
  className?: string;
}

export function ReadinessPanel({
  readiness,
  isLoading,
  isFetching,
  onRecheck,
  className,
}: ReadinessPanelProps) {
  const { t } = useTranslation();
  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          {t("lineView.readiness.title", "Sẵn sàng chạy (readiness)")}
          {readiness && (
            <StatusBadge
              status={readiness.ready ? "ready" : "not_ready"}
              tone={readiness.ready ? "success" : "error"}
              label={
                readiness.ready
                  ? t("lineView.readiness.ready", "SẴN SÀNG")
                  : t("lineView.readiness.notReady", "CHƯA SẴN SÀNG")
              }
            />
          )}
        </CardTitle>
        <Button size="sm" variant="outline" onClick={onRecheck} disabled={isFetching}>
          {isFetching ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="size-4" aria-hidden="true" />
          )}
          {t("lineView.readiness.recheck", "Kiểm tra lại")}
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading && (
          <p className="text-sm text-muted-foreground">{t("common.loading", "Đang tải…")}</p>
        )}
        {!isLoading && !readiness && (
          <p className="text-sm text-muted-foreground">
            {t("lineView.readiness.unavailable", "Chưa đọc được checklist readiness.")}
          </p>
        )}
        {readiness && (
          <>
            <ReadinessChecklist checks={readiness.checks} />
            <p className="mt-3 text-xs text-muted-foreground">
              {t("lineView.readiness.checkedAt", "Kiểm lúc {{time}}", {
                time: new Date(readiness.checkedAt).toLocaleString(),
              })}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default ReadinessPanel;
