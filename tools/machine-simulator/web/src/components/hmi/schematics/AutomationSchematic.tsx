import { useGloss } from "@/components/hmi/bilingual"
import { DimensionLine } from "@/components/hmi/DimensionLine"
import { MachinePlinth } from "@/components/hmi/MachinePlinth"
import { useCycleTwin } from "@/components/hmi/useCycleTwin"
import { useT } from "@/i18n"
import type { CyclePlan } from "@/lib/api"

interface AutomationSchematicProps {
  /** WS3-T2 — the machine's latest cycle plan (`MachineDetailDto.Plan`). Non-null implies the fleet is
   * running (`MachineState.ToDetail`'s own gate) — its steps are the REAL fastening positions/results
   * this cycle drives, in visit order. Null (idle/E-STOPped) falls back to the pre-WS3-T2 static
   * decorative pose (three un-lit points, carriage at rest). */
  plan: CyclePlan | null | undefined
  /** True while the twin should actually move — `isRunning && plan has steps && !prefers-reduced-motion`
   * (computed once by `SchematicPanel`). */
  animate: boolean
  className?: string
}

/** H5 — exported so `SchematicPanel.tsx` can compute the SAME remaining-count for the caption/readout
 * strip now rendered BELOW the drawing (layout spec §8 gap 4: live numeric callouts moved out of the
 * schematic's own canvas) without duplicating the capacity constant. */
export const FEEDER_CAPACITY = 50

/** WS3-T2 — the engine's `ScrewdriveSim.FasteningPositionsPerCycle` is a fixed, documented constant
 * (no schema field exists for a real per-board screw count — see ws3-t1-report.md's fast-follow #2).
 * `SchematicPanel`'s feeder caption uses `plan.steps.length` directly whenever a plan is in hand (the
 * true live count) and only falls back to this mirrored constant while idle/no plan — kept as an
 * explicit, named export (not a silent `1`) so the fallback is honest about being a stand-in for the
 * same real number, not a different, weaker assumption. */
export const FASTENING_STEPS_PER_CYCLE_FALLBACK = 4

/** Idle-pose fastening points (spec's original "two already driven, one live target" decoration) —
 * used ONLY when there's no real plan to draw from (no product/plan concept for Automation the way AOI
 * has, but the machine's own linked recipe always resolves once running, so this is purely the static
 * rest illustration). Positions match the pre-WS3-T2 hardcoded circles exactly (nx spread across the
 * fastening rect, ny centered) — same table coordinates the live dots below use, so idle → live is a
 * position-STABLE transition, not a jump. */
const IDLE_POINTS: ReadonlyArray<{ code: string; nx: number; ny: number }> = [
  { code: "idle-1", nx: 0.2, ny: 0.5 },
  { code: "idle-2", nx: 0.8, ny: 0.5 },
  { code: "idle-3", nx: 0.5, ny: 0.5 },
]

const TABLE_X = 247
const TABLE_W = 78
const TABLE_Y = 356
const TABLE_H = 12

/** Carriage's own rest/entry position, in the SAME local rail frame the `translate(228, 24)` ancestor
 * already establishes (x=0 there IS the rail's left end) — segment 0 of a fresh cycle travels FROM
 * here TO `plan.steps[0]`. Matches `useCycleTwin`'s generic normalized-space contract: 0 here maps to
 * the SAME local-offset 0 the old static rest pose used. */
const CARRIAGE_REST_POINT = { x: 0, y: 0.5 }

/** The old CSS sweep's amplitude (130px, `--hmi-sweep-x`) — reused as the MAPPING range for the
 * carriage's live normalized-X position (`offsetX = nx * RAIL_SWEEP_PX`), so a live cycle travels
 * across the exact same physical span the static/idle pose always implied. */
const RAIL_SWEEP_PX = 130

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

/**
 * Gantry-driver cell — SCREWDRIVE/ASSEMBLY/DISPENSING/WELDER/automation classes (spec §7). A portal
 * frame with feet, a raised fixture table holding the part actually being fastened, a carriage with
 * roller wheels riding the rail, a Z-axis ballscrew + guide-sleeve stroke, and a round vibratory
 * feeder bowl + linear feed tube.
 *
 * WS3-T2 (docs/PRODUCTION_UI_DESIGN.md §3.2–§3.4) — the living twin: whenever `plan` is present, the
 * carriage genuinely travels the rail to EACH real fastening step in cycle order (`useCycleTwin`,
 * paced by the plan's own `startedAt`/`durationSeconds`), the bit spins and the Z-axis strokes only
 * while actually dwelling on a point ("driving" it), and every fastening point on the part is drawn at
 * its own real position and lit by its own real result — replacing the old fixed three-point
 * decoration and the fixed-cadence CSS sweep entirely.
 */
