import * as React from "react"
import { motion } from "framer-motion"
import {
  ArrowLeft,
  Cog,
  Gauge,
  History,
  LineChart as LineChartIcon,
  Radio,
  RefreshCw,
  ScanEye,
  ServerCrash,
} from "lucide-react"
import type { VariantProps } from "class-variance-authority"
import { Link, useParams } from "wouter"

import { useT } from "@/i18n"
import { EngineApiError, useMachine, type DeviceClass, type MachineDetail as MachineDetailDto } from "@/lib/api"
import { fadeSlideUp } from "@/theme/motion"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusBadge, type statusBadgeVariants } from "@/components/ui/status-badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { BoardView } from "@/components/BoardView"
import { ConfigSyncPanel } from "@/components/ConfigSyncPanel"
import { CycleLogTable, formatCycleTime, verdictMeta } from "@/components/CycleLogTable"
import { SpcChart } from "@/components/SpcChart"
import { TelemetryChart } from "@/components/TelemetryChart"

type BadgeStatus = NonNullable<VariantProps<typeof statusBadgeVariants>["status"]>
type T = (key: string, vars?: Record<string, string | number>) => string

// StatusText is the engine's own verdict label (MachineState.cs) — same map as MachineCard's.
const STATUS_META: Record<string, { status: BadgeStatus; key: string }> = {
  Idle: { status: "neutral", key: "status.idle" },
  OK: { status: "ok", key: "status.ok" },
  WARN: { status: "warn", key: "status.warn" },
  FAIL: { status: "danger", key: "status.fail" },
  TELEMETRY: { status: "info", key: "status.telemetry" },
}

function statusMetaFor(t: T, statusText: string): { status: BadgeStatus; label: string } {
  const meta = STATUS_META[statusText]
  return meta ? { status: meta.status, label: t(meta.key) } : { status: "neutral", label: statusText }
}

const CLASS_ICON: Record<DeviceClass, React.ComponentType<{ className?: string }>> = {
  Automation: Cog,
  Iot: Radio,
  AoiAvi: ScanEye,
}

type TabId = "overview" | "spc" | "telemetry" | "board" | "config" | "log"

function primaryTabFor(t: T, deviceClass: DeviceClass): { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> } {
  if (deviceClass === "Automation") return { id: "spc", label: t("machineDetail.tabs.spc"), icon: LineChartIcon }
  if (deviceClass === "Iot") return { id: "telemetry", label: t("machineDetail.tabs.telemetry"), icon: Radio }
  return { id: "board", label: t("machineDetail.tabs.board"), icon: ScanEye }
}

function BackLink() {
  const t = useT()
  return (
    <Link
      href="/"
      className="inline-flex w-fit items-center gap-1.5 rounded-md text-sm text-text-muted transition-colors hover:text-navy-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-600"
    >
      <ArrowLeft className="size-3.5" aria-hidden="true" />
      {t("machineDetail.back")}
    </Link>
  )
}

function HeaderStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-semibold tracking-wide text-text-muted uppercase">{label}</span>
      <span className="font-numeric text-lg font-semibold text-text-strong">{value}</span>
    </div>
  )
}

function DetailSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6 lg:p-8">
      <Skeleton className="h-4 w-32" />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Skeleton className="size-11 shrink-0 rounded-full" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-3.5 w-40" />
          </div>
        </div>
        <div className="flex gap-6">
          <Skeleton className="h-10 w-16" />
          <Skeleton className="h-10 w-16" />
        </div>
      </div>
      <Card className="p-1">
        <CardContent className="flex flex-col gap-4 pt-3">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-72 w-full" />
        </CardContent>
      </Card>
    </div>
  )
}

function NotFoundState({ code }: { code: string }) {
  const t = useT()
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={fadeSlideUp}
      className="flex flex-1 flex-col gap-6 p-6 lg:p-8"
    >
      <BackLink />
      <div className="flex flex-1 items-center justify-center">
        <Card className="max-w-md">
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-danger/10">
              <ServerCrash className="size-6 text-danger-text" aria-hidden="true" />
            </div>
            <h1 className="text-lg font-semibold text-text-strong">{t("machineDetail.notFoundState.title")}</h1>
            <p className="text-sm text-text-muted">{t("machineDetail.notFoundState.description", { code })}</p>
          </CardContent>
        </Card>
      </div>
    </motion.div>
  )
}

