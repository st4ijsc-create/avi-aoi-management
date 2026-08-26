/**
 * ★★★ LƯỚI cho TAB ĐA-TỆP (`aiCodingTabs.ts`). Ca biên đóng-tab là chỗ dễ sai: đóng tab đang hoạt
 * động phải nhảy đúng tab kế; đóng tab cuối phải về `null`; đóng tab không-hoạt-động không được đổi
 * tab hoạt động. Đo THẲNG bằng `toEqual` — không qua render trang.
 */
import { describe, it, expect } from "vitest";
import { dongTab, moTab } from "./aiCodingTabs";

describe("§1 dongTab — đóng tab & chọn tab hoạt động kế tiếp", () => {
  it("★★★ đóng tab ĐANG hoạt động ở GIỮA ⇒ nhảy sang tab BÊN PHẢI", () => {
    expect(dongTab(["a", "b", "c"], "b", "b")).toEqual({ tabs: ["a", "c"], active: "c" });
  });

  it("★★★ đóng tab ĐANG hoạt động ở CUỐI ⇒ nhảy sang tab BÊN TRÁI (hết phải)", () => {
    expect(dongTab(["a", "b", "c"], "c", "c")).toEqual({ tabs: ["a", "b"], active: "b" });
  });

  it("★★★ đóng tab hoạt động DUY NHẤT ⇒ không còn tab, active = null", () => {
    expect(dongTab(["a"], "a", "a")).toEqual({ tabs: [], active: null });
  });

  it("★★ đóng tab KHÔNG hoạt động ⇒ tab hoạt động GIỮ NGUYÊN", () => {
    expect(dongTab(["a", "b", "c"], "a", "b")).toEqual({ tabs: ["b", "c"], active: "b" });
    expect(dongTab(["a", "b", "c"], "c", "b")).toEqual({ tabs: ["a", "b"], active: "b" });
  });

  it("★ đóng tab KHÔNG có trong danh sách ⇒ no-op (không đổi tabs lẫn active)", () => {
    expect(dongTab(["a", "b"], "x", "a")).toEqual({ tabs: ["a", "b"], active: "a" });
  });
});

describe("§2 moTab — mở tab (chống trùng, giữ thứ tự, có trần)", () => {
  it("★★ mở tệp MỚI ⇒ thêm ở CUỐI", () => {
    expect(moTab(["a", "b"], "c")).toEqual(["a", "b", "c"]);
  });

  it("★★★ mở tệp ĐÃ CÓ ⇒ KHÔNG trùng, KHÔNG đổi thứ tự (tab không nhảy chỗ)", () => {
    expect(moTab(["a", "b", "c"], "b")).toEqual(["a", "b", "c"]);
  });

  it("★★ vượt TRẦN ⇒ bỏ tab CŨ NHẤT ở đầu; tệp vừa mở luôn còn ở cuối", () => {
    const r = moTab(["a", "b", "c"], "d", 3);
    expect(r).toEqual(["b", "c", "d"]);
    expect(r).toContain("d");
    expect(r).not.toContain("a");
  });
});
