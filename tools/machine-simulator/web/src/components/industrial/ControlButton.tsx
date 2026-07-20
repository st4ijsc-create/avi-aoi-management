import * as React from "react"
import { OctagonAlert, Pause, Play, RotateCcw } from "lucide-react"

import { cn } from "@/lib/utils"

export type ControlButtonVariant = "start" | "pause" | "reset" | "estop"

export interface ControlButtonProps extends Omit<React.ComponentProps<"button">, "children"> {
  variant: ControlButtonVariant
  /** Active-language label (e.g. "BẮT ĐẦU" / "START"). */
  label: React.ReactNode
  /** English gloss, shown beneath the label — omit only if `label` is already English. */
  labelEn?: React.ReactNode
  /**
   * Branch-review I-7 — true once a LATCHED control (currently only the E-STOP variant) has already
   * been engaged. Unlike `disabled` (the flat, neutral "not applicable right now" skin — e.g. START
   * while running) a pressed E-STOP IS the active fault condition itself: it must keep its full red
   * dome (a latched mushroom on real hardware stays red and stays visible), stay keyboard-focusable
   * (native `disabled` removes an element from the tab order entirely — exactly the control an
   * operator most needs to still be able to find), and read as "already pressed" via `aria-pressed`
   * plus a permanently collapsed physical base rather than going flat grey and looking inert.
   * Re-activation is blocked via `aria-disabled` (not the native attribute) and by the caller simply
   * omitting `onClick` while `pressed`.
   */
  pressed?: boolean
}

const ICONS: Record<ControlButtonVariant, React.ComponentType<{ className?: string }>> = {
  start: Play,
  pause: Pause,
  reset: RotateCcw,
  estop: OctagonAlert,
}

const SIZE_CLASS: Record<ControlButtonVariant, string> = {
  start: "h-24 w-24", // ~96px
  pause: "h-[82px] w-[82px]",
  reset: "h-[72px] w-[72px]",
  estop: "h-[150px] w-[150px]",
}

const ICON_SIZE: Record<ControlButtonVariant, string> = {
  start: "size-7",
  pause: "size-6",
  reset: "size-6",
  estop: "size-10",
}

/**
 * A physical control — the operator reaches for these, so they must feel like hardware, not a web
 * button (spec §6). Square (radius 0, ground rule §1); the E-STOP dome is the one place in the
 * whole system a `box-shadow` is allowed, simulating a raised physical base that collapses on
 * press. Honors `prefers-reduced-motion` (the press collapse still happens instantly, just without
 * the eased transition) and is fully keyboard operable — a native `<button>`, not a styled `<div>`.
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
        "group/control relative flex shrink-0 flex-col items-center justify-center gap-1 border text-center outline-none transition-[transform,box-shadow] duration-75 select-none motion-reduce:transition-none",
        "focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-[var(--color-bg)]",
        SIZE_CLASS[variant],
        variant === "start" &&
          !flatSkin &&
          "border-navy-800 bg-navy-700 text-white hover:bg-navy-600 active:translate-y-px",
        variant === "pause" &&
          !flatSkin &&
          "border-status-warn bg-status-warn/15 text-warn-text hover:bg-status-warn/25 active:translate-y-px",
        variant === "reset" &&
          !flatSkin &&
          "border-border-strong bg-surface-muted text-text-body hover:bg-surface-base active:translate-y-px",
        estopArmedOrLatched && !pressed && "cursor-pointer border-[3px] text-white active:translate-y-1",
        // Latched: keeps the red dome (see style below) but reads as permanently pressed-in, not
        // interactive — no pointer cursor, no further translate-on-active.
        estopArmedOrLatched && pressed && "cursor-default border-[3px] text-white translate-y-1",
        flatSkin && "cursor-not-allowed border-border bg-surface-muted text-text-muted",
        className
      )}
      style={
        estopArmedOrLatched
          ? {
              borderColor: "#7d1f16",
              background: "radial-gradient(circle at 50% 38%, #e0503f, #b5271a 62%, #8f1d12)",
              boxShadow: pressed ? "0 2px 0 #6d160d" : "0 6px 0 #6d160d",
              ...style,
            }
          : style
      }
      onMouseDown={(e) => {
        if (estopArmedOrLatched && !pressed) {
          e.currentTarget.style.boxShadow = "0 2px 0 #6d160d"
        }
      }}
      onMouseUp={(e) => {
        if (estopArmedOrLatched && !pressed) {
          e.currentTarget.style.boxShadow = "0 6px 0 #6d160d"
        }
      }}
      onMouseLeave={(e) => {
        if (estopArmedOrLatched && !pressed) {
          e.currentTarget.style.boxShadow = "0 6px 0 #6d160d"
        }
      }}
      {...props}
    >
      <Icon className={cn(ICON_SIZE[variant])} aria-hidden="true" />
      <span className={cn("font-heading leading-none font-semibold tracking-wide uppercase", variant === "estop" ? "text-sm" : "text-xs")}>
        {label}
      </span>
      {/* Full opacity, not a dimmed `opacity-80` gloss — the PAUSE variant's amber-on-tint palette
          measured 3.52:1 at 80% opacity (axe, H2), under the 4.5:1 AA floor. Full-opacity text in the
          variant's own already-appropriate color (white on start/estop, warn-text on pause, body text
          on reset) reads correctly at every variant without a per-variant contrast exception. */}
      {labelEn ? <span className="text-[9px] leading-none font-medium tracking-wider uppercase">{labelEn}</span> : null}
    </button>
  )
}
