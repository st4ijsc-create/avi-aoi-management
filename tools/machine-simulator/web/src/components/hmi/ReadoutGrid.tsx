import type { ReactNode } from "react"

import { Readout, type ReadoutTone } from "@/components/industrial"
import { useGloss } from "@/components/hmi/bilingual"
import { avgCycleIntervalMs, cycleRatePerMin, observedSpanLabel, parseKeyMetric } from "@/components/hmi/derive"
import { useT } from "@/i18n"
import type { MachineDetail as MachineDetailDto } from "@/lib/api"
import { cn, formatMetric } from "@/lib/utils"

const STATUS_KEY: Record<string, string> = {
  Idle: "status.idle",
  OK: "status.ok",
  WARN: "status.warn",
  FAIL: "status.fail",
  TELEMETRY: "status.telemetry",
}

const STATUS_TONE: Record<string, ReadoutTone> = {
  Idle: "idle",
  OK: "run",
  WARN: "warn",
  FAIL: "fault",
  TELEMETRY: "neutral",
}

function passRateTone(passRate: number): ReadoutTone {
  if (passRate >= 0.95) return "run"
  if (passRate >= 0.8) return "warn"
  return "fault"
}

/** H2c: the CONFIG STATE tile's real drift→tone mapping — `in_sync → run, drift → warn, unknown →
 * idle` (the status ramp, per spec §2, used for what it's actually for: state). */
const CONFIG_DRIFT_TONE: Record<string, ReadoutTone> = {
  in_sync: "run",
  drift: "warn",
  unknown: "idle",
}

/** Reuses the SAME driftState copy the machine's own Config Sync panel already shows
 * (`configSyncPanel.driftState.*`) rather than inventing HMI-local wording for `in_sync`/`drift`/
 * `unknown` — one vocabulary for this concept across the whole app. */
const CONFIG_DRIFT_LABEL_KEY: Record<string, string> = {
  in_sync: "configSyncPanel.driftState.in_sync",
  drift: "configSyncPanel.driftState.drift",
  unknown: "configSyncPanel.driftState.unknown",
}

interface TileDef {
  key: string
  value: ReactNode
  unit?: ReactNode
  labelKey: string
  sub?: ReactNode
  tone?: ReadoutTone
  gaugePct?: number
  /** `"text"` for enum/string tiles (status word, driver, config state, product name, defect code) —
   * see `<Readout>`'s own doc comment (H2b). Defaults to `"numeric"` when omitted. */
  valueType?: "numeric" | "text"
}

interface ReadoutGridProps {
  machine: MachineDetailDto
  /** AOI/AVI only — the product currently plotted on the schematic, for the "Product" tile. */
  productLabel?: string | null
  /**
   * H2c: the real checksum-based config-sync drift (`in_sync | drift | unknown`), computed by the
   * caller from `useMachineConfigCheck` — NOT `machine.driftState` (that field only reflects the
   * outcome of the last MANUAL sync-config call this session and reads "—" until one has run, which
   * is why the CONFIG STATE tile was permanently dead before this pass). `null` while the check
   * hasn't resolved yet.
   */
  configDriftState?: string | null
  className?: string
}

/** 6–8 `<Readout>` tiles chosen per `deviceClass` (spec §5) — every value is real engine data or an
 * honestly-labeled client derivation (`derive.ts`); a metric that doesn't apply to this class renders
 * an explicit em dash rather than a misleading zero (mirrors `machineDetail.overview.passRate`'s own
 * existing "—" convention for IoT). */
