import * as React from "react"

import { useGloss } from "@/components/hmi/bilingual"
import { DimensionLine } from "@/components/hmi/DimensionLine"
import { useT } from "@/i18n"
import type { BoardResult } from "@/lib/api"

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

const BOARD_X = 150
const BOARD_Y = 66
const BOARD_W = 170
const BOARD_H = 116

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

  return (
    <svg
      viewBox="0 0 460 224"
      className={className}
      role="img"
      aria-label={`${t("hmi.schematic.figAoi")} — ${gloss("hmi.schematic.figAoi")}`}
    >
      <g className={isRunning ? "hmi-schematic-run" : undefined}>
        {/* Conveyor rollers + belt */}
        <circle cx={70} cy={200} r={10} fill="none" stroke="var(--text-muted)" strokeWidth={1.5} className="hmi-wire" />
        <circle cx={390} cy={200} r={10} fill="none" stroke="var(--text-muted)" strokeWidth={1.5} className="hmi-wire" />
        <line x1={70} y1={190} x2={390} y2={190} stroke="var(--text-muted)" strokeWidth={1.5} className="hmi-wire" />
        <line
          className="hmi-aoi-belt-ticks hmi-wire"
          x1={70}
          y1={200}
          x2={390}
          y2={200}
          stroke="var(--text-muted)"
          strokeWidth={1.5}
          strokeDasharray="8 8"
        />

        {/* Camera stand + head, sweeps horizontally across the board while running */}
        <line x1={230} y1={20} x2={230} y2={40} stroke="var(--text-muted)" strokeWidth={1.5} className="hmi-wire" />
        <g className="hmi-aoi-camera" style={{ ["--hmi-sweep-x" as string]: "150px" } as React.CSSProperties}>
          <path
            d="M 218 40 L 242 40 L 250 58 L 210 58 Z"
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth={1.5}
            className="hmi-wire"
          />
          <line x1={230} y1={58} x2={230} y2={BOARD_Y} stroke="var(--color-accent)" strokeWidth={1} strokeDasharray="2 3" className="hmi-wire" />
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
            <circle
              key={p.code}
              cx={cx}
              cy={cy}
              r={p.result ? 3.4 : 2.4}
              fill={p.result ? color : "none"}
              stroke={color}
              strokeWidth={1.3}
              className="hmi-wire"
            >
              <title>{p.code}</title>
            </circle>
          )
        })}
      </g>

      {points.length === 0 ? (
        <text x={230} y={BOARD_Y + BOARD_H / 2} textAnchor="middle" fontSize={9} fill="var(--text-muted)" fontFamily="var(--font-mono)">
          {t("hmi.schematic.noProduct")}
        </text>
      ) : null}

      <text x={BOARD_X} y={BOARD_Y - 8} fontSize={8} fill="var(--text-muted)" fontFamily="var(--font-mono)">
        {productName ?? "—"} · {t("hmi.schematic.pointsSynced", { count: points.length })}
      </text>

      <DimensionLine x1={BOARD_X} x2={BOARD_X + BOARD_W} y={BOARD_Y + BOARD_H + 18} label={`${BOARD_W}`} />
    </svg>
  )
}
