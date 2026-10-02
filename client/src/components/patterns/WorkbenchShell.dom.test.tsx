// @vitest-environment jsdom
//
// Doc 81 Đợt 2 Task 3 — WorkbenchShell (P1/P2: explorer · MAIN · inspector · panel dưới · thanh
// trạng thái). Hợp đồng:
//   - MAIN mang `data-layout-main`, nằm trong <main>, KHÔNG chứa toolbar/thanh trạng thái/panel phụ;
//   - inspector là `role=complementary` NGOÀI MAIN (Copilot ⇒ thêm `data-layout-ai`);
//   - panel co giãn KÉO ĐƯỢC BẰNG BÀN PHÍM (separator + phím mũi tên) và kích thước được NHỚ THEO
//     NGƯỜI DÙNG (khoá có id người dùng; không biết người dùng ⇒ không lưu);
//   - panel dưới gập được mà KHÔNG unmount nội dung (Review Focus 3);
//   - dưới 1024 px ⇒ tab/stack, không panel cạnh nhau.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
// Bản BROWSER thật của react-resizable-panels (bản "node" vitest nhận không chạy layout effect) —
// xem layoutKitTestPanels.ts.
vi.mock("react-resizable-panels", async () => (await import("./layoutKitTestPanels")).browserPanels());
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import VI from "@/i18n/locales/vi.json";
import { initLayoutKitTestI18n } from "./layoutKitTestI18n";
import { WorkbenchShell, type WorkbenchShellProps } from "./WorkbenchShell";
import { pxRangeToPct, userLayoutKey } from "./layoutKitHooks";

let narrow = false;
beforeAll(async () => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.matchMedia = ((q: string) => ({
    matches: narrow && q.includes("max-width"),
    media: q,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  await initLayoutKitTestI18n();
});
beforeEach(() => {
  narrow = false;
  localStorage.clear();
});
afterEach(() => cleanup());

function Counter({ name }: { name: string }) {
  const [n, setN] = useState(0);
  return (
    <button type="button" onClick={() => setN(n + 1)}>
      {name} {n}
    </button>
  );
}

function renderShell(over: Partial<WorkbenchShellProps> = {}) {
  return render(
    <main>
      <WorkbenchShell
        layoutId="test-ide"
        userId={5}
        toolbar={<div>thanh công cụ</div>}
        left={{ label: "Explorer", content: <p>cây dự án</p> }}
        main={<textarea aria-label="editor" />}
        mainName="ide-editor"
        right={{ label: "Copilot", content: <p>trợ lý</p>, ai: true }}
        bottom={{ label: "Vấn đề", content: <Counter name="bottom" /> }}
        statusBar={<span>Ln 1</span>}
        {...over}
      />
    </main>,
  );
}

const mainEl = () => document.querySelector("[data-layout-main]") as HTMLElement;

describe("WorkbenchShell — dấu đo MAIN", () => {
  it("MAIN trong <main>, chứa editor, KHÔNG chứa toolbar/panel phụ/thanh trạng thái", () => {
    renderShell();
    const m = mainEl();
    expect(m).toHaveAttribute("data-layout-main", "ide-editor");
    expect(m.closest("main")).not.toBeNull();
    expect(m).toContainElement(screen.getByLabelText("editor"));
    for (const txt of ["thanh công cụ", "cây dự án", "trợ lý", "Ln 1"]) {
      expect(m).not.toContainElement(screen.getByText(txt));
    }
    expect(m).not.toContainElement(screen.getByRole("button", { name: "bottom 0" }));
    expect(document.querySelectorAll("[data-layout-main]")).toHaveLength(1);
  });

  it("inspector = complementary NGOÀI MAIN; ai ⇒ data-layout-ai", () => {
    renderShell();
    const aside = screen.getByRole("complementary", { name: "Copilot" });
    expect(aside).toHaveAttribute("data-layout-ai");
    expect(mainEl()).not.toContainElement(aside);
  });

  it("thanh trạng thái 24 px, toolbar 40 px", () => {
    renderShell();
    expect((screen.getByText("Ln 1").closest("[data-workbench-statusbar]") as HTMLElement).style.height).toBe("24px");
    expect((screen.getByText("thanh công cụ").closest("[data-workbench-toolbar]") as HTMLElement).style.height).toBe("40px");
  });
});

describe("WorkbenchShell — kéo bằng bàn phím + nhớ theo người dùng", () => {
  const leftHandle = () => screen.getByRole("separator", { name: VI.layoutKit.shell.resizeLeft });

  it("separator có nhãn; ArrowRight nới explorer, ArrowLeft thu lại", () => {
    renderShell();
    const h = leftHandle();
    const before = Number(h.getAttribute("aria-valuenow"));
    h.focus();
    fireEvent.keyDown(h, { key: "ArrowRight" });
    const after = Number(h.getAttribute("aria-valuenow"));
    expect(after).toBeGreaterThan(before);
    fireEvent.keyDown(h, { key: "ArrowLeft" });
    expect(Number(h.getAttribute("aria-valuenow"))).toBeLessThan(after);
  });

  it("panel phải và panel dưới cũng có separator bàn phím", () => {
    renderShell();
    expect(screen.getByRole("separator", { name: VI.layoutKit.shell.resizeRight })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("separator", { name: VI.layoutKit.shell.resizeBottom })).toHaveAttribute("tabindex", "0");
  });

  it("kích thước đã kéo được lưu theo id người dùng và khôi phục cho ĐÚNG người đó", async () => {
    const { unmount } = renderShell({ userId: 5 });
    const h = leftHandle();
    fireEvent.keyDown(h, { key: "ArrowLeft" });
    const resized = h.getAttribute("aria-valuenow");
    await waitFor(() => expect(Object.keys(localStorage).some((k) => k.includes(userLayoutKey("test-ide", 5, "h")!))).toBe(true));
    unmount();

    const r5 = renderShell({ userId: 5 });
    expect(leftHandle().getAttribute("aria-valuenow")).toBe(resized);
    r5.unmount();

    renderShell({ userId: 6 });
    expect(leftHandle().getAttribute("aria-valuenow")).not.toBe(resized);
  });

  it("không biết người dùng ⇒ không ghi gì vào localStorage", async () => {
    // Lượt ghi trễ (debounce ~100 ms) của ca trước có thể rơi vào ca này — chờ cho xong rồi mới xoá.
    await new Promise((r) => setTimeout(r, 250));
    localStorage.clear();
    renderShell({ userId: null });
    fireEvent.keyDown(leftHandle(), { key: "ArrowLeft" });
    await new Promise((r) => setTimeout(r, 250));
    expect(Object.keys(localStorage).filter((k) => k.includes("layoutKit"))).toEqual([]);
  });
});

describe("WorkbenchShell — panel dưới gập được, không mất state", () => {
  it("nút gập: aria-expanded đổi, panel về 0, nội dung VẪN mount (state giữ)", async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole("button", { name: "bottom 0" }));
    const toggle = screen.getByRole("button", { name: VI.layoutKit.shell.toggleBottom });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    const panel = document.querySelector("[data-workbench-bottom]")?.closest("[data-panel]") as HTMLElement;
    expect(Number(panel.getAttribute("data-panel-size"))).toBe(0);
    expect(screen.getByRole("button", { name: "bottom 1", hidden: true })).toBeInTheDocument();
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "bottom 1" })).toBeInTheDocument();
  });
});

