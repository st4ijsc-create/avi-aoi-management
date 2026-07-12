/**
 * Policy-evaluation latency feed — doc 44 Batch W3-A1 (gap G3.16).
 * SYNAPSE Tầng 3 §11.2 "Đánh giá nhanh: PE phải rất nhanh (SLO ≤20ms)" + §2.2.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Every evaluatePolicy() call records its measured latency (hrtime, sub-ms)
 * into a 1-minute-bucketed rolling ring — the SAME shape as the state-read-p95
 * feed (server/api/v1/state.ts, W2-B1) and sloMetricsProvider's HTTP ring —
 * and REGISTERS the observation provider for the `policy-eval-p95` SLO,
 * replacing the honest-null placeholder installed by installSloMetricsProviders.
 * Registration is repeated on every record (a cheap Map.set, last-writer-wins),
 * so this real feed keeps winning regardless of startup order.
 *
 * A small in-window sample buffer additionally yields an actual p95 number
 * (currentP95Ms) for the dry-run API / diagnostics — the SLO burn-rate math
 * itself consumes the (good,total) observation windows, never this estimate.
 *
 * HONEST: no evaluations in the long window → observation null ("no data",
 * never fabricated). Recording never throws into the command path.
 * ════════════════════════════════════════════════════════════════════════════
 */

const SLO_ID = "policy-eval-p95";
const BUCKET_MS = 60_000;
const RING_CAP = 62; // ~1 h + margin (matches sloMetricsProvider / state.ts)
const SAMPLE_CAP = 2048; // p95 estimate buffer (1-minute window, bounded)

interface Bucket {
  startMs: number;
  total: number;
  good: number; // latency ≤ threshold
}

const ring: (Bucket | null)[] = new Array(RING_CAP).fill(null);
let thresholdMs = 20; // spec §11.2 (SLO ≤ 20ms); refreshed from the catalogue at register time
let providerRegistered = false;

/** Rolling raw samples of the CURRENT 1-minute window (for currentP95Ms only). */
let sampleWindowStart = 0;
let samples: number[] = [];

function shortWindowMs(): number {
  const n = parseInt(process.env.OBS_SLO_SHORT_WINDOW_MS || String(5 * 60_000), 10);
  return Number.isFinite(n) && n >= BUCKET_MS ? n : 5 * 60_000;
}
function longWindowMs(): number {
  const n = parseInt(process.env.OBS_SLO_LONG_WINDOW_MS || String(60 * 60_000), 10);
  return Number.isFinite(n) && n >= BUCKET_MS ? n : 60 * 60_000;
}

function sumWindow(windowMs: number, now: number): { total: number; good: number } {
  const cutoff = now - windowMs;
  const out = { total: 0, good: 0 };
  for (const b of ring) {
    if (!b) continue;
    if (b.startMs <= cutoff || b.startMs > now) continue;
    out.total += b.total;
    out.good += b.good;
  }
  return out;
}

/**
 * Observation provider for `policy-eval-p95`: (good = evals ≤ threshold, total)
 * over the short/long rolling windows. null until real evaluations exist.
 */
export function policyEvalSloObservation():
  | { short: { good: number; total: number }; long: { good: number; total: number } }
  | null {
  const now = Date.now();
  const long = sumWindow(longWindowMs(), now);
  if (long.total === 0) return null; // honest: no evaluations → no data
  const short = sumWindow(shortWindowMs(), now);
  return { short, long };
}

function registerProvider(): void {
  // Cheap + idempotent (Map.set, last-writer-wins). Re-called on every record so
  // a later installSloMetricsProviders() registration never sticks over this one.
  void (async () => {
    try {
      const { registerSloObservationProvider } = await import("../observability/sloAlerting");
      registerSloObservationProvider(SLO_ID, policyEvalSloObservation);
      if (!providerRegistered) {
        providerRegistered = true;
        try {
          const { DEFAULT_SLOS } = await import("../observability/slo");
          const t = DEFAULT_SLOS.find((s) => s.id === SLO_ID)?.latencyThresholdMs;
          if (typeof t === "number" && t > 0) thresholdMs = t;
        } catch {
          /* keep the spec default 20 ms */
        }
        console.log(`[policy] ${SLO_ID} SLO provider registered (threshold ${thresholdMs}ms — real measurement).`);
      }
    } catch {
      /* observability module unavailable — measuring still works locally */
    }
  })();
}

/** Record one policy-evaluation latency sample. Never throws. */
export function recordPolicyEvalLatency(durationMs: number): void {
  try {
    const now = Date.now();
    const startMs = now - (now % BUCKET_MS);
    const idx = Math.floor(startMs / BUCKET_MS) % RING_CAP;
    let b = ring[idx];
    if (!b || b.startMs !== startMs) {
      b = { startMs, total: 0, good: 0 };
      ring[idx] = b;
    }
    b.total += 1;
    if (durationMs <= thresholdMs) b.good += 1;

    // p95 sample buffer — reset when the 1-minute window rolls; bounded.
    if (sampleWindowStart !== startMs) {
      sampleWindowStart = startMs;
      samples = [];
    }
    if (samples.length < SAMPLE_CAP) samples.push(durationMs);

    registerProvider();
  } catch {
    /* metrics must never break an evaluation */
  }
}

/** Approximate p95 (ms) of the current 1-minute window; null when no samples. */
export function currentP95Ms(): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return Math.round(sorted[Math.max(0, idx)] * 1000) / 1000;
}

/** The active "good" threshold (ms) — the SLO objective boundary. */
export function policyEvalThresholdMs(): number {
  return thresholdMs;
}

/** Test seam: clear the latency ring + sample buffer. */
export function _resetPolicyEvalSloForTests(): void {
  ring.fill(null);
  samples = [];
  sampleWindowStart = 0;
  providerRegistered = false;
}
