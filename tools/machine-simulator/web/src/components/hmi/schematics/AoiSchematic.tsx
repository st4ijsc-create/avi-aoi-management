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

const BOARD_X = 175
const BOARD_Y = 56
const BOARD_W = 230
const BOARD_H = 100
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
 * AOI/AVI inspection cell (spec §7, "make this the strongest one"): conveyor with a camera head
 * sweeping the board, and the product's REAL measurement points (real `normalizedX`/`normalizedY`
 * config, fetched from `/v1/products/{code}/points`) plotted at their true positions, lit green/red
 * as OK/NG results arrive.
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

  return (
    // viewBox tightened to the artwork's real bounding box AND widened (~2.64:1) to roughly match
    // this panel's own rendered aspect ratio at the operator-panel sizes the spec cares about — see
    // `AutomationSchematic.tsx`'s doc comment for the full reasoning (H2b: fill 85-90% of the sheet,
    // not float in a much smaller `meet`-letterboxed island inside it).
    <svg
      viewBox="20 6 560 218"
      preserveAspectRatio="xMidYMid meet"
      className={className}
      role="img"
      aria-label={`${t("hmi.schematic.figAoi")} — ${gloss("hmi.schematic.figAoi")}`}
    >
      <g className={isRunning ? "hmi-schematic-run" : undefined}>
        {/* Conveyor rollers + belt — BELOW the dimension line/caption band (H2b: the belt used to
            sit directly under the board, with the caption squeezed inside the belt's own solid/dashed
            rail pair — collided with the dashed tick line at every panel size). */}
        <circle cx={40} cy={196} r={10} fill="none" stroke="var(--text-muted)" strokeWidth={1.5} className="hmi-wire" />
        <circle cx={560} cy={196} r={10} fill="none" stroke="var(--text-muted)" strokeWidth={1.5} className="hmi-wire" />
        <line x1={40} y1={186} x2={560} y2={186} stroke="var(--text-muted)" strokeWidth={1.5} className="hmi-wire" />
        <line
          className="hmi-aoi-belt-ticks hmi-wire"
          x1={40}
          y1={196}
          x2={560}
          y2={196}
          stroke="var(--text-muted)"
          strokeWidth={1.5}
          strokeDasharray="8 8"
        />

        {/* Camera stand + head, sweeps horizontally across the board while running */}
        <line x1={290} y1={16} x2={290} y2={36} stroke="var(--text-muted)" strokeWidth={1.5} className="hmi-wire" />
        <g className="hmi-aoi-camera" style={{ ["--hmi-sweep-x" as string]: "200px" } as React.CSSProperties}>
          <path
            d="M 278 36 L 302 36 L 310 54 L 270 54 Z"
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth={1.5}
            className="hmi-wire"
          />
          <line x1={290} y1={54} x2={290} y2={BOARD_Y} stroke="var(--color-accent)" strokeWidth={1} strokeDasharray="2 3" className="hmi-wire" />
        </g>

        {/* PCB outline */}
        <rect
          x={BOARD_X}
          y={BOARD_Y}
          width={BOARD_W}
          height={BOARD_H}
          fill="none"
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

      <DimensionLine x1={BOARD_X} x2={BOARD_X + BOARD_W} y={BOARD_Y + BOARD_H + 16} label={`${BOARD_W}`} />

      {/* Caption sits BELOW the whole cell — board, dimension line AND the conveyor (H2b, two
          rounds): H2's version sat directly above the board, at the same height band as the camera
          head glyph, and collided with it whenever the product name ran long; the first H2b fix
          moved it just under the board but that put it inside the conveyor belt's own solid/dashed
          rail band, colliding with the dashed tick line instead. Below EVERYTHING is clear at any
          panel size regardless of camera or belt position, and reads like a real drawing's title
          block. Truncated visually; `<title>` carries the untruncated name. */}
      {captionLabel !== null ? (
        <text x={BOARD_X} y={222} fontSize={8} fill="var(--text-muted)" fontFamily="var(--font-mono)" className="hmi-aoi-caption">
          <title>{fullCaption}</title>
          {captionLabel} · {t("hmi.schematic.pointsSynced", { count: points.length })}
        </text>
      ) : null}
    </svg>
  )
}
