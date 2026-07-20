import { useGloss } from "@/components/hmi/bilingual"
import { useT } from "@/i18n"

interface IotSchematicProps {
  isRunning: boolean
  /** Latest telemetry reading, pre-formatted by the caller (`Hmi.tsx`) — purely a label under the
   * sensor node, not something this component parses. */
  latestReading?: string | null
  className?: string
}

/** Sensor node → uplink cell (spec §7): a node emitting radiating signal arcs, packets travelling
 * along the link to an uplink tower, and a row of sample-rate tick marks — all gated on `isRunning`,
 * static otherwise. */
export function IotSchematic({ isRunning, latestReading, className }: IotSchematicProps) {
  const t = useT()
  const gloss = useGloss()
  const runClass = isRunning ? "hmi-schematic-run" : undefined

  return (
    // viewBox tightened to the artwork's own bounding box (H2b: fill 85-90% of the sheet, not float
    // in a much larger box) — the original 460x224 canvas had ~35% unused vertical margin above the
    // signal arcs and below the tick row.
    <svg
      viewBox="20 55 396 161"
      preserveAspectRatio="xMidYMid meet"
      className={className}
      role="img"
      aria-label={`${t("hmi.schematic.figIot")} — ${gloss("hmi.schematic.figIot")}`}
    >
      <g className={runClass}>
        {/* Sensor node */}
        <rect x={64} y={92} width={40} height={40} fill="none" stroke="var(--color-accent)" strokeWidth={1.5} className="hmi-wire" />
        <circle cx={84} cy={112} r={4} fill="var(--color-accent)" />
        {[18, 34, 50].map((r, i) => (
          <circle
            key={r}
            className="hmi-iot-arc"
            cx={84}
            cy={112}
            r={r}
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth={1}
            style={{ animationDelay: `${i * 0.5}s` }}
          />
        ))}
        <text x={84} y={150} textAnchor="middle" fontSize={7.5} letterSpacing="0.06em" fill="var(--text-muted)" fontFamily="var(--font-mono)">
          {t("hmi.schematic.node")}
        </text>

        {/* Link + travelling packets */}
        <line x1={110} y1={112} x2={370} y2={112} stroke="var(--text-muted)" strokeWidth={1} strokeDasharray="3 5" className="hmi-wire" />
        {[0, 0.8, 1.6].map((delay) => (
          <circle
            key={delay}
            className="hmi-iot-packet"
            cx={116}
            cy={112}
            r={3}
            fill="var(--color-status-run)"
            style={{ animationDelay: `${delay}s` }}
          />
        ))}

        {/* Uplink tower */}
        <path d="M 386 138 L 396 90 L 406 138 Z" fill="none" stroke="var(--text-muted)" strokeWidth={1.5} className="hmi-wire" />
        <line x1={396} y1={90} x2={396} y2={78} stroke="var(--text-muted)" strokeWidth={1.5} className="hmi-wire" />
        <circle cx={396} cy={76} r={2.5} fill="var(--text-muted)" />
        <text x={396} y={152} textAnchor="middle" fontSize={7.5} letterSpacing="0.06em" fill="var(--text-muted)" fontFamily="var(--font-mono)">
          {t("hmi.schematic.uplink")}
        </text>

        {/* Sample-rate tick row */}
        {Array.from({ length: 12 }, (_, i) => (
          <line
            key={i}
            className="hmi-iot-tick"
            x1={140 + i * 18}
            y1={178}
            x2={140 + i * 18}
            y2={186}
            stroke="var(--color-accent)"
            strokeWidth={2}
            style={{ animationDelay: `${i * 0.12}s` }}
          />
        ))}
      </g>

      {latestReading ? (
        <text x={230} y={206} textAnchor="middle" fontSize={9} fill="var(--text-body)" fontFamily="var(--font-mono)">
          {latestReading}
        </text>
      ) : null}
    </svg>
  )
}
