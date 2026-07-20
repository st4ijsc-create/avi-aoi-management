import * as React from "react"
import { Link, useParams } from "wouter"

import { Sheet, type StatusLampState } from "@/components/industrial"
import { ControlColumn } from "@/components/hmi/ControlColumn"
import { Nameplate } from "@/components/hmi/Nameplate"
import { ProductionProgress } from "@/components/hmi/ProductionProgress"
import { ReadoutGrid } from "@/components/hmi/ReadoutGrid"
import { SchematicPanel } from "@/components/hmi/SchematicPanel"
import type { AoiSchematicPoint } from "@/components/hmi/schematics/AoiSchematic"
import { SystemLog, type HmiLocalLogEvent } from "@/components/hmi/SystemLog"
import { useGloss } from "@/components/hmi/bilingual"
import { parseKeyMetric } from "@/components/hmi/derive"
import { useT } from "@/i18n"
import {
  EngineApiError,
  useFleetIsRunning,
  useMachine,
  useStartFleet,
  useStopFleet,
} from "@/lib/api"
import { useMachineConfigCheck, useProduct, useProductPoints } from "@/lib/configApi"

// Same StatusText → lamp-state map every other screen in this app already carries its own copy of
// (see MachineDetail.tsx/Machines.tsx/MachineCard.tsx's identical comment on their own copies) — the
// engine's own verdict label (MachineState.cs), not re-derived.
const STATUS_KEY: Record<string, string> = {
  Idle: "status.idle",
  OK: "status.ok",
  WARN: "status.warn",
  FAIL: "status.fail",
  TELEMETRY: "status.telemetry",
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

let localEventSeq = 0
function nextLocalId(): string {
  localEventSeq += 1
  return `local-${localEventSeq}`
}

function LoadingKiosk() {
  return (
    <div className="flex h-svh w-full items-center justify-center bg-surface-subtle">
      <div className="hmi-micro">Loading…</div>
    </div>
  )
}

function ErrorKiosk({ title, description }: { title: string; description: string }) {
  const t = useT()
  return (
    <div className="flex h-svh w-full flex-col items-center justify-center gap-3 bg-surface-subtle px-6 text-center">
      <h1 className="font-heading text-2xl font-semibold text-text-strong">{title}</h1>
      <p className="max-w-md text-sm text-text-muted">{description}</p>
      <Link
        href="/machines"
        className="mt-2 border border-border-strong px-3 py-1.5 text-sm text-text-body hover:border-navy-600 hover:text-navy-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
      >
        {t("machines.title")}
      </Link>
    </div>
  )
}

/**
 * H2 — the HMI operator panel (`/hmi/:code`, docs/HMI_DESIGN_SPEC.md §4/§6/§7/§8). Renders OUTSIDE
 * `<Shell>` (see `App.tsx`) — a genuine full-screen kiosk shell, not the app's own sidebar/topbar
 * chrome, matching a real machine's operator panel. The page itself never scrolls (`h-svh
 * overflow-hidden`); the schematic/readout column and the system log each scroll internally.
 */
export default function Hmi() {
  const { code } = useParams<{ code: string }>()
  const t = useT()
  const gloss = useGloss()

  const { data: machine, isPending, isError, error } = useMachine(code)
  const fleetIsRunning = useFleetIsRunning()
  const startFleet = useStartFleet()
  const stopFleet = useStopFleet()

  const [estopEngaged, setEstopEngaged] = React.useState(false)
  const [localEvents, setLocalEvents] = React.useState<HmiLocalLogEvent[]>([])

  // A fresh machine code (navigating from one HMI straight to another) must not inherit the previous
  // machine's fault latch or log — `wouter` reuses this component instance across a param change since
  // it's the same route/component, so this doesn't happen for free.
  React.useEffect(() => {
    setEstopEngaged(false)
    setLocalEvents([])
  }, [code])

  const isAoi = machine?.class === "AoiAvi"
  const configCheck = useMachineConfigCheck(isAoi ? code : undefined)
  const productCode = configCheck.data?.products?.[0]?.productModelCode
  const product = useProduct(productCode)
  const productPoints = useProductPoints(productCode)

  const aoiPoints = React.useMemo<AoiSchematicPoint[]>(() => {
    if (!productPoints.data) return []
    const sorted = [...productPoints.data]
      .filter((p) => !p.deletedAt)
      .sort((a, b) => a.orderIndex - b.orderIndex)
    const boardPoints = machine?.boardPoints ?? []
    const imgW = product.data?.imageWidth ?? null
    const imgH = product.data?.imageHeight ?? null
    return sorted.map((p, i) => ({
      code: p.code,
      nx: clamp01(p.normalizedX ?? (imgW ? p.positionX / imgW : 0.5)),
      ny: clamp01(p.normalizedY ?? (imgH ? p.positionY / imgH : 0.5)),
      result: boardPoints[i]?.result,
    }))
  }, [productPoints.data, machine?.boardPoints, product.data])

  const running = fleetIsRunning && !estopEngaged

  function pushLocalEvent(level: HmiLocalLogEvent["level"], viMsg: string, enMsg: string) {
    setLocalEvents((prev) => [...prev.slice(-199), { id: nextLocalId(), at: Date.now(), level, vi: viMsg, en: enMsg }])
  }

  function handleStart() {
    startFleet.mutate(undefined, {
      onSuccess: () => pushLocalEvent("ok", t("hmi.log.fleetStarted"), "Fleet started"),
    })
  }

  function handlePause() {
    stopFleet.mutate(undefined, {
      onSuccess: () => pushLocalEvent("warn", t("hmi.log.fleetPaused"), "Fleet paused"),
    })
  }

  function handleEstop() {
    // Real, honest stop — this isn't a cosmetic-only fault state (spec: "it really stops the engine").
    stopFleet.mutate()
    setEstopEngaged(true)
    pushLocalEvent("error", t("hmi.log.estopEngaged"), "E-STOP — fleet stopped, controls locked")
  }

  function handleReset() {
    setEstopEngaged(false)
    pushLocalEvent("ok", t("hmi.log.estopReset"), "RESET — E-STOP cleared")
  }

  if (!code) return <ErrorKiosk title={t("common.connectivityError")} description="" />
  if (isPending) return <LoadingKiosk />
  if (isError) {
    const notFound = error instanceof EngineApiError && error.status === 404
    return notFound ? (
      <ErrorKiosk title={t("machineDetail.notFoundState.title")} description={t("machineDetail.notFoundState.description", { code })} />
    ) : (
      <ErrorKiosk title={t("common.connectivityError")} description="" />
    )
  }
  if (!machine) return <LoadingKiosk />

  const lampState: StatusLampState = estopEngaged
    ? "fault"
    : !fleetIsRunning
      ? "idle"
      : machine.statusText === "FAIL"
        ? "fault"
        : machine.statusText === "WARN"
          ? "warn"
          : machine.statusText === "OK" || machine.statusText === "TELEMETRY"
            ? "run"
            : "idle"

  const lampLabel = estopEngaged ? t("hmi.status.estop") : t(STATUS_KEY[machine.statusText] ?? "status.idle")
  // The nameplate lamp's sub-line (H2b, spec §"lamp + state + sub-line") is deliberately keyed off
  // OPERATIONAL state (is the fleet actually turning) rather than `lampState`'s QUALITY color —
  // those are two different axes. A last-cycle FAIL result colors the lamp "fault" (correctly — the
  // operator needs to see red) but the fleet is very much still running; a sub-line derived from
  // `lampState` alone would misreport that as "Đã dừng" (Stopped) even while cycles keep landing.
  // Only a genuine E-STOP is actually "stopped".
  const lampSub = estopEngaged ? t("hmi.status.sub.fault") : running ? t("hmi.status.sub.run") : t("hmi.status.sub.idle")

  const lastRow = machine.cycleLog.length > 0 ? machine.cycleLog[machine.cycleLog.length - 1] : undefined
  const parsedIotMetric = lastRow ? parseKeyMetric(lastRow.keyMetric) : null
  const iotLatestReading = parsedIotMetric ? `${parsedIotMetric.name}: ${parsedIotMetric.value}${parsedIotMetric.unit}` : undefined

  return (
    <div className="flex h-svh w-full flex-col overflow-hidden bg-surface-subtle text-text-body">
      <Nameplate
        code={machine.code}
        deviceClass={machine.class}
        driverKind={machine.driverKind}
        lampState={lampState}
        lampLabel={lampLabel}
        lampSub={lampSub}
        lampLive={running}
      />

      <div className="flex min-h-0 flex-1 gap-3 p-3">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <SchematicPanel
            className="min-h-0 flex-[1.6]"
            deviceClass={machine.class}
            isRunning={running}
            cycles={machine.cycles}
            aoiProductName={product.data?.name ?? productCode ?? null}
            aoiPoints={aoiPoints}
            iotLatestReading={iotLatestReading}
          />
          <Sheet
            className="hmi-readout-grid min-h-0 flex-1"
            title={t("hmi.readoutPanel.title")}
            titleEn={gloss("hmi.readoutPanel.title")}
            bodyClassName="flex flex-1 min-h-0 flex-col p-0"
          >
            <div
              tabIndex={0}
              className="hmi-scroll min-h-0 flex-1 overflow-y-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-accent)]"
            >
              <ReadoutGrid machine={machine} productLabel={isAoi ? (product.data?.name ?? productCode ?? null) : undefined} />
            </div>
          </Sheet>
        </div>

        <div className="flex w-[320px] shrink-0 flex-col gap-3">
          <ControlColumn
            estopEngaged={estopEngaged}
            isRunning={fleetIsRunning}
            startPending={startFleet.isPending}
            pausePending={stopFleet.isPending}
            onStart={handleStart}
            onPause={handlePause}
            onEstop={handleEstop}
            onReset={handleReset}
          />
          <SystemLog className="min-h-0 flex-1" machineCode={machine.code} localEvents={localEvents} />
        </div>
      </div>

      <ProductionProgress
        className="hmi-production-progress"
        deviceClass={machine.class}
        cycles={machine.cycles}
        passRate={machine.class === "Iot" ? null : machine.passRate}
      />
    </div>
  )
}
