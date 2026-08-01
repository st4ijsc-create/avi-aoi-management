import * as React from "react"
import { motion } from "framer-motion"
import { Inbox, PlayCircle } from "lucide-react"
import { toast } from "sonner"
import { useLocation } from "wouter"

import { useGloss } from "@/components/hmi/bilingual"
import { useT } from "@/i18n"
import { useEcosystemConnection, useFleet, useFleetIsRunning, useStartFleet } from "@/lib/api"
import { fadeSlideUp, staggerContainer } from "@/theme/motion"
import { Sheet } from "@/components/industrial"
import { Button } from "@/components/ui/button"
import { EcosystemStatusWidget } from "@/components/EcosystemConnect"
import { KpiTile, KpiTileSkeleton } from "@/components/KpiTile"
import { MachineCard, MachineCardSkeleton } from "@/components/MachineCard"
import { Sparkline } from "@/components/Sparkline"

const CYCLE_HISTORY_DEPTH = 40
const FPY_THRESHOLDS = { ok: 0.95, warn: 0.85 } as const

function fpyDelta(t: (key: string) => string, fpy: number): { label: string; status: "ok" | "warn" | "danger" } {
  if (fpy >= FPY_THRESHOLDS.ok) return { label: t("dashboard.kpi.fpyOnTarget"), status: "ok" }
  if (fpy >= FPY_THRESHOLDS.warn) return { label: t("dashboard.kpi.fpyWatch"), status: "warn" }
  return { label: t("dashboard.kpi.fpyBelow"), status: "danger" }
}

function EmptyState({
  onStart,
  pending,
  roster,
}: {
  onStart: () => void
  pending: boolean
  roster: number
}) {
  const t = useT()
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="min-h-0 flex-1">
      <Sheet
        graphPaper
        className="h-full"
        bodyClassName="flex h-full flex-col items-center justify-center gap-4 px-8 py-20 text-center"
      >
        <div className="flex size-14 items-center justify-center border border-border-strong bg-surface-card">
          <PlayCircle className="size-7 text-primary-text" aria-hidden="true" />
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-lg font-semibold text-text-strong">{t("dashboard.empty.title")}</p>
          <p className="max-w-sm text-sm text-text-muted">{t("dashboard.empty.description", { roster })}</p>
        </div>
        {/* M-3 (prod-ui review) — was a raw `<button>` hardcoding `bg-navy-700`, so it stayed
            brand-navy on Console where `--primary`/`--color-accent` repoints to cyan, unlike every
            other primary action (e.g. TopBar's Start button below uses this same `Button` primitive).
            The primitive's own `default` variant already carries the `dark:` (→ Console, see
            index.css's `@custom-variant dark`) override to `var(--color-accent)`, so swapping to it
            themes correctly on all 3 themes for free — no bespoke class list to keep in sync. */}
        <Button onClick={onStart} disabled={pending} className="px-3">
          <PlayCircle className="size-3.5" aria-hidden="true" />
          {pending ? t("dashboard.empty.ctaPending") : t("dashboard.empty.cta")}
        </Button>
      </Sheet>
    </motion.div>
  )
}

/** SM-3/SM-5 — the honest first-run destination for a fresh product install: SM-1 made a zero-machine
 * roster a legitimate state, so this is what a brand-new, standalone (or not-yet-connected) install
 * shows INSTEAD of the old "press Start Fleet" copy (which talks about machines that don't exist) and
 * instead of the removed ecosystem connect gate. Same shape as `Machines.tsx`'s own `EmptyState` for
 * this identical condition — one honest message, not two independently-worded ones.
 *
 * SM-5 re-points this at `/connectors` (`routes/Connectors.tsx`), NOT `/onboarding` — SM-3 correctly
 * labelled `/onboarding` as needing a reachable ST4I ecosystem server (an enrollment wizard, not a
 * machine-onboarding tool), which is a dead end for the standalone customer this empty state is FOR.
 * `/connectors` is the real, reachable destination this task built: add a Modbus/OPC-UA machine from
 * the UI with no server, no environment variables, no hand-edited files. */
