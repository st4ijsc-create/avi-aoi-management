/**
 * WS-2 — Edge stale-deployment scheduler.
 *
 * Periodically marks ACTIVE deployments whose last heartbeat is older than the
 * threshold as OUTDATED (device presumed offline). Mirrors the existing
 * interval-based schedulers (alertEvaluation / escalation).
 *
 * Opt-out via EDGE_STALE_CHECK_ENABLED=false. Tunables:
 *   EDGE_STALE_INTERVAL_MS   (default 60000)
 *   EDGE_STALE_THRESHOLD_MIN (default 15)
 */
import { markStaleDeployments } from "./aiEdgeEnhanced";

let timer: NodeJS.Timeout | null = null;

export function startEdgeStaleScheduler(): void {
  if (process.env.EDGE_STALE_CHECK_ENABLED === "false") {
    console.log("[EdgeStale] scheduler disabled (EDGE_STALE_CHECK_ENABLED=false)");
    return;
  }
  if (timer) return;

  const intervalMs = parseInt(process.env.EDGE_STALE_INTERVAL_MS || "60000", 10);
  const thresholdMin = parseInt(process.env.EDGE_STALE_THRESHOLD_MIN || "15", 10);

  timer = setInterval(() => {
    markStaleDeployments(thresholdMin)
      .then((ids) => {
        if (ids.length > 0) {
          console.log(`[EdgeStale] marked ${ids.length} deployment(s) OUTDATED: ${ids.join(", ")}`);
        }
      })
      .catch((err) => console.error("[EdgeStale] check failed:", err?.message || err));
  }, intervalMs);

  // Don't keep the event loop alive solely for this timer.
  if (typeof timer.unref === "function") timer.unref();

  console.log(`[EdgeStale] scheduler started (every ${intervalMs}ms, threshold ${thresholdMin}min)`);
}

export function stopEdgeStaleScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
