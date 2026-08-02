import { describe, it, expect, beforeEach, vi } from "vitest";

describe("vramProbe", () => {
  beforeEach(() => vi.resetModules());

  it("dùng getVramState native khi có", async () => {
    vi.doMock("./llamaHandle", () => ({
      getLlamaInstanceIfReady: () => ({ getVramState: async () => ({ used: 5, total: 10 }) }),
    }));
    const { readDeviceVram, __clearProbeCache } = await import("./vramProbe");
    __clearProbeCache();
    expect(await readDeviceVram()).toEqual({ usedBytes: 5, totalBytes: 10 });
  });

  it("lùi về nvidia-smi khi không có native", async () => {
    vi.doMock("./llamaHandle", () => ({ getLlamaInstanceIfReady: () => null }));
    vi.doMock("child_process", () => ({
      execFile: (_c: unknown, _a: unknown, _o: unknown, cb: (e: null, r: { stdout: string }) => void) =>
        cb(null, { stdout: "1200, 32607\n" }),
    }));
    const { readDeviceVram, __clearProbeCache } = await import("./vramProbe");
    __clearProbeCache();
    const v = await readDeviceVram();
    expect(v!.usedBytes).toBe(1200 * 1024 * 1024);
    expect(v!.totalBytes).toBe(32607 * 1024 * 1024);
  });

  it("KHÔNG có GPU thì trả null — KHÔNG được ném", async () => {
    vi.doMock("./llamaHandle", () => ({ getLlamaInstanceIfReady: () => null }));
    vi.doMock("child_process", () => ({
      execFile: (_c: unknown, _a: unknown, _o: unknown, cb: (e: Error) => void) => cb(new Error("ENOENT")),
    }));
    const { readDeviceVram, __clearProbeCache } = await import("./vramProbe");
    __clearProbeCache();
    expect(await readDeviceVram()).toBeNull();
  });

  it("có ĐỆM — hai lượt liên tiếp chỉ gọi nvidia-smi MỘT lần", async () => {
    const exec = vi.fn((_c: unknown, _a: unknown, _o: unknown, cb: (e: null, r: { stdout: string }) => void) =>
      cb(null, { stdout: "1200, 32607\n" }));
    vi.doMock("./llamaHandle", () => ({ getLlamaInstanceIfReady: () => null }));
    vi.doMock("child_process", () => ({ execFile: exec }));
    const { readDeviceVram, __clearProbeCache } = await import("./vramProbe");
    __clearProbeCache();
    await readDeviceVram();
    await readDeviceVram();
    expect(exec).toHaveBeenCalledTimes(1);
  });
});
