/**
 * DS F1b — <MetricCard> (doc 16 §12.2).
 *
 * Canonical KPI card. Extracted VERBATIM from the local `MetricCard` duplicated
 * in FleetOrchestration.tsx and SafetyWorkforce.tsx so it is a pixel-identical
 * drop-in (same layout, same tone → class mapping). The legacy tone names
 * (`danger` / `good`) are kept as aliases of the DS tones (`error` / `success`)
 * so existing call-sites swap with zero visual change.
 *
 * NOTE on colour (F0, doc 23): value tints now use the SEMANTIC tokens
 * (`text-warning` / `text-success` / `text-destructive` / `text-info`) instead of
 * literal palette classes (amber/emerald), so the card is theme-token-driven and
 * consistent across light/dark. The mapping is intentionally close to the old
 * literals (amber→warning, emerald→success).
 */
import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";

/** Legacy tones (danger/good) + DS aliases (error/success/info). */
export type MetricTone =
  | "default"
  | "warning"
  | "danger"
  | "good"
  | "error"
  | "success"
  | "info";

const TONE_CLASS: Record<MetricTone, string> = {
  default: "text-foreground",
  warning: "text-warning",
  danger: "text-destructive",
  error: "text-destructive",
  good: "text-success",
  success: "text-success",
  info: "text-info",
};

export interface MetricCardProps {
  icon?: React.ReactNode;
  label: string;
  value: number | string;
  tone?: MetricTone;
  /** Optional delta line under the value (e.g. "+3 today"). */
  delta?: React.ReactNode;
  /**
   * Kích thước card (doc 40 §13.3 content-first). `default` giữ nguyên bản gốc
   * (~110px). `compact` thu gọn padding / cỡ số / icon để trả không gian dọc cho
   * nội dung chính. Mặc định `default` → không phá caller hiện tại.
   */
  size?: "default" | "compact";
  className?: string;
}

export function MetricCard({
  icon,
  label,
  value,
  tone = "default",
  delta,
  size = "default",
  className,
}: MetricCardProps) {
  const toneCls = TONE_CLASS[tone];
  const compact = size === "compact";
  return (
    <Card className={className}>
      <CardContent
        className={
          compact ? "flex items-center gap-2.5 p-2.5" : "flex items-center gap-3 p-4"
        }
      >
        {icon != null && (
          <div
            aria-hidden="true"
            className={
              compact
                ? "flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary [&_svg]:h-4 [&_svg]:w-4"
                : "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
            }
          >
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <div
            className={`${compact ? "text-lg" : "text-2xl"} font-bold tabular-nums ${toneCls}`}
          >
            {value}
          </div>
          <div className="truncate text-xs text-muted-foreground">{label}</div>
          {delta != null && (
            <div className="truncate text-xs text-muted-foreground">{delta}</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default MetricCard;
