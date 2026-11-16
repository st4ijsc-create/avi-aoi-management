/**
 * Đường MẶC ĐỊNH của `demHangRoRi` (kết nối riêng — đường đo rò thật) với `postgres` GIẢ, không DB: nó phải chạy CÙNG hai câu SQL của nhánh bộ thực thi (một nguồn SQL, `demQua`),
 * tham số = userId, theo thứ tự audit_logs rồi ai_pending_actions, đóng kết nối kể cả khi truy vấn ném.
 * ĐỘT BIẾN PHẢI BẮT: đường mặc định có SQL riêng (lệch bảng/cột/userId) · không đóng kết nối · đọc sai cột kết quả.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const gia = vi.hoisted(() => ({ goi: [] as Array<{ sql: string; params: unknown[] }>, daDong: 0, tra: [] as unknown[], nem: false }));
vi.mock("postgres", () => ({
  default: () => ({
    unsafe: async (sql: string, params: unknown[]) => {
      gia.goi.push({ sql, params });
      if (gia.nem) throw new Error("truy vấn hỏng");
      return gia.tra.shift() ?? [];
    },
    end: async () => {
      gia.daDong++;
    },
  }),
}));

import { demHangRoRi } from "./kiemRoRiDb";

const URL_TEST = "postgresql://u:p@127.0.0.1:5434/aoi_management_test";
beforeEach(() => {
  gia.goi = [];
  gia.daDong = 0;
  gia.tra = [];
  gia.nem = false;
});

describe("demHangRoRi — đường mặc định (kết nối riêng) dùng chung nguồn SQL", () => {
  it("★★★ đúng hai câu SQL theo thứ tự, tham số userId, kết quả cộng đúng, đóng kết nối", async () => {
    gia.tra = [[{ n: 2 }], [{ n: 5 }]];
    const r = await demHangRoRi(4242, URL_TEST);
    expect(r).toEqual({ audit_logs: 2, ai_pending_actions: 5, tong: 7 });
    expect(gia.goi).toEqual([
      { sql: 'select count(*)::int as n from audit_logs where "userId" = $1', params: [4242] },
      { sql: 'select count(*)::int as n from ai_pending_actions where "userId" = $1', params: [4242] },
    ]);
    expect(gia.daDong).toBe(1);
  });
  it("★★★ truy vấn ném ⇒ lỗi lan ra VÀ kết nối vẫn đóng", async () => {
    gia.nem = true;
    await expect(demHangRoRi(1, URL_TEST)).rejects.toThrow("truy vấn hỏng");
    expect(gia.daDong).toBe(1);
  });
});
