import * as React from "react"

import { useGloss } from "@/components/hmi/bilingual"
import { DimensionLine } from "@/components/hmi/DimensionLine"
import { feederRemaining } from "@/components/hmi/derive"
import { useT } from "@/i18n"

interface AutomationSchematicProps {
  /** Gates the sweep/spin/Z-stroke animations — false renders a genuinely static drawing (spec §7:
   * "idle state = static drawing, no motion"), not a paused one. */
  isRunning: boolean
  /** Real cycle counter (`MachineDetail.cycles`) — the ONLY live input this schematic reads. Feeder
   * remaining-count is a derived decoration (see `derive.ts`'s `feederRemaining` doc comment); the
   * sweep/spin/Z animations themselves are a fixed-cadence loop, not literally paced to the real
   * cycle rate (the engine reports no per-axis timing data to drive that honestly). */
  cycles: number
  className?: string
}

const FEEDER_CAPACITY = 50

/** Gantry-driver cell — SCREWDRIVE/ASSEMBLY/DISPENSING/WELDER/automation classes (spec §7): portal
 * frame, a traversing head sweeping the rail, a spinning driver bit, a Z-axis stroke marker, and a
 * feeder with a remaining-count readout. Wireframe, `vector-effect: non-scaling-stroke` throughout. */
export function AutomationSchematic({ isRunning, cycles, className }: AutomationSchematicProps) {
  const t = useT()
  const gloss = useGloss()
  const remaining = feederRemaining(cycles, FEEDER_CAPACITY)
  const fillPct = remaining / FEEDER_CAPACITY

  return (
    <svg
      viewBox="0 0 460 224"
      className={className}
      role="img"
      aria-label={`${t("hmi.schematic.figAutomation")} — ${gloss("hmi.schematic.figAutomation")}`}
    >
      <g className={isRunning ? "hmi-schematic-run" : undefined}>
        {/* Portal frame + base rail */}
        <g stroke="var(--text-muted)" strokeWidth={1.5} fill="none">
          <line className="hmi-wire" x1={50} y1={42} x2={50} y2={178} />
          <line className="hmi-wire" x1={410} y1={42} x2={410} y2={178} />
          <line className="hmi-wire" x1={40} y1={42} x2={420} y2={42} />
          <line className="hmi-wire" x1={20} y1={178} x2={440} y2={178} />
        </g>

        {/* Work part on the table, under the head's travel */}
        <rect
          x={185}
          y={164}
          width={90}
          height={14}
          fill="none"
          stroke="var(--text-muted)"
          strokeWidth={1}
          className="hmi-wire"
        />

        {/* Feeder + remaining-screw readout */}
        <g>
          <rect x={24} y={90} width={38} height={72} fill="none" stroke="var(--text-muted)" strokeWidth={1.5} className="hmi-wire" />
          <rect x={27} y={90 + 66 * (1 - fillPct)} width={32} height={66 * fillPct} fill="var(--color-accent)" opacity={0.32} />
          <text x={43} y={84} textAnchor="middle" fontSize={7.5} letterSpacing="0.08em" fill="var(--text-muted)" fontFamily="var(--font-mono)">
            {t("hmi.schematic.feeder")}
          </text>
          <text x={43} y={132} textAnchor="middle" fontSize={14} fontWeight={700} fill="var(--color-text)" fontFamily="var(--font-heading)">
            {remaining}
          </text>
          <text x={43} y={146} textAnchor="middle" fontSize={6.5} letterSpacing="0.08em" fill="var(--text-muted)" fontFamily="var(--font-mono)">
            {t("hmi.schematic.remaining")}
          </text>
        </g>

        {/* Traversing driver head — sweeps the rail while running */}
        <g className="hmi-gantry-head" transform="translate(120, 42)" style={{ ["--hmi-sweep-x" as string]: "230px" } as React.CSSProperties}>
          <rect x={-12} y={-6} width={24} height={12} fill="var(--color-accent)" />
          <line x1={0} y1={0} x2={0} y2={68} stroke="var(--color-accent)" strokeWidth={2} className="hmi-wire" />

          {/* Z-axis stroke marker */}
          <g className="hmi-gantry-zmarker">
            <line x1={15} y1={0} x2={15} y2={22} stroke="var(--text-muted)" strokeWidth={1} className="hmi-wire" />
            <circle cx={15} cy={0} r={2} fill="var(--text-muted)" />
          </g>
          <text x={20} y={14} fontSize={6.5} letterSpacing="0.06em" fill="var(--text-muted)" fontFamily="var(--font-mono)">
            {t("hmi.schematic.zAxis")}
          </text>

          {/* Spinning driver bit */}
          <g className="hmi-gantry-bit" transform="translate(0, 68)">
            <circle r={7} fill="none" stroke="var(--color-accent)" strokeWidth={2} className="hmi-wire" />
            <line x1={-6} y1={0} x2={6} y2={0} stroke="var(--color-accent)" strokeWidth={1.5} className="hmi-wire" />
            <line x1={0} y1={-6} x2={0} y2={6} stroke="var(--color-accent)" strokeWidth={1.5} className="hmi-wire" />
          </g>
        </g>
      </g>

      <DimensionLine x1={185} x2={275} y={196} label="90" />
      <DimensionLine x1={50} x2={410} y={212} label="360" />
    </svg>
  )
}
