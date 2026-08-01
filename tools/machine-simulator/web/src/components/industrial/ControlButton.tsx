import * as React from "react"
import { Pause, Play, RotateCcw, Unplug } from "lucide-react"

import { cn } from "@/lib/utils"

export type ControlButtonVariant = "start" | "pause" | "reset" | "estop"

export interface ControlButtonProps extends Omit<React.ComponentProps<"button">, "children"> {
  variant: ControlButtonVariant
  /** Active-language label (e.g. "BẮT ĐẦU" / "START"). */
  label: React.ReactNode
  /** English gloss, shown beneath the label — omit only if `label` is already English. */
  labelEn?: React.ReactNode
  /**
   * Branch-review I-7 — true once a LATCHED control (currently only the "estop"/HALT variant — SM-4:
   * a supervisory software latch, not a safety device, see `ControlColumn.tsx`'s own remarks) has
   * already been engaged. Unlike `disabled` (the flat, neutral "not applicable right now" skin — e.g.
   * START while running) a pressed HALT IS the active fault condition itself: it must stay visually
   * distinct in its own danger-tinted register (SM-4 fix round 1: a bolder border on the SAME flat
   * tint every other control here already uses — never the flat grey `disabled` skin, and never a
   * stronger fill/text colour, which would risk the tint's own tuned AA contrast — see
   * `ControlButton`'s own remarks), stay keyboard-focusable (native `disabled` removes an element from
   * the tab order entirely — exactly the control an operator most needs to still be able to find), and
   * read as "already pressed" via `aria-pressed` rather than going flat grey and looking inert.
   * Re-activation is blocked via `aria-disabled` (not the native attribute) and by the caller simply
   * omitting `onClick` while `pressed`.
   */
  pressed?: boolean
}

// SM-4 fix round 1 (review) — `estop`'s own icon was `OctagonAlert`, the universal stop-sign/warning
// register a real ISO 13850 emergency stop uses. This control is a supervisory software halt (see
// `ControlColumn.tsx`'s own remarks) — `Unplug` reads as "disconnect / stop reading," matching what it
// actually does, instead of borrowing a safety glyph for a control that isn't one.
const ICONS: Record<ControlButtonVariant, React.ComponentType<{ className?: string }>> = {
  start: Play,
  pause: Pause,
  reset: RotateCcw,
  estop: Unplug,
}

// H5c — exported so callers that need to reserve a control's exact footprint WITHOUT rendering the
// control itself (e.g. `ControlColumn`'s RESET placeholder, spec §8.3: HALT/RESET never move between
// states — a reliability rule, not a safety-circuit one; HALT is a software latch, see `ControlButton`'s
// own remarks) read the real size from one place, not a hand-copied magic-number duplicate that can
// silently drift out of sync with this map.
export const CONTROL_BUTTON_SIZE_CLASS: Record<ControlButtonVariant, string> = {
  start: "h-24 w-24", // ~96px
  pause: "h-[82px] w-[82px]",
  reset: "h-[72px] w-[72px]",
  estop: "h-[150px] w-[150px]",
}
const SIZE_CLASS = CONTROL_BUTTON_SIZE_CLASS

const ICON_SIZE: Record<ControlButtonVariant, string> = {
  start: "size-7",
  pause: "size-6",
  reset: "size-6",
  estop: "size-10",
}

/**
 * A physical control — the operator reaches for these, so they must feel like hardware, not a web
 * button (spec §6). Square (radius 0, ground rule §1) and fully keyboard operable — a native
 * `<button>`, not a styled `<div>`.
 *
 * SM-4 fix round 1 (review) — HALT (`variant="estop"`) USED to be the "one sanctioned shadow
 * exception": a 150px red radial-gradient dome with a physical raised-base `box-shadow` that
 * collapsed on press, justified in this file's own prior comments by "operator muscle memory, reach
 * for it without looking." The review's point, verbatim: that is precisely the human-factors
 * rationale for a REAL ISO 13850 emergency stop — fast, pre-cognitive, shape-based recognition under
 * stress — so a control that isn't one must not be built to be found the same way. HALT now uses the
 * exact same flat, bordered, tinted register every other control here already does (see the
 * `--elevation` shadow and `border-status-fault`/`bg-status-fault` treatment below) — no gradient, no
 * raised-then-collapsing shadow, no dome. It stays large and clearly danger-colored (prominent, easy
 * to find) without impersonating a certified safety device. Do NOT reintroduce the dome/gradient/
 * physical-base treatment here, even citing muscle memory — that was the exact defect.
 */
