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
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { useEffect, useState } from "react";
import VI from "@/i18n/locales/vi.json";
import { initLayoutKitTestI18n } from "./layoutKitTestI18n";
import { WorkbenchShell, type WorkbenchShellProps } from "./WorkbenchShell";
import { pxRangeToPct, userLayoutKey } from "./layoutKitHooks";
import { installMatchMedia, presetNarrow, setNarrow } from "./layoutKitTestMedia";

beforeAll(async () => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  installMatchMedia();
  await initLayoutKitTestI18n();
});
beforeEach(() => {
  presetNarrow(false);
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

// ── Doc 81 Đợt 2 Task 5 fix round 1 — Ruling R-2-l: gập lần đầu, nhớ lựa chọn của người dùng, mở theo ý định ──
describe("WorkbenchShell — panel dưới: lần đầu gập, lựa chọn người dùng được nhớ, mở theo ý định (R-2-l)", () => {
  const KEY = "layoutKit:test-ide:u5:bottomCollapsed";
  const toggle = () => screen.getByRole("button", { name: VI.layoutKit.shell.toggleBottom });
  const bottomSize = () =>
    Number((document.querySelector("[data-workbench-bottom]")?.closest("[data-panel]") as HTMLElement).getAttribute("data-panel-size"));
  const bottomOf = (over: Partial<NonNullable<WorkbenchShellProps["bottom"]>> = {}) => ({
    bottom: { label: "Vấn đề", content: <Counter name="bottom" />, defaultCollapsed: true, ...over },
  });

  it("lần đầu (chưa nhớ gì) + defaultCollapsed ⇒ gập (kích thước 0), nội dung VẪN mount; không ghi gì vào bộ nhớ", () => {
    renderShell(bottomOf());
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(bottomSize()).toBe(0);
    expect(screen.getByRole("button", { name: "bottom 0", hidden: true })).toBeInTheDocument();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("người dùng MỞ bằng nút ⇒ nhớ '0'; lần sau (mount lại) KHÔNG bị gập lại dù defaultCollapsed", async () => {
    const user = userEvent.setup();
    const r = renderShell(bottomOf());
    await user.click(toggle());
    expect(localStorage.getItem(KEY)).toBe("0");
    r.unmount();
    renderShell(bottomOf());
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(bottomSize()).toBeGreaterThan(0);
  });

  it("người dùng GẬP (mặc định mở) ⇒ nhớ '1'; lần sau gập; người dùng KHÁC vẫn theo mặc định", async () => {
    const user = userEvent.setup();
    const r = renderShell(bottomOf({ defaultCollapsed: false }));
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    await user.click(toggle());
    expect(localStorage.getItem(KEY)).toBe("1");
    r.unmount();
    const r2 = renderShell(bottomOf({ defaultCollapsed: false }));
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(bottomSize()).toBe(0);
    r2.unmount();
    renderShell({ userId: 6, ...bottomOf({ defaultCollapsed: false }) });
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
  });

  it("gập bằng BÀN PHÍM trên separator (End — kéo hết xuống) cũng là lựa chọn của người dùng ⇒ nhớ", () => {
    renderShell(bottomOf({ defaultCollapsed: false }));
    fireEvent.keyDown(screen.getByRole("separator", { name: VI.layoutKit.shell.resizeBottom }), { key: "End" });
    expect(bottomSize()).toBe(0);
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(localStorage.getItem(KEY)).toBe("1");
  });

  it("ý định mở (openRequest đổi) ⇒ panel mở, báo onCollapsedChange(false), KHÔNG ghi đè bộ nhớ; giá trị ban đầu không mở", () => {
    const seen: boolean[] = [];
    const ui = (req: number) => (
      <main>
        <WorkbenchShell layoutId="test-ide" userId={5} main={<p>m</p>}
          bottom={{ label: "Vấn đề", content: <Counter name="bottom" />, defaultCollapsed: true, openRequest: req, onCollapsedChange: (c) => seen.push(c) }} />
      </main>
    );
    const r = render(ui(3));
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(seen.at(-1)).toBe(true);
    r.rerender(ui(4));
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(bottomSize()).toBeGreaterThan(0);
    expect(seen.at(-1)).toBe(false);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("người dùng chưa biết lúc mount (auth đang tải) ⇒ khi biết, áp lựa chọn đã nhớ của người đó", () => {
    localStorage.setItem(KEY, "0");
    const ui = (uid: number | null) => (
      <main>
        <WorkbenchShell layoutId="test-ide" userId={uid} main={<p>m</p>} bottom={{ label: "Vấn đề", content: <p>b</p>, defaultCollapsed: true }} />
      </main>
    );
    const r = render(ui(null));
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    r.rerender(ui(5));
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
  });

  it("không biết người dùng ⇒ gập/mở không ghi bộ nhớ", async () => {
    const user = userEvent.setup();
    renderShell({ userId: null, ...bottomOf() });
    await user.click(toggle());
    expect(Object.keys(localStorage).filter((k) => k.includes("bottomCollapsed"))).toEqual([]);
  });
});

describe("WorkbenchShell — dưới 1024 px chuyển sang tab", () => {
  it("không còn separator; có tablist; MAIN vẫn đánh dấu; panel phụ mở bằng tab, MAIN không unmount", async () => {
    presetNarrow(true);
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


// ── Fix round 1 (review I3/I4) — qua lại mốc 1024 px KHÔNG remount nội dung; activity bar còn ở màn hẹp ──
const mounts: Record<string, number> = {};
function Probe({ name }: { name: string }) {
  const [n, setN] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    mounts[name] = (mounts[name] ?? 0) + 1;
  }, []);
  return (
    <button type="button" onClick={() => setN(n + 1)}>
      {name} {n}
    </button>
  );
}

describe("WorkbenchShell — qua lại 1024 px giữ nguyên instance (Review Focus 3)", () => {
  it("main / trái / phải (Copilot) / dưới giữ state và chỉ mount MỘT lần qua rộng→hẹp→rộng→hẹp", async () => {
    for (const k of Object.keys(mounts)) delete mounts[k];
    const user = userEvent.setup();
    renderShell({
      main: <Probe name="main" />,
      left: { label: "Explorer", content: <Probe name="left" /> },
      right: { label: "Copilot", content: <Probe name="right" />, ai: true },
      bottom: { label: "Vấn đề", content: <Probe name="bottom" /> },
      leftRail: <Probe name="rail" />,
    });
    for (const n of ["main", "left", "right", "bottom", "rail"]) await user.click(screen.getByRole("button", { name: `${n} 0` }));
    for (const step of [true, false, true]) {
      setNarrow(step);
      expect(document.querySelector("[data-workbench]")!.hasAttribute("data-narrow")).toBe(step);
      for (const n of ["main", "left", "right", "bottom", "rail"]) {
        expect(screen.getByRole("button", { name: `${n} 1`, hidden: true })).toBeInTheDocument();
        expect(mounts[n]).toBe(1);
      }
      expect(mainEl()).toContainElement(screen.getByRole("button", { name: "main 1", hidden: true }));
      expect(document.querySelectorAll("[data-layout-main]")).toHaveLength(1);
    }
  });

  it("màn hẹp: Copilot là complementary có data-layout-ai, NGOÀI MAIN", () => {
    presetNarrow(true);
    renderShell();
    const aside = screen.getByRole("complementary", { name: "Copilot", hidden: true });
    expect(aside).toHaveAttribute("data-layout-ai");
    expect(mainEl()).not.toContainElement(aside);
  });
});

describe("WorkbenchShell — leftRail (activity bar) còn ở màn hẹp", () => {
  it("rail hiện cạnh vùng tab ở màn hẹp; leftRevealToken đổi ⇒ chuyển sang tab trái", () => {
    presetNarrow(true);
    const { rerender } = render(
      <main>
        <WorkbenchShell layoutId="t" userId={1} main={<p>m</p>} left={{ label: "Explorer", content: <p>cây</p> }} leftRail={<nav aria-label="rail">R</nav>} leftRevealToken={0} />
      </main>,
    );
    const rail = screen.getByRole("navigation", { name: "rail" });
    expect(rail).toBeVisible();
    expect(screen.getByRole("tab", { name: VI.layoutKit.shell.editor })).toHaveAttribute("aria-selected", "true");
    rerender(
      <main>
        <WorkbenchShell layoutId="t" userId={1} main={<p>m</p>} left={{ label: "Explorer", content: <p>cây</p> }} leftRail={<nav aria-label="rail">R</nav>} leftRevealToken={1} />
      </main>,
    );
    expect(screen.getByRole("tab", { name: "Explorer" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("cây")).toBeVisible();
  });
});

// ── Fix round 2 (re-review) — giới hạn px còn hiệu lực sau khi đổi mốc / khi nạp ở màn hẹp ──────────
describe("WorkbenchShell — giới hạn px (useElementSize đo lại phần tử mới)", () => {
  function stubRect() {
    return vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () => ({ x: 0, y: 0, top: 0, left: 0, right: 1200, bottom: 800, width: 1200, height: 800, toJSON: () => ({}) }) as DOMRect,
    );
  }
  const rightSizeAfterHome = () => {
    const h = screen.getByRole("separator", { name: VI.layoutKit.shell.resizeRight });
    fireEvent.keyDown(h, { key: "Home" });
    return (document.querySelector('[data-panel-id="right"]') as HTMLElement).getAttribute("data-panel-size");
  };

  it("đối chứng: nạp ở màn rộng, nhóm 1200 px ⇒ panel phải tối đa 420 px = 35 %", () => {
    const spy = stubRect();
    try {
      renderShell({ userId: null });
      expect(rightSizeAfterHome()).toBe("35.0");
    } finally {
      spy.mockRestore();
    }
  });

  it("nạp ở màn HẸP rồi sang rộng ⇒ giới hạn px vẫn áp (35 %, không rơi về % dự phòng 30)", () => {
    const spy = stubRect();
    try {
      presetNarrow(true);
      renderShell({ userId: null });
      setNarrow(false);
      expect(rightSizeAfterHome()).toBe("35.0");
    } finally {
      spy.mockRestore();
    }
  });

  it("rộng → hẹp → rộng ⇒ vẫn 35 %", () => {
    const spy = stubRect();
    try {
      renderShell({ userId: null });
      setNarrow(true);
      setNarrow(false);
      expect(rightSizeAfterHome()).toBe("35.0");
    } finally {
      spy.mockRestore();
    }
  });
});

// ── Doc 81 Đợt 2 Task 11b — kích thước ban đầu = % suy từ px (không phải % dự phòng) ─────────────────────
// Bệnh: nhóm panel mount ở lượt render đầu khi bề rộng còn 0 ⇒ `defaultSize` = % dự phòng (18/24/25) và
// react-resizable-panels GIỮ % lúc mount ⇒ panel rộng hơn giới hạn px (Task 5, Task 11). ORACLE khai tay:
// khung nhóm 1600×800 px ⇒ trái 240 px = 15 %, phải 340 px = 21,25 %, dưới 260 px = 32,5 % (dự phòng: 18 / 24 / 25).
describe("WorkbenchShell — kích thước ban đầu theo px khi đã biết bề rộng khung (Task 11b)", () => {
  const W = 1600;
  const H = 800;
  function stubGroupBox() {
    const original = HTMLElement.prototype.getBoundingClientRect;
    const spy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute("data-workbench-group")) return DOMRect.fromRect({ x: 0, y: 0, width: W, height: H });
      return original.call(this);
    });
    return spy;
  }
  const px = (over: Partial<WorkbenchShellProps> = {}): Partial<WorkbenchShellProps> => ({
    left: { label: "Explorer", content: <p>cây dự án</p>, minPx: 220, defaultPx: 240, maxPx: 360 },
    right: { label: "Copilot", content: <p>trợ lý</p>, ai: true, minPx: 300, defaultPx: 340, maxPx: 480 },
    bottom: { label: "Vấn đề", content: <Counter name="bottom" />, minPx: 160, defaultPx: 260, maxPx: 480 },
    ...over,
  });
  const size = (id: string) => Number((document.querySelector(`[data-panel-id="${id}"]`) as HTMLElement).getAttribute("data-panel-size"));
  /** Kích thước panel (px) khớp đích px trong 1 %. */
  const expectPx = (id: string, groupPx: number, targetPx: number) => {
    const got = (size(id) * groupPx) / 100;
    expect(Math.abs(got - targetPx) / targetPx, `${id}: ${got.toFixed(1)} px, đích ${targetPx} px`).toBeLessThanOrEqual(0.01);
  };

  it("lần đầu (chưa lưu gì): trái 240 / phải 340 / dưới 260 px — không phải % dự phòng", () => {
    const spy = stubGroupBox();
    try {
      renderShell(px());
      expectPx("left", W, 240);
      expectPx("right", W, 340);
      expectPx("bottom", H, 260);
      expect(size("left")).not.toBeCloseTo(18, 0);
      // Kích thước do MÃ áp (mặc định px) KHÔNG được ghi như thể người dùng đã chọn.
      expect(localStorage.getItem(userLayoutKey("test-ide", 5, "hpx")!)).toBeNull();
      expect(localStorage.getItem(userLayoutKey("test-ide", 5, "vpx")!)).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it("mặc định WorkbenchShell (không khai px): trái 260 / phải 380 / dưới 200 px", () => {
    const spy = stubGroupBox();
    try {
      renderShell({ userId: null });
      expectPx("left", W, 260);
      expectPx("right", W, 380);
      expectPx("bottom", H, 200);
    } finally {
      spy.mockRestore();
    }
  });

  it("R-2-l: gập lần đầu ⇒ 0; mở bằng nút ⇒ đúng 260 px; lần sau (đã nhớ '0') mở ngay ở 260 px", async () => {
    const spy = stubGroupBox();
    try {
      const user = userEvent.setup();
      const r = renderShell(px({ bottom: { label: "Vấn đề", content: <Counter name="bottom" />, minPx: 160, defaultPx: 260, maxPx: 480, defaultCollapsed: true } }));
      expect(size("bottom")).toBe(0);
      await user.click(screen.getByRole("button", { name: VI.layoutKit.shell.toggleBottom }));
      expectPx("bottom", H, 260);
      expect(localStorage.getItem("layoutKit:test-ide:u5:bottomCollapsed")).toBe("0");
      r.unmount();
      // Không ai kéo ⇒ không có px nào được lưu (chỉ lựa chọn gập/mở).
      expect(Object.keys(localStorage).filter((k) => k.startsWith("react-resizable-panels:") || k.endsWith(":vpx"))).toEqual([]);
      renderShell(px({ bottom: { label: "Vấn đề", content: <Counter name="bottom" />, minPx: 160, defaultPx: 260, maxPx: 480, defaultCollapsed: true } }));
      expect(screen.getByRole("button", { name: VI.layoutKit.shell.toggleBottom })).toHaveAttribute("aria-expanded", "true");
      expectPx("bottom", H, 260);
    } finally {
      spy.mockRestore();
    }
  });

  it("kích thước NGƯỜI DÙNG đã lưu THẮNG đích px; panel người dùng không kéo vẫn đúng đích px", async () => {
    const spy = stubGroupBox();
    try {
      const r = renderShell(px());
      const h = screen.getByRole("separator", { name: VI.layoutKit.shell.resizeLeft });
      fireEvent.keyDown(h, { key: "ArrowRight" });
      fireEvent.keyDown(h, { key: "ArrowRight" });
      const resized = size("left");
      expect(Math.abs((resized * W) / 100 - 240)).toBeGreaterThan(20);
      await waitFor(() => expect(Object.keys(localStorage).some((k) => k.includes(userLayoutKey("test-ide", 5, "h")!))).toBe(true));
      r.unmount();
      renderShell(px());
      expect(size("left")).toBeCloseTo(resized, 1);
      expectPx("right", W, 340);
      expectPx("bottom", H, 260);
    } finally {
      spy.mockRestore();
    }
  });

  /** Khung đổi cỡ SAU khi mount (rail trái thu gọn có transition: đo thật 1336 → 1552 px) — RO điều khiển được. */
  function growingGroup(start: number) {
    const box = { w: start };
    const original = HTMLElement.prototype.getBoundingClientRect;
    const spy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute("data-workbench-group")) return DOMRect.fromRect({ x: 0, y: 0, width: box.w, height: H });
      return original.call(this);
    });
    const cbs = new Set<() => void>();
    const prevRO = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      private cb: () => void;
      constructor(cb: () => void) {
        this.cb = () => cb();
      }
      observe() {
        cbs.add(this.cb);
      }
      unobserve() {}
      disconnect() {
        cbs.delete(this.cb);
      }
    };
    return {
      resize: (w: number) => {
        box.w = w;
        act(() => {
          for (const cb of [...cbs]) cb();
        });
      },
      restore: () => {
        spy.mockRestore();
        (globalThis as { ResizeObserver?: unknown }).ResizeObserver = prevRO;
      },
    };
  }

  it("khung GIÃN sau khi mount (1336 → 1552 px, rail thu gọn) ⇒ panel phụ GIỮ đúng px (không phình theo %)", () => {
    const g = growingGroup(1336);
    try {
      renderShell(px());
      expectPx("left", 1336, 240);
      g.resize(1444);
      g.resize(1552);
      expectPx("left", 1552, 240);
      expectPx("right", 1552, 340);
      // Lượt ghim do MÃ áp không phải lựa chọn của người dùng ⇒ không lưu.
      expect(localStorage.getItem(userLayoutKey("test-ide", 5, "hpx")!)).toBeNull();
    } finally {
      g.restore();
    }
  });

  it("người dùng kéo (bàn phím) ⇒ kích thước của HỌ (px) được nhớ và giữ khi khung đổi cỡ — không quay về mặc định", () => {
    const g = growingGroup(1336);
    try {
      renderShell(px({ left: { label: "Explorer", content: <p>cây dự án</p>, minPx: 120, defaultPx: 240, maxPx: 360 } }));
      // ArrowLeft (bước 10 %) ⇒ 17,96 − 10 = 7,96 % ⇒ thư viện kẹp lên min 120 px (8,98 % của 1336).
      fireEvent.keyDown(screen.getByRole("separator", { name: VI.layoutKit.shell.resizeLeft }), { key: "ArrowLeft" });
      expectPx("left", 1336, 120);
      const stored = JSON.parse(localStorage.getItem(userLayoutKey("test-ide", 5, "hpx")!) ?? "null");
      expect(stored?.left?.px).toBe(120);
      // Khung 1552: vẫn 120 px (7,73 %), không phải mặc định 240 px (15,46 %), cũng không phải % cũ (8,98 % = 139 px).
      g.resize(1552);
      expectPx("left", 1552, 120);
    } finally {
      g.restore();
    }
  });

  it("đã nhớ px ⇒ lần sau mount ở khung KHÁC (đang giãn 1102 → 1318 như rail thu gọn ở 1366) vẫn đúng px của người dùng", () => {
    const g = growingGroup(1600);
    try {
      const r = renderShell(px());
      const h = screen.getByRole("separator", { name: VI.layoutKit.shell.resizeLeft });
      fireEvent.keyDown(h, { key: "ArrowRight" });
      fireEvent.keyDown(h, { key: "ArrowRight" });
      expectPx("left", 1600, 360); // 15 % + 10 % = 25 % ⇒ kẹp max 360 px
      r.unmount();
      g.resize(1102);
      renderShell(px());
      g.resize(1210);
      g.resize(1318);
      expectPx("left", 1318, 360);
      expectPx("right", 1318, 340);
    } finally {
      g.restore();
    }
  });

  it("panel người dùng KHÔNG kéo vẫn theo mặc định px; người dùng khác không thấy px của người này", () => {
    const g = growingGroup(1600);
    try {
      const r = renderShell(px());
      fireEvent.keyDown(screen.getByRole("separator", { name: VI.layoutKit.shell.resizeRight }), { key: "ArrowLeft" });
      r.unmount();
      renderShell(px());
      expectPx("left", 1600, 240);
      expect(Math.abs((size("right") * 1600) / 100 - 340)).toBeGreaterThan(20);
      cleanup();
      renderShell({ userId: 6, ...px() });
      expectPx("right", 1600, 340);
    } finally {
      g.restore();
    }
  });

  it("panel dưới đang GẬP (R-2-l) ⇒ khung đổi cỡ không mở nó ra", () => {
    const g = growingGroup(1336);
    try {
      renderShell(px({ bottom: { label: "Vấn đề", content: <Counter name="bottom" />, minPx: 160, defaultPx: 260, maxPx: 480, defaultCollapsed: true } }));
      expect(size("bottom")).toBe(0);
      g.resize(1552);
      expect(size("bottom")).toBe(0);
    } finally {
      g.restore();
    }
  });

  it("leftCollapsed=true ngay lần mount (activity bar đã gập explorer) ⇒ panel trái 0 khi nhóm mount sau lần đo; bỏ gập ⇒ 240 px", () => {
    const spy = stubGroupBox();
    try {
      const r = renderShell({ userId: null, ...px(), leftCollapsed: true });
      expect(size("left")).toBe(0);
      r.rerender(
        <main>
          <WorkbenchShell layoutId="test-ide" userId={null} main={<textarea aria-label="editor" />} {...px()} leftCollapsed={false} />
        </main>,
      );
      expectPx("left", W, 240);
    } finally {
      spy.mockRestore();
    }
  });

  it("rộng → hẹp → rộng (chưa lưu gì, không biết người dùng) ⇒ vẫn đúng đích px", () => {
    const spy = stubGroupBox();
    try {
      renderShell({ userId: null, ...px() });
      setNarrow(true);
      setNarrow(false);
      expectPx("left", W, 240);
      expectPx("right", W, 340);
    } finally {
      spy.mockRestore();
    }
  });
});
