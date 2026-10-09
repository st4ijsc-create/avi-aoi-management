// @vitest-environment jsdom
//
// doc 81 Đợt 3b Task 2 (b) — chủ dự án 2026-10-06: "sửa chip đầu trang 640–1023 px (gộp vào "+N", chip nghiêm trọng vẫn
// ghim)". Đo trình duyệt TRƯỚC khi sửa (.playwright-mcp/do-bo-cuc/dot3b-task2/chips-truoc.json): header một hàng của
// PageHeaderCompact cắt chip ở 640–1023 VÀ ở 1024/1280 px; 1366/1600 không cắt. Hợp đồng (theo ĐO, ba mức):
//   0 — không tràn ⇒ như cũ (một hàng ≤48 px, không "+N" mới).
//   1 — tràn ⇒ GỘP bằng "+N" sẵn có: StatusChipStrip chỉ hiện chip GHIM (R-2-p; tông "+N" = tệ nhất của phần giấu),
//       NoticeStack chỉ hiện notice LỖI.
//   2 — vẫn tràn (chip ghim / chip tự viết / hành động) ⇒ header XUỐNG DÒNG (chip một hàng riêng) thay vì cắt.
//   - Đổi bề rộng (ResizeObserver) hoặc trang dựng lại header với nội dung mới ⇒ đo lại từ mức 0 (bung lại khi đủ chỗ).
//   - Dải chip NGOÀI header (top bar shell — nơi chip/thanh giấy phép R-2-i sống) không bao giờ đổi.
// "Hình học DOM": jsdom không dựng layout ⇒ mô hình bề rộng tất định: mỗi mục nhìn thấy (chip, notice, "+N", nút hành
// động) rộng 100 px; header tràn khi tổng > sức chứa; header đã xuống dòng (`data-header-fit="wrap"`) thì không tràn.
// Hình học THẬT trên trình duyệt: chips-sau*.json (0 mục bị cắt ở 640/768/900/1024/1280/1366/1600).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { initLayoutKitTestI18n } from "./layoutKitTestI18n";
import { PageHeaderCompact } from "./PageHeaderCompact";
import { StatusChipStrip, type StatusChipItem } from "./StatusChipStrip";
import { NoticeStack, type NoticeItem } from "./NoticeChip";
import { headerOverflows } from "./headerChipFold";

// ── mô hình bề rộng ───────────────────────────────────────────────────────────────────────────
let capacity = 2000;
const ITEM_PX = 100;
const ITEM_SEL = "[data-chip-id],[data-chip-more],[data-notice-kind],[data-notice-more],[data-header-actions] > *";
function itemsIn(el: Element): number {
  const all = Array.from(el.querySelectorAll(ITEM_SEL));
  return all.filter((x) => !all.some((o) => o !== x && o.contains(x))).length;
}
const sw = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollWidth");
const cw = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
type ROCb = (entries: Array<{ contentRect: { width: number } }>) => void;
const observers = new Set<ROCb>();
const RealRO = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
beforeAll(async () => {
  await initLayoutKitTestI18n();
  Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
    configurable: true,
    get(this: HTMLElement) {
      if (!this.hasAttribute("data-layout-header")) return 0;
      return this.getAttribute("data-header-fit") === "wrap" ? capacity : itemsIn(this) * ITEM_PX;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute("data-layout-header") ? capacity : 0;
    },
  });
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    cb: ROCb;
    constructor(cb: ROCb) {
      this.cb = cb;
    }
    observe() {
      observers.add(this.cb);
      this.cb([{ contentRect: { width: capacity } }]);
    }
    unobserve() {}
    disconnect() {
      observers.delete(this.cb);
    }
  };
});
afterAll(() => {
  if (sw) Object.defineProperty(HTMLElement.prototype, "scrollWidth", sw);
  if (cw) Object.defineProperty(HTMLElement.prototype, "clientWidth", cw);
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = RealRO;
});
function resizeTo(px: number): void {
  capacity = px;
  act(() => {
    for (const cb of [...observers]) cb([{ contentRect: { width: px } }]);
  });
}
beforeEach(() => {
  capacity = 2000;
  observers.clear();
});
afterEach(() => cleanup());

