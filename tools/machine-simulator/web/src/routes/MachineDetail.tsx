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
  SlidersHorizontal,
} from "lucide-react"
import type { VariantProps } from "class-variance-authority"
import { Link, useParams } from "wouter"

import { useGloss } from "@/components/hmi/bilingual"
import { useT } from "@/i18n"
import { EngineApiError, useMachine, type DeviceClass, type MachineDetail as MachineDetailDto } from "@/lib/api"
import { driverKindLabel } from "@/lib/driverKind"
import { fadeSlideUp } from "@/theme/motion"
import { Sheet } from "@/components/industrial"
import { buttonVariants } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusBadge, type statusBadgeVariants } from "@/components/ui/status-badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { BoardView } from "@/components/BoardView"
import { ConfigSyncPanel } from "@/components/ConfigSyncPanel"
import { CycleLogTable, formatCycleTime, verdictMeta } from "@/components/CycleLogTable"
import { MachineSettingsPanel } from "@/components/MachineSettingsPanel"
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

function HeaderStat({ label, labelEn, value }: { label: string; labelEn: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      {/* Stacked, not inline — same H3c fix as Machines.tsx's filter labels: both languages uppercase
          on one line read as a single garbled string. */}
      <span className="flex flex-col gap-0">
        <span className="truncate text-[11px] leading-tight font-medium text-text-body">{label}</span>
        <span className="hmi-micro truncate">{labelEn}</span>
      </span>
      <span className="font-heading text-xl leading-none font-semibold tabular-nums text-text-strong">{value}</span>
    </div>
  )
}

function DetailSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6 lg:p-8">
      <Skeleton className="h-4 w-32" />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Skeleton className="size-11 shrink-0" />
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
      <Sheet className="min-h-0 flex-1" bodyClassName="flex flex-col gap-4">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-72 w-full" />
      </Sheet>
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
        <Sheet className="max-w-md" bodyClassName="flex flex-col items-center gap-3 py-10 text-center">
          <div className="flex size-12 items-center justify-center border border-danger/40 bg-danger/10">
            <ServerCrash className="size-6 text-danger-text" aria-hidden="true" />
          </div>
          <h1 className="text-lg font-semibold text-text-strong">{t("machineDetail.notFoundState.title")}</h1>
          <p className="text-sm text-text-muted">{t("machineDetail.notFoundState.description", { code })}</p>
        </Sheet>
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
  const gloss = useGloss()
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
      className="flex flex-1 flex-col gap-4 p-4 lg:p-6"
    >
      <BackLink />

      <div className="flex shrink-0 flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center border border-border-strong bg-surface-card">
            <HeaderIcon className="size-5 text-primary-text" aria-hidden="true" />
          </div>
          <div className="flex flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-heading text-[28px] leading-none font-semibold tracking-tight text-text-strong">
                {machine.code}
              </h1>
              <StatusBadge status={statusMeta.status}>{statusMeta.label}</StatusBadge>
            </div>
            <p className="hmi-micro mt-1">
              {t(`deviceClass.${machine.class}`)} · {driverKindLabel(t, machine.driverKind)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <HeaderStat
            label={t("machineDetail.headerCycles")}
            labelEn={gloss("machineDetail.headerCycles")}
            value={machine.cycles.toLocaleString()}
          />
          <HeaderStat
            label={t("machineDetail.headerPassRate")}
            labelEn={gloss("machineDetail.headerPassRate")}
            value={passRateApplicable ? `${(machine.passRate * 100).toFixed(1)}%` : "—"}
          />
          {/* H2 — entry point to the machine's full-screen HMI operator panel; the primary CTA on
              this page, styled with the same navy-fill treatment as the app's own primary button
              (not a quiet hairline link) — "obvious route" per spec. */}
          <Link href={`/hmi/${encodeURIComponent(machine.code)}`} className={buttonVariants({ variant: "default" })}>
            <Gauge className="size-3.5" aria-hidden="true" />
            {t("hmi.entryButton")}
          </Link>
        </div>
      </div>

      <Sheet bodyClassName="p-3">
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
            <TabsTrigger value="settings">
              <SlidersHorizontal className="size-3.5" aria-hidden="true" data-icon="inline-start" />
              {t("machineDetail.tabs.settings")}
            </TabsTrigger>
            <TabsTrigger value="log">
              <History className="size-3.5" aria-hidden="true" data-icon="inline-start" />
              {t("machineDetail.tabs.log")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="pt-4">
            <motion.div initial="hidden" animate="visible" variants={fadeSlideUp} className="flex flex-col gap-4">
                <div className="grid grid-cols-1 gap-px border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
                  <div className="bg-surface-card p-4">
                    <p className="text-xs text-text-muted">
                      {t("machineDetail.overview.status")} <span className="hmi-micro">{gloss("machineDetail.overview.status")}</span>
                    </p>
                    <StatusBadge status={statusMeta.status} className="mt-1.5">
                      {statusMeta.label}
                    </StatusBadge>
                  </div>
                  <div className="bg-surface-card p-4">
                    <p className="text-xs text-text-muted">
                      {t("machineDetail.overview.driver")} <span className="hmi-micro">{gloss("machineDetail.overview.driver")}</span>
                    </p>
                    <p className="font-heading mt-1 text-xl leading-none font-semibold text-text-strong">
                      {driverKindLabel(t, machine.driverKind)}
                    </p>
                  </div>
                  <div className="bg-surface-card p-4">
                    <p className="text-xs text-text-muted">
                      {t("machineDetail.overview.cycles")} <span className="hmi-micro">{gloss("machineDetail.overview.cycles")}</span>
                    </p>
                    <p className="font-heading font-numeric mt-1 text-xl leading-none font-semibold tabular-nums text-text-strong">
                      {machine.cycles.toLocaleString()}
                    </p>
                  </div>
                  <div className="bg-surface-card p-4">
                    <p className="text-xs text-text-muted">
                      {t("machineDetail.overview.passRate")} <span className="hmi-micro">{gloss("machineDetail.overview.passRate")}</span>
                    </p>
                    <p className="font-heading font-numeric mt-1 text-xl leading-none font-semibold tabular-nums text-text-strong">
                      {passRateApplicable ? `${(machine.passRate * 100).toFixed(1)}%` : "—"}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div className="border border-border bg-surface-card p-4">
                    <div className="flex flex-col gap-1.5">
                      <h3 className="font-heading text-sm font-semibold text-text-strong">
                        {t("machineDetail.overview.lastConfigSync")}
                      </h3>
                      <p className="font-numeric text-sm text-text-muted">{machine.driftState}</p>
                    </div>
                  </div>
                  <div className="border border-border bg-surface-card p-4">
                    <div className="flex flex-col gap-2">
                      <h3 className="font-heading text-sm font-semibold text-text-strong">
                        {t("machineDetail.overview.recentCycles")}
                      </h3>
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
                    </div>
                  </div>
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

            {/* Task 5 (docs/plans/2026-07-21-machine-config.md) — machine operating-configuration,
                same source of truth as the HMI's own CÀI ĐẶT/SETTINGS tab (`SettingsTab.tsx`), for
                someone looking from the office rather than standing at the machine. */}
            <TabsContent value="settings" className="pt-4">
              <motion.div initial="hidden" animate="visible" variants={fadeSlideUp}>
                <Sheet className="max-w-4xl" bodyClassName="flex flex-col p-0">
                  <MachineSettingsPanel machineCode={machine.code} deviceClass={machine.class} attributedAs="detail" />
                </Sheet>
              </motion.div>
            </TabsContent>

          <TabsContent value="log" className="pt-4">
            <motion.div initial="hidden" animate="visible" variants={fadeSlideUp}>
              <CycleLogTable rows={machine.cycleLog} />
            </motion.div>
          </TabsContent>
        </Tabs>
      </Sheet>
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
