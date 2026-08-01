/**
 * Doc 55 Item 3 PV2 (QĐ#14) — MQTT points-config-changed VARIANT scoping.
 *
 * Proves buildPointsConfigChangedMessage (the pure builder behind
 * publishPointsConfigChanged):
 *   • variantCode ABSENT ⇒ topic + payload byte-identical to the pre-variant message
 *     (base/model fan-out topic; NO variantCode key in the payload) — legacy machines
 *     subscribed to avi/points-config-changed/{code} keep working.
 *   • variantCode PRESENT ⇒ topic gains a /{variantCode} level and the payload carries
 *     the variantCode field, so a variant machine can subscribe to just its variant.
 *   • blank / whitespace variantCode ⇒ treated as absent (byte-identical base form).
 */
import { describe, it, expect } from "vitest";
import { buildPointsConfigChangedMessage } from "./mqttService";

const TS = "2026-07-17T00:00:00.000Z";

describe("QĐ#14 — buildPointsConfigChangedMessage variant scoping", () => {
  it("variantCode ABSENT ⇒ base topic + NO variantCode key (byte-identical)", () => {
    const { topic, payload, variantCode } = buildPointsConfigChangedMessage("MODEL-A", 7, "AOI-01", undefined, TS);
    expect(topic).toBe("avi/points-config-changed/MODEL-A");
    expect(variantCode).toBeUndefined();
    const obj = JSON.parse(payload);
    expect(obj).toEqual({
      type: "POINTS_CONFIG_CHANGED",
      productModelCode: "MODEL-A",
      pointsConfigVersion: 7,
      machineCode: "AOI-01",
      timestamp: TS,
    });
    expect("variantCode" in obj).toBe(false); // additive field must NOT appear when absent
  });

  it("machineCode absent ⇒ null, still no variantCode key (legacy shape)", () => {
    const { payload } = buildPointsConfigChangedMessage("MODEL-A", 3, undefined, undefined, TS);
    const obj = JSON.parse(payload);
    expect(obj.machineCode).toBeNull();
    expect("variantCode" in obj).toBe(false);
  });

  it("variantCode PRESENT ⇒ deeper topic + variantCode field in payload", () => {
    const { topic, payload, variantCode } = buildPointsConfigChangedMessage("MODEL-A", 9, "AOI-01", "EU", TS);
    expect(topic).toBe("avi/points-config-changed/MODEL-A/EU");
    expect(variantCode).toBe("EU");
    const obj = JSON.parse(payload);
    expect(obj.variantCode).toBe("EU");
    expect(obj.pointsConfigVersion).toBe(9);
    expect(obj.productModelCode).toBe("MODEL-A");
  });

  it("blank / whitespace variantCode ⇒ treated as absent (base form)", () => {
    for (const blank of ["", "   ", "\t"]) {
      const { topic, payload } = buildPointsConfigChangedMessage("MODEL-A", 1, undefined, blank, TS);
      expect(topic).toBe("avi/points-config-changed/MODEL-A");
      expect("variantCode" in JSON.parse(payload)).toBe(false);
    }
  });

  it("variantCode is TRIMMED into both topic and payload", () => {
    const { topic, payload } = buildPointsConfigChangedMessage("MODEL-A", 1, undefined, "  EU  ", TS);
    expect(topic).toBe("avi/points-config-changed/MODEL-A/EU");
    expect(JSON.parse(payload).variantCode).toBe("EU");
  });
});
