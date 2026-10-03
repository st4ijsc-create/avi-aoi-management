// @vitest-environment jsdom
//
// Doc 81 Đợt 2 Task 3 — EngineeringShell (P1 Workbench của IDE/IR/POU, doc 81 §1.3): activity bar
// 40 · explorer 240–300 · tab editor · inspector 320–420 · panel dưới 180–320 · thanh trạng thái 24,
// dựng trên WorkbenchShell. Ca ở đây khoá phần RIÊNG của EngineeringShell: activity bar (bàn phím,
// gập explorer), tab editor (bàn phím, dấu chưa lưu, đóng tab) và dấu đo (MAIN = editor; tab strip
// và inspector/Copilot NGOÀI MAIN).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("react-resizable-panels", async () => (await import("@/components/patterns/layoutKitTestPanels")).browserPanels());
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import VI from "@/i18n/locales/vi.json";
import { initLayoutKitTestI18n } from "@/components/patterns/layoutKitTestI18n";
import { installMatchMedia, presetNarrow, setNarrow } from "@/components/patterns/layoutKitTestMedia";
import { EngineeringShell, type EngineeringShellProps } from "./EngineeringShell";

beforeAll(async () => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  installMatchMedia();
  await initLayoutKitTestI18n();
});
beforeEach(() => presetNarrow(false));
afterEach(() => cleanup());

function renderShell(over: Partial<EngineeringShellProps> = {}) {
  const onActivityChange = vi.fn();
  const onTabChange = vi.fn();
  const onTabClose = vi.fn();
  render(
    <main>
      <EngineeringShell
        layoutId="ide"
        userId={3}
        activityItems={[
          { id: "projects", label: "Dự án", icon: <svg /> },
          { id: "versions", label: "Phiên bản", icon: <svg /> },
          { id: "deploy", label: "Triển khai", icon: <svg /> },
        ]}
        activeActivity="projects"
        onActivityChange={onActivityChange}
        explorer={<p>cây dự án</p>}
        editorTabs={[
          { id: "main", label: "Main.bas", dirty: true, closable: true },
          { id: "diff", label: "Δ v1↔v2", closable: true },
          { id: "tags", label: "Tags" },
        ]}
        activeTabId="main"
        onTabChange={onTabChange}
        onTabClose={onTabClose}
        editor={<div className="cm-editor">mã nguồn</div>}
        inspector={<p>copilot</p>}
        inspectorLabel="Copilot"
        inspectorIsAi
        bottomPanel={<p>vấn đề</p>}
        bottomLabel="Vấn đề"
        statusBar={<span>Ln 1, Col 1</span>}
        {...over}
      />
    </main>,
  );
  return { onActivityChange, onTabChange, onTabClose };
}

const mainEl = () => document.querySelector("[data-layout-main]") as HTMLElement;

