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
  line: navy[600],
  chartSeries: chartSeriesLight,
}

const darkTokens: ChartTokens = {
  surfaceCard: "#10254a", // navy-800
  border: "#24345c",
  textMuted: "#94a3b8",
  textBody: "#cbd5e1",
  textStrong: "#f8fafc",
  accent500: "#14b8c4",
  accent600: "#45cdd7",
  ok: "#4ade80",
  warn: "#fbbf24",
  danger: "#f87171",
  info: "#60a5fa",
  neutral: "#94a3b8",
  line: "#6f8ddb", // dark mode --chart-1 — a lighter blue that reads clearly on navy-800/900
  chartSeries: ["#6f8ddb", "#14b8c4", "#a78bfa", "#4ade80", "#fbbf24", "#7b93d6"],
}

export function useChartTokens(): ChartTokens {
  const { theme } = useTheme()
  return theme === "dark" ? darkTokens : lightTokens
}
