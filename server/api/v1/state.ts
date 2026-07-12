/**
 * doc 44 W2-B1 / G2.16 — GET /v1/state/{path+} (SYNAPSE Tầng 2 §11.1 + §14).
 *
 * Path-addressed current-state read: the wildcard tail of the URL is the
 * ISA-95 path ({site}/{area}/{line}/{cell}/{equipment}). Served from the G2.12
 * state store (L1/L2 → lazy DB backfill, provenance in `source`). 404 when the
 * path maps to NOTHING (no cached snapshot AND no machine with that
 * isa95_path). Scope: data:read.
 *
 * SLO WIRE (§2.2 "Độ trễ đọc trạng thái P95 ≤ 100 ms"): every request records
 * its latency into an in-memory rolling window (1-min buckets, same shape as
 * sloMetricsProvider's HTTP ring) and REGISTERS the observation provider for
 * `state-read-p95` — replacing the honest-null placeholder installed by
 * installSloMetricsProviders. Registration is repeated on every record (a
 * cheap Map.set): register-is-last-writer-wins, so this real feed keeps
 * winning regardless of startup order.
 */
import { type Router, type Request, type Response } from "express";
import { requireScope } from "./auth";
import { API_SCOPES } from "./scopes";
import { sendOk, wrap, ApiHttpError } from "./envelope";

// ─── state-read-p95 rolling window (real measurement, never fabricated) ──────

const SLO_ID = "state-read-p95";
const BUCKET_MS = 60_000;
const RING_CAP = 62; // ~1 h + margin (matches sloMetricsProvider)

interface Bucket {
  startMs: number;
  total: number;
  good: number; // latency ≤ threshold
}

const ring: (Bucket | null)[] = new Array(RING_CAP).fill(null);
let thresholdMs = 100; // spec §2.2; refreshed from the SLO catalogue at register time
let providerRegistered = false;

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

/** Observation provider: null until real traffic exists (honest, no data ≠ 100%). */
export function stateReadSloObservation():
  | { short: { good: number; total: number }; long: { good: number; total: number } }
  | null {
  const now = Date.now();
  const long = sumWindow(longWindowMs(), now);
  if (long.total === 0) return null;
  const short = sumWindow(shortWindowMs(), now);
  return { short, long };
}

function registerProvider(): void {
  // Cheap + idempotent (Map.set, last-writer-wins). Re-called on every record
  // so a later installSloMetricsProviders() null-placeholder never sticks.
  void (async () => {
    try {
      const { registerSloObservationProvider } = await import("../../services/observability/sloAlerting");
      registerSloObservationProvider(SLO_ID, stateReadSloObservation);
      if (!providerRegistered) {
        providerRegistered = true;
        try {
          const { DEFAULT_SLOS } = await import("../../services/observability/slo");
          const t = DEFAULT_SLOS.find((s) => s.id === SLO_ID)?.latencyThresholdMs;
          if (typeof t === "number" && t > 0) thresholdMs = t;
        } catch {
          /* keep the spec default 100 ms */
        }
        console.log(`[api/v1 state] ${SLO_ID} SLO provider registered (threshold ${thresholdMs}ms — real measurement).`);
      }
    } catch {
      /* observability module unavailable — measuring still works locally */
    }
  })();
}

/** Record one state-read latency sample (exported for tests). */
export function recordStateReadLatency(durationMs: number): void {
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
    registerProvider();
  } catch {
    /* metrics must never break a request */
  }
}

/** Test seam: clear the latency ring. */
export function _resetStateReadSloForTests(): void {
  ring.fill(null);
  providerRegistered = false;
}

// ─── Route ────────────────────────────────────────────────────────────────────

/** Register GET /state/* on the /api/v1 router. */
export function registerStateRoutes(r: Router): void {
  registerProvider();

  r.get(
    "/state/*",
    requireScope(API_SCOPES.DATA_READ),
    wrap(async (req: Request, res: Response) => {
      const t0 = Date.now();
      // Express 4 wildcard: everything after /state/ (slashes included).
      const raw = String((req.params as Record<string, string>)[0] ?? "");
      const { getState, normalizePath } = await import("../../services/stateStore/stateStore");
      const path = normalizePath(raw);
      if (!path) {
        recordStateReadLatency(Date.now() - t0);
        throw new ApiHttpError(400, "bad_request", "State path is required: /v1/state/{site}/{area}/{line}/{cell}/{equipment}.");
      }

      const snap = await getState(path);
      recordStateReadLatency(Date.now() - t0);
      if (!snap) {
        throw new ApiHttpError(
          404,
          "not_found",
          `No asset maps to path "${path}" (no cached snapshot and no machine with that isa95_path).`,
        );
      }
      sendOk(res, snap);
    }),
  );
}
