import * as React from "react"

import { computeCyclePlanClock, type CyclePlanClock, type TwinPoint } from "@/components/hmi/cycleTwin"
import type { CyclePlan } from "@/lib/api"

/**
 * `prefers-reduced-motion` — spec §7/§9 + docs/PRODUCTION_UI_DESIGN.md §3.3 ("tôn trọng
 * prefers-reduced-motion (tĩnh, chỉ cập nhật số)"). Not wired through framer-motion's
 * `MotionConfig`/`main.tsx` here — the living twin is plain SVG attributes driven by
 * `requestAnimationFrame`, not framer-motion, so it needs its own live read of the OS setting (and to
 * react if the user flips it while the panel is open, same as a real accessibility setting should).
 */
export function usePrefersReducedMotion(): boolean {
  const getSnapshot = () =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false

  return React.useSyncExternalStore(
    (onChange) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {}
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
      mq.addEventListener("change", onChange)
      return () => mq.removeEventListener("change", onChange)
    },
    getSnapshot,
    () => false
  )
}

/**
 * WS3-T2 — the `requestAnimationFrame` loop behind the living twin: re-renders the calling component
 * every frame (via a `now` tick) ONLY while `animate` is true, and derives the plan's motion/reveal
 * state fresh each time from `plan` + wall-clock `now` (`cycleTwin.ts`'s `computeCyclePlanClock`) —
 * never accumulated/integrated client-side state, so a plan swap (a new `cycleCounter` from the next
 * ~1s poll) or a clock hiccup can never drift: every frame is computed directly from the CURRENT
 * plan's own `startedAt`/`durationSeconds`, exactly like the design brief's "engine sends the plan at
 * cycle start + cycle timing; the web animates locally" (§3.2).
 *
 * Returns `null` whenever there's nothing to animate — `animate` is false (idle, halted, or
 * `prefers-reduced-motion` — the caller decides which) or `plan` has no steps — so a caller's render
 * branch is a single null-check, not a second flag to keep in sync.
 */
export function useCycleTwin(plan: CyclePlan | null | undefined, restPoint: TwinPoint, animate: boolean): CyclePlanClock | null {
  const [now, setNow] = React.useState(() => Date.now())

  React.useEffect(() => {
    if (!animate) return
    let rafId = 0
    let cancelled = false
    const tick = () => {
      if (cancelled) return
      setNow(Date.now())
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => {
      cancelled = true
      cancelAnimationFrame(rafId)
    }
  }, [animate])

  // restPoint is a plain {x,y} literal at most call sites (re-created every render) — depend on its
  // VALUES, not its identity, so the memo below doesn't recompute (and the effect above doesn't need
  // to either, it never referenced restPoint) every single render for no reason.
  return React.useMemo(() => {
    if (!animate || !plan) return null
    return computeCyclePlanClock(plan, restPoint, now)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animate, plan, restPoint.x, restPoint.y, now])
}
