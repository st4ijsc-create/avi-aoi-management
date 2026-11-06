/**
 * Pha 0 · C0-6 — trang `MqttClientManagement` KHÔNG còn đường gửi lệnh từ xa tới FactoryAlert (CHECK_UPDATE / RESTART_APP / FORCE_UPDATE): máy chủ trả MODULE_PAUSED,
 * UI ẩn nút. Lưới cấu trúc: thêm lại bất kỳ chỗ nào ⇒ đỏ. (Mã `sendCommand` ở máy chủ giữ nguyên, bị chặn bởi hằng đóng băng.)
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(join(resolve(__dirname, ".."), "pages/MqttClientManagement.tsx"), "utf8");
const khongChuThich = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("MqttClientManagement — đóng băng lệnh từ xa (C0-6)", () => {
  it("không gọi mqttClient.sendCommand, không nhắc CHECK_UPDATE / RESTART_APP / FORCE_UPDATE ngoài chú thích", () => {
    expect(khongChuThich).not.toMatch(/sendCommand/);
    for (const lenh of ["CHECK_UPDATE", "RESTART_APP", "FORCE_UPDATE"]) expect(khongChuThich, lenh).not.toContain(lenh);
  });
  it("không còn công tắc 'khởi động lại app sau khi áp dụng'", () => {
    expect(khongChuThich).not.toMatch(/restartAfterConfigure|bulkRestartAfter/);
  });
});
