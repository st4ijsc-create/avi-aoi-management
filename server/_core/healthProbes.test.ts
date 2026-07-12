/**
 * doc 44 W6-4 (G5.25) — liveness / readiness probes for shadow→canary gating.
 */
import { describe, it, expect } from "vitest";
import { livenessProbe, readinessProbe } from "./healthProbes";

describe("G5.25 — livenessProbe", () => {
  it("always reports alive with pid + uptime", () => {
    const r = livenessProbe();
    expect(r.status).toBe("alive");
    expect(typeof r.pid).toBe("number");
    expect(r.uptimeSec).toBeGreaterThanOrEqual(0);
    expect(typeof r.ts).toBe("string");
  });
});

describe("G5.25 — readinessProbe", () => {
  it("is ready when DB is reachable (broker up)", async () => {
    const r = await readinessProbe({ checkDb: async () => true, checkBroker: async () => true });
    expect(r.ready).toBe(true);
    expect(r.status).toBe("ready");
    expect(r.checks.db).toBe("ok");
    expect(r.checks.broker).toBe("ok");
  });

  it("is NOT ready when DB is down (hard gate)", async () => {
    const r = await readinessProbe({ checkDb: async () => false, checkBroker: async () => true });
    expect(r.ready).toBe(false);
    expect(r.status).toBe("not_ready");
    expect(r.checks.db).toBe("down");
  });

  it("stays ready when the broker is disabled (broker is not a gate)", async () => {
    const r = await readinessProbe({ checkDb: async () => true, checkBroker: async () => null });
    expect(r.ready).toBe(true);
    expect(r.checks.broker).toBe("disabled");
  });

  it("never throws — a checker error degrades to not_ready", async () => {
    const r = await readinessProbe({
      checkDb: async () => {
        throw new Error("boom");
      },
    });
    expect(r.ready).toBe(false);
    expect(r.checks.db).toBe("down");
  });
});
