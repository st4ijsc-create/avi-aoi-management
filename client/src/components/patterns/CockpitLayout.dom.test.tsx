// @vitest-environment jsdom
//
// Doc 81 Đợt 2 Task 3 — CockpitLayout (P4: Hub, Fleet, Safety…) và SplitListDetail (P3: ECN,
// Recipes, Interlock, Standards, Integration), cùng hai mở rộng tương thích ngược của primitive
// có sẵn: TabbedHub (`keepMounted`, `listEnd`, `listRowAttrs`) và WorkspaceShell (`autoSaveId`,
// `handleLabel`, `railMaxSize`).
// Hợp đồng dấu đo: header (h1 + notice + chip KPI) NGOÀI MAIN và CÙNG HÀNG h1; trong MAIN chỉ có
// đúng MỘT `data-layout-toolbar` rồi tới vùng làm việc; panel phụ là complementary ngoài MAIN.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("react-resizable-panels", async () => (await import("./layoutKitTestPanels")).browserPanels());
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import VI from "@/i18n/locales/vi.json";
import { initLayoutKitTestI18n } from "./layoutKitTestI18n";
import { CockpitLayout } from "./CockpitLayout";
import { SplitListDetail } from "./SplitListDetail";
import { StatusChipStrip } from "./StatusChipStrip";
import { NoticeStack } from "./NoticeChip";
import { TabbedHub } from "@/components/workspace/TabbedHub";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";

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
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  await initLayoutKitTestI18n();
});
beforeEach(() => {
  narrow = false;
  localStorage.clear();
  window.history.replaceState(null, "", "/fleet?filter=pending");
});
afterEach(() => cleanup());

function Live() {
  const [n, setN] = useState(0);
  return (
    <button type="button" onClick={() => setN(n + 1)}>
      sống {n}
    </button>
  );
}

const mainEl = () => document.querySelector("[data-layout-main]") as HTMLElement;

function renderCockpit(over: Partial<React.ComponentProps<typeof CockpitLayout>> = {}) {
  return render(
    <main>
      <CockpitLayout
        title="Điều phối đội xe"
        notices={<NoticeStack items={[{ id: "b", kind: "beta", content: <p>beta</p> }]} />}
        chips={<StatusChipStrip items={[{ id: "run", label: "Chạy", value: 3, state: "ok", source: "fleet.tasks" }]} />}
        basePath="/fleet"
        tabs={[
          { value: "map", labelKey: "x.map", fallback: "Bản đồ", Content: () => <table><tbody><tr><td>bản đồ</td></tr></tbody></table> },
          { value: "collab", labelKey: "x.collab", fallback: "Phối hợp", Content: Live, keepMounted: true },
        ]}
        toolbarEnd={<button type="button">Lọc</button>}
        side={<p>tác vụ</p>}
        sideLabel="Tác vụ"
        {...over}
      />
    </main>,
  );
}

