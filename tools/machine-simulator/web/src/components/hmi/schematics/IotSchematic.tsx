import { useGloss } from "@/components/hmi/bilingual"
import { MachinePlinth } from "@/components/hmi/MachinePlinth"
import { useCycleTwin } from "@/components/hmi/useCycleTwin"
import { useT } from "@/i18n"
import type { CyclePlan } from "@/lib/api"

interface IotSchematicProps {
  /** WS3-T2 — the machine's latest cycle plan (`MachineDetailDto.Plan`): 3 telemetry-channel steps
   * per cycle (temperature/humidity/current), `result: null` throughout — IOT_SENSOR readings have no
   * pass/fail concept (mirrors `Verdict.Skip`), so unlike AOI/Automation this class never colours a
   * dot by OK/NG. What it DOES get from a real plan is real CADENCE: the node/packet/sample-tick
   * motion below is paced by the plan's own `startedAt`/`durationSeconds`, not a fixed-loop guess. */
  plan: CyclePlan | null | undefined
  /** True while the twin should actually move — `isRunning && plan has steps && !prefers-reduced-motion`. */
  animate: boolean
  className?: string
}

const NODE_X = 84
const NODE_Y = 112
const TOWER_X = 396
const LINK_X1 = 116
const LINK_X2 = 370
const TICK_COUNT = 12
const TICK_X0 = 140
const TICK_SPACING = 18

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

/** Node's own rest point in `useCycleTwin`'s generic normalized space — only `head`'s derived
 * `progress`/`revealedCount`/`dwelling` are actually used by this component (IoT has no traveling
 * head to place), so the exact x/y here don't matter beyond being a stable, defined point. */
const REST_POINT = { x: 0, y: 0 }

/** Sensor node → uplink cell (spec §7): a node emitting radiating signal arcs, packets travelling
 * along the link to an uplink tower, and a row of sample-rate tick marks.
 *
 * WS3-T2 — living twin: the packet's position along the link and how many sample ticks are lit are
 * both driven by the real cycle clock (`useCycleTwin`) — one packet traverses the link once per real
 * cycle (arriving exactly when the cycle's own `durationSeconds` elapses), and the tick row fills left
 * to right in step with real elapsed progress, replacing the old fixed 2–2.4s repeating CSS loops that
 * had no relationship to the machine's actual cadence. The concentric signal arcs stay a lightweight
 * ambient CSS pulse (spec: "the node is alive and radiating" — not tied to any one discrete step, so a
 * decorative loop is honest here, unlike the discrete per-point motion this task otherwise retires).
 */
export function IotSchematic({ plan, animate, className }: IotSchematicProps) {
  const t = useT()
  const gloss = useGloss()
  const runClass = animate ? "hmi-schematic-run" : undefined

  const clock = useCycleTwin(plan, REST_POINT, animate)
  const hasPlan = !!plan && plan.steps.length > 0

  // Static/reduced-motion with a real (but not animating) plan: treat the cycle as "delivered" — full
  // tick row lit, packet resting at the tower — design-doc §3.3's "static, but last-known state, no
  // motion". No plan at all: nothing sampled yet, packet stays docked at the node.
  const sampleFraction = clock ? clock.progress : hasPlan ? 1 : 0
  const litTicks = Math.round(clamp01(sampleFraction) * TICK_COUNT)
  const packetX = LINK_X1 + clamp01(sampleFraction) * (LINK_X2 - LINK_X1)
  const packetVisible = hasPlan
  const dwelling = clock?.dwelling ?? false

  return (
    // viewBox 20 55 396 460 — the node/link/tower group stays near the top; both units stand on tall
    // mounting poles down to a shared ground plinth (an honest "elevated sensor + mast" reading).
    <svg
      viewBox="20 55 396 460"
      preserveAspectRatio="xMidYMid meet"
      className={className}
      role="img"
      aria-label={`${t("hmi.schematic.figIot")} — ${gloss("hmi.schematic.figIot")}`}
    >
      <g className={runClass}>
        {/* Sensor node — brightens while dwelling on the current channel-sample ("taking a reading"). */}
        <rect x={64} y={92} width={40} height={40} fill="none" stroke="var(--color-accent)" strokeWidth={1.5} className="hmi-wire" />
        <circle
          cx={NODE_X}
          cy={NODE_Y}
          r={dwelling ? 5.5 : 4}
          fill="var(--color-accent)"
          style={{ transition: "r 120ms ease" }}
        />
        {[18, 34, 50].map((r, i) => (
          <circle
            key={r}
            className="hmi-iot-arc"
            cx={NODE_X}
            cy={NODE_Y}
            r={r}
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth={1}
            style={{ animationDelay: `${i * 0.5}s` }}
          />
        ))}
        <text x={NODE_X} y={150} textAnchor="middle" fontSize={9.5} letterSpacing="0.05em" fill="var(--text-muted)" fontFamily="var(--font-mono)">
          {t("hmi.schematic.node")}
        </text>
        <line x1={NODE_X} y1={132} x2={NODE_X} y2={430} stroke="var(--text-muted)" strokeWidth={1.5} className="hmi-wire" opacity={0.85} />

        {/* Link — a real packet travels its real position along this line, WS3-T2: `packetX` is a
            plain SVG-attribute position recomputed every animation frame from the real cycle clock,
            not a CSS `animation` — one traversal per real cycle, timed to the plan's own duration. */}
        <line x1={LINK_X1} y1={NODE_Y} x2={LINK_X2} y2={NODE_Y} stroke="var(--text-muted)" strokeWidth={1} strokeDasharray="3 5" className="hmi-wire" />
        <circle
          cx={packetX}
          cy={NODE_Y}
          r={3}
          fill="var(--color-accent)"
          opacity={packetVisible ? 1 : 0}
          style={{ transition: animate ? "cx 120ms linear" : "opacity 140ms ease" }}
        />

        {/* Uplink tower — antenna array + a long mast down to the same ground plinth. */}
        <path d="M 386 138 L 396 90 L 406 138 Z" fill="none" stroke="var(--text-muted)" strokeWidth={1.5} className="hmi-wire" />
        <line x1={TOWER_X} y1={90} x2={TOWER_X} y2={78} stroke="var(--text-muted)" strokeWidth={1.5} className="hmi-wire" />
        <circle cx={TOWER_X} cy={76} r={2.5} fill="var(--text-muted)" />
        <line x1={TOWER_X} y1={138} x2={TOWER_X} y2={430} stroke="var(--text-muted)" strokeWidth={1.5} className="hmi-wire" opacity={0.85} />
        <text x={TOWER_X} y={162} textAnchor="middle" fontSize={9.5} letterSpacing="0.05em" fill="var(--text-muted)" fontFamily="var(--font-mono)">
          {t("hmi.schematic.uplink")}
        </text>

        {/* Sample-rate tick row — WS3-T2: lights left-to-right in step with real elapsed cycle
            progress (`litTicks`), a plain per-tick opacity attribute rather than the old fixed
            0.12s-staggered infinite blink loop. */}
        {Array.from({ length: TICK_COUNT }, (_, i) => (
          <line
            key={i}
            x1={TICK_X0 + i * TICK_SPACING}
            y1={398}
            x2={TICK_X0 + i * TICK_SPACING}
            y2={406}
            stroke="var(--color-accent)"
            strokeWidth={2}
            opacity={i < litTicks ? 1 : 0.25}
            style={{ transition: "opacity 140ms ease" }}
          />
        ))}
      </g>

      <MachinePlinth x1={40} x2={410} y={430} height={48} />
    </svg>
  )
}
