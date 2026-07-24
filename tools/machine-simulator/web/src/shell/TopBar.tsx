import * as React from "react"
import { Command, Loader2, Play, Square } from "lucide-react"
import { toast } from "sonner"
import { useLocation } from "wouter"

import { StatusLamp } from "@/components/industrial"
import { useT } from "@/i18n"
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
import { ThemeQuickSwitch } from "@/theme/ThemePicker"

const MODE_OPTIONS: { value: TransportMode; label: string }[] = [
  { value: "Live", label: "Live" },
  { value: "Demo", label: "Demo" },
  { value: "Auto", label: "Auto" },
]

function ModeSwitch() {
  const t = useT()
  const { data, isPending } = useMode()
  const setMode = useSetMode()
  // Optimistic while the PUT is in flight (negligible on a local engine, but keeps the segmented
  // control feeling instant); once settled, the server-confirmed `data.mode` is the source of truth
  // even if the mutation failed, so a failed PUT snaps back to reality instead of lying.
  const current = (setMode.isPending ? setMode.variables : undefined) ?? data?.mode ?? "Demo"

  return (
    <div
      role="radiogroup"
      aria-label={t("shell.topBar.transportModeAria")}
      className="flex items-center gap-px border border-border-strong bg-surface-muted p-0.5"
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
              "h-6 px-2.5 text-[11px] font-semibold tracking-wide uppercase transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]",
              selected
                ? "bg-navy-700 text-white"
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

function EngineStatusLamp() {
  const t = useT()
  const { isError, isPending } = useHealth()
  const state = isPending ? "idle" : isError ? "fault" : "run"

  return (
    <StatusLamp
      state={state}
      live={state === "run"}
      label={
        state === "run"
          ? t("shell.topBar.engineConnected")
          : state === "fault"
            ? t("shell.topBar.engineOffline")
            : t("shell.topBar.connecting")
      }
      sub="ENGINEAPI"
    />
  )
}

/** Live HH:MM:SS clock, ticking once a second — part of the nameplate header (spec §8). */
function Clock() {
  const [now, setNow] = React.useState(() => new Date())
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])
  const formatted = now.toLocaleTimeString(undefined, { hour12: false })
  return (
    // `hmi-clock` — SAME stable class hook `Nameplate.tsx`'s own live clock uses (see its doc comment
    // and `11-hmi.spec.ts`'s mask list), so every screen's visual baseline can mask this one
    // genuinely-nondeterministic node (ticks every second, so it WILL differ between the run that
    // captured the baseline and any later comparison run) via a single shared selector, instead of
    // either two different selectors to keep in sync or masking something broader that would also hide
    // a real regression.
    <span className="hmi-clock font-mono text-[13px] tabular-nums text-text-body" suppressHydrationWarning>
      {formatted}
    </span>
  )
}

interface TopBarProps {
  onOpenPalette: () => void
}

export function TopBar({ onOpenPalette }: TopBarProps) {
  const t = useT()
  const [location] = useLocation()
  const isRunning = useFleetIsRunning()
  const startFleet = useStartFleet()
  const stopFleet = useStopFleet()
  const { data: modeData } = useMode()
  // Same query key/cadence EngineStatusLamp polls (TanStack Query dedupes — not a second network
  // poll). EngineStatusLamp only ever reflects connectivity (isError/isPending); `.ok` is a
  // DIFFERENT signal — a reachable engine whose fleet pipeline itself faulted (M-3/E1:
  // FleetHost.LastError set) — so it gets its own small, unobtrusive badge rather than overloading
  // the connection lamp.
  const { data: healthData } = useHealth()
  const showEngineFaulted = healthData?.ok === false

  // `/machines/:code` is checked ahead of the generic NAV_ITEMS match (which would otherwise resolve
  // it to the generic "Machines" label via `startsWith("/machines")`) so the title reads "Machine
  // {code}" on a machine's own detail page, same as the brief asks for.
  const machineCode = location.startsWith("/machines/") ? decodeURIComponent(location.split("/")[2] ?? "") : null
  const navMatch = NAV_ITEMS.find((item) => (item.path === "/" ? location === "/" : location.startsWith(item.path)))
  const pageTitle = machineCode
    ? t("shell.topBar.machineTitle", { code: machineCode })
    : navMatch
      ? t(navMatch.labelKey)
      : t("shell.topBar.fallbackTitle")

  // HealthDto only carries {ok, mode} — AutoTransport.IsFallingBack isn't exposed over HTTP, so
  // there's no authoritative "did Auto actually fall back to Demo just now" signal to read. Auto
  // mode's entire purpose is silently routing to Demo whenever Live is unreachable, which is always
  // true in this exhibition setup (no real ST4I server at the configured URL) — so mode === "Auto"
  // is used as the practical proxy for "currently serving from the demo transport."
  const showDemoFallback = modeData?.mode === "Auto"

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-surface-base px-5">
      <div className="flex min-w-0 items-center gap-3">
        <h2 className="truncate font-heading text-base leading-none font-semibold tracking-tight text-text-strong">
          {pageTitle}
        </h2>
        {showDemoFallback ? <StatusBadge status="warn">{t("shell.topBar.demoFallback")}</StatusBadge> : null}
        {showEngineFaulted ? <StatusBadge status="danger">{t("shell.topBar.engineFaulted")}</StatusBadge> : null}
      </div>

      <div className="flex shrink-0 items-center gap-4">
        <ModeSwitch />

        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            onClick={() =>
              startFleet.mutate(undefined, {
                onSuccess: () => toast.success(t("toast.fleetStarted")),
                onError: () => toast.error(t("toast.fleetStartFailed")),
              })
            }
            disabled={isRunning || startFleet.isPending}
          >
            {startFleet.isPending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Play className="size-3.5" aria-hidden="true" />
            )}
            {startFleet.isPending ? t("shell.topBar.starting") : t("shell.topBar.startFleet")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              stopFleet.mutate(undefined, {
                onSuccess: () => toast.success(t("toast.fleetStopped")),
              })
            }
            disabled={!isRunning || stopFleet.isPending}
          >
            {stopFleet.isPending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Square className="size-3.5" aria-hidden="true" />
            )}
            {stopFleet.isPending ? t("shell.topBar.stopping") : t("shell.topBar.stop")}
          </Button>
        </div>

        <div className="h-7 w-px bg-border" aria-hidden="true" />

        <EngineStatusLamp />

        <div className="h-7 w-px bg-border" aria-hidden="true" />

        <Clock />

        <ThemeQuickSwitch />

        <button
          type="button"
          onClick={onOpenPalette}
          aria-label={t("shell.topBar.paletteAria")}
          className="flex items-center gap-1.5 border border-border-strong bg-surface-muted px-2.5 py-1.5 text-xs text-text-muted transition-colors hover:bg-navy-50 hover:text-navy-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] dark:hover:bg-navy-800/40 dark:hover:text-navy-200"
        >
          <Command className="size-3.5" aria-hidden="true" />
          <kbd className="font-mono tabular-nums">K</kbd>
        </button>
      </div>
    </header>
  )
}
