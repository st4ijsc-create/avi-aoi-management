/**
 * Typed JS-side mirror of the CSS custom properties defined in `src/index.css`.
 *
 * CSS vars drive Tailwind utility classes (`bg-surface-subtle`, `text-navy-700`, …) —
 * use those in JSX/className whenever possible. This file exists for the few
 * consumers that need a literal color string rather than a class, e.g. Recharts
 * `stroke`/`fill` props, `<canvas>` drawing (BoardView bbox overlay), or anywhere
 * else a raw value has to cross into non-CSS rendering.
 *
 * WS1 — this file only ever mirrors the **Glass** theme (it predates the 3-theme system, same
 * "predates dark mode" limitation `theme/chartTokens.ts`'s own doc comment already calls out for
 * its historical light/dark split). Console/Warmth's own literal values live directly in
 * `chartTokens.ts` instead (the one consumer that actually needs to react to the live theme);
 * anything importing straight from here (`routes/_tokens.tsx`'s standalone showcase) always shows
 * Glass's numbers regardless of that page's own local toggle — pre-existing behavior, unchanged.
 *
 * Source of truth: `index.css`'s bare `:root` block (== the Glass theme). If you change a value
 * here, change it there too (and vice versa) — keep the two in lockstep.
 */

export const surface = {
  base: "#FFFFFF",
  subtle: "#EEF1F7",
  muted: "#E6EBF3",
  card: "#FFFFFF",
} as const

export const border = {
  DEFAULT: "#D6DCE7",
  strong: "#B7C1D6",
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
  strong: "#1B2233",
  body: "#333C52",
  // Darkened from the mock's #66708A for AA margin — see index.css's :root --text-muted comment
  // for the hand-calculated contrast ratios this was tuned against.
  muted: "#5D6780",
} as const

/** Secondary accent — Glass's own azure family (kept as its own name for existing
 * chart-token consumers that reference `accent[500]`/`accent[600]`). */
export const accent = {
  100: "#DCE7FF",
  500: "#2F6BFF",
  600: "#1D4FD1",
} as const

/** Status ramp (spec §2, WS1 §1.2) — hue/meaning identical across all 3 themes, only lightness is
 * tuned per theme for AA (this file only ever mirrors Glass's tuning — see this file's doc
 * comment). */
export const status = {
  ok: "#1F9D57",
  warn: "#C68717",
  danger: "#D84437",
  info: navy[600],
  neutral: "#7D8598",
} as const

/** Recharts / multi-series chart palette, in draw order — navy gradation reads as a technical
 * drawing rather than a rainbow; pass/fail markers use `status.ok`/`status.danger` directly. */
export const chartSeries = [navy[700], navy[400], navy[300], status.ok, status.warn, navy[500]] as const

/** WS1 — radius is per-theme now; this mirrors Glass's (8px control/card, a real 999px pill —
 * see index.css's :root --radius/--radius-pill comments for why the pill is theme-invariant). */
export const radius = {
  control: 8,
  card: 8,
  pill: 999,
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
