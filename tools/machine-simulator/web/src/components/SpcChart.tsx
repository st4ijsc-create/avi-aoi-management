import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts"

import { useT } from "@/i18n"
import { formatMetric } from "@/lib/utils"
import { useChartTokens } from "@/theme/chartTokens"

const HISTOGRAM_BINS = 8

interface SpcChartProps {
  values: number[]
  mean: number
  ucl: number
  lcl: number
  className?: string
}

interface ChartPoint {
  cycle: number
  v: number
}

function buildHistogram(values: number[], domainMin: number, domainMax: number) {
  const span = Math.max(domainMax - domainMin, 1e-9)
  const binWidth = span / HISTOGRAM_BINS
  const bins = Array.from({ length: HISTOGRAM_BINS }, (_, i) => ({
    bin: domainMin + binWidth * (i + 0.5),
    count: 0,
  }))
  for (const v of values) {
    const idx = Math.max(0, Math.min(HISTOGRAM_BINS - 1, Math.floor((v - domainMin) / binWidth)))
    bins[idx].count += 1
  }
  return bins
}

function StatReadout({ label, value, tone }: { label: string; value: number; tone?: "danger" }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-semibold tracking-wide text-text-muted uppercase">{label}</span>
      <span className={`font-numeric text-sm font-semibold ${tone === "danger" ? "text-danger-text" : "text-text-strong"}`}>
        {formatMetric(value)}
      </span>
    </div>
  )
}

/**
 * I-MR-style individuals control chart: `values` plotted against cycle index with mean/UCL/LCL
 * reference lines, a same-scale distribution histogram alongside (SPC software convention — Minitab/
 * InfinityQS pair a run chart with a capability histogram sharing the value axis), and points outside
 * the control limits picked out in danger red via a custom `dot` renderer on the `Line` itself —
 * that's the entire point of an individuals chart: which cycles, specifically, went out of control.
 *
 * Deliberately NOT a separate `Scatter` overlay for the out-of-control highlight (an earlier draft
 * used one): a `Scatter` fed its own filtered `data` array computes its point geometry independently
 * of the `Line`/`YAxis` it shares a chart with, and was observed — via live Playwright verification,
 * not just code review — to occasionally mis-plot against a collapsed/zero-inclusive domain instead
 * of the real `[domainMin, domainMax]`, producing a garbled axis. Coloring dots via the `Line`'s own
 * `dot` render prop reuses the exact same series/scale as the line, which cannot drift out of sync.
 */
