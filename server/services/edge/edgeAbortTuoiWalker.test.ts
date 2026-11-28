/**
 * X-EDGE-ABORT-TUOI (bản 3 C-c) — the walker the agent loads in production (edgeExecutionAgent.loadDefaultEdgeWalker) carries the two hooks of a
 * too-old / unknown-time abort and wires them to the engine: chanNonStopAbortCu ⇒ foeEngine.chanNonStopChoAbortCu (the flag, NO sweep),
 * baoTrungTamCu ⇒ foeEngine.baoTrungTamCuMotLan (an old central: warned once). Without them the agent falls back to abortLive, i.e. the sweep.
 * Pure: the engine and the store are mocks recording their calls. No DB, no network, no device.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const E = vi.hoisted(() => ({ goi: [] as Array<{ ham: string; args: unknown[] }> }));
vi.mock("../orchestration/foe/foeEngine", () => ({
  chanNonStopChoAbortCu: async (...args: unknown[]) => (E.goi.push({ ham: "chanNonStopChoAbortCu", args }), { live: true }),
  baoTrungTamCuMotLan: (...args: unknown[]) => void E.goi.push({ ham: "baoTrungTamCuMotLan", args }),
  stopLiveRunForCentralAbort: async (...args: unknown[]) => (E.goi.push({ ham: "stopLiveRunForCentralAbort", args }), { live: true }),
  driveEdgeRunFromPackage: async (...args: unknown[]) => (E.goi.push({ ham: "driveEdgeRunFromPackage", args }), { outcome: "completed" }),
  resendStopsOfAbortedRun: async (...args: unknown[]) => (E.goi.push({ ham: "resendStopsOfAbortedRun", args }), { sent: [], failed: [] }),
}));
vi.mock("./edgeRunStore", () => ({ createEdgeRunStore: () => ({}) }));

import { loadDefaultEdgeWalker } from "./edgeExecutionAgent";

beforeEach(() => {
  E.goi.length = 0;
});

describe("X-EDGE-ABORT-TUOI — loadDefaultEdgeWalker carries the two hooks", () => {
  it("★ WALKER-HOOK — chanNonStopAbortCu reaches foeEngine.chanNonStopChoAbortCu with the run and the decision; baoTrungTamCu reaches baoTrungTamCuMotLan; neither sweeps", async () => {
    const w = (await loadDefaultEdgeWalker()) as unknown as Record<string, (...a: unknown[]) => unknown>;
    expect([typeof w.chanNonStopAbortCu, typeof w.baoTrungTamCu], "WALKER-HOOK: both hooks").toEqual(["function", "function"]);
    const x = { lyDo: "refusedTooOld", abortAgeMs: 960_000, tuoi: 960_000 };
    expect(await w.chanNonStopAbortCu!(9, x), "WALKER-HOOK: its answer").toEqual({ live: true });
    w.baoTrungTamCu!(9);
    expect(E.goi, "WALKER-HOOK: the engine calls").toEqual([
      { ham: "chanNonStopChoAbortCu", args: [9, x] },
      { ham: "baoTrungTamCuMotLan", args: [9] },
    ]);
  });
});