export function AutomationSchematic({ plan, animate, className }: AutomationSchematicProps) {
  const t = useT()
  const gloss = useGloss()

  const clock = useCycleTwin(plan, CARRIAGE_REST_POINT, animate)

  const liveSteps = plan?.steps
  const hasLiveSteps = !!liveSteps && liveSteps.length > 0

  const carriageOffsetX = clock ? clamp01(clock.head.x) * RAIL_SWEEP_PX : 0
  const dwelling = clock?.dwelling ?? false

  return (
    // viewBox height 244 → 480: the portal frame's legs run FRAME_TOP(24) → FRAME_BASE(380), with the
    // fixture table/part/feeder-tube/Z-axis stroke all re-anchored off the new, lower floor — real
    // geometry, not a taller empty canvas.
    <svg
      viewBox="0 0 520 480"
      preserveAspectRatio="xMidYMid meet"
      className={className}
      role="img"
      aria-label={`${t("hmi.schematic.figAutomation")} — ${gloss("hmi.schematic.figAutomation")}`}
    >
      <g className={animate ? "hmi-schematic-run" : undefined}>
        {/* Portal frame: uprights, top rail, base */}
        <g stroke="var(--text-muted)" strokeWidth={1.5} fill="none">
          <line className="hmi-wire" x1={78} y1={24} x2={78} y2={380} />
          <line className="hmi-wire" x1={468} y1={24} x2={468} y2={380} />
          <line className="hmi-wire" x1={65} y1={24} x2={481} y2={24} />
          <line className="hmi-wire" x1={26} y1={380} x2={515} y2={380} />
        </g>
        <MachinePlinth x1={26} x2={515} y={380} height={48} />

        {/* Fixture table — sits exactly on the (now lower) floor, same "table bottom = floor, part
            bottom = table top" contact rule as before. */}
        <rect x={218} y={368} width={135} height={12} fill="none" stroke="var(--text-muted)" strokeWidth={1.5} className="hmi-wire" />
        <rect x={TABLE_X} y={TABLE_Y} width={TABLE_W} height={TABLE_H} fill="none" stroke="var(--text-muted)" strokeWidth={1.5} className="hmi-wire" />

        {/* WS3-T2 — fastening points on the part, at their REAL positions once a plan is in hand, each
            lit by its OWN real result (revealed in visit order while animating, all at once when
            static/reduced-motion — design-doc §3.3). Idle/no plan: the original 3-point decoration,
            same table coordinates, so idle → live never jumps position. Two distinctly-typed branches
            (rather than one `.map` over a hand-unioned shape) — the idle decoration and the live
            per-step dots render different SVG entirely (plain filled/ring dots vs. colour-by-result),
            so forcing them through one shape just to share a `.map` call bought nothing.

            `hmi-scrw-points-group` — a stable visual-test mask hook (same discipline
            `AoiSchematic.tsx`'s own `.hmi-aoi-points-group` already established): which of these 4
            real fastening steps are OK/NG is a live per-cycle draw, not reproducible pixel-for-pixel
            run to run, so `11-hmi.spec.ts`'s automation baseline masks this whole group's stable
            bounding box rather than trying to pin an exact colour sequence. */}
        <g className="hmi-scrw-points-group">
          {!hasLiveSteps
            ? IDLE_POINTS.map((p, i) => {
                const cx = TABLE_X + p.nx * TABLE_W
                const cy = TABLE_Y + p.ny * TABLE_H
                // Two filled (already-driven look), one accent ring (live-target look) — exactly the
                // pre-WS3-T2 static artwork, just generated from the same coordinate table.
                return i === IDLE_POINTS.length - 1 ? (
                  <circle key={p.code} cx={cx} cy={cy} r={2.6} fill="none" stroke="var(--color-accent)" strokeWidth={1.3} className="hmi-wire" />
                ) : (
                  <circle key={p.code} cx={cx} cy={cy} r={2} fill="var(--text-muted)" />
                )
              })
            : liveSteps!.map((step, i) => {
                const cx = TABLE_X + clamp01(step.normalizedX) * TABLE_W
                const cy = TABLE_Y + clamp01(step.normalizedY) * TABLE_H
                const revealed = clock ? i < clock.revealedCount : true
                const resultLabel = step.result === "OK" ? t("hmi.progress.okLabel") : t("hmi.progress.ngLabel")
                const lit = revealed && !!step.result
                const tone = !lit ? "idle" : step.result === "OK" ? "run" : "fault"
                return (
                  <circle
                    key={step.pointCode}
                    cx={cx}
                    cy={cy}
                    r={lit ? 3.4 : 2.4}
                    fill={lit ? `var(--color-status-${tone})` : "none"}
                    stroke={`var(--color-status-${tone})`}
                    strokeWidth={1.3}
                    className="hmi-wire"
                    // M-1 (prod-ui review) — see AoiSchematic.tsx's twin comment: snap fill/stroke
                    // instantly on the reset/pending path (`key={step.pointCode}` is a stable DOM node
                    // across cycles), keep the soft 140ms fade only on the idle→lit reveal path.
                    style={{ transition: lit ? "fill 140ms ease, stroke 140ms ease, r 140ms ease" : "r 140ms ease" }}
                  >
                    <title>
                      {lit
                        ? t("hmi.schematic.measuredResult", { code: step.pointCode, result: resultLabel })
                        : t("hmi.schematic.configuredPosition", { code: step.pointCode })}
                    </title>
                  </circle>
                )
              })}
        </g>

        {/* Feeder bowl + linear feed tube toward the pick point — static machine geometry; the live
            remaining-count number lives in `SchematicPanel.tsx`'s caption strip beneath the drawing. */}
        <g>
          <circle cx={42} cy={82} r={20} fill="none" stroke="var(--text-muted)" strokeWidth={1.5} className="hmi-wire" />
          <circle cx={42} cy={82} r={11} fill="none" stroke="var(--text-muted)" strokeWidth={1} className="hmi-wire" opacity={0.7} />
          <circle cx={36} cy={75} r={1.5} fill="var(--color-accent)" opacity={0.7} />
          <circle cx={49} cy={79} r={1.5} fill="var(--color-accent)" opacity={0.7} />
          <circle cx={40} cy={89} r={1.5} fill="var(--color-accent)" opacity={0.7} />
          <path d="M 61 78 L 195 356" stroke="var(--text-muted)" strokeWidth={1} className="hmi-wire" fill="none" />
          <path d="M 61 88 L 195 368" stroke="var(--text-muted)" strokeWidth={1} className="hmi-wire" fill="none" />
          <text x={42} y={116} textAnchor="middle" fontSize={9} letterSpacing="0.06em" fill="var(--text-muted)" fontFamily="var(--font-mono)">
            {t("hmi.schematic.feeder")}
          </text>
          <rect x={21} y={380} width={42} height={4} fill="none" stroke="var(--text-muted)" strokeWidth={1} className="hmi-wire" />
        </g>

        {/*
          Carriage — WS3-T2: `carriageOffsetX` is a plain SVG-attribute translate recomputed every
          animation frame from the real cycle clock (`useCycleTwin`), not a CSS `animation` — the old
          "CSS transform replaces the SVG transform attribute" conflict this comment used to warn about
          no longer applies (nothing here is CSS-animated). A `transition` on `transform` gives
          frame-to-frame motion a soft ease without a JS tween.
        */}
        <g transform="translate(228, 24)">
          <g
            className="hmi-gantry-head"
            transform={`translate(${carriageOffsetX}, 0)`}
            style={{ transition: animate ? "transform 90ms linear" : undefined }}
          >
            <circle cx={-10} cy={-8} r={3} fill="none" stroke="var(--color-accent)" strokeWidth={1.3} className="hmi-wire" />
            <circle cx={10} cy={-8} r={3} fill="none" stroke="var(--color-accent)" strokeWidth={1.3} className="hmi-wire" />
            <rect x={-16} y={-6} width={32} height={16} fill="var(--color-accent)" />
            <line x1={0} y1={10} x2={0} y2={332} stroke="var(--color-accent)" strokeWidth={2} className="hmi-wire" />

            {/* Z-axis guide sleeve — strokes only while actually dwelling on (driving) a point. */}
            <g className={dwelling ? "hmi-gantry-zmarker hmi-driving" : "hmi-gantry-zmarker"}>
              <rect x={-7} y={125} width={14} height={16} fill="none" stroke="var(--text-muted)" strokeWidth={1} className="hmi-wire" />
            </g>
            <text x={14} y={137} fontSize={8.5} letterSpacing="0.05em" fill="var(--text-muted)" fontFamily="var(--font-mono)">
              {t("hmi.schematic.zAxis")}
            </text>

            {/* Spinning driver bit — spins only while dwelling (actually driving the fastener). */}
            <g transform="translate(0, 332)">
              <g className={dwelling ? "hmi-gantry-bit hmi-driving" : "hmi-gantry-bit"}>
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
