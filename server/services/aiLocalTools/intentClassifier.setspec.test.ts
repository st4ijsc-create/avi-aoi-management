/**
 * GĐ2 — set_spec_limits intent recognition + arg extraction + clarification.
 */
import { describe, it, expect } from "vitest";
import "./handlers";       // read tools
import "./writeHandlers";  // set_spec_limits
import { classifyToolIntent } from "./intentClassifier";

describe("GĐ2 — classifyToolIntent set_spec_limits", () => {
  it("recognizes a fully-specified set-spec request and extracts args", () => {
    const d = classifyToolIntent("đặt spec điểm đo #12: USL=10.5, LSL=9.5, target=10");
    expect(d.tool).toBe("set_spec_limits");
    const a = d.args as Record<string, unknown>;
    expect(a.measurementPointDefId).toBe(12);
    expect(a.usl).toBe(10.5);
    expect(a.lsl).toBe(9.5);
    expect(a.target).toBe(10);
  });

  it("asks for clarification when the measurement point id is missing", () => {
    const d = classifyToolIntent("đặt spec USL=10 LSL=8");
    expect(d.tool).toBeNull();
    expect(d.reason).toBe("MISSING_SPEC_ARGS");
    expect(d.clarifyMessage).toBeTruthy();
  });

  it("asks for clarification when no spec value is provided", () => {
    const d = classifyToolIntent("cập nhật spec cho điểm đo #7");
    expect(d.tool).toBeNull();
    expect(d.reason).toBe("MISSING_SPEC_ARGS");
  });

  it("does NOT match set_spec_limits for a read question about spec", () => {
    // No write verb → must not become a write proposal.
    const d = classifyToolIntent("tỷ lệ NG hôm nay là bao nhiêu?");
    expect(d.tool).not.toBe("set_spec_limits");
  });
});
