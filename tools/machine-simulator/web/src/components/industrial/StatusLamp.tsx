import * as React from "react"

import { cn } from "@/lib/utils"

export type StatusLampState = "run" | "warn" | "fault" | "idle"

const DOT_CLASS: Record<StatusLampState, string> = {
  run: "bg-status-run",
  warn: "bg-status-warn",
  fault: "bg-status-fault",
  idle: "bg-status-idle",
}

const RING_CLASS: Record<StatusLampState, string> = {
  run: "shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-status-run)_25%,transparent)]",
  warn: "shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-status-warn)_25%,transparent)]",
  fault: "shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-status-fault)_25%,transparent)]",
  idle: "",
}

// WS1-T2 — Console's signature: LIVE elements emit light. `--glow-run` is a real box-shadow only
// on Console (a soft halo, tuned off the run-state hue); `none` on Glass/Warmth. Deliberately gated
// on `live && state === "run"` (not just `run`) — a machine that's merely IDLE-but-nominally-"run"-
// coloured, or a lamp rendered without its own live feed, doesn't glow; only a dot that's actually
// pulsing (`.hmi-blip`) gets the halo, so the two read as one motion+light signal together instead
// of the glow appearing on static dots too.
//
// `box-shadow` is a single CSS property — `RING_CLASS.run`'s own hairline ring and `--glow-run`
// can't both apply as two separate classes (the later one in source order would just replace the
// earlier one, not layer with it). `GLOW_RING_RUN_CLASS` composes them as one arbitrary value's
// comma-separated shadow LIST instead, so the ring and the glow render together.
const GLOW_RING_RUN_CLASS =
  "shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-status-run)_25%,transparent),var(--glow-run)]"
// The housing bezel (size="lg") has no ring layer of its own to collide with, so the plain
// `--glow-run` utility applies there directly.
const GLOW_RUN_CLASS = "hmi-glow-run"

/** `size="lg"` only — the AA-safe *-text token per state (not the raw status hue `DOT_CLASS` uses
 * for the small dot, which is fine at 2.5–3.5px but wouldn't hold contrast set as 17px text). */
const TEXT_CLASS: Record<StatusLampState, string> = {
  run: "text-ok-text",
  warn: "text-warn-text",
  fault: "text-danger-text",
  idle: "text-text-strong",
}

export interface StatusLampProps {
  state: StatusLampState
  label: React.ReactNode
  sub?: React.ReactNode
  /** Plays the `blip` pulse — only ever true while the machine/feed this lamp represents is
   * actually live (spec §5). `prefers-reduced-motion` always wins regardless of this prop (handled
   * by the `.hmi-blip` utility itself, not here). */
  live?: boolean
  /**
   * `"sm"` (default) — the compact dot+label used in the TopBar connection indicator and inline
   * chips. `"lg"` — a housed pilot-lamp treatment (bezel + bigger dot + condensed-display state
   * word) for the ONE place per screen a machine's own run state is the thing the operator reads
   * first, e.g. the HMI nameplate (H2b: the original nameplate lamp was the same small dot used
   * everywhere else in the app, which read as an afterthought on a screen whose whole job is
   * showing this one state at a glance).
   */
  size?: "sm" | "lg"
  className?: string
}

/** Pulsing status dot + label/sub — the state-at-a-glance primitive used in nameplates, machine
 * cards, and panel headers (spec §5). Color comes only from the fixed status ramp. */
export function StatusLamp({ state, label, sub, live, size = "sm", className }: StatusLampProps) {
  const glowing = live && state === "run"

  if (size === "lg") {
    return (
      <div
        className={cn(
          "flex items-center gap-3 rounded-[var(--radius)] border border-border-strong bg-surface-muted py-1.5 pr-4 pl-3 transition-shadow",
          glowing && GLOW_RUN_CLASS,
          className
        )}
      >
        <span
          aria-hidden="true"
          className={cn("size-3.5 shrink-0 rounded-full", DOT_CLASS[state], glowing ? GLOW_RING_RUN_CLASS : RING_CLASS[state], live && "hmi-blip")}
        />
        <div className="min-w-0 leading-tight">
          <div className={cn("truncate font-heading text-[17px] font-semibold tracking-tight", TEXT_CLASS[state])}>
            {label}
          </div>
          {sub ? <div className="hmi-micro truncate">{sub}</div> : null}
        </div>
      </div>
    )
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span
        aria-hidden="true"
        className={cn("size-2.5 shrink-0 rounded-full", DOT_CLASS[state], glowing ? GLOW_RING_RUN_CLASS : RING_CLASS[state], live && "hmi-blip")}
      />
      <div className="min-w-0 leading-tight">
        <div className="truncate text-[13px] font-medium text-text-body">{label}</div>
        {sub ? <div className="hmi-micro truncate">{sub}</div> : null}
      </div>
    </div>
  )
}
