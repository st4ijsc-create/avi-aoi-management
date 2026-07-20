import type { ReactNode } from "react"

import { Readout, type ReadoutTone } from "@/components/industrial"
import { useGloss } from "@/components/hmi/bilingual"
import { avgCycleIntervalMs, cycleRatePerMin, observedSpanLabel, parseKeyMetric } from "@/components/hmi/derive"
import { useT } from "@/i18n"
import type { MachineDetail as MachineDetailDto } from "@/lib/api"
import { formatMetric } from "@/lib/utils"

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
      { key: "status", value: t(statusKey), labelKey: "hmi.readout.status", tone: statusTone },
      { key: "driver", value: t(`driverKind.${machine.driverKind}`), labelKey: "hmi.readout.driver", tone: "neutral" },
      { key: "configState", value: machine.driftState, labelKey: "hmi.readout.configState", tone: "neutral" },
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
      },
      { key: "product", value: productLabel ?? "—", labelKey: "hmi.readout.product", tone: "neutral" },
      {
        key: "cycleRate",
        value: rate !== null ? rate.toFixed(1) : "—",
        unit: rate !== null ? "brd/min" : undefined,
        labelKey: "hmi.readout.cycleRate",
        tone: "neutral",
      },
      { key: "configState", value: machine.driftState, labelKey: "hmi.readout.configState", tone: "neutral" },
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
      { key: "status", value: t(statusKey), labelKey: "hmi.readout.status", tone: statusTone },
      { key: "driver", value: t(`driverKind.${machine.driverKind}`), labelKey: "hmi.readout.driver", tone: "neutral" },
      { key: "configState", value: machine.driftState, labelKey: "hmi.readout.configState", tone: "neutral" },
    ]
  }

  return (
    <div className={className}>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 lg:grid-cols-4">
        {tiles.map((tile) => (
          <Readout
            key={tile.key}
            value={tile.value}
            unit={tile.unit}
            label={t(tile.labelKey)}
            labelEn={gloss(tile.labelKey)}
            sub={tile.sub}
            tone={tile.tone}
            gaugePct={tile.gaugePct}
          />
        ))}
      </div>
    </div>
  )
}
