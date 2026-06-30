/**
 * DS F1b — <MetricCard> (doc 16 §12.2).
 *
 * Canonical KPI card. Extracted VERBATIM from the local `MetricCard` duplicated
 * in FleetOrchestration.tsx and SafetyWorkforce.tsx so it is a pixel-identical
 * drop-in (same layout, same tone → class mapping). The legacy tone names
 * (`danger` / `good`) are kept as aliases of the DS tones (`error` / `success`)
 * so existing call-sites swap with zero visual change.
 *
 * NOTE on colour: the value tint deliberately reuses the SAME literal classes
 * the original used (text-amber-500 / text-emerald-500 / text-destructive) to
 * guarantee identical pixels on adoption. New pages may prefer the semantic
 * `text-warning` / `text-success` / `text-info` tokens — both read clearly.
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
  warning: "text-amber-500",
  danger: "text-destructive",
  error: "text-destructive",
  good: "text-emerald-500",
  success: "text-emerald-500",
  info: "text-info",
};

export interface MetricCardProps {
  icon?: React.ReactNode;
  label: string;
  value: number | string;
  tone?: MetricTone;
  /** Optional delta line under the value (e.g. "+3 today"). */
  delta?: React.ReactNode;
  className?: string;
}

export function MetricCard({
  icon,
  label,
  value,
  tone = "default",
  delta,
  className,
}: MetricCardProps) {
  const toneCls = TONE_CLASS[tone];
  return (
    <Card className={className}>
      <CardContent className="flex items-center gap-3 p-4">
        {icon != null && (
          <div
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
          >
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <div className={`text-2xl font-bold tabular-nums ${toneCls}`}>{value}</div>
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
