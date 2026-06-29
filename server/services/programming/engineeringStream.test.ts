/**
 * Doc 09 / Phase D6 — Engineering stream (Online Monitor) unit tests (vitest, fake timers).
 *
 * Covers: flag gate (off → no-op), interval emit via injected source+sink, min-interval
 * clamp, stop/replace semantics, and source-error fail-safe (loop survives).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  EngineeringStreamManager,
  streamingEnabled,
  type SymbolSample,
} from "./engineeringStream";

beforeEach(() => {
  vi.useFakeTimers();
  process.env.DPC_STREAMING_ENABLED = "true";
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.DPC_STREAMING_ENABLED;
});

function makeSink() {
  const batches: Array<{ machineId: number; samples: SymbolSample[] }> = [];
  return { batches, sink: (machineId: number, samples: SymbolSample[]) => batches.push({ machineId, samples }) };
}

describe("EngineeringStreamManager", () => {
  it("flag OFF → startWatch is a no-op", () => {
    process.env.DPC_STREAMING_ENABLED = "false";
    const { sink, batches } = makeSink();
    const mgr = new EngineeringStreamManager(async () => [{ symbol: "X0", value: 1, ts: 0 }], sink);
    const started = mgr.startWatch({ sessionId: "s1", machineId: 5, symbols: ["X0"] });
    expect(started).toBe(false);
    expect(mgr.activeSessions().length).toBe(0);
    expect(batches.length).toBe(0);
  });

  it("emits samples on each tick via the injected source+sink", async () => {
    const { sink, batches } = makeSink();
    const source = vi.fn(async (_m: number, syms: string[]) => syms.map((s) => ({ symbol: s, value: 1, ts: 0 })));
    const mgr = new EngineeringStreamManager(source, sink);
    expect(mgr.startWatch({ sessionId: "s1", machineId: 9, symbols: ["X0", "Y0"], intervalMs: 200 })).toBe(true);

    await vi.advanceTimersByTimeAsync(650); // ~3 ticks at 200ms
    expect(source).toHaveBeenCalled();
    expect(batches.length).toBeGreaterThanOrEqual(3);
    expect(batches[0].machineId).toBe(9);
    expect(batches[0].samples.map((s) => s.symbol)).toEqual(["X0", "Y0"]);
    mgr.stopAll();
  });

  it("clamps below the minimum interval (100ms)", async () => {
    const { sink, batches } = makeSink();
    const mgr = new EngineeringStreamManager(async () => [{ symbol: "X0", value: 1, ts: 0 }], sink);
    mgr.startWatch({ sessionId: "s1", machineId: 1, symbols: ["X0"], intervalMs: 1 });
    await vi.advanceTimersByTimeAsync(250); // at 100ms clamp → ~2 ticks, not ~250
    expect(batches.length).toBeLessThanOrEqual(3);
    expect(batches.length).toBeGreaterThanOrEqual(2);
    mgr.stopAll();
  });

  it("stopWatch ends the session; replacing same id keeps one session", async () => {
    const { sink } = makeSink();
    const mgr = new EngineeringStreamManager(async () => [{ symbol: "X0", value: 1, ts: 0 }], sink);
    mgr.startWatch({ sessionId: "s1", machineId: 1, symbols: ["X0"] });
    mgr.startWatch({ sessionId: "s1", machineId: 1, symbols: ["X0", "X1"] }); // replace
    expect(mgr.activeSessions().length).toBe(1);
    mgr.stopWatch("s1");
    expect(mgr.activeSessions().length).toBe(0);
  });

  it("source error does not kill the loop", async () => {
    const { sink, batches } = makeSink();
    let calls = 0;
    const source = async () => {
      calls++;
      if (calls === 1) throw new Error("boom");
      return [{ symbol: "X0", value: 1, ts: 0 }];
    };
    const mgr = new EngineeringStreamManager(source, sink);
    mgr.startWatch({ sessionId: "s1", machineId: 1, symbols: ["X0"], intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(350);
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(batches.length).toBeGreaterThanOrEqual(1); // later ticks still emit
    mgr.stopAll();
  });

  it("streamingEnabled reads the flag", () => {
    process.env.DPC_STREAMING_ENABLED = "1";
    expect(streamingEnabled()).toBe(true);
    process.env.DPC_STREAMING_ENABLED = "false";
    expect(streamingEnabled()).toBe(false);
  });
});
