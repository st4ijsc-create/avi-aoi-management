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
  className?: string
}

/** Big tabular-numeral readout — the KPI/measurement primitive (spec §5). Optional donut gauge for
 * a percentage reading (yield, pass rate, …); omit `gaugePct` for a plain numeric readout. */
export function Readout({ value, unit, label, labelEn, sub, tone = "neutral", gaugePct, className }: ReadoutProps) {
  return (
    <div className={cn("flex items-center gap-4", className)}>
      {gaugePct !== undefined ? <DonutGauge pct={gaugePct} tone={tone} /> : null}
      <div className="min-w-0">
        <div className="flex items-baseline gap-1.5">
          <span className={cn("font-heading text-[38px] leading-[1.05] font-semibold tabular-nums", TONE_TEXT[tone])}>
            {value}
          </span>
          {unit ? <span className="hmi-micro pb-1 normal-case">{unit}</span> : null}
        </div>
        <div className="mt-1 flex items-baseline gap-1.5">
          <span className="hmi-micro">{label}</span>
          {labelEn ? <span className="hmi-micro text-text-muted/70">{labelEn}</span> : null}
        </div>
        {sub ? <div className="mt-0.5 text-[11px] text-text-muted">{sub}</div> : null}
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
    <svg width="56" height="56" viewBox="0 0 56 56" className="shrink-0" role="img" aria-label={`${Math.round(clamped)}%`}>
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
