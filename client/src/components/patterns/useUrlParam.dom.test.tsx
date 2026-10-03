// @vitest-environment jsdom
//
// Doc 81 Đợt 2 Task 10 — `useUrlParam(name)`: một tham số `?name=` của trang làm nguồn sự thật (đọc + ghi
// REPLACE, giữ mọi tham số khác). Trước task này là 4 bản chép tay (EquipmentIntegration, EquipmentStandards,
// InterlockRuleManagement, RecipeManagement); hai bản gộp tham số từ `search` của lần render (cũ nếu hai lần
// ghi nằm trong cùng một handler) ⇒ bản chung gộp từ `window.location.search` (luôn mới nhất).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { useUrlParam } from "./useUrlParam";

function Probe() {
  const [tab, setTab] = useUrlParam("tab");
  const [code, setCode] = useUrlParam("code");
  return (
    <div>
      <p data-testid="tab">{tab ?? "∅"}</p>
      <p data-testid="code">{code ?? "∅"}</p>
      <button type="button" onClick={() => setTab("params")}>tab=params</button>
      <button type="button" onClick={() => setTab(null)}>tab=null</button>
      <button type="button" onClick={() => setTab("")}>tab=empty</button>
      <button type="button" onClick={() => { setCode("R-1"); setTab("history"); }}>both</button>
    </div>
  );
}

beforeEach(() => {
  window.history.replaceState(null, "", "/page?keep=1&tab=overview");
});
afterEach(() => cleanup());

describe("useUrlParam", () => {
  it("đọc giá trị ?name= hiện tại; thiếu ⇒ null", () => {
    render(<Probe />);
    expect(screen.getByTestId("tab")).toHaveTextContent("overview");
    expect(screen.getByTestId("code")).toHaveTextContent("∅");
  });

  it("ghi = REPLACE (không thêm mục lịch sử), giữ tham số khác, giữ đường dẫn", async () => {
    const user = userEvent.setup();
    render(<Probe />);
    const before = window.history.length;
    await user.click(screen.getByRole("button", { name: "tab=params" }));
    expect(window.history.length).toBe(before);
    expect(window.location.pathname).toBe("/page");
    const p = new URLSearchParams(window.location.search);
    expect(p.get("tab")).toBe("params");
    expect(p.get("keep")).toBe("1");
    expect(screen.getByTestId("tab")).toHaveTextContent("params");
  });

  it("null hoặc chuỗi rỗng ⇒ xoá tham số; hết tham số ⇒ URL không còn dấu ?", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/page?tab=overview");
    render(<Probe />);
    await user.click(screen.getByRole("button", { name: "tab=null" }));
    expect(window.location.search).toBe("");
    expect(window.location.href.endsWith("/page")).toBe(true);
    expect(screen.getByTestId("tab")).toHaveTextContent("∅");
    window.history.replaceState(null, "", "/page?tab=overview&keep=1");
    act(() => { window.dispatchEvent(new PopStateEvent("popstate")); });
    await user.click(screen.getByRole("button", { name: "tab=empty" }));
    expect(window.location.search).toBe("?keep=1");
  });

  it("hai lần ghi trong CÙNG một handler đều được giữ (gộp từ URL mới nhất, không từ search cũ của render)", async () => {
    const user = userEvent.setup();
    render(<Probe />);
    await user.click(screen.getByRole("button", { name: "both" }));
    const p = new URLSearchParams(window.location.search);
    expect(p.get("code")).toBe("R-1");
    expect(p.get("tab")).toBe("history");
    expect(p.get("keep")).toBe("1");
  });

  it("URL đổi từ bên ngoài (back/forward) ⇒ giá trị cập nhật", () => {
    render(<Probe />);
    act(() => {
      window.history.pushState(null, "", "/page?tab=alarms");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.getByTestId("tab")).toHaveTextContent("alarms");
  });
});
