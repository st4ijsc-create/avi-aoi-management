// @vitest-environment jsdom
//
// doc 81 Đợt 1D Task 3 — component test cho khu vực "Tag dừng phần mềm" (TagStopPinEditor)
// + chip "Tag dừng" (StopPinChip), tách từ DeviceAdapterManagement.tsx. Render THẬT qua
// @testing-library/react; chỉ mock hợp đồng mạng (`@/lib/trpc`) và `sonner` (cùng khuôn
// MqttMachineBindingCell.dom.test.tsx). Nạp bundle i18n THẬT bằng cách đọc thẳng 3 file
// locale (cùng khuôn trpcErrors.locale.unit.test.ts) — không có bước này, câu hiện ra là
// KHOÁ TRẦN (không có i18next instance), và phép kiểm "chip mang đúng giá trị"/"nút Lưu
// ghim" (tên nút LÀ câu dịch) sẽ vô nghĩa.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const localeJson = (rel: string) => JSON.parse(readFileSync(join(HERE, rel), "utf8"));

const mutate = vi.fn();
let lastMutationOptions: { onSuccess?: (res: unknown) => void; onError?: (e: unknown) => void } | undefined;
const toastSuccess = vi.fn();
const toastWarning = vi.fn();
const toastError = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    warning: (...a: unknown[]) => toastWarning(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    deviceAdapter: {
      tags: {
        setStopPin: {
          useMutation: (opts: { onSuccess?: (res: unknown) => void; onError?: (e: unknown) => void }) => {
            lastMutationOptions = opts;
            return { mutate, isPending: false };
          },
        },
      },
    },
  },
}));

import "../i18n";
import i18n from "i18next";
import {
  StopPinChip,
  TagStopPinEditor,
  checkStopPinInput,
  parseStopPinInput,
  stopPinValueToInput,
} from "./DeviceAdapterManagement";

beforeAll(async () => {
  // cmdk/Radix (Select) trong jsdom — cùng khuôn MqttMachineBindingCell.dom.test.tsx.
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= function () {};
  (Element.prototype as any).hasPointerCapture ??= () => false;
  (Element.prototype as any).releasePointerCapture ??= () => {};

  // Bundle THẬT, không phải fixture — cần đúng câu vi.json sản xuất (khuôn
  // trpcErrors.locale.unit.test.ts).
  i18n.addResourceBundle("vi", "translation", localeJson("../i18n/locales/vi.json"), true, true);
  // ⚠ jsdom báo navigator.language mặc định là "en-US" — i18next-browser-languagedetector
  // (dùng thật ở client/src/i18n/index.ts) chọn "en" làm ngôn ngữ hiện hành ngay lúc init,
  // TRƯỚC dòng addResourceBundle ở trên. Ép về "vi" tường minh — cùng kỷ luật
  // trpcErrors.locale.unit.test.ts (mỗi ca ở đó cũng tự gọi changeLanguage, không dựa mặc định).
  await i18n.changeLanguage("vi");
});
afterAll(async () => {
  await i18n.changeLanguage("vi");
});
beforeEach(async () => {
  mutate.mockReset();
  toastSuccess.mockReset();
  toastWarning.mockReset();
  toastError.mockReset();
  lastMutationOptions = undefined;
  await i18n.changeLanguage("vi");
});
afterEach(() => cleanup());

describe("parseStopPinInput / stopPinValueToInput — thuần, quy đổi theo dataType", () => {
  it("bool: 'true'/'1' → true; còn lại → false", () => {
    expect(parseStopPinInput("bool", "true")).toBe(true);
    expect(parseStopPinInput("bool", "1")).toBe(true);
    expect(parseStopPinInput("bool", "false")).toBe(false);
    expect(parseStopPinInput("bool", "0")).toBe(false);
  });
  it("int/float → number (trim trước); string → nguyên văn đã trim", () => {
    expect(parseStopPinInput("int", "  42 ")).toBe(42);
    expect(parseStopPinInput("float", "3.5")).toBe(3.5);
    expect(parseStopPinInput("string", "  abc  ")).toBe("abc");
  });
  it("stopPinValueToInput là nghịch đảo hợp lý cho bool/số/rỗng", () => {
    expect(stopPinValueToInput("bool", true)).toBe("true");
    expect(stopPinValueToInput("bool", 0)).toBe("false");
    expect(stopPinValueToInput("int", 7)).toBe("7");
    expect(stopPinValueToInput("int", null)).toBe("");
  });
});

describe("final wave 2 (I2) — checkStopPinInput: KHÔNG làm tròn giá trị ghim", () => {
  it("int: số nguyên ⇒ ok đúng giá trị; số lẻ ⇒ lỗi intRequired (không phải 1)", () => {
    expect(checkStopPinInput("int", "7")).toEqual({ ok: true, value: 7 });
    expect(checkStopPinInput("int", "-3")).toEqual({ ok: true, value: -3 });
    expect(checkStopPinInput("int", "1.9")).toEqual({ ok: false, error: "intRequired" });
    expect(checkStopPinInput("int", "1.5")).toEqual({ ok: false, error: "intRequired" });
    expect(checkStopPinInput("int", "9007199254740993")).toEqual({ ok: false, error: "intRequired" });
    expect(parseStopPinInput("int", "1.9")).toBe(1.9); // không còn Math.trunc
  });
  it("float: số hữu hạn ⇒ ok; rác ⇒ numberRequired; rỗng ⇒ valueRequired", () => {
    expect(checkStopPinInput("float", "2.25")).toEqual({ ok: true, value: 2.25 });
    expect(checkStopPinInput("float", "abc")).toEqual({ ok: false, error: "numberRequired" });
    expect(checkStopPinInput("float", "  ")).toEqual({ ok: false, error: "valueRequired" });
  });
});

