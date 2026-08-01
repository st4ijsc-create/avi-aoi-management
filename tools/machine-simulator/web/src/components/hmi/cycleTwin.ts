import type { CyclePlan } from "@/lib/api"

/**
 * WS3-T2 (docs/PRODUCTION_UI_DESIGN.md §3.2/§3.3) — the living-twin motion model shared by all three
 * schematics (`AoiSchematic`/`AutomationSchematic`/`IotSchematic`). Pure math, no React — the head/
 * carriage/camera's position and each step's "have we arrived yet" state are BOTH derived, every
 * frame, from the SAME two real inputs the engine ships on `CyclePlan` (WS3-T1): `startedAt` (a real
 * wall-clock timestamp) and `durationSeconds` (this cycle's real cadence) — never a decorative
 * fixed-duration CSS loop. See `useCycleTwin.ts` for the `requestAnimationFrame` wiring that calls
 * this on every frame.
 *
 * Model: the head visits `plan.steps` IN ORDER, one per equal-length "segment" of the cycle
 * (`durationSeconds / steps.length`) — segment `i` runs from `restPoint`/`steps[i-1]` to `steps[i]`.
 * Within a segment, the first `TRAVEL_FRACTION` is spent GLIDING toward the target (the head's
 * rendered position lerps smoothly); the remainder is spent DWELLING there (the head holds still,
 * `dwelling` is true, and the step's own real `result` becomes "revealed" — i.e. safe for a caller to
 * colour a dot by). This reads as a real inspection/fastening head: move, arrive, take the
 * measurement, move on — not a smear across the whole segment.
 */

export interface TwinPoint {
  x: number
  y: number
}

export interface CyclePlanClock {
  /** 0..1 progress across the WHOLE cycle (elapsed / durationSeconds, clamped). */
  progress: number
  /** Index of the step currently being traveled to / dwelled at. Always a valid index into
   * `plan.steps` (clamped to the last one once the cycle's nominal duration has fully elapsed). */
  activeIndex: number
  /** 0..1 progress within the CURRENT segment (travel + dwell combined). */
  segmentProgress: number
  /** True once the head has arrived at `steps[activeIndex]` and is holding there — the cue a caller
   * uses to spin a bit / stroke a Z-axis / flash a ring light for "actively taking this reading". */
  dwelling: boolean
  /** How many of the EARLIEST steps have been arrived-at-and-measured so far this cycle — a caller
   * colours `steps[0..revealedCount)` by their real result and leaves the rest neutral/pending. Steps
   * are always revealed in order (index 0 first), matching a real head visiting them in sequence. */
  revealedCount: number
  /** Interpolated head/carriage position this instant, in the SAME normalized 0..1 space
   * `CyclePlanStep.normalizedX/Y` uses — a caller maps this into its own pixel geometry. */
  head: TwinPoint
}

/** First 55% of a segment is travel (the rendered position glides toward the target); the remaining
 * 45% is dwell (holds still, result reveals, "taking the reading"). Chosen so both phases read
 * clearly at this app's real per-segment durations (~0.1–0.4s: AOI's 1.8s/8-point cycles run ~0.22s
 * per segment, SCRW's 0.85s/4-point cycles ~0.21s) — a pure glide-then-pause is closer to how a real
 * inspection/fastening head actually moves than a constant-velocity sweep with no dwell at all. */
const TRAVEL_FRACTION = 0.55

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value))
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerpPoint(a: TwinPoint, b: TwinPoint, t: number): TwinPoint {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) }
}

/**
 * Computes the twin's full motion/reveal state at wall-clock instant `nowMs` for `plan`. Returns
 * `null` for a plan with zero steps (nothing to animate — a caller should render the static/idle
 * pose) or an unparsable `startedAt` (defensive; every real engine payload parses).
 *
 * `restPoint` is where the head "lives" before/between cycles (segment 0 travels FROM this point TO
 * `steps[0]`) — each schematic supplies its own (e.g. the rail's left end for AOI/Automation), in the
 * SAME normalized space as the plan's own points.
 */
export function computeCyclePlanClock(plan: CyclePlan, restPoint: TwinPoint, nowMs: number): CyclePlanClock | null {
  const steps = plan.steps
  const n = steps.length
  if (n === 0) return null

  const startedAtMs = Date.parse(plan.startedAt)
  if (!Number.isFinite(startedAtMs)) return null

  const durationSec = Math.max(plan.durationSeconds, 0.001)
  const elapsedSec = clamp((nowMs - startedAtMs) / 1000, 0, durationSec)
  const segDur = durationSec / n

  const activeIndex = Math.min(n - 1, Math.floor(elapsedSec / segDur))
  const segElapsed = elapsedSec - activeIndex * segDur
  const segmentProgress = segDur > 0 ? clamp(segElapsed / segDur, 0, 1) : 1
  const travelProgress = clamp(segmentProgress / TRAVEL_FRACTION, 0, 1)
  const dwelling = segmentProgress >= TRAVEL_FRACTION

  const cycleComplete = elapsedSec >= durationSec
  const revealedCount = dwelling || cycleComplete ? activeIndex + 1 : activeIndex

  const prevPoint: TwinPoint =
    activeIndex === 0 ? restPoint : { x: steps[activeIndex - 1].normalizedX, y: steps[activeIndex - 1].normalizedY }
  const targetPoint: TwinPoint = { x: steps[activeIndex].normalizedX, y: steps[activeIndex].normalizedY }

  return {
    progress: elapsedSec / durationSec,
    activeIndex,
    segmentProgress,
    dwelling,
    revealedCount,
    head: lerpPoint(prevPoint, targetPoint, travelProgress),
  }
}
