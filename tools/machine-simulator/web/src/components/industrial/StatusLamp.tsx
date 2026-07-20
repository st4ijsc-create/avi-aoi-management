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
  if (size === "lg") {
    return (
      <div
        className={cn(
          "flex items-center gap-3 border border-border-strong bg-surface-muted py-1.5 pr-4 pl-3",
          className
        )}
      >
        <span
          aria-hidden="true"
          className={cn("size-3.5 shrink-0", DOT_CLASS[state], RING_CLASS[state], live && "hmi-blip")}
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
        className={cn("size-2.5 shrink-0", DOT_CLASS[state], RING_CLASS[state], live && "hmi-blip")}
      />
      <div className="min-w-0 leading-tight">
        <div className="truncate text-[13px] font-medium text-text-body">{label}</div>
        {sub ? <div className="hmi-micro truncate">{sub}</div> : null}
      </div>
    </div>
  )
}
