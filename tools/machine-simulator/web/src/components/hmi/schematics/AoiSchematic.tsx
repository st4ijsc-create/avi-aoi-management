import * as React from "react"

import { useGloss } from "@/components/hmi/bilingual"
import { DimensionLine } from "@/components/hmi/DimensionLine"
import { useT } from "@/i18n"
import type { BoardResult } from "@/lib/api"
import { truncateText } from "@/lib/utils"

export interface AoiSchematicPoint {
  code: string
  /** Normalized 0–1 position within the product's reference image (`MeasurementPoint.normalizedX/Y`,
   * or `positionX/Y` divided by the product's stored `imageWidth/imageHeight` — see `Hmi.tsx`'s own
   * derivation, which falls back to a centered point only if the product genuinely has neither). */
  nx: number
  ny: number
  /** The live cycle's verdict for this point, when one exists yet — see this file's header comment
   * for how the correspondence to a board result is derived. */
  result?: BoardResult
}

// Frame footprint deliberately mirrors `AutomationSchematic.tsx`'s uprights/rails exactly (78/468,
// 24/152) — H2c: the two machine classes should read as the SAME drawing LANGUAGE (a real cell with a
// frame), not two unrelated visual styles, even though what happens inside the frame differs.
const FRAME_LEFT = 78
const FRAME_RIGHT = 468
const FRAME_TOP = 24
const FRAME_BASE = 152

const BOARD_W = 190
const BOARD_X = 165 // centered on the 520-wide viewBox
const BOARD_H = 40
const CONVEYOR_TOP = 118 // belt-deck top edge — the board's bottom edge rests exactly here
const BOARD_Y = CONVEYOR_TOP - BOARD_H

const GANTRY_RAIL_Y = 30
const GANTRY_RAIL_X1 = 150
const GANTRY_RAIL_X2 = 398

/** Caption truncation — H2b: an unbounded product name (e.g. "Bo mạch điều khiển chính (Main
 * Control Board)") wrapped nowhere in SVG text and ran straight through the camera head glyph
 * above the board. Truncated visually; the full name still reaches assistive tech via `<title>`. */
const CAPTION_MAX_CHARS = 30

const RESULT_VAR: Record<BoardResult, string> = {
  OK: "var(--color-status-run)",
  NG: "var(--color-status-fault)",
  NTF: "var(--color-status-warn)",
}

