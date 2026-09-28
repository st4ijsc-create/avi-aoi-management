// @vitest-environment jsdom
//
// doc 81 Đợt 1C Task 5b — ô "Gắn với máy" + hộp thoại gắn/gỡ, render THẬT (EntityPicker thật) qua
// @testing-library/react; chỉ mock hợp đồng mạng (`@/lib/trpc`) và `sonner`. Không có i18next instance
// ⇒ chữ hiện NGUYÊN KHOÁ (cùng quy ước GatewayAllowlistDialog.dom.test.tsx).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const mutate = vi.fn();
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/trpc", () => ({
  trpc: { mqttClient: { bindMachine: { useMutation: () => ({ mutate, isPending: false }) } } },
}));

import { MqttMachineBindingCell, coTheGanMayMqtt } from "./MqttMachineBindingCell";

const MACHINES = [
  { id: 11, code: "MC-A", name: "May A" },
  { id: 12, code: "MC-B", name: "May B" },
];

beforeAll(() => {
  // cmdk/Radix trong jsdom
  (globalThis as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  Element.prototype.scrollIntoView ??= function () {};
  (Element.prototype as any).hasPointerCapture ??= () => false;
  (Element.prototype as any).releasePointerCapture ??= () => {};
});
beforeEach(() => mutate.mockReset());
afterEach(() => cleanup());

describe("coTheGanMayMqtt — cùng cổng máy chủ (admin/engineer + settings_factory canEdit)", () => {
  it("chỉ admin/engineer CÓ canEdit", () => {
    expect(coTheGanMayMqtt("admin", true)).toBe(true);
    expect(coTheGanMayMqtt("engineer", true)).toBe(true);
    expect(coTheGanMayMqtt("engineer", false)).toBe(false);
    for (const r of ["supervisor", "operator", "viewer", "quality_inspector", undefined, null]) {
      expect(coTheGanMayMqtt(r as any, true), String(r)).toBe(false);
    }
  });
});

describe("MqttMachineBindingCell", () => {
  it("không có quyền ⇒ KHÔNG hiện gì (không cột, không nút)", () => {
    const { container } = render(<MqttMachineBindingCell client={{ id: 1, deviceId: "dev-1", machineId: 11 }} machines={MACHINES} canEdit={false} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("button", { name: "mqtt.clientMgmt.bindMachine" })).toBeNull();
  });

  it("có quyền ⇒ hiện máy đang gắn; thiết bị chưa gắn ⇒ 'notBound'", () => {
    render(<MqttMachineBindingCell client={{ id: 1, deviceId: "dev-1", machineId: 11 }} machines={MACHINES} canEdit />);
    expect(screen.getByTestId("mqtt-bound-1")).toHaveTextContent("May A (MC-A)");
    cleanup();
    render(<MqttMachineBindingCell client={{ id: 2, deviceId: "dev-2", machineId: null }} machines={MACHINES} canEdit />);
    expect(screen.getByTestId("mqtt-bound-2")).toHaveTextContent("mqtt.clientMgmt.notBound");
  });

  it("★ chọn máy bằng picker + lý do ⇒ Xác nhận gửi {clientId, machineId, reason}; thiếu lý do ⇒ Xác nhận bị khoá", () => {
    render(<MqttMachineBindingCell client={{ id: 2, deviceId: "dev-2", machineId: null }} machines={MACHINES} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: "mqtt.clientMgmt.bindMachine" }));
    const dialog = screen.getByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "mqtt.clientMgmt.confirmBind" });
    expect(confirm).toBeDisabled();
    // EntityPicker thật: mở combobox, chọn "May B".
    fireEvent.click(within(dialog).getByRole("combobox", { name: "mqtt.clientMgmt.selectMachine" }));
    fireEvent.click(screen.getByRole("option", { name: /May B/ }));
    expect(confirm).toBeDisabled(); // chưa có lý do
    fireEvent.change(within(dialog).getByLabelText("mqtt.clientMgmt.bindReason"), { target: { value: "  lap cam bien  " } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith({ clientId: 2, machineId: 12, reason: "lap cam bien" });
  });

  it("GỠ: thiết bị đang gắn ⇒ nút Gỡ đưa lựa chọn về null; Xác nhận gửi machineId null; chưa đổi gì ⇒ Xác nhận khoá", () => {
    render(<MqttMachineBindingCell client={{ id: 1, deviceId: "dev-1", machineId: 11 }} machines={MACHINES} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: "mqtt.clientMgmt.bindMachine" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("mqtt.clientMgmt.bindReason"), { target: { value: "thao thiet bi" } });
    const confirm = within(dialog).getByRole("button", { name: "mqtt.clientMgmt.confirmBind" });
    expect(confirm).toBeDisabled(); // lựa chọn = hiện tại
    fireEvent.click(within(dialog).getByRole("button", { name: "mqtt.clientMgmt.unbind" }));
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(mutate).toHaveBeenCalledWith({ clientId: 1, machineId: null, reason: "thao thiet bi" });
  });
});
