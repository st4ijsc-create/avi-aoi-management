import * as React from "react"
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts"

import { useT } from "@/i18n"
import type { TelemetrySeries } from "@/lib/api"
import { formatMetric } from "@/lib/utils"
import { useChartTokens, type ChartTokens } from "@/theme/chartTokens"

interface TelemetryChartProps {
  series: TelemetrySeries[]
  className?: string
}

const RAW_SUFFIX = "__raw"

/**
 * Merges N independently-trimmed value windows into one index-aligned row set, one row per sample
 * index, AND min-max normalizes each metric to its own [0, 1] range for the shared Y axis.
 *
 * IoT machines report physically unlike metrics on one chart (a temperature in °C, a humidity in %,
 * a current in A — this build's `iot-sensor` mapping profile reports exactly this trio) — plotting
 * their raw values on one shared linear axis was tried first and looked broken (verified live: a
 * ~1.3A current line and a ~26°C temperature line both read as a flat near-zero smear next to a
 * ~63%-humidity line dominating the scale), even though the chart was rendering correctly. Per-series
 * normalization is the standard fix multi-metric trend widgets use (Grafana's "normalize Y axis",
 * Datadog's auto-scale-per-series) — each line shows its OWN shape clearly; the actual unit-ed value
 * is preserved under a `${metric}__raw` field for the tooltip/legend to read instead of the
 * normalized value, so nothing observable to the user is ever a 0–1 fraction.
 *
 * `MachineState` trims each metric's series to the same cap but different metrics can have started
 * (and so filled up) at different cycles, so lengths legitimately differ; missing cells are left
 * `undefined` and `connectNulls` bridges the gap rather than drawing a line down to 0.
 */
function buildChartRows(series: TelemetrySeries[]): Array<Record<string, number | undefined>> {
  const maxLen = Math.max(0, ...series.map((s) => s.values.length))
  const ranges = series.map((s) => {
    const min = Math.min(...s.values)
    const max = Math.max(...s.values)
    return { min, span: Math.max(max - min, 1e-9) }
  })

  return Array.from({ length: maxLen }, (_, i) => {
    const row: Record<string, number | undefined> = { i: i + 1 }
    series.forEach((s, si) => {
      const raw = s.values[i]
      row[`${s.metric}${RAW_SUFFIX}`] = raw
      row[s.metric] = raw === undefined ? undefined : (raw - ranges[si].min) / ranges[si].span
    })
    return row
  })
}

/**
 * Custom tooltip content — replaces Recharts' default, which colors each item's NAME/VALUE text in
 * that series' own line color (`accent-500`, one of `chartSeries`' entries, measured well under AA
 * 4.5:1 on white — axe `color-contrast`, confirmed live). Follows this app's established "colored dot
 * for identification, AA-safe body text for content" split (same pattern as `StatusBadge`/`TraceTable`)
 * instead of a blanket single text color, which would lose the at-a-glance series-to-line mapping a
 * multi-line tooltip needs.
 */
function buildTelemetryTooltip(t: (key: string, vars?: Record<string, string | number>) => string, chartTokens: ChartTokens) {
  return function TelemetryTooltip({ active, payload, label }: TooltipContentProps) {
    if (!active || !payload || payload.length === 0) return null
    return (
      <div
        className="rounded-lg border px-3 py-2 text-xs"
        style={{ backgroundColor: chartTokens.surfaceCard, borderColor: chartTokens.border, boxShadow: "var(--shadow-md)" }}
      >
        <p className="mb-1 font-semibold text-text-strong">{t("telemetryChart.tooltipSample", { sample: String(label) })}</p>
        <div className="flex flex-col gap-1">
          {payload.map((entry) => {
            const rawKey = `${String(entry.dataKey ?? entry.name)}${RAW_SUFFIX}`
            const raw = (entry.payload as Record<string, number | undefined> | undefined)?.[rawKey]
            return (
              <div key={String(entry.dataKey)} className="flex items-center gap-1.5">
                <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: entry.color }} aria-hidden="true" />
                <span className="text-text-body">{entry.name}</span>
                <span className="font-numeric ml-auto font-medium text-text-strong">
                  {raw === undefined ? "—" : formatMetric(raw)}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    )
  }
}

/** Multi-line telemetry chart for IoT machines — one line per reported metric on a shared, per-series
 * normalized axis (see `buildChartRows` doc comment for why), the theme's `chartSeries` palette
 * cycling by declaration order so the same metric keeps the same color across a session even as new
 * metrics appear. */
export function TelemetryChart({ series, className }: TelemetryChartProps) {
  const t = useT()
  const chartTokens = useChartTokens()
  const data = React.useMemo(() => buildChartRows(series), [series])
  const hasData = series.some((s) => s.values.length > 0)
  // Custom tooltip content — replaces Recharts' default, which colors each item's NAME/VALUE text in
  // that series' own line color (measured well under AA 4.5:1 on white — axe `color-contrast`,
  // confirmed live). Follows this app's established "colored dot for identification, AA-safe body
  // text for content" split (same pattern as `StatusBadge`/`TraceTable`). Rebuilt each render (closes
  // over the current `t`/`chartTokens`) — Recharts' `content` prop takes a fresh component/function
  // each render just fine, no stable identity required.
  const TelemetryTooltip = React.useMemo(() => buildTelemetryTooltip(t, chartTokens), [t, chartTokens])

  if (!hasData) {
    return (
      <div className={className}>
        <div className="flex h-72 items-center justify-center rounded-xl border border-dashed border-border bg-surface-subtle text-sm text-text-muted">
          {t("telemetryChart.noSamples")}
        </div>
      </div>
    )
  }

  return (
    <div className={className}>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -12 }}>
            <CartesianGrid vertical={false} stroke={chartTokens.border} strokeDasharray="3 3" />
            <XAxis
              dataKey="i"
              tick={{ fill: chartTokens.textMuted, fontSize: 11 }}
              axisLine={{ stroke: chartTokens.border }}
              tickLine={false}
              label={{ value: t("telemetryChart.xAxisLabel"), position: "insideBottom", offset: -2, fill: chartTokens.textMuted, fontSize: 11 }}
            />
            <YAxis
              domain={[0, 1]}
              tick={{ fill: chartTokens.textMuted, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={40}
              tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
            />
            <RechartsTooltip content={TelemetryTooltip} />
            {series.map((s, i) => (
              <Line
                key={s.metric}
                type="monotone"
                dataKey={s.metric}
                name={s.metric}
                stroke={chartTokens.chartSeries[i % chartTokens.chartSeries.length]}
                strokeWidth={2}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
        <div className="flex flex-wrap items-center gap-4 text-xs text-text-muted">
          {series.map((s, i) => {
            const last = s.values[s.values.length - 1]
            return (
              <span key={s.metric} className="flex items-center gap-1.5">
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: chartTokens.chartSeries[i % chartTokens.chartSeries.length] }}
                  aria-hidden="true"
                />
                <span className="font-medium text-text-body">{s.metric}</span>
                {last !== undefined ? <span className="font-numeric">{formatMetric(last)}</span> : null}
              </span>
            )
          })}
        </div>
        {series.length > 1 ? (
          <span className="text-[11px] text-text-muted italic">{t("telemetryChart.perSeriesNote")}</span>
        ) : null}
      </div>
    </div>
  )
}