// ── dữ liệu ───────────────────────────────────────────────────────────────────────────────────
const chip = (id: string, extra: Partial<StatusChipItem> = {}): StatusChipItem => ({ id, label: id, value: 1, state: "ok", source: "test", ...extra });
const CHIPS: StatusChipItem[] = [chip("critical", { pinned: true, tone: "error" }), chip("a"), chip("b", { tone: "warning" }), chip("c")];
const NOTICES: NoticeItem[] = [
  { id: "w", kind: "whenToUse", content: "khi nào dùng" },
  { id: "h", kind: "hint", content: "gợi ý" },
  { id: "e", kind: "error", label: "Lỗi nguồn", content: "lỗi" },
];
// Mức 0: 3 notice + 4 chip + 1 hành động = 8 mục (800 px). Mức 1: notice lỗi + "+2" + chip ghim + "+3" + 1 hành động = 5 (500 px).
function Header({ chips = CHIPS }: { chips?: StatusChipItem[] }) {
  return (
    <PageHeaderCompact
      title="Trang"
      chips={
        <>
          <NoticeStack items={NOTICES} />
          <StatusChipStrip items={chips} />
        </>
      }
      actions={<button type="button">Hành động</button>}
    />
  );
}
const header = () => screen.getByRole("heading", { level: 1 }).closest("[data-layout-header]") as HTMLElement;
const chipIds = (root: HTMLElement) => Array.from(root.querySelectorAll("[data-status-chip-strip] > [data-chip-id]")).map((x) => x.getAttribute("data-chip-id"));
const noticeKinds = (root: HTMLElement) => Array.from(root.querySelectorAll("[data-notice-stack] > [data-notice-kind]")).map((x) => x.getAttribute("data-notice-kind"));
const chipMore = (root: HTMLElement) => root.querySelector("[data-status-chip-strip] [data-chip-more]") as HTMLElement | null;
const noticeMore = (root: HTMLElement) => root.querySelector("[data-notice-stack] [data-notice-more]") as HTMLElement | null;

