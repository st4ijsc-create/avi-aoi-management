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
    expect(document.activeElement).toBe(opener);
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
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "khác" }));
  });
});
