import { describe, it, expect, vi, beforeEach } from "vitest";

const updates: any[] = [];
// Hình dạng THẬT của postgres.js + drizzle khi UPDATE có .returning(): .where()
// trả về một builder có .returning(), và CHỈ .returning() mới resolve ra mảng
// hàng thật. Không có .returning(), postgres.js trả `Result` (kế thừa Array,
// KHÔNG có .rowCount — tên đúng là .count) rỗng vì không DataRow nào được đẩy
// vào. Mock cũ mô phỏng .where() tự resolve ra mảng — hình dạng không tồn tại
// trên driver thật khi thiếu .returning() — nên không bắt được lỗi đếm sai.
vi.mock("../db/connection", () => ({
  getDb: async () => ({
    update: () => ({
      set: (v: any) => {
        updates.push(v);
        return {
          where: () => ({
            returning: async () => [{ id: 1 }, { id: 2 }],
          }),
        };
      },
    }),
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

  it("trả về ĐÚNG số dòng đã đóng (không phải luôn 0)", async () => {
    const { sweepExpiredAlerts } = await import("./alertExpirySweeper");
    const result = await sweepExpiredAlerts();
    expect(result.expired).toBe(2);
  });

  it("lỗi DB ⇒ KHÔNG ném ra ngoài (best-effort, không làm sập tiến trình nền)", async () => {
    vi.resetModules();
    vi.doMock("../db/connection", () => ({ getDb: async () => { throw new Error("db down"); } }));
    const { sweepExpiredAlerts } = await import("./alertExpirySweeper");
    await expect(sweepExpiredAlerts()).resolves.toBeDefined();
  });
});
