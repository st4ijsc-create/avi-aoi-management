import { Line, LineChart, ResponsiveContainer } from "recharts"

import { useChartTokens } from "@/theme/chartTokens"

interface SparklineProps {
  data: number[]
  color?: string
  height?: number
  className?: string
}

/**
 * Minimal Recharts line, no axes/grid/tooltip — a "vital signs" read, not a chart to inspect.
 * Guards Recharts' awkward handling of 0-1 point series: renders a flat muted rule instead of an
 * empty/broken plot when there isn't enough data yet (fresh machine, fleet just started).
 *
 * Default `color` resolves per-theme (`useChartTokens().line`) rather than a hardcoded navy-600 —
 * navy-600 on a dark navy-900/800 card is nearly invisible, a real dark-mode gap this closes.
 */
export function Sparkline({ data, color, height = 32, className }: SparklineProps) {
  const chartTokens = useChartTokens()
  const lineColor = color ?? chartTokens.line

  if (data.length < 2) {
    return (
      <div
        className={className}
        style={{ height }}
        aria-hidden="true"
      >
        <div className="h-full w-full flex items-center">
          <div className="h-px w-full bg-border" />
        </div>
      </div>
    )
  }

  const points = data.map((v, i) => ({ i, v }))

  return (
    <div className={className} style={{ height }} aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        {/* accessibilityLayer defaults to true in this Recharts version, rendering a focusable
            keyboard-navigation overlay — wrong here since the whole chart is aria-hidden (purely
            decorative; the real numbers are already text elsewhere in the card). Disabling it keeps
            no focusable node inside an aria-hidden subtree (axe: aria-hidden-focus). */}
        <LineChart
          data={points}
          margin={{ top: 3, right: 2, bottom: 3, left: 2 }}
          accessibilityLayer={false}
        >
          <Line
            type="monotone"
            dataKey="v"
            stroke={lineColor}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
