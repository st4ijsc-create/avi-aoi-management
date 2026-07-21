import * as React from "react"
import { Link, useParams } from "wouter"

import { Sheet, type StatusLampState } from "@/components/industrial"
import { ControlColumn } from "@/components/hmi/ControlColumn"
import { Nameplate } from "@/components/hmi/Nameplate"
import { OutputCard } from "@/components/hmi/OutputCard"
import { ReadoutGrid } from "@/components/hmi/ReadoutGrid"
import { SchematicPanel } from "@/components/hmi/SchematicPanel"
import type { AoiSchematicPoint } from "@/components/hmi/schematics/AoiSchematic"
import { SystemLog, type HmiLocalLogEvent } from "@/components/hmi/SystemLog"
import { useGloss } from "@/components/hmi/bilingual"
import { parseKeyMetric } from "@/components/hmi/derive"
import { useT } from "@/i18n"
import {
  EngineApiError,
  useEstopFleet,
  useFleetEstopEngaged,
  useFleetIsRunning,
  useMachine,
  useResetEstop,
  useStartFleet,
  useStopFleet,
  type DeviceClass,
} from "@/lib/api"
import { useMachineConfigCheck, useProduct, useProductPoints } from "@/lib/configApi"
import { useInspectorStream } from "@/lib/inspector"

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

/**
 * H5 — layout spec §8's "adapt proportions per machine class rather than copying the reference's
 * fixed split blindly": `[schematicFlex, readoutFlex]` grow ratios for the two flexible left columns
 * (the third, control-rail column is a fixed width — see the render below). AOI gets the extra room
 * (its board + real measurement-point dots need to stay legible, spec §7: "make this the strongest
 * one"); IoT gives room back to the readout grid instead, since its wireframe (a node, a link, an
 * uplink) is comparatively sparse and doesn't need the width; Automation splits evenly.
 */
