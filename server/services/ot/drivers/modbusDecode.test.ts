/**
 * Sprint F1.2 — modbusDecode helper tests (THUẦN, offline).
 */
import { describe, it, expect } from "vitest";
import { parseModbusAddress, wordCountFor, decodeModbus } from "./modbusDecode";

describe("parseModbusAddress", () => {
  it("40001 / 4x:1 / holding:40001 all map to holding register 0", () => {
    expect(parseModbusAddress("40001")).toEqual({ registerType: "holding", register: 0 });
    expect(parseModbusAddress("4x:1")).toEqual({ registerType: "holding", register: 0 });
    expect(parseModbusAddress("holding:40001")).toEqual({ registerType: "holding", register: 0 });
  });

  it("holding:1 (short 1-based) → register 0", () => {
    expect(parseModbusAddress("holding:1")).toEqual({ registerType: "holding", register: 0 });
  });

  it("input registers", () => {
    expect(parseModbusAddress("30001")).toEqual({ registerType: "input", register: 0 });
    expect(parseModbusAddress("3x:1")).toEqual({ registerType: "input", register: 0 });
    expect(parseModbusAddress("input:30001")).toEqual({ registerType: "input", register: 0 });
  });

  it("coil and discrete", () => {
    expect(parseModbusAddress("coil:1")).toEqual({ registerType: "coil", register: 0 });
    expect(parseModbusAddress("0x:1")).toEqual({ registerType: "coil", register: 0 });
    expect(parseModbusAddress("discrete:1")).toEqual({ registerType: "discrete", register: 0 });
    expect(parseModbusAddress("1x:1")).toEqual({ registerType: "discrete", register: 0 });
    expect(parseModbusAddress("10001")).toEqual({ registerType: "discrete", register: 0 });
  });

  it("offset > 1 maps correctly", () => {
    expect(parseModbusAddress("40010")).toEqual({ registerType: "holding", register: 9 });
    expect(parseModbusAddress("4x:10")).toEqual({ registerType: "holding", register: 9 });
  });

  it("throws on invalid input", () => {
    expect(() => parseModbusAddress("")).toThrow();
    expect(() => parseModbusAddress("foo:1")).toThrow();
    expect(() => parseModbusAddress("9x:1")).toThrow();
    expect(() => parseModbusAddress("abc")).toThrow();
  });
});

describe("wordCountFor", () => {
  it("int/bool = 1, float = 2", () => {
    expect(wordCountFor("int")).toBe(1);
    expect(wordCountFor("bool")).toBe(1);
    expect(wordCountFor("float")).toBe(2);
  });
});

describe("decodeModbus", () => {
  it("bool", () => {
    expect(decodeModbus([1], "bool")).toBe(true);
    expect(decodeModbus([0], "bool")).toBe(false);
  });

  it("int16 signed positive and negative", () => {
    expect(decodeModbus([100], "int")).toBe(100);
    expect(decodeModbus([0xffff], "int")).toBe(-1);
    expect(decodeModbus([0x8000], "int")).toBe(-32768);
  });

  it("uint16 when signed:false", () => {
    expect(decodeModbus([0xffff], "int", { signed: false })).toBe(65535);
  });

  it("float32 big-endian, big word order (1.0 = 0x3F800000)", () => {
    expect(decodeModbus([0x3f80, 0x0000], "float")).toBeCloseTo(1.0, 6);
  });

  it("float32 little word order swaps words", () => {
    // Same 1.0 but words swapped, wordOrder little → re-swap back to 1.0
    expect(decodeModbus([0x0000, 0x3f80], "float", { wordOrder: "little" })).toBeCloseTo(1.0, 6);
  });

  it("float32 little endianness reads bytes reversed", () => {
    // 1.0 little-endian bytes = 00 00 80 3F → as words big-order [0x0000,0x803F]
    expect(
      decodeModbus([0x0000, 0x803f], "float", { endianness: "little" }),
    ).toBeCloseTo(1.0, 6);
  });

  it("float requires 2 words", () => {
    expect(() => decodeModbus([0x3f80], "float")).toThrow(/2 words/);
  });
});
