import * as React from "react"

import { useGloss } from "@/components/hmi/bilingual"
import { DimensionLine } from "@/components/hmi/DimensionLine"
import { MachinePlinth } from "@/components/hmi/MachinePlinth"
import { useT } from "@/i18n"

interface AutomationSchematicProps {
  /** Gates the sweep/spin/Z-stroke animations — false renders a genuinely static drawing (spec §7:
   * "idle state = static drawing, no motion"), not a paused one. The sweep/spin/Z animations
   * themselves are a fixed-cadence loop, not literally paced to the real cycle rate (the engine
   * reports no per-axis timing data to drive that honestly) — H5: the ONE real live input this
   * component used to read (`cycles`, for the feeder remaining-count) moved to
   * `SchematicPanel.tsx`'s caption strip below the drawing, so this component is now driven by
   * `isRunning` alone. */
  isRunning: boolean
  className?: string
}

/** H5 — exported so `SchematicPanel.tsx` can compute the SAME remaining-count for the caption/readout
 * strip now rendered BELOW the drawing (layout spec §8 gap 4: live numeric callouts moved out of the
 * schematic's own canvas) without duplicating the capacity constant. */
export const FEEDER_CAPACITY = 50

/**
 * Gantry-driver cell — SCREWDRIVE/ASSEMBLY/DISPENSING/WELDER/automation classes (spec §7). H2b
 * rebuild: H2's version read as "a beam, a stick Z-axis and a feeder box" — this adds the machine
 * around it: a portal frame with feet, a raised fixture table holding the part actually being
 * fastened (three screw points, already-driven ones shown filled), a carriage with roller wheels
 * riding the rail (not a bare rect), a clearer Z-axis ballscrew + guide-sleeve stroke, and a round
 * vibratory feeder bowl + linear feed tube (the box-with-a-label from H2 didn't read as a feeder at
 * a glance).
 *
 * `viewBox` is tightened to the artwork's own bounding box. H5b (this pass): the H5 build widened it
 * to a wide ~2.65:1 sheet tuned for a full-width panel — but the H5 layout rework put this drawing in
 * a COLUMN, not a full-width strip, and a column at the 1280×800/1600×1000 floor renders closer to a
 * SQUARE-ish box (~0.85:1, taller than wide) once the fixed-width control rail/nameplate/log band are
 * accounted for. A 2.65:1 drawing inside a 0.85:1 box is "meet"-scaled WIDTH-first, leaving huge blank
 * bands above/below — the exact regression this pass fixes. Fix: the portal frame's legs (and every
 * part hung off them — table, feeder tube, Z-axis stroke) are genuinely taller now (viewBox
 * 520×480, ~1.08:1, close to square), real added machine geometry (a taller column cell, plausible on
 * a real gantry/assembly line), not padding — same discipline `MachinePlinth` already established.
 * Every stroke is `vector-effect: non-scaling-stroke` (`.hmi-wire`) so hairlines stay hairlines at any
 * scale; in-drawing text is sized for legibility at ~50cm (spec §3), not the smaller H5 sizes.
 */