const SCHEMATIC_READOUT_FLEX: Record<DeviceClass, [number, number]> = {
  Automation: [1, 1],
  AoiAvi: [1.15, 1],
  Iot: [0.85, 1.15],
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
  // C-2: server-owned, shared across every panel/tab — no longer this component instance's own React
  // state, so navigating to another machine's panel (or an F5) can no longer silently drop an active
  // E-STOP the way local state did.
  const estopEngaged = useFleetEstopEngaged()
  const startFleet = useStartFleet()
  const stopFleet = useStopFleet()
  const estopFleet = useEstopFleet()
  const resetEstop = useResetEstop()

  // H5 — opened ONCE here and shared by the nameplate's connectivity chip AND the system log (both
  // used to open their own independent WS connection to the same endpoint before this).
  const { events: traceEvents, connectionState } = useInspectorStream()

  const [localEvents, setLocalEvents] = React.useState<HmiLocalLogEvent[]>([])

  // A fresh machine code (navigating from one HMI straight to another) must not inherit the previous
  // machine's LOCAL log — `wouter` reuses this component instance across a param change since it's the
  // same route/component, so this doesn't happen for free. The E-STOP latch itself is intentionally
  // NOT reset here anymore (C-2): it's fleet-wide state, and a real emergency stop on one machine's
  // panel must still be in force when an operator switches to another machine's panel.
  React.useEffect(() => {
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

  // I-1 — branch-review: the engine's per-cycle `boardPoints` are generic simulator points
  // (`PT-001`…`PT-020`, `AoiInspectorSim.cs`) that share NO code vocabulary with the product's own
  // configured `MeasurementPoint.code`s (e.g. `P01`) — there is no engine-side link between "this
  // cycle's board result" and "this specific configured point." The previous build zipped the two
  // lists BY ARRAY INDEX, which put a real NG verdict's colour on a specific, named, wrong physical
  // location (live-reproduced: an NG at board index 9 painted product point `P03` red, and the NG at
  // index 9 itself was silently dropped whenever the product had fewer than 10 configured points).
  // Per the review's second remediation option: positions stay real (`nx`/`ny` come straight from
  // the product's own config, unchanged below); no dot is coloured by an unverifiable per-point
  // match — `aoiPoints` below carries ONLY position + code, never a `result`. The real per-cycle
  // verdict is instead surfaced as an honest AGGREGATE (`aoiUnlocatedDefects`, computed straight from
  // `machine.boardPoints` with no product-point involvement at all) plus a disclosure caption on the
  // schematic itself — see `AoiSchematic.tsx`'s own remarks.
  const aoiPoints = React.useMemo<AoiSchematicPoint[]>(() => {
    if (!productPoints.data) return []
    const sorted = [...productPoints.data]
      .filter((p) => !p.deletedAt)
      .sort((a, b) => a.orderIndex - b.orderIndex)
    const imgW = product.data?.imageWidth ?? null
    const imgH = product.data?.imageHeight ?? null
    return sorted.map((p) => ({
      code: p.code,
      nx: clamp01(p.normalizedX ?? (imgW ? p.positionX / imgW : 0.5)),
      ny: clamp01(p.normalizedY ?? (imgH ? p.positionY / imgH : 0.5)),
    }))
  }, [productPoints.data, product.data])

  const aoiUnlocatedDefects = React.useMemo(
    () => (machine?.boardPoints ?? []).filter((p) => p.result === "NG").length,
    [machine?.boardPoints]
  )

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
    // C-2/C-3 — a real, confirmed, server-latched stop (spec: "it really stops the engine"). The
    // mutation's `onSuccess` firing IS the confirmation the machine actually stopped; the previous
    // version latched and logged success unconditionally on a fire-and-forget POST with no `onError`,
    // so a failed request still told the operator the machine was safely stopped.
    estopFleet.mutate(undefined, {
      onSuccess: () => pushLocalEvent("error", t("hmi.log.estopEngaged"), "E-STOP — fleet stopped, controls locked"),
      onError: () =>
        pushLocalEvent("error", t("hmi.log.estopFailed"), "E-STOP COMMAND FAILED — engine did not confirm the stop"),
    })
  }

  function handleReset() {
    resetEstop.mutate(undefined, {
      onSuccess: () => pushLocalEvent("ok", t("hmi.log.estopReset"), "RESET — E-STOP cleared"),
      onError: () => pushLocalEvent("error", t("hmi.log.estopResetFailed"), "RESET FAILED — E-STOP still latched"),
    })
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

  const [schematicFlex, readoutFlex] = SCHEMATIC_READOUT_FLEX[machine.class]

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
        connectionState={connectionState}
      />

      {/*
        H5 — Scheme A, three-column SCADA layout (layout spec §8, closing gap 1/3/4): the schematic
        and the readout grid are now SIBLING columns (read side-by-side, not schematic-above-readouts
        in one shared column) and the third column is a fixed-width, FULL-HEIGHT control rail — the
        output card sits at ITS top (gap 3: promoted out of the old 29px footer), `ControlColumn`
        fills the rest (gap 2: no longer squeezed to less height than the log). The system log itself
        moves OUT of this row entirely into its own full-width band below (gap 2/reference §1.2's
        "alarm banner" convention) — a tab rail belongs directly under the nameplate, ahead of this
        row, once a later task adds one (spec §8 note); this row's own `min-h-0` + each child's
        internal `hmi-scroll` is what keeps the WHOLE PAGE from ever scrolling (spec §9) at any of the
        three device classes' proportions.

        H5b — row:log ratio changed 5:1 → 5:1.5 (spec §8.1's own note: "do not shrink the row's share
        below this without re-verifying the control rail's worst-case fit" — this pass DID
        re-verify, live, with an engine `evaluate()` measuring `ControlColumn`'s own `scrollHeight` vs
        `clientHeight` at 1280×800: 5:2 left the rail short by 45px even BEFORE the E-STOP-engaged
        banner added more, i.e. it broke §8.3's fit in the NORMAL state, not just the latched one —
        5:1.5, combined with `ControlColumn.tsx`'s own trimmed padding, is the loosest ratio that keeps
        the rail's unlatched content fitting with real margin at the 1280×800 floor. The old 5:1 log
        band was ~2 visible rows there — not a "persistent band" an operator would actually glance at,
        just a sliver; 5:1.5 gets it to ~3. The H5b schematic fix (this same pass) makes the schematic
        column look "full" via FILL PERCENTAGE, not raw pixels, so giving the log some height back
        doesn't reopen the empty-canvas regression this pass fixes.
      */}
      <div className="flex min-h-0 flex-[5] gap-3 p-3 pb-0">
        <SchematicPanel
          className="min-h-0 min-w-0"
          style={{ flexGrow: schematicFlex, flexBasis: 0 }}
          deviceClass={machine.class}
          isRunning={running}
          cycles={machine.cycles}
          aoiProductName={product.data?.name ?? productCode ?? null}
          aoiPoints={aoiPoints}
          aoiUnlocatedDefects={aoiUnlocatedDefects}
          iotLatestReading={iotLatestReading}
        />

        <Sheet
          className="hmi-readout-grid min-h-0 min-w-0"
          style={{ flexGrow: readoutFlex, flexBasis: 0 }}
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

        <div className="flex w-[336px] shrink-0 flex-col gap-3">
          <OutputCard
            className="shrink-0"
            deviceClass={machine.class}
            cycles={machine.cycles}
            passRate={machine.class === "Iot" ? null : machine.passRate}
          />
          <ControlColumn
            className="min-h-0 flex-1"
            estopEngaged={estopEngaged}
            isRunning={fleetIsRunning}
            startPending={startFleet.isPending}
            pausePending={stopFleet.isPending}
            estopPending={estopFleet.isPending}
            resetPending={resetEstop.isPending}
            onStart={handleStart}
            onPause={handlePause}
            onEstop={handleEstop}
            onReset={handleReset}
          />
        </div>
      </div>

      <SystemLog
        className="hmi-system-log-band m-3 min-h-0 flex-[1.5]"
        machineCode={machine.code}
        localEvents={localEvents}
        events={traceEvents}
        connectionState={connectionState}
      />
    </div>
  )
}
