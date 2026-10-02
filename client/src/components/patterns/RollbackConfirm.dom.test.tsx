// @vitest-environment jsdom
//
// Doc 81 Đợt 2 Task 3 — RollbackConfirm dựng trên ConfirmWithReason (lý do bắt buộc + độ dài tối
// thiểu) và useStepUpOtp (OTP TƯƠI mỗi lượt — `deployProcedure` → `requirePerCallFreshTotp`).
// Hợp đồng giữ nguyên từ Orchestration rollback (doc 80 ORC-05): lý do ≥ min, OTP 6 số được hỏi
// SAU khi xác nhận, huỷ OTP ⇒ KHÔNG gọi mutation, lượt sau phải hỏi OTP lại từ đầu.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import VI from "@/i18n/locales/vi.json";
import { initLayoutKitTestI18n } from "./layoutKitTestI18n";
import { RollbackConfirm } from "./RollbackConfirm";

const toastSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/trpcErrors", () => ({ toastTrpcError: (e: unknown) => { toastSpy(e); return "x"; } }));

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

type ReasonModeProps = Extract<React.ComponentProps<typeof RollbackConfirm>, { minReasonLength: number }>;
function renderIt(props: Partial<ReasonModeProps> = {}) {
  const onRollback = vi.fn();
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
  fireEvent.change(within(dlg).getByLabelText(VI.confirmWithReason.reasonLabel), { target: { value: reason } });
  return dlg;
}

async function confirmFinal() {
  const dlg = await screen.findByRole("dialog", { name: VI.confirmWithReason.finalTitle });
  fireEvent.click(within(dlg).getByRole("button", { name: VI.layoutKit.rollback.action }));
}

async function typeOtp(code: string) {
  const otpDlg = await screen.findByRole("dialog", { name: VI.stepUp.title });
  const input = otpDlg.querySelector("input") as HTMLInputElement;
  fireEvent.change(input, { target: { value: code } });
  return otpDlg;
}

describe("RollbackConfirm — lý do tối thiểu (ConfirmWithReason)", () => {
  it("lý do ngắn hơn minReasonLength ⇒ 'Tiếp tục' bị khoá; đủ độ dài mới qua", async () => {
    renderIt({ minReasonLength: 5 });
    const dlg = await passReasonStep("abcd");
    expect(within(dlg).getByRole("button", { name: VI.confirmWithReason.continue })).toBeDisabled();
    expect(within(dlg).getByText("Lý do cần tối thiểu 5 ký tự")).toBeInTheDocument();
    fireEvent.change(within(dlg).getByLabelText(VI.confirmWithReason.reasonLabel), { target: { value: "abcde" } });
    expect(within(dlg).getByRole("button", { name: VI.confirmWithReason.continue })).toBeEnabled();
  });

  it("hiện impact nói rõ cần OTP khi requireOtp", async () => {
    renderIt();
    const dlg = await passReasonStep("");
    expect(within(dlg).getByRole("alert")).toHaveTextContent(VI.layoutKit.rollback.impactOtp);
  });
});