describe("Đợt 3b Task 2 (b) — header không cắt chip: gộp '+N' rồi mới xuống dòng", () => {
  it("đủ chỗ (như 1366/1600) ⇒ mức 0: không gộp, không xuống dòng, max-height 48 giữ nguyên", () => {
    render(<Header />);
    const h = header();
    expect(h.getAttribute("data-header-fit")).toBeNull();
    expect(chipIds(h)).toEqual(["critical", "a", "b", "c"]);
    expect(noticeKinds(h)).toEqual(["whenToUse", "hint", "error"]);
    expect(chipMore(h)).toBeNull();
    expect(noticeMore(h)).toBeNull();
    expect(h.style.maxHeight).toBe("48px");
    expect(h.className.split(/\s+/)).not.toContain("flex-wrap");
  });

  it("tràn nhưng gộp là vừa (600 px) ⇒ mức 1: chỉ chip GHIM + '+3' tông TỆ NHẤT (cảnh báo); notice chỉ LỖI + '+2'; vẫn MỘT hàng", () => {
    capacity = 600;
    render(<Header />);
    const h = header();
    expect(h.getAttribute("data-header-fit")).toBe("fold");
    expect(chipIds(h)).toEqual(["critical"]);
    expect(chipMore(h)?.getAttribute("data-chip-more")).toBe("3");
    expect(chipMore(h)?.getAttribute("data-state")).toBe("warning");
    expect(noticeKinds(h)).toEqual(["error"]);
    expect(noticeMore(h)?.getAttribute("data-notice-more")).toBe("2");
    expect(h.style.maxHeight).toBe("48px");
    expect(h.className.split(/\s+/)).not.toContain("flex-wrap");
    expect(headerOverflows(h)).toBe(false);
  });

  it("gộp rồi vẫn tràn (400 px) ⇒ mức 2: xuống dòng (flex-wrap, bỏ trần 48 px), chip ghim VẪN hiện, không gì bị cắt", () => {
    capacity = 400;
    render(<Header />);
    const h = header();
    expect(h.getAttribute("data-header-fit")).toBe("wrap");
    expect(h.className.split(/\s+/)).toContain("flex-wrap");
    expect(h.style.maxHeight).toBe("");
    expect(chipIds(h)).toEqual(["critical"]);
    expect(noticeKinds(h)).toEqual(["error"]);
    const chips = h.querySelector("[data-header-chips]") as HTMLElement;
    expect(chips.className.split(/\s+/)).toEqual(expect.arrayContaining(["basis-full", "flex-wrap", "order-last"]));
    expect(headerOverflows(h)).toBe(false);
  });

  it("chip giấu ở trạng thái LỖI ⇒ '+N' data-state=error (không bao giờ trung tính)", () => {
    capacity = 150;
    render(<PageHeaderCompact title="T" chips={<StatusChipStrip items={[chip("p", { pinned: true }), chip("x", { state: "error", value: null })]} />} />);
    expect(chipMore(header())?.getAttribute("data-state")).toBe("error");
    expect(chipIds(header())).toEqual(["p"]);
  });

  it("dải KHÔNG có chip ghim, tràn ⇒ không chip nào hiện thẳng, chỉ '+2'", () => {
    capacity = 150;
    render(<PageHeaderCompact title="T" chips={<StatusChipStrip items={[chip("a"), chip("b")]} />} />);
    expect(chipIds(header())).toEqual([]);
    expect(chipMore(header())?.getAttribute("data-chip-more")).toBe("2");
  });

  it("chip GHIM không bao giờ vào '+N' kể cả khi tràn tới mức 2", () => {
    capacity = 100;
    render(<PageHeaderCompact title="T" chips={<StatusChipStrip items={[chip("p1", { pinned: true }), chip("p2", { pinned: true }), chip("p3", { pinned: true })]} />} />);
    expect(header().getAttribute("data-header-fit")).toBe("wrap");
    expect(chipIds(header())).toEqual(["p1", "p2", "p3"]);
    expect(chipMore(header())).toBeNull();
  });

  it("đổi bề rộng khi trang đang mở: 2000 → 600 gộp → 400 xuống dòng → 2000 bung lại hẳn", () => {
    render(<Header />);
    expect(header().getAttribute("data-header-fit")).toBeNull();
    resizeTo(600);
    expect(header().getAttribute("data-header-fit")).toBe("fold");
    resizeTo(400);
    expect(header().getAttribute("data-header-fit")).toBe("wrap");
    resizeTo(2000);
    expect(header().getAttribute("data-header-fit")).toBeNull();
    expect(chipIds(header())).toEqual(["critical", "a", "b", "c"]);
    expect(noticeKinds(header())).toEqual(["whenToUse", "hint", "error"]);
  });

  it("trang dựng lại header với ÍT nội dung hơn ⇒ đo lại từ mức 0 (bung lại); nhiều hơn ⇒ gộp", () => {
    capacity = 600;
    const { rerender } = render(<Header />);
    expect(header().getAttribute("data-header-fit")).toBe("fold");
    rerender(<Header chips={[chip("critical", { pinned: true })]} />);
    // 3 notice + 1 chip + 1 hành động = 500 ≤ 600 ⇒ mức 0
    expect(header().getAttribute("data-header-fit")).toBeNull();
    expect(noticeKinds(header())).toEqual(["whenToUse", "hint", "error"]);
    rerender(<Header />);
    expect(header().getAttribute("data-header-fit")).toBe("fold");
  });

  it("dải chip NGOÀI header (top bar — giấy phép R-2-i) không đổi dù hẹp", () => {
    capacity = 100;
    render(
      <div data-testid="ngoai">
        <NoticeStack items={NOTICES} />
        <StatusChipStrip items={CHIPS} />
      </div>,
    );
    const root = screen.getByTestId("ngoai");
    expect(chipIds(root)).toEqual(["critical", "a", "b", "c"]);
    expect(noticeKinds(root)).toEqual(["whenToUse", "hint", "error"]);
  });

  it("headerOverflows: tràn BÊN TRONG một dải (StatusChipStrip/NoticeStack co lại, header không tràn) VẪN là tràn — ca Safety @1280 trước khi sửa", () => {
    const h = document.createElement("header");
    h.setAttribute("data-layout-header", "");
    const chips = document.createElement("div");
    chips.setAttribute("data-header-chips", "");
    const strip = document.createElement("div");
    strip.setAttribute("data-status-chip-strip", "");
    chips.appendChild(strip);
    h.appendChild(chips);
    capacity = 1000; // header: 0 mục ⇒ scrollWidth 0 ≤ 1000 — không tràn ở cấp header
    expect(headerOverflows(h)).toBe(false);
    Object.defineProperty(strip, "scrollWidth", { configurable: true, value: 300 });
    Object.defineProperty(strip, "clientWidth", { configurable: true, value: 240 });
    expect(headerOverflows(h)).toBe(true);
    const notices = document.createElement("div");
    notices.setAttribute("data-notice-stack", "");
    chips.appendChild(notices);
    Object.defineProperty(strip, "scrollWidth", { configurable: true, value: 240 });
    Object.defineProperty(notices, "scrollWidth", { configurable: true, value: 120 });
    Object.defineProperty(notices, "clientWidth", { configurable: true, value: 60 });
    expect(headerOverflows(h)).toBe(true);
  });
});
