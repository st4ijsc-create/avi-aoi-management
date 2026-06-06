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
});
