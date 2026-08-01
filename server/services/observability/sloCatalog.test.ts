/**
 * W0-F (doc 44) — SLO catalogue additions: screen-load-p95 (L5) / policy-eval-p95
 * (L3) / state-read-p95 (L2), and the HONESTY contract of their feeds:
 *   • the three new SLOs are EXCLUDED from the generic HTTP rolling-window proxy
 *     (server HTTP latency is not their signal);
 *   • policy-eval/state-read providers yield null (chưa instrument — W2/W3), so
 *     the evaluator keeps them at "no data" even while HTTP-proxied SLOs evaluate;
 *   • screen-load-p95 yields null while the `rum_web_vitals_lcp_ms` histogram
 *     does not exist in the prom-client registry.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { DEFAULT_SLOS } from "./slo";
import {
  installSloMetricsProviders,
  recordHttpForSlo,
  _resetSloMetricsProvider,
} from "./sloMetricsProvider";
import { evaluateAllOnce, getSloSnapshot, _resetSloAlerting } from "./sloAlerting";

const NEW_IDS = ["screen-load-p95", "policy-eval-p95", "state-read-p95"] as const;

beforeEach(() => {
  _resetSloAlerting();
  _resetSloMetricsProvider();
  process.env.OBSERVABILITY = "true";
});

afterEach(() => {
  _resetSloAlerting();
  _resetSloMetricsProvider();
  delete process.env.OBSERVABILITY;
});

describe("W0-F — SLO catalogue", () => {
  it("contains the three new targets with the spec'd thresholds", () => {
    const byId = new Map(DEFAULT_SLOS.map((s) => [s.id, s]));

    const screen = byId.get("screen-load-p95");
    expect(screen).toBeTruthy();
    expect(screen!.kind).toBe("latency");
    expect(screen!.latencyThresholdMs).toBe(2000);
    expect(screen!.objective).toBe(0.95);

    const policy = byId.get("policy-eval-p95");
    expect(policy).toBeTruthy();
    expect(policy!.latencyThresholdMs).toBe(20);

    const state = byId.get("state-read-p95");
    expect(state).toBeTruthy();
    expect(state!.latencyThresholdMs).toBe(100);
  });

  it("keeps the pre-existing targets (additive change)", () => {
    const ids = DEFAULT_SLOS.map((s) => s.id);
    expect(ids).toContain("dispatch-latency-p95");
    expect(ids).toContain("control-api-availability");
    expect(ids).toContain("uns-delivery-p99");
    expect(ids).toContain("twin-sync-latency");
  });
});

describe("W0-F — honest feeds for the new SLOs", () => {
  it("new SLOs stay 'no data' while HTTP-proxied SLOs evaluate from real traffic", async () => {
    installSloMetricsProviders();

    // Simulate real HTTP traffic (all healthy so no burn-rate alert path fires)
    // → feeds ONLY the proxied SLOs.
    for (let i = 0; i < 20; i++) recordHttpForSlo(50, 200);

    evaluateAllOnce();
    // Let the fire-and-forget RUM refresh (which finds no metric) settle.
    await new Promise((r) => setTimeout(r, 20));
    evaluateAllOnce();

    const snap = new Map(getSloSnapshot().map((s) => [s.sloId, s]));

    // HTTP-proxied SLOs got a real evaluation from the traffic above.
    expect(snap.get("control-api-availability")!.evaluatedAt).not.toBeNull();
    expect(snap.get("dispatch-latency-p95")!.evaluatedAt).not.toBeNull();

    // The three new SLOs are NOT fed by HTTP traffic: honest "no data".
    for (const id of NEW_IDS) {
      const s = snap.get(id);
      expect(s, id).toBeTruthy();
      expect(s!.evaluatedAt, `${id} must not be fed by the HTTP proxy`).toBeNull();
      expect(s!.status, id).toBeNull();
      expect(s!.severity, id).toBe("ok");
    }
  });
});
