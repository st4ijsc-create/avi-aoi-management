/**
 * DS F0 — recharts theme helpers (doc 23 §F0).
 *
 * Single source of truth for chart colours + recharts style props, sourced from
 * the design tokens in `client/src/index.css` (`--chart-1..5`, `--card`,
 * `--border`, `--foreground`, `--muted-foreground`). Import these instead of
 * inlining hex palettes (`#10b981`, `#3b82f6`, …) so charts follow the theme and
 * flip correctly between the dark and light token sets.
 *
 * Colours are emitted as `var(--chart-N)` strings — recharts accepts any valid
 * CSS colour for `stroke` / `fill`, and CSS custom properties resolve at paint
 * time against the active `:root` / `.light` token set, so charts stay in sync
 * with the theme with zero JS.
 *
 * NOTE: the tokens are `oklch(...)` values, so refer to them as bare
 * `var(--token)` — NOT `hsl(var(--token))`. (Some legacy charts wrap them in
 * `hsl(...)`, which is a no-op fallback; F3 migrates those to these helpers.)
 *
 * These are inert constants (no React, no runtime side-effects) — safe to import
 * anywhere, including outside components.
 */
import type * as React from "react";

/**
 * Ordered categorical palette for series colours (`--chart-1` → `--chart-5`).
 * Cycle with modulo for >5 series: `chartColors[i % chartColors.length]`.
 */
export const chartColors: readonly string[] = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

/** Pick a series colour by index, wrapping past the end of the palette. */
export function chartColor(index: number): string {
  return chartColors[((index % chartColors.length) + chartColors.length) % chartColors.length];
}

/**
 * `contentStyle` for a recharts <Tooltip> — a card-surface popover with a themed
 * border and foreground text. Spread onto the Tooltip:
 *   <Tooltip contentStyle={chartTooltipStyle} />
 */
export const chartTooltipStyle: React.CSSProperties = {
  backgroundColor: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  color: "var(--foreground)",
  fontSize: "0.75rem",
};

/** Matching label/item colour for the tooltip body (spread onto labelStyle / itemStyle). */
export const chartTooltipLabelStyle: React.CSSProperties = {
  color: "var(--foreground)",
};

/**
 * Props for a recharts <CartesianGrid> — a subtle dashed grid using the border
 * token. Spread onto the grid:
 *   <CartesianGrid {...chartGridProps} />
 */
export const chartGridProps = {
  stroke: "var(--border)",
  strokeDasharray: "3 3",
} as const;

/**
 * `tick` style for recharts <XAxis> / <YAxis> — muted, small. Use as:
 *   <XAxis tick={chartAxisTick} />
 * (also exposes `chartAxisProps` with the axis line/tick-line colours).
 */
export const chartAxisTick: React.SVGProps<SVGTextElement> = {
  fill: "var(--muted-foreground)",
  fontSize: "0.75rem",
};

/** Common axis props (line + tick-line coloured to the border token). */
export const chartAxisProps = {
  tick: chartAxisTick,
  stroke: "var(--border)",
  tickLine: { stroke: "var(--border)" },
} as const;
