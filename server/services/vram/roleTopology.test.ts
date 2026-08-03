import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Pha 1.5 Task 4 — ROLE=api: nhật ký BẬT ở mọi vai trò, đối chiếu CHỈ ở vai trò
 * chạy scheduler. `describeTopologyHint()` là phần "cảnh báo phải nêu đúng khả
 * năng" — khi hệ tách vai trò api/worker, một khoản lệch DƯƠNG có thể là của
 * tiến trình ANH EM (sổ riêng từng tiến trình, không có sổ chung ở Pha 1.5),
 * không phải kẻ lạ. Xem `.superpowers/sdd/2026-08-03-vram-pha1-5-go-chan/task-4-brief.md`.
 */
describe("ROLE=api — nhật ký BẬT, đối chiếu TẮT", () => {
  const originalRole = process.env.ROLE;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (originalRole === undefined) delete process.env.ROLE;
    else process.env.ROLE = originalRole;
  });

  it("★ cảnh báo lệch phải NÊU khả năng tiến trình anh em khi hệ tách vai trò (ROLE=worker)", async () => {
    process.env.ROLE = "worker";
    const { describeTopologyHint } = await import("./vramReconciler");
    expect(describeTopologyHint()).toMatch(/tiến trình anh em|api/i);
  });

  it("★ cảnh báo lệch phải NÊU khả năng tiến trình anh em khi hệ tách vai trò (ROLE=api)", async () => {
    process.env.ROLE = "api";
    const { describeTopologyHint } = await import("./vramReconciler");
    expect(describeTopologyHint()).toMatch(/tiến trình anh em|api/i);
  });

  it("vai trò all-in-one (ROLE không đặt) thì KHÔNG nêu tiến trình anh em", async () => {
    delete process.env.ROLE;
    const { describeTopologyHint } = await import("./vramReconciler");
    expect(describeTopologyHint()).toBe("");
  });

  it("vai trò LẠ (không phải api/worker) thì KHÔNG nêu tiến trình anh em", async () => {
    process.env.ROLE = "something-else";
    const { describeTopologyHint } = await import("./vramReconciler");
    expect(describeTopologyHint()).toBe("");
  });

  const MIB = 1024 * 1024;

  // ⚠ Ba test dưới đây kiểm CHỖ NỐI thật (Step 4 của brief), không chỉ hàm độc lập —
  // mock lại reconcileOnce() giống vramReconciler.test.ts để bắt trường hợp ai đó thêm
  // đúng hàm `describeTopologyHint()` nhưng QUÊN nối nó vào câu cảnh báo, hoặc nối
  // nhầm sang nhánh âm.
  it("cảnh báo LỆCH DƯƠNG khi ROLE=worker phải CHỨA gợi ý tiến trình anh em", async () => {
    process.env.ROLE = "worker";
    vi.doMock("./vramBroker", () => ({ snapshot: () => ({ totalReservedBytes: 20_000 * MIB, leases: [] }) }));
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => ({ usedBytes: 28_000 * MIB, totalBytes: 32_607 * MIB, source: "native" }),
    }));
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { reconcileOnce } = await import("./vramReconciler");
    await reconcileOnce();
    const msg = String(warnSpy.mock.calls[0]?.[0] ?? "");
    expect(msg).toMatch(/tiến trình anh em/i);
    warnSpy.mockRestore();
  });

  it("cảnh báo LỆCH DƯƠNG khi ROLE không đặt (all-in-one) KHÔNG được chứa gợi ý tiến trình anh em", async () => {
    delete process.env.ROLE;
    vi.doMock("./vramBroker", () => ({ snapshot: () => ({ totalReservedBytes: 20_000 * MIB, leases: [] }) }));
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => ({ usedBytes: 28_000 * MIB, totalBytes: 32_607 * MIB, source: "native" }),
    }));
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { reconcileOnce } = await import("./vramReconciler");
    await reconcileOnce();
    const msg = String(warnSpy.mock.calls[0]?.[0] ?? "");
    expect(msg).not.toMatch(/tiến trình anh em/i);
    warnSpy.mockRestore();
  });

  it("cảnh báo LỆCH ÂM khi ROLE=worker KHÔNG được nối gợi ý (âm là giấy phép treo CỦA CHÍNH tiến trình này)", async () => {
    process.env.ROLE = "worker";
    vi.doMock("./vramBroker", () => ({ snapshot: () => ({ totalReservedBytes: 20_000 * MIB, leases: [] }) }));
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => ({ usedBytes: 11_000 * MIB, totalBytes: 32_607 * MIB, source: "native" }),
    }));
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { reconcileOnce } = await import("./vramReconciler");
    await reconcileOnce();
    const msg = String(warnSpy.mock.calls[0]?.[0] ?? "");
    expect(msg).not.toMatch(/tiến trình anh em/i);
    warnSpy.mockRestore();
  });
});
