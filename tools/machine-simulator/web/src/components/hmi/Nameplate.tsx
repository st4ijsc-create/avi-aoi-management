import * as React from "react"
import { ArrowLeft } from "lucide-react"
import { Link } from "wouter"

import { StatusLamp, type StatusLampState } from "@/components/industrial"
import { currentShiftNumber } from "@/components/hmi/derive"
import { useT } from "@/i18n"
import type { DeviceClass, DriverKind } from "@/lib/api"
import type { StreamConnectionState } from "@/lib/inspector"
import { cn } from "@/lib/utils"
import { ThemeQuickSwitch } from "@/theme/ThemePicker"

const CONNECTIVITY_KEY: Record<StreamConnectionState, string> = {
  open: "hmi.connectivity.online",
  connecting: "hmi.connectivity.connecting",
  closed: "hmi.connectivity.offline",
}

/**
 * H5 — connectivity chip (layout gap 4): a plain text/dot badge, deliberately NOT built on
 * `StatusLamp`'s status ramp — spec §2 reserves run/warn/fault colour for MACHINE state, and this
 * reports the browser tab's own WS link to the engine, a different axis entirely (a machine can be
 * genuinely Running while this reads OFFLINE mid-reconnect). Same low-key, text-only idiom
 * `SystemLog.tsx`'s own header already uses for the identical signal ("WS"/"…"/"OFF"), just spelled
 * out here since the nameplate is the one place an operator glances at first.
 */
function ConnectivityChip({ connectionState }: { connectionState: StreamConnectionState }) {
  const t = useT()
  return (
    <div className="hmi-connectivity flex items-center gap-2 border border-border-strong bg-surface-muted px-3 py-1.5">
      <span
        aria-hidden="true"
        className={cn(
          "size-2 shrink-0",
          connectionState === "open" ? "bg-status-run" : connectionState === "connecting" ? "bg-status-warn" : "bg-status-fault"
        )}
      />
      <span className="hmi-micro whitespace-nowrap">{t(CONNECTIVITY_KEY[connectionState])}</span>
    </div>
  )
}

/** Live HH:MM:SS clock — same ticking pattern as `TopBar.tsx`'s own `Clock()`, duplicated locally
 * since the HMI route renders outside `<Shell>` (spec §8: a genuine kiosk shell, not the app chrome). */
function useClock(): Date {
  const [now, setNow] = React.useState(() => new Date())
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])
  return now
}

interface NameplateProps {
  code: string
  deviceClass: DeviceClass
  driverKind: DriverKind
  lampState: StatusLampState
  lampLabel: string
  lampSub?: string
  lampLive: boolean
  /** H5 — the shared WS trace-stream state (`useInspectorStream`, opened once in `Hmi.tsx` and passed
   * to both this chip and `SystemLog`) — layout gap 4's connectivity chip. */
  connectionState: StreamConnectionState
}

/** The kiosk header (spec §8): machine code at nameplate scale, device class/driver beneath, a
 * `StatusLamp` for machine state, a connectivity chip, the current shift (derived from the wall
 * clock), a live clock, and an "obvious way back" to the machine's own detail page. */
export function Nameplate({ code, deviceClass, driverKind, lampState, lampLabel, lampSub, lampLive, connectionState }: NameplateProps) {
  const t = useT()
  const now = useClock()
  const shift = currentShiftNumber(now)

  return (
    <header className="flex h-20 shrink-0 items-center justify-between gap-6 border-b border-border bg-surface-base px-6">
      <div className="flex min-w-0 items-center gap-4">
        <Link
          href={`/machines/${encodeURIComponent(code)}`}
          className="flex shrink-0 items-center gap-1.5 border border-border-strong px-2.5 py-2 text-xs text-text-muted transition-colors hover:border-navy-600 hover:text-navy-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] dark:hover:text-navy-200"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          {t("hmi.back")}
        </Link>
        <div className="min-w-0">
          <h1 className="truncate font-heading text-[34px] leading-none font-semibold tracking-tight text-text-strong">
            {code}
          </h1>
          <p className="hmi-micro mt-1.5">
            {t(`deviceClass.${deviceClass}`)} · {t(`driverKind.${driverKind}`)}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-5">
        {/* `hmi-nameplate-lamp` — a stable mask hook for the visual-regression baseline (H2b): the
            machine's live status word/color is genuinely non-deterministic run-to-run (whichever
            state the shared fleet happens to be in), same reasoning as `hmi-readout-value`. */}
        <StatusLamp size="lg" state={lampState} label={lampLabel} sub={lampSub} live={lampLive} className="hmi-nameplate-lamp" />

        <div className="h-8 w-px bg-border" aria-hidden="true" />

        <ConnectivityChip connectionState={connectionState} />

        <div className="h-8 w-px bg-border" aria-hidden="true" />

        <div className="hmi-clock flex flex-col items-end leading-tight">
          <span className="font-mono text-sm tabular-nums text-text-body" suppressHydrationWarning>
            {now.toLocaleTimeString(undefined, { hour12: false })}
          </span>
          <span className="hmi-micro">{t("hmi.shift", { n: shift })}</span>
        </div>

        <div className="h-8 w-px bg-border" aria-hidden="true" />

        <ThemeQuickSwitch />
      </div>
    </header>
  )
}
