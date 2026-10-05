// @vitest-environment jsdom
//
// Doc 81 Đợt 3 Task 1 fix round 1 — Ruling R-3-c: tab KHÔNG được chọn phải ẨN thật (thuộc tính `hidden` ⇒ display:none,
// không chiếm chỗ, không lộ cho công nghệ hỗ trợ). Lỗi cũ: TabbedHub truyền `hidden={undefined}` cho tab thường; Radix
// TabsContent rải `...props` SAU `hidden: !present` ⇒ `undefined` xoá thuộc tính hidden ⇒ mỗi tab không chọn thành một
// hộp rỗng `mt-2` (8 px) hiện ra (thấy trên Integration: MAIN cao thêm 8 px mỗi tab ẩn).
// Tab `keepMounted` vẫn GIỮ instance (nội dung còn mount) và ẩn bằng `hidden` như trước.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { TabbedHub, type TabbedHubTab } from "./TabbedHub";

afterEach(() => {
  cleanup();
  mounts.keep = 0;
});

const mounts = { keep: 0 };
function A() { return <p>noi dung A</p>; }
function B() { return <p>noi dung B</p>; }
function Keep() {
  React.useEffect(() => { mounts.keep++; }, []);
  return <p>noi dung giu</p>;
}
const TABS: TabbedHubTab[] = [
  { value: "a", labelKey: "x.a", fallback: "Tab A", Content: A },
  { value: "b", labelKey: "x.b", fallback: "Tab B", Content: B },
  { value: "keep", labelKey: "x.keep", fallback: "Tab Giu", Content: Keep, keepMounted: true },
];
function go(path = "/hub") {
  const loc = memoryLocation({ path, record: true });
  return render(
    <Router hook={loc.hook} searchHook={loc.searchHook}>
      <TabbedHub tabs={TABS} basePath="/hub" />
    </Router>,
  );
}
const panels = (c: HTMLElement) => [...c.querySelectorAll('[role="tabpanel"]')] as HTMLElement[];

describe("R-3-c — tab không chọn ẩn thật", () => {
  it("chỉ tab đang chọn hiện; tab thường không chọn có `hidden` và KHÔNG chiếm chỗ (display:none); chỉ một tabpanel nhìn thấy", () => {
    const { container } = go();
    const ps = panels(container);
    const visible = ps.filter((p) => !p.hasAttribute("hidden"));
    expect(visible).toHaveLength(1);
    expect(visible[0]).toHaveTextContent("noi dung A");
    for (const p of ps.filter((x) => x !== visible[0])) {
      expect(p).toHaveAttribute("hidden");
      expect(getComputedStyle(p).display).toBe("none");
    }
    // công nghệ hỗ trợ chỉ thấy MỘT tabpanel
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
  });

  it("đổi tab: tab cũ ẩn lại (hidden), tab giữ instance vẫn mount một lần và ẩn bằng hidden", async () => {
    const user = userEvent.setup();
    const { container } = go("/hub?tab=keep");
    expect(mounts.keep).toBe(1);
    await user.click(screen.getByRole("tab", { name: "Tab B" }));
    const ps = panels(container);
    expect(ps.filter((p) => !p.hasAttribute("hidden")).map((p) => p.textContent)).toEqual(["noi dung B"]);
    const keep = ps.find((p) => p.textContent === "noi dung giu") as HTMLElement;
    expect(keep).toHaveAttribute("hidden");
    expect(mounts.keep).toBe(1);
    await user.click(screen.getByRole("tab", { name: "Tab Giu" }));
    expect(within(screen.getByRole("tabpanel")).getByText("noi dung giu")).toBeTruthy();
    expect(mounts.keep).toBe(1);
  });
});
