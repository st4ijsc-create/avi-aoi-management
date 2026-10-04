// @vitest-environment jsdom
//
// doc 81 Đợt 2 final wave M-3 — khoá nhớ trạng thái Copilot đổi tên `progCopilotDock.open` → `progCopilot.open`
// (không còn "dock"); lựa chọn đã lưu ở khoá cũ vẫn được đọc một lần, ghi mới thì dọn khoá cũ. API chết
// openDock/closeDock đã bỏ.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { ProgrammingCopilotProvider, useProgrammingCopilot } from "./ProgrammingCopilotContext";

let api: ReturnType<typeof useProgrammingCopilot> | null = null;
function Probe() {
  api = useProgrammingCopilot();
  return <span data-open={api.open ? "1" : "0"} />;
}
const mount = () => render(<ProgrammingCopilotProvider><Probe /></ProgrammingCopilotProvider>);

beforeEach(() => { window.localStorage.clear(); api = null; });
afterEach(() => cleanup());

describe("ProgrammingCopilotContext — khoá nhớ trạng thái mở", () => {
  it("khoá mới '1' ⇒ mở", () => {
    window.localStorage.setItem("progCopilot.open", "1");
    mount();
    expect(api!.open).toBe(true);
  });

  it("chỉ có khoá CŨ '1' (người dùng trước khi đổi tên) ⇒ vẫn mở; khoá mới thắng khi có cả hai", () => {
    window.localStorage.setItem("progCopilotDock.open", "1");
    mount();
    expect(api!.open).toBe(true);
    cleanup();
    window.localStorage.setItem("progCopilot.open", "0");
    mount();
    expect(api!.open).toBe(false);
  });

  it("setOpen ghi khoá mới và dọn khoá cũ; không còn openDock/closeDock", () => {
    window.localStorage.setItem("progCopilotDock.open", "1");
    mount();
    act(() => api!.setOpen(false));
    expect(window.localStorage.getItem("progCopilot.open")).toBe("0");
    expect(window.localStorage.getItem("progCopilotDock.open")).toBeNull();
    expect(Object.keys(api!)).not.toContain("openDock");
    expect(Object.keys(api!)).not.toContain("closeDock");
  });
});
