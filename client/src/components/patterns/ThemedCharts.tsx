/**
 * DS Wave 2 — Themed recharts wrappers (doc 23 §F3 follow-on).
 * ============================================================================
 * Pages pass DATA + series keys and get an on-brand, theme-correct chart with
 * ZERO colour decisions. Every colour, grid, axis and tooltip style is sourced
 * from the design-token helpers in `./chartTokens` (which resolve `var(--chart-N)`
 * / `var(--border)` / `var(--card)` at paint time), so charts flip correctly
 * between the light and dark token sets without any JS.
 *
 * Why this exists: today pages inline hardcoded hex (`#10b981`, `#3b82f6`, …)
 * straight into recharts, which breaks dark mode and lets charts drift off the
 * brand palette. These wrappers wrap `ResponsiveContainer` + the recharts chart
 * so a page never makes a colour choice again.
 *
 * All wrappers:
 *   • wrap the chart in `<ResponsiveContainer width="100%" height={height}>`
 *   • apply `chartGridProps` / `chartAxisProps` / `chartAxisTick` /
 *     `chartTooltipStyle` / `chartTooltipLabelStyle` from `./chartTokens`
 *   • colour series `i` from `series[i].color ?? chartColor(i)`
 *   • render a centred muted empty state (`emptyText`, default "No data") when
 *     there is nothing to draw, instead of an empty chart frame
 *   • expose `role="img"` + an `aria-label` on the container (the recharts SVG is
 *     not screen-reader friendly, so the label is the accessible description)
 *
 * @example
 * // A 2-series line chart from monthly quality data:
 * const rows = [
 *   { month: "Jan", ng: 12, yield: 98.1 },
 *   { month: "Feb", ng: 8,  yield: 98.9 },
 *   { month: "Mar", ng: 15, yield: 97.4 },
 * ];
 * <ThemedLineChart
 *   data={rows}
 *   xKey="month"
 *   series={[
 *     { key: "ng",    name: "NG count" },
 *     { key: "yield", name: "Yield %", color: chartColor(2) },
 *   ]}
 *   yTickFormatter={(v) => v.toLocaleString()}
 *   aria-label="Monthly NG count and yield"
 * />
 */
import * as React from "react";
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart as RePieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ReTooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

import { cn } from "@/lib/utils";
import {
  chartColor,
  chartTooltipStyle,
  chartTooltipLabelStyle,
  chartGridProps,
  chartAxisTick,
  chartAxisProps,
} from "./chartTokens";

/** One measure (series) to plot from the row objects. */
export interface ChartSeries {
  /** dataKey in the row objects. */
  key: string;
  /** legend/tooltip label (default = `key`). */
  name?: string;
  /** optional colour override; default = `chartColor(index)`. */
  color?: string;
}

/** Shared props for the cartesian charts (line / area / bar). */
export interface BaseChartProps {
  data: Array<Record<string, unknown>>;
  /** category/time axis dataKey. */
  xKey: string;
  /** one or more measures. */
  series: ChartSeries[];
  /** pixel height of the chart (default 300). */
  height?: number;
  /** draw the cartesian grid (default true). */
  showGrid?: boolean;
  /** draw the legend (default = `series.length > 1`). */
  showLegend?: boolean;
  /** draw the hover tooltip (default true). */
  showTooltip?: boolean;
  className?: string;
  yTickFormatter?: (v: number) => string;
  xTickFormatter?: (v: unknown) => string;
  /** shown when there is nothing to draw (English default "No data"). */
  emptyText?: string;
  "aria-label"?: string;
}

const DEFAULT_HEIGHT = 300;

/**
 * True when there is no meaningful data to draw — either no rows, or none of the
 * requested series keys appears with a non-nullish value in any row.
 */
function isEmpty(data: Array<Record<string, unknown>>, keys: string[]): boolean {
  if (!Array.isArray(data) || data.length === 0) return true;
  if (keys.length === 0) return true;
  return !data.some((row) => keys.some((k) => row?.[k] != null));
}

/**
 * Shared frame: sizes the container, tags it for a11y (`role="img"` +
 * `aria-label`) and renders the centred empty state when `empty` is true.
 * `tabular-nums` keeps axis/tooltip figures aligned.
 */
function ChartFrame({
  height,
  className,
  ariaLabel,
  empty,
  emptyText,
  children,
}: {
  height: number;
  className?: string;
  ariaLabel: string;
  empty: boolean;
  emptyText: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      role="img"
      aria-label={ariaLabel}
      className={cn("w-full tabular-nums", className)}
      style={{ height }}
    >
      {empty ? (
        <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
          {emptyText}
        </div>
      ) : (
        children
      )}
    </div>
  );
}

