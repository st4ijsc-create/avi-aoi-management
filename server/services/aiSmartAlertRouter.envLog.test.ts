/**
 * Sprint 5 debt E4 — biến môi trường sai chính tả/giá trị (vd
 * ALERT_RENOTIFY_COOLDOWN_MINUTES="abc" hoặc "-1") rơi về mặc định TRONG IM
 * LẶNG: Number("abc")→NaN và Number("-1")→-1 đều rớt về 240 phút, không một
 * dòng log. Người vận hành gõ nhầm khi định TẮT/chỉnh cooldown sẽ nhận đúng
 * 4h im lặng và không biết vì sao.
 *
 * routeAlert() phải log MỘT LẦN lúc module nạp, nêu cả giá trị THÔ lẫn giá trị
 * HIỆU LỰC của 3 biến (ALERT_RENOTIFY_COOLDOWN_MINUTES,
 * ALERT_RENOTIFY_COOLDOWN_CRITICAL_MINUTES, ROUTE_ALERT_MAX_PER_WINDOW), và
 * cảnh báo rõ khi chúng khác nhau (tức đã rơi về mặc định).
 *
 * Test dùng vi.resetModules() + import động để buộc top-level code chạy lại
 * với từng tổ hợp env var, vì log này chỉ chạy MỘT LẦN lúc nạp module (module
 * cache sẽ không chạy lại nếu không reset).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ENV_KEYS = [
  "ALERT_RENOTIFY_COOLDOWN_MINUTES",
  "ALERT_RENOTIFY_COOLDOWN_CRITICAL_MINUTES",
  "ROUTE_ALERT_MAX_PER_WINDOW",
] as const;

function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

beforeEach(() => {
  clearEnv();
});
afterEach(() => {
  clearEnv();
  vi.restoreAllMocks();
});

describe("aiSmartAlertRouter — log một lần lúc nạp module (debt E4)", () => {
  it("giá trị hợp lệ (khớp thô=hiệu lực) ⇒ log THÔ + HIỆU LỰC, KHÔNG cảnh báo", async () => {
    process.env.ALERT_RENOTIFY_COOLDOWN_MINUTES = "240";
    process.env.ALERT_RENOTIFY_COOLDOWN_CRITICAL_MINUTES = "0";
    process.env.ROUTE_ALERT_MAX_PER_WINDOW = "200";
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.resetModules();
    await import("./aiSmartAlertRouter");

    const lines = log.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes("ALERT_RENOTIFY_COOLDOWN_MINUTES") && l.includes("240"))).toBe(true);
    expect(lines.some((l) => l.includes("CẤU HÌNH") && l.includes("KHÔNG hợp lệ"))).toBe(false);
  });

  it("gõ sai chính tả giá trị (Number('abc')→NaN→240) ⇒ log CẢNH BÁO nêu cả thô lẫn hiệu lực", async () => {
    process.env.ALERT_RENOTIFY_COOLDOWN_MINUTES = "abc"; // người vận hành gõ nhầm
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.resetModules();
    await import("./aiSmartAlertRouter");

    const lines = log.mock.calls.map((c) => String(c[0]));
    const warnLine = lines.find(
      (l) => l.includes("ALERT_RENOTIFY_COOLDOWN_MINUTES") && l.includes("CẤU HÌNH") && l.includes("KHÔNG hợp lệ"),
    );
    expect(warnLine).toBeTruthy();
    expect(warnLine).toContain("abc"); // giá trị THÔ (rác) phải xuất hiện
    expect(warnLine).toContain("240"); // giá trị HIỆU LỰC (mặc định) phải xuất hiện
  });

  it("giá trị âm định TẮT (Number('-1')→-1→240) ⇒ vẫn bị coi là rơi về mặc định, cảnh báo rõ", async () => {
    process.env.ALERT_RENOTIFY_COOLDOWN_MINUTES = "-1"; // người vận hành tưởng đây là cách TẮT cooldown
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.resetModules();
    await import("./aiSmartAlertRouter");

    const lines = log.mock.calls.map((c) => String(c[0]));
    const warnLine = lines.find((l) => l.includes("ALERT_RENOTIFY_COOLDOWN_MINUTES") && l.includes("CẤU HÌNH"));
    expect(warnLine).toBeTruthy();
    expect(warnLine).toContain("-1");
    expect(warnLine).toContain("240");
  });

  it("ROUTE_ALERT_MAX_PER_WINDOW='0' (không dương, van an toàn không chấp nhận) ⇒ cảnh báo rơi về mặc định 200", async () => {
    process.env.ROUTE_ALERT_MAX_PER_WINDOW = "0";
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.resetModules();
    await import("./aiSmartAlertRouter");

    const lines = log.mock.calls.map((c) => String(c[0]));
    const warnLine = lines.find((l) => l.includes("ROUTE_ALERT_MAX_PER_WINDOW") && l.includes("CẤU HÌNH"));
    expect(warnLine).toBeTruthy();
    expect(warnLine).toContain("200");
  });

  it("biến chưa đặt (undefined) ⇒ KHÔNG bị coi là cấu hình sai, chỉ log giá trị mặc định bình thường", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.resetModules();
    await import("./aiSmartAlertRouter");

    const lines = log.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes("CẤU HÌNH") && l.includes("KHÔNG hợp lệ"))).toBe(false);
    expect(lines.some((l) => l.includes("ALERT_RENOTIFY_COOLDOWN_MINUTES") && l.includes("chưa đặt"))).toBe(true);
  });
});
