/**
 * andonBoard — pure helpers for the /andon TV board (doc 27 F7 / W5-C).
 * Kept free of React/DOM so they run under the node-env unit tests
 * (*.unit.test.ts convention).
 *
 * URL contract of /andon (all optional):
 *   ?kiosk=1        hide chrome + fullscreen on first tap (global useKioskMode;
 *                   the board renders chrome-free regardless)
 *   ?cycle=30       auto-cycle seconds between "all lines" and each line view
 *                   (0/absent = no cycling; minimum 5s)
 *   ?lines=12,14    numeric production-line IDs — server-side filter
 *   ?factory=1      numeric factory ID — server-side filter
 *   ?theme=dark     force dark/light (default: whatever the app theme is)
 *   ?warn=95&crit=90  yield thresholds (%) for tile colours
 */

export interface AndonBoardParams {
  cycleSec: number; // 0 = off
  lineIds: number[];
  factoryId: number | null;
  theme: "dark" | "light" | null;
  warnPct: number;
  critPct: number;
}

export const ANDON_DEFAULT_WARN_PCT = 95;
export const ANDON_DEFAULT_CRIT_PCT = 90;

/** Parse the /andon query string. Invalid values fall back to safe defaults. */
export function parseAndonBoardParams(search: string): AndonBoardParams {
  const params = new URLSearchParams(search);

  const cycleRaw = Number(params.get("cycle"));
  const cycleSec = Number.isFinite(cycleRaw) && cycleRaw > 0 ? Math.max(5, Math.floor(cycleRaw)) : 0;

  const lineIds = (params.get("lines") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n > 0);

  const factoryRaw = Number(params.get("factory"));
  const factoryId = Number.isInteger(factoryRaw) && factoryRaw > 0 ? factoryRaw : null;

  const themeRaw = params.get("theme");
  const theme = themeRaw === "dark" || themeRaw === "light" ? themeRaw : null;

  const warnRaw = Number(params.get("warn"));
  const critRaw = Number(params.get("crit"));
  let warnPct = Number.isFinite(warnRaw) && warnRaw > 0 && warnRaw <= 100 ? warnRaw : ANDON_DEFAULT_WARN_PCT;
  const critPct = Number.isFinite(critRaw) && critRaw > 0 && critRaw <= 100 ? critRaw : ANDON_DEFAULT_CRIT_PCT;
  if (warnPct < critPct) warnPct = critPct; // never let the bands invert

  return { cycleSec, lineIds, factoryId, theme, warnPct, critPct };
}

/**
 * Cycle views: index 0 = all-lines overview, then one view per line.
 * Returns the next view index (wraps). With <2 views there is nothing to
 * cycle through, so it stays at 0.
 */
export function nextCycleIndex(current: number, viewCount: number): number {
  if (viewCount <= 1) return 0;
  return (current + 1) % viewCount;
}

export type TileStatus = "andon" | "offline" | "crit" | "warn" | "good" | "idle";

/**
 * Classify a machine tile. Priority (most urgent first):
 *   active andon (red/call) > offline > yield < crit > yield < warn > good;
 *   no data today (finalYield null) → idle. A yellow andon does not override
 *   yield colouring by itself — it is shown as a badge; red/call take the tile.
 */
export function tileStatus(input: {
  finalYield: number | null;
  andonState: "call" | "red" | "yellow" | null;
  online: boolean | null; // null = unknown (no socket info yet)
  warnPct: number;
  critPct: number;
}): TileStatus {
  if (input.andonState === "red" || input.andonState === "call") return "andon";
  if (input.online === false) return "offline";
  if (input.finalYield == null) return "idle";
  if (input.finalYield < input.critPct) return "crit";
  if (input.finalYield < input.warnPct) return "warn";
  return "good";
}

/** Compact "3m" / "2h" age label for ticker items. */
export function agoLabel(fromMs: number, nowMs: number): string {
  const s = Math.max(0, Math.floor((nowMs - fromMs) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}