/** Standard cartesian axes + grid + tooltip + legend, shared by all 3 wrappers. */
function CartesianDecorations({
  xKey,
  series,
  showGrid,
  showLegend,
  showTooltip,
  xTickFormatter,
  yTickFormatter,
  horizontal,
}: {
  xKey: string;
  series: ChartSeries[];
  showGrid: boolean;
  showLegend: boolean;
  showTooltip: boolean;
  xTickFormatter?: (v: unknown) => string;
  yTickFormatter?: (v: number) => string;
  /** when true (horizontal bars) the category axis is Y and the value axis is X. */
  horizontal?: boolean;
}): React.JSX.Element {
  // recharts accepts a `(value) => string` tickFormatter; its own type is loose.
  const catFormatter = xTickFormatter as ((v: unknown) => string) | undefined;
  const valFormatter = yTickFormatter as ((v: number) => string) | undefined;

  const categoryAxis = horizontal ? (
    <YAxis type="category" dataKey={xKey} {...chartAxisProps} tickFormatter={catFormatter} />
  ) : (
    <XAxis dataKey={xKey} {...chartAxisProps} tickFormatter={catFormatter} />
  );
  const valueAxis = horizontal ? (
    <XAxis type="number" {...chartAxisProps} tickFormatter={valFormatter} />
  ) : (
    <YAxis {...chartAxisProps} tickFormatter={valFormatter} />
  );

  return (
    <>
      {showGrid ? <CartesianGrid {...chartGridProps} /> : null}
      {categoryAxis}
      {valueAxis}
      {showTooltip ? (
        <ReTooltip contentStyle={chartTooltipStyle} labelStyle={chartTooltipLabelStyle} itemStyle={chartTooltipLabelStyle} />
      ) : null}
      {showLegend ? <Legend wrapperStyle={{ fontSize: "0.75rem" }} /> : null}
      {/* Series marks are provided by each chart via children after this fragment. */}
    </>
  );
}

/** Resolve the effective flags shared by the cartesian wrappers. */
function useCartesianConfig(props: BaseChartProps) {
  const height = props.height ?? DEFAULT_HEIGHT;
  const showGrid = props.showGrid ?? true;
  const showTooltip = props.showTooltip ?? true;
  const showLegend = props.showLegend ?? props.series.length > 1;
  const emptyText = props.emptyText ?? "No data";
  const keys = props.series.map((s) => s.key);
  const empty = isEmpty(props.data, keys);
  const ariaLabel = props["aria-label"] ?? `Chart of ${keys.join(", ") || "data"}`;
  return { height, showGrid, showTooltip, showLegend, emptyText, empty, ariaLabel };
}

