/**
 * Typed JS-side mirror of the CSS custom properties defined in `src/index.css`.
 *
 * CSS vars drive Tailwind utility classes (`bg-surface-subtle`, `text-navy-700`, …) —
 * use those in JSX/className whenever possible. This file exists for the few
 * consumers that need a literal color string rather than a class, e.g. Recharts
 * `stroke`/`fill` props, `<canvas>` drawing (BoardView bbox overlay), or anywhere
 * else a raw value has to cross into non-CSS rendering.
 *
 * Source of truth: docs/HMI_DESIGN_SPEC.md §2 (blueprint palette). If you change a
 * value here, change it in index.css too (and vice versa) — keep the two in lockstep.
 */

export const surface = {
  base: "#E9E9EA",
  subtle: "#F2F2F3",
  muted: "#E2E2E3",
  card: "#E9E9EA",
} as const

export const border = {
  DEFAULT: "color-mix(in srgb, #1D1F20 16%, transparent)",
  strong: "color-mix(in srgb, #1D1F20 30%, transparent)",
} as const

export const navy = {
  50: "#F0F3FA",
  100: "#DDE4F4",
  200: "#C0CDEA",
  300: "#97ABDC",
  400: "#6B84C8",
  500: "#4762AE",
  600: "#30498F",
  700: "#1E3A8A", // BASE brand navy
  800: "#16295F",
  900: "#0F1C42",
} as const

export const text = {
  strong: "#1D1F20",
  body: "#3A3D40",
  muted: "#55585C",
} as const

/** Secondary accent — repointed onto the navy family (kept as its own name for existing
 * chart-token consumers that reference `accent[500]`/`accent[600]`). */
export const accent = {
  100: navy[100],
  500: navy[500],
  600: navy[600],
} as const

/** Status ramp (spec §2) — identical in both themes, carries safety meaning. */
export const status = {
  ok: "#2F8F5A",
  warn: "#C98A1A",
  danger: "#C0392B",
  info: navy[600],
  neutral: "#7A7A7D",
} as const

/** Recharts / multi-series chart palette, in draw order — navy gradation reads as a technical
 * drawing rather than a rainbow; pass/fail markers use `status.ok`/`status.danger` directly. */
export const chartSeries = [navy[700], navy[400], navy[300], status.ok, status.warn, navy[500]] as const

export const radius = {
  control: 0,
  card: 0,
  pill: 0,
} as const

export const tokens = {
  surface,
  border,
  navy,
  text,
  accent,
  status,
  chartSeries,
  radius,
} as const

export type Tokens = typeof tokens
