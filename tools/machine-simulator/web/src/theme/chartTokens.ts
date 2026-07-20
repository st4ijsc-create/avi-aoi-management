/**
 * Reactive per-theme literal colors for the handful of consumers that draw outside CSS (Recharts
 * `stroke`/`fill` props, raw SVG) — see `theme/tokens.ts`'s doc comment for why those need literal
 * hex strings instead of `var(--…)` at all. `tokens.ts` only ever exported the LIGHT values (it
 * predates dark mode); this adds the dark counterpart and picks between the two based on the live
 * theme, so chart lines/grids/tooltips stay legible instead of silently keeping light-mode colors
 * (e.g. navy-600 on a navy-900 background — nearly invisible) after the user flips to dark.
 *
 * Mirrors `index.css`'s `:root[data-theme="dark"]` block; keep the two in lockstep.
 */
import { useTheme } from "@/theme/ThemeToggle"
import { accent, border, chartSeries as chartSeriesLight, navy, status, surface, text } from "@/theme/tokens"

export interface ChartTokens {
  surfaceCard: string
  border: string
  textMuted: string
  textBody: string
  textStrong: string
  accent500: string
  accent600: string
  ok: string
  warn: string
  danger: string
  info: string
  neutral: string
  /** Default single-series line color (Sparkline, SPC "Value" line) — legible on its own surface. */
  line: string
  chartSeries: readonly string[]
}

const lightTokens: ChartTokens = {
  surfaceCard: surface.card,
  border: border.DEFAULT,
  textMuted: text.muted,
  textBody: text.body,
  textStrong: text.strong,
  accent500: accent[500],
  accent600: accent[600],
  ok: status.ok,
  warn: status.warn,
  danger: status.danger,
  info: status.info,
  neutral: status.neutral,
  line: navy[700],
  chartSeries: chartSeriesLight,
}

// Mirrors index.css's :root[data-theme="dark"] block — "control room" ground, navy lifts to
// --color-accent (#7f9be0) for legibility, status ramp stays fixed (spec §2: safety-meaning colors
// never shift between themes).
const darkTokens: ChartTokens = {
  surfaceCard: "#1e2126", // --color-surface (dark)
  border: "color-mix(in srgb, #e9eaec 16%, transparent)",
  textMuted: "#9a9da2",
  textBody: "#c7c9cc",
  textStrong: "#e9eaec",
  accent500: "#7f9be0",
  accent600: "#97abdc",
  ok: status.ok,
  warn: status.warn,
  danger: status.danger,
  info: "#7f9be0",
  neutral: status.neutral,
  line: "#7f9be0", // dark mode --color-accent — the lifted navy that reads on a near-black ground
  chartSeries: ["#7f9be0", navy[300], navy[200], status.ok, status.warn, "#97abdc"],
}

export function useChartTokens(): ChartTokens {
  const { theme } = useTheme()
  return theme === "dark" ? darkTokens : lightTokens
}
