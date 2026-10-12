/**
 * doc 81 Đợt 10 task D — ruling R-10-k (L-7): a console STOP for an edge-owned robot never becomes a silent no-op. Each fallback:
 *   queued at once · queue fails (stale / notEdgeOwned / unavailable) ⇒ central STOP if a session exists AND a re-queue for the
 *   current owner · re-queue alone succeeds · central alone succeeds · neither ⇒ critical alert + a user-visible error.
 * The queue (group B) is replaced through the port.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../db/connection", () => ({ getDb: async () => null }));
import { sendConsoleStopForEdgeRobot, setEdgeDeviceRequestPort } from "./robotEdgeCommandPort";

let script: Array<"ok" | "stale" | "notEdgeOwned" | "unavailable"> = [];
let calls = 0;
beforeEach(() => {
  script = [];
  calls = 0;
  setEdgeDeviceRequestPort({
    async enqueue() {
      const step = script[calls++] ?? "unavailable";
      if (step === "ok") return { requestId: 100 + calls, edgeNodeId: 4, ownerEpoch: 2 };
      throw Object.assign(new Error(step), { code: step });
    },
  });
});
const base = { robotId: 12, requestedBy: 7, reason: "console stop" };

describe("R-10-k — console STOP for an edge-owned robot", () => {
  it("queued at once ⇒ ok via edge_queue; central is never asked", async () => {
    script = ["ok"];
    const central = vi.fn(async () => ({ ok: true, status: "done" }));
    expect(await sendConsoleStopForEdgeRobot({ ...base, centralStop: central })).toMatchObject({ ok: true, via: "edge_queue", requestId: 101 });
    expect(central).not.toHaveBeenCalled();
  });

  for (const code of ["stale", "notEdgeOwned", "unavailable"] as const) {
    it(`★ queue ${code} ⇒ the central STOP goes out (session held) AND the queue is retried for the current owner`, async () => {
      script = [code, "ok"];
      const central = vi.fn(async () => ({ ok: true, status: "done" }));
      const r = await sendConsoleStopForEdgeRobot({ ...base, centralStop: central });
      expect(r).toMatchObject({ ok: true, via: "central+edge_queue_retry", requestId: 102, centralStatus: "done" });
      expect(central).toHaveBeenCalledTimes(1);
      expect(calls).toBe(2);
    });
  }

  it("queue fails, no central session, the retry succeeds ⇒ ok via edge_queue_retry", async () => {
    script = ["stale", "ok"];
    expect(await sendConsoleStopForEdgeRobot({ ...base, centralStop: async () => null })).toMatchObject({ ok: true, via: "edge_queue_retry" });
  });

  it("queue fails twice but central holds a session ⇒ ok via central (no alert)", async () => {
    script = ["unavailable", "unavailable"];
    const alert = vi.fn();
    expect(await sendConsoleStopForEdgeRobot({ ...base, centralStop: async () => ({ ok: true, status: "done" }), alert })).toMatchObject({ ok: true, via: "central" });
    expect(alert).not.toHaveBeenCalled();
  });

  it("★ neither works (no session / central STOP failed, both queue attempts fail) ⇒ CRITICAL alert + a user-visible error — never silent", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const central of [async () => null, async () => ({ ok: false, status: "rejected" }), async () => { throw new Error("boom"); }]) {
      script = ["stale", "notEdgeOwned"];
      calls = 0;
      const alert = vi.fn();
      const r = await sendConsoleStopForEdgeRobot({ ...base, centralStop: central as never, alert });
      expect(r).toMatchObject({ ok: false, via: "none", error: "EDGE_STOP_NOT_QUEUED" });
      expect(alert).toHaveBeenCalledTimes(1);
      expect(alert.mock.calls[0][0]).toMatch(/hardware E-STOP/);
    }
    err.mockRestore();
  });
});

describe("fix review 1 (M-4) — the default alert of an undelivered console STOP is DURABLE", () => {
  it("no injected alert ⇒ criticalStopAlert (alert stream + safety-critical inbox row to the requester)", async () => {
    const calls: Array<{ recipients: number[]; message: string }> = [];
    vi.doMock("./criticalStopAlert", () => ({ raiseCriticalStopAlert: async (a: { recipients: number[]; message: string }) => void calls.push(a) }));
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    script = ["stale", "stale"];
    const r = await sendConsoleStopForEdgeRobot({ ...base, centralStop: async () => null });
    expect(r).toMatchObject({ ok: false, error: "EDGE_STOP_NOT_QUEUED" });
    const t0 = Date.now();
    while (calls.length === 0 && Date.now() - t0 < 2_000) await new Promise((x) => setTimeout(x, 20));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ recipients: [7] });
    expect(calls[0].message).toMatch(/hardware E-STOP/);
    err.mockRestore();
    vi.doUnmock("./criticalStopAlert");
  });
});
