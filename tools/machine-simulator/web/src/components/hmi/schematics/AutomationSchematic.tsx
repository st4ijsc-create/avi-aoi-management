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

/**
 * Gantry-driver cell — SCREWDRIVE/ASSEMBLY/DISPENSING/WELDER/automation classes (spec §7). H2b
 * rebuild: H2's version read as "a beam, a stick Z-axis and a feeder box" — this adds the machine
 * around it: a portal frame with feet, a raised fixture table holding the part actually being
 * fastened (three screw points, already-driven ones shown filled), a carriage with roller wheels
 * riding the rail (not a bare rect), a clearer Z-axis ballscrew + guide-sleeve stroke, and a round
 * vibratory feeder bowl + linear feed tube (the box-with-a-label from H2 didn't read as a feeder at
 * a glance).
 *
 * `viewBox` is both tightened to the artwork's own bounding box AND widened (520x196, ~2.65:1) to
 * roughly match this panel's own rendered aspect ratio at the operator-panel sizes the spec cares
 * about (1280x800/1600x1000 both land close to 2.6:1 for the schematic sheet's content box, once
 * the fixed-width control column/nameplate/footer are accounted for) — spec: fill 85–90% of the
 * sheet at any panel size, not float in a much smaller `preserveAspectRatio="meet"` letterbox
 * inside it. Every stroke is `vector-effect: non-scaling-stroke` (`.hmi-wire`) so hairlines stay
 * hairlines at any scale.
 */
