/**
 * DS F1b — Design-system token constants (doc 16 §12.1).
 *
 * ADDITIVE & opt-in. These are the *runtime* counterparts to the CSS tokens in
 * `client/src/index.css` (colors, type scale, status tints live in CSS). This
 * module centralises the values that are easier to consume from TS/JS:
 *   • Framer Motion spring presets — replace ad-hoc `transition={{ ... }}`.
 *   • Spacing / radius / elevation references — documentation + a couple of
 *     helpers, NOT a replacement for Tailwind utilities.
 *
 * Nothing here changes existing pages; import it where you want consistency.
 */
import type { Transition } from "framer-motion";

/* ── Framer Motion springs (doc 16 §12.1 "Motion") ──────────────────────────
 * Three intents: page/element ENTRY, in-place STATE change, and ERROR/SUCCESS
 * emphasis. Standardise on these instead of hard-coded durations. */
export const motion = {
  /** Element/page entry — soft, slightly bouncy. */
  entry: { type: "spring", stiffness: 260, damping: 26, mass: 0.9 } satisfies Transition,
  /** In-place state change (expand, toggle, reorder) — snappy, no overshoot. */
  state: { type: "spring", stiffness: 400, damping: 34 } satisfies Transition,
  /** Error/success emphasis — quick, attention-grabbing. */
  emphasis: { type: "spring", stiffness: 500, damping: 22 } satisfies Transition,
  /** Linear duration fallback for cross-fades where spring is wrong. */
  fade: { duration: 0.18, ease: "easeOut" } satisfies Transition,
} as const;

/** Common entry variant pair (fade + lift), pairs with `motion.entry`. */
export const fadeInUp = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 8 },
} as const;

/* ── Spacing — 4px grid (doc 16 §12.1 "Spacing") ────────────────────────────
 * Tailwind already encodes this (1 = 4px). Use these names in docs/specs; in
 * markup prefer the Tailwind utilities (p-2, gap-4, …). */
export const spacing = {
  xs: 4, // p-1
  sm: 8, // p-2
  md: 12, // p-3
  lg: 16, // p-4
  xl: 24, // p-6
  "2xl": 32, // p-8
  "3xl": 48, // p-12
  "4xl": 64, // p-16
} as const;

/* ── Radius — maps to the CSS --radius ramp in index.css @theme ─────────────
 * sm = radius-4 · md = radius-2 · lg = radius · xl = radius+4. Base 0.625rem. */
export const radius = {
  sm: "rounded-sm",
  md: "rounded-md",
  lg: "rounded-lg",
  xl: "rounded-xl",
  full: "rounded-full",
} as const;

/* ── Elevation — Tailwind shadow utilities chosen as the DS ramp ────────────
 * Card default is shadow-sm; raise to lg for dialogs/popovers/floating panels. */
export const elevation = {
  flat: "shadow-none",
  raised: "shadow-sm", // cards (matches ui/card)
  overlay: "shadow-lg", // dialogs, popovers
  floating: "shadow-xl", // command palette / mega-menu
} as const;

/* ── Semantic tones — single source of truth for status → token mapping ─────
 * Used by StatusBadge / MetricCard. `accent` is the brand primary. */
export type Tone = "default" | "success" | "warning" | "error" | "info" | "accent";
