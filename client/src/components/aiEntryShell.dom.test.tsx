// @vitest-environment jsdom
//
// Doc 81 Đợt 2 Task 2 — MỘT lối vào AI mỗi ngữ cảnh.
//  · Có top bar của shell (nút AI đã đăng ký): bong bóng chat KHÔNG còn nút nổi che MAIN; khung chat là
//    SHEET PHẢI nằm DƯỚI top bar (không đè top bar), Esc đóng.
//  · Không có shell (trang tự dựng không dùng DashboardLayout): giữ nút nổi cũ (không mất lối vào).
//  · Dock Copilot (giữ trên IDE/IR/POU theo R-2-b): khi shell có nút AI thì bỏ tab dọc nổi (lối vào thứ
//    hai, che MAIN); dock mở ở chế độ chiếm màn (< 900 px) không đè top bar.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { initLayoutKitTestI18n } from "@/components/patterns/layoutKitTestI18n";

vi.mock("@/components/programming/ProgrammingCopilotPanel", () => ({
  ProgrammingCopilotPanel: () => <div data-testid="copilot-engine" />,
}));

import { AiChatFrame } from "@/components/AiChatFrame";
import { ProgrammingCopilotDock } from "@/components/programming/ProgrammingCopilotDock";
import { ProgrammingCopilotProvider, useCopilotBinding } from "@/contexts/ProgrammingCopilotContext";
import { registerAiHeaderEntry, resetAiEntryForTest } from "@/lib/aiEntryStore";

beforeAll(async () => {
  await initLayoutKitTestI18n();
});
beforeEach(() => {
  resetAiEntryForTest();
  localStorage.clear();
});
afterEach(() => cleanup());

const PANEL = <div data-testid="chat-panel">panel</div>;

describe("AiChatFrame — khung bong bóng chat", () => {
  it("có nút AI trên top bar: KHÔNG nút nổi; đóng ⇒ không có gì cố định trên màn", () => {
    render(<AiChatFrame headerEntry open={false} onOpenChange={() => {}} panel={PANEL} fab={<button type="button">FAB</button>} minimizedBar={null} />);
    expect(screen.queryByRole("button", { name: "FAB" })).toBeNull();
    expect(screen.queryByTestId("chat-panel")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("mở ⇒ sheet phải (role=dialog) nằm DƯỚI top bar, chứa panel; Esc gọi đóng", () => {
    const onOpenChange = vi.fn();
    render(<AiChatFrame headerEntry open onOpenChange={onOpenChange} panel={PANEL} fab={null} minimizedBar={null} />);
    const dlg = screen.getByRole("dialog");
    expect(dlg).toContainElement(screen.getByTestId("chat-panel"));
    expect(dlg.className).toMatch(/(^|\s)top-14(\s|$)/);
    expect(dlg.className).not.toMatch(/(^|\s)inset-y-0(\s|$)/);
    expect(dlg).toHaveAttribute("data-ai-sheet");
    fireEvent.keyDown(dlg, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("M4 đóng bằng Esc ⇒ focus TRỞ VỀ nút AI của top bar", async () => {
    function Harness() {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <button type="button" data-shell-ai="chat" onClick={() => setOpen(true)}>AI</button>
          <AiChatFrame headerEntry open={open} onOpenChange={setOpen} panel={<input aria-label="hỏi" />} fab={null} minimizedBar={null} />
        </>
      );
    }
    render(<Harness />);
    const ai = screen.getByRole("button", { name: "AI" });
    fireEvent.click(ai);
    const dlg = screen.getByRole("dialog");
    act(() => (screen.getByRole("textbox", { name: "hỏi" }) as HTMLElement).focus());
    expect(document.activeElement).not.toBe(ai);
    fireEvent.keyDown(dlg, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(ai);
  });

  it("không có shell: giữ nút nổi cũ và panel nổi", () => {
    render(<AiChatFrame headerEntry={false} open onOpenChange={() => {}} panel={PANEL} fab={<button type="button">FAB</button>} minimizedBar={null} />);
    expect(screen.getByRole("button", { name: "FAB" })).toBeInTheDocument();
    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

function Bound({ children }: { children?: React.ReactNode }) {
  useCopilotBinding(() => ({ surfaceLabel: "IDE", diagnostics: [{ message: "x" }] }), []);
  return <>{children}</>;
}

describe("ProgrammingCopilotDock — giữ dock (R-2-b), bỏ lối vào thứ hai", () => {
  it("shell có nút AI ⇒ KHÔNG còn tab dọc nổi", () => {
    const off = registerAiHeaderEntry();
    render(
      <ProgrammingCopilotProvider>
        <Bound />
        <ProgrammingCopilotDock />
      </ProgrammingCopilotProvider>,
    );
    expect(screen.queryByRole("button", { name: "Mở Trợ lý Lập trình" })).toBeNull();
    act(() => off());
  });

  it("không có shell ⇒ tab dọc cũ vẫn là lối vào", () => {
    render(
      <ProgrammingCopilotProvider>
        <Bound />
        <ProgrammingCopilotDock />
      </ProgrammingCopilotProvider>,
    );
    expect(screen.getByRole("button", { name: "Mở Trợ lý Lập trình" })).toBeInTheDocument();
  });

  it("dock mở ở màn hẹp (chiếm màn) ⇒ nằm dưới top bar; màn rộng ⇒ đẩy trang (paddingRight) như cũ", () => {
    localStorage.setItem("progCopilotDock.open", "1");
    const w = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
    const off = registerAiHeaderEntry();
    render(
      <ProgrammingCopilotProvider>
        <Bound />
        <ProgrammingCopilotDock />
      </ProgrammingCopilotProvider>,
    );
    const aside = screen.getByRole("complementary", { name: "Trợ lý Lập trình" });
    expect(aside.className).toMatch(/(^|\s)top-14(\s|$)/);
    expect(document.body.style.paddingRight).toBe("");
    cleanup();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1600 });
    render(
      <ProgrammingCopilotProvider>
        <Bound />
        <ProgrammingCopilotDock />
      </ProgrammingCopilotProvider>,
    );
    expect(document.body.style.paddingRight).toBe("min(420px, 92vw)");
    Object.defineProperty(window, "innerWidth", { configurable: true, value: w });
    act(() => off());
  });
});
