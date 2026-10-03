// @vitest-environment jsdom
//
// Doc 81 Đợt 2 Task 3 — DetailSheet (khung chi tiết có tab) và WizardDialog (bước, trạng thái bước,
// quay lại/tiếp). DetailSheet là KHUNG — đặt trong một lớp FlyoutHost hoặc trong panel chi tiết của
// SplitListDetail. Tab có thể `keepMounted` để không huỷ tiến trình đang sống (Review Focus 3).
import { afterEach, beforeAll, describe, expect, it, vi as vitestVi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import vi from "@/i18n/locales/vi.json";
import { initLayoutKitTestI18n } from "./layoutKitTestI18n";
import { DetailSheet } from "./DetailSheet";
import { WizardDialog, type WizardStep } from "./WizardDialog";

beforeAll(async () => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  await initLayoutKitTestI18n();
});
afterEach(() => cleanup());

function Counter() {
  const [n, setN] = useState(0);
  return (
    <button type="button" onClick={() => setN(n + 1)}>
      đếm {n}
    </button>
  );
}

describe("DetailSheet", () => {
  const tabs = [
    { value: "overview", label: "Tổng quan", content: <p>nội dung tổng quan</p> },
    { value: "live", label: "Đang chạy", content: <Counter />, keepMounted: true },
    { value: "history", label: "Lịch sử", content: <Counter /> },
  ];

  it("header + tablist có nhãn; tab đầu mặc định; bấm tab đổi nội dung", async () => {
    const user = userEvent.setup();
    render(<DetailSheet title="ECN-0003" subtitle="Đổi keo" status={<span>Đang xem xét</span>} tabs={tabs} />);
    expect(screen.getByRole("heading", { name: "ECN-0003" })).toBeInTheDocument();
    const list = screen.getByRole("tablist", { name: vi.layoutKit.detail.tabs });
    expect(within(list).getByRole("tab", { name: "Tổng quan" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("nội dung tổng quan")).toBeVisible();
    await user.click(within(list).getByRole("tab", { name: "Lịch sử" }));
    expect(screen.getByRole("tab", { name: "Lịch sử" })).toHaveAttribute("aria-selected", "true");
  });

  it("phím mũi tên chuyển tab (Radix Tabs)", async () => {
    const user = userEvent.setup();
    render(<DetailSheet title="T" tabs={tabs} />);
    screen.getByRole("tab", { name: "Tổng quan" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Đang chạy" })).toHaveAttribute("aria-selected", "true");
  });

  it("tab keepMounted GIỮ state khi chuyển đi rồi quay lại; tab thường thì không", async () => {
    const user = userEvent.setup();
    render(<DetailSheet title="T" tabs={tabs} />);
    await user.click(screen.getByRole("tab", { name: "Đang chạy" }));
    await user.click(screen.getByRole("button", { name: "đếm 0" }));
    await user.click(screen.getByRole("button", { name: "đếm 1" }));
    await user.click(screen.getByRole("tab", { name: "Tổng quan" }));
    // Tab sống vẫn MOUNT nhưng bị ẩn (hidden) khi không được chọn — không chen vào tab đang xem.
    const sleeping = screen.getByRole("button", { name: "đếm 2", hidden: true });
    expect(sleeping).toBeInTheDocument();
    expect(sleeping).not.toBeVisible();
    expect(screen.getByText("nội dung tổng quan")).toBeVisible();
    await user.click(screen.getByRole("tab", { name: "Đang chạy" }));
    expect(screen.getByRole("button", { name: "đếm 2" })).toBeVisible();

    await user.click(screen.getByRole("tab", { name: "Lịch sử" }));
    const hist = screen.getByRole("tabpanel", { name: "Lịch sử" });
    await user.click(within(hist).getByRole("button", { name: "đếm 0" }));
    await user.click(screen.getByRole("tab", { name: "Tổng quan" }));
    await user.click(screen.getByRole("tab", { name: "Lịch sử" }));
    expect(within(screen.getByRole("tabpanel", { name: "Lịch sử" })).getByRole("button", { name: "đếm 0" })).toBeInTheDocument();
  });

  it("điều khiển từ ngoài (value + onValueChange)", async () => {
    const onChange = vitestVi.fn();
    const user = userEvent.setup();
    render(<DetailSheet title="T" tabs={tabs} value="history" onValueChange={onChange} />);
    expect(screen.getByRole("tab", { name: "Lịch sử" })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("tab", { name: "Tổng quan" }));
    expect(onChange).toHaveBeenCalledWith("overview");
  });
});

describe("WizardDialog", () => {
  function steps(over: Partial<Record<string, Partial<WizardStep>>> = {}): WizardStep[] {
    return [
      { id: "target", title: "Chọn máy", content: <p>bước máy</p>, canProceed: true, ...over.target },
      { id: "canary", title: "Canary", content: <p>bước canary</p>, canProceed: true, ...over.canary },
      { id: "review", title: "Xem lại", content: <p>bước xem lại</p>, canProceed: true, ...over.review },
    ];
  }

  function renderWizard(props: Partial<React.ComponentProps<typeof WizardDialog>> = {}) {
    const onFinish = vitestVi.fn();
    const onOpenChange = vitestVi.fn();
    const r = render(<WizardDialog open onOpenChange={onOpenChange} title="Triển khai" steps={steps()} onFinish={onFinish} {...props} />);
    return { onFinish, onOpenChange, ...r };
  }

  it("bước 1 là 'đang làm', các bước sau 'chưa tới'; 'Quay lại' khoá ở bước đầu; có 'Bước 1/3'", () => {
    renderWizard();
    const sheet = screen.getByRole("dialog", { name: "Triển khai" });
    const list = within(sheet).getByRole("list", { name: vi.layoutKit.wizard.stepsLabel });
    const items = within(list).getAllByRole("listitem");
    expect(items[0]).toHaveAttribute("aria-current", "step");
    expect(items[0]).toHaveAttribute("data-step-status", "current");
    expect(items[1]).toHaveAttribute("data-step-status", "upcoming");
    expect(within(sheet).getByText("Bước 1/3")).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: vi.layoutKit.wizard.back })).toBeDisabled();
    expect(within(sheet).getByText("bước máy")).toBeInTheDocument();
  });

  it("canProceed=false khoá 'Tiếp'; tiếp ⇒ bước trước 'đã xong'; quay lại hoạt động", () => {
    const { rerender, onFinish, onOpenChange } = renderWizard({ steps: steps({ target: { canProceed: false } }) });
    const sheet = () => screen.getByRole("dialog");
    expect(within(sheet()).getByRole("button", { name: vi.layoutKit.wizard.next })).toBeDisabled();
    rerender(<WizardDialog open onOpenChange={onOpenChange} title="Triển khai" steps={steps()} onFinish={onFinish} />);
    fireEvent.click(within(sheet()).getByRole("button", { name: vi.layoutKit.wizard.next }));
    const items = within(sheet()).getAllByRole("listitem");
    expect(items[0]).toHaveAttribute("data-step-status", "complete");
    expect(items[1]).toHaveAttribute("aria-current", "step");
    expect(within(sheet()).getByText("bước canary")).toBeInTheDocument();
    fireEvent.click(within(sheet()).getByRole("button", { name: vi.layoutKit.wizard.back }));
    expect(within(sheet()).getByText("bước máy")).toBeInTheDocument();
  });

  it("bước cuối có 'Hoàn tất' gọi onFinish; bước có lỗi hiện 'có lỗi'", async () => {
    const { onFinish } = renderWizard({ steps: steps({ canary: { error: true } }) });
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getAllByRole("listitem")[1]).toHaveAttribute("data-step-status", "error");
    fireEvent.click(within(sheet).getByRole("button", { name: vi.layoutKit.wizard.next }));
    fireEvent.click(within(sheet).getByRole("button", { name: vi.layoutKit.wizard.next }));
    expect(within(sheet).queryByRole("button", { name: vi.layoutKit.wizard.next })).toBeNull();
    fireEvent.click(within(sheet).getByRole("button", { name: vi.layoutKit.wizard.finish }));
    await waitFor(() => expect(onFinish).toHaveBeenCalledTimes(1));
  });

  it("pending khoá 'Hoàn tất' (không bấm hai lần)", () => {
    renderWizard({ pending: true, steps: [{ id: "only", title: "Một", content: <p>x</p>, canProceed: true }] });
    expect(screen.getByRole("button", { name: vi.layoutKit.wizard.finish })).toBeDisabled();
  });

  it("dirty ⇒ Esc hỏi trước khi đóng; 'Tiếp tục sửa' giữ wizard mở", async () => {
    const { onOpenChange } = renderWizard({ dirty: true });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    const confirm = await screen.findByRole("alertdialog", { name: vi.layoutKit.flyout.unsavedTitle });
    expect(onOpenChange).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: vi.layoutKit.flyout.discard }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("không dirty ⇒ Esc đóng ngay", () => {
    const { onOpenChange } = renderWizard();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  // doc 81 Đợt 2 Task 13 — trang (IDE) cần nút Hoàn tất mang testid/nhãn riêng của hành động cuối (Deploy build /
  // Gửi yêu cầu / Triển khai canary) và lý do khoá (title) như nút cũ. Tuỳ chọn, mặc định = hôm nay.
  it("finishTestId + finishTitle gắn lên nút Hoàn tất; không truyền ⇒ không có", () => {
    const one = [{ id: "only", title: "Một", content: <p>x</p>, canProceed: false }];
    const { rerender, onFinish, onOpenChange } = renderWizard({ steps: one, finishTestId: "nut-cuoi", finishTitle: "Cần quyền machine_control", finishLabel: "Deploy build" });
    const b = screen.getByTestId("nut-cuoi");
    expect(b).toHaveAccessibleName("Deploy build");
    expect(b).toHaveAttribute("title", "Cần quyền machine_control");
    expect(b).toBeDisabled();
    rerender(<WizardDialog open onOpenChange={onOpenChange} title="Triển khai" steps={one} onFinish={onFinish} />);
    const plain = screen.getByRole("button", { name: vi.layoutKit.wizard.finish });
    expect(plain).not.toHaveAttribute("data-testid");
    expect(plain).not.toHaveAttribute("title");
  });

  it("mở lại ⇒ về bước 1", () => {
    const { rerender, onFinish, onOpenChange } = renderWizard();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: vi.layoutKit.wizard.next }));
    expect(screen.getByText("bước canary")).toBeInTheDocument();
    rerender(<WizardDialog open={false} onOpenChange={onOpenChange} title="Triển khai" steps={steps()} onFinish={onFinish} />);
    rerender(<WizardDialog open onOpenChange={onOpenChange} title="Triển khai" steps={steps()} onFinish={onFinish} />);
    expect(screen.getByText("bước máy")).toBeInTheDocument();
  });
});
