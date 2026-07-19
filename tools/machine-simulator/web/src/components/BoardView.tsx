import { CheckCircle2 } from "lucide-react"

import { useT } from "@/i18n"
import type { BoardPoint, BoardResult } from "@/lib/api"
import { cn } from "@/lib/utils"
import { useChartTokens, type ChartTokens } from "@/theme/chartTokens"
import { StatusBadge, type statusBadgeVariants } from "@/components/ui/status-badge"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import type { VariantProps } from "class-variance-authority"

/** Nominal board coordinate space every `Bbox` is expressed in — matches `AoiInspectorSim`'s own
 * `BoardWidthPx`/`BoardHeightPx` consts (1600×1200) and the WPF app's `Controls/BoardView.xaml`
 * default DPs; this build's simulator is the only AOI bbox source, so it's hardcoded rather than a
 * prop (a real inspection program at a different resolution would need this made configurable). */
const BOARD_WIDTH = 1600
const BOARD_HEIGHT = 1200

function resultColor(tokens: ChartTokens, result: BoardResult): string {
  if (result === "OK") return tokens.ok
  if (result === "NG") return tokens.danger
  return tokens.warn
}

type BadgeStatus = NonNullable<VariantProps<typeof statusBadgeVariants>["status"]>

const RESULT_BADGE_STATUS: Record<BoardResult, BadgeStatus> = {
  OK: "ok",
  NG: "danger",
  NTF: "warn",
}

interface BoardViewProps {
  points: BoardPoint[]
  className?: string
}

/**
 * AOI/AVI board — draws each measurement point's `Bbox` as a positioned rectangle over the fixed
 * `BOARD_WIDTH`×`BOARD_HEIGHT` coordinate space, red for NG / amber for NTF / green for OK, scaled
 * uniformly to the control via an SVG `viewBox` (the web analogue of the WPF app's `Viewbox`-wrapped
 * `Canvas`). Only points carrying a `bbox` draw anything — this build's simulator stamps one for NG
 * points only (see `AoiInspectorSim.BuildOkMeasurement`), so a board with zero defects renders as a
 * clean, empty surface plus a positive "no defects" affordance — that's the correct, expected render
 * for a passing cycle, not a missing-data state.
 */
export function BoardView({ points, className }: BoardViewProps) {
  const t = useT()
  const chartTokens = useChartTokens()

  if (points.length === 0) {
    return (
      <div className={className}>
        <div className="flex h-80 items-center justify-center rounded-xl border border-dashed border-border bg-surface-subtle text-sm text-text-muted">
          {t("boardView.waiting")}
        </div>
      </div>
    )
  }

  const withBbox = points.filter(
    (p): p is BoardPoint & { bbox: NonNullable<BoardPoint["bbox"]> } => p.bbox != null
  )
  const counts = points.reduce<Partial<Record<BoardResult, number>>>((acc, p) => {
    acc[p.result] = (acc[p.result] ?? 0) + 1
    return acc
  }, {})
  const isClean = withBbox.length === 0

  return (
    <TooltipProvider>
      <div className={cn("flex flex-col gap-3", className)}>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status="neutral">{t("boardView.pointsInspected", { count: points.length })}</StatusBadge>
          {(["NG", "NTF", "OK"] as const).map((r) =>
            counts[r] ? (
              <StatusBadge key={r} status={RESULT_BADGE_STATUS[r]}>
                {counts[r]} {r}
              </StatusBadge>
            ) : null
          )}
        </div>

        <div className="relative mx-auto w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-surface-subtle">
          <svg
            viewBox={`0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}`}
            className="h-auto w-full"
            role="img"
            aria-label={
              isClean
                ? t("boardView.ariaClean", { count: points.length })
                : t("boardView.ariaDefects", { defectCount: withBbox.length, total: points.length })
            }
          >
            <defs>
              <pattern id="board-grid" width="80" height="80" patternUnits="userSpaceOnUse">
                <path d="M 80 0 L 0 0 0 80" fill="none" stroke={chartTokens.border} strokeWidth={1} />
              </pattern>
            </defs>
            <rect width={BOARD_WIDTH} height={BOARD_HEIGHT} fill="url(#board-grid)" />

            {withBbox.map((p) => {
              const color = resultColor(chartTokens, p.result)
              const { x, y, w, h } = p.bbox
              const showLabel = w >= 70 && h >= 28

              return (
                <Tooltip key={p.pointCode}>
                  <TooltipTrigger
                    render={
                      <g
                        tabIndex={0}
                        role="button"
                        aria-label={`${p.pointCode} — ${p.result}${p.defectCode ? `, ${p.defectCode}` : ""}`}
                        className="cursor-pointer outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-600"
                      />
                    }
                  >
                    <rect
                      x={x}
                      y={y}
                      width={w}
                      height={h}
                      rx={4}
                      fill={color}
                      fillOpacity={0.14}
                      stroke={color}
                      strokeWidth={4}
                    />
                    {showLabel ? (
                      <text x={x + 6} y={y + 18} fontSize={15} fontWeight={700} fill={color}>
                        {p.pointCode}
                      </text>
                    ) : null}
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <div className="flex flex-col gap-0.5 text-left">
                      <span className="font-semibold">
                        {p.pointCode} · {p.result}
                      </span>
                      {p.defectCode ? <span className="text-background/75">{p.defectCode}</span> : null}
                    </div>
                  </TooltipContent>
                </Tooltip>
              )
            })}
          </svg>

          {isClean ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="flex items-center gap-2 rounded-full border border-ok/30 bg-surface-card/95 px-3 py-1.5 text-sm font-medium text-ok-text shadow-sm">
                <CheckCircle2 className="size-4" aria-hidden="true" />
                {t("boardView.cleanBoard")}
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs text-text-muted">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-danger" aria-hidden="true" />
            {t("boardView.legend.ng")}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-warn" aria-hidden="true" />
            {t("boardView.legend.ntf")}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-ok" aria-hidden="true" />
            OK
          </span>
        </div>
      </div>
    </TooltipProvider>
  )
}