function NoMachinesEmptyState({ onAddConnector }: { onAddConnector: () => void }) {
  const t = useT()
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="min-h-0 flex-1">
      <Sheet
        graphPaper
        className="h-full"
        bodyClassName="flex h-full flex-col items-center justify-center gap-4 px-8 py-20 text-center"
      >
        <div className="flex size-14 items-center justify-center border border-border-strong bg-surface-card">
          <Inbox className="size-7 text-primary-text" aria-hidden="true" />
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-lg font-semibold text-text-strong">{t("dashboard.empty.noMachinesTitle")}</p>
          <p className="max-w-sm text-sm text-text-muted">{t("dashboard.empty.noMachinesDescription")}</p>
        </div>
        <Button onClick={onAddConnector} className="px-3">
          {t("shell.nav.connectors")}
        </Button>
      </Sheet>
    </motion.div>
  )
}

export default function Dashboard() {
  const t = useT()
  const gloss = useGloss()
  const { data, isPending, isError } = useFleet()
  const isRunning = useFleetIsRunning()
  const startFleet = useStartFleet()
  const ecosystem = useEcosystemConnection()
  const [, navigate] = useLocation()
  const [cycleHistory, setCycleHistory] = React.useState<number[]>([])

  const totalCycles = data?.kpis.totalCycles ?? 0

  React.useEffect(() => {
    if (data === undefined) return
    setCycleHistory((prev) => {
      const next = [...prev, data.kpis.totalCycles]
      return next.length > CYCLE_HISTORY_DEPTH ? next.slice(next.length - CYCLE_HISTORY_DEPTH) : next
    })
  }, [data])

  const openMachine = React.useCallback((code: string) => navigate(`/machines/${code}`), [navigate])

  const hasCycles = totalCycles > 0
  const roster = data?.machines.length ?? 0
  // SM-3 — a genuinely empty roster (SM-1's legitimate zero-machine product state) needs its OWN honest
  // destination, distinct from "machines exist but the fleet hasn't been started yet": pressing "Start
  // Fleet" with nothing registered has nothing to cycle, and the old shared copy ("N machines waiting")
  // read as nonsense at N=0. `showNoMachinesEmpty` takes priority; `showPressStartEmpty` only applies
  // once at least one machine is actually registered.
  const showNoMachinesEmpty = !isPending && !isError && roster === 0
  const showPressStartEmpty = !isPending && !isError && roster > 0 && !isRunning && !hasCycles
  const online = data?.kpis.online ?? 0
  const fpy = data?.kpis.fpy ?? 0

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={fadeSlideUp}
      className="flex h-full min-h-0 flex-col gap-4 p-4 lg:p-6"
    >
      <div className="flex shrink-0 flex-col gap-1">
        <h1 className="font-heading text-[26px] leading-none font-semibold tracking-tight text-text-strong">
          {t("dashboard.title")}
        </h1>
        <p className="hmi-micro mt-1">{gloss("dashboard.title")}</p>
        <p className="mt-1 text-sm text-text-muted">
          {/* SM-3 fix round 1 (review IMPORTANT 1) — Demo is the ONLY mode that guarantees a fabricated
              roster (see FleetHost.LoadFleet's own SM-1 remarks); every other mode (Live/Auto — the
              product default) must not tell a customer their own real machine's live data is "simulated."
              Task-7 (whole-batch review, small item) — `ecosystem.mode` defaults to `"Live"` BEFORE
              `useEcosystemConnection`'s own `/v1/mode` query resolves (see that hook's own doc comment),
              so reading `.mode` without also checking `.loaded` briefly rendered the Live copy on every
              cold load, including a genuine Demo one — the exact "Live read on your fleet" flash on a
              demo box this fix closes. `EcosystemStatusWidget` already guards this correctly
              (`if (!ecosystem.loaded || ecosystem.mode !== "Live") return null`); this copies that guard
              rather than showing either subtitle on an unresolved mode. */}
          {ecosystem.loaded ? t(ecosystem.mode === "Demo" ? "dashboard.subtitleBaseDemo" : "dashboard.subtitleBaseLive") : ""}
          {roster > 0 ? t("dashboard.subtitleRoster", { roster }) : "."}
        </p>
      </div>

      {/* SM-3 — connection state is a STATUS, not a prerequisite: this renders only in Live mode (never
          in Demo, so the exhibition dashboard stays pixel-identical — see 14-ecosystem-connect.spec.ts),
          collapsed by default so it's visible without ever blocking the real content below, and
          auto-expanded the instant a configured server is actually failing to reach (see
          EcosystemStatusWidget's own remarks). */}
      <EcosystemStatusWidget ecosystem={ecosystem} className="shrink-0" />

      {/* SM-2 — "the UI must not lie": whenever the fleet mixes fabricated (demo) machines with a
          real one, the KPI tiles below already exclude the fabricated fleet from totalCycles/fpy (see
          FleetHost.Snapshot's own remarks) even though the tile grid further down still lists it — this
          banner is the visible tell an operator otherwise has no way to notice. */}
      {data?.kpis.hasMixedProvenance ? (
        <p className="hmi-micro shrink-0 border border-border-strong bg-surface-card px-3 py-2 text-text-muted">
          {t("dashboard.mixedProvenance")}
        </p>
      ) : null}

      {showNoMachinesEmpty ? (
        <NoMachinesEmptyState onAddConnector={() => navigate("/connectors")} />
      ) : (
        <>
          <motion.div
            initial="hidden"
            animate="visible"
            variants={staggerContainer}
            className="grid shrink-0 grid-cols-1 gap-4 sm:grid-cols-3"
          >
            {isPending ? (
              <>
                <KpiTileSkeleton />
                <KpiTileSkeleton />
                <KpiTileSkeleton />
              </>
            ) : (
              <>
                <KpiTile
                  label={t("dashboard.kpi.machinesOnline")}
                  labelEn={gloss("dashboard.kpi.machinesOnline")}
                  value={String(online)}
                  unit={`/ ${roster}`}
                  delta={{
                    label:
                      online === roster && roster > 0
                        ? t("dashboard.kpi.onlineAll")
                        : online > 0
                          ? t("dashboard.kpi.onlineNotYet", { count: roster - online })
                          : t("dashboard.kpi.onlineNone"),
                    // I-12: a fleet mid-start is a normal transient boot state, not a warning — every
                    // fleet passes through "some online" at every startup. `warn` here desensitizes the
                    // operator to amber; `info` (routes to the neutral tone, see DELTA_TONE) reads as "in
                    // progress" instead.
                    status: online === roster && roster > 0 ? "ok" : online > 0 ? "info" : "neutral",
                  }}
                />
                <KpiTile label={t("dashboard.kpi.totalCycles")} labelEn={gloss("dashboard.kpi.totalCycles")} value={totalCycles.toLocaleString()}>
                  <Sparkline data={cycleHistory} height={36} className="-mx-1" />
                </KpiTile>
                <KpiTile
                  label={t("dashboard.kpi.fpy")}
                  labelEn={gloss("dashboard.kpi.fpy")}
                  value={(fpy * 100).toFixed(1)}
                  unit="%"
                  gaugePct={hasCycles ? fpy * 100 : undefined}
                  delta={
                    hasCycles ? fpyDelta(t, fpy) : { label: t("dashboard.kpi.fpyNoCycles"), status: "neutral" }
                  }
                />
              </>
            )}
          </motion.div>

          {showPressStartEmpty ? (
            <EmptyState
              onStart={() =>
                startFleet.mutate(undefined, { onSuccess: () => toast.success(t("toast.fleetStarted")) })
              }
              pending={startFleet.isPending}
              roster={roster}
            />
          ) : (
            <div className="hmi-scroll min-h-0 flex-1 overflow-y-auto">
              <motion.div
                initial="hidden"
                animate="visible"
                variants={staggerContainer}
                className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
              >
                {isPending
                  ? Array.from({ length: 8 }, (_, i) => <MachineCardSkeleton key={i} />)
                  : (data?.machines ?? []).map((machine) => (
                      <MachineCard key={machine.code} machine={machine} isRunning={isRunning} onOpen={openMachine} />
                    ))}
              </motion.div>
            </div>
          )}
        </>
      )}

      {isError ? <p className="shrink-0 text-sm text-danger-text">{t("common.connectivityError")}</p> : null}
    </motion.div>
  )
}
