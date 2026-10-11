// @vitest-environment jsdom
//
// doc 81 Đợt 3 Task 0 (O1, browser check 2026-10-05) — sau "Huỷ" trên hộp OTP, focus rơi về <body> trong khi wizard
// (modal) vẫn mở. Gốc: hộp OTP mở bằng mã (không có DialogTrigger) nên Radix trả focus về `triggerRef` = null. Hợp đồng:
// đóng hộp OTP (Huỷ / Esc) ⇒ focus về đúng phần tử đã mở nó (nút xác nhận của wizard), nếu nó còn trong DOM.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, d?: unknown) => (typeof d === "string" ? d : k) }),
}));

import { useStepUpOtp, stepUpModeFromPreviewGates, type StepUpOtpMode } from "./StepUpOtpDialog";

function Harness({ onRun, explicit = false }: { onRun: (code: string) => void; explicit?: boolean }) {
  const stepUp = useStepUpOtp();
  return (
    <div>
      <button type="button" onClick={() => stepUp.guard(onRun, explicit ? { returnFocus: document.getElementById("dich") } : undefined)}>
        Triển khai build
      </button>
      <button type="button" id="dich">khác</button>
      {stepUp.dialog}
    </div>
  );
}

beforeAll(() => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // input-otp đọc document.elementFromPoint (jsdom không có)
  (document as unknown as { elementFromPoint?: unknown }).elementFromPoint ??= () => null;
});
afterEach(() => cleanup());

describe("useStepUpOtp — trả focus về nút đã mở hộp OTP", () => {
  it("Huỷ ⇒ focus về nút mở; không chạy lệnh", async () => {
    const run = vi.fn();
    render(<Harness onRun={run} />);
    const opener = screen.getByRole("button", { name: "Triển khai build" });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Huỷ" }));
      await new Promise((r) => setTimeout(r, 10)); // Radix FocusScope trả focus trong setTimeout(0)
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(run).not.toHaveBeenCalled();
  });

  it("Esc ⇒ focus về nút mở", async () => {
    render(<Harness onRun={vi.fn()} />);
    const opener = screen.getByRole("button", { name: "Triển khai build" });
    opener.focus();
    fireEvent.click(opener);
    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("nút mở đã rời DOM ⇒ không ném, không cố focus phần tử chết", async () => {
    render(<Harness onRun={vi.fn()} />);
    const opener = screen.getByRole("button", { name: "Triển khai build" });
    opener.focus();
    fireEvent.click(opener);
    // Final wave (Task 0 minor 6) — khẳng định cũ (`activeElement !== opener`) KHÔNG THỂ đỏ: nút đã gỡ không bao giờ là
    // activeElement. Đo đúng điều hợp đồng nói: KHÔNG gọi focus() lên phần tử đã rời DOM.
    const focusSpy = vi.spyOn(opener, "focus");
    opener.remove();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Huỷ" }));
      await new Promise((r) => setTimeout(r, 10)); // Radix FocusScope trả focus trong setTimeout(0)
    });
    expect(focusSpy).not.toHaveBeenCalled();
  });

  // Final wave (Task 0 minor 5) — Safari/macOS: bấm chuột KHÔNG focus nút ⇒ lúc guard() chạy activeElement là <body>.
  it("Safari: nút KHÔNG được focus khi bấm (activeElement = body) ⇒ vẫn trả focus về nút vừa bấm", async () => {
    render(<Harness onRun={vi.fn()} />);
    const opener = screen.getByRole("button", { name: "Triển khai build" });
    (document.activeElement as HTMLElement | null)?.blur?.();
    expect(document.activeElement).toBe(document.body);
    fireEvent.pointerDown(opener);
    fireEvent.click(opener);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Huỷ" }));
      await new Promise((r) => setTimeout(r, 10));
    });
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("đích tường minh `guard(run, { returnFocus })` thắng activeElement", async () => {
    render(<Harness onRun={vi.fn()} explicit />);
    const opener = screen.getByRole("button", { name: "Triển khai build" });
    opener.focus();
    fireEvent.click(opener);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Huỷ" }));
      await new Promise((r) => setTimeout(r, 10));
    });
    // chờ có giới hạn (waitFor, 1 s): dưới tải song song, FocusScope của Radix trả focus muộn hơn 10 ms (đo: 1 lượt đỏ trong lượt quét)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "khác" })));
  });
});

