/** doc 81 Đợt 11 task L — the bench script proves itself against the in-process Modbus server. */
import { describe, it, expect, vi } from "vitest";
vi.hoisted(() => { process.env.OAUTH_SERVER_URL ??= "http://127.0.0.1:9/oauth-unused"; });
import { runBench } from "./safety-plc-bench";

vi.setConfig({ testTimeout: 90_000 });
describe("safety-plc-bench --self-test", () => {
  it("every step matches and the poller never writes", async () => {
    const quiet = [vi.spyOn(console, "log").mockImplementation(() => undefined), vi.spyOn(console, "warn").mockImplementation(() => undefined)];
    try {
      const r = await runBench({ selfTest: true, estopCoil: 1, zoneCoil: 2, latchCoil: 3, intervalMs: 500 });
      expect(r.steps.filter((s) => !s.ok)).toEqual([]);
      expect(r.serverWrites).toBe(0);
    } finally { quiet.forEach((q) => q.mockRestore()); }
  });
});
