/**
 * SCADA R1a Task 8 — `kiemCauHinhLenhHmi()` (điều phối 2026-10-24): SCADA_COMMANDS bật mà bộ đệm tắt ⇒ `logger.warn` MỘT lần mỗi
 * tiến trình; cờ tắt / bộ đệm bật ⇒ không warn. Mỗi ca nạp lại module (`vi.resetModules`) = một "tiến trình" mới.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const warn = vi.hoisted(() => vi.fn());
vi.mock("../../logger", () => ({ logger: { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() }, default: { warn } }));

async function napMoi() {
  vi.resetModules();
  return (await import("./lenhHmi")).kiemCauHinhLenhHmi;
}

beforeEach(() => warn.mockClear());
afterEach(() => vi.unstubAllEnvs());

describe("kiemCauHinhLenhHmi — kiểm khởi động", () => {
  it("SCADA_COMMANDS bật + bộ đệm tắt ⇒ gọi HAI lần chỉ MỘT lần warn, đúng câu", async () => {
    vi.stubEnv("SCADA_COMMANDS_ENABLED", "true");
    vi.stubEnv("SCADA_LIVE_CACHE_ENABLED", "false");
    const kiem = await napMoi();
    kiem();
    kiem();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe(
      "SCADA_COMMANDS bật nhưng SCADA_LIVE_CACHE_ENABLED tắt — mọi máy coi như LOCAL, mọi lệnh HMI sẽ bị từ chối",
    );
  });

  it("cờ SCADA_COMMANDS tắt ⇒ không warn (kể cả bộ đệm tắt)", async () => {
    vi.stubEnv("SCADA_COMMANDS_ENABLED", "false");
    vi.stubEnv("SCADA_LIVE_CACHE_ENABLED", "false");
    const kiem = await napMoi();
    kiem();
    expect(warn).not.toHaveBeenCalled();
  });

  it("SCADA_COMMANDS bật + bộ đệm bật ⇒ không warn", async () => {
    vi.stubEnv("SCADA_COMMANDS_ENABLED", "true");
    vi.stubEnv("SCADA_LIVE_CACHE_ENABLED", "true");
    const kiem = await napMoi();
    kiem();
    expect(warn).not.toHaveBeenCalled();
  });
});