describe("EngineeringShell — dấu đo", () => {
  // Ruling R-2-s (Task 13 fix round 1): dải tab editor nằm TRONG MAIN, là thanh công cụ DUY NHẤT `data-layout-toolbar`
  // (≤56 px) của vùng làm việc — trước đây nó nằm ngoài MAIN và thiết bị đo đếm nó là 1 "banner" giữa h1 và MAIN.
  it("MAIN = tab strip (toolbar duy nhất) + editor; activity bar, explorer, Copilot, thanh trạng thái NGOÀI MAIN", () => {
    renderShell();
    expect(mainEl()).toHaveTextContent("mã nguồn");
    expect(mainEl().closest("main")).not.toBeNull();
    const tablist = screen.getByRole("tablist", { name: VI.layoutKit.shell.editorTabs });
    expect(mainEl()).toContainElement(tablist);
    const toolbars = mainEl().querySelectorAll("[data-layout-toolbar]");
    expect(toolbars).toHaveLength(1);
    expect(toolbars[0]).toContainElement(tablist);
    expect(parseInt((toolbars[0] as HTMLElement).style.height, 10)).toBeLessThanOrEqual(56);
    expect(mainEl()).not.toContainElement(screen.getByRole("toolbar", { name: VI.layoutKit.shell.activityBar }));
    expect(mainEl()).not.toContainElement(screen.getByText("cây dự án"));
    expect(mainEl()).not.toContainElement(screen.getByText("Ln 1, Col 1"));
    const copilot = screen.getByRole("complementary", { name: "Copilot" });
    expect(copilot).toHaveAttribute("data-layout-ai");
    expect(mainEl()).not.toContainElement(copilot);
  });

  it("vùng editor (trong MAIN, dưới toolbar) là tabpanel của tab đang chọn; tablist không nằm trong tabpanel", () => {
    renderShell();
    const tab = screen.getByRole("tab", { name: /Main\.bas/ });
    const panel = screen.getByRole("tabpanel");
    expect(mainEl()).toContainElement(panel);
    expect(panel).toHaveAttribute("aria-labelledby", tab.id);
    expect(tab).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveTextContent("mã nguồn");
    expect(panel).not.toContainElement(screen.getByRole("tablist", { name: VI.layoutKit.shell.editorTabs }));
  });

  it("editorToolbarEnd (điều khiển riêng của tab, vd chọn bản so sánh) nằm TRONG cùng một toolbar", () => {
    renderShell({ editorToolbarEnd: <button type="button">Chọn bản</button> });
    const toolbars = mainEl().querySelectorAll("[data-layout-toolbar]");
    expect(toolbars).toHaveLength(1);
    expect(toolbars[0]).toContainElement(screen.getByRole("button", { name: "Chọn bản" }));
  });

  // Task 14 — IR/POU giữ tên MAIN đã hiệu chuẩn (R-2-k: `ir-canvas`, `pou-editor`); mặc định vẫn `${layoutId}-editor`.
  it("mainName đặt giá trị data-layout-main; không truyền ⇒ `${layoutId}-editor`", () => {
    renderShell();
    expect(mainEl()).toHaveAttribute("data-layout-main", "ide-editor");
    cleanup();
    renderShell({ mainName: "ir-canvas" });
    expect(mainEl()).toHaveAttribute("data-layout-main", "ir-canvas");
    expect(document.querySelectorAll("[data-layout-main]")).toHaveLength(1);
  });
});

