/**
 * doc69 G2-4 — per-user token quota wiring into `aiGateway.planInference`.
 *
 * Proves the WIRING (not the resolution logic — see aiGatewayQuota.test.ts for that):
 *   • `AI_QUOTA_ENFORCE` OFF (default): an over-budget user is completely UNAFFECTED — the
 *     quota module isn't even consulted (ships dark, zero added latency/DB round-trip).
 *   • `AI_QUOTA_ENFORCE` ON + over-budget → {@link QuotaExceededError}, and the rejection is
 *     recorded (outcome "quota_exceeded") before throwing.
 *   • `AI_QUOTA_ENFORCE` ON + under-budget → allowed normally.
 *   • Fail-safe: a quota-check failure never blocks inference.
 *
 * `./aiGatewayQuota` is mocked so this file controls the quota DECISION directly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const checkQuotaMock = vi.fn();

vi.mock("./aiGatewayQuota", () => ({
  checkQuota: (...a: unknown[]) => checkQuotaMock(...a),
}));

async function loadFresh() {
  vi.resetModules();
  return import("./aiGateway");
}

const ENV_KEYS = ["AI_QUOTA_ENFORCE"] as const;

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

describe("aiGateway.planInference — quota wiring (doc69 G2-4)", () => {
  it("AI_QUOTA_ENFORCE off (default): an over-budget user is NOT blocked, checkQuota is never called", async () => {
    checkQuotaMock.mockResolvedValue({ allowed: false, usedTokens: 999_999, budgetTokens: 1000, source: "user" });
    const gateway = await loadFresh();

    const plan = await gateway.planInference({ task: "chat", text: "hi", userId: 42 });

    expect(plan.decision).toBeTruthy();
    expect(checkQuotaMock).not.toHaveBeenCalled();
  });

  it("AI_QUOTA_ENFORCE on + over budget → QuotaExceededError carrying used/budget", async () => {
    process.env.AI_QUOTA_ENFORCE = "true";
    checkQuotaMock.mockResolvedValue({ allowed: false, usedTokens: 999_999, budgetTokens: 1000, source: "user" });
    const gateway = await loadFresh();

    try {
      await gateway.planInference({ task: "chat", text: "hi", userId: 42 });
      throw new Error("expected QuotaExceededError");
    } catch (err) {
      expect(err).toBeInstanceOf(gateway.QuotaExceededError);
      const qee = err as InstanceType<typeof gateway.QuotaExceededError>;
      expect(qee.usedTokens).toBe(999_999);
      expect(qee.budgetTokens).toBe(1000);
      expect(qee.code).toBe("AI_QUOTA_EXCEEDED");
    }
    expect(checkQuotaMock).toHaveBeenCalledWith(42, undefined);
  });

  it("AI_QUOTA_ENFORCE on + under budget → allowed normally", async () => {
    process.env.AI_QUOTA_ENFORCE = "true";
    checkQuotaMock.mockResolvedValue({ allowed: true, usedTokens: 10, budgetTokens: 1000, source: "user" });
    const gateway = await loadFresh();

    const plan = await gateway.planInference({ task: "chat", text: "hi", userId: 42 });
    expect(plan.decision).toBeTruthy();
  });

  it("AI_QUOTA_ENFORCE on + anon/system caller (no userId) is never quota-checked", async () => {
    process.env.AI_QUOTA_ENFORCE = "true";
    checkQuotaMock.mockResolvedValue(null);
    const gateway = await loadFresh();

    const plan = await gateway.planInference({ task: "chat", text: "hi" }); // no userId
    expect(plan.decision).toBeTruthy();
    expect(checkQuotaMock).toHaveBeenCalledWith(undefined, undefined);
  });

  it("fail-safe: checkQuota throwing never blocks inference even with enforcement on", async () => {
    process.env.AI_QUOTA_ENFORCE = "true";
    checkQuotaMock.mockRejectedValue(new Error("db down"));
    const gateway = await loadFresh();

    const plan = await gateway.planInference({ task: "chat", text: "hi", userId: 42 });
    expect(plan.decision).toBeTruthy();
  });

  it("passes req.role through to checkQuota for the optional per-role fallback", async () => {
    process.env.AI_QUOTA_ENFORCE = "true";
    checkQuotaMock.mockResolvedValue({ allowed: true, usedTokens: 0, budgetTokens: 1000, source: "role" });
    const gateway = await loadFresh();

    await gateway.planInference({ task: "chat", text: "hi", userId: 42, role: "operator" });
    expect(checkQuotaMock).toHaveBeenCalledWith(42, "operator");
  });
});
