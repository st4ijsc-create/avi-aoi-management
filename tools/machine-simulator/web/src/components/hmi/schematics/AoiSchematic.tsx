import { useGloss } from "@/components/hmi/bilingual"
import { DimensionLine } from "@/components/hmi/DimensionLine"
import { MachinePlinth } from "@/components/hmi/MachinePlinth"
import { useCycleTwin } from "@/components/hmi/useCycleTwin"
import { useT } from "@/i18n"
import type { CyclePlan } from "@/lib/api"

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

/** Camera's own rest/entry position (rail's left end, matching the pre-WS3-T2 static pose) — segment
 * 0 of a fresh cycle travels FROM here TO `plan.steps[0]`, in the SAME normalized-X space every step's
 * own `normalizedX` uses (`useCycleTwin`'s `restPoint`, ny unused for this component — the beam target
 * always uses the ACTIVE step's own real Y directly, see the render below). */
const CAMERA_REST_POINT = { x: 0, y: 0.5 }

interface AoiSchematicProps {
  /** WS3-T2 — the machine's latest cycle plan (`MachineDetailDto.Plan`). Non-null implies a real
   * product is linked AND the fleet is running (`MachineState.ToDetail`'s own gate) — when present,
   * ITS points/results/positions are the single source of truth for both the drawing's dots and the
   * camera head's travel; `points` below is only the IDLE-fallback (no plan yet, or none ever). */
  plan: CyclePlan | null | undefined
  /** True while the twin should actually move — `isRunning && plan has steps && !prefers-reduced-motion`
   * (computed once by `SchematicPanel`, the shared parent of every device-class schematic). */
  animate: boolean
  points: AoiSchematicPoint[]
  className?: string
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

/**
 * AOI/AVI inspection cell (spec §7, "make this the strongest one"): a real machine — portal frame,
 * a conveyor BODY (belt deck, end rollers, guide rails) carrying the PCB, a camera head traveling a
 * visible overhead gantry rail with a ring light around the lens — sweeping the board.
 *
 * WS3-T2 (docs/PRODUCTION_UI_DESIGN.md §3.2–§3.4) — the living twin. WS3-T1 closed the gap the H2c
 * header comment below used to describe (the engine now emits a `CyclePlan` whose steps are the SAME
 * real, product-configured points this drawing already plots, each carrying ITS OWN real result) — so
 * this component no longer needs the "never colour an individual dot" workaround: whenever `plan` is
 * present, each dot's fill IS its own step's real `result`, and the camera head genuinely travels to
 * each point in cycle order, paced by the plan's own `startedAt`/`durationSeconds` (`useCycleTwin`) —
 * never a fixed-cadence CSS loop. `points` (the product's static configured positions, no live result)
 * remains the fallback for the two honest "nothing live to show" cases: no plan yet (idle/E-STOPped)
 * or no product ever linked.
 */
export function AoiSchematic({ plan, animate, points, className }: AoiSchematicProps) {
  const t = useT()
  const gloss = useGloss()

  const clock = useCycleTwin(plan, CAMERA_REST_POINT, animate)

  const railClearSpan = GANTRY_RAIL_X2 - GANTRY_RAIL_X1
  const railUsableSpan = railClearSpan - 24
  const restX = GANTRY_RAIL_X1 + 12

  // Dots to draw: the live plan's own steps (real position + real result) whenever one exists — even
  // while NOT animating (reduced motion, or the brief instant before the first rAF tick lands) the
  // real result is still known data and shown immediately, just without motion — falling back to the
  // product's static configured positions (no result, neutral) only when there's genuinely no plan.
  const liveSteps = plan?.steps
  const hasLiveSteps = !!liveSteps && liveSteps.length > 0

  // Camera head — while actually animating, it's mid-travel at `clock.head.x` (normalized, mapped onto
  // the rail's own pixel span) and its focus beam aims at whichever step is currently active. Idle, no
  // plan, or reduced-motion: the pre-WS3-T2 static rest pose (left rail end, beam straight down).
  const cameraX = clock ? restX + clamp01(clock.head.x) * railUsableSpan : restX
  const activeStep = clock && liveSteps ? liveSteps[clock.activeIndex] : null
  const beamTargetX = activeStep ? BOARD_X + clamp01(activeStep.normalizedX) * BOARD_W : cameraX
  const beamTargetY = activeStep ? BOARD_Y + clamp01(activeStep.normalizedY) * BOARD_H : BOARD_Y
  const dwelling = clock?.dwelling ?? false

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
      <g className={animate ? "hmi-schematic-run" : undefined}>
        {/* Portal frame: uprights, top rail, base rail — same drawing language as the automation
            cell's frame. */}
        <g stroke="var(--text-muted)" strokeWidth={1.5} fill="none">
          <line className="hmi-wire" x1={FRAME_LEFT} y1={FRAME_TOP} x2={FRAME_LEFT} y2={FRAME_BASE} />
          <line className="hmi-wire" x1={FRAME_RIGHT} y1={FRAME_TOP} x2={FRAME_RIGHT} y2={FRAME_BASE} />
          <line className="hmi-wire" x1={FRAME_LEFT - 13} y1={FRAME_TOP} x2={FRAME_RIGHT + 13} y2={FRAME_TOP} />
          <line className="hmi-wire" x1={FRAME_LEFT - 52} y1={FRAME_BASE} x2={FRAME_RIGHT + 47} y2={FRAME_BASE} />
        </g>
        <MachinePlinth x1={FRAME_LEFT - 52} x2={FRAME_RIGHT + 47} y={FRAME_BASE} height={48} />

        {/* Overhead gantry rail — static; only the camera assembly below travels along it. */}
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
            group. WS3-T2: `cameraX` is a plain SVG-attribute translate recomputed every animation
            frame from the real cycle clock (`useCycleTwin`) — not a CSS `animation`, so there is no
            "CSS transform replaces the SVG attribute" conflict to guard against (the H2c gotcha this
            comment used to document no longer applies: nothing here is CSS-animated anymore). A
            `transition` on `transform` gives frame-to-frame motion a soft ease without a JS tween. */}
        <g
          transform={`translate(${cameraX}, 0)`}
          style={{ transition: animate ? "transform 90ms linear" : undefined }}
        >
          <g>
            <line x1={0} y1={GANTRY_RAIL_Y} x2={0} y2={260} stroke="var(--color-accent)" strokeWidth={2} className="hmi-wire" />
            <path
              d="M -12 260 L 12 260 L 17 275 L -17 275 Z"
              fill="var(--color-accent)"
              stroke="var(--color-accent)"
              strokeWidth={1.5}
              className="hmi-wire"
            />
            {/* Ring light around the lens — brightens while dwelling on a point ("taking the shot"). */}
            <circle
              cx={0}
              cy={279}
              r={11}
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth={dwelling ? 2.5 : 1.5}
              strokeDasharray="3 3"
              opacity={dwelling ? 1 : 0.85}
              className="hmi-wire"
              style={{ transition: "stroke-width 120ms ease, opacity 120ms ease" }}
            />
            {/* Focus/aim beam — while animating it aims at the ACTIVE step's real (x,y); otherwise (no
                plan / idle / reduced-motion) it drops straight down, the pre-WS3-T2 static pose. */}
            <line
              x1={0}
              y1={290}
              x2={beamTargetX - cameraX}
              y2={beamTargetY}
              stroke="var(--color-accent)"
              strokeWidth={1}
              strokeDasharray="2 3"
              className="hmi-wire"
              style={{ transition: animate ? "x2 90ms linear, y2 90ms linear" : undefined }}
            />
          </g>
        </g>

