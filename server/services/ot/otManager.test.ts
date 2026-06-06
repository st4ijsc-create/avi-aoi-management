/**
 * Sprint F1.1 — otManager unit tests.
 *   - no-op + false when OT_GATEWAY_ENABLED is off
 *   - an un-implemented protocol is skipped (does NOT throw / crash) when enabled
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("otManager", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("startOt is a no-op returning false when flag is off", async () => {
    vi.stubEnv("OT_GATEWAY_ENABLED", "false");
    const { startOt, isOtRunning, stopOt } = await import("./otManager");
    const ok = await startOt();
    expect(ok).toBe(false);
    expect(isOtRunning()).toBe(false);
    await stopOt(); // idempotent
    expect(isOtRunning()).toBe(false);
  });

  it("skips an adapter whose driver.connect throws, without crashing", async () => {
    vi.stubEnv("OT_GATEWAY_ENABLED", "true");

    const failingAdapter = {
      adapterId: 1, code: "BAD", machineId: null, protocol: "opcua" as const,
      connection: { endpoint: "opc.tcp://x" }, pollIntervalMs: 1000, tags: [],
      driver: {
        protocol: "opcua",
        connect: vi.fn().mockRejectedValue(new Error("opcua driver not implemented (F1.2/F1.3)")),
        disconnect: vi.fn().mockResolvedValue(undefined),
        isConnected: () => false,
        subscribe: vi.fn(),
      } as never,
    };

    vi.doMock("./deviceAdapter", () => ({
      loadEnabledAdapters: async () => [failingAdapter],
    }));
    vi.doMock("./ingest", () => ({ ingestSample: vi.fn() }));

    const { startOt, isOtRunning, stopOt } = await import("./otManager");
    // Should resolve without throwing even though the only adapter fails.
    const ok = await startOt();
    expect(ok).toBe(true);          // manager started; adapter skipped
    expect(isOtRunning()).toBe(true);
    await stopOt();
    expect(isOtRunning()).toBe(false);
  });
});