describe("StopPinChip", () => {
  it("KHÔNG ghim (stopValue null/undefined) ⇒ không render gì", () => {
    const { container: c1 } = render(<StopPinChip stopValue={null} />);
    expect(c1).toBeEmptyDOMElement();
    cleanup();
    const { container: c2 } = render(<StopPinChip stopValue={undefined} />);
    expect(c2).toBeEmptyDOMElement();
  });

  it("★ đã ghim ⇒ chip 'Tag dừng' mang ĐÚNG giá trị", () => {
    render(<StopPinChip stopValue={true} />);
    expect(screen.getByText("Tag dừng: true")).toBeInTheDocument();
  });
});

describe("TagStopPinEditor", () => {
  const baseTag = { id: 1, tagKey: "cmd_stop", dataType: "int" as const, writable: true, stopValue: undefined };

  it("★ tag KHÔNG writable ⇒ ẩn switch/ô nhập, chỉ còn ghi chú; không gọi setStopPin", () => {
    render(<TagStopPinEditor tag={{ ...baseTag, writable: false }} adapterId={9} canEdit />);
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("button", { name: "Lưu ghim" })).toBeNull();
    expect(screen.getByText(/Chỉ tag GHI ĐƯỢC/)).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("tag kiểu json ⇒ cũng ẩn (server luôn từ chối stopPinTypeMismatch cho json)", () => {
    render(<TagStopPinEditor tag={{ ...baseTag, dataType: "json" as any }} adapterId={9} canEdit />);
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("tag bool ⇒ giá trị chọn qua Select (combobox), không phải input số", () => {
    render(<TagStopPinEditor tag={{ ...baseTag, dataType: "bool" }} adapterId={9} canEdit />);
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });

  it("★ writable (int) ⇒ bật ghim + nhập giá trị/lý do rồi Lưu ⇒ setStopPin đúng kiểu + đúng lý do", () => {
    render(<TagStopPinEditor tag={baseTag} adapterId={9} canEdit />);
    fireEvent.click(screen.getByRole("switch")); // bật ghim
    fireEvent.change(screen.getByLabelText("Giá trị khi DỪNG"), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText(/Lý do/), { target: { value: "vi du ly do that day du" } });
    const save = screen.getByRole("button", { name: "Lưu ghim" });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith({
      adapterId: 9,
      tagKey: "cmd_stop",
      stopValue: 7, // number, không phải chuỗi "7"
      reason: "vi du ly do that day du",
    });
  });

  it("★ I2: tag int nhập 1.5 ⇒ lỗi hiện trên màn, nút Lưu khoá, KHÔNG gửi 1; sửa thành 2 ⇒ gửi đúng 2", () => {
    render(<TagStopPinEditor tag={baseTag} adapterId={9} canEdit />);
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.change(screen.getByLabelText("Giá trị khi DỪNG"), { target: { value: "1.5" } });
    fireEvent.change(screen.getByLabelText(/Lý do/), { target: { value: "vi du ly do that day du" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Tag kiểu int cần một số NGUYÊN");
    const save = screen.getByRole("button", { name: "Lưu ghim" });
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(mutate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Giá trị khi DỪNG"), { target: { value: "2" } });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Lưu ghim" }));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0].stopValue).toBe(2);
  });

  it("lý do < 5 ký tự ⇒ nút Lưu bị khoá (không gọi setStopPin)", () => {
    render(<TagStopPinEditor tag={baseTag} adapterId={9} canEdit />);
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.change(screen.getByLabelText("Giá trị khi DỪNG"), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText(/Lý do/), { target: { value: "ab" } });
    const save = screen.getByRole("button", { name: "Lưu ghim" });
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("gỡ ghim (tắt switch khi tag đang có pin) ⇒ gửi stopValue null", () => {
    render(<TagStopPinEditor tag={{ ...baseTag, stopValue: 5 }} adapterId={9} canEdit />);
    const sw = screen.getByRole("switch");
    expect(sw).toHaveAttribute("aria-checked", "true"); // seed từ stopValue hiện có
    fireEvent.click(sw); // tắt ghim = gỡ
    fireEvent.change(screen.getByLabelText(/Lý do/), { target: { value: "go ghim vi ly do" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu ghim" }));
    expect(mutate).toHaveBeenCalledWith({ adapterId: 9, tagKey: "cmd_stop", stopValue: null, reason: "go ghim vi ly do" });
  });

  it("commissioningRecheckRequired ⇒ toast.warning SAU KHI lưu (cờ Task 1)", () => {
    render(<TagStopPinEditor tag={baseTag} adapterId={9} canEdit />);
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.change(screen.getByLabelText("Giá trị khi DỪNG"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText(/Lý do/), { target: { value: "vi du ly do that day du" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu ghim" }));
    expect(lastMutationOptions?.onSuccess).toBeTypeOf("function");
    lastMutationOptions!.onSuccess!({ commissioningRecheckRequired: true });
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(toastWarning).toHaveBeenCalledTimes(1);
  });

  it("canEdit=false ⇒ nút Lưu luôn khoá dù điền đủ giá trị/lý do", () => {
    render(<TagStopPinEditor tag={baseTag} adapterId={9} canEdit={false} />);
    // Switch tự nó cũng disabled khi !canEdit — không cần bật để chứng minh nút Lưu khoá.
    expect(screen.getByRole("switch")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Lưu ghim" })).toBeDisabled();
  });
});
