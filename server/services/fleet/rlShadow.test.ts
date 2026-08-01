/**
 * D3 RL shadow-allocation tests — SYNAPSE §5.3.4 (doc 33 D3).
 * Shadow-only: logs a policy comparison to the decision-trace; never changes the allocation.
 */
import { describe, it, expect, afterEach } from "vitest";

import { rlShadowAllocation } from "./taskAllocator";
import type { AllocationDecision, AllocCandidate } from "./taskAllocator";
import { queryDecisions, _clearDecisionTraces } from "../observability/decisionTrace";

const prevFlag = process.env.RL_ADVISOR;
const prevMode = process.env.RL_ADVISOR_MODE;
afterEach(() => {
  if (prevFlag === undefined) delete process.env.RL_ADVISOR; else process.env.RL_ADVISOR = prevFlag;
  if (prevMode === undefined) delete process.env.RL_ADVISOR_MODE; else process.env.RL_ADVISOR_MODE = prevMode;
  _clearDecisionTraces();
});

const decision: AllocationDecision = {
  taskCapability: "PICK",
  best: { deviceId: 1, score: 100, eligible: true, reasons: ["capability_ok"] },
  ranked: [
    { deviceId: 1, score: 100, eligible: true, reasons: ["capability_ok"] },
    { deviceId: 2, score: 50, eligible: true, reasons: ["capability_ok"] },
  ],
};
const candidates: AllocCandidate[] = [
  { deviceId: 1, deviceKind: "robot", capabilityClass: "ROBOT", mobile: true, online: true, batteryPct: 40, queueLength: 0 },
  { deviceId: 2, deviceKind: "robot", capabilityClass: "ROBOT", mobile: true, online: true, batteryPct: 95, queueLength: 0 },
];

describe("rlShadowAllocation", () => {
  it("no-op when RL_ADVISOR off (no trace)", () => {
    delete process.env.RL_ADVISOR;
    _clearDecisionTraces();
    rlShadowAllocation(decision, candidates);
    expect(queryDecisions({ decisionType: "rl-shadow" })).toHaveLength(0);
  });

  it("shadow mode logs a comparison; emitted choice stays the heuristic pick (device 1)", () => {
    process.env.RL_ADVISOR = "true";
    process.env.RL_ADVISOR_MODE = "shadow";
    _clearDecisionTraces();
    rlShadowAllocation(decision, candidates);
    const traces = queryDecisions({ decisionType: "rl-shadow" });
    expect(traces).toHaveLength(1);
    // heuristic chose device 1; the RL alt-policy (most battery) would pick device 2 — logged, not applied.
    expect(traces[0].chosen).toBe("1");
    expect(traces[0].candidates.map((c) => c.id).sort()).toEqual(["1", "2"]);
    expect(traces[0].note).toMatch(/shadow/i);
  });
});