export function AutomationSchematic({ isRunning, className }: AutomationSchematicProps) {
  const t = useT()
  const gloss = useGloss()

  return (
    // H5b — viewBox height grown again, 244 → 480 (see this component's own doc comment above): the
    // portal frame's legs now run FRAME_TOP(24) → FRAME_BASE(380), roughly 3× their old span, with
    // the fixture table/part/feeder-tube/Z-axis stroke all re-anchored off the new, lower floor —
    // real geometry, not a taller empty canvas. Verified live (screenshots) at 1280×800/1600×1000: the
    // drawing now fills ~85-90% of its sheet's vertical space instead of ~44%.
    <svg
      viewBox="0 0 520 480"
      preserveAspectRatio="xMidYMid meet"
      className={className}
      role="img"
      aria-label={`${t("hmi.schematic.figAutomation")} — ${gloss("hmi.schematic.figAutomation")}`}
    >
      <g className={isRunning ? "hmi-schematic-run" : undefined}>
        {/* Portal frame: uprights, top rail, base */}
        <g stroke="var(--text-muted)" strokeWidth={1.5} fill="none">
          <line className="hmi-wire" x1={78} y1={24} x2={78} y2={380} />
          <line className="hmi-wire" x1={468} y1={24} x2={468} y2={380} />
          <line className="hmi-wire" x1={65} y1={24} x2={481} y2={24} />
          <line className="hmi-wire" x1={26} y1={380} x2={515} y2={380} />
        </g>
        <MachinePlinth x1={26} x2={515} y={380} height={48} />

        {/* Fixture table + the part actually being fastened — sits exactly on the (now lower) floor,
            same "table bottom = floor, part bottom = table top" contact rule as before. */}
        <rect x={218} y={368} width={135} height={12} fill="none" stroke="var(--text-muted)" strokeWidth={1.5} className="hmi-wire" />
        <rect x={247} y={356} width={78} height={12} fill="none" stroke="var(--text-muted)" strokeWidth={1.5} className="hmi-wire" />
        {/* Fastening points on the part — two already driven (filled), one live target (accent ring) */}
        <circle cx={263} cy={362} r={2} fill="var(--text-muted)" />
        <circle cx={309} cy={362} r={2} fill="var(--text-muted)" />
        <circle cx={286} cy={362} r={2.6} fill="none" stroke="var(--color-accent)" strokeWidth={1.3} className="hmi-wire" />

        {/* Feeder bowl + linear feed tube toward the pick point — the machine PART itself. H5: the
            live remaining-count number/fill-bar previously drawn here moved OUT of the drawing canvas
            into `SchematicPanel.tsx`'s caption/readout strip beneath it (layout spec §8 gap 4 — the
            reference keeps its wireframe a clean technical drawing and puts live numbers in a strip
            under it, not floating inside the picture). This group is now purely the static machine
            geometry; the disclosure tooltip travels with the strip's own reading instead. */}
        <g>
          <circle cx={42} cy={82} r={20} fill="none" stroke="var(--text-muted)" strokeWidth={1.5} className="hmi-wire" />
          <circle cx={42} cy={82} r={11} fill="none" stroke="var(--text-muted)" strokeWidth={1} className="hmi-wire" opacity={0.7} />
          <circle cx={36} cy={75} r={1.5} fill="var(--color-accent)" opacity={0.7} />
          <circle cx={49} cy={79} r={1.5} fill="var(--color-accent)" opacity={0.7} />
          <circle cx={40} cy={89} r={1.5} fill="var(--color-accent)" opacity={0.7} />
          {/* Feed tube — two parallel rails from the bowl mouth down to the pick-up point by the
              table. H5b: the table moved much lower (new floor), so this tube is now a longer,
              steeper run — still the same two-rail idiom, just re-anchored to the new pickup point. */}
          <path d="M 61 78 L 195 356" stroke="var(--text-muted)" strokeWidth={1} className="hmi-wire" fill="none" />
          <path d="M 61 88 L 195 368" stroke="var(--text-muted)" strokeWidth={1} className="hmi-wire" fill="none" />
          {/* H5b: fontSize 7 → 9 (spec §3/§7's "legible at ~50cm" bar — every in-drawing label was
              undersized after the H5 column reflow, this and `zAxis` below were the two worst). */}
          <text x={42} y={116} textAnchor="middle" fontSize={9} letterSpacing="0.06em" fill="var(--text-muted)" fontFamily="var(--font-mono)">
            {t("hmi.schematic.feeder")}
          </text>
          <rect x={21} y={380} width={42} height={4} fill="none" stroke="var(--text-muted)" strokeWidth={1} className="hmi-wire" />
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
            {/* H5b: the Z-axis shaft now runs the full new leg span down to the (lower) fastening
                point — 10→332 local, was 10→104 — real added length, matching the taller frame. */}
            <line x1={0} y1={10} x2={0} y2={332} stroke="var(--color-accent)" strokeWidth={2} className="hmi-wire" />

            {/* Z-axis guide sleeve — strokes down the shaft while running. Repositioned to the same
                proportional point along the now-longer shaft (~38% down from the carriage). */}
            <g className="hmi-gantry-zmarker">
              <rect x={-7} y={125} width={14} height={16} fill="none" stroke="var(--text-muted)" strokeWidth={1} className="hmi-wire" />
            </g>
            {/* H5b: fontSize 6.5 → 8.5 (spec §3 legibility bar), repositioned beside the moved sleeve. */}
            <text x={14} y={137} fontSize={8.5} letterSpacing="0.05em" fill="var(--text-muted)" fontFamily="var(--font-mono)">
              {t("hmi.schematic.zAxis")}
            </text>

            {/* Spinning driver bit, over the live fastening point — local translate 104 → 332,
                tracking the table's new lower position (6 units above the part's surface, same
                stand-off the old geometry used). */}
            <g transform="translate(0, 332)">
              <g className="hmi-gantry-bit">
                <circle r={7} fill="none" stroke="var(--color-accent)" strokeWidth={2} className="hmi-wire" />
                <line x1={-6} y1={0} x2={6} y2={0} stroke="var(--color-accent)" strokeWidth={1.5} className="hmi-wire" />
                <line x1={0} y1={-6} x2={0} y2={6} stroke="var(--color-accent)" strokeWidth={1.5} className="hmi-wire" />
              </g>
            </g>
          </g>
        </g>
      </g>

      <DimensionLine x1={247} x2={325} y={442} label="80" />
      <DimensionLine x1={78} x2={468} y={458} label="390" />
    </svg>
  )
}