describe("CockpitLayout — dấu đo", () => {
  it("header 1 hàng: h1 + notice + chip KPI NGOÀI MAIN", () => {
    renderCockpit();
    const h1 = screen.getByRole("heading", { level: 1, name: "Điều phối đội xe" });
    const header = h1.closest("[data-layout-header]") as HTMLElement;
    expect(header).toContainElement(document.querySelector("[data-layout-kpi]") as HTMLElement);
    expect(header).toContainElement(document.querySelector("[data-notice-kind]") as HTMLElement);
    expect(mainEl()).not.toContainElement(header);
    expect(mainEl().querySelector("[data-layout-kpi], [data-notice-kind], h1")).toBeNull();
    expect(mainEl().closest("main")).not.toBeNull();
  });

  it("trong MAIN đúng MỘT data-layout-toolbar = hàng tab + toolbarEnd, đứng trước nội dung tab", () => {
    renderCockpit();
    const bars = mainEl().querySelectorAll("[data-layout-toolbar]");
    expect(bars).toHaveLength(1);
    expect(bars[0]).toContainElement(screen.getByRole("tablist"));
    expect(bars[0]).toContainElement(screen.getByRole("button", { name: "Lọc" }));
    const table = mainEl().querySelector("table")!;
    expect(bars[0].compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("panel phụ là complementary NGOÀI MAIN", () => {
    renderCockpit();
    const side = screen.getByRole("complementary", { name: "Tác vụ" });
    expect(mainEl()).not.toContainElement(side);
  });

  it("panel phụ không khai nhãn ⇒ nhãn mặc định 'Panel phụ' (landmark luôn có tên)", () => {
    renderCockpit({ sideLabel: undefined });
    expect(screen.getByRole("complementary", { name: VI.layoutKit.cockpit.side })).toBeInTheDocument();
  });

  it("không có tab ⇒ MAIN = toolbar (tuỳ chọn) + main", () => {
    renderCockpit({ tabs: undefined, main: <table aria-label="bảng" />, toolbar: <span>tb</span> });
    expect(mainEl()).toContainElement(screen.getByRole("table", { name: "bảng" }));
    expect(mainEl().querySelectorAll("[data-layout-toolbar]")).toHaveLength(1);
  });

  it("dưới 1024 px: panel phụ xếp dưới MAIN (stack)", () => {
    narrow = true;
    renderCockpit();
    expect(document.querySelector("[data-cockpit-body]")).toHaveAttribute("data-narrow");
  });
});

describe("CockpitLayout / TabbedHub — ?tab= và tab sống", () => {
  it("bấm tab ⇒ ?tab= cập nhật, GIỮ ?filter=pending; F5 với ?tab=collab mở đúng tab", async () => {
    const user = userEvent.setup();
    const r = renderCockpit();
    await user.click(screen.getByRole("tab", { name: "Phối hợp" }));
    const p = new URLSearchParams(window.location.search);
    expect(p.get("tab")).toBe("collab");
    expect(p.get("filter")).toBe("pending");
    r.unmount();
    renderCockpit();
    expect(screen.getByRole("tab", { name: "Phối hợp" })).toHaveAttribute("aria-selected", "true");
  });

  it("tab keepMounted giữ state khi chuyển đi và quay lại (không huỷ tiến trình sống)", async () => {
    const user = userEvent.setup();
    renderCockpit();
    await user.click(screen.getByRole("tab", { name: "Phối hợp" }));
    await user.click(screen.getByRole("button", { name: "sống 0" }));
    await user.click(screen.getByRole("tab", { name: "Bản đồ" }));
    const sleeping = screen.getByRole("button", { name: "sống 1", hidden: true });
    expect(sleeping).not.toBeVisible();
    await user.click(screen.getByRole("tab", { name: "Phối hợp" }));
    expect(screen.getByRole("button", { name: "sống 1" })).toBeVisible();
  });

  it("TabbedHub KHÔNG khai prop mới ⇒ markup cũ: TabsList con trực tiếp, tab không chọn bị gỡ", async () => {
    const user = userEvent.setup();
    render(
      <TabbedHub
        basePath="/fleet"
        tabs={[
          { value: "a", labelKey: "x.a", fallback: "A", Content: Live },
          { value: "b", labelKey: "x.b", fallback: "B", Content: () => <p>bê</p> },
        ]}
      />,
    );
    const list = screen.getByRole("tablist");
    expect(list.parentElement).toHaveAttribute("data-slot", "tabs");
    expect(list.className).toMatch(/min-h-12/);
    await user.click(screen.getByRole("button", { name: "sống 0" }));
    await user.click(screen.getByRole("tab", { name: "B" }));
    expect(screen.queryByRole("button", { name: /sống/, hidden: true })).toBeNull();
  });
});

describe("SplitListDetail", () => {
  function renderSplit(over: Partial<React.ComponentProps<typeof SplitListDetail>> = {}) {
    const onBack = vi.fn();
    const r = render(
      <main>
        <SplitListDetail
          layoutId="ecn"
          userId={4}
          listLabel="Danh sách ECN"
          detailLabel="Chi tiết ECN"
          listToolbar={<input aria-label="tìm" />}
          list={<table aria-label="ecn"><tbody><tr><td>ECN-1</td></tr></tbody></table>}
          detail={<p>chi tiết ECN-1</p>}
          emptyDetail={<p>Chọn một ECN để xem</p>}
          hasSelection
          onBack={onBack}
          {...over}
        />
      </main>,
    );
    return { onBack, ...r };
  }

  it("mặc định MAIN = danh sách (toolbar ≤56 px là data-layout-toolbar duy nhất, đứng trước bảng); chi tiết ngoài MAIN", () => {
    renderSplit();
    expect(mainEl()).toContainElement(screen.getByRole("table", { name: "ecn" }));
    expect(mainEl()).not.toContainElement(screen.getByText("chi tiết ECN-1"));
    const bars = mainEl().querySelectorAll("[data-layout-toolbar]");
    expect(bars).toHaveLength(1);
    expect((bars[0] as HTMLElement).style.maxHeight).toBe("56px");
    expect(bars[0]).toContainElement(screen.getByLabelText("tìm"));
    expect(document.querySelectorAll("[data-layout-main]")).toHaveLength(1);
  });

  it("mainRegion='detail' ⇒ MAIN = chi tiết; 'both' ⇒ hai vùng", () => {
    const { unmount } = renderSplit({ mainRegion: "detail" });
    expect(mainEl()).toHaveTextContent("chi tiết ECN-1");
    expect(mainEl()).not.toContainElement(screen.getByRole("table", { name: "ecn" }));
    unmount();
    renderSplit({ mainRegion: "both" });
    expect(document.querySelectorAll("[data-layout-main]")).toHaveLength(2);
  });

  it("chưa chọn ⇒ hiện emptyDetail", () => {
    renderSplit({ hasSelection: false });
    expect(screen.getByText("Chọn một ECN để xem")).toBeInTheDocument();
    expect(screen.queryByText("chi tiết ECN-1")).toBeNull();
  });

  it("separator có nhãn, kéo bằng bàn phím, nhớ theo người dùng", async () => {
    const r = renderSplit();
    const h = screen.getByRole("separator", { name: VI.layoutKit.split.resize });
    const before = h.getAttribute("aria-valuenow");
    fireEvent.keyDown(h, { key: "ArrowRight" });
    const after = h.getAttribute("aria-valuenow");
    expect(Number(after)).toBeGreaterThan(Number(before));
    await waitFor(() => expect(Object.keys(localStorage).some((k) => k.includes("layoutKit:ecn:u4"))).toBe(true));
    r.unmount();
    renderSplit();
    expect(screen.getByRole("separator", { name: VI.layoutKit.split.resize }).getAttribute("aria-valuenow")).toBe(after);
  });

  it("dưới 1024 px: stack — có chọn ⇒ chi tiết + nút quay lại; không chọn ⇒ danh sách; MAIN theo vùng đang hiện", () => {
    narrow = true;
    const { onBack, unmount } = renderSplit();
    expect(screen.queryAllByRole("separator")).toHaveLength(0);
    expect(screen.queryByRole("table", { name: "ecn" })).toBeNull();
    expect(mainEl()).toHaveTextContent("chi tiết ECN-1");
    fireEvent.click(screen.getByRole("button", { name: VI.layoutKit.split.back }));
    expect(onBack).toHaveBeenCalled();
    unmount();
    renderSplit({ hasSelection: false });
    expect(mainEl()).toContainElement(screen.getByRole("table", { name: "ecn" }));
  });
});

describe("WorkspaceShell — prop mới tương thích ngược", () => {
  it("không khai autoSaveId/handleLabel ⇒ không lưu, separator không nhãn (như cũ)", async () => {
    // Lượt ghi trễ (debounce) của ca trước có thể rơi vào đây — chờ xong rồi mới xoá.
    await new Promise((r) => setTimeout(r, 250));
    localStorage.clear();
    render(<WorkspaceShell rail={<p>r</p>} main={<p>m</p>} />);
    const h = screen.getByRole("separator");
    expect(h).not.toHaveAttribute("aria-label");
    fireEvent.keyDown(h, { key: "ArrowRight" });
    await new Promise((r) => setTimeout(r, 250));
    expect(Object.keys(localStorage)).toEqual([]);
    expect(within(document.body).getByText("m")).toBeInTheDocument();
  });
});
