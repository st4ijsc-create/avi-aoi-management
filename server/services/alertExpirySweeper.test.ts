import { describe, it, expect, vi, beforeEach } from "vitest";

const updates: any[] = [];
// Vòng sửa cuối (review toàn nhánh, mục 6) — ghi lại đối tượng điều kiện WHERE
// THẬT (SQL của drizzle-orm thật — chỉ getDb/update/set/where bị mock, còn
// and()/eq()/isNull()/lt() và cột predictiveAlerts.* trong alertExpirySweeper.ts
// đều là hàng thật) truyền vào .where(), để kiểm nó lọc theo CỘT nào.
let lastWhereCond: any = null;
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
          where: (cond: any) => {
            lastWhereCond = cond;
            return {
              returning: async () => [{ id: 1 }, { id: 2 }],
            };
          },
        };
      },
    }),
  }),
}));

/** Duyệt cây SQL THẬT của drizzle-orm (queryChunks lồng nhau) và gom tên các cột
 *  Column được tham chiếu. Mỗi Column thật có .name kiểu chuỗi + .columnType
 *  (StringChunk/Param không có .columnType nên không lẫn vào — đã xác nhận bằng
 *  cách in cấu trúc thật của drizzle-orm 0.44 trước khi viết hàm này). */
function columnNamesInCondition(cond: any): string[] {
  const names: string[] = [];
  function walk(node: any, depth: number) {
    if (node == null || depth > 12) return;
    if (Array.isArray(node)) { for (const n of node) walk(n, depth); return; }
    if (typeof node !== "object") return;
    if (typeof node.name === "string" && typeof node.columnType === "string") names.push(node.name);
    if (Array.isArray(node.queryChunks)) walk(node.queryChunks, depth + 1);
  }
  walk(cond, 0);
  return names;
}

beforeEach(() => { updates.length = 0; lastWhereCond = null; });

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

  /**
   * Vòng sửa cuối (review toàn nhánh, mục 6) — [phủ test] các test trên chỉ kiểm
   * .set() (cột được GHI), CHƯA từng kiểm .where() (cột được LỌC). Mock trả cố định
   * 2 dòng "bất kể điều kiện lọc" — đổi `lt(expiresAt, now)` thành `lt(createdAt, now)`
   * ở alertExpirySweeper.ts (đúng thứ §4.2 cấm: "một đồng hồ tuỳ tiện sẽ đóng nhầm
   * cảnh báo của máy vẫn đang hỏng") vẫn để 3 test trên XANH. Test này khẳng định
   * WHERE thật sự tham chiếu cột "expiresAt", không phải "createdAt".
   *
   * ĐẶT TRƯỚC test "lỗi DB" bên dưới có chủ ý: test đó dùng vi.resetModules() +
   * vi.doMock() để đổi getDb sang bản ném lỗi, và không có gì phục hồi lại mock
   * gốc (vi.mock() ở đầu file) cho các test chạy SAU nó trong cùng file — đặt test
   * này sau sẽ luôn nhận lastWhereCond=null (getDb ném trước khi chạm .where()),
   * một lỗi cô lập test khác hẳn với cái mục 6 muốn kiểm.
   */
  it("WHERE của UPDATE phải lọc theo cột expiresAt, KHÔNG phải createdAt", async () => {
    const { sweepExpiredAlerts } = await import("./alertExpirySweeper");
    await sweepExpiredAlerts();

    expect(lastWhereCond).toBeTruthy();
    const names = columnNamesInCondition(lastWhereCond);
    expect(names).toContain("expiresAt"); // ★ đây là cái đổi sang createdAt sẽ làm ĐỎ
    expect(names).not.toContain("createdAt");
    // Hai điều kiện lọc còn lại của §4.2 (status='ACTIVE', acknowledgedAt IS NULL)
    // cũng phải còn nguyên — không ai vô tình xoá bớt khi sửa cột hạn dùng.
    expect(names).toContain("status");
    expect(names).toContain("acknowledgedAt");
  });

  it("lỗi DB ⇒ KHÔNG ném ra ngoài (best-effort, không làm sập tiến trình nền)", async () => {
    vi.resetModules();
    vi.doMock("../db/connection", () => ({ getDb: async () => { throw new Error("db down"); } }));
    const { sweepExpiredAlerts } = await import("./alertExpirySweeper");
    await expect(sweepExpiredAlerts()).resolves.toBeDefined();
  });
});