describe("EngineeringShell — activity bar 40 px", () => {
  it("toolbar dọc 40 px; mục đang chọn aria-pressed; bấm mục khác ⇒ onActivityChange", () => {
    const { onActivityChange } = renderShell();
    const bar = screen.getByRole("toolbar", { name: VI.layoutKit.shell.activityBar });
    expect(bar).toHaveAttribute("aria-orientation", "vertical");
    expect(bar.style.width).toBe("40px");
    expect(within(bar).getByRole("button", { name: "Dự án" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(bar).getByRole("button", { name: "Phiên bản" }));
    expect(onActivityChange).toHaveBeenCalledWith("versions");
  });

  it("phím ↓/↑ chuyển focus giữa các mục (roving tabindex)", async () => {
    const user = userEvent.setup();
    renderShell();
    const bar = screen.getByRole("toolbar", { name: VI.layoutKit.shell.activityBar });
    const [a, b, c] = within(bar).getAllByRole("button");
    expect(a).toHaveAttribute("tabindex", "0");
    expect(b).toHaveAttribute("tabindex", "-1");
    a.focus();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(b);
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(c);
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(a);
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(c);
  });

  it("bấm lại mục đang chọn ⇒ gập explorer (panel trái về 0); bấm lần nữa ⇒ mở lại", () => {
    renderShell();
    const btn = screen.getByRole("button", { name: "Dự án" });
    const leftPanel = () => document.querySelector("[data-workbench-left]")!.closest("[data-panel]") as HTMLElement;
    expect(Number(leftPanel().getAttribute("data-panel-size"))).toBeGreaterThan(0);
    fireEvent.click(btn);
    expect(Number(leftPanel().getAttribute("data-panel-size"))).toBe(0);
    expect(btn).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(btn);
    expect(Number(leftPanel().getAttribute("data-panel-size"))).toBeGreaterThan(0);
    expect(btn).toHaveAttribute("aria-expanded", "true");
  });
});

describe("EngineeringShell — tab editor", () => {
  it("tablist có nhãn; tab chọn aria-selected; tab chưa lưu báo 'chưa lưu'", () => {
    renderShell();
    const list = screen.getByRole("tablist", { name: VI.layoutKit.shell.editorTabs });
    const main = within(list).getByRole("tab", { name: /Main\.bas/ });
    expect(main).toHaveAttribute("aria-selected", "true");
    expect(main).toHaveTextContent(VI.layoutKit.shell.unsavedTab);
    expect(within(list).getByRole("tab", { name: "Tags" })).toHaveAttribute("aria-selected", "false");
  });

  it("phím →/← chuyển tab (onTabChange), Home/End về đầu/cuối", async () => {
    const user = userEvent.setup();
    const { onTabChange } = renderShell();
    screen.getByRole("tab", { name: /Main\.bas/ }).focus();
    await user.keyboard("{ArrowRight}");
    expect(onTabChange).toHaveBeenLastCalledWith("diff");
    await user.keyboard("{End}");
    expect(onTabChange).toHaveBeenLastCalledWith("tags");
    await user.keyboard("{ArrowLeft}");
    expect(onTabChange).toHaveBeenLastCalledWith("diff");
    await user.keyboard("{Home}");
    expect(onTabChange).toHaveBeenLastCalledWith("main");
    await user.keyboard("{ArrowLeft}");
    expect(onTabChange).toHaveBeenLastCalledWith("tags");
  });

  it("nút đóng tab có nhãn riêng; chỉ tab closable có nút", () => {
    const { onTabClose, onTabChange } = renderShell();
    fireEvent.click(screen.getByRole("button", { name: "Đóng tab Δ v1↔v2" }));
    expect(onTabClose).toHaveBeenCalledWith("diff");
    expect(onTabChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Đóng tab Tags" })).toBeNull();
  });
});

// ── Fix round 1 (review I4) — activity bar KHÔNG mất dưới 1024 px ────────────────────────────────
describe("EngineeringShell — màn hẹp", () => {
  it("activity bar vẫn hiện; chọn mục khác ⇒ onActivityChange + chuyển sang tab explorer", () => {
    presetNarrow(true);
    const { onActivityChange } = renderShell();
    const bar = screen.getByRole("toolbar", { name: VI.layoutKit.shell.activityBar });
    expect(bar).toBeVisible();
    expect(screen.getByRole("tab", { name: VI.layoutKit.shell.editor })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(within(bar).getByRole("button", { name: "Phiên bản" }));
    expect(onActivityChange).toHaveBeenCalledWith("versions");
    expect(screen.getByRole("tab", { name: VI.layoutKit.shell.explorer })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("cây dự án")).toBeVisible();
  });

  it("đổi rộng→hẹp→rộng khi đang mở: activity bar còn, MAIN vẫn là editor", () => {
    renderShell();
    setNarrow(true);
    expect(screen.getByRole("toolbar", { name: VI.layoutKit.shell.activityBar })).toBeInTheDocument();
    setNarrow(false);
    expect(screen.getByRole("toolbar", { name: VI.layoutKit.shell.activityBar })).toBeInTheDocument();
    expect(mainEl()).toHaveTextContent("mã nguồn");
  });
});

// ── Fix round 2 (re-review) — ở màn hẹp, bấm mục đang chọn KHÔNG gập explorer của màn rộng ──────
describe("EngineeringShell — màn hẹp không đụng trạng thái gập của màn rộng", () => {
  it("hẹp: bấm lại 'Dự án' (đang chọn) ⇒ sang rộng explorer VẪN mở", () => {
    presetNarrow(true);
    renderShell();
    const bar = screen.getByRole("toolbar", { name: VI.layoutKit.shell.activityBar });
    fireEvent.click(within(bar).getByRole("button", { name: "Dự án" }));
    fireEvent.click(within(bar).getByRole("button", { name: "Dự án" }));
    fireEvent.click(within(bar).getByRole("button", { name: "Dự án" }));
    expect(screen.getByRole("tab", { name: VI.layoutKit.shell.explorer })).toHaveAttribute("aria-selected", "true");
    setNarrow(false);
    const leftPanel = document.querySelector("[data-workbench-left]")!.closest("[data-panel]") as HTMLElement;
    expect(Number(leftPanel.getAttribute("data-panel-size"))).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Dự án" })).toHaveAttribute("aria-expanded", "true");
  });
});

// ── doc 81 Đợt 2 Task 13 — IDE cần kích thước px riêng cho panel, ý định mở panel dưới, và mở tab Inspector ở màn hẹp ──
describe("EngineeringShell — tuỳ chọn cho trang IDE (Task 13)", () => {
  it("bottomOpenRequest đổi ⇒ panel dưới (gập lúc đầu) MỞ; onBottomCollapsedChange báo trạng thái", () => {
    const seen: boolean[] = [];
    const onBottomCollapsedChange = (c: boolean) => seen.push(c);
    const props = { bottomDefaultCollapsed: true, onBottomCollapsedChange };
    const { rerender } = renderShellRerender({ ...props, bottomOpenRequest: 0 });
    const toggle = screen.getByRole("button", { name: VI.layoutKit.shell.toggleBottom });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    rerender({ ...props, bottomOpenRequest: 1 });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(seen[seen.length - 1]).toBe(false);
  });

  it("explorerSize / inspectorSize / bottomSize chuyển xuống WorkbenchShell (đích px, khung 1600×800)", () => {
    const original = HTMLElement.prototype.getBoundingClientRect;
    const spy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute("data-workbench-group")) return DOMRect.fromRect({ x: 0, y: 0, width: 1600, height: 800 });
      return original.call(this);
    });
    try {
      renderShell({ explorerSize: { minPx: 200, maxPx: 280, defaultPx: 220 }, inspectorSize: { minPx: 300, maxPx: 400, defaultPx: 310 }, bottomSize: { minPx: 150, maxPx: 300, defaultPx: 170 } });
      const px = (id: string, g: number) => (Number((document.querySelector(`[data-panel-id="${id}"]`) as HTMLElement).getAttribute("data-panel-size")) * g) / 100;
      expect(Math.abs(px("left", 1600) - 220)).toBeLessThanOrEqual(2.2);
      expect(Math.abs(px("right", 1600) - 310)).toBeLessThanOrEqual(3.1);
      expect(Math.abs(px("bottom", 800) - 170)).toBeLessThanOrEqual(1.7);
    } finally {
      spy.mockRestore();
    }
  });

  it("màn hẹp: inspectorRevealToken đổi ⇒ chuyển sang tab Inspector", () => {
    presetNarrow(true);
    const { rerender } = renderShellRerender({ inspectorRevealToken: 0 });
    expect(screen.getByRole("tab", { name: "Copilot" })).toHaveAttribute("aria-selected", "false");
    rerender({ inspectorRevealToken: 1 });
    expect(screen.getByRole("tab", { name: "Copilot" })).toHaveAttribute("aria-selected", "true");
  });
});

function renderShellRerender(over: Partial<EngineeringShellProps>) {
  const base = (o: Partial<EngineeringShellProps>) => (
    <main>
      <EngineeringShell
        layoutId="ide-t13"
        userId={3}
        activityItems={[{ id: "projects", label: "Dự án", icon: <svg /> }]}
        activeActivity="projects"
        onActivityChange={() => {}}
        explorer={<p>cây dự án</p>}
        editorTabs={[{ id: "main", label: "Main.bas" }]}
        activeTabId="main"
        onTabChange={() => {}}
        editor={<div className="cm-editor">mã nguồn</div>}
        inspector={<p>copilot</p>}
        inspectorLabel="Copilot"
        bottomPanel={<p>vấn đề</p>}
        bottomLabel="Vấn đề"
        {...o}
      />
    </main>
  );
  const r = render(base(over));
  return { rerender: (o: Partial<EngineeringShellProps>) => r.rerender(base(o)) };
}
