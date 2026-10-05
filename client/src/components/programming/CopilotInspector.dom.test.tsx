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
