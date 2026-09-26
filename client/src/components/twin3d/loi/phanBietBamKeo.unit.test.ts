import { describe, expect, it } from "vitest";

import { NGUONG_BAM_MS, NGUONG_BAM_PX, laBam, lechPx } from "./phanBietBamKeo";

describe("phanBietBamKeo — bấm ≠ kéo (Đợt 47 N2)", () => {
  it("ngưỡng có tên đúng brief: 4 px · 300 ms", () => {
    expect(NGUONG_BAM_PX).toBe(4);
    expect(NGUONG_BAM_MS).toBe(300);
  });

  it("bấm gọn (0 px, 80 ms) ⇒ bấm", () => {
    expect(laBam({ lechPx: 0, ms: 80 })).toBe(true);
  });

  it("dưới ngưỡng cả hai chiều (3,9 px · 299 ms) ⇒ bấm; chạm ngưỡng ⇒ KHÔNG", () => {
    expect(laBam({ lechPx: 3.9, ms: 299 })).toBe(true);
    expect(laBam({ lechPx: 4, ms: 100 })).toBe(false);
    expect(laBam({ lechPx: 1, ms: 300 })).toBe(false);
  });

  it("kéo xoay 200 px ⇒ không phải bấm dù nhanh", () => {
    expect(laBam({ lechPx: 200, ms: 120 })).toBe(false);
  });

  it("giữ chuột lâu (0 px, 900 ms) ⇒ không phải bấm", () => {
    expect(laBam({ lechPx: 0, ms: 900 })).toBe(false);
  });

  it("dữ liệu hỏng (NaN, âm, Infinity) ⇒ KHÔNG bấm — thà không điều hướng còn hơn nhầm", () => {
    expect(laBam({ lechPx: Number.NaN, ms: 10 })).toBe(false);
    expect(laBam({ lechPx: 1, ms: Number.NaN })).toBe(false);
    expect(laBam({ lechPx: -1, ms: 10 })).toBe(false);
    expect(laBam({ lechPx: 1, ms: -5 })).toBe(false);
    expect(laBam({ lechPx: Number.POSITIVE_INFINITY, ms: 10 })).toBe(false);
  });

  it("ngưỡng truyền tay được tôn trọng", () => {
    expect(laBam({ lechPx: 6, ms: 400 }, 10, 500)).toBe(true);
    expect(laBam({ lechPx: 6, ms: 400 }, 5, 500)).toBe(false);
  });

  it("lechPx là khoảng cách Euclid", () => {
    expect(lechPx({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(lechPx({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe(0);
  });
});
