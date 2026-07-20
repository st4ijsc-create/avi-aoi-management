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
  className?: string
}

/** 6–8 `<Readout>` tiles chosen per `deviceClass` (spec §5) — every value is real engine data or an
 * honestly-labeled client derivation (`derive.ts`); a metric that doesn't apply to this class renders
 * an explicit em dash rather than a misleading zero (mirrors `machineDetail.overview.passRate`'s own
 * existing "—" convention for IoT). */
export function ReadoutGrid({ machine, productLabel, className }: ReadoutGridProps) {
  const t = useT()
  const gloss = useGloss()

  const lastRow = machine.cycleLog.length > 0 ? machine.cycleLog[machine.cycleLog.length - 1] : undefined
  const parsedMetric = lastRow ? parseKeyMetric(lastRow.keyMetric) : null
  const rate = cycleRatePerMin(machine.cycleLog)
  const intervalMs = avgCycleIntervalMs(machine.cycleLog)
  const span = observedSpanLabel(machine.cycleLog)
  const statusKey = STATUS_KEY[machine.statusText] ?? "status.idle"
  const statusTone = STATUS_TONE[machine.statusText] ?? "idle"

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
        sub: parsedMetric ? parsedMetric.name : undefined,
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
        value: machine.driftState,
        labelKey: "hmi.readout.configState",
        tone: "neutral",
        valueType: "text",
      },
    ]
  } else if (machine.class === "AoiAvi") {
    const ngPoints = machine.boardPoints.filter((p) => p.result === "NG")
    const lastDefect = ngPoints.length > 0 ? ngPoints[ngPoints.length - 1] : undefined
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
        value: machine.boardPoints.length > 0 ? ngPoints.length.toLocaleString() : "—",
        labelKey: "hmi.readout.defects",
        tone: ngPoints.length > 0 ? "fault" : "run",
      },
      {
        key: "lastDefect",
        value: lastDefect?.defectCode ?? "—",
        labelKey: "hmi.readout.lastDefect",
        tone: lastDefect ? "fault" : "idle",
        valueType: "text",
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
        value: machine.driftState,
        labelKey: "hmi.readout.configState",
        tone: "neutral",
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
        value: machine.driftState,
        labelKey: "hmi.readout.configState",
        tone: "neutral",
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
