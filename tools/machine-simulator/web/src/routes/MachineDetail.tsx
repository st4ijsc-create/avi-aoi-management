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

import { EngineApiError, useMachine, type DeviceClass, type DriverKind, type MachineDetail as MachineDetailDto } from "@/lib/api"
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

// StatusText is the engine's own verdict label (MachineState.cs) — same map as MachineCard's.
const STATUS_META: Record<string, { status: BadgeStatus; label: string }> = {
  Idle: { status: "neutral", label: "Idle" },
  OK: { status: "ok", label: "OK" },
  WARN: { status: "warn", label: "Warn" },
  FAIL: { status: "danger", label: "Fail" },
  TELEMETRY: { status: "info", label: "Telemetry" },
}

const DEVICE_CLASS_LABEL: Record<DeviceClass, string> = {
  Automation: "Automation",
  Iot: "IoT",
  AoiAvi: "AOI / AVI",
}

const DRIVER_KIND_LABEL: Record<DriverKind, string> = {
  Simulated: "Simulated",
  HotFolderAoi: "Hot-folder AOI",
  Mqtt: "MQTT",
}

const CLASS_ICON: Record<DeviceClass, React.ComponentType<{ className?: string }>> = {
  Automation: Cog,
  Iot: Radio,
  AoiAvi: ScanEye,
}

type TabId = "overview" | "spc" | "telemetry" | "board" | "config" | "log"

function primaryTabFor(deviceClass: DeviceClass): { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> } {
  if (deviceClass === "Automation") return { id: "spc", label: "SPC", icon: LineChartIcon }
  if (deviceClass === "Iot") return { id: "telemetry", label: "Telemetry", icon: Radio }
  return { id: "board", label: "Board", icon: ScanEye }
}

function BackLink() {
  return (
    <Link
      href="/"
      className="inline-flex w-fit items-center gap-1.5 rounded-md text-sm text-text-muted transition-colors hover:text-navy-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-600"
    >
      <ArrowLeft className="size-3.5" aria-hidden="true" />
      Back to dashboard
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
            <h1 className="text-lg font-semibold text-text-strong">Machine not found</h1>
            <p className="text-sm text-text-muted">
              No machine with code <span className="font-numeric font-medium text-text-body">{code}</span> is
              registered in this fleet. It may not have started yet, or the code was mistyped.
            </p>
          </CardContent>
        </Card>
      </div>
    </motion.div>
  )
}

function ConnectivityErrorState() {
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={fadeSlideUp}
      className="flex flex-1 flex-col gap-6 p-6 lg:p-8"
    >
      <BackLink />
      <p className="text-sm text-danger-text">
        Could not reach the engine at the configured URL — check that St4i.EngineApi is running.
      </p>
    </motion.div>
  )
}

function MachineDetailBody({ machine }: { machine: MachineDetailDto }) {
  const statusMeta = STATUS_META[machine.statusText] ?? { status: "neutral" as const, label: machine.statusText }
  const HeaderIcon = CLASS_ICON[machine.class]
  const primaryTab = primaryTabFor(machine.class)
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
          <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-navy-50">
            <HeaderIcon className="size-5 text-navy-600" aria-hidden="true" />
          </div>
          <div className="flex flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold text-text-strong">{machine.code}</h1>
              <StatusBadge status={statusMeta.status}>{statusMeta.label}</StatusBadge>
            </div>
            <p className="text-sm text-text-muted">
              {DEVICE_CLASS_LABEL[machine.class]} · {DRIVER_KIND_LABEL[machine.driverKind]}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <HeaderStat label="Cycles" value={machine.cycles.toLocaleString()} />
          <HeaderStat
            label="Pass rate"
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
                Overview
              </TabsTrigger>
              <TabsTrigger value={primaryTab.id}>
                <primaryTab.icon className="size-3.5" aria-hidden="true" data-icon="inline-start" />
                {primaryTab.label}
              </TabsTrigger>
              <TabsTrigger value="config">
                <RefreshCw className="size-3.5" aria-hidden="true" data-icon="inline-start" />
                Config
              </TabsTrigger>
              <TabsTrigger value="log">
                <History className="size-3.5" aria-hidden="true" data-icon="inline-start" />
                Log
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="pt-4">
              <motion.div initial="hidden" animate="visible" variants={fadeSlideUp} className="flex flex-col gap-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-lg bg-surface-subtle p-4">
                    <p className="text-xs text-text-muted">Status</p>
                    <StatusBadge status={statusMeta.status} className="mt-1.5">
                      {statusMeta.label}
                    </StatusBadge>
                  </div>
                  <div className="rounded-lg bg-surface-subtle p-4">
                    <p className="text-xs text-text-muted">Driver</p>
                    <p className="mt-1 text-lg font-semibold text-text-strong">
                      {DRIVER_KIND_LABEL[machine.driverKind]}
                    </p>
                  </div>
                  <div className="rounded-lg bg-surface-subtle p-4">
                    <p className="text-xs text-text-muted">Cycles</p>
                    <p className="font-numeric mt-1 text-lg font-semibold text-text-strong">
                      {machine.cycles.toLocaleString()}
                    </p>
                  </div>
                  <div className="rounded-lg bg-surface-subtle p-4">
                    <p className="text-xs text-text-muted">Pass rate</p>
                    <p className="font-numeric mt-1 text-lg font-semibold text-text-strong">
                      {passRateApplicable ? `${(machine.passRate * 100).toFixed(1)}%` : "—"}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <Card size="sm">
                    <CardContent className="flex flex-col gap-1.5">
                      <h3 className="text-sm font-semibold text-text-strong">Last config sync</h3>
                      <p className="font-numeric text-sm text-text-muted">{machine.driftState}</p>
                    </CardContent>
                  </Card>
                  <Card size="sm">
                    <CardContent className="flex flex-col gap-2">
                      <h3 className="text-sm font-semibold text-text-strong">Recent cycles</h3>
                      {machine.cycleLog.length === 0 ? (
                        <p className="text-sm text-text-muted">No cycles logged yet.</p>
                      ) : (
                        <ul className="flex flex-col gap-1.5">
                          {[...machine.cycleLog]
                            .reverse()
                            .slice(0, 5)
                            .map((row, i) => {
                              const meta = verdictMeta(row.verdict)
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
                <ConfigSyncPanel code={machine.code} driftState={machine.driftState} className="max-w-xl" />
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
