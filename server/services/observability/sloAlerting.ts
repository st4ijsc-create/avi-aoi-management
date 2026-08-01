/**
 * SLO burn-rate → ALERT bridge + live evaluator — SYNAPSE §5.12.2 (doc 37 C1 completion).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * GAP this closes (doc 37 năng lực 15): slo.ts computes a multi-window burn rate but NOTHING acts
 * on a breach — it is pure math consumed only by a preview endpoint. This module is the impure
 * layer that makes burn-rate OPERATIONAL:
 *
 *   1) A burn-rate → ALERT bridge (`recordSloEvaluation`): on a warning/critical breach it fires an
 *      alert through the EXISTING unified path (routeAlert → predictive_alerts + notify/email),
 *      de-duped by a per-SLO cooldown. Best-effort, lazy-imported, never throws into the caller.
 *   2) A LATEST-STATUS store so the observability health route can report current SLI / error-budget
 *      / burn-rate / severity per SLO without recomputing.
 *   3) A LIVE evaluator (`startSloEvaluator`): a bounded, unref'd interval that pulls observations
 *      from registered PROVIDERS, evaluates each SLO, updates the store, and fires alerts. HONEST:
 *      with NO provider registered the loop is a pure no-op — it fabricates no data. Real feeds
 *      (dispatch-latency histogram, UNS delivery, twin sync) register a provider to light it up.
 *   4) A Prometheus exposition renderer so /metrics-style scrapers can alert on burn in Prometheus
 *      too (the "OR prom-client gauge" path).
 *
 * FLAG: gated by OBSERVABILITY (the F6 umbrella). Off → evaluator no-op, alerts suppressed. The
 * pure slo.ts stays untouched.
 * ════════════════════════════════════════════════════════════════════════════
 */
import {
  DEFAULT_SLOS,
  sloStatus,
  burnRate,
  type SloTarget,
  type SloObservation,
  type SloStatus,
  type BurnSeverity,
} from "./slo";
import { decisionRingInfo } from "./decisionTrace";

// ── flag ─────────────────────────────────────────────────────────────────────

export function observabilityEnabled(): boolean {
  return process.env.OBSERVABILITY === "true" || process.env.OBSERVABILITY === "1";
}

// ── config (env-driven; honest defaults) ─────────────────────────────────────

function evalIntervalMs(): number {
  const n = parseInt(process.env.OBS_SLO_EVAL_INTERVAL_MS || "60000", 10);
  return Number.isFinite(n) && n >= 1000 ? n : 60000;
}

function alertCooldownMs(): number {
  const n = parseInt(process.env.OBS_SLO_ALERT_COOLDOWN_MS || String(15 * 60 * 1000), 10);
  return Number.isFinite(n) && n > 0 ? n : 15 * 60 * 1000;
}

// ── observation providers (real feeds register here) ─────────────────────────

/** Yields the short + long window (good,total) counts for one SLO, or null when it has no data. */
export type SloObservationProvider = () => { short: SloObservation; long: SloObservation } | null;

const providers = new Map<string, SloObservationProvider>();

/** Register (or replace) the observation feed for an SLO id. Real signal sources call this. */
export function registerSloObservationProvider(sloId: string, fn: SloObservationProvider): void {
  providers.set(sloId, fn);
}

/** Remove a provider (tests / teardown). */
export function unregisterSloObservationProvider(sloId: string): void {
  providers.delete(sloId);
}

// ── latest-status store (for the health route + prometheus) ──────────────────

export interface SloEvaluation {
  sloId: string;
  name: string;
  /** null until the SLO has been evaluated with real observations. */
  status: SloStatus | null;
  severity: BurnSeverity;
  shortBurn: number;
  longBurn: number;
  /** epoch ms of the last evaluation, or null. */
  evaluatedAt: number | null;
  /** epoch ms of the last alert fired for this SLO, or null. */
  lastAlertAt: number | null;
  runbook?: string;
}

const latest = new Map<string, SloEvaluation>();
const lastAlertAt = new Map<string, number>();

function seed(target: SloTarget): SloEvaluation {
  return {
    sloId: target.id,
    name: target.name,
    status: null,
    severity: "ok",
    shortBurn: 0,
    longBurn: 0,
    evaluatedAt: null,
    lastAlertAt: null,
    runbook: target.runbook,
  };
}

