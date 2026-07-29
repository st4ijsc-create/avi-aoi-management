import { describe, it, expect, vi, beforeEach } from "vitest";

const updates: any[] = [];
vi.mock("../db/connection", () => ({
  getDb: async () => ({
    update: () => ({ set: (v: any) => { updates.push(v); return { where: async () => [{ id: 1 }, { id: 2 }] }; } }),
  }),
}));

beforeEach(() => { updates.length = 0; });

describe("sweepExpiredAlerts", () => {
  it("chuyển sang EXPIRED và GHI RÕ LÝ DO (không biến mất im lặng)", async () => {
    const { sweepExpiredAlerts } = await import("./alertExpirySweeper");
    await sweepExpiredAlerts();
    expect(updates).toHaveLength(1);
    expect(updates[0].status).toBe("EXPIRED");
    expect(String(updates[0].resolutionNotes ?? "")).toMatch(/thôi tái diễn|hết hạn/i);
  });

  it("lỗi DB ⇒ KHÔNG ném ra ngoài (best-effort, không làm sập tiến trình nền)", async () => {
    vi.resetModules();
    vi.doMock("../db/connection", () => ({ getDb: async () => { throw new Error("db down"); } }));
    const { sweepExpiredAlerts } = await import("./alertExpirySweeper");
    await expect(sweepExpiredAlerts()).resolves.toBeDefined();
  });
});
