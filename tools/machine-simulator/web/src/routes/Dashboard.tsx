import * as React from "react"
import { motion } from "framer-motion"
import { PlayCircle } from "lucide-react"
import { toast } from "sonner"
import { useLocation } from "wouter"

import { useGloss } from "@/components/hmi/bilingual"
import { useT } from "@/i18n"
import { useFleet, useFleetIsRunning, useStartFleet } from "@/lib/api"
import { fadeSlideUp, staggerContainer } from "@/theme/motion"
import { Sheet } from "@/components/industrial"
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
        <button
          type="button"
          onClick={onStart}
          disabled={pending}
          className="inline-flex h-8 items-center gap-1.5 border border-navy-800 bg-navy-700 px-3 text-xs font-semibold tracking-wide text-white uppercase transition-colors hover:bg-navy-600 focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
        >
          <PlayCircle className="size-3.5" aria-hidden="true" />
          {pending ? t("dashboard.empty.ctaPending") : t("dashboard.empty.cta")}
        </button>
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
  const showEmpty = !isPending && !isError && !isRunning && !hasCycles
  const roster = data?.machines.length ?? 0
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
          {t("dashboard.subtitleBase")}
          {roster > 0 ? t("dashboard.subtitleRoster", { roster }) : "."}
        </p>
      </div>

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

      {showEmpty ? (
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

      {isError ? <p className="shrink-0 text-sm text-danger-text">{t("common.connectivityError")}</p> : null}
    </motion.div>
  )
}
