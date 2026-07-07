/**
 * DS Wave-2 — <RadialGauge> (doc 16 §12.2 micro-primitives).
 *
 * A crisp SVG arc gauge for a `0..max` value — OEE, health %, utilization, and
 * similar single-number KPIs. Renders a 270° open-bottom gauge track with a
 * coloured progress arc and the value (+ optional unit / caption) centred inside.
 *
 * Colour is theme-token-driven (NEVER hardcoded hex): semantic tones map to the
 * CSS custom properties (`--success` / `--warning` / `--destructive`) and the
 * neutral tone borrows the categorical `chartColor(0)` — all resolve at paint
 * time against the active light/dark token set, so the gauge flips correctly.
 *
 * `tone="auto"` derives the tone from `value / max`, treating HIGHER as healthier
 * (the OEE / health / utilization convention). `thresholds` are expressed as
 * FRACTIONS of `max` (0..1): value below `critical` → critical, below `warning`
 * → warning, otherwise → good. Default `{ warning: 0.5, critical: 0.25 }`.
 *
 * @example
 *   <RadialGauge value={oee} unit="%" label="OEE" tone="auto" />
 *   <RadialGauge value={72} max={100} tone="good" size={120} thickness={10} />
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { chartColor } from "@/components/patterns/chartTokens";

export interface RadialGaugeProps {
  value: number;
  /** Upper bound of the scale. Default 100. */
  max?: number;
  /** Diameter in px. Default 96. */
  size?: number;
  /** Arc stroke width in px. Default 8. */
  thickness?: number;
  /** Small caption rendered under the value. */
  label?: string;
  /** Unit suffix appended to the value (e.g. "%"). */
  unit?: string;
  /** Colour intent. "auto" derives from value/max thresholds (higher = healthier). */
  tone?: "auto" | "good" | "warning" | "critical" | "neutral";
  /** Thresholds for tone="auto", as FRACTIONS of `max` (0..1). */
  thresholds?: { warning: number; critical: number };
  className?: string;
  "aria-label"?: string;
}

type ResolvedTone = "good" | "warning" | "critical" | "neutral";

/** Progress-arc colour per tone (theme-token CSS vars — never hardcoded hex). */
function toneStroke(tone: ResolvedTone): string {
  switch (tone) {
    case "good":
      return "var(--success)";
    case "warning":
      return "var(--warning)";
    case "critical":
      return "var(--destructive)";
    default:
      return chartColor(0);
  }
}

/** Value-text colour class per tone. */
const TONE_TEXT: Record<ResolvedTone, string> = {
  good: "text-success",
  warning: "text-warning",
  critical: "text-destructive",
  neutral: "text-foreground",
};

/** Fraction of the full circle the gauge sweeps (270° open-bottom). */
const SWEEP = 0.75;

function formatValue(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function RadialGauge({
  value,
  max = 100,
  size = 96,
  thickness = 8,
  label,
  unit,
  tone = "auto",
  thresholds = { warning: 0.5, critical: 0.25 },
  className,
  "aria-label": ariaLabel,
}: RadialGaugeProps): React.JSX.Element {
  const safeMax = max > 0 ? max : 1;
  const ratio = Math.max(0, Math.min(1, value / safeMax));

  const resolvedTone: ResolvedTone =
    tone === "auto"
      ? ratio < thresholds.critical
        ? "critical"
        : ratio < thresholds.warning
          ? "warning"
          : "good"
      : tone;

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - thickness / 2 - 1;
  const circumference = 2 * Math.PI * r;
  const trackLen = SWEEP * circumference;
  const valueLen = ratio * trackLen;

  // Rotate so the drawing starts at 135° (down-left) and sweeps 270° clockwise,
  // leaving a 90° gap centred at the bottom (6 o'clock).
  const rotate = `rotate(135 ${cx} ${cy})`;

  const displayValue = `${formatValue(value)}${unit ?? ""}`;
  const computedAria =
    ariaLabel ?? `${label ? `${label}: ` : ""}${displayValue} of ${formatValue(safeMax)}${unit ?? ""}`;

  return (
    <div
      className={cn("relative inline-flex items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={computedAria}
        className="overflow-visible"
      >
        {/* Track */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="var(--muted)"
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={`${trackLen} ${circumference}`}
          transform={rotate}
        />
        {/* Progress */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={toneStroke(resolvedTone)}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={`${valueLen} ${circumference}`}
          transform={rotate}
          className="motion-safe:transition-[stroke-dasharray] motion-safe:duration-500 motion-safe:ease-out"
        />
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn("font-bold leading-none tabular-nums", TONE_TEXT[resolvedTone])}
          style={{ fontSize: Math.max(12, size * 0.24) }}>
          {displayValue}
        </span>
        {label != null && (
          <span className="mt-1 max-w-full truncate px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
        )}
      </div>
    </div>
  );
}

export default RadialGauge;
