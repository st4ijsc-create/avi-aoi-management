/**
 * Phase E4 — Factory Control Plane: EDGE NODE HEALTH CHECKER (central-side).
 *
 * Periodically marks edge nodes whose heartbeat is older than the threshold as
 * OFFLINE (mirrors the edgeStaleScheduler interval pattern). FLAG-GATED by
 * EDGE_RUNTIME_ENABLED — when off this is a NO-OP (no timer starts). Fail-safe.
 *
 * Tunables:
 *   EDGE_NODE_HEALTH_INTERVAL_MS   (default 30000)
 *   EDGE_NODE_STALE_THRESHOLD_MIN  (default 2)
 */
import { markStaleNodesOffline, edgeRuntimeEnabled } from "./edgeCoordinator";

let timer: NodeJS.Timeout | null = null;

export function startEdgeNodeHealthChecker(): void {
  if (!edgeRuntimeEnabled()) {
    console.log("[EdgeNodeHealth] checker disabled (EDGE_RUNTIME_ENABLED off)");
    return;
  }
  if (timer) return;

  const intervalMs = parseInt(process.env.EDGE_NODE_HEALTH_INTERVAL_MS || "30000", 10);
  const thresholdMin = parseInt(process.env.EDGE_NODE_STALE_THRESHOLD_MIN || "2", 10);

  timer = setInterval(() => {
    markStaleNodesOffline(thresholdMin)
      .then((codes) => {
        if (codes.length > 0) {
          console.log(`[EdgeNodeHealth] marked ${codes.length} node(s) OFFLINE: ${codes.join(", ")}`);
        }
      })
      .catch((err) => console.error("[EdgeNodeHealth] check failed:", err?.message || err));
  }, intervalMs);

  if (typeof timer.unref === "function") timer.unref();
  console.log(`[EdgeNodeHealth] checker started (every ${intervalMs}ms, threshold ${thresholdMin}min)`);
}

export function stopEdgeNodeHealthChecker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
