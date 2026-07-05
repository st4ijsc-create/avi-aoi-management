/**
 * Reconciliation cron tests — SYNAPSE §5.9.2 (doc 33 I6).
 */
import { describe, it, expect, beforeEach } from "vitest";

import {
  registerReconcileProvider,
  listReconcileProviders,
  runReconciliationCycle,
  reconcileCronEnabled,
  _clearReconcileProviders,
} from "./reconciliationCron";

describe("reconciliationCron", () => {
  beforeEach(() => _clearReconcileProviders());

  it("no providers → honest empty cycle (ok, 0 tickets)", async () => {
    const r = await runReconciliationCycle();
    expect(r.providers).toBe(0);
    expect(r.tickets).toBe(0);
    expect(r.ok).toBe(true);
  });

  it("runs registered providers; raises tickets on drift", async () => {
    registerReconcileProvider({
      id: "mes",
      description: "MES production vs SYNAPSE",
      pull: async () => ({ internal: { produced: 100 }, external: { produced: 108 }, toleranceRel: 0.02 }),
    });
    const r = await runReconciliationCycle();
    expect(r.providers).toBe(1);
    expect(r.tickets).toBe(1); // 8% drift > 2% tolerance
    expect(r.ok).toBe(false);
    expect(listReconcileProviders().map((p) => p.id)).toEqual(["mes"]);
  });

  it("isolates a throwing provider (cycle continues, error recorded)", async () => {
    registerReconcileProvider({ id: "bad", description: "flaky", pull: async () => { throw new Error("boom"); } });
    registerReconcileProvider({ id: "ok", description: "healthy", pull: async () => ({ internal: { a: 1 }, external: { a: 1 } }) });
    const r = await runReconciliationCycle();
    expect(r.providers).toBe(2);
    expect(r.reports.find((x) => x.id === "bad")?.error).toMatch(/boom/);
    expect(r.reports.find((x) => x.id === "ok")?.report?.ok).toBe(true);
    expect(r.ok).toBe(false); // an errored provider fails the cycle
  });

  it("reconcileCronEnabled reads the flag (default off)", () => {
    expect(reconcileCronEnabled({})).toBe(false);
    expect(reconcileCronEnabled({ RECONCILE_CRON: "true" })).toBe(true);
  });
});
