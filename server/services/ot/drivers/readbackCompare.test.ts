/**
 * Sprint G2.1 — readbackCompare helper tests (THUẦN, offline).
 */
import { describe, it, expect } from "vitest";
import { readbackMatches } from "./readbackCompare";

describe("readbackMatches", () => {
  it("float within tolerance → true; outside → false", () => {
    expect(readbackMatches(1.0, 1.0000005, "float", 1e-6)).toBe(true); // diff 5e-7 <= 1e-6
    expect(readbackMatches(1.0, 1.001, "float", 1e-6)).toBe(false);
    expect(readbackMatches(100.0, 100.0, "float")).toBe(true);
    // custom looser tolerance
    expect(readbackMatches(10, 10.4, "float", 0.5)).toBe(true);
    expect(readbackMatches(10, 10.6, "float", 0.5)).toBe(false);
  });

  it("int compares on round", () => {
    expect(readbackMatches(5, 5, "int")).toBe(true);
    expect(readbackMatches(5, 5.4, "int")).toBe(true); // round 5 === round 5
    expect(readbackMatches(5, 6, "int")).toBe(false);
  });

  it("bool compares Boolean", () => {
    expect(readbackMatches(true, true, "bool")).toBe(true);
    expect(readbackMatches(true, 1, "bool")).toBe(true);
    expect(readbackMatches(true, false, "bool")).toBe(false);
    expect(readbackMatches(false, 0, "bool")).toBe(true);
  });

  it("R1b-2b-1 T2 — bool: 'false' khớp false; 'off' không khớp gì", () => {
    expect(readbackMatches("false", false, "bool")).toBe(true);
    expect(readbackMatches("off", true, "bool")).toBe(false);
  });

  it("R1b-2b-1 T2 — bool cùng luật ghi / đọc: kỳ vọng theo boolTuGiaTri, đọc lại theo giaiMaBoolDoc; một bên ngoài luật ⇒ false", () => {
    expect(readbackMatches("0", 0, "bool")).toBe(true);
    expect(readbackMatches(" TRUE ", 255, "bool")).toBe(true); // thanh ghi khác 0 ⇒ TRUE
    expect(readbackMatches("off", false, "bool")).toBe(false); // trước: Boolean("off") = true ≠ false ⇒ false (đúng nhờ may); nay: ngoài luật
    expect(readbackMatches("off", "off", "bool")).toBe(false);
    expect(readbackMatches(true, "BAD 255", "bool")).toBe(false);
    expect(readbackMatches(false, "x", "bool")).toBe(false); // trước: Boolean("x") = true ≠ false; giờ "x" ngoài luật
    expect(readbackMatches(true, "x", "bool")).toBe(false); // trước: Boolean("x") = true ⇒ "khớp" sai
    expect(readbackMatches({}, true, "bool")).toBe(false); // trước: Boolean({}) = true ⇒ "khớp" sai
  });

  it("string compares String()", () => {
    expect(readbackMatches("RUN", "RUN", "string")).toBe(true);
    expect(readbackMatches("RUN", "STOP", "string")).toBe(false);
    expect(readbackMatches(42, "42", "string")).toBe(true);
  });

  it("json compares String()", () => {
    expect(readbackMatches('{"a":1}', '{"a":1}', "json")).toBe(true);
    expect(readbackMatches('{"a":1}', '{"a":2}', "json")).toBe(false);
  });

  it("actual null/undefined → false (cannot verify)", () => {
    expect(readbackMatches(1, null, "float")).toBe(false);
    expect(readbackMatches(1, undefined, "int")).toBe(false);
    expect(readbackMatches(true, null, "bool")).toBe(false);
    expect(readbackMatches("x", null, "string")).toBe(false);
  });

  it("NaN → false", () => {
    expect(readbackMatches(NaN, 1, "float")).toBe(false);
    expect(readbackMatches(1, NaN, "float")).toBe(false);
    expect(readbackMatches(NaN, 1, "int")).toBe(false);
  });

  it("R1b-2b-1 T6 — int scale 0.1 / 0.5: so ở số thô (Review Focus 5)", () => {
    expect(readbackMatches(2.3, 2.4, "int", 1e-6, { scale: 0.1 })).toBe(false);
    expect(readbackMatches(2.5, 3.0, "int", 1e-6, { scale: "0.5", offset: null })).toBe(false);
    expect(readbackMatches(2.5, 2.5, "int", 1e-6, { scale: 0.5 })).toBe(true);
    expect(readbackMatches(30, 30, "int", 1e-6, { scale: 10, offset: 0 })).toBe(true);
    expect(readbackMatches(3, 3.4, "int")).toBe(true); // không thang đo ⇒ như cũ
    expect(readbackMatches(25, 25, "int", 1e-6, { scale: 0, offset: null })).toBe(true); // scale 0 ⇒ 1
    expect(readbackMatches(12, 12, "int", 1e-6, { scale: 2, offset: 10 })).toBe(true);
    expect(readbackMatches(12, 14, "int", 1e-6, { scale: 2, offset: 10 })).toBe(false);
  });

  it("R1b-2b-1 T6 — địa chỉ lớp bit: so theo luật bool bất kể dataType (STOP ghim 255 trên coil dataType int)", () => {
    const stop = { lopBit: true, dungGhim: true };
    expect(readbackMatches(255, 1, "int", 1e-6, undefined, stop)).toBe(true);
    expect(readbackMatches(255, true, "int", 1e-6, undefined, stop)).toBe(true);
    expect(readbackMatches(255, 0, "int", 1e-6, undefined, stop)).toBe(false);
    expect(readbackMatches(255, "x", "int", 1e-6, undefined, stop)).toBe(false);
    // không phải STOP đã xác minh: boolTuGiaTri(255) = undefined ⇒ lệch
    expect(readbackMatches(255, 1, "int", 1e-6, undefined, { lopBit: true })).toBe(false);
    expect(readbackMatches(1, 1, "int", 1e-6, undefined, { lopBit: true })).toBe(true);
    // không bit ⇒ như int thường (255 ≠ 1)
    expect(readbackMatches(255, 1, "int", 1e-6, undefined, { lopBit: false, dungGhim: true })).toBe(false);
  });
});
