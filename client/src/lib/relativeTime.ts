/**
 * DS Wave-2 — relative-time helpers (doc 16 §12.2 micro-primitives).
 *
 * One consistent implementation of "2 minutes ago" / "in 3 hours" strings used
 * across pages, replacing the divergent per-page `Math.floor(ms/1000)…` snippets.
 * The verbose variant delegates to `date-fns` (`formatDistanceStrict`) so the
 * wording, pluralisation and rounding are correct and locale-ready (defaults to
 * en). The short variant returns a compact glanceable magnitude (`5m`, `3h`).
 *
 * Invalid / absent inputs render as an em dash ("—") so callers never show
 * "Invalid Date" or "NaN".
 *
 * @example
 *   relativeTime(row.updatedAt);        // "5 minutes ago"
 *   relativeTimeShort(row.updatedAt);   // "5m"
 *   const ago = useRelativeTime(lastSeen); // live, re-renders every 30s
 */
import * as React from "react";
import { formatDistanceStrict } from "date-fns";

const EMPTY = "—";

/** Coerce a Date | string | number into a valid Date, or null if unparseable. */
function toDate(input: Date | string | number | null | undefined): Date | null {
  if (input == null) return null;
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Verbose relative time with a direction suffix, e.g. "5 minutes ago" / "in 3
 * hours". `now` is injectable for testing/consistency (defaults to `new Date()`).
 */
export function relativeTime(input: Date | string | number, now?: Date): string {
  const date = toDate(input);
  if (!date) return EMPTY;
  const base = toDate(now) ?? new Date();
  return formatDistanceStrict(date, base, { addSuffix: true });
}

/**
 * Compact, direction-agnostic magnitude — `s` / `m` / `h` / `d` / `w` / `y`.
 * Returns "now" when within a second. Use where space is tight (table cells,
 * chips). For the full phrase incl. "ago"/"in", use {@link relativeTime}.
 */
export function relativeTimeShort(input: Date | string | number, now?: Date): string {
  const date = toDate(input);
  if (!date) return EMPTY;
  const base = toDate(now) ?? new Date();
  const secs = Math.round(Math.abs(base.getTime() - date.getTime()) / 1000);

  if (secs < 1) return "now";
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 52) return `${weeks}w`;
  return `${Math.floor(days / 365)}y`;
}

/**
 * Live-updating verbose relative time. Re-renders on an interval (default 30s)
 * so a mounted "X ago" label stays fresh, and cleans up its timer on unmount /
 * when the input changes.
 */
export function useRelativeTime(input: Date | string | number, refreshMs = 30_000): string {
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    if (refreshMs <= 0) return;
    const id = setInterval(() => setTick((n) => n + 1), refreshMs);
    return () => clearInterval(id);
  }, [refreshMs, input]);
  return relativeTime(input);
}
