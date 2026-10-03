// @vitest-environment jsdom
//
// Doc 81 Đợt 2 Task 3 — NoticeChip / NoticeStack / WhenToUseHint / FeatureStatusNoticeChip.
// Dựng component THẬT với i18next THẬT (vi.json) — chỉ polyfill hạ tầng jsdom (ResizeObserver).
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import vi from "@/i18n/locales/vi.json";
import { initLayoutKitTestI18n } from "./layoutKitTestI18n";
import { FeatureStatusNoticeChip, NoticeChip, NoticeStack, WhenToUseHint, type NoticeItem } from "./NoticeChip";

beforeAll(async () => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  await initLayoutKitTestI18n();
});
afterEach(() => cleanup());

describe("NoticeChip — chip 1 dòng mở popover", () => {
  it("popover ĐÓNG lúc nạp; bấm chip mới hiện nội dung; Esc đóng lại", async () => {
    render(
      <NoticeChip kind="honesty">
        <span>Số đếm từ bảng đăng ký, không phải kết nối sống.</span>
      </NoticeChip>,
    );
    const chip = screen.getByRole("button", { name: /Lưu ý số liệu/ });
    expect(chip).toHaveAttribute("data-notice-kind", "honesty");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText(/không phải kết nối sống/)).toBeNull();

    fireEvent.click(chip);
    const pop = await screen.findByRole("dialog");
    expect(within(pop).getByText(/không phải kết nối sống/)).toBeInTheDocument();

    fireEvent.keyDown(pop, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("nhãn mặc định theo loại lấy từ vi.json (khoá layoutKit.notice.kind.*)", () => {
    render(
      <>
        <NoticeChip kind="whenToUse">a</NoticeChip>
        <NoticeChip kind="simGate">b</NoticeChip>
        <NoticeChip kind="beta">c</NoticeChip>
        <NoticeChip kind="flagOff">d</NoticeChip>
      </>,
    );
    expect(screen.getByRole("button", { name: vi.layoutKit.notice.kind.whenToUse })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: vi.layoutKit.notice.kind.simGate })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: vi.layoutKit.notice.kind.beta })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: vi.layoutKit.notice.kind.flagOff })).toBeInTheDocument();
  });
});

