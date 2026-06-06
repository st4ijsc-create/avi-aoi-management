/**
 * Sprint F1.2 — opcuaAddress helper tests (THUẦN, offline).
 */
import { describe, it, expect } from "vitest";
import { parseOpcuaAddress, normalizeOpcuaValue } from "./opcuaAddress";

describe("parseOpcuaAddress", () => {
  it("parses valid string/numeric/guid/bytestring nodeIds", () => {
    expect(parseOpcuaAddress("ns=2;s=Temperature").nodeId).toBe("ns=2;s=Temperature");
    expect(parseOpcuaAddress("ns=0;i=2258").nodeId).toBe("ns=0;i=2258");
    expect(parseOpcuaAddress("ns=1;g=09087e75-8e5e-499b-954f-f2a9603db28a").nodeId).toContain("g=");
    expect(parseOpcuaAddress("ns=3;b=YmFzZTY0").nodeId).toContain("b=");
  });

  it("trims whitespace", () => {
    expect(parseOpcuaAddress("  ns=2;s=Foo  ").nodeId).toBe("ns=2;s=Foo");
  });

  it("throws on invalid nodeId", () => {
    expect(() => parseOpcuaAddress("DB1.0")).toThrow(/invalid OPC-UA nodeId/);
    expect(() => parseOpcuaAddress("ns=2;x=Foo")).toThrow(/invalid OPC-UA nodeId/);
    expect(() => parseOpcuaAddress("s=Foo")).toThrow(/invalid OPC-UA nodeId/);
    expect(() => parseOpcuaAddress("ns=2;s=")).toThrow(/invalid OPC-UA nodeId/);
  });
});

describe("normalizeOpcuaValue", () => {
  it("null/undefined raw → bad", () => {
    expect(normalizeOpcuaValue(null, "float")).toEqual({ value: null, quality: "bad" });
    expect(normalizeOpcuaValue(undefined, "int")).toEqual({ value: null, quality: "bad" });
  });

  it("bool → Boolean", () => {
    expect(normalizeOpcuaValue(1, "bool")).toEqual({ value: true, quality: "good" });
    expect(normalizeOpcuaValue(0, "bool")).toEqual({ value: false, quality: "good" });
    expect(normalizeOpcuaValue(true, "bool")).toEqual({ value: true, quality: "good" });
  });

  it("int applies scale+offset then rounds", () => {
    // 12.3 * 10 + 5 = 128 → round 128
    expect(normalizeOpcuaValue(12.3, "int", 10, 5)).toEqual({ value: 128, quality: "good" });
    expect(normalizeOpcuaValue(7, "int")).toEqual({ value: 7, quality: "good" });
  });

  it("float applies scale+offset without rounding", () => {
    expect(normalizeOpcuaValue(2, "float", 1.5, 0.5)).toEqual({ value: 3.5, quality: "good" });
  });

  it("string → String", () => {
    expect(normalizeOpcuaValue(42, "string")).toEqual({ value: "42", quality: "good" });
    expect(normalizeOpcuaValue("hi", "string")).toEqual({ value: "hi", quality: "good" });
  });

  it("json parses string and serializes objects", () => {
    expect(normalizeOpcuaValue('{"a":1}', "json")).toEqual({ value: '{"a":1}', quality: "good" });
    expect(normalizeOpcuaValue({ a: 1 }, "json")).toEqual({ value: '{"a":1}', quality: "good" });
  });

  it("json invalid string → bad", () => {
    expect(normalizeOpcuaValue("not json", "json")).toEqual({ value: null, quality: "bad" });
  });

  it("non-numeric int/float → bad", () => {
    expect(normalizeOpcuaValue("abc", "int")).toEqual({ value: null, quality: "bad" });
    expect(normalizeOpcuaValue("abc", "float")).toEqual({ value: null, quality: "bad" });
  });
});
