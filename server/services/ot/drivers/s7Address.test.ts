/**
 * Sprint F1.3 — s7Address helper tests (THUẦN, offline).
 */
import { describe, it, expect } from "vitest";
import { parseS7Address, coerceS7Value } from "./s7Address";

describe("parseS7Address", () => {
  it("data block word/real types", () => {
    expect(parseS7Address("DB1,REAL0")).toEqual({ s7: "DB1,REAL0", isBit: false, isReadOnly: false });
    expect(parseS7Address("DB1,INT12")).toEqual({ s7: "DB1,INT12", isBit: false, isReadOnly: false });
    expect(parseS7Address("db2,dint8")).toEqual({ s7: "DB2,DINT8", isBit: false, isReadOnly: false });
  });

  it("data block bit (X) requires .bit", () => {
    expect(parseS7Address("DB1,X14.0")).toEqual({ s7: "DB1,X14.0", isBit: true, isReadOnly: false });
    expect(() => parseS7Address("DB1,X14")).toThrow(/bit/i);
  });

  it("memory bit and word/real", () => {
    expect(parseS7Address("M0.0")).toEqual({ s7: "M0.0", isBit: true, isReadOnly: false });
    expect(parseS7Address("MD4")).toEqual({ s7: "MD4", isBit: false, isReadOnly: false });
    expect(parseS7Address("MR4")).toEqual({ s7: "MR4", isBit: false, isReadOnly: false });
    expect(parseS7Address("MW0")).toEqual({ s7: "MW0", isBit: false, isReadOnly: false });
  });

  it("IO addresses", () => {
    expect(parseS7Address("I0.0")).toEqual({ s7: "I0.0", isBit: true, isReadOnly: true });
    expect(parseS7Address("Q0.1")).toEqual({ s7: "Q0.1", isBit: true, isReadOnly: false });
  });

  it("isReadOnly: process inputs I/E/PI read-only; M/Q/A/PQ writable", () => {
    expect(parseS7Address("I0.0").isReadOnly).toBe(true);
    expect(parseS7Address("E0.0").isReadOnly).toBe(true); // E = I (German)
    expect(parseS7Address("PIW4").isReadOnly).toBe(true);
    expect(parseS7Address("Q0.0").isReadOnly).toBe(false);
    expect(parseS7Address("M10.0").isReadOnly).toBe(false);
    expect(parseS7Address("PQW2").isReadOnly).toBe(false);
    expect(parseS7Address("DB1,REAL0").isReadOnly).toBe(false);
  });

  it("throws on invalid input", () => {
    expect(() => parseS7Address("")).toThrow();
    expect(() => parseS7Address("DB1,FOO0")).toThrow(/data type/i);
    expect(() => parseS7Address("garbage!")).toThrow();
  });
});

describe("coerceS7Value", () => {
  it("null/undefined → bad", () => {
    expect(coerceS7Value(null, "float")).toEqual({ value: null, quality: "bad" });
    expect(coerceS7Value(undefined, "int")).toEqual({ value: null, quality: "bad" });
  });

  it("bool / int / float / string (no scale applied here)", () => {
    expect(coerceS7Value(1, "bool")).toEqual({ value: true, quality: "good" });
    expect(coerceS7Value(0, "bool")).toEqual({ value: false, quality: "good" });
    expect(coerceS7Value(12.7, "int")).toEqual({ value: 13, quality: "good" });
    expect(coerceS7Value(3.5, "float")).toEqual({ value: 3.5, quality: "good" });
    expect(coerceS7Value(42, "string")).toEqual({ value: "42", quality: "good" });
  });

  it("NaN number → bad", () => {
    expect(coerceS7Value(NaN, "float")).toEqual({ value: null, quality: "bad" });
  });
});
