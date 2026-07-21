import * as React from "react"

import { useGloss } from "@/components/hmi/bilingual"
import { DimensionLine } from "@/components/hmi/DimensionLine"
import { MachinePlinth } from "@/components/hmi/MachinePlinth"
import { useT } from "@/i18n"

export interface AoiSchematicPoint {
  code: string
  /** Normalized 0–1 position within the product's reference image (`MeasurementPoint.normalizedX/Y`,
   * or `positionX/Y` divided by the product's stored `imageWidth/imageHeight` — see `Hmi.tsx`'s own
   * derivation, which falls back to a centered point only if the product genuinely has neither). */
  nx: number
  ny: number
}

// Frame footprint deliberately mirrors `AutomationSchematic.tsx`'s uprights/rails exactly (78/468,
// 24/380) — H2c: the two machine classes should read as the SAME drawing LANGUAGE (a real cell with a
// frame), not two unrelated visual styles, even though what happens inside the frame differs. H5b:
// FRAME_BASE grown 152 → 380 in lockstep with `AutomationSchematic.tsx`'s own H5b fix (see that
// file's doc comment) — both schematics share one viewBox height (520×480) so the two machine classes
// keep reading as the same drawing system after the fix, not just before it.
const FRAME_LEFT = 78
const FRAME_RIGHT = 468
const FRAME_TOP = 24
const FRAME_BASE = 380

const BOARD_W = 190
const BOARD_X = 165 // centered on the 520-wide viewBox
const BOARD_H = 40
// H5b: CONVEYOR_TOP moved down from 118 → 340, staying close to the (now much lower) floor — same
// "short legs, deck near the ground" relationship the old 118-vs-152 pair had (gap 34 → gap 40 now).
// Keeping the conveyor near the floor (rather than centering it in the taller frame) means the extra
// canvas height goes to the CAMERA'S OWN TRAVEL instead — a longer, still-connected drop from the
// gantry rail to the board — real geometry, not a blank gap between the conveyor and its own legs.
const CONVEYOR_TOP = 340
const BOARD_Y = CONVEYOR_TOP - BOARD_H

const GANTRY_RAIL_Y = 30
const GANTRY_RAIL_X1 = 150
const GANTRY_RAIL_X2 = 398

interface AoiSchematicProps {
  isRunning: boolean
  points: AoiSchematicPoint[]
  className?: string
}

/**
 * AOI/AVI inspection cell (spec §7, "make this the strongest one"): a real machine — portal frame,
 * a conveyor BODY (belt deck, end rollers, guide rails) carrying the PCB, a camera head traveling a
 * visible overhead gantry rail with a ring light around the lens — sweeping the board, with the
 * product's REAL measurement points (real `normalizedX`/`normalizedY` config, fetched from
 * `/v1/products/{code}/points`) plotted at their true positions, lit green/red as OK/NG results
 * arrive.
 *
 * H2c rebuild: H2/H2b's version was scattered parts on a sheet — no frame, the conveyor was a bare
 * dashed line with one circle at each far edge, and the board floated in a gap above it instead of
 * riding on anything. This composes the same drawing vocabulary `AutomationSchematic.tsx` already
 * established (portal frame with feet, dimension callouts directly beneath what they measure) so the
 * two machine classes read as one design system, not two unrelated styles.
 *
 * Branch-review I-1 — honest disclosure on the point↔result correspondence: this build's AOI
 * simulator (`AoiInspectorSim.cs`) always inspects a fixed set of generic points (`PT-001`…`PT-020`)
 * that share NO code vocabulary with the product's own configured `MeasurementPoint.code`s (e.g.
 * `P01`) — there is no engine-side link between "this cycle's board result" and "this specific
 * configured point." An earlier build zipped the two lists BY ARRAY INDEX, which put a real NG
 * verdict's colour on a specific, named, wrong physical location (live-reproduced: an NG at board
 * index 9 painted product point `P03` red). Per the review's fix, this component no longer colours
 * individual dots by an unverifiable match at all: every dot below plots the product's REAL
 * configured position (unchanged) but stays the neutral idle outline — position is real config,
 * never a claim about that exact spot's result. The real per-cycle NG count is instead shown as an
 * honest AGGREGATE (`unlocatedDefects`, supplied by the caller straight from the engine's own board
 * points), now surfaced in `SchematicPanel.tsx`'s caption strip BELOW this drawing (H5 — layout spec
 * §8 gap 4) rather than as SVG text inside the canvas itself, with an explicit disclosure of what's
 * config and what's aggregate.
 */
