/**
 * H5 — a hatched base plinth beneath a schematic's portal frame. Layout spec §8 gap 1 moved every
 * schematic into a narrower, much TALLER column (a sibling of the readout grid, not a full-width
 * strip above it) — the machine drawings themselves (`viewBox`s tuned to a wide ~2.6:1 sheet) now
 * "meet"-scale width-first inside that squarer column, leaving a large empty graph-paper band above
 * and below the artwork. Real additional geometry is the only genuine fix for that (padding the
 * `viewBox` without drawing anything new just moves the SAME blank space inside the SVG's own
 * coordinate system — it doesn't reduce it). A plinth is an honest way to add real height: portal-
 * frame machines legitimately sit on a solid mounted base in reality, so this reads as more machine,
 * not decoration for its own sake.
 */
export function MachinePlinth({ x1, x2, y, height = 48 }: { x1: number; x2: number; y: number; height?: number }) {
  const span = x2 - x1
  const hatchGap = 28
  const hatchCount = Math.max(4, Math.round(span / hatchGap))
  return (
    <g>
      <rect x={x1} y={y} width={span} height={height} fill="none" stroke="var(--text-muted)" strokeWidth={1.5} className="hmi-wire" />
      <line x1={x1} y1={y + height} x2={x2} y2={y + height} stroke="var(--text-muted)" strokeWidth={2} className="hmi-wire" />
      <g stroke="var(--text-muted)" strokeWidth={1} opacity={0.35} className="hmi-wire">
        {Array.from({ length: hatchCount }, (_, i) => {
          const hx = x1 + (span / hatchCount) * (i + 1)
          return <line key={i} x1={Math.min(hx, x2)} y1={y} x2={Math.max(hx - height * 0.65, x1)} y2={y + height} />
        })}
      </g>
    </g>
  )
}
