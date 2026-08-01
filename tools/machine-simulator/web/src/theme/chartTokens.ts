/**
 * Reactive per-theme literal colors for the handful of consumers that draw outside CSS (Recharts
 * `stroke`/`fill` props, raw SVG) — see `theme/tokens.ts`'s doc comment for why those need literal
 * hex strings instead of `var(--…)` at all. `tokens.ts` only ever exports the GLASS values (it
 * predates the 3-theme system); this adds Console's and Warmth's own counterparts and picks
 * between all three based on the live theme, so chart lines/grids/tooltips stay legible instead of
 * silently keeping Glass's colors (e.g. navy-600 on Console's near-black ground — nearly invisible)
 * after the user switches theme.
 *
 * Mirrors `index.css`'s three `[data-theme="…"]` blocks; keep all three in lockstep.
 */
import { useTheme } from "@/theme/ThemeToggle"
import { accent, border, chartSeries as chartSeriesGlass, navy, status, surface, text } from "@/theme/tokens"

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

const glassTokens: ChartTokens = {
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
  chartSeries: chartSeriesGlass,
}

// Mirrors index.css's [data-theme="console"] block — near-black "control room" ground, navy lifts
// to --color-accent (cyan #38D6FF) for legibility, status ramp keeps its HUE (spec §2: safety-
// meaning colors never shift between themes) but uses Console's own AA-tuned lightness.
const consoleTokens: ChartTokens = {
  surfaceCard: "#161D27", // --color-surface (console)
  border: "color-mix(in srgb, #e9f1fb 14%, transparent)", // --color-divider (console)
  textMuted: "#7F8CA4",
  textBody: "#C3CEDE",
  textStrong: "#E9F1FB",
  accent500: "#38D6FF",
  accent600: "#8BE8FF",
  ok: "#2EE88F",
  warn: "#FFB63A",
  danger: "#FF5C52",
  info: "#38D6FF", // console --color-accent — the cyan that reads on a near-black ground
  neutral: "#7F8CA4",
  line: "#38D6FF",
  chartSeries: ["#38D6FF", navy[300], navy[200], "#2EE88F", "#FFB63A", "#8BE8FF"],
}

// Mirrors index.css's [data-theme="warmth"] block — warm paper ground, accent stays the flat brand
// navy (unlifted, same reasoning as Glass), status ramp keeps its HUE with Warmth's own AA-tuned
// lightness.
const warmthTokens: ChartTokens = {
  surfaceCard: "#EBE7DD", // --color-surface (warmth)
  border: "#D3CCBD", // --border (warmth)
  textMuted: "#625C4F",
  textBody: "#4A453A",
  // Matches index.css's [data-theme="warmth"] --color-text (darkened from the mock's #26221B for
  // AA margin — see that file's own comment for the hand-calculated contrast).
  textStrong: "#1E1A13",
  accent500: "#B0691A", // warmth's own amber accent-500 (secondary accent, not the primary navy)
  accent600: "#8F5414",
  ok: "#3F8C4F",
  warn: "#BD851B",
  danger: "#BB3B2E",
  info: navy[600],
  neutral: "#8A8371",
  line: navy[700], // warmth --color-accent === navy-700 (unlifted)
  chartSeries: [navy[700], navy[400], navy[300], "#3F8C4F", "#BD851B", navy[500]],
}

export function useChartTokens(): ChartTokens {
  const { theme } = useTheme()
  if (theme === "console") return consoleTokens
  if (theme === "warmth") return warmthTokens
  return glassTokens
}