// ── Themed line chart ───────────────────────────────────────────────────────
export function ThemedLineChart(props: BaseChartProps): React.JSX.Element {
  const cfg = useCartesianConfig(props);
  return (
    <ChartFrame
      height={cfg.height}
      className={props.className}
      ariaLabel={cfg.ariaLabel}
      empty={cfg.empty}
      emptyText={cfg.emptyText}
    >
      <ResponsiveContainer width="100%" height={cfg.height}>
        <LineChart data={props.data} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
          <CartesianDecorations
            xKey={props.xKey}
            series={props.series}
            showGrid={cfg.showGrid}
            showLegend={cfg.showLegend}
            showTooltip={cfg.showTooltip}
            xTickFormatter={props.xTickFormatter}
            yTickFormatter={props.yTickFormatter}
          />
          {props.series.map((s, i) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name ?? s.key}
              stroke={s.color ?? chartColor(i)}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

// ── Themed area chart ───────────────────────────────────────────────────────
export function ThemedAreaChart(props: BaseChartProps & { stacked?: boolean }): React.JSX.Element {
  const cfg = useCartesianConfig(props);
  const stackId = props.stacked ? "stack" : undefined;
  return (
    <ChartFrame
      height={cfg.height}
      className={props.className}
      ariaLabel={cfg.ariaLabel}
      empty={cfg.empty}
      emptyText={cfg.emptyText}
    >
      <ResponsiveContainer width="100%" height={cfg.height}>
        <AreaChart data={props.data} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
          <defs>
            {props.series.map((s, i) => {
              const c = s.color ?? chartColor(i);
              return (
                <linearGradient key={s.key} id={`themed-area-${s.key}-${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={c} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={c} stopOpacity={0.04} />
                </linearGradient>
              );
            })}
          </defs>
          <CartesianDecorations
            xKey={props.xKey}
            series={props.series}
            showGrid={cfg.showGrid}
            showLegend={cfg.showLegend}
            showTooltip={cfg.showTooltip}
            xTickFormatter={props.xTickFormatter}
            yTickFormatter={props.yTickFormatter}
          />
          {props.series.map((s, i) => {
            const c = s.color ?? chartColor(i);
            return (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.name ?? s.key}
                stackId={stackId}
                stroke={c}
                strokeWidth={2}
                fill={`url(#themed-area-${s.key}-${i})`}
              />
            );
          })}
        </AreaChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

// ── Themed bar chart ────────────────────────────────────────────────────────
export function ThemedBarChart(
  props: BaseChartProps & { stacked?: boolean; horizontal?: boolean },
): React.JSX.Element {
  const cfg = useCartesianConfig(props);
  const stackId = props.stacked ? "stack" : undefined;
  const horizontal = props.horizontal ?? false;
  // radius: rounded on the "end" of each bar; direction depends on orientation.
  const vRadius: [number, number, number, number] = [3, 3, 0, 0];
  const hRadius: [number, number, number, number] = [0, 3, 3, 0];
  return (
    <ChartFrame
      height={cfg.height}
      className={props.className}
      ariaLabel={cfg.ariaLabel}
      empty={cfg.empty}
      emptyText={cfg.emptyText}
    >
      <ResponsiveContainer width="100%" height={cfg.height}>
        <BarChart
          data={props.data}
          layout={horizontal ? "vertical" : "horizontal"}
          margin={{ top: 8, right: 12, bottom: 4, left: horizontal ? 8 : -8 }}
        >
          <CartesianDecorations
            xKey={props.xKey}
            series={props.series}
            showGrid={cfg.showGrid}
            showLegend={cfg.showLegend}
            showTooltip={cfg.showTooltip}
            xTickFormatter={props.xTickFormatter}
            yTickFormatter={props.yTickFormatter}
            horizontal={horizontal}
          />
          {props.series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.name ?? s.key}
              stackId={stackId}
              fill={s.color ?? chartColor(i)}
              radius={horizontal ? hRadius : vRadius}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

// ── Themed pie / donut chart ────────────────────────────────────────────────
export interface ThemedPieChartProps {
  data: Array<{ name: string; value: number; color?: string }>;
  height?: number;
  /** render as a donut (inner radius) — default true. */
  donut?: boolean;
  showLegend?: boolean;
  valueFormatter?: (v: number) => string;
  className?: string;
  "aria-label"?: string;
}

export function ThemedPieChart(props: ThemedPieChartProps): React.JSX.Element {
  const height = props.height ?? DEFAULT_HEIGHT;
  const donut = props.donut ?? true;
  const showLegend = props.showLegend ?? true;
  const emptyText = "No data";
  const empty =
    !Array.isArray(props.data) || props.data.length === 0 || !props.data.some((d) => d?.value != null && d.value !== 0);
  const ariaLabel = props["aria-label"] ?? "Distribution chart";
  // recharts' tooltip formatter is typed loosely; wrap the caller's numeric one.
  const tooltipFormatter = props.valueFormatter
    ? ((value: number) => props.valueFormatter?.(value) ?? String(value))
    : undefined;

  return (
    <ChartFrame
      height={height}
      className={props.className}
      ariaLabel={ariaLabel}
      empty={empty}
      emptyText={emptyText}
    >
      <ResponsiveContainer width="100%" height={height}>
        <RePieChart>
          {props.valueFormatter ? (
            <ReTooltip
              contentStyle={chartTooltipStyle}
              labelStyle={chartTooltipLabelStyle}
              itemStyle={chartTooltipLabelStyle}
              formatter={tooltipFormatter as unknown as (value: number) => string}
            />
          ) : (
            <ReTooltip contentStyle={chartTooltipStyle} labelStyle={chartTooltipLabelStyle} itemStyle={chartTooltipLabelStyle} />
          )}
          {showLegend ? <Legend wrapperStyle={{ fontSize: "0.75rem" }} /> : null}
          <Pie
            data={props.data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={donut ? "55%" : 0}
            outerRadius="80%"
            paddingAngle={donut ? 2 : 0}
            stroke="var(--card)"
          >
            {props.data.map((d, i) => (
              <Cell key={`${d.name}-${i}`} fill={d.color ?? chartColor(i)} />
            ))}
          </Pie>
        </RePieChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