describe("RollbackConfirm — OTP tươi mỗi lượt", () => {
  it("xác nhận ⇒ hỏi OTP; nhập 6 số ⇒ onRollback({reason, totpCode})", async () => {
    const onRollback = renderIt();
    const dlg = await passReasonStep("lỗi recipe");
    fireEvent.click(within(dlg).getByRole("button", { name: VI.confirmWithReason.continue }));
    await confirmFinal();
    expect(onRollback).not.toHaveBeenCalled();
    await typeOtp("123456");
    await waitFor(() => expect(onRollback).toHaveBeenCalledTimes(1));
    expect(onRollback).toHaveBeenCalledWith({ reason: "lỗi recipe", totpCode: "123456" });
  });

  it("huỷ OTP ⇒ KHÔNG gọi onRollback", async () => {
    const onRollback = renderIt();
    const dlg = await passReasonStep("lỗi recipe");
    fireEvent.click(within(dlg).getByRole("button", { name: VI.confirmWithReason.continue }));
    await confirmFinal();
    const otpDlg = await screen.findByRole("dialog", { name: VI.stepUp.title });
    fireEvent.click(within(otpDlg).getByRole("button", { name: VI.common.cancel }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: VI.stepUp.title })).toBeNull());
    expect(onRollback).not.toHaveBeenCalled();
  });

  it("lượt thứ hai hỏi OTP LẠI với ô trống — không dùng lại mã cũ", async () => {
    const onRollback = renderIt();
    for (const [reason, code] of [["lượt một", "111111"], ["lượt hai", "222222"]] as const) {
      const dlg = await passReasonStep(reason);
      fireEvent.click(within(dlg).getByRole("button", { name: VI.confirmWithReason.continue }));
      await confirmFinal();
      const otpDlg = await screen.findByRole("dialog", { name: VI.stepUp.title });
      expect((otpDlg.querySelector("input") as HTMLInputElement).value).toBe("");
      await typeOtp(code);
      await waitFor(() => expect(screen.queryByRole("dialog", { name: VI.stepUp.title })).toBeNull());
    }
    expect(onRollback.mock.calls).toEqual([
      [{ reason: "lượt một", totpCode: "111111" }],
      [{ reason: "lượt hai", totpCode: "222222" }],
    ]);
  });

  it("requireOtp=false ⇒ gọi thẳng onRollback({reason}) sau xác nhận, không hỏi OTP", async () => {
    const onRollback = renderIt({ requireOtp: false });
    const dlg = await passReasonStep("về bản golden");
    expect(within(dlg).getByRole("alert")).toHaveTextContent(VI.layoutKit.rollback.impactNoOtp);
    fireEvent.click(within(dlg).getByRole("button", { name: VI.confirmWithReason.continue }));
    await confirmFinal();
    await waitFor(() => expect(onRollback).toHaveBeenCalledWith({ reason: "về bản golden" }));
    expect(screen.queryByRole("dialog", { name: VI.stepUp.title })).toBeNull();
  });

  it("disabled ⇒ không mở được", () => {
    renderIt({ disabled: true });
    fireEvent.click(screen.getByRole("button", { name: "Khôi phục v3" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

// ── Fix round 1 (Ruling R-2-g) — hợp đồng HIỆN TẠI của từng trang phải giữ được ─────────────────
describe("RollbackConfirm requireReason=false — AlertDialog không lý do (Workspace/Recipes/EqIntegration)", () => {
  function renderNoReason(requireOtp: boolean, onRollback = vi.fn()) {
    render(
      <RollbackConfirm
        versionLabel="v3"
        requireReason={false}
        requireOtp={requireOtp}
        description="Ghi một deployment MỚI về build trước."
        onRollback={onRollback}
        trigger={<button type="button">Khôi phục v3</button>}
      />,
    );
    return onRollback;
  }

  it("không ô lý do; là alertdialog; xác nhận ⇒ OTP (khi requireOtp) ⇒ onRollback({totpCode}) không có reason", async () => {
    const onRollback = renderNoReason(true);
    fireEvent.click(screen.getByRole("button", { name: "Khôi phục v3" }));
    const dlg = await screen.findByRole("alertdialog", { name: "Khôi phục về v3?" });
    expect(within(dlg).queryByLabelText(VI.confirmWithReason.reasonLabel)).toBeNull();
    expect(within(dlg).getByText("Ghi một deployment MỚI về build trước.")).toBeInTheDocument();
    fireEvent.click(within(dlg).getByRole("button", { name: VI.layoutKit.rollback.action }));
    expect(onRollback).not.toHaveBeenCalled();
    await typeOtp("654321");
    await waitFor(() => expect(onRollback).toHaveBeenCalledWith({ totpCode: "654321" }));
  });

  it("không lý do, không OTP (Recipes/EqIntegration hôm nay) ⇒ xác nhận gọi thẳng onRollback({})", async () => {
    const onRollback = renderNoReason(false);
    fireEvent.click(screen.getByRole("button", { name: "Khôi phục v3" }));
    const dlg = await screen.findByRole("alertdialog");
    fireEvent.click(within(dlg).getByRole("button", { name: VI.layoutKit.rollback.action }));
    await waitFor(() => expect(onRollback).toHaveBeenCalledWith({}));
    expect(screen.queryByRole("dialog", { name: VI.stepUp.title })).toBeNull();
  });

  it("Huỷ ⇒ không gọi gì", async () => {
    const onRollback = renderNoReason(false);
    fireEvent.click(screen.getByRole("button", { name: "Khôi phục v3" }));
    const dlg = await screen.findByRole("alertdialog");
    fireEvent.click(within(dlg).getByRole("button", { name: VI.common.cancel }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(onRollback).not.toHaveBeenCalled();
  });
});

describe("RollbackConfirm — confirmText và lỗi không bị nuốt", () => {
  it("riskLevel=high + confirmText ⇒ phải gõ đúng chuỗi của trang", async () => {
    renderIt({ riskLevel: "high", confirmText: "ROLLBACK" });
    const dlg = await passReasonStep("lý do đủ dài");
    fireEvent.click(within(dlg).getByRole("button", { name: VI.confirmWithReason.continue }));
    const fin = await screen.findByRole("dialog", { name: VI.confirmWithReason.finalTitle });
    const btn = within(fin).getByRole("button", { name: VI.layoutKit.rollback.action });
    expect(btn).toBeDisabled();
    fireEvent.change(within(fin).getByPlaceholderText("ROLLBACK"), { target: { value: "ROLLBACK" } });
    expect(btn).toBeEnabled();
  });

  it("onRollback reject sau OTP ⇒ lỗi đi qua toastTrpcError (không unhandled rejection)", async () => {
    toastSpy.mockClear();
    const err = new Error("FORBIDDEN");
    renderIt({ onRollback: vi.fn().mockRejectedValue(err) });
    const dlg = await passReasonStep("lỗi recipe");
    fireEvent.click(within(dlg).getByRole("button", { name: VI.confirmWithReason.continue }));
    await confirmFinal();
    await typeOtp("123456");
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(err));
  });

  it("requireReason=false: onRollback reject ⇒ toastTrpcError", async () => {
    toastSpy.mockClear();
    const err = new Error("X");
    render(
      <RollbackConfirm
        versionLabel="v3"
        requireReason={false}
        requireOtp={false}
        onRollback={vi.fn().mockRejectedValue(err)}
        trigger={<button type="button">Khôi phục v3</button>}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Khôi phục v3" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: VI.layoutKit.rollback.action }));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(err));
  });
});
