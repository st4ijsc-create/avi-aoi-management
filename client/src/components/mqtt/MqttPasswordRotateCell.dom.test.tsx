// @vitest-environment jsdom
//
// doc 81 Đợt 1C Task 5b fix round 1+2 — ô "Mật khẩu MQTT": cổng quyền, xác nhận có lý do, xác nhận GÕ
// mã thiết bị khi thiết bị báo appVersion (suy đoán máy tính bảng FactoryAlertSystem), hộp thoại hiện mật
// khẩu MỘT lần (sao chép + cảnh báo khoá ngoài), đóng là xoá khỏi DOM VÀ khỏi state mutation (reset), và
// đường phục hồi "Xoá mật khẩu". Render THẬT; chỉ mock hợp đồng mạng (`@/lib/trpc`) và `sonner`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const mutate = vi.fn();
const reset = vi.fn();
const clearMutate = vi.fn();
let onSuccess: ((r: { password: string }) => void) | undefined;
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    mqttClient: {
      rotatePassword: {
        useMutation: (opts: { onSuccess?: (r: { password: string }) => void }) => {
          onSuccess = opts.onSuccess;
          return { mutate, reset, isPending: false };
        },
      },
      clearCredential: { useMutation: () => ({ mutate: clearMutate, isPending: false }) },
    },
  },
}));

import { MqttPasswordRotateCell } from "./MqttPasswordRotateCell";

const writeText = vi.fn(async () => {});
beforeEach(() => {
  mutate.mockReset();
  reset.mockReset();
  clearMutate.mockReset();
  writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});
afterEach(() => cleanup());

describe("MqttPasswordRotateCell", () => {
  it("không có quyền ⇒ không hiện gì", () => {
    const { container } = render(<MqttPasswordRotateCell client={{ id: 1, deviceId: "d1", hasCredential: true }} canEdit={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("hiện trạng thái credential (cờ, không bao giờ giá trị); mật khẩu thô cũ báo riêng", () => {
    render(<MqttPasswordRotateCell client={{ id: 1, deviceId: "d1", hasCredential: false }} canEdit />);
    expect(screen.getByTestId("mqtt-cred-1")).toHaveTextContent("mqtt.clientMgmt.noCredential");
    expect(screen.queryByRole("button", { name: "mqtt.clientMgmt.clearCredential" })).toBeNull();
    cleanup();
    render(<MqttPasswordRotateCell client={{ id: 2, deviceId: "d2", hasCredential: false, hasLegacyPlaintext: true }} canEdit />);
    expect(screen.getByTestId("mqtt-cred-2")).toHaveTextContent("mqtt.clientMgmt.legacyPlaintext");
    expect(screen.getByRole("button", { name: "mqtt.clientMgmt.clearCredential" })).toBeInTheDocument();
  });

  it("★ xác nhận cần lý do; thành công ⇒ hộp thoại hiện mật khẩu MỘT lần + cảnh báo + sao chép; đóng ⇒ mật khẩu biến khỏi DOM VÀ rotate.reset()", async () => {
    render(<MqttPasswordRotateCell client={{ id: 7, deviceId: "d7", hasCredential: true }} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: "mqtt.clientMgmt.rotatePassword" }));
    const dlg = screen.getByRole("dialog");
    expect(within(dlg).queryByTestId("rotate-app-warning")).toBeNull(); // không báo appVersion ⇒ không cần gõ mã
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

    expect(reset).not.toHaveBeenCalled();
    fireEvent.click(within(shown).getByRole("button", { name: "common.close" }));
    await waitFor(() => expect(screen.queryByDisplayValue(SECRET)).toBeNull());
    expect(document.body.innerHTML).not.toContain(SECRET);
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("★ thiết bị báo appVersion (suy đoán máy tính bảng FactoryAlertSystem) ⇒ cảnh báo + phải GÕ đúng mã thiết bị mới xoay được", () => {
    render(<MqttPasswordRotateCell client={{ id: 9, deviceId: "tab-9", hasCredential: false, appVersion: "2.4.1" }} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: "mqtt.clientMgmt.rotatePassword" }));
    const dlg = screen.getByRole("dialog");
    expect(within(dlg).getByTestId("rotate-app-warning")).toHaveTextContent("mqtt.clientMgmt.rotateAppDeviceWarning");
    fireEvent.change(within(dlg).getByLabelText("mqtt.clientMgmt.bindReason"), { target: { value: "thu nghiem" } });
    const ok = within(dlg).getByRole("button", { name: "mqtt.clientMgmt.rotatePasswordConfirm" });
    expect(ok).toBeDisabled(); // chưa gõ mã
    fireEvent.change(within(dlg).getByLabelText("mqtt.clientMgmt.rotateTypeDeviceId"), { target: { value: "tab-8" } });
    expect(ok).toBeDisabled(); // gõ sai
    fireEvent.change(within(dlg).getByLabelText("mqtt.clientMgmt.rotateTypeDeviceId"), { target: { value: "tab-9" } });
    expect(ok).toBeEnabled();
    fireEvent.click(ok);
    expect(mutate).toHaveBeenCalledWith({ clientId: 9, reason: "thu nghiem" });
  });

  it("★ Xoá mật khẩu: cần lý do, gửi {clientId, reason}", () => {
    render(<MqttPasswordRotateCell client={{ id: 3, deviceId: "d3", hasCredential: true }} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: "mqtt.clientMgmt.clearCredential" }));
    const dlg = screen.getByRole("dialog");
    expect(within(dlg).getByText("mqtt.clientMgmt.clearCredentialDesc")).toBeInTheDocument();
    const ok = within(dlg).getByRole("button", { name: "mqtt.clientMgmt.clearCredentialConfirm" });
    expect(ok).toBeDisabled();
    fireEvent.change(within(dlg).getByLabelText("mqtt.clientMgmt.bindReason"), { target: { value: "khoi phuc tablet" } });
    fireEvent.click(ok);
    expect(clearMutate).toHaveBeenCalledWith({ clientId: 3, reason: "khoi phuc tablet" });
  });
});