// ── core: evaluate one SLO + alert on breach ─────────────────────────────────

/**
 * Evaluate one SLO against observed windows: compute status (long window) + multi-window burn rate,
 * update the latest-status store, and — on a warning/critical breach — fire an alert (cooldown-de-
 * duped). Returns the evaluation. Safe to call directly (tests, ad-hoc callers) or from the loop.
 */
export function recordSloEvaluation(
  target: SloTarget,
  short: SloObservation,
  long: SloObservation,
): SloEvaluation {
  const status = sloStatus(target, long);
  const burn = burnRate(target, short, long);
  const now = Date.now();
  const evalRec: SloEvaluation = {
    sloId: target.id,
    name: target.name,
    status,
    severity: burn.severity,
    shortBurn: burn.shortBurn,
    longBurn: burn.longBurn,
    evaluatedAt: now,
    lastAlertAt: lastAlertAt.get(target.id) ?? null,
    runbook: target.runbook,
  };
  latest.set(target.id, evalRec);

  if (burn.severity !== "ok" && observabilityEnabled()) {
    maybeAlertOnBurn(target, burn.severity, burn.shortBurn, burn.longBurn, status, now);
  }
  return evalRec;
}

/** Fire an alert through the unified router if past cooldown. Best-effort; never throws. */
function maybeAlertOnBurn(
  target: SloTarget,
  severity: BurnSeverity,
  shortBurn: number,
  longBurn: number,
  status: SloStatus,
  now: number,
): void {
  const prev = lastAlertAt.get(target.id);
  if (prev != null && now - prev < alertCooldownMs()) return; // de-dupe within cooldown
  lastAlertAt.set(target.id, now);
  const rec = latest.get(target.id);
  if (rec) rec.lastAlertAt = now;

  // Lazy import to avoid an import cycle with the alert router; best-effort fan-out.
  void import("../aiSmartAlertRouter")
    .then(({ routeAlert }) =>
      routeAlert({
        // The alert-router union has no SLO-native type; PATTERN_ANOMALY is the closest umbrella and
        // the payload carries the precise SLO context. (A first-class SLO_BURN type is a follow-up
        // edit to aiSmartAlertRouter's AlertType — see doc 37 TODO.)
        type: "PATTERN_ANOMALY",
        severity: severity === "critical" ? "CRITICAL" : "HIGH",
        message:
          `SLO "${target.name}" (${target.id}) burn-rate ${severity.toUpperCase()}: ` +
          `short=${shortBurn.toFixed(1)}× long=${longBurn.toFixed(1)}× budget; ` +
          `budget consumed ${(status.budgetConsumed * 100).toFixed(1)}%.`,
        data: {
          source: "slo_burn_rate",
          sloId: target.id,
          sloName: target.name,
          severity,
          shortBurn,
          longBurn,
          sli: status.sli,
          budgetConsumed: status.budgetConsumed,
          budgetRemaining: status.budgetRemaining,
          runbook: target.runbook ?? null,
        },
      }),
    )
    .catch((err) => {
      console.warn("[SLO] burn-rate alert routeAlert failed:", (err as Error)?.message || err);
    });
}

// ── live evaluator loop ──────────────────────────────────────────────────────

let timer: ReturnType<typeof setInterval> | null = null;

/** Run one pass over all SLOs that have a registered provider. Non-throwing. */
export function evaluateAllOnce(): void {
  for (const target of DEFAULT_SLOS) {
    if (!latest.has(target.id)) latest.set(target.id, seed(target));
    const provider = providers.get(target.id);
    if (!provider) continue; // no feed → leave as "no data" (honest, never fabricated)
    let obs: { short: SloObservation; long: SloObservation } | null = null;
    try {
      obs = provider();
    } catch {
      obs = null;
    }
    if (!obs) continue;
    try {
      recordSloEvaluation(target, obs.short, obs.long);
    } catch {
      /* one bad SLO must not stop the sweep */
    }
  }
}

/**
 * Start the burn-rate evaluator (idempotent). No-op — with a one-line log — when OBSERVABILITY is
 * off. The interval is unref'd so it never keeps the process alive.
 */
