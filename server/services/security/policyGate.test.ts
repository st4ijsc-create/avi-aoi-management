/**
 * Policy write-gate adapter tests — SYNAPSE §5.11.2 (doc 33 I2).
 */
import { describe, it, expect } from "vitest";

import { evaluateCommandPolicy, secPlatformEnabled } from "./policyGate";

describe("evaluateCommandPolicy", () => {
  it("SEC_PLATFORM off (default) → allow-all, non-breaking", () => {
    expect(secPlatformEnabled({})).toBe(false);
    const r = evaluateCommandPolicy({ action: "skip_step", step: { type: "AOI" }, product: { class: 3 } }, { enabled: false });
    expect(r.allow).toBe(true);
    expect(r.effect).toBe("allow");
  });

  it("when enabled: deny policy blocks the command", () => {
    const r = evaluateCommandPolicy(
      { action: "skip_step", step: { type: "AOI" }, product: { class: 3 } },
      { enabled: true },
    );
    expect(r.allow).toBe(false);
    expect(r.effect).toBe("deny");
    expect(r.policyId).toBe("deny-skip-aoi-class3");
  });

  it("require_approval blocks without approval, allows with a four-eyes approval", () => {
    const ctx = { action: "manual_override", zone: { density: 0.9 } };
    expect(evaluateCommandPolicy(ctx, { enabled: true }).allow).toBe(false);
    expect(evaluateCommandPolicy(ctx, { enabled: true, approved: true }).allow).toBe(true);
  });

  it("a plain device_write matches no default policy → allowed even when enabled", () => {
    const r = evaluateCommandPolicy({ action: "device_write" }, { enabled: true });
    expect(r.allow).toBe(true);
    expect(r.effect).toBe("allow");
  });
});
