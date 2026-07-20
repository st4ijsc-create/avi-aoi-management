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
  // H2c: enabled for EVERY class now, not just AOI — `ConfigSyncEngine.CheckAsync` resolves
  // `configKind` (`points` for AOI/AVI, `recipe` for Automation/IoT) off the machine's own
  // `DeviceClass` server-side, so this single call already covers all three; the CONFIG STATE tile
  // below was permanently "—" before this pass precisely because nothing populated it for the two
  // non-AOI classes (and `machine.driftState` itself only reflects a manual sync-config action THIS
  // session, not the real always-on checksum drift this hook exposes).
  const configCheck = useMachineConfigCheck(code)
  const productCode = configCheck.data?.products?.[0]?.productModelCode
  const product = useProduct(productCode)
  const productPoints = useProductPoints(productCode)

  // Real checksum-based config-sync drift (`in_sync | drift | unknown`) — `ConfigDtos.cs`'s
  // `MachineConfigCheckDto`: exactly one of `products`/`recipe` is populated per `configKind`.
  const configDriftState: string | null = configCheck.data
    ? configCheck.data.configKind === "points"
      ? (configCheck.data.products[0]?.driftState ?? null)
      : (configCheck.data.recipe?.driftState ?? null)
    : null

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

  // H2c SAFETY FIX — spec §2: "Status colours are for state only." The nameplate lamp is the ONE
  // glance-able safety indicator on the whole screen; it must reflect whether the MACHINE ITSELF is
  // faulted (E-STOP), not the QUALITY VERDICT of whatever board/cycle it last judged. The previous
  // version keyed `lampState` off `machine.statusText` (Idle/OK/WARN/FAIL/TELEMETRY — the LAST
  // CYCLE'S pass/fail result, same enum the "Status" readout tile below uses) — a machine that just
  // judged one NG board wore the fault-red dome and the label "Lỗi" while its own sub-line correctly
  // said "Đang vận hành" (Running), a direct contradiction an operator must never see: red means
  // "stop, this machine needs help," not "the last part happened to fail inspection." The last
  // cycle's verdict still needs a home — it lives in the readout grid (`ReadoutGrid.tsx`'s "Status"/
  // AOI's now-added verdict tile), never on the lamp.
  const lampState: StatusLampState = estopEngaged ? "fault" : running ? "run" : "idle"
  const lampLabel = estopEngaged ? t("hmi.status.estop") : running ? t("hmi.status.sub.run") : t("hmi.status.sub.idle")
  const lampSub = estopEngaged ? t("hmi.status.sub.fault") : undefined

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
              <ReadoutGrid
                machine={machine}
                productLabel={isAoi ? (product.data?.name ?? productCode ?? null) : undefined}
                configDriftState={configDriftState}
              />
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
