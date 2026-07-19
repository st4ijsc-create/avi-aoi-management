import { Command, Loader2, Play, Square } from "lucide-react"
import { useLocation } from "wouter"

import {
  useFleetIsRunning,
  useHealth,
  useMode,
  useSetMode,
  useStartFleet,
  useStopFleet,
  type TransportMode,
} from "@/lib/api"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/ui/status-badge"
import { NAV_ITEMS } from "@/shell/Sidebar"

const MODE_OPTIONS: { value: TransportMode; label: string }[] = [
  { value: "Live", label: "Live" },
  { value: "Demo", label: "Demo" },
  { value: "Auto", label: "Auto" },
]

function ModeSwitch() {
  const { data, isPending } = useMode()
  const setMode = useSetMode()
  // Optimistic while the PUT is in flight (negligible on a local engine, but keeps the segmented
  // control feeling instant); once settled, the server-confirmed `data.mode` is the source of truth
  // even if the mutation failed, so a failed PUT snaps back to reality instead of lying.
  const current = (setMode.isPending ? setMode.variables : undefined) ?? data?.mode ?? "Demo"

  return (
    <div
      role="radiogroup"
      aria-label="Transport mode"
      className="flex items-center gap-0.5 rounded-lg border border-border bg-surface-subtle p-0.5"
    >
      {MODE_OPTIONS.map((option) => {
        const selected = current === option.value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={isPending}
            onClick={() => setMode.mutate(option.value)}
            className={cn(
              "h-6 rounded-[6px] px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-600/50",
              selected
                ? "bg-navy-600 text-white shadow-sm"
                : "text-text-muted hover:text-text-strong"
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function ServerStatusDot() {
  const { isError, isPending } = useHealth()
  const state = isPending ? "pending" : isError ? "down" : "up"

  return (
    <div className="flex items-center gap-1.5 text-xs text-text-muted">
      <span
        className={cn(
          "size-2 rounded-full",
          state === "up" && "bg-ok",
          state === "down" && "bg-danger",
          state === "pending" && "bg-neutral"
        )}
        aria-hidden="true"
      />
      <span>{state === "up" ? "Engine connected" : state === "down" ? "Engine offline" : "Connecting…"}</span>
    </div>
  )
}

interface TopBarProps {
  onOpenPalette: () => void
}

export function TopBar({ onOpenPalette }: TopBarProps) {
  const [location] = useLocation()
  const isRunning = useFleetIsRunning()
  const startFleet = useStartFleet()
  const stopFleet = useStopFleet()
  const { data: modeData } = useMode()

  const pageTitle =
    NAV_ITEMS.find((item) => (item.path === "/" ? location === "/" : location.startsWith(item.path)))
      ?.label ?? "ST4I Machine Simulator"

  // HealthDto only carries {ok, mode} — AutoTransport.IsFallingBack isn't exposed over HTTP, so
  // there's no authoritative "did Auto actually fall back to Demo just now" signal to read. Auto
  // mode's entire purpose is silently routing to Demo whenever Live is unreachable, which is always
  // true in this exhibition setup (no real ST4I server at the configured URL) — so mode === "Auto"
  // is used as the practical proxy for "currently serving from the demo transport."
  const showDemoFallback = modeData?.mode === "Auto"

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-surface-base px-6">
      <div className="flex min-w-0 items-center gap-3">
        <h2 className="truncate text-sm font-semibold text-text-strong">{pageTitle}</h2>
        {showDemoFallback ? <StatusBadge status="warn">Demo fallback</StatusBadge> : null}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <ModeSwitch />

        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            onClick={() => startFleet.mutate()}
            disabled={isRunning || startFleet.isPending}
          >
            {startFleet.isPending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Play className="size-3.5" aria-hidden="true" />
            )}
            Start Fleet
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => stopFleet.mutate()}
            disabled={!isRunning || stopFleet.isPending}
          >
            {stopFleet.isPending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Square className="size-3.5" aria-hidden="true" />
            )}
            Stop
          </Button>
        </div>

        <div className="h-6 w-px bg-border" aria-hidden="true" />

        <ServerStatusDot />

        <button
          type="button"
          onClick={onOpenPalette}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-subtle px-2.5 py-1.5 text-xs text-text-muted transition-colors hover:bg-navy-50 hover:text-navy-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-600/50"
        >
          <Command className="size-3.5" aria-hidden="true" />
          <kbd className="font-numeric">K</kbd>
        </button>
      </div>
    </header>
  )
}
