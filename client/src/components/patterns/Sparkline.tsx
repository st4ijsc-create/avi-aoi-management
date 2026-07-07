/**
 * DS Wave-2 — <Sparkline> (doc 16 §12.2 micro-primitives).
 *
 * A tiny inline trend line for a series of numbers — throughput, temperature,
 * yield-over-time, and other glanceable KPIs that live in a table cell or beside
 * a metric. Hand-rolled SVG polyline (no recharts) to stay dependency-light and
 * crisp at small sizes; optional faint area fill and an emphasized end dot.
 *
 * Colour is theme-token-driven (NEVER hardcoded hex): the neutral tone borrows
 * the categorical `chartColor(0)`; semantic tones map to the CSS custom
 * properties (`--success` / `--warning` / `--destructive`) so the line flips
 * correctly between light and dark. Stroke uses `vector-effect` so it stays
 * hairline-crisp regardless of size.
 *
 * @example
 *   <Sparkline data={[3, 5, 4, 8, 7, 9]} tone="good" showArea showEndDot />
 *   <Sparkline data={points.map((p) => ({ x: p.t, y: p.value }))} tone="warning" />
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { chartColor } from "@/components/patterns/chartTokens";

/** A point with an explicit y and an optional (ignored for layout) x label. */
export interface SparkPoint {
  x?: number | string;
  y: number;
}

export interface SparklineProps {
  /** Series values. Accepts `number[]` or `{ x?, y }[]`. */
  data: number[] | SparkPoint[];
  /** Width in px. Default 96. */
  width?: number;
  /** Height in px. Default 28. */
  height?: number;
  tone?: "neutral" | "good" | "warning" | "critical";
  /** Faint fill under the line. */
  showArea?: boolean;
  /** Emphasize the last point with a dot. */
  showEndDot?: boolean;
  className?: string;
  "aria-label"?: string;
}

/** Line colour per tone (theme-token CSS vars — never hardcoded hex). */
function toneStroke(tone: NonNullable<SparklineProps["tone"]>): string {
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

function toYValues(data: number[] | SparkPoint[]): number[] {
  return data
    .map((d) => (typeof d === "number" ? d : d?.y))
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n));
}

export function Sparkline({
  data,
  width = 96,
  height = 28,
  tone = "neutral",
  showArea = false,
  showEndDot = false,
  className,
  "aria-label": ariaLabel,
}: SparklineProps): React.JSX.Element {
  const values = toYValues(data);
  const stroke = toneStroke(tone);

  // Padding keeps the stroke + end dot inside the viewBox (nothing clipped).
  const dotR = 2.5;
  const pad = (showEndDot ? dotR : 0) + 1;

  const computedAria =
    ariaLabel ?? (values.length ? `Trend, ${values.length} points, latest ${values[values.length - 1]}` : "No data");

  if (values.length === 0) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={computedAria}
        className={cn("overflow-visible", className)}
      >
        <line
          x1={pad}
          y1={height / 2}
          x2={width - pad}
          y2={height / 2}
          stroke="var(--muted)"
          strokeWidth={1}
          strokeDasharray="2 2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const innerW = Math.max(1, width - pad * 2);
  const innerH = Math.max(1, height - pad * 2);

  const x = (i: number) => (values.length === 1 ? width / 2 : pad + (i / (values.length - 1)) * innerW);
  const y = (v: number) => pad + innerH - ((v - min) / span) * innerH;

  const points = values.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  const lastX = x(values.length - 1);
  const lastY = y(values[values.length - 1]);

  const areaPath =
    showArea && values.length > 1
      ? `M ${x(0).toFixed(2)},${height} L ${values.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" L ")} L ${lastX.toFixed(2)},${height} Z`
      : null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={computedAria}
      className={cn("overflow-visible", className)}
      preserveAspectRatio="none"
    >
      {areaPath && <path d={areaPath} fill={stroke} fillOpacity={0.12} stroke="none" />}
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {showEndDot && <circle cx={lastX} cy={lastY} r={dotR} fill={stroke} />}
    </svg>
  );
}

export default Sparkline;
