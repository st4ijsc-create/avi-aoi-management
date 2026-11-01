/**
 * R1b-2b-2a T3F polish — ghim cong VITEST cua cho cat test-only trong commandDispatcher (setter VA reader).
 */
import { describe, expect, it } from "vitest";
import { __catSauGhiThietBiChoTest, catSauGhiThietBiChoTest } from "./commandDispatcher";

const KHE = Symbol.for("avi.ot.dispatch.catSauGhiThietBiChoTest");
const g = globalThis as Record<symbol, unknown>;

describe("T3F — cong VITEST cua cho cat test-only", () => {
  it("setter: NGOAI vitest tra false va KHONG dat khe toan cuc", () => {
    const cu = process.env.VITEST;
    delete process.env.VITEST;
    try {
      expect(__catSauGhiThietBiChoTest(async () => undefined)).toBe(false);
      expect(g[KHE]).toBeUndefined();
    } finally {
      if (cu !== undefined) process.env.VITEST = cu;
      __catSauGhiThietBiChoTest(null);
    }
    expect(process.env.VITEST).toBeTruthy();
    expect(g[KHE]).toBeUndefined();
  });

  it("reader: NGOAI vitest tra null du khe dang giu ham; trong vitest thi thay", () => {
    const cu = process.env.VITEST;
    const f = async () => undefined;
    try {
      expect(__catSauGhiThietBiChoTest(f)).toBe(true);
      expect(catSauGhiThietBiChoTest()).toBe(f);
      delete process.env.VITEST;
      expect(g[KHE]).toBe(f);
      expect(catSauGhiThietBiChoTest()).toBeNull();
    } finally {
      process.env.VITEST = cu ?? "true";
      __catSauGhiThietBiChoTest(null);
    }
    expect(catSauGhiThietBiChoTest()).toBeNull();
    expect(g[KHE]).toBeUndefined();
  });
});
