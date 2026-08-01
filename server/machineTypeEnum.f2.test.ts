/**
 * Sprint F2 — enum / constant invariants for the generic machine model.
 */
import { describe, it, expect } from "vitest";
import { machineTypeEnum, processResultEnum } from "../drizzle/schema/enums";
import { MACHINE_TYPES } from "./constants/machineTypes";

describe("F2 — machineTypeEnum", () => {
  it("has exactly 21 values (17 F2 + 4 SMT-core doc40 W5)", () => {
    expect(machineTypeEnum.enumValues).toHaveLength(21);
  });

  it("contains the 4 SMT-core values (doc 40 W5 MTX-03)", () => {
    for (const v of ["MOUNTER", "REFLOW", "STENCIL_PRINTER", "WAVE_SOLDER"]) {
      expect(machineTypeEnum.enumValues).toContain(v);
    }
  });

  it("does not duplicate FCT", () => {
    const fct = machineTypeEnum.enumValues.filter((v) => v === "FCT");
    expect(fct).toHaveLength(1);
  });

  it("has no duplicate values at all", () => {
    expect(new Set(machineTypeEnum.enumValues).size).toBe(machineTypeEnum.enumValues.length);
  });

  it("contains the 9 new F2 values", () => {
    for (const v of [
      "FEEDER", "ASSEMBLY", "SCREWDRIVE", "DISPENSING", "ICT_FUNC",
      "ROBOT_TEST", "PACKAGING", "PALLETIZER", "ROBOT",
    ]) {
      expect(machineTypeEnum.enumValues).toContain(v);
    }
  });

  it("keeps the original 8 values in their original positions", () => {
    expect(machineTypeEnum.enumValues.slice(0, 8)).toEqual([
      "AVI", "AOI", "SPI", "AXI", "ICT", "FCT", "CMM", "AUTOMATION",
    ]);
  });
});

describe("F2 — processResultEnum", () => {
  it("is exactly [pass, fail, warn, skip]", () => {
    expect(processResultEnum.enumValues).toEqual(["pass", "fail", "warn", "skip"]);
  });
});

describe("F2 — MACHINE_TYPES single source of truth", () => {
  it("matches machineTypeEnum exactly (order + values)", () => {
    expect([...MACHINE_TYPES]).toEqual([...machineTypeEnum.enumValues]);
  });
});
