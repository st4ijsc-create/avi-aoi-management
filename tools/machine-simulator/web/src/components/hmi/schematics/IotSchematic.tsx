import { useGloss } from "@/components/hmi/bilingual"
import { MachinePlinth } from "@/components/hmi/MachinePlinth"
import { useT } from "@/i18n"

interface IotSchematicProps {
  isRunning: boolean
  className?: string
}

/** Sensor node → uplink cell (spec §7): a node emitting radiating signal arcs, packets travelling
 * along the link to an uplink tower, and a row of sample-rate tick marks — all gated on `isRunning`,
 * static otherwise. H5: the latest-telemetry-reading text this drawing used to render at its own
 * bottom edge moved to `SchematicPanel.tsx`'s caption/readout strip below the drawing (layout spec
 * §8 gap 4) — this component is now purely the wireframe. */
export function IotSchematic({ isRunning, className }: IotSchematicProps) {
  const t = useT()
  const gloss = useGloss()
  const runClass = isRunning ? "hmi-schematic-run" : undefined

  return (
    // H5b — viewBox grown again, height 190 → 460 (width unchanged: the node/link/tower group already
    // filled ~94% of the old 396-wide canvas, this class's problem was purely vertical). The node/
    // arcs/link stay near the top (unchanged position — already tight against the old top edge); the
    // real added geometry is BELOW: both the node and the uplink tower now stand on tall mounting
    // poles rising from a shared ground plinth, and the sample-rate ticks moved down to sit just above
    // that ground line — an honest "elevated sensor + mast" reading (real hardware: both units really
    // do mount on poles/masts), not blank canvas. `MachinePlinth` grew to match (H5's own rationale).
    <svg
      viewBox="20 55 396 460"
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
        {/* H5b: fontSize 7.5 → 9.5 (spec §3 legibility bar). */}
        <text x={84} y={150} textAnchor="middle" fontSize={9.5} letterSpacing="0.05em" fill="var(--text-muted)" fontFamily="var(--font-mono)">
          {t("hmi.schematic.node")}
        </text>
        {/* H5b: mounting pole — the node stands on a real support column down to the ground plinth,
            same "genuine added geometry, not padding" discipline as `MachinePlinth` itself. */}
        <line x1={84} y1={132} x2={84} y2={430} stroke="var(--text-muted)" strokeWidth={1.5} className="hmi-wire" opacity={0.85} />

        {/* Link + travelling packets — branch-review I-10: these were painted with the status-run
            GREEN, i.e. the "machine healthy/OK" colour, purely because green reads as "data flowing" —
            not because anything is actually in the run STATE (they render the same whether the node is
            healthy, degraded, or stopped; only the motion itself is gated on `isRunning`). Spec §2:
            status colours are for state only, never decoration — drawn in the schematic's own accent
            colour instead, matching every other live element in this drawing. */}
        <line x1={110} y1={112} x2={370} y2={112} stroke="var(--text-muted)" strokeWidth={1} strokeDasharray="3 5" className="hmi-wire" />
        {[0, 0.8, 1.6].map((delay) => (
          <circle
            key={delay}
            className="hmi-iot-packet"
            cx={116}
            cy={112}
            r={3}
            fill="var(--color-accent)"
            style={{ animationDelay: `${delay}s` }}
          />
        ))}

        {/* Uplink tower — antenna array unchanged near the top (same height as the node), now on a
            long mast down to the same ground plinth (H5b: real added length, not padding). */}
        <path d="M 386 138 L 396 90 L 406 138 Z" fill="none" stroke="var(--text-muted)" strokeWidth={1.5} className="hmi-wire" />
        <line x1={396} y1={90} x2={396} y2={78} stroke="var(--text-muted)" strokeWidth={1.5} className="hmi-wire" />
        <circle cx={396} cy={76} r={2.5} fill="var(--text-muted)" />
        <line x1={396} y1={138} x2={396} y2={430} stroke="var(--text-muted)" strokeWidth={1.5} className="hmi-wire" opacity={0.85} />
        {/* H5b: fontSize 7.5 → 9.5, moved down beside the mast (was crowding the antenna base). */}
        <text x={396} y={162} textAnchor="middle" fontSize={9.5} letterSpacing="0.05em" fill="var(--text-muted)" fontFamily="var(--font-mono)">
          {t("hmi.schematic.uplink")}
        </text>

        {/* Sample-rate tick row — moved down to sit just above the ground plinth. */}
        {Array.from({ length: 12 }, (_, i) => (
          <line
            key={i}
            className="hmi-iot-tick"
            x1={140 + i * 18}
            y1={398}
            x2={140 + i * 18}
            y2={406}
            stroke="var(--color-accent)"
            strokeWidth={2}
            style={{ animationDelay: `${i * 0.12}s` }}
          />
        ))}
      </g>

      <MachinePlinth x1={40} x2={410} y={430} height={48} />
    </svg>
  )
}
