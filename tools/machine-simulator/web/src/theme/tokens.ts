/**
 * Typed JS-side mirror of the CSS custom properties defined in `src/index.css`.
 *
 * CSS vars drive Tailwind utility classes (`bg-surface-subtle`, `text-navy-700`, …) —
 * use those in JSX/className whenever possible. This file exists for the few
 * consumers that need a literal color string rather than a class, e.g. Recharts
 * `stroke`/`fill` props, `<canvas>` drawing (BoardView bbox overlay), or anywhere
 * else a raw value has to cross into non-CSS rendering.
 *
 * Source of truth: Doc 65 §2.1 (docs/ECOSYSTEM/65_SIMULATOR_UI_WEB_UPGRADE_PLAN).
 * If you change a value here, change it in index.css too (and vice versa) —
 * keep the two in lockstep.
 */

export const surface = {
  base: "#FFFFFF",
  subtle: "#F8FAFC",
  muted: "#F1F5F9",
  card: "#FFFFFF",
} as const

export const border = {
  DEFAULT: "#E2E8F0",
  strong: "#CBD5E1",
} as const

export const navy = {
  50: "#F4F7FC",
  100: "#E8EEF9",
  500: "#2749A8",
  600: "#1E3A8A", // primary
  700: "#163561",
  800: "#10254A",
  900: "#0B1B34",
} as const

export const text = {
  strong: "#0B1B34",
  body: "#334155",
  // Darkened from doc 65's literal #64748B to hold AA 4.5:1 against
  // surface-muted too (not just surface-base) — see index.css for the math.
  muted: "#5E6D85",
} as const

export const accent = {
  100: "#E2F5F6",
  500: "#0E9AA7",
  600: "#0B7E89",
} as const

export const status = {
  ok: "#16A34A",
  warn: "#D97706",
  danger: "#DC2626",
  info: "#2563EB",
  neutral: "#94A3B8",
} as const

/**
 * AA-safe (>=4.5:1) text color per status, verified against each status's
 * own 10% tint fill (the actual background StatusBadge renders on) — a
 * same-hue tint reads as *lower* contrast than pure white would suggest, so
 * every entry here is darkened from the solid hue in `status` above, axe
 * confirmed. Don't use `status.neutral` as text at all — pair its dot with
 * a normal-contrast label instead.
 */
export const statusText = {
  ok: "#166534",
  warn: "#B45309",
  danger: "#B91C1C",
  info: "#1D4ED8",
} as const

/** Recharts / multi-series chart palette, in draw order. */
export const chartSeries = [
  navy[600],
  accent[500],
  "#7C3AED",
  status.ok,
  status.warn,
  navy[500],
] as const

export const radius = {
  control: 8,
  card: 12,
  pill: 999,
} as const

export const tokens = {
  surface,
  border,
  navy,
  text,
  accent,
  status,
  statusText,
  chartSeries,
  radius,
} as const

export type Tokens = typeof tokens
