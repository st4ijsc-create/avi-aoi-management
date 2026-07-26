/**
 * doc69 G2-4 — edition/license gate wiring.
 *
 * Proves `aiGateway.planInference` binds to the EXISTING `MOD_AI` module/license gate
 * (`server/_core/moduleGate.ts`, the same entitlement engine `aiCopilotRouter` already
 * shadows via `moduleProcedure("MOD_AI")`) — but ONLY when explicitly opted in via
 * `AI_GATEWAY_LICENSE_GATE_ENABLED` (default OFF). Default behavior must be byte-identical
 * to before this task: `isModuleLicensed` is never even called unless the flag is on.
 *
 * `../_core/moduleGate` is mocked so this test controls the entitlement decision directly
 * without needing a real license/DB setup — the moduleGate.ts unit tests already cover the
 * entitlement RESOLUTION logic itself (no-brick, fail-safe, edition ceiling, …); this file
 * only proves the NEW wiring point (the gateway calling it) behaves correctly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const isModuleLicensedMock = vi.fn();

vi.mock("../_core/moduleGate", () => ({
  isModuleLicensed: (...a: unknown[]) => isModuleLicensedMock(...a),
}));

async function loadFresh() {
  vi.resetModules();
  return import("./aiGateway");
}

const ENV_KEYS = ["AI_GATEWAY_LICENSE_GATE_ENABLED"] as const;

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

describe("aiGateway.planInference — edition/license gate wiring (doc69 G2-4)", () => {
  it("default (flag off): behavior is UNCHANGED — isModuleLicensed is never consulted, even for a deployment that would be denied", async () => {
    isModuleLicensedMock.mockResolvedValue(false); // would deny if it were ever asked
    const gateway = await loadFresh();

    const plan = await gateway.planInference({ task: "chat", text: "hi" });

    expect(plan.decision).toBeTruthy();
    expect(isModuleLicensedMock).not.toHaveBeenCalled();
  });

  it("AI_GATEWAY_LICENSE_GATE_ENABLED=true + MOD_AI NOT licensed → LicenseGateError", async () => {
    process.env.AI_GATEWAY_LICENSE_GATE_ENABLED = "true";
    isModuleLicensedMock.mockResolvedValue(false);
    const gateway = await loadFresh();

    await expect(gateway.planInference({ task: "chat", text: "hi" })).rejects.toThrow(gateway.LicenseGateError);
    expect(isModuleLicensedMock).toHaveBeenCalledWith("MOD_AI");
  });

  it("AI_GATEWAY_LICENSE_GATE_ENABLED=true + MOD_AI IS licensed → allowed normally", async () => {
    process.env.AI_GATEWAY_LICENSE_GATE_ENABLED = "true";
    isModuleLicensedMock.mockResolvedValue(true);
    const gateway = await loadFresh();

    const plan = await gateway.planInference({ task: "chat", text: "hi" });
    expect(plan.decision).toBeTruthy();
  });

  it("fail-safe: isModuleLicensed throwing (DB down) never blocks inference", async () => {
    process.env.AI_GATEWAY_LICENSE_GATE_ENABLED = "true";
    isModuleLicensedMock.mockRejectedValue(new Error("db down"));
    const gateway = await loadFresh();

    const plan = await gateway.planInference({ task: "chat", text: "hi" });
    expect(plan.decision).toBeTruthy();
  });
});
