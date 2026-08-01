import * as React from "react"
import { ChevronDown, Command, LogOut, Loader2, Play, Square, UserRound } from "lucide-react"
import { toast } from "sonner"
import { useLocation } from "wouter"

import { StatusLamp } from "@/components/industrial"
import { useT } from "@/i18n"
import {
  useCapabilities,
  useFleetIsRunning,
  useHealth,
  useMode,
  useSetMode,
  useStartFleet,
  useStopFleet,
  type TransportMode,
} from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuPortal, MenuPositioner, MenuSeparator, MenuTrigger } from "@/components/ui/menu"
import { StatusBadge } from "@/components/ui/status-badge"
import { NAV_ITEMS } from "@/shell/Sidebar"
import { ThemeQuickSwitch } from "@/theme/ThemePicker"

// WS2-T1 (docs/PRODUCTION_UI_DESIGN.md §2.3) — Auto dropped entirely from this list (it stays in the
// wire contract/engine — `AutoTransport`/`TransportMode.Auto` — but is no longer a user-selectable
// surface anywhere). Demo is filtered out below when the deployment's `ST4I_DEMO_ENABLED` flag is off,
// leaving LIVE as the only option — never a bare, misleading control with nothing to switch between.
const MODE_OPTIONS: { value: TransportMode; label: string }[] = [
  { value: "Live", label: "Live" },
  { value: "Demo", label: "Demo" },
]

function ModeSwitch() {
  const t = useT()
  const { data, isPending } = useMode()
  const { data: capabilities } = useCapabilities()
  const setMode = useSetMode()
  const demoEnabled = capabilities?.demoEnabled ?? false
  const options = demoEnabled ? MODE_OPTIONS : MODE_OPTIONS.filter((option) => option.value === "Live")
  // Optimistic while the PUT is in flight (negligible on a local engine, but keeps the segmented
  // control feeling instant); once settled, the server-confirmed `data.mode` is the source of truth
  // even if the mutation failed, so a failed PUT snaps back to reality instead of lying. WS2-T1: falls
  // back to "Live" (was "Demo") — Live is the product default now (§2.1), and Demo may not even be a
  // valid fallback to show selected when this deployment has it disabled.
  const current = (setMode.isPending ? setMode.variables : undefined) ?? data?.mode ?? "Live"

  return (
    <div
      role="radiogroup"
      aria-label={t("shell.topBar.transportModeAria")}
      className="flex items-center gap-px rounded-[var(--radius)] border border-border-strong bg-surface-muted p-0.5"
    >
      {options.map((option) => {
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
              "h-6 rounded-[var(--radius-sm)] px-2.5 text-[11px] font-semibold tracking-wide uppercase transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]",
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

/**
 * WS-D-D6/D7 — the real logout affordance D6 deferred to this task: username + role badge (the
 * `auth.userMenu.*` vocabulary D6 already landed, unused until now) and a Logout item that calls
 * `useAuth().logout()` — the SAME call `tests/17-auth.spec.ts` already exercises directly via
 * `page.request.post`, now reachable from the actual UI. No explicit navigate on success: `logout()`
 * writes `["auth","me"]` to `null` (`lib/auth.ts`), which flips `App.tsx`'s `AuthGate` straight to
 * `<Login/>` on its own next render — same reactive-gate pattern every other auth transition in this
 * app already uses, nothing bespoke needed here.
 */
function UserMenu() {
  const t = useT()
  const { user, logout } = useAuth()
  const [loggingOut, setLoggingOut] = React.useState(false)

  if (!user) return null

  async function handleLogout() {
    setLoggingOut(true)
    try {
      await logout()
    } catch {
      toast.error(t("toast.logoutFailed"))
      setLoggingOut(false)
    }
  }

  return (
    <Menu>
      <MenuTrigger
        className="flex items-center gap-1.5 rounded-[var(--radius)] border border-border-strong bg-surface-muted px-2.5 py-1.5 text-xs text-text-body transition-colors hover:bg-navy-50 hover:text-navy-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] dark:hover:bg-navy-800/40 dark:hover:text-navy-200"
        aria-label={t("auth.userMenu.signedInAs", { username: user.username })}
      >
        <UserRound className="size-3.5" aria-hidden="true" />
        <span className="max-w-24 truncate font-medium">{user.username}</span>
        <ChevronDown className="size-3 shrink-0 text-text-muted" aria-hidden="true" />
      </MenuTrigger>
      <MenuPortal>
        <MenuPositioner align="end">
          <MenuPopup>
            <MenuGroup>
              <MenuGroupLabel>
                <span className="flex flex-col gap-0.5 normal-case">
                  <span className="truncate text-xs font-semibold text-text-strong">
                    {t("auth.userMenu.signedInAs", { username: user.username })}
                  </span>
                  <span className="text-[11px] text-text-muted">{t("auth.userMenu.role", { role: user.role })}</span>
                </span>
              </MenuGroupLabel>
            </MenuGroup>
            <MenuSeparator />
            <MenuItem
              disabled={loggingOut}
              onClick={handleLogout}
              className="text-danger-text data-highlighted:bg-destructive/10 data-highlighted:text-danger-text"
            >
              <LogOut className="size-3.5" aria-hidden="true" />
              {loggingOut ? t("auth.userMenu.loggingOut") : t("auth.userMenu.logout")}
            </MenuItem>
          </MenuPopup>
        </MenuPositioner>
      </MenuPortal>
    </Menu>
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

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-surface-base px-5">
      <div className="flex min-w-0 items-center gap-3">
        <h2 className="truncate font-heading text-base leading-none font-semibold tracking-tight text-text-strong">
          {pageTitle}
        </h2>
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
          className="flex items-center gap-1.5 rounded-[var(--radius)] border border-border-strong bg-surface-muted px-2.5 py-1.5 text-xs text-text-muted transition-colors hover:bg-navy-50 hover:text-navy-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] dark:hover:bg-navy-800/40 dark:hover:text-navy-200"
        >
          <Command className="size-3.5" aria-hidden="true" />
          <kbd className="font-mono tabular-nums">K</kbd>
        </button>

        <div className="h-7 w-px bg-border" aria-hidden="true" />

        <UserMenu />
      </div>
    </header>
  )
}