interface AoiSchematicProps {
  isRunning: boolean
  productName?: string | null
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
 * Honest disclosure on the point↔result correspondence: this build's AOI simulator
 * (`AoiInspectorSim.cs`) always inspects a fixed set of generic points (`PT-001`…`PT-020`) that don't
 * share a code vocabulary with the product's own configured `MeasurementPoint.code`s (e.g. `P01`) —
 * there is no engine-side link between "this cycle's board result" and "this specific configured
 * point." Per the H2 brief's "derive client-side and say so," the correspondence here is POSITIONAL:
 * the product's points (already ordered by `orderIndex`) are zipped index-for-index against the
 * live cycle's `boardPoints` in the order the engine returns them. The plotted POSITIONS are always
 * the real, configured product geometry; only which live result colors which dot is a client-side
 * approximation, not a code match.
 */
export function AoiSchematic({ isRunning, productName, points, className }: AoiSchematicProps) {
  const t = useT()
  const gloss = useGloss()
  const fullCaption = `${productName ?? "—"} · ${t("hmi.schematic.pointsSynced", { count: points.length })}`
  const captionLabel = points.length > 0 ? truncateText(productName ?? "—", CAPTION_MAX_CHARS) : null

  // Camera sweeps the gantry rail from its left end to its right end and back — the CSS keyframe
  // (`hmi-kf-camera-sweep`) is `translateX(0)` at rest, `translateX(var(--hmi-sweep-x))` at the
  // midpoint, so the assembly's OWN drawn (rest) position must already sit at the rail's left end.
  const railClearSpan = GANTRY_RAIL_X2 - GANTRY_RAIL_X1
  const cameraRestX = GANTRY_RAIL_X1 + 12
  const sweepX = railClearSpan - 24

  return (
    // viewBox width matches `AutomationSchematic.tsx`'s (520 wide) — both cells share the same frame
    // footprint and fill the sheet the same way (H2b's fill-the-sheet fix, kept). A touch taller
    // (520x204, aspect 2.55 vs. automation's 2.65) makes room for two dimension callouts stacked
    // under the frame's base rail PLUS the caption row beneath them, while staying close enough to
    // the panel's own ~2.6:1 rendered aspect that `meet` scaling only letterboxes a few px per side.
    <svg
      viewBox="0 0 520 204"
      preserveAspectRatio="xMidYMid meet"
      className={className}
      role="img"
      aria-label={`${t("hmi.schematic.figAoi")} — ${gloss("hmi.schematic.figAoi")}`}
    >
      <g className={isRunning ? "hmi-schematic-run" : undefined}>
        {/* Portal frame: uprights, top rail, base rail, feet — same drawing language as the
            automation cell's frame. */}
        <g stroke="var(--text-muted)" strokeWidth={1.5} fill="none">
          <line className="hmi-wire" x1={FRAME_LEFT} y1={FRAME_TOP} x2={FRAME_LEFT} y2={FRAME_BASE} />
          <line className="hmi-wire" x1={FRAME_RIGHT} y1={FRAME_TOP} x2={FRAME_RIGHT} y2={FRAME_BASE} />
          <line className="hmi-wire" x1={FRAME_LEFT - 13} y1={FRAME_TOP} x2={FRAME_RIGHT + 13} y2={FRAME_TOP} />
          <line className="hmi-wire" x1={FRAME_LEFT - 52} y1={FRAME_BASE} x2={FRAME_RIGHT + 47} y2={FRAME_BASE} />
          <rect className="hmi-wire" x={FRAME_LEFT - 8} y={FRAME_BASE} width={16} height={6} />
          <rect className="hmi-wire" x={FRAME_RIGHT - 8} y={FRAME_BASE} width={16} height={6} />
        </g>

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
          <g className="hmi-aoi-camera" style={{ ["--hmi-sweep-x" as string]: `${sweepX}px` } as React.CSSProperties}>
            <line x1={0} y1={GANTRY_RAIL_Y} x2={0} y2={42} stroke="var(--color-accent)" strokeWidth={2} className="hmi-wire" />
            <path
              d="M -12 42 L 12 42 L 17 57 L -17 57 Z"
              fill="var(--color-accent)"
              stroke="var(--color-accent)"
              strokeWidth={1.5}
              className="hmi-wire"
            />
            {/* Ring light around the lens */}
            <circle cx={0} cy={61} r={11} fill="none" stroke="var(--color-accent)" strokeWidth={1.5} strokeDasharray="3 3" className="hmi-wire" />
            {/* Focus beam down to the board */}
            <line x1={0} y1={72} x2={0} y2={BOARD_Y} stroke="var(--color-accent)" strokeWidth={1} strokeDasharray="2 3" className="hmi-wire" />
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

        {/* Real measurement points, plotted at their true normalized config positions */}
        {points.map((p) => {
          const cx = BOARD_X + p.nx * BOARD_W
          const cy = BOARD_Y + p.ny * BOARD_H
          const color = p.result ? RESULT_VAR[p.result] : "var(--color-status-idle)"
          return (
            // `hmi-aoi-point` — a stable mask hook (H2b): the one thing about this dot that's
            // genuinely live is its RESULT COLOR (green/red/amber as real cycles land); its position
            // is real, static product config. The visual baseline masks only these, not the whole
            // schematic, so a structural regression (the board/conveyor/dimension-line drawing
            // itself) is still caught by the pixel diff.
            <circle
              key={p.code}
              cx={cx}
              cy={cy}
              r={p.result ? 3.4 : 2.4}
              fill={p.result ? color : "none"}
              stroke={color}
              strokeWidth={1.3}
              className="hmi-wire hmi-aoi-point"
            >
              <title>{p.code}</title>
            </circle>
          )
        })}
      </g>

      {points.length === 0 ? (
        <text
          x={BOARD_X + BOARD_W / 2}
          y={BOARD_Y + BOARD_H / 2}
          textAnchor="middle"
          fontSize={9}
          fill="var(--text-muted)"
          fontFamily="var(--font-mono)"
        >
          {t("hmi.schematic.noProduct")}
        </text>
      ) : null}

      {/* Dimension callouts, directly below the frame's base rail, x-aligned to what they measure —
          same idiom `AutomationSchematic.tsx`'s "80"/"390" callouts already use (spec §7, "attached
          to what they measure"). */}
      <DimensionLine x1={BOARD_X} x2={BOARD_X + BOARD_W} y={170} label={`${BOARD_W}`} />
      <DimensionLine x1={FRAME_LEFT} x2={FRAME_RIGHT} y={184} label="390" />

      {/* Caption sits below everything — board, conveyor, dimension lines (H2b's collision fix,
          kept: the caption used to sit above the board at the same height as the camera glyph, then
          inside the belt's own tick band; below everything is clear at any panel size). Truncated
          visually; `<title>` carries the untruncated name. */}
      {captionLabel !== null ? (
        <text x={BOARD_X} y={198} fontSize={8} fill="var(--text-muted)" fontFamily="var(--font-mono)" className="hmi-aoi-caption">
          <title>{fullCaption}</title>
          {captionLabel} · {t("hmi.schematic.pointsSynced", { count: points.length })}
        </text>
      ) : null}
    </svg>
  )
}
