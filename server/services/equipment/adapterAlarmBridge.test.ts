/**
 * N-6 — Alarm normalization wiring tests (pure mapping + flag-gated no-op).
 *
 * Covers: a KNOWN vendor code maps to the right ISA-18.2 standardCode/severity →
 * Andon state/reason; an UNKNOWN code passes through (unmapped) fail-safe; the bridge
 * is a complete NO-OP when EQ_INTEG_ENABLED is off (raises nothing) across MTConnect
 * + SECS/GEM surfaces. andonService.raiseAndon is mocked so no DB is touched.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the Andon sink so normalizeAndRaise never touches the DB.
const raiseAndonMock = vi.fn(async (input: any) => ({ id: 999, ...input }));
vi.mock("../andon/andonService", () => ({
  raiseAndon: (...args: any[]) => raiseAndonMock(...args),
}));

import {
  severityToAndonState,
  standardCodeToReason,
  buildAndonInput,
  normalizeAndRaise,
} from "./alarmNormalizer";
import { raiseFromMtconnectCondition, raiseFromGemAlarm } from "./adapterAlarmBridge";
import { mapAlarm } from "../standards/alarmTaxonomy";

const prevFlag = process.env.EQ_INTEG_ENABLED;
beforeEach(() => { raiseAndonMock.mockClear(); });
afterEach(() => { process.env.EQ_INTEG_ENABLED = prevFlag; });

describe("pure severity/reason mapping", () => {
  it("maps ISA severity bands to Andon state", () => {
    expect(severityToAndonState("critical")).toBe("red");
    expect(severityToAndonState("high")).toBe("red");
    expect(severityToAndonState("medium")).toBe("yellow");
    expect(severityToAndonState("low")).toBe("yellow");
  });

  it("maps standard codes to Andon reason categories", () => {
    expect(standardCodeToReason("ESTOP_ACTIVE")).toBe("safety");
    expect(standardCodeToReason("COLLISION_DETECT")).toBe("safety");
    expect(standardCodeToReason("QUALITY_DEFECT")).toBe("quality");
    expect(standardCodeToReason("MATERIAL_STARVE")).toBe("material");
    expect(standardCodeToReason("SETUP_RECIPE")).toBe("setup");
    expect(standardCodeToReason("OVERTEMP")).toBe("maintenance"); // fail-safe default
  });

  it("known code → mapped Andon input; unknown code → unmapped passthrough", () => {
    const known = mapAlarm("fanuc", "SRVO-050"); // COLLISION / critical (doc 37 vendor dataset)
    const inputKnown = buildAndonInput({ vendor: "fanuc", nativeCode: "SRVO-050" }, known);
    expect(known.mapped).toBe(true);
    expect(inputKnown.state).toBe("red");
    expect(inputKnown.reason).toBe("safety");
    expect(inputKnown.title).toContain("COLLISION");

    const unknown = mapAlarm("acme", "ZZZ-999");
    const inputUnknown = buildAndonInput({ vendor: "acme", nativeCode: "ZZZ-999" }, unknown);
    expect(unknown.mapped).toBe(false);
    expect(inputUnknown.title).toContain("[unmapped]");
  });
});

describe("normalizeAndRaise flag gating", () => {
  it("flag OFF → no-op passthrough (no Andon raised)", async () => {
    process.env.EQ_INTEG_ENABLED = "false";
    const res = await normalizeAndRaise({ vendor: "fanuc", nativeCode: "SRVO-050" });
    expect(res.raised).toBe(false);
    expect(res.andon).toBeNull();
    expect(raiseAndonMock).not.toHaveBeenCalled();
  });

  it("flag ON → raises a normalized Andon for a known code", async () => {
    process.env.EQ_INTEG_ENABLED = "true";
    const res = await normalizeAndRaise({ vendor: "fanuc", nativeCode: "SRVO-050", machineId: 5 });
    expect(res.raised).toBe(true);
    expect(raiseAndonMock).toHaveBeenCalledTimes(1);
    const call = raiseAndonMock.mock.calls[0][0];
    expect(call.state).toBe("red");
    expect(call.reason).toBe("safety");
    expect(call.machineId).toBe(5);
  });
});

describe("adapter bridges", () => {
  it("MTConnect condition: no-op when flag off, raises when on", async () => {
    process.env.EQ_INTEG_ENABLED = "false";
    const off = await raiseFromMtconnectCondition({ nativeCode: "SRVO-021", machineId: 3, vendor: "fanuc" });
    expect(off.raised).toBe(false);
    expect(raiseAndonMock).not.toHaveBeenCalled();

    process.env.EQ_INTEG_ENABLED = "true";
    const on = await raiseFromMtconnectCondition({ nativeCode: "SRVO-021", machineId: 3, vendor: "fanuc" });
    expect(on.raised).toBe(true);
    expect(on.normalized.standardCode).toBe("ESTOP_ACTIVE");
    expect(raiseAndonMock).toHaveBeenCalledTimes(1);
  });

  it("SECS/GEM alarm SET raises; CLEAR (set=false) is a no-op even with flag on", async () => {
    process.env.EQ_INTEG_ENABLED = "true";
    const cleared = await raiseFromGemAlarm({ alid: 100, set: false, machineId: 2, vendor: "fanuc" });
    expect(cleared.raised).toBe(false);
    expect(raiseAndonMock).not.toHaveBeenCalled();

    // Use a vendor+code that exists in the taxonomy seed so it maps.
    const setAlarm = await raiseFromGemAlarm({ alid: 100, set: true, machineId: 2, vendor: "acme", message: "chamber fault" });
    expect(setAlarm.raised).toBe(true); // raises even when unmapped (fail-safe Andon)
    expect(raiseAndonMock).toHaveBeenCalledTimes(1);
  });
});