export function ControlButton({ variant, label, labelEn, className, disabled, pressed, style, ...props }: ControlButtonProps) {
  const Icon = ICONS[variant]

  // I-7: native `disabled` (the flat grey skin, and removal from the tab order) is reserved for the
  // classic "inapplicable right now" case. A LATCHED estop is never natively disabled — see `pressed`'s
  // doc comment above.
  const nativeDisabled = Boolean(disabled) && !pressed
  const flatSkin = nativeDisabled
  const estopArmedOrLatched = variant === "estop" && !flatSkin

  return (
    <button
      type="button"
      disabled={nativeDisabled}
      aria-disabled={flatSkin || pressed ? true : undefined}
      aria-pressed={variant === "estop" ? (pressed ?? false) : undefined}
      className={cn(
        "group/control relative flex shrink-0 flex-col items-center justify-center gap-1 rounded-[var(--radius)] border text-center outline-none transition-[transform,box-shadow] duration-75 select-none motion-reduce:transition-none",
        "focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-[var(--color-bg)]",
        SIZE_CLASS[variant],
        // WS1-T2 — Warmth's own signature bullet is explicitly about CONTROLS: "tactile physical
        // depth on controls (real-but-soft shadows via --elevation)". Every variant, HALT included
        // (SM-4 fix round 1 — no more standalone dome shadow), picks up `--elevation` directly (a
        // whisper shadow on Glass, cyan-ring+deep-shadow on Console, a real-but-soft contact shadow
        // on Warmth) so every control reads as raised hardware the SAME way, not one of them singled
        // out to look like a different class of device.
        !flatSkin && "shadow-[var(--elevation)]",
        variant === "start" &&
          !flatSkin &&
          "border-navy-800 bg-navy-700 text-white hover:bg-navy-600 active:translate-y-px",
        variant === "pause" &&
          !flatSkin &&
          "border-status-warn bg-status-warn/15 text-warn-text hover:bg-status-warn/25 active:translate-y-px",
        variant === "reset" &&
          !flatSkin &&
          "border-border-strong bg-surface-muted text-text-body hover:bg-surface-base active:translate-y-px",
        // SM-4 fix round 1 — the SAME tinted-flat idiom PAUSE uses (border-status-X + bg-status-X/15 +
        // text-X-text — index.css's own `--danger-text`/`--warn-text` are specifically tuned AA-safe
        // against a ~10-20% tint of their own hue, so /15 here is the SAME proven-safe pairing PAUSE
        // already ships, not a new one), just on the fault hue instead of warn: danger-colored,
        // bordered, still large (SIZE_CLASS.estop is unchanged) and clearly distinct, but no longer a
        // gradient dome. Latched gets a bolder BORDER only, never a stronger fill/text colour (a
        // background tint outside the proven ~10-20% range risks losing the axe-verified AA contrast
        // `text-danger-text` was tuned for — border width is contrast-neutral, so this is the safe
        // dimension to add emphasis on) — `aria-pressed`/`aria-disabled` already carry the "this is the
        // active condition now" state for assistive tech; this is the sighted-user equivalent. Border
        // width never changes the button's own OUTER footprint (Tailwind's default border-box sizing
        // keeps a fixed-size element's box identical regardless of border width), so
        // `ControlColumn.tsx`'s own H5c geometry invariant (HALT never moves between states) still
        // holds with zero special-casing needed here.
        estopArmedOrLatched &&
          !pressed &&
          "cursor-pointer border-status-fault bg-status-fault/15 text-danger-text hover:bg-status-fault/25 active:translate-y-px",
        estopArmedOrLatched &&
          pressed &&
          "cursor-default border-2 border-status-fault bg-status-fault/15 text-danger-text",
        flatSkin && "cursor-not-allowed border-border bg-surface-muted text-text-muted",
        className
      )}
      style={style}
      {...props}
    >
      <Icon className={cn(ICON_SIZE[variant])} aria-hidden="true" />
      <span className={cn("font-heading leading-none font-semibold tracking-wide uppercase", variant === "estop" ? "text-sm" : "text-xs")}>
        {label}
      </span>
      {/* Full opacity, not a dimmed `opacity-80` gloss — the PAUSE variant's amber-on-tint palette
          measured 3.52:1 at 80% opacity (axe, H2), under the 4.5:1 AA floor. Full-opacity text in the
          variant's own already-appropriate color (white on start, danger-text on estop, warn-text on
          pause, body text on reset) reads correctly at every variant without a per-variant contrast
          exception — `danger-text`/`warn-text` are this project's own AA-on-tint pairing (`index.css`),
          the same reason PAUSE was already safe. */}
      {/* M-10 (mc-feature-review.md) — `aria-hidden`, same visual-gloss-register-not-a-second-accessible-name
          pattern every other bilingual gloss in this project already follows (FormField/Readout/
          CycleLogTable/TraceTable). Without this, HALT's accessible name computed as
          "NGỪNG HALT" / RESET's as "ĐẶT LẠI RESET" — the inverse of the gloss-hiding this project
          otherwise enforces everywhere else — which is also why 13-machine-settings.spec.ts's RESET
          locator had to defensively scope itself (a substring-matching accessible name). */}
      {labelEn ? <span aria-hidden="true" className="text-[9px] leading-none font-medium tracking-wider uppercase">{labelEn}</span> : null}
    </button>
  )
}
