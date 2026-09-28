/**
 * doc 81 Đợt 1C final wave 5 (final review M6) — MQTT_REQUIRE_PASSWORD=false ⇒ KHÔNG có danh tính thiết bị.
 *
 * Hệ quả (theo quyết định chủ dự án, nay được VIẾT RA): bindMachine/rotatePassword từ chối khi mật khẩu không bị
 * kiểm, nên không thiết bị nào gắn được với máy; lớp L2 (ghim thiết bị ↔ máy) là vô điều kiện ⇒ MỌI ingest cảm
 * biến/telemetry qua MQTT bị từ chối. `.env.example` phải nói điều đó, và broker cảnh báo MỘT lần lúc khởi động.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { warnIfNoMqttDeviceIdentity, _resetNoMqttDeviceIdentityWarning } from "./mqttService";

afterEach(() => {
  _resetNoMqttDeviceIdentityWarning();
  vi.restoreAllMocks();
});

describe("M6 — MQTT_REQUIRE_PASSWORD=false ⇒ cảnh báo MỘT lần: không danh tính thiết bị ⇒ ingest MQTT bị từ chối", () => {
  it("false ⇒ đúng MỘT dòng cảnh báo dù gọi nhiều lần; câu nói rõ ingest cảm biến/telemetry bị từ chối", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const env = { MQTT_REQUIRE_PASSWORD: "false" } as NodeJS.ProcessEnv;
    expect(warnIfNoMqttDeviceIdentity(env)).toBe(true);
    expect(warnIfNoMqttDeviceIdentity(env)).toBe(false);
    expect(warnIfNoMqttDeviceIdentity(env)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(line).toMatch(/no device identity/i);
    expect(line).toMatch(/sensor/i);
    expect(line).toMatch(/telemetry/i);
    expect(line).toMatch(/refused/i);
  });
  it.each([undefined, "true", "1"])("MQTT_REQUIRE_PASSWORD=%s (mật khẩu được kiểm) ⇒ không cảnh báo", (v) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(warnIfNoMqttDeviceIdentity((v === undefined ? {} : { MQTT_REQUIRE_PASSWORD: v }) as NodeJS.ProcessEnv)).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });
  it("initMqttBroker gọi cảnh báo lúc khởi động (dây nối)", () => {
    const src = readFileSync(resolve(__dirname, "mqttService.ts"), "utf8");
    const body = src.slice(src.indexOf("export function initMqttBroker("), src.indexOf("// Create Aedes broker"));
    expect(body).toMatch(/warnIfNoMqttDeviceIdentity\(\)/);
  });
  it(".env.example giải thích: false ⇒ không danh tính thiết bị ⇒ ingest cảm biến/telemetry MQTT bị từ chối (cả ở hai cờ ingest)", () => {
    const env = readFileSync(resolve(__dirname, "../../.env.example"), "utf8");
    const near = (key: string) => {
      const i = env.indexOf(key);
      expect(i, key).toBeGreaterThan(-1);
      return env.slice(Math.max(0, i - 1200), i + 200);
    };
    expect(near("MQTT_REQUIRE_PASSWORD=true")).toMatch(/KHÔNG có danh tính thiết bị/);
    expect(near("MQTT_REQUIRE_PASSWORD=true")).toMatch(/bị TỪ CHỐI/);
    expect(near("PDM_SENSOR_INGEST_ENABLED=false")).toMatch(/gắn với máy/);
    expect(near("# MQTT_TELEMETRY_BRIDGE_ENABLED=false")).toMatch(/gắn với máy/);
  });
});
