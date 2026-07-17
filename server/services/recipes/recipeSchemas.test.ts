/**
 * doc 56 Đ4 — typed recipe schema + guardrail-mapping unit tests (PURE, no DB).
 *
 * Asserts: the machineType→kind map, per-mode validation (off/log/enforce), the
 * discriminated union, and the guardrail param extraction that gives approve its teeth.
 */
import { describe, it, expect } from "vitest";
import {
  MACHINE_TYPE_TO_RECIPE_KIND,
  RECIPE_PAYLOAD_SCHEMAS,
  recipePayloadUnion,
  schemaForMachineType,
  validateRecipePayload,
  guardrailParamsFor,
  RECIPE_GUARDRAIL_KEY_MAP,
} from "./recipeSchemas";

describe("machineType → recipe kind map", () => {
  it("maps the automation families that carry structured setpoints", () => {
    expect(MACHINE_TYPE_TO_RECIPE_KIND.SCREWDRIVE).toBe("screw_program");
    expect(MACHINE_TYPE_TO_RECIPE_KIND.DISPENSING).toBe("dispense_program");
    expect(MACHINE_TYPE_TO_RECIPE_KIND.WELDER).toBe("weld_profile");
    expect(MACHINE_TYPE_TO_RECIPE_KIND.IOT_SENSOR).toBe("iot_settings");
    expect(MACHINE_TYPE_TO_RECIPE_KIND.IOT_GATEWAY).toBe("iot_settings");
  });
  it("has NO typed schema for AOI/AVI/ICT (they always pass validation)", () => {
    expect(MACHINE_TYPE_TO_RECIPE_KIND.AOI).toBeUndefined();
    expect(schemaForMachineType("AOI")).toBeNull();
    expect(schemaForMachineType("SCREWDRIVE")).toBe(RECIPE_PAYLOAD_SCHEMAS.screw_program);
  });
});

describe("validateRecipePayload — modes", () => {
  const validScrew = { torqueTarget: 1.5, torqueTolerance: 0.2, sequence: [{ step: 1, torque: 1.5 }] };
  const invalidScrew = { torqueTolerance: 0.2 }; // missing required torqueTarget

  it("mode 'off' NEVER validates (byte-identical) even for a broken payload", () => {
    const res = validateRecipePayload("SCREWDRIVE", invalidScrew, "off");
    expect(res.ok).toBe(true);
    expect(res.kind).toBeNull();
  });

  it("untyped machineType always passes (kind null)", () => {
    const res = validateRecipePayload("AOI", { anything: true }, "enforce");
    expect(res.ok).toBe(true);
    expect(res.kind).toBeNull();
  });

  it("mode 'enforce' accepts a valid screw program", () => {
    const res = validateRecipePayload("SCREWDRIVE", validScrew, "enforce");
    expect(res.ok).toBe(true);
    expect(res.kind).toBe("screw_program");
    expect(res.errors).toHaveLength(0);
  });

  it("mode 'enforce' rejects an invalid screw program with flat errors", () => {
    const res = validateRecipePayload("SCREWDRIVE", invalidScrew, "enforce");
    expect(res.ok).toBe(false);
    expect(res.kind).toBe("screw_program");
    expect(res.errors.join(" ")).toMatch(/torqueTarget/);
  });

  it("mode 'log' still reports ok=false on mismatch (caller warns + accepts)", () => {
    const res = validateRecipePayload("DISPENSING", { pressure: 100 }, "log"); // missing volumeTarget
    expect(res.ok).toBe(false);
    expect(res.kind).toBe("dispense_program");
  });

  it("keeps unknown keys (passthrough) — a machine may send extra fields", () => {
    const res = validateRecipePayload("WELDER", { current: 200, time: 50, tempMax: 300, extraVendorField: "x" }, "enforce");
    expect(res.ok).toBe(true);
  });
});

describe("recipePayloadUnion — discriminated union on `kind`", () => {
  it("parses a tagged screw_program", () => {
    const parsed = recipePayloadUnion.safeParse({ kind: "screw_program", torqueTarget: 1.5, torqueTolerance: 0.1 });
    expect(parsed.success).toBe(true);
  });
  it("parses a tagged dispense_program", () => {
    const parsed = recipePayloadUnion.safeParse({ kind: "dispense_program", volumeTarget: 2, pressure: 120 });
    expect(parsed.success).toBe(true);
  });
  it("rejects an unknown discriminator", () => {
    const parsed = recipePayloadUnion.safeParse({ kind: "nope", foo: 1 });
    expect(parsed.success).toBe(false);
  });
  it("rejects a member missing a required field", () => {
    const parsed = recipePayloadUnion.safeParse({ kind: "weld_profile", current: 200 }); // missing time/tempMax
    expect(parsed.success).toBe(false);
  });
});

describe("guardrailParamsFor — approve teeth mapping", () => {
  it("extracts physical setpoints for SCREWDRIVE (tolerance is NOT range-gated)", () => {
    const params = guardrailParamsFor("SCREWDRIVE", { torqueTarget: 1.5, torqueTolerance: 0.2, angleTarget: 270 });
    expect(params).toEqual(
      expect.arrayContaining([
        { paramKey: "torque_nm", value: 1.5 },
        { paramKey: "angle_deg", value: 270 },
      ]),
    );
    expect(params.find((p) => p.paramKey === "torque_nm")).toBeTruthy();
    // torqueTolerance has no guardrail key → not extracted.
    expect(params.map((p) => p.value)).not.toContain(0.2);
  });

  it("extracts volume + pressure for DISPENSING", () => {
    const params = guardrailParamsFor("DISPENSING", { volumeTarget: 2.5, pressure: 130 });
    expect(params).toEqual(
      expect.arrayContaining([
        { paramKey: "volume_ml", value: 2.5 },
        { paramKey: "pressure_kpa", value: 130 },
      ]),
    );
  });

  it("returns [] for an untyped machineType", () => {
    expect(guardrailParamsFor("AOI", { torqueTarget: 1.5 })).toEqual([]);
  });

  it("skips non-numeric / missing fields", () => {
    const params = guardrailParamsFor("WELDER", { current: 200, time: "50" as any, tempMax: 300 });
    const keys = params.map((p) => p.paramKey);
    expect(keys).toContain("weld_current_a");
    expect(keys).toContain("temp_c");
    expect(keys).not.toContain("weld_time_ms"); // time was a string
  });

  it("the guardrail key map is defined for every recipe kind", () => {
    for (const kind of Object.values(MACHINE_TYPE_TO_RECIPE_KIND)) {
      expect(RECIPE_GUARDRAIL_KEY_MAP[kind]).toBeTruthy();
    }
  });
});
