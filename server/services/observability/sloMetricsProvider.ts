/**
 * SLO observation provider — HTTP feed bridge (doc 38 Đợt P · P0-A "0 provider" fix).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * GAP this closes: `startSloEvaluator()` runs but `registerSloObservationProvider()` is never
 * called anywhere → the evaluator sweeps SLOs with NO feed, so burn-rate stays "no data" and an
 * alert can never fire. This module is the missing feed: a lightweight rolling-window tracker of
 * real HTTP request latency + error-rate that yields the (good,total) short/long windows the
 * multi-window burn-rate math consumes, and registers one provider per catalogue SLO.
 *
 * ─── Why a rolling window and NOT prom-client histogram buckets ──────────────
 * The prom-client histogram (avi_aoi_http_request_duration_seconds) is CUMULATIVE since process
 * start — monotonic counters, no notion of "last 5 min" vs "last 1 h". Multi-window burn rate needs
 * two DISJOINT rolling windows, which a cumulative histogram cannot give without snapshotting +
 * diffing anyway. So we keep an independent, allocation-light time-bucketed ring (fed from the same
 * metricsMiddleware hook) that gives true rolling windows at ~O(1) per request and O(#buckets) per
 * evaluation. It is also prom-client-free, so the SLO feed still works when METRICS_ENABLED is off
 * (as long as OBSERVABILITY is on) — honest-degrade.
 *
 * ─── SLI mapping (real signal, honest scope) ─────────────────────────────────
 *   • Latency SLOs (kind:"latency", latencyThresholdMs T): SLI = fraction of HTTP requests with
 *     duration ≤ T. good = count(duration ≤ T), total = count. This IS the p95/p99-style objective
 *     ("≥ objective of requests under T ms"). NOTE: the scope here is ALL HTTP traffic — a first-pass
 *     PROXY for the subsystem-specific SLOs (dispatch / UNS / twin). A subsystem that later
 *     instruments its own latency simply calls registerSloObservationProvider(<same id>, …) and
 *     REPLACES this HTTP proxy (register = last-writer-wins by id). See §limitations in the plan.
 *   • Availability SLO (kind:"availability"): good = non-5xx responses, total = all. This is an
 *     EXACT match for "control API availability" — real HTTP error-budget from status ≥ 500.
 *
 * FLAG: activated only when OBSERVABILITY is on (installSloMetricsProviders is a no-op otherwise).
 * With the tracker inactive, sloHttpTrackingActive() is false and the middleware never records.
 * ════════════════════════════════════════════════════════════════════════════
 */
import {
  DEFAULT_SLOS,
  type SloObservation,
} from "./slo";
import { registerSloObservationProvider, observabilityEnabled } from "./sloAlerting";

// ── config (env-driven; honest defaults) ─────────────────────────────────────

const BUCKET_MS = 60_000; // 1-minute time buckets

function shortWindowMs(): number {
  const n = parseInt(process.env.OBS_SLO_SHORT_WINDOW_MS || String(5 * 60_000), 10);
  return Number.isFinite(n) && n >= BUCKET_MS ? n : 5 * 60_000;
}

function longWindowMs(): number {
  const n = parseInt(process.env.OBS_SLO_LONG_WINDOW_MS || String(60 * 60_000), 10);
  return Number.isFinite(n) && n >= BUCKET_MS ? n : 60 * 60_000;
}

// ── latency thresholds that matter (from the catalogue) ──────────────────────

/** Distinct latency thresholds (ms), ascending — one "good count" column per threshold. */
const THRESHOLDS: number[] = Array.from(
  new Set(
    DEFAULT_SLOS.filter(
      (s) => s.kind === "latency" && typeof s.latencyThresholdMs === "number",
    ).map((s) => s.latencyThresholdMs as number),
  ),
).sort((a, b) => a - b);

function thresholdIndex(t: number): number {
  return THRESHOLDS.indexOf(t);
}

// ── rolling-window ring ───────────────────────────────────────────────────────

interface Bucket {
  /** Bucket-aligned start (ms). A slot whose startMs ≠ the current alignment is stale. */
  startMs: number;
  total: number;
  errors: number; // status >= 500
  /** Count of requests with duration ≤ THRESHOLDS[i], parallel to THRESHOLDS. */
  under: number[];
}

// Ring big enough to cover the long window + margin, sized off the default long window so a smaller
// env override never under-provisions. Reset-on-stale reclaims wrapped slots with zero pruning cost.
const RING_CAP = Math.ceil((60 * 60_000) / BUCKET_MS) + 2; // ~62 slots (1 h + 2 min)
const ring: (Bucket | null)[] = new Array(RING_CAP).fill(null);