// doc 81 Đợt 7 task L fix 1 — Ruling R-7-c: server báo step-up TẮT (hoặc bỏ qua cho người gọi ở chế độ nội bộ) ⇒ hộp xác
// nhận KHÔNG có ô OTP, nói rõ không cần OTP, Xác nhận gửi lệnh với mã rỗng (server không đọc). Quyết định lấy từ cổng
// `twoFactor` của deployPreview; không xác định được ⇒ HỎI OTP như cũ.
describe("R-7-c — stepUpModeFromPreviewGates (nguồn: cổng twoFactor của server)", () => {
  it("stepUpOff ⇒ stepUpOff; stepUpBypassedInternalMode ⇒ stepUpBypassed; otpRequired ⇒ required", () => {
    expect(stepUpModeFromPreviewGates([{ name: "role", ok: true, reason: "roleAllowed" }, { name: "twoFactor", ok: true, reason: "stepUpOff" }])).toBe("stepUpOff");
    expect(stepUpModeFromPreviewGates([{ name: "twoFactor", ok: true, reason: "stepUpBypassedInternalMode" }])).toBe("stepUpBypassed");
    expect(stepUpModeFromPreviewGates([{ name: "twoFactor", ok: true, reason: "otpRequired" }])).toBe("required");
  });
  it("không xác định được ⇒ required (hỏng theo hướng HỎI)", () => {
    expect(stepUpModeFromPreviewGates(undefined)).toBe("required");
    expect(stepUpModeFromPreviewGates(null)).toBe("required");
    expect(stepUpModeFromPreviewGates("stepUpOff")).toBe("required");
    expect(stepUpModeFromPreviewGates([])).toBe("required");
    expect(stepUpModeFromPreviewGates([{ name: "buildOk", ok: true, reason: "stepUpOff" }])).toBe("required");
    expect(stepUpModeFromPreviewGates([{ name: "twoFactor", ok: false, reason: "stepUpOff" }])).toBe("required");
    expect(stepUpModeFromPreviewGates([{ name: "twoFactor", ok: "true", reason: "stepUpOff" }])).toBe("required");
    expect(stepUpModeFromPreviewGates([{ name: "twoFactor", ok: false, reason: "twoFactorNotSetUp", effect: "block" }])).toBe("required");
    expect(stepUpModeFromPreviewGates([{ name: "twoFactor", ok: true, reason: "somethingNew" }])).toBe("required");
  });
});

describe("R-7-c — hộp xác nhận không OTP khi server nói step-up tắt", () => {
  function ModeHarness({ onRun, mode }: { onRun: (code: string) => void; mode?: StepUpOtpMode }) {
    const stepUp = useStepUpOtp();
    return (
      <div>
        <button type="button" onClick={() => stepUp.guard(onRun, mode ? { mode } : undefined)}>Triển khai build</button>
        {stepUp.dialog}
      </div>
    );
  }
  const otpInput = () => document.querySelector('input[autocomplete="one-time-code"]');

  it("stepUpOff ⇒ KHÔNG có ô OTP, câu 'step-up đang TẮT — không cần mã OTP', Xác nhận bật và gửi lệnh với mã rỗng MỘT lần", async () => {
    const run = vi.fn();
    render(<ModeHarness onRun={run} mode="stepUpOff" />);
    fireEvent.click(screen.getByRole("button", { name: "Triển khai build" }));
    const dlg = screen.getByRole("dialog");
    expect(otpInput()).toBeNull();
    expect(dlg).toHaveTextContent(/TẮT/);
    expect(dlg).toHaveTextContent(/không cần mã OTP/);
    expect(screen.getByTestId("stepup-mode")).toHaveAttribute("data-mode", "stepUpOff");
    const ok = screen.getByRole("button", { name: "Xác nhận" });
    expect(ok).not.toBeDisabled();
    await act(async () => { fireEvent.click(ok); });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stepUpBypassed ⇒ không ô OTP, nói rõ chưa bật 2FA + chế độ nội bộ + ghi sổ; Huỷ ⇒ không chạy", async () => {
    const run = vi.fn();
    render(<ModeHarness onRun={run} mode="stepUpBypassed" />);
    fireEvent.click(screen.getByRole("button", { name: "Triển khai build" }));
    expect(otpInput()).toBeNull();
    expect(screen.getByRole("dialog")).toHaveTextContent(/ghi sổ/);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Huỷ" })); });
    expect(run).not.toHaveBeenCalled();
  });

  it("không truyền mode (mặc định) ⇒ ô OTP như cũ, Xác nhận KHOÁ tới khi đủ 6 số", async () => {
    const run = vi.fn();
    render(<ModeHarness onRun={run} />);
    fireEvent.click(screen.getByRole("button", { name: "Triển khai build" }));
    expect(otpInput()).not.toBeNull();
    expect(screen.getByRole("button", { name: "Xác nhận" })).toBeDisabled();
    expect(screen.getByTestId("stepup-mode")).toHaveAttribute("data-mode", "required");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Xác nhận" })); });
    expect(run).not.toHaveBeenCalled();
  });

  it("lượt sau KHÔNG mang mode cũ: mở stepUpOff, huỷ, mở lại không mode ⇒ có ô OTP", async () => {
    function Two() {
      const stepUp = useStepUpOtp();
      return (
        <div>
          <button type="button" onClick={() => stepUp.guard(() => {}, { mode: "stepUpOff" })}>a</button>
          <button type="button" onClick={() => stepUp.guard(() => {})}>b</button>
          {stepUp.dialog}
        </div>
      );
    }
    render(<Two />);
    fireEvent.click(screen.getByRole("button", { name: "a" }));
    expect(otpInput()).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Huỷ" })); });
    fireEvent.click(screen.getByRole("button", { name: "b" }));
    expect(otpInput()).not.toBeNull();
  });
});
