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
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { initLayoutKitTestI18n } from "./layoutKitTestI18n";
import { PageHeaderCompact } from "./PageHeaderCompact";
import { StatusChipStrip, type StatusChipItem } from "./StatusChipStrip";
import { NoticeStack, featureStatusNoticeItem, noticeOverflowState, splitNoticesForOverflow, type NoticeItem } from "./NoticeChip";
import { useTranslation } from "react-i18next";
import { contentSignature, headerOverflows } from "./headerChipFold";

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
function Header({ chips = CHIPS, notices = NOTICES, extra }: { chips?: StatusChipItem[]; notices?: NoticeItem[]; extra?: React.ReactNode }) {
  return (
    <PageHeaderCompact
      title="Trang"
      chips={
        <>
          <NoticeStack items={notices} />
          <StatusChipStrip items={chips} />
          {extra}
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
    // fix 1: ở mức gộp cụm chip (đã gọn) KHÔNG co về 0 (basis-auto, shrink-0) — h1 cắt chữ trước, giữ tối thiểu 4rem
    const chipsBox = h.querySelector("[data-header-chips]") as HTMLElement;
    expect(chipsBox.className.split(/\s+/)).toEqual(expect.arrayContaining(["shrink-0", "basis-auto"]));
    expect(screen.getByRole("heading", { level: 1 }).className.split(/\s+/)).toContain("min-w-16");
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

  // ── Fix round 1 (R-3b-b (1)) ──────────────────────────────────────────────────────────────────
  it("chữ ký nội dung: cùng dữ liệu, phần tử JSX MỚI ⇒ cùng chữ ký; đổi số/thêm chip ⇒ khác", () => {
    const a = contentSignature(<Header />);
    const b = contentSignature(<Header />);
    expect(a).toBe(b);
    expect(contentSignature(<StatusChipStrip items={CHIPS} />)).not.toBe(
      contentSignature(<StatusChipStrip items={[CHIPS[0], { ...CHIPS[1], value: 7 }, CHIPS[2], CHIPS[3]]} />),
    );
    expect(contentSignature(<StatusChipStrip items={CHIPS} />)).not.toBe(contentSignature(<StatusChipStrip items={[...CHIPS, chip("d")]} />));
  });

  it("thăm dò 5 s dựng lại header với DỮ LIỆU Y NGUYÊN khi '+3' đang MỞ ⇒ popover vẫn mở, tiêu điểm không rơi, mức giữ nguyên", async () => {
    capacity = 600;
    const { rerender } = render(<Header />);
    const more = chipMore(header()) as HTMLElement;
    fireEvent.click(more);
    const pop = await screen.findByRole("dialog");
    expect(more).toHaveAttribute("aria-expanded", "true");
    const focused = document.activeElement;
    for (let i = 0; i < 3; i++) rerender(<Header />); // ba lượt thăm dò, phần tử JSX mới, dữ liệu như cũ
    expect(screen.getByRole("dialog")).toBe(pop);
    expect(chipMore(header())).toBe(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(document.activeElement).toBe(focused);
    expect(header().getAttribute("data-header-fit")).toBe("fold");
  });

  it("thăm dò ĐỔI nội dung khi '+3' đang mở ⇒ HOÃN đo lại (popover vẫn mở, mức giữ); đóng popover ⇒ đo lại, về mức 0 vì giờ vừa", async () => {
    capacity = 600;
    const { rerender } = render(<Header />);
    const more = chipMore(header()) as HTMLElement;
    fireEvent.click(more);
    const pop = await screen.findByRole("dialog");
    // còn 1 notice (lỗi): ở mức 0 = 1 notice + 4 chip + 1 hành động = 600 ≤ 600 ⇒ vừa — nhưng "+3" đang mở nên chưa về 0
    rerender(<Header notices={[NOTICES[2]]} chips={[CHIPS[0], { ...CHIPS[1], value: 9 }, CHIPS[2], CHIPS[3]]} />);
    expect(screen.getByRole("dialog")).toBe(pop);
    expect(chipMore(header())).toBe(more);
    expect(header().getAttribute("data-header-fit")).toBe("fold");
    fireEvent.keyDown(pop, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(header().getAttribute("data-header-fit")).toBeNull());
    expect(chipIds(header())).toEqual(["critical", "a", "b", "c"]);
  });

  it("nội dung chip LỚN lên mà trang KHÔNG dựng lại header (chip tự tải) ⇒ đo lại và gộp", async () => {
    capacity = 900; // mức 0: 3 notice + 4 chip + 1 hành động = 800 ≤ 900
    let grow: (n: number) => void = () => undefined;
    function SelfLoading() {
      const [n, setN] = React.useState(0);
      grow = setN;
      return <>{Array.from({ length: n }, (_, i) => <span key={i} data-notice-kind="hint">tự tải {i}</span>)}</>;
    }
    render(<Header extra={<SelfLoading />} />);
    expect(header().getAttribute("data-header-fit")).toBeNull();
    await act(async () => {
      grow(3); // +300 px ⇒ 1100 > 900
    });
    await waitFor(() => expect(header().getAttribute("data-header-fit")).not.toBeNull());
    expect(chipIds(header())).toEqual(["critical"]);
  });
});

// ── doc 81 Đợt 3b final wave (I1) — thông tin an toàn không bị gộp im lặng ─────────────────────────
// Đo trình duyệt sau fix 1 (chips-fix1-*.json): Interlock @768/1024 "chip+3" (engine/OT trước đó vẫn hiện), Recipes HITL và
// cờ triển khai IDE/IR vào "+N" XÁM. Hợp đồng: notice GHIM không bao giờ vào "+N" (như chip ghim R-2-p); "+N" của NoticeStack
// mang tông TỆ NHẤT của phần giấu.
describe("Đợt 3b final wave (I1) — notice GHIM + '+N' tông tệ nhất", () => {
  const SAFETY: NoticeItem[] = [
    { id: "hitl", kind: "honesty", label: "HITL", content: "an toàn", pinned: true },
    { id: "w", kind: "whenToUse", content: "khi nào dùng" },
    { id: "f", kind: "flagOff", content: "cờ tắt" },
  ];
  it("header GỘP ⇒ notice ghim VẪN hiện thẳng; phần không ghim vào '+N' với tông CẢNH BÁO (có cờ tắt bị giấu)", () => {
    capacity = 250;
    render(<PageHeaderCompact title="T" chips={<NoticeStack items={SAFETY} />} />);
    const h = header();
    expect(h.getAttribute("data-header-fit")).not.toBeNull();
    expect(noticeKinds(h)).toEqual(["honesty"]);
    expect(noticeMore(h)?.getAttribute("data-notice-more")).toBe("2");
    expect(noticeMore(h)?.getAttribute("data-state")).toBe("warning");
  });

  it("notice ghim không vào '+N' kể cả khi vượt maxVisible (ngoài header)", () => {
    render(<NoticeStack maxVisible={0} items={SAFETY} />);
    const root = document.querySelector("[data-notice-stack]") as HTMLElement;
    expect(noticeKinds(root)).toEqual(["honesty"]);
    expect(noticeMore(root)?.getAttribute("data-notice-more")).toBe("2");
  });

  it("'+N' chỉ giấu thông tin (Khi nào dùng / gợi ý) ⇒ tông trung tính 'ok'; giấu notice LỖI ⇒ 'error'", () => {
    const { unmount } = render(<NoticeStack maxVisible={0} items={[NOTICES[0], NOTICES[1]]} />);
    expect(document.querySelector("[data-notice-more]")?.getAttribute("data-state")).toBe("ok");
    unmount();
    render(<NoticeStack maxVisible={0} items={[NOTICES[0], { id: "f", kind: "flagOff", content: "x" }, NOTICES[2]]} />);
    expect(document.querySelector("[data-notice-more]")?.getAttribute("data-state")).toBe("error");
  });

  it("noticeOverflowState: lỗi > cảnh báo (flagOff/honesty/simGate/beta) > đang kiểm tra > thông tin", () => {
    expect(noticeOverflowState([])).toBe("ok");
    expect(noticeOverflowState([{ kind: "hint" }, { kind: "whenToUse" }, { kind: "meta" }, { kind: "status" }])).toBe("ok");
    expect(noticeOverflowState([{ kind: "hint" }, { kind: "loading" }])).toBe("loading");
    for (const k of ["flagOff", "honesty", "simGate", "beta"] as const) expect(noticeOverflowState([{ kind: "loading" }, { kind: k }])).toBe("warning");
    expect(noticeOverflowState([{ kind: "flagOff" }, { kind: "error" }, { kind: "hint" }])).toBe("error");
  });

  it("splitNoticesForOverflow: ghim chiếm chỗ trước; chỗ còn lại ưu tiên lỗi; gộp ⇒ chỗ còn lại CHỈ cho lỗi", () => {
    const L: NoticeItem[] = [
      { id: "w", kind: "whenToUse", content: "" },
      { id: "p", kind: "flagOff", content: "", pinned: true },
      { id: "e", kind: "error", content: "" },
    ];
    const ids = (xs: NoticeItem[]) => xs.map((x) => x.id);
    expect(ids(splitNoticesForOverflow(L, 3, false).visible)).toEqual(["w", "p", "e"]);
    expect(ids(splitNoticesForOverflow(L, 2, false).visible)).toEqual(["p", "e"]);
    expect(ids(splitNoticesForOverflow(L, 3, true).visible)).toEqual(["p", "e"]);
    expect(ids(splitNoticesForOverflow(L, 1, true).visible)).toEqual(["p"]);
    expect(ids(splitNoticesForOverflow(L, 1, true).hidden)).toEqual(["w", "e"]);
  });

  it("featureStatusNoticeItem({pinned}) ⇒ off/loading/error đều GHIM, vẫn hiện khi header gộp; on ⇒ không gì", () => {
    function Stack({ status }: { status: "on" | "off" | "loading" | "error" }) {
      const { t } = useTranslation();
      return (
        <PageHeaderCompact
          title="T"
          chips={<NoticeStack items={[NOTICES[0], NOTICES[1], featureStatusNoticeItem(t, { id: "flag", status, offMessage: "tắt", pinned: true })]} />}
        />
      );
    }
    for (const [status, testId] of [["off", "feature-status-off"], ["loading", "feature-status-loading"], ["error", "feature-status-error"]] as const) {
      capacity = 250;
      const { unmount } = render(<Stack status={status} />);
      expect(header().getAttribute("data-header-fit")).not.toBeNull();
      expect(header().querySelector(`[data-notice-stack] > [data-testid="${testId}"]`)).not.toBeNull();
      unmount();
    }
    const { t } = { t: (_k: string, f: string) => f };
    expect(featureStatusNoticeItem(t, { status: "on", offMessage: "x", pinned: true })).toBeNull();
    expect(featureStatusNoticeItem(t, { status: "off", offMessage: "x" })?.pinned).toBeFalsy();
  });

  it("test gap — chip KHÔNG ghim ở trạng thái lỗi bị gộp (vd eq-conformance) ⇒ '+N' đỏ; chip ghim (tư thế) vẫn hiện", () => {
    capacity = 250;
    render(
      <PageHeaderCompact
        title="T"
        chips={
          <StatusChipStrip
            items={[chip("engine", { pinned: true, value: "OFF" }), chip("eq-conformance", { state: "error", value: undefined }), chip("x")]}
          />
        }
      />,
    );
    expect(header().getAttribute("data-header-fit")).not.toBeNull();
    expect(chipIds(header())).toEqual(["engine"]);
    expect(chipMore(header())?.getAttribute("data-chip-more")).toBe("2");
    expect(chipMore(header())?.getAttribute("data-state")).toBe("error");
  });
});
