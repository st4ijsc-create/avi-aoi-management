// @vitest-environment jsdom
//
// doc 81 Đợt 3 Task 0 (O1, browser check 2026-10-05) — sau "Huỷ" trên hộp OTP, focus rơi về <body> trong khi wizard
// (modal) vẫn mở. Gốc: hộp OTP mở bằng mã (không có DialogTrigger) nên Radix trả focus về `triggerRef` = null. Hợp đồng:
// đóng hộp OTP (Huỷ / Esc) ⇒ focus về đúng phần tử đã mở nó (nút xác nhận của wizard), nếu nó còn trong DOM.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, d?: unknown) => (typeof d === "string" ? d : k) }),
}));

import { useStepUpOtp } from "./StepUpOtpDialog";

function Harness({ onRun }: { onRun: (code: string) => void }) {
  const stepUp = useStepUpOtp();
  return (
    <div>
      <button type="button" onClick={() => stepUp.guard(onRun)}>
        Triển khai build
      </button>
      <button type="button">khác</button>
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
    opener.remove();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Huỷ" }));
      await new Promise((r) => setTimeout(r, 10)); // Radix FocusScope trả focus trong setTimeout(0)
    });
    expect(document.activeElement).not.toBe(opener);
  });
});
