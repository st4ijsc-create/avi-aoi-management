/**
 * Sprint F1.3 — eipTag helper tests (THUẦN, offline).
 */
import { describe, it, expect } from "vitest";
import { parseEipTag, coerceEipValue } from "./eipTag";

describe("parseEipTag", () => {
  it("controller-scope tag", () => {
    expect(parseEipTag("MyTag")).toEqual({ name: "MyTag", program: null });
  });

  it("UDT member and array index stay in name", () => {
    expect(parseEipTag("MyUDT.Member")).toEqual({ name: "MyUDT.Member", program: null });
    expect(parseEipTag("MyArray[3]")).toEqual({ name: "MyArray[3]", program: null });
  });

  it("program-scope tag", () => {
    expect(parseEipTag("Program:MainProgram.MyTag")).toEqual({
      name: "MyTag",
      program: "MainProgram",
    });
    expect(parseEipTag("Program:Prog1.UDT.Member")).toEqual({
      name: "UDT.Member",
      program: "Prog1",
    });
  });

  it("throws on invalid input", () => {
    expect(() => parseEipTag("")).toThrow();
    expect(() => parseEipTag("1bad")).toThrow();
    expect(() => parseEipTag("has space")).toThrow();
  });
});

describe("coerceEipValue", () => {
  it("null → bad; bool/int/float/string coercion", () => {
    expect(coerceEipValue(null, "int")).toEqual({ value: null, quality: "bad" });
    expect(coerceEipValue(1, "bool")).toEqual({ value: true, quality: "good" });
    expect(coerceEipValue(7.6, "int")).toEqual({ value: 8, quality: "good" });
    expect(coerceEipValue(2.5, "float")).toEqual({ value: 2.5, quality: "good" });
    expect(coerceEipValue(99, "string")).toEqual({ value: "99", quality: "good" });
  });

  it("NaN → bad", () => {
    expect(coerceEipValue(NaN, "float")).toEqual({ value: null, quality: "bad" });
  });
});
