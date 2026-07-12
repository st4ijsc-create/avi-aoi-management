/**
 * SLO catalogue + error-budget + burn-rate — SYNAPSE §5.12.2 (doc 33 §3.4 / F6 · H2).
 *
 * Pure, testable SLO math: given an objective (target success ratio) and observed (good, total)
 * counts over a window, compute error-budget consumption and a multi-window BURN RATE (the SRE
 * signal that beats static thresholds — SDD §5.12.2). Non-breaking: a library the observability
 * router + alerting can consume; it reads metric samples, it does not wire into the hot path.
 */

export type SloKind = "availability" | "latency";

export interface SloTarget {
  id: string;
  name: string;
  kind: SloKind;
  /** Target success ratio in [0,1], e.g. 0.999 for 99.9% availability, or fraction of requests
   *  under the latency threshold. */
  objective: number;
  /** For latency SLOs: the threshold in ms that defines a "good" event (informational). */
  latencyThresholdMs?: number;
  /** Rolling window in seconds the objective is measured over (e.g. 30 days). */
  windowSec: number;
  /** Runbook link for alerts. */
  runbook?: string;
}

/** Observed counts over a window. `good` = events meeting the objective (e.g. fast/successful). */
export interface SloObservation {
  good: number;
  total: number;
}

export interface SloStatus {
  id: string;
  objective: number;
  /** Observed success ratio in [0,1] (1 when no events). */
  sli: number;
  /** Fraction of the allowed error budget consumed in [0,∞) (0 = none, 1 = exhausted). */
  budgetConsumed: number;
  /** Remaining budget fraction, clamped to [0,1]. */
  budgetRemaining: number;
  healthy: boolean;
}

/** Compute SLI + error-budget consumption for one observation. */
export function sloStatus(target: SloTarget, obs: SloObservation): SloStatus {
  const total = Math.max(0, obs.total);
  const good = Math.min(Math.max(0, obs.good), total);
  const sli = total === 0 ? 1 : good / total;
  const errorBudget = 1 - target.objective; // allowed failure fraction
  const observedError = 1 - sli;
  const budgetConsumed = errorBudget <= 0 ? (observedError > 0 ? Infinity : 0) : observedError / errorBudget;
  return {
    id: target.id,
    objective: target.objective,
    sli,
    budgetConsumed,
    budgetRemaining: Math.max(0, Math.min(1, 1 - budgetConsumed)),
    healthy: budgetConsumed <= 1,
  };
}

export type BurnSeverity = "ok" | "warning" | "critical";

/**
 * Multi-window burn-rate alert (Google SRE): burn rate = observed error / error budget, per
 * window. A short window catching a fast burn AND a longer window confirming it → page.
 * Returns the severity + the two burn rates.
 */
export function burnRate(
  target: SloTarget,
  shortWindow: SloObservation,
  longWindow: SloObservation,
  opts: { critical?: number; warning?: number } = {},
): { severity: BurnSeverity; shortBurn: number; longBurn: number } {
  const errorBudget = 1 - target.objective;
  const rate = (o: SloObservation) => {
    const total = Math.max(0, o.total);
    if (total === 0 || errorBudget <= 0) return 0;
    const err = 1 - Math.min(Math.max(0, o.good), total) / total;
    return err / errorBudget;
  };
  const shortBurn = rate(shortWindow);
  const longBurn = rate(longWindow);
  const critical = opts.critical ?? 14.4; // ~2% budget in 1h (SRE workbook)
  const warning = opts.warning ?? 6; // ~5% budget in 6h
  let severity: BurnSeverity = "ok";
  if (shortBurn >= critical && longBurn >= critical) severity = "critical";
  else if (shortBurn >= warning && longBurn >= warning) severity = "warning";
  return { severity, shortBurn, longBurn };
}

/** First-party SLO catalogue (SDD §5.12.2 targets, adapted to this stack). */
export const DEFAULT_SLOS: readonly SloTarget[] = [
  {
    id: "dispatch-latency-p95",
    name: "Độ trễ quyết định điều phối P95 ≤ 500ms",
    kind: "latency",
    objective: 0.95,
    latencyThresholdMs: 500,
    windowSec: 30 * 24 * 3600,
    runbook: "docs/ECOSYSTEM/23_AUTOMATION_FLAG_FLIP_AND_SMOKE_TEST_RUNBOOK_2026-07.md",
  },
  {
    id: "uns-delivery-p99",
    name: "Giao nhận UNS nội site P99 ≤ 250ms",
    kind: "latency",
    objective: 0.99,
    latencyThresholdMs: 250,
    windowSec: 30 * 24 * 3600,
  },
  {
    id: "twin-sync-latency",
    name: "Trễ đồng bộ twin ≤ 1s",
    kind: "latency",
    objective: 0.95,
    latencyThresholdMs: 1000,
    windowSec: 7 * 24 * 3600,
  },
  {
    id: "control-api-availability",
    name: "API điều phối khả dụng ≥ 99.9%",
    kind: "availability",
    objective: 0.999,
    windowSec: 30 * 24 * 3600,
  },
  // ── W0-F (doc 44) — 3 SLO mới theo spec tầng L2/L3/L5. HONEST: các SLO này
  // KHÔNG dùng proxy HTTP chung (sloMetricsProvider loại chúng khỏi feed HTTP):
  //   • screen-load-p95: feed thật = histogram RUM `rum_web_vitals_lcp_ms`
  //     (client-ingest, batch song song); chưa có metric → "no data", không bịa.
  //   • policy-eval-p95 / state-read-p95: CHƯA instrument (W2/W3) → provider
  //     trả null cho tới khi subsystem tự đăng ký feed thật.
  {
    id: "screen-load-p95",
    name: "Tải màn hình (LCP) P95 ≤ 2s (L5)",
    kind: "latency",
    objective: 0.95,
    latencyThresholdMs: 2000,
    windowSec: 30 * 24 * 3600,
  },
  {
    id: "policy-eval-p95",
    name: "Đánh giá policy P95 ≤ 20ms (L3)",
    kind: "latency",
    objective: 0.95,
    latencyThresholdMs: 20,
    windowSec: 30 * 24 * 3600,
  },
  {
    id: "state-read-p95",
    name: "Đọc trạng thái P95 ≤ 100ms (L2)",
    kind: "latency",
    objective: 0.95,
    latencyThresholdMs: 100,
    windowSec: 30 * 24 * 3600,
  },
];
