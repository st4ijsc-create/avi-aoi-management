import { describe, it, expect } from "vitest";
import { computeIsDirty } from "./engineeringBuffer";

describe("computeIsDirty", () => {
  it("không dirty khi buffer trùng nội dung bản đã lưu", () => {
    expect(computeIsDirty("PROG A", "PROG A")).toBe(false);
  });

  it("dirty khi buffer khác nội dung bản đã lưu", () => {
    expect(computeIsDirty("PROG A edited", "PROG A")).toBe(true);
  });

  it("coi content null/undefined như chuỗi rỗng", () => {
    expect(computeIsDirty("", null)).toBe(false);
    expect(computeIsDirty("", undefined)).toBe(false);
    expect(computeIsDirty("x", null)).toBe(true);
    expect(computeIsDirty("x", undefined)).toBe(true);
  });

  it("buffer rỗng nhưng bản đã lưu có nội dung → dirty (đã xóa hết)", () => {
    expect(computeIsDirty("", "PROG A")).toBe(true);
  });

  it("nhạy khoảng trắng (bản lưu khác 1 dấu cách)", () => {
    expect(computeIsDirty("a ", "a")).toBe(true);
  });
});
