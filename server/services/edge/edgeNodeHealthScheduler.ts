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
    // doc 81 Đợt 9 final wave F2 — a run assigned to a node that never claims it (the node is down, so it never pulls) is held
    // visibly ("edge unreachable") after EDGE_UNCLAIMED_HOLD_MS. Migration 0370 missing ⇒ nothing to do (silent).
    void import("./edgeExecutionCentral")
      .then(async (m) => {
        const { isEdgeSchemaMissing } = await import("./edgeExecutionSchema");
        try {
          const held = await m.holdUnclaimedEdgeRuns();
          if (held.length > 0) console.log(`[EdgeNodeHealth] held ${held.length} unclaimed edge run(s): ${held.join(", ")}`);
        } catch (err) {
          if (!isEdgeSchemaMissing(err)) console.error("[EdgeNodeHealth] unclaimed edge run check failed:", (err as Error)?.message || err);
        }
      })
      .catch(() => undefined);
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
