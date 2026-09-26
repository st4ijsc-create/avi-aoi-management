import { describe, it, expect, beforeEach, vi } from "vitest";

describe("vramEventLog — ghi bất đồng bộ, cách ly được", () => {
  beforeEach(() => vi.resetModules());

  it("logVramEvent KHÔNG chờ DB — trả về ngay, chưa ghi gì", async () => {
    const insert = vi.fn();
    vi.doMock("../../db/connection", () => ({
      getDb: async () => ({ insert: () => ({ values: insert }) }),
    }));
    const { logVramEvent, __setVramLogTimerEnabled } = await import("./vramEventLog");
    __setVramLogTimerEnabled(false);
    logVramEvent({ event: "reserve", owner: "gguf:A", leaseKind: "gguf-model", priority: "interactive", estimatedBytes: 1024 });
    expect(insert).not.toHaveBeenCalled();
  });

  it("flush ghi hết hàng đợi rồi dọn", async () => {
    const insert = vi.fn(async () => undefined);
    vi.doMock("../../db/connection", () => ({
      getDb: async () => ({ insert: () => ({ values: insert }) }),
    }));
    const { logVramEvent, flushVramEvents, __setVramLogTimerEnabled } = await import("./vramEventLog");
    __setVramLogTimerEnabled(false);
    logVramEvent({ event: "reserve", owner: "gguf:A", leaseKind: "gguf-model", priority: "interactive", estimatedBytes: 1024 });
    logVramEvent({ event: "commit", owner: "gguf:A", leaseKind: "gguf-model", priority: "interactive", actualBytes: 2048 });
    expect(await flushVramEvents()).toBe(2);
    expect(insert).toHaveBeenCalledTimes(1);      // gom LÔ, không phải 2 lượt
    expect(await flushVramEvents()).toBe(0);      // đã dọn
  });

  it("BỘ ĐẾM GIỜ TẮT ĐƯỢC — không có timer nào sống sau khi tắt", async () => {
    const { __setVramLogTimerEnabled, __hasVramLogTimer } = await import("./vramEventLog");
    __setVramLogTimerEnabled(true);
    expect(__hasVramLogTimer()).toBe(true);
    __setVramLogTimerEnabled(false);
    expect(__hasVramLogTimer()).toBe(false);
  });

  it("DB hỏng KHÔNG được làm ngã người gọi", async () => {
    vi.doMock("../../db/connection", () => ({ getDb: async () => { throw new Error("db down"); } }));
    const { logVramEvent, flushVramEvents, __setVramLogTimerEnabled } = await import("./vramEventLog");
    __setVramLogTimerEnabled(false);
    logVramEvent({ event: "reserve", owner: "gguf:A", leaseKind: "gguf-model", priority: "interactive" });
    await expect(flushVramEvents()).resolves.toBe(0);
  });
});
