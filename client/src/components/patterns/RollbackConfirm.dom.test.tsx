// @vitest-environment jsdom
//
// Doc 81 Đợt 2 Task 3 — RollbackConfirm dựng trên ConfirmWithReason (lý do bắt buộc + độ dài tối
// thiểu) và useStepUpOtp (OTP TƯƠI mỗi lượt — `deployProcedure` → `requirePerCallFreshTotp`).
// Hợp đồng giữ nguyên từ Orchestration rollback (doc 80 ORC-05): lý do ≥ min, OTP 6 số được hỏi
// SAU khi xác nhận, huỷ OTP ⇒ KHÔNG gọi mutation, lượt sau phải hỏi OTP lại từ đầu.
import { afterEach, beforeAll, describe, expect, it, vi as vitestVi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import vi from "@/i18n/locales/vi.json";
import { initLayoutKitTestI18n } from "./layoutKitTestI18n";
import { RollbackConfirm } from "./RollbackConfirm";

beforeAll(async () => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // input-otp gọi document.elementFromPoint (jsdom không có).
  (document as unknown as { elementFromPoint: () => null }).elementFromPoint ??= () => null;
  await initLayoutKitTestI18n();
});
afterEach(() => cleanup());

function renderIt(props: Partial<React.ComponentProps<typeof RollbackConfirm>> = {}) {
  const onRollback = vitestVi.fn();
  render(
    <RollbackConfirm
      versionLabel="v3"
      requireOtp
      minReasonLength={3}
      onRollback={onRollback}
      trigger={<button type="button">Khôi phục v3</button>}
      {...props}
    />,
  );
  return onRollback;
}

async function passReasonStep(reason: string) {
  fireEvent.click(screen.getByRole("button", { name: "Khôi phục v3" }));
  const dlg = await screen.findByRole("dialog", { name: "Khôi phục về v3?" });
  fireEvent.change(within(dlg).getByLabelText(vi.confirmWithReason.reasonLabel), { target: { value: reason } });
  return dlg;
}

async function confirmFinal() {
  const dlg = await screen.findByRole("dialog", { name: vi.confirmWithReason.finalTitle });
  fireEvent.click(within(dlg).getByRole("button", { name: vi.layoutKit.rollback.action }));
}

async function typeOtp(code: string) {
  const otpDlg = await screen.findByRole("dialog", { name: vi.stepUp.title });
  const input = otpDlg.querySelector("input") as HTMLInputElement;
  fireEvent.change(input, { target: { value: code } });
  return otpDlg;
}

describe("RollbackConfirm — lý do tối thiểu (ConfirmWithReason)", () => {
  it("lý do ngắn hơn minReasonLength ⇒ 'Tiếp tục' bị khoá; đủ độ dài mới qua", async () => {
    renderIt({ minReasonLength: 5 });
    const dlg = await passReasonStep("abcd");
    expect(within(dlg).getByRole("button", { name: vi.confirmWithReason.continue })).toBeDisabled();
    expect(within(dlg).getByText("Lý do cần tối thiểu 5 ký tự")).toBeInTheDocument();
    fireEvent.change(within(dlg).getByLabelText(vi.confirmWithReason.reasonLabel), { target: { value: "abcde" } });
    expect(within(dlg).getByRole("button", { name: vi.confirmWithReason.continue })).toBeEnabled();
  });

  it("hiện impact nói rõ cần OTP khi requireOtp", async () => {
    renderIt();
    const dlg = await passReasonStep("");
    expect(within(dlg).getByRole("alert")).toHaveTextContent(vi.layoutKit.rollback.impactOtp);
  });
});

describe("RollbackConfirm — OTP tươi mỗi lượt", () => {
  it("xác nhận ⇒ hỏi OTP; nhập 6 số ⇒ onRollback({reason, totpCode})", async () => {
    const onRollback = renderIt();
    const dlg = await passReasonStep("lỗi recipe");
    fireEvent.click(within(dlg).getByRole("button", { name: vi.confirmWithReason.continue }));
    await confirmFinal();
    expect(onRollback).not.toHaveBeenCalled();
    await typeOtp("123456");
    await waitFor(() => expect(onRollback).toHaveBeenCalledTimes(1));
    expect(onRollback).toHaveBeenCalledWith({ reason: "lỗi recipe", totpCode: "123456" });
  });

  it("huỷ OTP ⇒ KHÔNG gọi onRollback", async () => {
    const onRollback = renderIt();
    const dlg = await passReasonStep("lỗi recipe");
    fireEvent.click(within(dlg).getByRole("button", { name: vi.confirmWithReason.continue }));
    await confirmFinal();
    const otpDlg = await screen.findByRole("dialog", { name: vi.stepUp.title });
    fireEvent.click(within(otpDlg).getByRole("button", { name: vi.common.cancel }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: vi.stepUp.title })).toBeNull());
    expect(onRollback).not.toHaveBeenCalled();
  });

  it("lượt thứ hai hỏi OTP LẠI với ô trống — không dùng lại mã cũ", async () => {
    const onRollback = renderIt();
    for (const [reason, code] of [["lượt một", "111111"], ["lượt hai", "222222"]] as const) {
      const dlg = await passReasonStep(reason);
      fireEvent.click(within(dlg).getByRole("button", { name: vi.confirmWithReason.continue }));
      await confirmFinal();
      const otpDlg = await screen.findByRole("dialog", { name: vi.stepUp.title });
      expect((otpDlg.querySelector("input") as HTMLInputElement).value).toBe("");
      await typeOtp(code);
      await waitFor(() => expect(screen.queryByRole("dialog", { name: vi.stepUp.title })).toBeNull());
    }
    expect(onRollback.mock.calls).toEqual([
      [{ reason: "lượt một", totpCode: "111111" }],
      [{ reason: "lượt hai", totpCode: "222222" }],
    ]);
  });

  it("requireOtp=false ⇒ gọi thẳng onRollback({reason}) sau xác nhận, không hỏi OTP", async () => {
    const onRollback = renderIt({ requireOtp: false });
    const dlg = await passReasonStep("về bản golden");
    expect(within(dlg).getByRole("alert")).toHaveTextContent(vi.layoutKit.rollback.impactNoOtp);
    fireEvent.click(within(dlg).getByRole("button", { name: vi.confirmWithReason.continue }));
    await confirmFinal();
    await waitFor(() => expect(onRollback).toHaveBeenCalledWith({ reason: "về bản golden" }));
    expect(screen.queryByRole("dialog", { name: vi.stepUp.title })).toBeNull();
  });

  it("disabled ⇒ không mở được", () => {
    renderIt({ disabled: true });
    fireEvent.click(screen.getByRole("button", { name: "Khôi phục v3" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
