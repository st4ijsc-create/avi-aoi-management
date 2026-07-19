import * as React from "react"
import { motion } from "framer-motion"
import { Activity, Gauge, PlayCircle, Radio } from "lucide-react"
import { toast } from "sonner"
import { useLocation } from "wouter"

import { useT } from "@/i18n"
import { useFleet, useFleetIsRunning, useStartFleet } from "@/lib/api"
import { fadeSlideUp, staggerContainer } from "@/theme/motion"
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
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="flex flex-1 flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border bg-surface-card px-8 py-20 text-center"
    >
      {/* `bg-navy-600/10` (not `bg-navy-50`) — a translucent tint adapts to dark mode; the raw
          navy-50 swatch has no dark override and rendered as a literal near-white circle on the
          dark surface. */}
      <div className="flex size-14 items-center justify-center rounded-full bg-navy-600/10">
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
        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-navy-600 px-3 text-sm font-medium text-white transition-colors hover:bg-navy-600/80 focus-visible:ring-3 focus-visible:ring-navy-600/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
      >
        <PlayCircle className="size-3.5" aria-hidden="true" />
        {pending ? t("dashboard.empty.ctaPending") : t("dashboard.empty.cta")}
      </button>
    </motion.div>
  )
}

export default function Dashboard() {
  const t = useT()
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

  return (
    <motion.div initial="hidden" animate="visible" variants={fadeSlideUp} className="flex flex-1 flex-col gap-6 p-6 lg:p-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-text-strong">{t("dashboard.title")}</h1>
        <p className="text-sm text-text-muted">
          {t("dashboard.subtitleBase")}
          {roster > 0 ? t("dashboard.subtitleRoster", { roster }) : "."}
        </p>
      </div>

      <motion.div
        initial="hidden"
        animate="visible"
        variants={staggerContainer}
        className="grid grid-cols-1 gap-4 sm:grid-cols-3"
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
              icon={Radio}
              label={t("dashboard.kpi.machinesOnline")}
              value={String(online)}
              unit={`/ ${roster}`}
              delta={{
                label:
                  online === roster && roster > 0
                    ? t("dashboard.kpi.onlineAll")
                    : online > 0
                      ? t("dashboard.kpi.onlineNotYet", { count: roster - online })
                      : t("dashboard.kpi.onlineNone"),
                status: online === roster && roster > 0 ? "ok" : online > 0 ? "warn" : "neutral",
              }}
            />
            <KpiTile icon={Activity} label={t("dashboard.kpi.totalCycles")} value={totalCycles.toLocaleString()}>
              <Sparkline data={cycleHistory} height={40} className="-mx-1" />
            </KpiTile>
            <KpiTile
              icon={Gauge}
              label={t("dashboard.kpi.fpy")}
              value={((data?.kpis.fpy ?? 0) * 100).toFixed(1)}
              unit="%"
              delta={
                hasCycles ? fpyDelta(t, data?.kpis.fpy ?? 0) : { label: t("dashboard.kpi.fpyNoCycles"), status: "neutral" }
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
        <motion.div
          initial="hidden"
          animate="visible"
          variants={staggerContainer}
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
        >
          {isPending
            ? Array.from({ length: 8 }, (_, i) => <MachineCardSkeleton key={i} />)
            : (data?.machines ?? []).map((machine) => (
                <MachineCard
                  key={machine.code}
                  machine={machine}
                  isRunning={isRunning}
                  onOpen={openMachine}
                />
              ))}
        </motion.div>
      )}

      {isError ? <p className="text-sm text-danger-text">{t("common.connectivityError")}</p> : null}
    </motion.div>
  )
}
