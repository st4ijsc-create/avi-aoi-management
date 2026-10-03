// @vitest-environment jsdom
//
// Doc 81 Đợt 2 Task 2 — MỘT lối vào AI mỗi ngữ cảnh.
//  · Có top bar của shell (nút AI đã đăng ký): bong bóng chat KHÔNG còn nút nổi che MAIN; khung chat là
//    SHEET PHẢI nằm DƯỚI top bar (không đè top bar), Esc đóng.
//  · Không có shell (trang tự dựng không dùng DashboardLayout): giữ nút nổi cũ (không mất lối vào).
//  · Copilot lập trình (R-2-b): IDE (Task 13) và IR/POU (Task 14) đặt Copilot TRONG layout (inspector phải) — dock
//    `position:fixed` + `body.paddingRight` đã bị GỠ hẳn (Task 14); test tĩnh dưới đây canh không ai dựng lại nó.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { initLayoutKitTestI18n } from "@/components/patterns/layoutKitTestI18n";

vi.mock("@/components/programming/ProgrammingCopilotPanel", () => ({
  ProgrammingCopilotPanel: () => <div data-testid="copilot-engine" />,
}));

import { AiChatFrame } from "@/components/AiChatFrame";
import { resetAiEntryForTest } from "@/lib/aiEntryStore";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

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

// ── doc 81 Đợt 2 Task 14 (R-2-b) — KHÔNG còn dock Copilot cố định ở bất kỳ màn nào. IDE (Task 13) rồi IR/POU (Task 14) đặt
// Copilot TRONG layout (inspector phải, lõi dùng chung `ProgrammingCopilotCore`) ⇒ dock `ProgrammingCopilotDock`
// (aside position:fixed + tab dọc nổi + body.paddingRight) thành mã chết và bị gỡ. Thay các test hành vi của dock (đã gỡ
// cùng component) bằng canh tĩnh: không tệp, không mount ở App, không mã nào đẩy trang bằng body.paddingRight, binding
// không còn cờ `inLayout` (chỉ dock đọc nó). Lõi dùng chung vẫn được test hành vi ngay dưới. ──
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("R-2-b (Task 14) — không còn dock Copilot cố định", () => {
  it("không tệp ProgrammingCopilotDock, App không mount dock, không mã nào đặt body.paddingRight, binding không còn inLayout", () => {
    expect(existsSync("client/src/components/programming/ProgrammingCopilotDock.tsx")).toBe(false);
    expect(readFileSync("client/src/App.tsx", "utf8")).not.toMatch(/ProgrammingCopilotDock/);
    const offenders = sourceFiles("client/src").filter((f) => {
      const src = readFileSync(f, "utf8");
      return /ProgrammingCopilotDock["'\s;,)]/.test(src.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "")) || /body\.style\.paddingRight\s*=/.test(src);
    });
    expect(offenders).toEqual([]);
    expect(readFileSync("client/src/contexts/ProgrammingCopilotContext.tsx", "utf8")).not.toMatch(/inLayout\??:/);
  });
});

import { ProgrammingCopilotCore } from "@/components/programming/ProgrammingCopilotCore";

describe("ProgrammingCopilotCore — lõi dùng chung (IDE / IR / POU)", () => {
  it("ProgrammingCopilotCore vẽ chẩn đoán + nút Giải thích/Đề xuất sửa + engine (cùng thân với dock)", async () => {
    render(<ProgrammingCopilotCore binding={{ surfaceLabel: "IDE", diagnostics: [{ message: "L2: lỗi A", severity: "error" }], onApply: () => {} }} />);
    expect(screen.getByText("L2: lỗi A")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Giải thích lỗi/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Đề xuất sửa/ })).toBeInTheDocument();
    expect(await screen.findByTestId("copilot-engine")).toBeInTheDocument();
  });
});
