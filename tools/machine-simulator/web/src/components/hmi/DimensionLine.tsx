/** A technical-drawing dimension line — two end ticks, a leader, and a centered mono label. Purely
 * decorative (spec §7's "dimension callouts"), used by every living-schematic to keep the wireframe
 * reading as a real drawing rather than a floating icon. */
export function DimensionLine({ x1, x2, y, label }: { x1: number; x2: number; y: number; label: string }) {
  const tick = 4
  return (
    <g stroke="var(--text-muted)" strokeWidth={1} fill="none" opacity={0.75}>
      <line className="hmi-wire" x1={x1} y1={y} x2={x2} y2={y} />
      <line className="hmi-wire" x1={x1} y1={y - tick} x2={x1} y2={y + tick} />
      <line className="hmi-wire" x1={x2} y1={y - tick} x2={x2} y2={y + tick} />
      <text
        x={(x1 + x2) / 2}
        y={y - 5}
        textAnchor="middle"
        fontSize={10}
        letterSpacing="0.03em"
        fill="var(--text-muted)"
        stroke="none"
        fontFamily="var(--font-mono)"
      >
        {label}
      </text>
    </g>
  )
}