describe("WorkbenchShell — dưới 1024 px chuyển sang tab", () => {
  it("không còn separator; có tablist; MAIN vẫn đánh dấu; panel phụ mở bằng tab, MAIN không unmount", async () => {
    narrow = true;
    const user = userEvent.setup();
    renderShell({ main: <Counter name="main" /> });
    expect(screen.queryAllByRole("separator")).toHaveLength(0);
    const tabs = screen.getByRole("tablist", { name: VI.layoutKit.shell.narrowLabel });
    expect(within(tabs).getAllByRole("tab").map((t) => t.textContent)).toEqual([VI.layoutKit.shell.editor, "Explorer", "Copilot", "Vấn đề"]);
    await user.click(screen.getByRole("button", { name: "main 0" }));
    expect(mainEl()).toContainElement(screen.getByRole("button", { name: "main 1" }));
    await user.click(within(tabs).getByRole("tab", { name: "Copilot" }));
    expect(screen.getByText("trợ lý")).toBeVisible();
    expect(screen.getByRole("button", { name: "main 1", hidden: true })).not.toBeVisible();
    await user.click(within(tabs).getByRole("tab", { name: VI.layoutKit.shell.editor }));
    expect(screen.getByRole("button", { name: "main 1" })).toBeVisible();
  });
});

describe("pxRangeToPct", () => {
  it("đổi px sang % theo bề rộng nhóm; chưa đo được ⇒ dùng fallback", () => {
    const fb = { minSize: 14, maxSize: 24, defaultSize: 18 };
    expect(pxRangeToPct({ minPx: 240, maxPx: 300, defaultPx: 260 }, 0, fb)).toBe(fb);
    const r = pxRangeToPct({ minPx: 240, maxPx: 300, defaultPx: 260 }, 1200, fb);
    expect(r.minSize).toBeCloseTo(20);
    expect(r.maxSize).toBeCloseTo(25);
    expect(r.defaultSize).toBeCloseTo(21.67, 1);
  });
});