export function AoiSchematic({ isRunning, points, className }: AoiSchematicProps) {
  const t = useT()
  const gloss = useGloss()

  // Camera sweeps the gantry rail from its left end to its right end and back — the CSS keyframe
  // (`hmi-kf-camera-sweep`) is `translateX(0)` at rest, `translateX(var(--hmi-sweep-x))` at the
  // midpoint, so the assembly's OWN drawn (rest) position must already sit at the rail's left end.
  const railClearSpan = GANTRY_RAIL_X2 - GANTRY_RAIL_X1
  const cameraRestX = GANTRY_RAIL_X1 + 12
  const sweepX = railClearSpan - 24

  return (
    // viewBox width matches `AutomationSchematic.tsx`'s (520 wide) — both cells share the same frame
    // footprint and fill the sheet the same way (H2b's fill-the-sheet fix, kept). H5b: height grown
    // again, 244 → 480, matching `AutomationSchematic.tsx`'s own H5b height exactly (both cells share
    // one frame footprint AND one canvas height) — real added geometry (the camera's own overhead
    // travel got longer, `FRAME_BASE`/`MachinePlinth` moved down with it), not empty padding, to close
    // the "meet"-scaling letterbox regression this pass fixes (see this file's `FRAME_BASE` comment).
    <svg
      viewBox="0 0 520 480"
      preserveAspectRatio="xMidYMid meet"
      className={className}
      role="img"
      aria-label={`${t("hmi.schematic.figAoi")} — ${gloss("hmi.schematic.figAoi")}`}
    >
      <g className={isRunning ? "hmi-schematic-run" : undefined}>
        {/* Portal frame: uprights, top rail, base rail — same drawing language as the automation
            cell's frame. */}
        <g stroke="var(--text-muted)" strokeWidth={1.5} fill="none">
          <line className="hmi-wire" x1={FRAME_LEFT} y1={FRAME_TOP} x2={FRAME_LEFT} y2={FRAME_BASE} />
          <line className="hmi-wire" x1={FRAME_RIGHT} y1={FRAME_TOP} x2={FRAME_RIGHT} y2={FRAME_BASE} />
          <line className="hmi-wire" x1={FRAME_LEFT - 13} y1={FRAME_TOP} x2={FRAME_RIGHT + 13} y2={FRAME_TOP} />
          <line className="hmi-wire" x1={FRAME_LEFT - 52} y1={FRAME_BASE} x2={FRAME_RIGHT + 47} y2={FRAME_BASE} />
        </g>
        <MachinePlinth x1={FRAME_LEFT - 52} x2={FRAME_RIGHT + 47} y={FRAME_BASE} height={48} />

        {/* Overhead gantry rail — static; only the camera assembly below travels along it (the
            "visible gantry" the review asked for, same idiom as the automation cell's carriage
            riding its own static rail). Support struts tie it back to the frame's top rail. */}
        <g stroke="var(--text-muted)" strokeWidth={1} fill="none" className="hmi-wire" opacity={0.85}>
          <line x1={GANTRY_RAIL_X1} y1={FRAME_TOP} x2={GANTRY_RAIL_X1} y2={GANTRY_RAIL_Y} />
          <line x1={GANTRY_RAIL_X2} y1={FRAME_TOP} x2={GANTRY_RAIL_X2} y2={GANTRY_RAIL_Y} />
        </g>
        <line
          x1={GANTRY_RAIL_X1}
          y1={GANTRY_RAIL_Y}
          x2={GANTRY_RAIL_X2}
          y2={GANTRY_RAIL_Y}
          stroke="var(--text-muted)"
          strokeWidth={1.5}
          className="hmi-wire"
        />

        {/* Camera assembly — mount drop, head, ring light and focus beam ALL move together as one
            group (H2c fix for "camera mount must travel with the camera head": H2/H2b drew the mount
            stand as a SIBLING of the sweeping `.hmi-aoi-camera` group rather than a child of it, so
            it stayed fixed at center while the head swept away — the head read as detached and
            floating mid-sweep.

            GOTCHA (caught live via screenshot, not just read from code — the exact bug
            `AutomationSchematic.tsx`'s own doc comment already warns about): a CSS `transform` from
            the sweep animation REPLACES an SVG element's own `transform` XML ATTRIBUTE outright
            rather than composing with it. Putting `transform="translate(...)"` and the animated
            `.hmi-aoi-camera` class on the SAME `<g>` (my first attempt) made the static rest
            position vanish the instant the animation started, rendering the whole assembly near the
            viewBox origin. Fix: the static rest-position translate lives on its own non-animated
            ANCESTOR `<g>`; the CSS-animated class goes on a CHILD `<g>` with no competing `transform`
            attribute of its own. */}
        <g transform={`translate(${cameraRestX}, 0)`}>
          {/* H5b: the mount drop is now a long travel (rail y=30 down to y=260, was a 12-unit stub) —
              the camera hangs much lower over the (now much lower) conveyor, real added length rather
              than a taller blank gap between the rail and the board. Lens head/ring light/focus beam
              all shift down with it, same relative offsets from the mount's own end. */}
          <g className="hmi-aoi-camera" style={{ ["--hmi-sweep-x" as string]: `${sweepX}px` } as React.CSSProperties}>
            <line x1={0} y1={GANTRY_RAIL_Y} x2={0} y2={260} stroke="var(--color-accent)" strokeWidth={2} className="hmi-wire" />
            <path
              d="M -12 260 L 12 260 L 17 275 L -17 275 Z"
              fill="var(--color-accent)"
              stroke="var(--color-accent)"
              strokeWidth={1.5}
              className="hmi-wire"
            />
            {/* Ring light around the lens */}
            <circle cx={0} cy={279} r={11} fill="none" stroke="var(--color-accent)" strokeWidth={1.5} strokeDasharray="3 3" className="hmi-wire" />
            {/* Focus beam down to the board */}
            <line x1={0} y1={290} x2={0} y2={BOARD_Y} stroke="var(--color-accent)" strokeWidth={1} strokeDasharray="2 3" className="hmi-wire" />
          </g>
        </g>

        {/* Conveyor body — belt deck, end rollers, guide rails, moving belt ticks. The PCB rests
            directly on the deck's top edge (H2c: was floating in a gap above a bare dashed line). */}
        <g>
          {/* Guide rails — the raised edge strips the board's edges actually ride inside */}
          <line x1={116} y1={CONVEYOR_TOP - 4} x2={404} y2={CONVEYOR_TOP - 4} stroke="var(--text-muted)" strokeWidth={1} className="hmi-wire" opacity={0.6} />
          {/* Belt deck body */}
          <rect
            x={106}
            y={CONVEYOR_TOP}
            width={308}
            height={18}
            fill="none"
            stroke="var(--text-muted)"
            strokeWidth={1.5}
            className="hmi-wire"
          />
          {/* Moving belt ticks — animates only while running */}
          <line
            className="hmi-aoi-belt-ticks hmi-wire"
            x1={120}
            y1={CONVEYOR_TOP + 9}
            x2={400}
            y2={CONVEYOR_TOP + 9}
            stroke="var(--text-muted)"
            strokeWidth={1.5}
            strokeDasharray="8 8"
            opacity={0.8}
          />
          {/* End rollers — protrude above/below the deck, the belt visibly wraps them */}
          <circle cx={112} cy={CONVEYOR_TOP + 9} r={13} fill="none" stroke="var(--text-muted)" strokeWidth={1.5} className="hmi-wire" />
          <circle cx={408} cy={CONVEYOR_TOP + 9} r={13} fill="none" stroke="var(--text-muted)" strokeWidth={1.5} className="hmi-wire" />
        </g>

        {/* PCB — a solid card (fill `--color-surface`, distinct from the graph-paper `--color-bg`
            ground), bottom edge exactly on the belt deck's top edge, no gap — H2c: it used to be a
            transparent outline floating in open space above the conveyor. */}
        <rect
          x={BOARD_X}
          y={BOARD_Y}
          width={BOARD_W}
          height={BOARD_H}
          fill="var(--color-surface)"
          stroke="var(--text-muted)"
          strokeWidth={1.5}
          className="hmi-wire"
        />

        {/* Real measurement points, plotted at their true normalized config positions. Branch-review
            I-1: no longer coloured by a per-point result — see this file's header comment. Each dot
            stays the neutral idle outline; the `<title>` is explicit that this is a CONFIGURED
            position, not a verdict site.

            I-15 — `hmi-aoi-points-group` wraps the whole set as ONE stable mask hook, in addition to
            each dot's own `.hmi-aoi-point` class: whichever product is currently configured on this
            machine determines both the COUNT and the POSITION of these dots, so masking only each
            dot's OWN current bounding box doesn't help if a baseline was captured against a
            different point set than the run being compared — the mismatched region between the two
            leaks through as unmasked pixels (the exact failure this class guards `11-hmi.spec.ts`
            against, see its own `beforeEach` remarks). Masking the whole group's bounding box is
            robust to point-count/position drift; the per-dot class stays for any caller that wants a
            narrower mask once the point set is otherwise pinned. */}
        <g className="hmi-aoi-points-group">
          {points.map((p) => {
            const cx = BOARD_X + p.nx * BOARD_W
            const cy = BOARD_Y + p.ny * BOARD_H
            return (
              <circle
                key={p.code}
                cx={cx}
                cy={cy}
                r={3.4}
                fill="none"
                stroke="var(--color-status-idle)"
                strokeWidth={1.3}
                className="hmi-wire hmi-aoi-point"
              >
                <title>{t("hmi.schematic.configuredPosition", { code: p.code })}</title>
              </circle>
            )
          })}
        </g>
      </g>

      {/* Dimension callouts, directly below the frame's base rail, x-aligned to what they measure —
          same idiom `AutomationSchematic.tsx`'s "80"/"390" callouts already use (spec §7, "attached
          to what they measure"). H5: the caption row (product name · configured-position count ·
          aggregate defects) and the "no product linked" fallback both moved to
          `SchematicPanel.tsx`'s caption/readout strip below this drawing (layout spec §8 gap 4) — this
          canvas is now purely the wireframe + its dimension lines. */}
      <DimensionLine x1={BOARD_X} x2={BOARD_X + BOARD_W} y={442} label={`${BOARD_W}`} />
      <DimensionLine x1={FRAME_LEFT} x2={FRAME_RIGHT} y={458} label="390" />
    </svg>
  )
}