export function AutomationSchematic({ isRunning, cycles, className }: AutomationSchematicProps) {
  const t = useT()
  const gloss = useGloss()
  const remaining = feederRemaining(cycles, FEEDER_CAPACITY)
  const fillPct = remaining / FEEDER_CAPACITY

  return (
    <svg
      viewBox="0 0 520 196"
      preserveAspectRatio="xMidYMid meet"
      className={className}
      role="img"
      aria-label={`${t("hmi.schematic.figAutomation")} — ${gloss("hmi.schematic.figAutomation")}`}
    >
      <g className={isRunning ? "hmi-schematic-run" : undefined}>
        {/* Portal frame: uprights, top rail, base, feet */}
        <g stroke="var(--text-muted)" strokeWidth={1.5} fill="none">
          <line className="hmi-wire" x1={78} y1={24} x2={78} y2={152} />
          <line className="hmi-wire" x1={468} y1={24} x2={468} y2={152} />
          <line className="hmi-wire" x1={65} y1={24} x2={481} y2={24} />
          <line className="hmi-wire" x1={26} y1={152} x2={515} y2={152} />
          <rect className="hmi-wire" x={70} y={152} width={16} height={6} />
          <rect className="hmi-wire" x={460} y={152} width={16} height={6} />
        </g>

        {/* Fixture table + the part actually being fastened */}
        <rect x={218} y={140} width={135} height={12} fill="none" stroke="var(--text-muted)" strokeWidth={1.5} className="hmi-wire" />
        <rect x={247} y={128} width={78} height={12} fill="none" stroke="var(--text-muted)" strokeWidth={1.5} className="hmi-wire" />
        {/* Fastening points on the part — two already driven (filled), one live target (accent ring) */}
        <circle cx={263} cy={134} r={2} fill="var(--text-muted)" />
        <circle cx={309} cy={134} r={2} fill="var(--text-muted)" />
        <circle cx={286} cy={134} r={2.6} fill="none" stroke="var(--color-accent)" strokeWidth={1.3} className="hmi-wire" />

        {/* Feeder bowl + linear feed tube toward the pick point */}
        <g>
          <circle cx={42} cy={82} r={20} fill="none" stroke="var(--text-muted)" strokeWidth={1.5} className="hmi-wire" />
          <circle cx={42} cy={82} r={11} fill="none" stroke="var(--text-muted)" strokeWidth={1} className="hmi-wire" opacity={0.7} />
          <circle cx={36} cy={75} r={1.5} fill="var(--color-accent)" opacity={0.7} />
          <circle cx={49} cy={79} r={1.5} fill="var(--color-accent)" opacity={0.7} />
          <circle cx={40} cy={89} r={1.5} fill="var(--color-accent)" opacity={0.7} />
          {/* Feed tube — two parallel rails from the bowl mouth to the pick-up point by the table */}
          <path d="M 61 78 L 195 132" stroke="var(--text-muted)" strokeWidth={1} className="hmi-wire" fill="none" />
          <path d="M 61 88 L 195 140" stroke="var(--text-muted)" strokeWidth={1} className="hmi-wire" fill="none" />
          <text x={42} y={116} textAnchor="middle" fontSize={7} letterSpacing="0.08em" fill="var(--text-muted)" fontFamily="var(--font-mono)">
            {t("hmi.schematic.feeder")}
          </text>
          <text x={42} y={134} textAnchor="middle" fontSize={15} fontWeight={700} fill="var(--color-text)" fontFamily="var(--font-heading)">
            {remaining}
          </text>
          <text x={42} y={148} textAnchor="middle" fontSize={6.5} letterSpacing="0.08em" fill="var(--text-muted)" fontFamily="var(--font-mono)">
            {t("hmi.schematic.remaining")}
          </text>
          <rect x={21} y={152} width={42} height={4} fill="none" stroke="var(--text-muted)" strokeWidth={1} className="hmi-wire" />
          <rect x={21} y={152} width={42 * fillPct} height={4} fill="var(--color-accent)" opacity={0.55} />
        </g>

        {/*
          Carriage — traverses the rail (sweeps back and forth across the three fastening points
          while running) — roller wheels + body + ballscrew shaft, not a bare rect.

          GOTCHA (H2b, real bug found while verifying this against the live DOM — present in H1's
          original gantry-head/bit too, just never surfaced because the marooned pre-fix layout
          made it hard to notice): a CSS `transform` (from the sweep/spin `animation`) on an SVG
          element REPLACES that element's own `transform` XML ATTRIBUTE outright rather than
          composing with it — the CSS transform always wins once the animation is running. Putting
          `transform="translate(228, 24)"` and the animated `.hmi-gantry-head` class on the SAME
          `<g>` meant the static offset vanished the instant the sweep animation started, so the
          carriage rendered near the viewBox origin (visually on top of the feeder bowl) instead of
          over the fixture table. Fix: the static SVG-attribute translate lives on its own
          non-animated ancestor `<g>`; the CSS-animated class goes on a child `<g>` with no
          competing `transform` attribute of its own — same fix applied to the driver-bit group
          below (`translate(0, 104)` + the spin animation had the identical conflict).
        */}
        <g transform="translate(228, 24)">
          <g className="hmi-gantry-head" style={{ ["--hmi-sweep-x" as string]: "130px" } as React.CSSProperties}>
            <circle cx={-10} cy={-8} r={3} fill="none" stroke="var(--color-accent)" strokeWidth={1.3} className="hmi-wire" />
            <circle cx={10} cy={-8} r={3} fill="none" stroke="var(--color-accent)" strokeWidth={1.3} className="hmi-wire" />
            <rect x={-16} y={-6} width={32} height={16} fill="var(--color-accent)" />
            <line x1={0} y1={10} x2={0} y2={104} stroke="var(--color-accent)" strokeWidth={2} className="hmi-wire" />

            {/* Z-axis guide sleeve — strokes down the shaft while running */}
            <g className="hmi-gantry-zmarker">
              <rect x={-7} y={38} width={14} height={16} fill="none" stroke="var(--text-muted)" strokeWidth={1} className="hmi-wire" />
            </g>
            <text x={14} y={50} fontSize={6.5} letterSpacing="0.06em" fill="var(--text-muted)" fontFamily="var(--font-mono)">
              {t("hmi.schematic.zAxis")}
            </text>

            {/* Spinning driver bit, over the live fastening point */}
            <g transform="translate(0, 104)">
              <g className="hmi-gantry-bit">
                <circle r={7} fill="none" stroke="var(--color-accent)" strokeWidth={2} className="hmi-wire" />
                <line x1={-6} y1={0} x2={6} y2={0} stroke="var(--color-accent)" strokeWidth={1.5} className="hmi-wire" />
                <line x1={0} y1={-6} x2={0} y2={6} stroke="var(--color-accent)" strokeWidth={1.5} className="hmi-wire" />
              </g>
            </g>
          </g>
        </g>
      </g>

      <DimensionLine x1={247} x2={325} y={172} label="80" />
      <DimensionLine x1={78} x2={468} y={188} label="390" />
    </svg>
  )
}
