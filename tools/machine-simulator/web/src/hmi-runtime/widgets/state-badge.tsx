import type { ReadoutTone } from "@/components/industrial"
import type { WidgetProps } from "../widgetRegistry.ts"
import { asRecord, readBinding } from "./shared.ts"

const TONE_CLASS: Record<ReadoutTone, string> = {
  run: "border-status-run/40 bg-status-run/10 text-ok-text",
  warn: "border-status-warn/40 bg-status-warn/10 text-warn-text",
  fault: "border-status-fault/40 bg-status-fault/10 text-danger-text",
  idle: "border-border bg-surface-muted text-text-muted",
  neutral: "border-border-strong bg-surface-card text-text-strong",
}

const KNOWN_TONES = new Set<ReadoutTone>(["run", "warn", "fault", "idle", "neutral"])

/**
 * `kind: "state-badge"` — a small inline coloured pill for an arbitrary raw string state (unlike
 * `status-lamp`, which is fixed to the four-word `run/warn/fault/idle` ramp and a dot+label layout).
 * No existing primitive matches this shape, so it borrows the SAME tinted-pill idiom `LogTag` already
 * established (fixed border/bg/text triad per tone) rather than inventing a new visual language.
 *
 * Binding: `state` (raw string, shown verbatim, uppercase via CSS). Props: `tones: Record<string,
 * ReadoutTone>` maps a raw value to a colour; unmapped values (or an absent binding) render the neutral
 * "idle" tone.
 */
export function StateBadgeWidget(props: WidgetProps) {
  const p = asRecord(props.widget.props)
  const tv = readBinding(props, "state")
  const raw = typeof tv?.value === "string" ? tv.value : undefined
  const tones = asRecord(p.tones)
  const mapped = raw !== undefined ? tones[raw] : undefined
  // Falls back to "idle" for BOTH an unmapped raw value AND a mapped value that isn't actually one of
  // the five real `ReadoutTone` words (e.g. an author typo like `"green"`) — never trusts `props.tones`
  // blindly, same fail-safe posture `status-lamp.tsx`/`line-state.tsx` apply to their own state maps.
  const tone: ReadoutTone = typeof mapped === "string" && KNOWN_TONES.has(mapped as ReadoutTone) ? (mapped as ReadoutTone) : "idle"

  return (
    <span
      className={`inline-block rounded-[var(--radius-sm)] border px-2 py-0.5 text-center text-[11px] font-semibold tracking-wide uppercase ${TONE_CLASS[tone]}`}
    >
      {raw ?? "—"}
    </span>
  )
}
