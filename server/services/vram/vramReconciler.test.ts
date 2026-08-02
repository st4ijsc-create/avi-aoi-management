import { describe, it, expect, beforeEach, vi } from "vitest";

const MIB = 1024 * 1024;

describe("vramReconciler — bắt kẻ cấp phát không xin phép", () => {
  beforeEach(() => vi.resetModules());

  it("★ TEST QUAN TRỌNG NHẤT PHA 1: có kẻ cấp phát ngoài sổ ⇒ PHẢI báo động", async () => {
    // Sổ nói 20 GB. Thiết bị nói 28 GB. Lệch 8 GB = sidecar không xin phép.
    vi.doMock("./vramBroker", () => ({
      snapshot: () => ({ totalReservedBytes: 20_000 * MIB, leases: [] }),
    }));
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => ({ usedBytes: 28_000 * MIB, totalBytes: 32_607 * MIB }),
    }));
    const logged: Array<{ event: string; driftBytes?: number }> = [];
    vi.doMock("./vramEventLog", () => ({ logVramEvent: (e: { event: string; driftBytes?: number }) => logged.push(e) }));

    const { reconcileOnce } = await import("./vramReconciler");
    const r = await reconcileOnce();

    expect(r.driftBytes).toBe(8_000 * MIB);
    expect(r.alarm).toBe(true);
    expect(logged.map((l) => l.event)).toContain("drift");
  });

  it("lệch NHỎ hơn ngưỡng thì KHÔNG báo động (biên nhiễu ±25 MiB, nền trôi ~103 MiB/ngày)", async () => {
    vi.doMock("./vramBroker", () => ({ snapshot: () => ({ totalReservedBytes: 20_000 * MIB, leases: [] }) }));
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => ({ usedBytes: 20_100 * MIB, totalBytes: 32_607 * MIB }),
    }));
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));
    const { reconcileOnce } = await import("./vramReconciler");
    const r = await reconcileOnce();
    expect(r.driftBytes).toBe(100 * MIB);
    expect(r.alarm).toBe(false);
  });

  it("đầu dò trả null (máy không GPU) ⇒ IM LẶNG bỏ qua, KHÔNG báo động giả", async () => {
    vi.doMock("./vramBroker", () => ({ snapshot: () => ({ totalReservedBytes: 20_000 * MIB, leases: [] }) }));
    vi.doMock("./vramProbe", () => ({ readDeviceVram: async () => null }));
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));
    const { reconcileOnce } = await import("./vramReconciler");
    const r = await reconcileOnce();
    expect(r.alarm).toBe(false);
    expect(r.driftBytes).toBeNull();
  });

  it("bộ đếm giờ TẮT ĐƯỢC", async () => {
    vi.doMock("./vramBroker", () => ({ snapshot: () => ({ totalReservedBytes: 0, leases: [] }) }));
    vi.doMock("./vramProbe", () => ({ readDeviceVram: async () => null }));
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));
    const { startVramReconciler, stopVramReconciler, __hasReconcilerTimer } = await import("./vramReconciler");
    startVramReconciler();
    expect(__hasReconcilerTimer()).toBe(true);
    stopVramReconciler();
    expect(__hasReconcilerTimer()).toBe(false);
  });
});
