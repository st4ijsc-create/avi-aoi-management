import { describe, it, expect } from "vitest";
import { tomTatDiff } from "./tomTatDiff";

describe("tomTatDiff", () => {
  it("★★★ thêm dòng", () => {
    expect(tomTatDiff("a\nb\n", "a\nb\nc\n")).toEqual({ them: 1, bot: 0, doiDong: true });
  });
  it("★★★ bớt dòng", () => {
    expect(tomTatDiff("a\nb\nc\n", "a\nb\n")).toEqual({ them: 0, bot: 1, doiDong: true });
  });
  it("★★★ sửa một dòng = 1 thêm + 1 bớt", () => {
    expect(tomTatDiff("a\nb\n", "a\nB\n")).toEqual({ them: 1, bot: 1, doiDong: true });
  });
  it("★★ không đổi gì ⇒ 0/0 và doiDong=false", () => {
    expect(tomTatDiff("a\nb\n", "a\nb\n")).toEqual({ them: 0, bot: 0, doiDong: false });
  });
  it("★★ CRLF không bị tính là khác biệt giả", () => {
    expect(tomTatDiff("a\r\nb\r\n", "a\nb\n")).toEqual({ them: 0, bot: 0, doiDong: false });
  });
});