        {/* Conveyor body — belt deck, end rollers, guide rails, moving belt ticks. */}
        <g>
          <line x1={116} y1={CONVEYOR_TOP - 4} x2={404} y2={CONVEYOR_TOP - 4} stroke="var(--text-muted)" strokeWidth={1} className="hmi-wire" opacity={0.6} />
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
          {/* Moving belt ticks — ambient "the conveyor is running" cue, gated on the same live-motion
              condition as the rest of the drawing (not tied to any one point). */}
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
          <circle cx={112} cy={CONVEYOR_TOP + 9} r={13} fill="none" stroke="var(--text-muted)" strokeWidth={1.5} className="hmi-wire" />
          <circle cx={408} cy={CONVEYOR_TOP + 9} r={13} fill="none" stroke="var(--text-muted)" strokeWidth={1.5} className="hmi-wire" />
        </g>

        {/* PCB — a solid card (fill `--color-surface`, distinct from the graph-paper `--color-bg`
            ground), bottom edge exactly on the belt deck's top edge. */}
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

        {/* WS3-T2 — the living twin's headline element (spec §7: "make this the strongest one"). Real
            measurement points, plotted at their true configured positions; whenever a real `CyclePlan`
            is in hand, each dot's colour is ITS OWN real result (revealed progressively in step order
            while animating, all-at-once when static/reduced-motion — never a fabricated match). With
            no plan (idle, E-STOPped, or no product ever linked), every dot is the neutral idle outline
            plotting position only — exactly the pre-WS3-T2 honest fallback. */}
        <g className="hmi-aoi-points-group">
          {hasLiveSteps
            ? liveSteps!.map((step, i) => {
                const cx = BOARD_X + clamp01(step.normalizedX) * BOARD_W
                const cy = BOARD_Y + clamp01(step.normalizedY) * BOARD_H
                // Static/reduced-motion (`clock` is null while `animate` is false): show every real
                // result immediately (design-doc §3.3 — "static, but last-known results, numbers still
                // update"). Animating: reveal in cycle order as the head actually arrives.
                const revealed = clock ? i < clock.revealedCount : true
                const resultLabel = step.result === "OK" ? t("hmi.progress.okLabel") : t("hmi.progress.ngLabel")
                const tone = !revealed || !step.result ? "idle" : step.result === "OK" ? "run" : "fault"
                return (
                  <circle
                    key={step.pointCode}
                    cx={cx}
                    cy={cy}
                    r={revealed && step.result ? 4.2 : 3.4}
                    fill={revealed && step.result ? `var(--color-status-${tone})` : "none"}
                    stroke={`var(--color-status-${tone})`}
                    strokeWidth={1.3}
                    className="hmi-wire hmi-aoi-point"
                    style={{ transition: "fill 140ms ease, stroke 140ms ease, r 140ms ease" }}
                  >
                    <title>
                      {revealed && step.result
                        ? t("hmi.schematic.measuredResult", { code: step.pointCode, result: resultLabel })
                        : t("hmi.schematic.configuredPosition", { code: step.pointCode })}
                    </title>
                  </circle>
                )
              })
            : points.map((p) => {
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

      {/* Dimension callouts, directly below the frame's base rail, x-aligned to what they measure. */}
      <DimensionLine x1={BOARD_X} x2={BOARD_X + BOARD_W} y={442} label={`${BOARD_W}`} />
      <DimensionLine x1={FRAME_LEFT} x2={FRAME_RIGHT} y={458} label="390" />
    </svg>
  )
}