let active = false;

function freshBucket(startMs: number): Bucket {
  return { startMs, total: 0, errors: 0, under: new Array(THRESHOLDS.length).fill(0) };
}

/** Cheap boolean the request hot-path checks before doing any work. */
export function sloHttpTrackingActive(): boolean {
  return active;
}

/**
 * Record one finished HTTP request into the rolling window. Called from metricsMiddleware's
 * `finish` handler. No-op (and effectively free) when tracking is inactive. Never throws.
 */
export function recordHttpForSlo(durationMs: number, statusCode: number): void {
  if (!active) return;
  try {
    const now = Date.now();
    const startMs = now - (now % BUCKET_MS);
    const idx = Math.floor(startMs / BUCKET_MS) % RING_CAP;
    let b = ring[idx];
    if (!b || b.startMs !== startMs) {
      b = freshBucket(startMs);
      ring[idx] = b;
    }
    b.total += 1;
    if (statusCode >= 500) b.errors += 1;
    for (let i = 0; i < THRESHOLDS.length; i++) {
      if (durationMs <= THRESHOLDS[i]) b.under[i] += 1;
    }
  } catch {
    /* metrics must never break a request */
  }
}

interface WindowSum {
  total: number;
  errors: number;
  under: number[];
}

/** Sum every live bucket whose start falls within `windowMs` of now. */
function sumWindow(windowMs: number, now: number): WindowSum {
  const cutoff = now - windowMs;
  const out: WindowSum = { total: 0, errors: 0, under: new Array(THRESHOLDS.length).fill(0) };
  for (const b of ring) {
    if (!b) continue;
    if (b.startMs <= cutoff || b.startMs > now) continue; // stale/outside-window slots excluded
    out.total += b.total;
    out.errors += b.errors;
    for (let i = 0; i < THRESHOLDS.length; i++) out.under[i] += b.under[i];
  }
  return out;
}

// ── per-SLO observation providers ─────────────────────────────────────────────

/** Latency SLO feed: good = requests under threshold T; total = all. null when no data yet. */
function latencyObservation(thresholdMs: number): { short: SloObservation; long: SloObservation } | null {
  const i = thresholdIndex(thresholdMs);
  if (i < 0) return null;
  const now = Date.now();
  const long = sumWindow(longWindowMs(), now);
  if (long.total === 0) return null; // honest: no traffic → no data (never fabricate)
  const short = sumWindow(shortWindowMs(), now);
  return {
    short: { good: short.under[i], total: short.total },
    long: { good: long.under[i], total: long.total },
  };
}

/** Availability SLO feed: good = non-5xx; total = all. null when no data yet. */
function availabilityObservation(): { short: SloObservation; long: SloObservation } | null {
  const now = Date.now();
  const long = sumWindow(longWindowMs(), now);
  if (long.total === 0) return null;
  const short = sumWindow(shortWindowMs(), now);
  return {
    short: { good: short.total - short.errors, total: short.total },
    long: { good: long.total - long.errors, total: long.total },
  };
}

// ── install (called once at observability startup) ───────────────────────────

/**
 * Register an HTTP-derived observation provider for every catalogue SLO and arm the request-path
 * tracker. Idempotent. NO-OP when OBSERVABILITY is off (evaluator itself is off too, so there is
 * nothing to feed). Never throws into startup.
 */
export function installSloMetricsProviders(): void {
  if (!observabilityEnabled()) {
    console.log("[SLO] OBSERVABILITY off — HTTP metrics provider not installed.");
    return;
  }

  for (const target of DEFAULT_SLOS) {
    if (target.kind === "latency" && typeof target.latencyThresholdMs === "number") {
      const t = target.latencyThresholdMs;
      registerSloObservationProvider(target.id, () => latencyObservation(t));
    } else if (target.kind === "availability") {
      registerSloObservationProvider(target.id, () => availabilityObservation());
    }
  }
  active = true;
  console.log(
    `[SLO] HTTP metrics provider installed for ${DEFAULT_SLOS.length} SLO(s) ` +
      `(short=${shortWindowMs()}ms, long=${longWindowMs()}ms, thresholds=[${THRESHOLDS.join(",")}]ms).`,
  );
}

// ── test / teardown helper ────────────────────────────────────────────────────

/** Reset the tracker (tests). */
export function _resetSloMetricsProvider(): void {
  active = false;
  ring.fill(null);
}