function ConnectivityErrorState() {
  const t = useT()
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={fadeSlideUp}
      className="flex flex-1 flex-col gap-6 p-6 lg:p-8"
    >
      <BackLink />
      <p className="text-sm text-danger-text">{t("common.connectivityError")}</p>
    </motion.div>
  )
}

function MachineDetailBody({ machine }: { machine: MachineDetailDto }) {
  const t = useT()
  const statusMeta = statusMetaFor(t, machine.statusText)
  const HeaderIcon = CLASS_ICON[machine.class]
  const primaryTab = primaryTabFor(t, machine.class)
  const passRateApplicable = machine.class !== "Iot"

  return (
    <motion.div
      key={machine.code}
      initial="hidden"
      animate="visible"
      variants={fadeSlideUp}
      className="flex flex-1 flex-col gap-6 p-6 lg:p-8"
    >
      <BackLink />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          {/* `bg-navy-600/10`/`text-primary-text` (not `bg-navy-50`/`text-navy-600`) — dark-mode-adaptive
              tint, see Dashboard.tsx's EmptyState icon badge for the same fix + rationale. */}
          <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-navy-600/10">
            <HeaderIcon className="size-5 text-primary-text" aria-hidden="true" />
          </div>
          <div className="flex flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold text-text-strong">{machine.code}</h1>
              <StatusBadge status={statusMeta.status}>{statusMeta.label}</StatusBadge>
            </div>
            <p className="text-sm text-text-muted">
              {t(`deviceClass.${machine.class}`)} · {t(`driverKind.${machine.driverKind}`)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <HeaderStat label={t("machineDetail.headerCycles")} value={machine.cycles.toLocaleString()} />
          <HeaderStat
            label={t("machineDetail.headerPassRate")}
            value={passRateApplicable ? `${(machine.passRate * 100).toFixed(1)}%` : "—"}
          />
        </div>
      </div>

      <Card className="p-1">
        <CardContent className="pt-3">
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">
                <Gauge className="size-3.5" aria-hidden="true" data-icon="inline-start" />
                {t("machineDetail.tabs.overview")}
              </TabsTrigger>
              <TabsTrigger value={primaryTab.id}>
                <primaryTab.icon className="size-3.5" aria-hidden="true" data-icon="inline-start" />
                {primaryTab.label}
              </TabsTrigger>
              <TabsTrigger value="config">
                <RefreshCw className="size-3.5" aria-hidden="true" data-icon="inline-start" />
                {t("machineDetail.tabs.config")}
              </TabsTrigger>
              <TabsTrigger value="log">
                <History className="size-3.5" aria-hidden="true" data-icon="inline-start" />
                {t("machineDetail.tabs.log")}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="pt-4">
              <motion.div initial="hidden" animate="visible" variants={fadeSlideUp} className="flex flex-col gap-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-lg bg-surface-subtle p-4">
                    <p className="text-xs text-text-muted">{t("machineDetail.overview.status")}</p>
                    <StatusBadge status={statusMeta.status} className="mt-1.5">
                      {statusMeta.label}
                    </StatusBadge>
                  </div>
                  <div className="rounded-lg bg-surface-subtle p-4">
                    <p className="text-xs text-text-muted">{t("machineDetail.overview.driver")}</p>
                    <p className="mt-1 text-lg font-semibold text-text-strong">
                      {t(`driverKind.${machine.driverKind}`)}
                    </p>
                  </div>
                  <div className="rounded-lg bg-surface-subtle p-4">
                    <p className="text-xs text-text-muted">{t("machineDetail.overview.cycles")}</p>
                    <p className="font-numeric mt-1 text-lg font-semibold text-text-strong">
                      {machine.cycles.toLocaleString()}
                    </p>
                  </div>
                  <div className="rounded-lg bg-surface-subtle p-4">
                    <p className="text-xs text-text-muted">{t("machineDetail.overview.passRate")}</p>
                    <p className="font-numeric mt-1 text-lg font-semibold text-text-strong">
                      {passRateApplicable ? `${(machine.passRate * 100).toFixed(1)}%` : "—"}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <Card size="sm">
                    <CardContent className="flex flex-col gap-1.5">
                      <h3 className="text-sm font-semibold text-text-strong">{t("machineDetail.overview.lastConfigSync")}</h3>
                      <p className="font-numeric text-sm text-text-muted">{machine.driftState}</p>
                    </CardContent>
                  </Card>
                  <Card size="sm">
                    <CardContent className="flex flex-col gap-2">
                      <h3 className="text-sm font-semibold text-text-strong">{t("machineDetail.overview.recentCycles")}</h3>
                      {machine.cycleLog.length === 0 ? (
                        <p className="text-sm text-text-muted">{t("cycleLogTable.empty")}</p>
                      ) : (
                        <ul className="flex flex-col gap-1.5">
                          {[...machine.cycleLog]
                            .reverse()
                            .slice(0, 5)
                            .map((row, i) => {
                              const meta = verdictMeta(t, row.verdict)
                              return (
                                <li key={`${row.time}-${i}`} className="flex items-center justify-between gap-2 text-xs">
                                  <span className="font-numeric shrink-0 text-text-muted">
                                    {formatCycleTime(row.time)}
                                  </span>
                                  <span className="truncate text-text-body">{row.serial}</span>
                                  <StatusBadge status={meta.status} className="shrink-0">
                                    {meta.label}
                                  </StatusBadge>
                                </li>
                              )
                            })}
                        </ul>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </motion.div>
            </TabsContent>

            <TabsContent value="spc" className="pt-4">
              <motion.div initial="hidden" animate="visible" variants={fadeSlideUp}>
                <SpcChart values={machine.spc.values} mean={machine.spc.mean} ucl={machine.spc.ucl} lcl={machine.spc.lcl} />
              </motion.div>
            </TabsContent>

            <TabsContent value="telemetry" className="pt-4">
              <motion.div initial="hidden" animate="visible" variants={fadeSlideUp}>
                <TelemetryChart series={machine.telemetry} />
              </motion.div>
            </TabsContent>

            <TabsContent value="board" className="pt-4">
              <motion.div initial="hidden" animate="visible" variants={fadeSlideUp}>
                <BoardView points={machine.boardPoints} />
              </motion.div>
            </TabsContent>

            <TabsContent value="config" className="pt-4">
              <motion.div initial="hidden" animate="visible" variants={fadeSlideUp}>
                <ConfigSyncPanel code={machine.code} deviceClass={machine.class} className="max-w-4xl" />
              </motion.div>
            </TabsContent>

            <TabsContent value="log" className="pt-4">
              <motion.div initial="hidden" animate="visible" variants={fadeSlideUp}>
                <CycleLogTable rows={machine.cycleLog} />
              </motion.div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </motion.div>
  )
}

export default function MachineDetail() {
  const { code } = useParams<{ code: string }>()
  const { data, isPending, isError, error } = useMachine(code)

  if (!code) return <ConnectivityErrorState />
  if (isPending) return <DetailSkeleton />

  if (isError) {
    const notFound = error instanceof EngineApiError && error.status === 404
    return notFound ? <NotFoundState code={code} /> : <ConnectivityErrorState />
  }

  // `data` is guaranteed by `!isPending && !isError` above, but destructuring the query result
  // breaks TanStack Query's discriminated-union narrowing between separately-bound `data`/`isPending`/
  // `isError` variables — this guard satisfies the type checker with the same guarantee, and is a
  // legitimate belt-and-suspenders check besides (a `success` status with `undefined` data isn't a
  // state this app's queries produce, but "loop back to the skeleton" is a safe fallback if it ever did).
  if (!data) return <DetailSkeleton />

  return <MachineDetailBody machine={data} />
}