export function ReadoutGrid({ machine, productLabel, configDriftState, className }: ReadoutGridProps) {
  const t = useT()
  const gloss = useGloss()

  const lastRow = machine.cycleLog.length > 0 ? machine.cycleLog[machine.cycleLog.length - 1] : undefined
  const parsedMetric = lastRow ? parseKeyMetric(lastRow.keyMetric) : null
  const rate = cycleRatePerMin(machine.cycleLog)
  const intervalMs = avgCycleIntervalMs(machine.cycleLog)
  const span = observedSpanLabel(machine.cycleLog)
  const statusKey = STATUS_KEY[machine.statusText] ?? "status.idle"
  const statusTone = STATUS_TONE[machine.statusText] ?? "idle"
  const configStateValue = configDriftState ? t(CONFIG_DRIFT_LABEL_KEY[configDriftState] ?? configDriftState) : "—"
  const configStateTone: ReadoutTone = configDriftState ? (CONFIG_DRIFT_TONE[configDriftState] ?? "idle") : "idle"

  let tiles: TileDef[]

  if (machine.class === "Automation") {
    tiles = [
      { key: "cycles", value: machine.cycles.toLocaleString(), labelKey: "hmi.readout.cycles", tone: "neutral" },
      {
        key: "passRate",
        value: `${(machine.passRate * 100).toFixed(1)}`,
        unit: "%",
        labelKey: "hmi.readout.passRate",
        tone: passRateTone(machine.passRate),
        gaugePct: machine.passRate * 100,
      },
      {
        key: "metric",
        value: parsedMetric ? formatMetric(Number(parsedMetric.value)) : "—",
        unit: parsedMetric?.unit,
        labelKey: "hmi.readout.metric",
        // "" (not `undefined`) — H4 job 3, same fix as the STATUS tile below: reserves this tile's
        // sub-row space unconditionally so its height can't shift between "no metric parsed yet" and
        // "a metric landed", which otherwise moves every unmasked sibling below it between runs (a
        // real reproduced flake at the tightened threshold, not hypothetical — see `Readout.tsx`'s
        // own `sub !== undefined` doc comment for the mechanism).
        sub: parsedMetric ? parsedMetric.name : "",
        tone: "neutral",
      },
      {
        key: "cycleRate",
        value: rate !== null ? rate.toFixed(1) : "—",
        unit: rate !== null ? "cyc/min" : undefined,
        labelKey: "hmi.readout.cycleRate",
        tone: "neutral",
      },
      {
        key: "cycleTime",
        value: intervalMs !== null ? (intervalMs / 1000).toFixed(2) : "—",
        unit: intervalMs !== null ? "s" : undefined,
        labelKey: "hmi.readout.cycleTime",
        tone: "neutral",
      },
      { key: "status", value: t(statusKey), labelKey: "hmi.readout.status", tone: statusTone, valueType: "text" },
      {
        key: "driver",
        value: t(`driverKind.${machine.driverKind}`),
        labelKey: "hmi.readout.driver",
        tone: "neutral",
        valueType: "text",
      },
      {
        key: "configState",
        value: configStateValue,
        labelKey: "hmi.readout.configState",
        tone: configStateTone,
        valueType: "text",
      },
    ]
  } else if (machine.class === "AoiAvi") {
    const ngPoints = machine.boardPoints.filter((p) => p.result === "NG")
    const lastDefect = ngPoints.length > 0 ? ngPoints[ngPoints.length - 1] : undefined
    // H2c: cumulative NG-board count, computed with the EXACT SAME formula `ProductionProgress`'s
    // footer strip uses (`okCount = round(cycles*passRate)`, `ngCount = cycles - okCount`) — this
    // tile previously counted only the CURRENT board's NG points (0 or 1 per cycle), which visibly
    // disagreed with the footer's cumulative "399 LỖI · 665 TỔNG" on the very same screen. Two
    // numbers claiming to be "the defect count" must agree; this one now IS the footer's number.
    const okCount = Math.round(machine.cycles * machine.passRate)
    const cumulativeNg = Math.max(0, machine.cycles - okCount)
    tiles = [
      { key: "boards", value: machine.cycles.toLocaleString(), labelKey: "hmi.readout.boards", tone: "neutral" },
      {
        key: "pointsInspected",
        value: machine.boardPoints.length > 0 ? machine.boardPoints.length.toLocaleString() : "—",
        labelKey: "hmi.readout.pointsInspected",
        tone: "neutral",
      },
      {
        key: "fpy",
        value: `${(machine.passRate * 100).toFixed(1)}`,
        unit: "%",
        labelKey: "hmi.readout.fpy",
        tone: passRateTone(machine.passRate),
        gaugePct: machine.passRate * 100,
      },
      {
        key: "defects",
        value: machine.cycles > 0 ? cumulativeNg.toLocaleString() : "—",
        labelKey: "hmi.readout.defects",
        tone: cumulativeNg > 0 ? "fault" : "run",
      },
      {
        // H2c: was "Last Defect" (the current board's defect CODE only — "—" whenever the last
        // board happened to be OK, easy to misread as "no data yet"). Repurposed as the SAME
        // STATUS_KEY/STATUS_TONE verdict word Automation/IoT already show in their own "Status"
        // tile (now true parity across all three classes) — this is where the last inspection
        // verdict now lives, moved OFF the nameplate lamp (see Hmi.tsx's safety fix). The specific
        // defect code survives as this tile's sub-note when the verdict is NG.
        key: "status",
        value: t(statusKey),
        labelKey: "hmi.readout.status",
        tone: statusTone,
        valueType: "text",
        // "" (not omitted/undefined) — H4 job 3: reserves this tile's sub-row space unconditionally so
        // the STATUS tile's height (and everything unmasked below it) doesn't shift between "no defect
        // yet" and "a defect landed", see `Readout.tsx`'s `sub !== undefined` doc comment.
        sub: lastDefect?.defectCode ?? "",
      },
      {
        key: "product",
        value: productLabel ?? "—",
        labelKey: "hmi.readout.product",
        tone: "neutral",
        valueType: "text",
      },
      {
        key: "cycleRate",
        value: rate !== null ? rate.toFixed(1) : "—",
        unit: rate !== null ? "brd/min" : undefined,
        labelKey: "hmi.readout.cycleRate",
        tone: "neutral",
      },
      {
        key: "configState",
        value: configStateValue,
        labelKey: "hmi.readout.configState",
        tone: configStateTone,
        valueType: "text",
      },
    ]
  } else {
    const lastSeries = machine.telemetry.length > 0 ? machine.telemetry[0] : undefined
    const lastValue = lastSeries && lastSeries.values.length > 0 ? lastSeries.values[lastSeries.values.length - 1] : undefined
    tiles = [
      { key: "packets", value: machine.cycles.toLocaleString(), labelKey: "hmi.readout.packets", tone: "neutral" },
      {
        key: "sampleRate",
        value: rate !== null ? rate.toFixed(1) : "—",
        unit: rate !== null ? "smp/min" : undefined,
        labelKey: "hmi.readout.sampleRate",
        tone: "neutral",
      },
      {
        key: "signal",
        value: lastValue !== undefined ? formatMetric(lastValue) : "—",
        unit: lastSeries ? lastSeries.metric : undefined,
        labelKey: "hmi.readout.signal",
        tone: "neutral",
      },
      { key: "observedSpan", value: span ?? "—", labelKey: "hmi.readout.observedSpan", tone: "neutral" },
      { key: "passRate", value: "—", labelKey: "hmi.readout.passRate", tone: "idle" },
      { key: "status", value: t(statusKey), labelKey: "hmi.readout.status", tone: statusTone, valueType: "text" },
      {
        key: "driver",
        value: t(`driverKind.${machine.driverKind}`),
        labelKey: "hmi.readout.driver",
        tone: "neutral",
        valueType: "text",
      },
      {
        key: "configState",
        value: configStateValue,
        labelKey: "hmi.readout.configState",
        tone: configStateTone,
        valueType: "text",
      },
    ]
  }

  return (
    <div className={cn("h-full", className)}>
      {/* Gap-as-border technique (1px grid gap on a `bg-border` container, each cell opaque) —
       * Tailwind's `divide-x`/`divide-y` utilities don't produce clean internal gridlines on a
       * WRAPPING grid (they border every child but the first in DOM order, not every child but the
       * first IN ITS ROW), so this is the reliable way to get a real bordered data-sheet table.
       * `auto-rows-fr` + the `h-full` above stretches the (fixed 2-row) grid to fill whatever height
       * the panel has — H2b fix for the dead band that used to sit below a top-anchored tile list. */}
      <div className="grid h-full auto-rows-fr grid-cols-2 gap-px border border-border bg-border lg:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.key} className="flex items-center bg-surface-card px-5 py-3">
            <Readout
              value={tile.value}
              unit={tile.unit}
              label={t(tile.labelKey)}
              labelEn={gloss(tile.labelKey)}
              sub={tile.sub}
              tone={tile.tone}
              gaugePct={tile.gaugePct}
              valueType={tile.valueType}
              className="w-full"
            />
          </div>
        ))}
      </div>
    </div>
  )
}
