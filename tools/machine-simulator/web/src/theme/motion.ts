/**
 * Reusable framer-motion presets — timings from Doc 65 §2.2.
 *
 * `prefers-reduced-motion` is handled globally by wrapping the app in
 * `<MotionConfig reducedMotion="user">` (see `src/main.tsx`), which makes
 * framer-motion swap every transform-based animation below for an
 * instant/opacity-only equivalent when the OS setting is on. Components
 * using these presets don't need to think about it.
 */
import type { Transition, Variants } from "framer-motion"

/** Standard "something appeared" easing/duration — modals, cards, route enters. */
export const enterTransition: Transition = {
  duration: 0.18,
  ease: [0.16, 1, 0.3, 1], // ease-out-expo-ish, calm deceleration
}

/** Layout reflow (resizing panels, list reorders). */
export const layoutTransition: Transition = {
  duration: 0.2,
  ease: [0.4, 0, 0.2, 1],
}

/** Per-item delay inside a staggered list/grid. */
export const staggerStep = 0.03

export const fade: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: enterTransition },
}

export const fadeSlideUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: enterTransition },
}

export const fadeSlideDown: Variants = {
  hidden: { opacity: 0, y: -8 },
  visible: { opacity: 1, y: 0, transition: enterTransition },
}

/** Wrap a list/grid container with this; children use `staggerItem`. */
export const staggerContainer: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: staggerStep,
      delayChildren: 0.02,
    },
  },
}

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: enterTransition },
}

/** Subtle lift for interactive cards/tiles — pair with `whileHover`. */
export const hoverLift = {
  scale: 1.01,
  transition: { duration: 0.12, ease: [0.4, 0, 0.2, 1] },
}

/** Row entering a live-streaming table/list (API Inspector, cycle log). */
export const rowEnter: Variants = {
  hidden: { opacity: 0, y: -6 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.15, ease: "easeOut" } },
  exit: { opacity: 0, transition: { duration: 0.1 } },
}
