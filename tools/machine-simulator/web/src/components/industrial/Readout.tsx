import * as React from "react"

import { cn } from "@/lib/utils"

export type ReadoutTone = "run" | "warn" | "fault" | "idle" | "neutral"

const TONE_TEXT: Record<ReadoutTone, string> = {
  run: "text-ok-text",
  warn: "text-warn-text",
  fault: "text-danger-text",
  idle: "text-text-muted",
  neutral: "text-text-strong",
}

const TONE_RING: Record<ReadoutTone, string> = {
  run: "var(--color-status-run)",
  warn: "var(--color-status-warn)",
  fault: "var(--color-status-fault)",
  idle: "var(--color-status-idle)",
  neutral: "var(--color-accent)",
}

export interface ReadoutProps {
  /** The big tabular numeral. Pass a pre-formatted string (caller owns precision/locale). */
  value: React.ReactNode
  unit?: React.ReactNode
  /** Micro-label caption, active-language text. */
  label: React.ReactNode
  /** Micro-label caption, gloss (other language). */
  labelEn?: React.ReactNode
  /** Small note under the numeral — trend, timestamp, qualifier. */
  sub?: React.ReactNode
  tone?: ReadoutTone
  /** 0–100 — renders a small donut gauge beside the numeral instead of nothing. */
  gaugePct?: number
  /**
   * `"numeric"` (default) keeps the full tabular-numeral display size — a measurement the operator
   * reads at a glance. `"text"` is for enum/string values (status words, driver names, config
   * state, a product name, a defect code) that can run arbitrarily long — H2b: these previously
   * rendered at the same 38px display size as a number and wrapped to 2–3 lines, breaking the grid.
   * `"text"` renders condensed, single-line, truncated with an accessible full value (`title` +
   * `aria-label` carry the untruncated string — CSS `truncate` only hides it visually).
   */
  valueType?: "numeric" | "text"
  className?: string
}

/** Big tabular-numeral readout — the KPI/measurement primitive (spec §5). Optional donut gauge for
 * a percentage reading (yield, pass rate, …); omit `gaugePct` for a plain numeric readout. */
export function Readout({
  value,
  unit,
  label,
  labelEn,
  sub,
  tone = "neutral",
  gaugePct,
  valueType = "numeric",
  className,
}: ReadoutProps) {
  const isText = valueType === "text"
  // Only a plain string can be truncated/title-attributed sensibly — a ReactNode value (rare, none
  // of today's callers) just renders as-is at the text size.
  const fullText = typeof value === "string" ? value : undefined

  return (
    <div className={cn("flex items-center gap-4", className)}>
      {gaugePct !== undefined ? <DonutGauge pct={gaugePct} tone={tone} /> : null}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span
            // `hmi-readout-value` — a stable hook the HMI visual-regression baseline masks (H2b):
            // this is the one part of a Readout tile that's genuinely live (a cycle count, a
            // status word, a defect code) and expected to differ run-to-run; everything else in the
            // tile (border, dividers, micro-labels) is structural and should stay UNmasked so a
            // layout regression is actually caught by the pixel diff.
            className={cn(
              "hmi-readout-value font-heading font-semibold tabular-nums",
              isText ? "block max-w-full truncate text-[19px] leading-[1.15]" : "text-[38px] leading-[1.05]",
              TONE_TEXT[tone]
            )}
            title={isText ? fullText : undefined}
            aria-label={isText && fullText ? fullText : undefined}
          >
            {value}
          </span>
          {unit ? <span className="hmi-micro pb-1 normal-case">{unit}</span> : null}
        </div>
        {/* H2c: flex items default to `min-width: auto` (content-sized), which blocks shrinking —
            without `min-w-0` on EACH span, a long primary label (e.g. Vietnamese "TRẠNG THÁI CẤU
            HÌNH") couldn't compress and wrapped to a second line in the narrowest tiles at 1280px
            instead of truncating. Primary label gets the remaining space and truncates; the gloss
            stays fixed-width (won't itself wrap) and is the first thing dropped when space is tight. */}
        <div className="mt-1 flex min-w-0 items-baseline gap-1.5 overflow-hidden">
          <span className="hmi-micro min-w-0 flex-1 truncate">{label}</span>
          {labelEn ? <span className="hmi-micro shrink-0 truncate text-text-muted/70">{labelEn}</span> : null}
        </div>
        {sub ? <div className="mt-0.5 truncate text-[11px] text-text-muted">{sub}</div> : null}
      </div>
    </div>
  )
}

function DonutGauge({ pct, tone }: { pct: number; tone: ReadoutTone }) {
  const clamped = Math.max(0, Math.min(100, pct))
  const r = 22
  const c = 2 * Math.PI * r
  const filled = (clamped / 100) * c
  return (
    <svg
      width="56"
      height="56"
      viewBox="0 0 56 56"
      className="hmi-readout-value shrink-0"
      role="img"
      aria-label={`${Math.round(clamped)}%`}
    >
      <circle cx="28" cy="28" r={r} fill="none" stroke="var(--color-divider)" strokeWidth="4" />
      <circle
        cx="28"
        cy="28"
        r={r}
        fill="none"
        stroke={TONE_RING[tone]}
        strokeWidth="4"
        strokeDasharray={`${filled} ${c - filled}`}
        strokeLinecap="butt"
        transform="rotate(-90 28 28)"
      />
      <text
        x="28"
        y="31"
        textAnchor="middle"
        className="tabular-nums"
        style={{ fontFamily: "var(--font-heading)", fontSize: 13, fontWeight: 600, fill: "var(--color-text)" }}
      >
        {Math.round(clamped)}
      </text>
    </svg>
  )
}
