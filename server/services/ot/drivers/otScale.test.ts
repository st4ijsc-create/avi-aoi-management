/**
 * Sprint F4b — inverseScale helper tests (THUẦN, offline).
 *
 * inverseScale là nghịch đảo của normalizeOpcuaValue/decode+scale:
 *   read:  value = raw*scale+offset   →   write: raw = (value-offset)/scale
 */
import { describe, it, expect } from "vitest";
import { inverseScale } from "./otScale";

describe("inverseScale (F4b)", () => {
  it("int: raw = round((value-offset)/scale)", () => {
    // read: raw 50 *2 +0 = 100 → write 100 should give raw 50
    expect(inverseScale(100, "int", 2, 0)).toBe(50);
    // value 21, scale 10, offset 1 → (21-1)/10 = 2
    expect(inverseScale(21, "int", 10, 1)).toBe(2);
    // rounds
    expect(inverseScale(7, "int", 2, 0)).toBe(4); // 3.5 → 4
  });

  it("float: raw = (value-offset)/scale (no rounding)", () => {
    expect(inverseScale(21, "float", 10, 1)).toBeCloseTo(2.0, 6);
    expect(inverseScale(7, "float", 2, 0)).toBeCloseTo(3.5, 6);
  });

  it("bool / string / json are NOT inverse-scaled (returned as-is)", () => {
    expect(inverseScale(true, "bool", 10, 5)).toBe(true);
    expect(inverseScale("hello", "string", 10, 5)).toBe("hello");
    expect(inverseScale("x", "json", 10, 5)).toBe("x");
  });

  it("defaults scale=1 offset=0 → identity for int/float", () => {
    expect(inverseScale(42, "int")).toBe(42);
    expect(inverseScale(42.5, "float")).toBeCloseTo(42.5, 6);
  });

  it("scale=0 guarded (treated as 1, no divide-by-zero)", () => {
    expect(inverseScale(42, "float", 0, 0)).toBeCloseTo(42, 6);
  });

  it("round-trip with read (value*scale+offset → inverseScale)", () => {
    const raw = 7;
    const scale = 3;
    const offset = 2;
    const readValue = raw * scale + offset; // 23
    expect(inverseScale(readValue, "int", scale, offset)).toBe(raw);
  });
});
