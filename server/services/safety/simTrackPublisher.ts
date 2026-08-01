/**
 * P2 (doc 22, Khối 3) — SIMULATED safety-track publisher.
 *   Flag: SAFETY_SIM_TRACKS_ENABLED (default OFF).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * The S1/S2a safety closed-loop has no live upstream: `ingestProximity` /
 * `ingestDetectionFrame` only fire ON-DEMAND from tRPC, so the 3-tier zone
 * evaluator + the `safety:event` socket + the Safety Cockpit are never exercised
 * end-to-end during a demo. This background worker — ONLY when the flag is on —
 * periodically synthesises person↔robot proximity tracks and drives them through
 * the EXISTING advisory ingest path (nearMissAdvisor.processDetection +
 * safetyZoneService.evaluateFromProximity), exactly as the router's ingestProximity
 * does. That makes the whole loop (evaluator → advisory safety_event → socket emit →
 * cockpit) visibly work.
 *
 * ⚠ CRITICAL HONESTY / SAFETY: every track this publishes is SIMULATED — NOT a real
 *   sensor. Detections are marked source 'test' so the downstream advisory events are
 *   recorded with detectedBy 'sim'/'operator' and notes that state the source. This
 *   worker COMMANDS NO DEVICE and ACTUATES NO STOP: it only feeds the ADVISORY monitor
 *   the same way a manual test call would. A 'rated_stop' band, if a synthetic track
 *   crosses it, is LOGGED only (a certified Safety PLC performs any real rated stop in
 *   hardware). It writes NOTHING to any device-control path.
 *
 * NO-OP when SAFETY_SIM_TRACKS_ENABLED is off (start() returns immediately; nothing is
 * scheduled). Advisory events only PERSIST when SAFETY_AUDIT_ENABLED is ALSO on
 * (record()/processDetection self-gate) — otherwise the evaluator still runs (advisory
 * read) but writes nothing.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { processDetection, type ProximityDetection } from "./nearMissAdvisor";
import { evaluateFromProximity } from "./safetyZoneService";

/** Flag — default OFF (mirrors safetyAuditEnabled / safetyZoneSwEnabled). */
export function safetySimTracksEnabled(): boolean {
  return process.env.SAFETY_SIM_TRACKS_ENABLED === "true" || process.env.SAFETY_SIM_TRACKS_ENABLED === "1";
}

/** Tick period (ms) — default 5s; clamped to a sane [1s, 5min] range. */
export function simTracksIntervalMs(): number {
  const n = Number(process.env.SAFETY_SIM_TRACKS_INTERVAL_MS ?? 5000);
  if (!Number.isFinite(n)) return 5000;
  return Math.min(Math.max(n, 1000), 5 * 60 * 1000);
}

/** Which robot the synthetic human approaches (advisory demo target). Default robot 1. */
function simRobotId(): number {
  const n = Number(process.env.SAFETY_SIM_TRACKS_ROBOT_ID ?? 1);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 1;
}

/**
 * PURE — the synthetic human↔robot distance (mm) for tick `t`. A deterministic
 * triangle wave that sweeps 200mm → 2600mm → 200mm so, over a full cycle, it crosses
 * ALL bands (none → speed_reduce → stop → rated_stop) against the default 2000/1000/500
 * thresholds. Exported for unit testing. This is CLEARLY a synthetic pattern, not data.
 */
export function simDistanceMm(tick: number): number {
  const MIN = 200;
  const MAX = 2600;
  const SPAN = MAX - MIN; // 2400
  const period = 8; // ticks per full up+down sweep
  const phase = ((tick % period) + period) % period;
  const half = period / 2;
  // 0..1 triangle: rises for the first half, falls for the second.
  const frac = phase <= half ? phase / half : (period - phase) / half;
  return Math.round(MIN + SPAN * frac);
}

/** Build the SIMULATED proximity detection for a tick — always source 'test'. */
export function buildSimDetection(tick: number): ProximityDetection {
  return {
    robotId: simRobotId(),
    distance: simDistanceMm(tick),
    confidence: 0.9,
    // 'test' provenance → the advisory layer labels it as simulated (never 'vision').
    source: "test",
  };
}

/**
 * Run ONE simulated tick through the EXISTING advisory ingest path (identical to the
 * router's ingestProximity). Returns the near-miss result + zone evaluation for
 * visibility/tests. NO device is commanded. Safe to call directly in a test.
 */
export async function runSimTick(tick: number): Promise<{ near: Awaited<ReturnType<typeof processDetection>>; zone: Awaited<ReturnType<typeof evaluateFromProximity>> }> {
  const det = buildSimDetection(tick);
  const detectedAtMs = Date.now();
  // S1 near-miss advisory (self-gated by SAFETY_AUDIT_ENABLED).
  const near = await processDetection(det);
  // S2a zone evaluator (self-gated by SAFETY_ZONE_SW_ENABLED) — pass the detection
  // time so the advisory safety_events.responseTimeMs is populated.
  const zone = await evaluateFromProximity({ ...det, detectedAtMs });
  return { near, zone };
}

let timer: ReturnType<typeof setInterval> | null = null;
let tick = 0;

/**
 * Start the SIMULATED track publisher. NO-OP unless SAFETY_SIM_TRACKS_ENABLED. Idempotent
 * (a second call while running is ignored). Each interval feeds one synthetic detection
 * through the advisory path; failures are logged and never crash the loop.
 */
export function startSimTrackPublisher(): void {
  if (!safetySimTracksEnabled()) return;
  if (timer) return; // already running
  const intervalMs = simTracksIntervalMs();
  console.log(
    `[SafetySim] SIMULATED track publisher started (every ${intervalMs}ms, robot ${simRobotId()}). ` +
      "ADVISORY only — SIMULATED tracks, NOT a real sensor; commands no device, actuates no stop.",
  );
  timer = setInterval(() => {
    const t = tick++;
    void runSimTick(t).catch((e) => console.error("[SafetySim] tick failed:", (e as Error)?.message ?? e));
  }, intervalMs);
  // Do not keep the event loop alive solely for the sim (mirrors other background timers).
  if (typeof timer.unref === "function") timer.unref();
}

/** Stop the publisher (no-op if not running). */
export function stopSimTrackPublisher(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    console.log("[SafetySim] SIMULATED track publisher stopped.");
  }
}