export function startSloEvaluator(): void {
  // Seed the catalogue so the health route lists every SLO even before the first tick.
  for (const target of DEFAULT_SLOS) if (!latest.has(target.id)) latest.set(target.id, seed(target));

  if (!observabilityEnabled()) {
    console.log("[SLO] OBSERVABILITY off — burn-rate evaluator not scheduled.");
    return;
  }
  if (timer) return;
  const t = setInterval(() => {
    try {
      evaluateAllOnce();
    } catch {
      /* never throw from a timer */
    }
  }, evalIntervalMs());
  if (typeof (t as { unref?: () => void }).unref === "function") (t as { unref: () => void }).unref();
  timer = t;
  console.log(
    `[SLO] burn-rate evaluator started (every ${evalIntervalMs()}ms; ${providers.size} provider(s) registered).`,
  );
}

/** Stop the evaluator (tests / teardown). */
export function stopSloEvaluator(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

// ── read models (health route + prometheus) ──────────────────────────────────

/** Snapshot of every SLO's latest evaluation (catalogue order). */
export function getSloSnapshot(): SloEvaluation[] {
  return DEFAULT_SLOS.map((t) => latest.get(t.id) ?? seed(t));
}

/** Compact health summary: worst current severity + how many SLOs are breaching / healthy. */
export function getSloHealth(): {
  worstSeverity: BurnSeverity;
  breaching: number;
  evaluated: number;
  total: number;
} {
  const snap = getSloSnapshot();
  let worst: BurnSeverity = "ok";
  let breaching = 0;
  let evaluated = 0;
  for (const s of snap) {
    if (s.evaluatedAt != null) evaluated += 1;
    if (s.severity === "critical") {
      worst = "critical";
      breaching += 1;
    } else if (s.severity === "warning") {
      if (worst !== "critical") worst = "warning";
      breaching += 1;
    }
  }
  return { worstSeverity: worst, breaching, evaluated, total: snap.length };
}

const SEVERITY_CODE: Record<BurnSeverity, number> = { ok: 0, warning: 1, critical: 2 };

/**
 * Render SLO burn-rate + decision-trace signals in Prometheus text-exposition format. Dependency-
 * free (no prom-client) so it can be served from any route. Only SLOs with a real evaluation emit
 * burn/budget samples; the decision-ring gauges always emit.
 */
export function renderSloPrometheus(): string {
  const lines: string[] = [];
  lines.push("# HELP synapse_slo_burn_rate Multi-window SLO burn rate (error/error-budget).");
  lines.push("# TYPE synapse_slo_burn_rate gauge");
  lines.push("# HELP synapse_slo_budget_consumed Fraction of the SLO error budget consumed.");
  lines.push("# TYPE synapse_slo_budget_consumed gauge");
  lines.push("# HELP synapse_slo_burn_severity Burn severity (0=ok,1=warning,2=critical).");
  lines.push("# TYPE synapse_slo_burn_severity gauge");
  for (const s of getSloSnapshot()) {
    if (s.evaluatedAt == null || !s.status) continue;
    const id = JSON.stringify(s.sloId);
    lines.push(`synapse_slo_burn_rate{slo=${id},window="short"} ${finite(s.shortBurn)}`);
    lines.push(`synapse_slo_burn_rate{slo=${id},window="long"} ${finite(s.longBurn)}`);
    lines.push(`synapse_slo_budget_consumed{slo=${id}} ${finite(s.status.budgetConsumed)}`);
    lines.push(`synapse_slo_burn_severity{slo=${id}} ${SEVERITY_CODE[s.severity]}`);
  }
  const ring = decisionRingInfo();
  lines.push("# HELP synapse_decision_trace_ring_depth Decision traces held in the in-memory ring.");
  lines.push("# TYPE synapse_decision_trace_ring_depth gauge");
  lines.push(`synapse_decision_trace_ring_depth ${ring.depth}`);
  lines.push("# HELP synapse_decision_trace_recorded_total Decision traces recorded since start.");
  lines.push("# TYPE synapse_decision_trace_recorded_total counter");
  lines.push(`synapse_decision_trace_recorded_total ${ring.totalRecorded}`);
  return lines.join("\n") + "\n";
}

function finite(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

// ── test helper ──────────────────────────────────────────────────────────────

/** Reset all in-memory evaluator state (tests). */
export function _resetSloAlerting(): void {
  stopSloEvaluator();
  providers.clear();
  latest.clear();
  lastAlertAt.clear();
}