describe("NoticeStack — gộp nhiều notice thành MỘT dải không xuống dòng", () => {
  const items: Array<NoticeItem | null | false> = [
    { id: "a", kind: "flagOff" as const, content: <p>nội dung A</p> },
    null,
    { id: "b", kind: "beta" as const, content: <p>nội dung B</p> },
    false,
    { id: "c", kind: "hint" as const, content: <p>nội dung C</p> },
    { id: "d", kind: "simGate" as const, content: <p>nội dung D</p> },
    { id: "e", kind: "honesty" as const, content: <p>nội dung E</p> },
  ];

  it("bỏ mục null/false; hiện maxVisible chip, phần dư gộp vào '+N' mở được", async () => {
    render(<NoticeStack items={items} maxVisible={3} />);
    const stack = screen.getByRole("group", { name: vi.layoutKit.notice.stackLabel });
    expect(stack.className).toMatch(/flex-nowrap/);
    const chips = stack.querySelectorAll("[data-notice-kind]");
    expect(chips).toHaveLength(3);
    const more = screen.getByRole("button", { name: "Xem thêm 2 ghi chú" });
    expect(more).toHaveTextContent("+2");
    fireEvent.click(more);
    const pop = await screen.findByRole("dialog");
    expect(within(pop).getByText("nội dung D")).toBeInTheDocument();
    expect(within(pop).getByText("nội dung E")).toBeInTheDocument();
  });

  it("không còn mục nào ⇒ không render gì (không để lại dải trống)", () => {
    const { container } = render(<NoticeStack items={[null, false, undefined]} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("WhenToUseHint — giữ KHOÁ i18n riêng từng trang", () => {
  it("popover hiện đúng câu của khoá trang trong vi.json (engineering.whenToUse), không phải câu dự phòng", async () => {
    render(<WhenToUseHint i18nKey="engineering.whenToUse" fallback="FALLBACK-KHONG-DUOC-HIEN" />);
    fireEvent.click(screen.getByRole("button", { name: vi.layoutKit.notice.kind.whenToUse }));
    const pop = await screen.findByRole("dialog");
    const p = pop.querySelector("[data-when-to-use]");
    expect(p).toHaveAttribute("data-when-to-use", "engineering.whenToUse");
    expect(p).toHaveTextContent(vi.engineering.whenToUse);
    expect(pop).not.toHaveTextContent("FALLBACK-KHONG-DUOC-HIEN");
  });
});

describe("FeatureStatusNoticeChip — 4 trạng thái của FeatureStatusGate, không gộp", () => {
  it("on ⇒ không hiện gì", () => {
    const { container } = render(<FeatureStatusNoticeChip status="on" offMessage="tắt" />);
    expect(container.innerHTML).toBe("");
  });

  it("loading ⇒ chip 'Đang kiểm tra', KHÔNG phải chip 'Đang tắt'", () => {
    render(<FeatureStatusNoticeChip status="loading" offMessage="tắt" />);
    expect(screen.getByTestId("feature-status-loading")).toHaveAttribute("data-notice-kind", "loading");
    expect(screen.queryByTestId("feature-status-off")).toBeNull();
    expect(screen.queryByTestId("feature-status-error")).toBeNull();
  });

  it("error ⇒ chip lỗi với câu lỗi chung, KHÔNG phải 'off' hay 'on'", async () => {
    render(<FeatureStatusNoticeChip status="error" offMessage="tắt" />);
    const chip = screen.getByTestId("feature-status-error");
    expect(chip).toHaveAttribute("data-notice-kind", "error");
    expect(screen.queryByTestId("feature-status-off")).toBeNull();
    fireEvent.click(chip);
    const pop = await screen.findByRole("dialog");
    expect(within(pop).getByRole("alert")).toHaveTextContent(vi.common.featureStatusError);
  });

  it("off ⇒ chip 'Đang tắt', popover hiện đúng câu tắt của trang", async () => {
    render(<FeatureStatusNoticeChip status="off" offMessage="Chế độ xem trước: tích hợp đang tắt." />);
    const chip = screen.getByTestId("feature-status-off");
    expect(chip).toHaveAccessibleName(vi.layoutKit.notice.kind.flagOff);
    fireEvent.click(chip);
    expect(await screen.findByText("Chế độ xem trước: tích hợp đang tắt.")).toBeInTheDocument();
  });
});

// ── Fix round 1 — notice lỗi không bị gộp vào "+N" ──────────────────────────────────────────────
describe("NoticeStack — lỗi luôn hiện", () => {
  it("maxVisible=1, notice lỗi đứng cuối ⇒ chip hiện ra là chip lỗi", () => {
    render(
      <NoticeStack
        maxVisible={1}
        items={[
          { id: "a", kind: "beta", content: <p>a</p> },
          { id: "b", kind: "hint", content: <p>b</p> },
          { id: "z", kind: "error", content: <p>lỗi</p> },
        ]}
      />,
    );
    const stack = screen.getByRole("group", { name: vi.layoutKit.notice.stackLabel });
    const shown = [...stack.querySelectorAll(":scope > [data-notice-kind]")].map((x) => x.getAttribute("data-notice-kind"));
    expect(shown).toEqual(["error"]);
  });
});

// ── Doc 81 Đợt 2 Task 8 — trang có HAI cờ (Safety: kiểm định an toàn + nhân lực): chip nói cờ NÀO ─────────
describe("FeatureStatusNoticeChip — `subject` gọi tên cờ trong nhãn chip (4 trạng thái giữ nguyên)", () => {
  it("subject ⇒ nhãn '<cờ>: <trạng thái>' ở loading / off / error; on vẫn không hiện gì", () => {
    const { rerender, container } = render(<FeatureStatusNoticeChip status="loading" subject="Nhân lực" offMessage="tắt" />);
    expect(screen.getByTestId("feature-status-loading")).toHaveAccessibleName(`Nhân lực: ${vi.layoutKit.notice.kind.loading}`);
    rerender(<FeatureStatusNoticeChip status="off" subject="Nhân lực" offMessage="tắt" />);
    expect(screen.getByTestId("feature-status-off")).toHaveAccessibleName(`Nhân lực: ${vi.layoutKit.notice.kind.flagOff}`);
    rerender(<FeatureStatusNoticeChip status="error" subject="Nhân lực" offMessage="tắt" />);
    expect(screen.getByTestId("feature-status-error")).toHaveAccessibleName(`Nhân lực: ${vi.layoutKit.notice.kind.error}`);
    rerender(<FeatureStatusNoticeChip status="on" subject="Nhân lực" offMessage="tắt" />);
    expect(container.innerHTML).toBe("");
  });
});
