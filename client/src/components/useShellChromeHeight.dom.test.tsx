// @vitest-environment jsdom
//
// doc 81 Đợt 7 task L fix 1 (c) — kiểm trình duyệt L4 @390/412: BottomNav cố định (64 px, chỉ điện thoại) che 64 px đáy
// của các màn workbench (IDE/IR/POU/Orchestration/Copilot) — kể cả thanh trạng thái — vì `--shell-chrome-h` chỉ tính chrome
// PHÍA TRÊN. Hợp đồng: `--shell-chrome-h` = chrome dọc mà trang phải chừa = các hàng chrome trên + thanh điều hướng đáy
// (`nav[data-app-chrome="bottom-nav"]`) khi nó có mặt; không có thanh đáy (desktop) ⇒ như cũ.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { useShellChromeHeight, SHELL_CHROME_VAR } from "./useShellChromeHeight";

function h(px: number) {
  return (el: HTMLElement | null) => {
    if (el) Object.defineProperty(el, "offsetHeight", { configurable: true, get: () => px });
  };
}

function Shell({ bottom }: { bottom: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useShellChromeHeight(ref, [bottom]);
  return (
    <>
      <div ref={ref} data-testid="inset">
        <header data-app-chrome="header" ref={h(56)} />
        <div data-shell-chrome-row="" ref={h(29)} />
        <main />
      </div>
      {bottom && <nav data-app-chrome="bottom-nav" ref={h(64)} />}
    </>
  );
}

afterEach(() => cleanup());

describe("L fix 1 (c) — --shell-chrome-h tính cả thanh điều hướng đáy của điện thoại", () => {
  it("có BottomNav ⇒ trên (56 + 29) + đáy 64 = 149 px", () => {
    const { getByTestId } = render(<Shell bottom />);
    expect(getByTestId("inset").style.getPropertyValue(SHELL_CHROME_VAR)).toBe("149px");
  });
  it("không có BottomNav (desktop) ⇒ chỉ chrome trên = 85 px (như cũ)", () => {
    const { getByTestId } = render(<Shell bottom={false} />);
    expect(getByTestId("inset").style.getPropertyValue(SHELL_CHROME_VAR)).toBe("85px");
  });
  it("BottomNav biến mất (đổi cỡ sang desktop) ⇒ đo lại, bỏ phần đáy", () => {
    const { getByTestId, rerender } = render(<Shell bottom />);
    expect(getByTestId("inset").style.getPropertyValue(SHELL_CHROME_VAR)).toBe("149px");
    rerender(<Shell bottom={false} />);
    expect(getByTestId("inset").style.getPropertyValue(SHELL_CHROME_VAR)).toBe("85px");
  });
});
