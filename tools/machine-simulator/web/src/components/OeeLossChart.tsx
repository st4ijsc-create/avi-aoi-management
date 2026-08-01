import * as React from "react"
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis, type TooltipContentProps } from "recharts"

import { useT } from "@/i18n"
import { useChartTokens, type ChartTokens } from "@/theme/chartTokens"

export interface OeeLossChartProps {
  downtimeLossSeconds: number
  speedLossSeconds: number
  qualityLossSeconds: number
  className?: string
}

interface LossBar {
  key: "downtime" | "speed" | "quality"
  label: string
  seconds: number
  minutes: number
}

const SECONDS_PER_MINUTE = 60

/**
 * Task 13 (WS-A) — the OEE Reports screen's loss breakdown. Deliberately EXACTLY three buckets —
 * Downtime / Speed / Quality — mirroring `OeeCalculator.cs`'s own doc comment: reason codes (why a
 * machine was down, why a cycle ran slow) don't exist yet in this build, so inventing a finer split
 * (the "Six Big Losses" framework some OEE literature uses) would mean guessing at a classification
 * the domain hasn't defined. Every label in this component says "3" / names the three buckets
 * explicitly, never "six" — see `i18n/vi.ts`'s/`en.ts`'s own `reports.lossChart.*` copy.
 */
function buildBars(t: (key: string, vars?: Record<string, string | number>) => string, props: OeeLossChartProps): LossBar[] {
  const clamp = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0)
  const raw: Array<{ key: LossBar["key"]; label: string; seconds: number }> = [
    { key: "downtime", label: t("reports.lossChart.downtime"), seconds: clamp(props.downtimeLossSeconds) },
    { key: "speed", label: t("reports.lossChart.speed"), seconds: clamp(props.speedLossSeconds) },
    { key: "quality", label: t("reports.lossChart.quality"), seconds: clamp(props.qualityLossSeconds) },
  ]
  return raw.map((bar) => ({ ...bar, minutes: bar.seconds / SECONDS_PER_MINUTE }))
}

/** Same "colored dot for identification, AA-safe body text for content" tooltip idiom
 * `TelemetryChart.tsx`'s own custom tooltip documents — replaces Recharts' default per-item text
 * color (measured under AA elsewhere in this app). */
function buildLossTooltip(t: (key: string, vars?: Record<string, string | number>) => string, chartTokens: ChartTokens, colorOf: (key: string) => string) {
  return function LossTooltip({ active, payload }: TooltipContentProps) {
    if (!active || !payload || payload.length === 0) return null
    const point = payload[0]?.payload as LossBar | undefined
    if (!point) return null
    return (
      <div
        className="rounded-lg border px-3 py-2 text-xs"
        style={{ backgroundColor: chartTokens.surfaceCard, borderColor: chartTokens.border, boxShadow: "var(--shadow-md)" }}
      >
        <div className="flex items-center gap-1.5">
          <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: colorOf(point.key) }} aria-hidden="true" />
          <span className="font-semibold text-text-strong">{point.label}</span>
        </div>
        <p className="font-numeric mt-1 text-text-body">
          {t("reports.lossChart.tooltipMinutes", { minutes: point.minutes.toFixed(1) })}
        </p>
        <p className="font-numeric text-[11px] text-text-muted">
          {t("reports.lossChart.tooltipSeconds", { seconds: Math.round(point.seconds) })}
        </p>
      </div>
    )
  }
}

/** Honest 3-bucket OEE loss chart (Downtime / Speed / Quality, in minutes) — models `TelemetryChart`/
 * `SpcChart`'s own recharts-wrapper + `useChartTokens()` theme-color pattern. One neutral, non-status
 * color per bucket (`chartTokens.chartSeries`, the same categorical palette `TelemetryChart` cycles
 * through) — NOT the status ramp (spec §2: reserved for machine STATE), since "how much was lost to
 * each bucket" is a data classification, not a fault/ok reading. */
export function OeeLossChart({ downtimeLossSeconds, speedLossSeconds, qualityLossSeconds, className }: OeeLossChartProps) {
  const t = useT()
  const chartTokens = useChartTokens()
  const bars = React.useMemo(
    () => buildBars(t, { downtimeLossSeconds, speedLossSeconds, qualityLossSeconds }),
    [t, downtimeLossSeconds, speedLossSeconds, qualityLossSeconds]
  )
  const colorOf = React.useCallback(
    (key: string) => chartTokens.chartSeries[bars.findIndex((b) => b.key === key) % chartTokens.chartSeries.length],
    [chartTokens, bars]
  )
  const LossTooltip = React.useMemo(() => buildLossTooltip(t, chartTokens, colorOf), [t, chartTokens, colorOf])
  const totalMinutes = bars.reduce((sum, b) => sum + b.minutes, 0)

  return (
    <div className={className}>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={bars} margin={{ top: 8, right: 16, bottom: 0, left: -12 }}>
            <CartesianGrid vertical={false} stroke={chartTokens.border} strokeDasharray="3 3" />
            <XAxis
              dataKey="label"
              tick={{ fill: chartTokens.textMuted, fontSize: 11 }}
              axisLine={{ stroke: chartTokens.border }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: chartTokens.textMuted, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={44}
              label={{
                value: t("reports.lossChart.yAxisLabel"),
                angle: -90,
                position: "insideLeft",
                fill: chartTokens.textMuted,
                fontSize: 11,
              }}
              tickFormatter={(v: number) => v.toFixed(0)}
            />
            <RechartsTooltip content={LossTooltip} />
            <Bar dataKey="minutes" isAnimationActive={false} radius={[2, 2, 0, 0]} maxBarSize={96}>
              {bars.map((bar) => (
                <Cell key={bar.key} fill={colorOf(bar.key)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
        <div className="flex flex-wrap items-center gap-4 text-xs text-text-muted">
          {bars.map((bar) => (
            <span key={bar.key} className="flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ backgroundColor: colorOf(bar.key) }} aria-hidden="true" />
              <span className="font-medium text-text-body">{bar.label}</span>
              <span className="font-numeric">{t("reports.lossChart.minutesShort", { minutes: bar.minutes.toFixed(1) })}</span>
            </span>
          ))}
        </div>
        <span className="font-numeric text-xs font-medium text-text-strong">
          {t("reports.lossChart.total", { minutes: totalMinutes.toFixed(1) })}
        </span>
      </div>
    </div>
  )
}
