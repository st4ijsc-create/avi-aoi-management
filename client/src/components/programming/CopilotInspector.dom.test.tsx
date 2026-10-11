// @vitest-environment jsdom
//
// doc 81 Đợt 3 Task 0 (D6, browser check 2026-10-05) — tab "Copilot" của inspector IR/POU bị cắt ở 1366 và 1600
// (IR 1329→1412 so với mép 1366: hiện "Copilo"): các tab của trang (vd "Xem trước transpile") đẩy nó ra ngoài panel
// 320 px, dải tab cuộn ngang KHÔNG có thanh cuộn. Hợp đồng: tab Copilot KHÔNG co (luôn đủ chữ); tab của trang co được
// (min-w-0) và cắt chữ có dấu "…" (truncate) kèm title đủ chữ. jsdom không dựng layout ⇒ khoá trên lớp; px thật đo
// bằng trình duyệt (báo cáo task 0).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string, d?: unknown) => (typeof d === "string" ? d : k) }) }));
vi.mock("@/components/programming/ProgrammingCopilotCore", () => ({ ProgrammingCopilotCore: () => <p>lõi copilot</p> }));

import { CopilotInspector } from "./CopilotInspector";
import { ProgrammingCopilotProvider } from "@/contexts/ProgrammingCopilotContext";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("CopilotInspector — dải tab không cắt tab Copilot", () => {
  it("tab Copilot shrink-0; tab của trang min-w-0 + nhãn truncate + title đủ chữ", () => {
    render(
      <ProgrammingCopilotProvider>
        <CopilotInspector
          idPrefix="ir-insp"
          label="Inspector / Transpile / Copilot"
          activeTab="inspector"
          onTabChange={() => undefined}
          binding={{}}
          tabs={[
            { id: "inspector", label: "Thuộc tính", content: <p>a</p> },
            { id: "preview", label: "Xem trước transpile", content: <p>b</p> },
          ]}
        />
      </ProgrammingCopilotProvider>,
    );
    const copilot = screen.getByRole("tab", { name: /Copilot/ });
    expect(copilot.className.split(/\s+/)).toContain("shrink-0");
    for (const name of ["Thuộc tính", "Xem trước transpile"]) {
      const tab = screen.getByRole("tab", { name });
      const cls = tab.className.split(/\s+/);
      expect(cls).toContain("min-w-0");
      expect(cls).not.toContain("shrink-0");
      expect(tab).toHaveAttribute("title", name);
      expect(tab.querySelector("span.truncate")?.textContent).toBe(name);
    }
  });
});

// doc 81 Đợt 7 task L fix 1 (b) — thanh trạng thái IDE/IR/POU: luồng Copilot đang chạy mà tab Copilot đang đóng/khuất ⇒
// mục "Copilot đang chạy" (spinner) bấm được để mở lại Copilot; không chạy ⇒ "Copilot ●/○" như cũ.
import { act, fireEvent } from "@testing-library/react";
import { CopilotStatusItem } from "./CopilotInspector";
import { useProgrammingCopilot } from "@/contexts/ProgrammingCopilotContext";

describe("L fix 1 (b) — CopilotStatusItem", () => {
  let api: ReturnType<typeof useProgrammingCopilot> | null = null;
  function Grab() { api = useProgrammingCopilot(); return null; }
  const setup = () => render(<ProgrammingCopilotProvider><Grab /><CopilotStatusItem /></ProgrammingCopilotProvider>);

  it("không chạy ⇒ 'Copilot ○' (đóng) / '●' (mở), không mục bận", () => {
    setup();
    expect(screen.queryByTestId("copilot-status-busy")).toBeNull();
    expect(screen.getByTestId("copilot-status")).toHaveTextContent("Copilot ○");
    act(() => api!.setOpen(true));
    expect(screen.getByTestId("copilot-status")).toHaveTextContent("Copilot ●");
  });

  it("đang chạy + Copilot đóng ⇒ 'Copilot đang chạy' bấm ⇒ mở Copilot", () => {
    setup();
    act(() => api!.setBusy("p1", true));
    const busy = screen.getByTestId("copilot-status-busy");
    expect(busy).toHaveTextContent("Copilot đang chạy");
    expect(api!.open).toBe(false);
    fireEvent.click(busy);
    expect(api!.open).toBe(true);
  });

  it("đang chạy + Copilot mở ⇒ vẫn báo đang chạy; hết chạy ⇒ về '●'", () => {
    setup();
    act(() => { api!.setOpen(true); api!.setBusy("p1", true); });
    expect(screen.getByTestId("copilot-status-busy")).toHaveTextContent("Copilot đang chạy");
    act(() => api!.setBusy("p1", false));
    expect(screen.queryByTestId("copilot-status-busy")).toBeNull();
    expect(screen.getByTestId("copilot-status")).toHaveTextContent("Copilot ●");
  });

  // doc 81 Đợt 7 final wave F7 — (a) the ONLY live region is a hidden line whose text changes with `busy`: the idle
  // "Copilot ●/○" toggle is not announced; (b) busy per SOURCE: one panel finishing does not clear another's "running".
  it("★ F7 (a) — vùng live CHỈ là dòng ẩn đổi chữ theo bận; mục hiển thị (●/○, nút bận) không nằm trong vùng live", () => {
    setup();
    const live = () => screen.getByTestId("copilot-status-live");
    expect(document.querySelectorAll("[role=status], [aria-live]")).toHaveLength(1);
    expect(live()).toHaveAttribute("role", "status");
    expect(live()).toHaveTextContent(/^$/);
    expect(screen.getByTestId("copilot-status").closest("[role=status], [aria-live]")).toBeNull();
    act(() => api!.setOpen(true)); // mở / đóng Copilot: KHÔNG được đọc
    expect(live()).toHaveTextContent(/^$/);
    act(() => api!.setBusy("p1", true)); // bắt đầu chạy: được đọc
    expect(live()).toHaveTextContent("Copilot đang chạy");
    expect(screen.getByTestId("copilot-status-busy").closest("[role=status], [aria-live]")).toBeNull();
    act(() => api!.setBusy("p1", false));
    expect(live()).toHaveTextContent(/^$/);
  });

  it("★ F7 (b) — hai panel cùng mount: một panel xong KHÔNG xoá 'đang chạy' của panel kia", () => {
    setup();
    act(() => { api!.setBusy("dock", true); api!.setBusy("inspector", true); });
    act(() => api!.setBusy("inspector", false)); // the LAST one to start finishes first
    expect(api!.busy).toBe(true);
    expect(screen.getByTestId("copilot-status-busy")).toBeInTheDocument();
    act(() => api!.setBusy("inspector", false)); // lặp lại: không đổi gì
    expect(api!.busy).toBe(true);
    act(() => api!.setBusy("dock", false));
    expect(api!.busy).toBe(false);
    expect(screen.queryByTestId("copilot-status-busy")).toBeNull();
  });
});
