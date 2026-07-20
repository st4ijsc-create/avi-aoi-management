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

export interface StatusLampProps {
  state: StatusLampState
  label: React.ReactNode
  sub?: React.ReactNode
  /** Plays the `blip` pulse — only ever true while the machine/feed this lamp represents is
   * actually live (spec §5). `prefers-reduced-motion` always wins regardless of this prop (handled
   * by the `.hmi-blip` utility itself, not here). */
  live?: boolean
  className?: string
}

/** Pulsing status dot + label/sub — the state-at-a-glance primitive used in nameplates, machine
 * cards, and panel headers (spec §5). Color comes only from the fixed status ramp. */
export function StatusLamp({ state, label, sub, live, className }: StatusLampProps) {
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
