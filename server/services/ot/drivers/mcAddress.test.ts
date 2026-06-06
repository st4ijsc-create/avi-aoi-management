/**
 * Sprint F1.3 — mcAddress helper tests (THUẦN, offline).
 */
import { describe, it, expect } from "vitest";
import { parseMcAddress, coerceMcValue } from "./mcAddress";

describe("parseMcAddress", () => {
  it("word devices", () => {
    expect(parseMcAddress("D100")).toEqual({ mc: "D100", device: "D", isBit: false, isReadOnly: false });
    expect(parseMcAddress("R2000")).toEqual({ mc: "R2000", device: "R", isBit: false, isReadOnly: false });
    expect(parseMcAddress("W100")).toEqual({ mc: "W100", device: "W", isBit: false, isReadOnly: false });
    expect(parseMcAddress("CN199")).toEqual({ mc: "CN199", device: "CN", isBit: false, isReadOnly: false });
  });

  it("float-prefixed word devices", () => {
    expect(parseMcAddress("RFLOAT5000")).toEqual({
      mc: "RFLOAT5000",
      device: "RFLOAT",
      isBit: false,
      isReadOnly: false,
    });
  });

  it("bit devices", () => {
    expect(parseMcAddress("M100")).toEqual({ mc: "M100", device: "M", isBit: true, isReadOnly: false });
    expect(parseMcAddress("X034")).toEqual({ mc: "X034", device: "X", isBit: true, isReadOnly: true });
    expect(parseMcAddress("y10")).toEqual({ mc: "Y10", device: "Y", isBit: true, isReadOnly: false });
  });

  it("bit-in-word (D6000.1)", () => {
    expect(parseMcAddress("D6000.1")).toEqual({ mc: "D6000.1", device: "D", isBit: true, isReadOnly: false });
  });

  it("isReadOnly: input devices X/DX read-only; M/Y/D writable", () => {
    expect(parseMcAddress("X10").isReadOnly).toBe(true);
    expect(parseMcAddress("DX5").isReadOnly).toBe(true);
    expect(parseMcAddress("Y10").isReadOnly).toBe(false);
    expect(parseMcAddress("M100").isReadOnly).toBe(false);
    expect(parseMcAddress("D0").isReadOnly).toBe(false);
  });

  it("throws on invalid input", () => {
    expect(() => parseMcAddress("")).toThrow();
    expect(() => parseMcAddress("100")).toThrow();
    expect(() => parseMcAddress("ZZ100")).toThrow(/unknown MC device/);
  });
});

describe("coerceMcValue", () => {
  it("null → bad; bool/int/float coercion", () => {
    expect(coerceMcValue(null, "int")).toEqual({ value: null, quality: "bad" });
    expect(coerceMcValue(true, "bool")).toEqual({ value: true, quality: "good" });
    expect(coerceMcValue(0, "bool")).toEqual({ value: false, quality: "good" });
    expect(coerceMcValue(10.4, "int")).toEqual({ value: 10, quality: "good" });
    expect(coerceMcValue(1.25, "float")).toEqual({ value: 1.25, quality: "good" });
  });

  it("NaN → bad", () => {
    expect(coerceMcValue(NaN, "float")).toEqual({ value: null, quality: "bad" });
  });
});
