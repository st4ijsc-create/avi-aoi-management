/**
 * Tests for aiIssueClassifier — "1-tap issue report" classification.
 *
 * Covers:
 *   - valid enum reason/state returned from a mocked generateJSON
 *   - fail-safe default (degraded:true, no throw) when the AI throws / is empty
 *   - enum-clamping: an out-of-enum AI answer is coerced to a valid value
 *   - empty description → bare call-for-help (other/call, degraded)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  classifyIssue,
  clampReason,
  clampState,
  ANDON_REASONS,
  ANDON_STATES,
} from "./aiIssueClassifier";

// ─── Mock the GGUF engine + model router that classifyIssue dynamically imports ───
const generateJSON = vi.fn();
const isGgufAvailable = vi.fn();
vi.mock("./aiGgufEngine", () => ({
  generateJSON: (...a: unknown[]) => generateJSON(...a),
  isGgufAvailable: (...a: unknown[]) => isGgufAvailable(...a),
}));
vi.mock("./aiModelRouter", () => ({
  route: () => ({ modelId: "fast-model", tier: 1, requiresHitl: false }),
}));

beforeEach(() => {
  generateJSON.mockReset();
  isGgufAvailable.mockReset();
  isGgufAvailable.mockResolvedValue(true);
});

describe("clampReason / clampState", () => {
  it("passes through valid enum values (case-insensitive)", () => {
    expect(clampReason("maintenance")).toBe("maintenance");
    expect(clampReason("SAFETY")).toBe("safety");
    expect(clampState("red")).toBe("red");
    expect(clampState("Call")).toBe("call");
  });

  it("coerces off-enum values to the fallback", () => {
    expect(clampReason("banana")).toBe("other");
    expect(clampReason(123)).toBe("other");
    expect(clampReason(null)).toBe("other");
    expect(clampState("critical")).toBe("yellow");
    expect(clampState(undefined)).toBe("yellow");
  });
});

describe("classifyIssue — happy path", () => {
  it("returns a valid enum reason/state from mocked generateJSON", async () => {
    generateJSON.mockResolvedValue({
      data: { reason: "maintenance", state: "red", title: "Máy kẹt băng tải" },
    });

    const res = await classifyIssue({ description: "Máy bị kẹt, không chạy được", lang: "vi" });

    expect(ANDON_REASONS).toContain(res.reason);
    expect(ANDON_STATES).toContain(res.state);
    expect(res.reason).toBe("maintenance");
    expect(res.state).toBe("red");
    expect(res.title).toBe("Máy kẹt băng tải");
    expect(res.degraded).toBe(false);
  });
});

describe("classifyIssue — enum clamping", () => {
  it("coerces an out-of-enum AI answer to a valid value (no throw)", async () => {
    generateJSON.mockResolvedValue({
      data: { reason: "explosion", state: "ultra", title: "x" },
    });

    const res = await classifyIssue({ description: "có gì đó lạ", lang: "vi" });

    expect(ANDON_REASONS).toContain(res.reason);
    expect(ANDON_STATES).toContain(res.state);
    expect(res.reason).toBe("other"); // clamped
    expect(res.state).toBe("yellow"); // clamped
    // A title was provided → not degraded (clamp is not a fallback signal).
    expect(res.degraded).toBe(false);
  });

  it("clamps mixed-case enum answers", async () => {
    generateJSON.mockResolvedValue({ data: { reason: "SaFeTy", state: "RED" } });
    const res = await classifyIssue({ description: "rò rỉ hoá chất", lang: "vi" });
    expect(res.reason).toBe("safety");
    expect(res.state).toBe("red");
  });
});

describe("classifyIssue — fail-safe", () => {
  it("returns the safe default (degraded) when generateJSON throws", async () => {
    generateJSON.mockRejectedValue(new Error("inference failed"));

    const res = await classifyIssue({ description: "máy lỗi", lang: "vi" });

    expect(res.degraded).toBe(true);
    expect(res.reason).toBe("other");
    expect(res.state).toBe("yellow");
    expect(ANDON_REASONS).toContain(res.reason);
  });

  it("returns the safe default when the model is unavailable", async () => {
    isGgufAvailable.mockResolvedValue(false);
    const res = await classifyIssue({ description: "vấn đề gì đó" });
    expect(res.degraded).toBe(true);
    expect(res.reason).toBe("other");
    expect(res.state).toBe("yellow");
    expect(generateJSON).not.toHaveBeenCalled();
  });

  it("returns the safe default when the AI yields empty/no usable fields", async () => {
    generateJSON.mockResolvedValue({ data: {} });
    const res = await classifyIssue({ description: "máy có vấn đề" });
    expect(res.degraded).toBe(true);
    expect(res.reason).toBe("other");
  });

  it("empty description → bare call-for-help (other/call, degraded, no AI call)", async () => {
    const res = await classifyIssue({ description: "", lang: "vi", machineCode: "AVI-001" });
    expect(res.reason).toBe("other");
    expect(res.state).toBe("call");
    expect(res.degraded).toBe(true);
    expect(res.title).toContain("AVI-001");
    expect(generateJSON).not.toHaveBeenCalled();
  });

  it("never throws regardless of input", async () => {
    generateJSON.mockRejectedValue(new Error("boom"));
    await expect(
      classifyIssue({ description: "x".repeat(2000), lang: "en", machineCode: "M-9" }),
    ).resolves.toBeTruthy();
  });
});
