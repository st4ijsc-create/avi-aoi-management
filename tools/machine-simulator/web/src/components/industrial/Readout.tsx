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
  /**
   * H5b — `"inline"` (default, unchanged) sits `label`/`labelEn` side by side on one row, same as
   * every pre-existing caller (`KpiTile`, `OutputCard`) still gets. `"stack"` puts the gloss on its
   * OWN row below the primary label instead of sharing horizontal space with it — spec §3 already
   * allows the gloss "beneath/beside" the primary label; this is the "beneath" option. Callers in a
   * narrow tile (the HMI `ReadoutGrid`, 1280×800's 2-column floor) opt in: at ~160–200px of tile
   * width, an inline label+gloss pair genuinely doesn't fit a Vietnamese caption AND its uppercase
   * English gloss on one line — CSS `truncate` was hiding real words (live-reproduced: "CHỈ SỐ QUY
   * T…", "TRẠNG THÁI CẤ…", "TỶ LỆ …"), an operator-facing regression, not a cosmetic one. Stacking
   * gives each line the FULL tile width instead of splitting it, which — combined with shortening the
   * worst-offending label strings themselves (`i18n/vi.ts`) — closes the truncation without touching
   * unrelated, wider `Readout` call sites.
   */
  labelLayout?: "inline" | "stack"
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
  labelLayout = "inline",
  className,
}: ReadoutProps) {
  const isText = valueType === "text"
  const stacked = labelLayout === "stack"
  // Only a plain string can be truncated/title-attributed sensibly — a ReactNode value (rare, none
  // of today's callers) just renders as-is at the text size.
  const fullText = typeof value === "string" ? value : undefined

  return (
    <div className={cn("flex items-center gap-4", className)}>
      {gaugePct !== undefined ? <DonutGauge pct={gaugePct} tone={tone} /> : null}
      <div className="min-w-0 flex-1">
        {/* `hmi-readout-value` lives on this ROW, not the value `<span>` itself (H4 job 3) — the span
            is inline/shrink-to-content, so its own bounding box WIDTH varies with the live value's
            digit/character count (e.g. "5" vs "128", "IDLE" vs "INSUFFICIENT_SOLDER"), which made the
            visual-regression mask itself a moving target: a baseline captured with a short value left a
            sliver of the LONGER value's extra width unmasked on a later run (and vice versa), a
            genuine source of flakiness once the suite's tolerance was tightened. This row is a plain
            block box (`display:flex` only changes how its OWN children lay out) so it already fills
            the tile's full text-column width regardless of content — masking IT keeps the box size
            stable across runs while still covering whatever the value renders. Everything else in the
            tile (border, dividers, micro-labels below) stays UNmasked so a real layout regression is
            still caught by the pixel diff. */}
        <div className="hmi-readout-value flex items-baseline gap-1.5">
          <span
            className={cn(
              "font-heading font-semibold tabular-nums",
              isText ? "block max-w-full truncate text-[19px] leading-[1.15]" : "text-[38px] leading-[1.05]",
              TONE_TEXT[tone],
              // WS1-T2 — Console's "key data glow gently": a run-toned reading (a passing rate, a
              // live cycle count, "RUNNING") gets the same `--glow-run` halo as a live StatusLamp,
              // `none`/no-op on Glass/Warmth. `box-shadow` doesn't affect layout (paint-only), so
              // this is a zero-risk no-op everywhere the token itself resolves to `none` — safe
              // alongside the pinned-Glass visual baselines. Reserved to `tone === "run"` only —
              // warn/fault/idle/neutral readings never glow.
              tone === "run" && "hmi-glow-run"
            )}
            // M-4 (branch-review) — this `<span>` has the implicit `role="generic"`, which ARIA
            // forbids naming (aria-label/aria-labelledby are prohibited attributes on that role, and
            // axe's `aria-prohibited-attr` flags it); most screen readers ignore an aria-label here
            // anyway. It's also redundant even where honoured: `truncate` only clips the value
            // VISUALLY (CSS `text-overflow: ellipsis`), the full untruncated string stays the span's
            // real text content, so the accessible name computed from that content already equals
            // `fullText`. `title` alone is kept for the sighted-hover tooltip.
            title={isText ? fullText : undefined}
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
        <div
          className={cn(
            "mt-1 flex min-w-0 overflow-hidden",
            stacked ? "flex-col items-start gap-0" : "items-baseline gap-1.5"
          )}
        >
          <span className={cn("hmi-micro min-w-0 truncate", stacked ? "w-full" : "flex-1")}>{label}</span>
          {labelEn ? (
            // M-1 (branch-review) — `text-text-muted/70` was dead: `.hmi-micro` (index.css) sets its
            // own `color: var(--text-muted)` in the same `@layer utilities`, which wins the cascade
            // over this Tailwind utility class, so the gloss never actually rendered at the reduced
            // 70% opacity the class name promised (and the class itself would fail contrast if it
            // ever DID take effect — `.hmi-micro`'s own muted tone is already tuned to pass).
            <span className={cn("hmi-micro truncate", stacked ? "w-full" : "shrink-0")}>{labelEn}</span>
          ) : null}
        </div>
        {/* `hmi-readout-value` also covers `sub` (H4 job 3): some callers pass genuinely-live content
            here too — `ReadoutGrid.tsx`'s STATUS tile shows the last defect's code, which is exactly
            as timing-dependent/random as the value above it — and an unmasked live `sub` leaked a
            reproduced ~1% pixel diff into the HMI baseline once the suite's tolerance was tightened.
            Callers with a genuinely static `sub` (a fixed metric-name qualifier) lose nothing by also
            being covered — it's a minor caption, not the tile's structural chrome.

            `sub !== undefined` (not just truthy `sub`) is deliberate: a caller whose sub-text can be
            EMPTY at some moments and non-empty at others (the STATUS tile's defect code — empty until
            the first defect lands) needs the row to occupy the SAME vertical space either way, or
            every unmasked sibling below it (the micro-label row's own text, structural and meant to
            stay checkable) shifts up/down between runs depending on timing — a real geometry mismatch
            no mask can paper over, reproduced live: two runs of the same pristine HMI screen landed a
            first defect at different moments, so one had the sub row and one didn't. Passing `""`
            (not omitting the prop) is how a caller opts into this reserved, always-present row. */}
        {sub !== undefined ? (
          <div className="hmi-readout-value mt-0.5 truncate text-[11px] text-text-muted">{sub || " "}</div>
        ) : null}
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
