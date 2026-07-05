/**
 * Example REST reconciliation provider tests — SYNAPSE §5.9.2 (doc 33 §11 · I6 completion).
 */
import { describe, it, expect } from "vitest";

import { makeRestReconcileProvider, registerExampleReconcileProviders } from "./exampleRestProvider";
import type { ReconcileProvider } from "../reconciliationCron";

function mockFetch(body: any, ok = true, status = 200): typeof fetch {
  return (async () => ({ ok, status, json: async () => body })) as unknown as typeof fetch;
}

describe("exampleRestProvider", () => {
  it("pulls internal/external maps (+ tolerance) from the REST body", async () => {
    const p = makeRestReconcileProvider({
      id: "x",
      description: "d",
      url: "http://sor/metrics",
      fetchImpl: mockFetch({ internal: { produced: 100 }, external: { produced: 100 }, toleranceRel: 0.01 }),
    });
    const input = await p.pull();
    expect(input.internal).toEqual({ produced: 100 });
    expect(input.external).toEqual({ produced: 100 });
    expect(input.toleranceRel).toBe(0.01);
  });

  it("throws on a non-200 response", async () => {
    const p = makeRestReconcileProvider({ id: "x", description: "d", url: "u", fetchImpl: mockFetch({}, false, 503) });
    await expect(p.pull()).rejects.toThrow(/HTTP 503/);
  });

  it("registerExampleReconcileProviders: honest no-op without the env URL, registers with it", () => {
    const got: ReconcileProvider[] = [];
    expect(registerExampleReconcileProviders((p) => got.push(p), {} as NodeJS.ProcessEnv)).toBe(0);
    expect(got).toHaveLength(0);
    expect(registerExampleReconcileProviders((p) => got.push(p), { RECONCILE_EXAMPLE_URL: "http://sor" } as unknown as NodeJS.ProcessEnv)).toBe(1);
    expect(got[0].id).toBe("example-rest");
  });
});
