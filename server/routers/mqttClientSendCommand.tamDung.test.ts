/**
 * Pha 0 · C0-6 — `mqttClient.sendCommand` (RESTART_APP / CHECK_UPDATE / FORCE_UPDATE) ĐÓNG BĂNG cùng FactoryAlert: MODULE_PAUSED, KHÔNG gửi gì lên MQTT.
 * Đột biến: tắt hằng `MQTT_CLIENT_COMMANDS_PAUSED` / gỡ nhánh chặn ⇒ lệnh lọt xuống `mqttService` ⇒ test đỏ.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const guiCauHinh = vi.fn(async () => ({ commandId: "x" }));
const guiCapNhat = vi.fn(async () => ({ commandId: "y" }));
vi.mock("../services/mqttService", () => ({
  sendConfigureCommand: guiCauHinh,
  sendSoftwareUpdateCommand: guiCapNhat,
}));

import { mqttClientRouter, MQTT_CLIENT_COMMANDS_PAUSED } from "./mqttOeeRouters";
import { readAppErrorMeta } from "../_core/appError";

const admin = () => ({ user: { id: 1, role: "admin" } }) as never;

beforeEach(() => {
  guiCauHinh.mockClear();
  guiCapNhat.mockClear();
});

describe("mqttClient.sendCommand — đóng băng (C0-6)", () => {
  it("hằng đóng băng đang BẬT", () => {
    expect(MQTT_CLIENT_COMMANDS_PAUSED).toBe(true);
  });

  for (const command of ["RESTART_APP", "CHECK_UPDATE", "FORCE_UPDATE"] as const) {
    it(`${command} ⇒ PRECONDITION_FAILED + appCode MODULE_PAUSED {module: factoryAlert}; KHÔNG gọi mqttService`, async () => {
      const e = await mqttClientRouter.createCaller(admin()).sendCommand({ deviceId: "dev-1", command }).then(
        () => null,
        (x: unknown) => x,
      );
      expect(e).not.toBeNull();
      expect((e as { code?: string }).code).toBe("PRECONDITION_FAILED");
      expect(readAppErrorMeta(e)).toEqual({ appCode: "MODULE_PAUSED", appParams: { module: "factoryAlert" } });
      expect(guiCauHinh).not.toHaveBeenCalled();
      expect(guiCapNhat).not.toHaveBeenCalled();
    });
  }

  it("không phải admin ⇒ vẫn FORBIDDEN (cổng quyền đứng TRƯỚC, không đổi)", async () => {
    const e = await mqttClientRouter.createCaller({ user: { id: 2, role: "user" } } as never).sendCommand({ deviceId: "d", command: "RESTART_APP" }).then(
      () => null,
      (x: unknown) => x,
    );
    expect((e as { code?: string }).code).toBe("FORBIDDEN");
  });
});
