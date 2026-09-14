import { describe, expect, it } from "vitest";

import { coCoDoTrongUrl, laCheDoDo } from "./cheDoDo";

describe("cheDoDo — cửa sổ đo chỉ mở khi DEV hoặc ?do=1 (Đợt 47)", () => {
  it("?do=1 ⇒ mở; thiếu / giá trị khác ⇒ đóng", () => {
    expect(coCoDoTrongUrl("?do=1")).toBe(true);
    expect(coCoDoTrongUrl("?pv=line:2&do=1&cam=1,2,3")).toBe(true);
    expect(coCoDoTrongUrl("")).toBe(false);
    expect(coCoDoTrongUrl("?do=0")).toBe(false);
    expect(coCoDoTrongUrl("?do")).toBe(false);
    expect(coCoDoTrongUrl("?pv=line:2")).toBe(false);
  });

  it("prod (dev=false): quyết định theo URL; dev=true: luôn mở", () => {
    expect(laCheDoDo("?do=1", false)).toBe(true);
    expect(laCheDoDo("", false)).toBe(false);
    expect(laCheDoDo("", true)).toBe(true);
  });
});
