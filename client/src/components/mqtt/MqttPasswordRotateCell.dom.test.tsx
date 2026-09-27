// @vitest-environment jsdom
//
// doc 81 Đợt 1C Task 5b fix round 1 — ô "Mật khẩu MQTT": cổng quyền, xác nhận có lý do, hộp thoại hiện
// mật khẩu MỘT lần (sao chép + cảnh báo khoá ngoài), đóng là xoá khỏi DOM. Render THẬT; chỉ mock hợp đồng
// mạng (`@/lib/trpc`) và `sonner`. Không i18next ⇒ chữ hiện nguyên khoá.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const mutate = vi.fn();
let onSuccess: ((r: { password: string }) => void) | undefined;
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    mqttClient: {
      rotatePassword: {
        useMutation: (opts: { onSuccess?: (r: { password: string }) => void }) => {
          onSuccess = opts.onSuccess;
          return { mutate, isPending: false };
        },
      },
    },
  },
}));

import { MqttPasswordRotateCell } from "./MqttPasswordRotateCell";

const writeText = vi.fn(async () => {});
beforeEach(() => {
  mutate.mockReset();
  writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});
afterEach(() => cleanup());

describe("MqttPasswordRotateCell", () => {
  it("không có quyền ⇒ không hiện gì", () => {
    const { container } = render(<MqttPasswordRotateCell client={{ id: 1, deviceId: "d1", hasCredential: true }} canEdit={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("hiện trạng thái credential (cờ, không bao giờ giá trị)", () => {
    render(<MqttPasswordRotateCell client={{ id: 1, deviceId: "d1", hasCredential: false }} canEdit />);
    expect(screen.getByTestId("mqtt-cred-1")).toHaveTextContent("mqtt.clientMgmt.noCredential");
  });

  it("★ xác nhận cần lý do; thành công ⇒ hộp thoại hiện mật khẩu MỘT lần + cảnh báo + sao chép; đóng ⇒ mật khẩu biến khỏi DOM", async () => {
    render(<MqttPasswordRotateCell client={{ id: 7, deviceId: "d7", hasCredential: true }} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: "mqtt.clientMgmt.rotatePassword" }));
    const dlg = screen.getByRole("dialog");
    const ok = within(dlg).getByRole("button", { name: "mqtt.clientMgmt.rotatePasswordConfirm" });
    expect(ok).toBeDisabled();
    fireEvent.change(within(dlg).getByLabelText("mqtt.clientMgmt.bindReason"), { target: { value: " cap lai " } });
    expect(ok).toBeEnabled();
    fireEvent.click(ok);
    expect(mutate).toHaveBeenCalledWith({ clientId: 7, reason: "cap lai" });

    const SECRET = "Zx9_secret-plaintext-once-ABCDEFG";
    act(() => onSuccess!({ password: SECRET }));
    const title = await screen.findByText("mqtt.clientMgmt.newPasswordTitle");
    const shown = title.closest('[role="dialog"]') as HTMLElement;
    expect(within(shown).getByText("mqtt.clientMgmt.newPasswordWarning")).toBeInTheDocument();
    expect(within(shown).getByDisplayValue(SECRET)).toBeInTheDocument();
    fireEvent.click(within(shown).getByRole("button", { name: "common.copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SECRET));

    fireEvent.click(within(shown).getByRole("button", { name: "common.close" }));
    await waitFor(() => expect(screen.queryByDisplayValue(SECRET)).toBeNull());
    expect(document.body.innerHTML).not.toContain(SECRET);
  });
});
