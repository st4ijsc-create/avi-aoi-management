/**
 * doc 44 W6-2 / G5.15 — ONE canonical severity scale for the whole app.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * The system speaks severity in at least four dialects (SYNAPSE Tầng 7 §7.1
 * "severity phân mảnh 3/4/5 thang"):
 *   • Andon states    green | yellow | red | call
 *   • MQTT/central    info | warning | critical            (3-scale, DB enum)
 *   • UNS event bus   info | warning | error | critical    (4-scale — CANONICAL)
 *   • Mobile / fed.   info | low | medium | high | critical (5-scale)
 *
 * This module maps ALL of them onto the 4-level canonical scale used by the UNS
 * stream (server: unsStreamGateway `UnsSeverity`) so the HMI renders ONE colour /
 * label / ordering everywhere. It is DISPLAY-LAYER ONLY — it does NOT rewrite any
 * DB enum (those stay `info|warning|critical`); it normalizes at render time.
 *
 * Where the SERVER should eventually converge (report to owner, not done here):
 *   • drizzle/schema/enums.ts `severityEnum` is 3-level — a 4-level `error` band
 *     would need a migration; today `error` collapses into the DB `critical`.
 *   • unsStreamGateway maps andon `call` → warning while andonStateToSeverity
 *     (factoryCommandService) maps `call` → critical. We standardize on
 *     call → critical here (escalation) and flag the server inconsistency.
 * ════════════════════════════════════════════════════════════════════════════
 */

/** The ONE severity scale. Ordered least → most severe. */
export type CanonicalSeverity = "info" | "warning" | "error" | "critical";

export const CANONICAL_SEVERITIES: readonly CanonicalSeverity[] = [
  "info",
  "warning",
  "error",
  "critical",
] as const;

/** Rank (higher = more severe) — for sorting / comparison. */
export const SEVERITY_RANK: Record<CanonicalSeverity, number> = {
  info: 0,
  warning: 1,
  error: 2,
  critical: 3,
};

/**
 * Synonym → canonical lookup (all lowercase). Covers andon states, the 3/4/5
 * scales, common log levels and priority words. Unrecognized strings fall back
 * to `warning` (visible, but not screaming — never silently dropped).
 */
const SYNONYMS: Record<string, CanonicalSeverity> = {
  // ── critical ──
  critical: "critical",
  crit: "critical",
  fatal: "critical",
  emergency: "critical",
  severe: "critical",
  red: "critical", // andon
  call: "critical", // andon — escalation (help requested)
  blocker: "critical",
  p1: "critical",
  sev1: "critical",
  // ── error ──
  error: "error",
  err: "error",
  high: "error", // 5-scale
  major: "error",
  danger: "error",
  p2: "error",
  sev2: "error",
  // ── warning ──
  warning: "warning",
  warn: "warning",
  yellow: "warning", // andon
  medium: "warning", // 5-scale
  moderate: "warning",
  minor: "warning",
  degraded: "warning",
  caution: "warning",
  p3: "warning",
  sev3: "warning",
  // ── info ──
  info: "info",
  information: "info",
  informational: "info",
  notice: "info",
  low: "info", // 5-scale
  green: "info", // andon
  ok: "info",
  normal: "info",
  nominal: "info",
  cosmetic: "info",
  trace: "info",
  debug: "info",
  none: "info",
  p4: "info",
  p5: "info",
  sev4: "info",
  sev5: "info",
};

/**
 * Map ANY source severity (andon state, mqtt, central, mobile, federation,
 * log-level, priority word) → the canonical scale. Case/space-insensitive.
 * Unknown → `warning` (safe middle). Never throws.
 */
export function toCanonicalSeverity(raw: unknown): CanonicalSeverity {
  if (raw == null) return "warning";
  const s = String(raw).trim().toLowerCase();
  if (!s) return "warning";
  const hit = SYNONYMS[s];
  if (hit) return hit;
  // Numeric priority (1 highest) — common in legacy alert rows.
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (n <= 1) return "critical";
    if (n === 2) return "error";
    if (n === 3) return "warning";
    return "info";
  }
  return "warning";
}

/** Convenience: an Andon state string → canonical severity. */
export function andonStateToCanonical(state: unknown): CanonicalSeverity {
  return toCanonicalSeverity(state);
}

/** Compare two (raw or canonical) severities: negative if a is LESS severe. */
export function compareSeverity(a: unknown, b: unknown): number {
  return SEVERITY_RANK[toCanonicalSeverity(a)] - SEVERITY_RANK[toCanonicalSeverity(b)];
}

/** Is `a` at least as severe as `min`? (both raw or canonical). */
export function severityAtLeast(a: unknown, min: unknown): boolean {
  return SEVERITY_RANK[toCanonicalSeverity(a)] >= SEVERITY_RANK[toCanonicalSeverity(min)];
}

// ─── Presentation metadata (theme-aware tailwind classes + i18n keys) ────────

export interface SeverityMeta {
  /** i18n key (default Vietnamese label in the second t() arg at the call site). */
  labelKey: string;
  /** Default Vietnamese label. */
  labelVi: string;
  /** Solid dot / marker background. */
  dot: string;
  /** Left-accent border (issue rows). */
  borderLeft: string;
  /** Outline badge classes (border + text, light/dark). */
  badge: string;
}

export const SEVERITY_META: Record<CanonicalSeverity, SeverityMeta> = {
  critical: {
    labelKey: "severity.critical",
    labelVi: "Nghiêm trọng",
    dot: "bg-red-500",
    borderLeft: "border-l-red-500",
    badge: "border-red-500/40 text-red-600 dark:text-red-400",
  },
  error: {
    labelKey: "severity.error",
    labelVi: "Lỗi",
    dot: "bg-orange-500",
    borderLeft: "border-l-orange-500",
    badge: "border-orange-500/40 text-orange-600 dark:text-orange-400",
  },
  warning: {
    labelKey: "severity.warning",
    labelVi: "Cảnh báo",
    dot: "bg-amber-500",
    borderLeft: "border-l-amber-500",
    badge: "border-amber-500/40 text-amber-600 dark:text-amber-400",
  },
  info: {
    labelKey: "severity.info",
    labelVi: "Thông tin",
    dot: "bg-sky-500",
    borderLeft: "border-l-sky-500",
    badge: "border-sky-500/40 text-sky-600 dark:text-sky-400",
  },
};

/** Metadata for any raw/canonical severity in one call. */
export function severityMeta(raw: unknown): SeverityMeta {
  return SEVERITY_META[toCanonicalSeverity(raw)];
}