export function SpcChart({ values, mean, ucl, lcl, className }: SpcChartProps) {
  const t = useT()
  const chartTokens = useChartTokens()

  if (values.length < 2) {
    return (
      <div className={className}>
        <div className="hmi-graph-paper flex h-72 items-center justify-center border border-border text-sm text-text-muted">
          {t("spcChart.waiting")}
        </div>
      </div>
    )
  }

  const data: ChartPoint[] = values.map((v, i) => ({ cycle: i + 1, v }))
  const outOfControl = data.filter((d) => d.v > ucl || d.v < lcl)

  const rawMin = Math.min(...values, lcl)
  const rawMax = Math.max(...values, ucl)
  const pad = Math.max((rawMax - rawMin) * 0.12, 1e-6)
  const domainMin = rawMin - pad
  const domainMax = rawMax + pad

  const histogram = buildHistogram(values, domainMin, domainMax)
  const maxCount = Math.max(...histogram.map((b) => b.count), 1)

  const latest = values[values.length - 1]

  // Closes over `ucl`/`lcl` — colors each rendered point red when it's outside the control limits,
  // the theme's line color otherwise. See the component doc comment above for why this replaced a
  // `Scatter` overlay.
  function renderValueDot(props: { cx?: number; cy?: number; value?: number }) {
    const { cx, cy, value } = props
    if (cx == null || cy == null || value == null) return null
    const flagged = value > ucl || value < lcl
    return (
      <circle
        key={`dot-${cx}-${cy}`}
        cx={cx}
        cy={cy}
        r={flagged ? 4 : 2.5}
        fill={flagged ? chartTokens.danger : chartTokens.line}
        stroke={chartTokens.surfaceCard}
        strokeWidth={flagged ? 1.5 : 0}
      />
    )
  }

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-6 pb-4">
        <StatReadout label={t("spcChart.latest")} value={latest} tone={latest > ucl || latest < lcl ? "danger" : undefined} />
        <StatReadout label={t("spcChart.mean")} value={mean} />
        <StatReadout label="UCL" value={ucl} />
        <StatReadout label="LCL" value={lcl} />
        {outOfControl.length > 0 ? (
          <span className="font-numeric ml-auto text-xs font-medium text-danger-text">
            {t("spcChart.outOfControl", { out: outOfControl.length, total: values.length })}
          </span>
        ) : (
          <span className="ml-auto text-xs font-medium text-ok-text">{t("spcChart.allWithinLimits")}</span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_140px]">
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -12 }}>
              <CartesianGrid vertical={false} stroke={chartTokens.border} strokeDasharray="3 3" />
              <XAxis
                dataKey="cycle"
                tick={{ fill: chartTokens.textMuted, fontSize: 11 }}
                axisLine={{ stroke: chartTokens.border }}
                tickLine={false}
                label={{ value: t("spcChart.xAxisLabel"), position: "insideBottom", offset: -2, fill: chartTokens.textMuted, fontSize: 11 }}
              />
              <YAxis
                domain={[domainMin, domainMax]}
                tick={{ fill: chartTokens.textMuted, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={44}
                tickFormatter={(v: number) => formatMetric(v)}
              />
              <RechartsTooltip
                contentStyle={{
                  backgroundColor: chartTokens.surfaceCard,
                  border: `1px solid ${chartTokens.border}`,
                  borderRadius: 0,
                  boxShadow: "none",
                  fontSize: 12,
                  color: chartTokens.textBody,
                }}
                labelStyle={{ color: chartTokens.textStrong, fontWeight: 600 }}
                labelFormatter={(v) => t("spcChart.tooltipCycle", { cycle: v })}
                formatter={(v) => [formatMetric(Number(v)), t("spcChart.tooltipValue")]}
              />
              <ReferenceLine
                y={mean}
                stroke={chartTokens.accent600}
                strokeDasharray="4 4"
                strokeWidth={1.5}
                label={{
                  value: t("spcChart.meanLabel", { value: formatMetric(mean) }),
                  position: "insideTopRight",
                  fill: chartTokens.accent600,
                  fontSize: 10,
                  fontWeight: 600,
                }}
              />
              <ReferenceLine
                y={ucl}
                stroke={chartTokens.danger}
                strokeDasharray="4 4"
                strokeWidth={1.5}
                label={{
                  value: t("spcChart.uclLabel", { value: formatMetric(ucl) }),
                  position: "insideBottomRight",
                  fill: chartTokens.danger,
                  fontSize: 10,
                  fontWeight: 600,
                }}
              />
              <ReferenceLine
                y={lcl}
                stroke={chartTokens.danger}
                strokeDasharray="4 4"
                strokeWidth={1.5}
                label={{
                  value: t("spcChart.lclLabel", { value: formatMetric(lcl) }),
                  position: "insideTopRight",
                  fill: chartTokens.danger,
                  fontSize: 10,
                  fontWeight: 600,
                }}
              />
              <Line
                type="monotone"
                dataKey="v"
                name={t("spcChart.tooltipValue")}
                stroke={chartTokens.line}
                strokeWidth={2}
                dot={renderValueDot}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={histogram} layout="vertical" margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <XAxis type="number" hide domain={[0, maxCount]} />
              <YAxis type="number" dataKey="bin" domain={[domainMin, domainMax]} hide />
              <Bar dataKey="count" fill={chartTokens.accent500} fillOpacity={0.55} radius={[0, 0, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 pt-1 text-xs text-text-muted">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ backgroundColor: chartTokens.line }} aria-hidden="true" />
          {t("spcChart.legend.value")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-3 rounded-full bg-accent-600" aria-hidden="true" />
          {t("spcChart.legend.mean")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-3 rounded-full bg-danger" aria-hidden="true" />
          UCL / LCL
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-accent-500/60" aria-hidden="true" />
          {t("spcChart.legend.distribution")}
        </span>
      </div>
    </div>
  )
}
