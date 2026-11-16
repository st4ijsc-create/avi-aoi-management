/**
 * Đường MẶC ĐỊNH của `demHangRoRi` (kết nối sẵn có của tầng test — đường đo rò thật) với bộ thực thi GIẢ, không DB: nó phải chạy CÙNG hai câu SQL của nhánh bộ thực thi (một nguồn SQL, `demQua`),
 * tham số = userId, theo thứ tự audit_logs rồi ai_pending_actions; không có kết nối ⇒ ném có mã; URL sai ⇒ ném TRƯỚC khi hỏi kết nối.
 * ĐỘT BIẾN PHẢI BẮT: đường mặc định có SQL riêng (lệch bảng/cột/userId) · đọc sai cột kết quả · nuốt việc thiếu kết nối · lấy kết nối trước khi kiểm URL.
 */
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { LoiKhungThu } from "./kenhGiaoDich";
import { demHangRoRi } from "./kiemRoRiDb";

const URL_TEST = "postgresql://u:p@127.0.0.1:5434/aoi_management_test";
const phuongNgu = new PgDialect();

function hoGia(tra: unknown[]) {
  const goi: Array<{ sql: string; params: unknown[] }> = [];
  return {
    goi,
    db: {
      execute: async (q: SQL) => {
        const t = phuongNgu.sqlToQuery(q);
        goi.push({ sql: t.sql, params: t.params });
        return tra.shift() ?? [];
      },
    },
  };
}

describe("demHangRoRi — đường mặc định (kết nối sẵn có của tầng test) dùng chung nguồn SQL", () => {
  it("★★★ đúng hai câu SQL theo thứ tự, tham số userId, kết quả cộng đúng", async () => {
    const h = hoGia([[{ n: 2 }], [{ n: 5 }]]);
    const r = await demHangRoRi(4242, URL_TEST, undefined, async () => h.db);
    expect(r).toEqual({ audit_logs: 2, ai_pending_actions: 5, tong: 7 });
    expect(h.goi).toEqual([
      { sql: 'select count(*)::int as n from audit_logs where "userId" = $1', params: [4242] },
      { sql: 'select count(*)::int as n from ai_pending_actions where "userId" = $1', params: [4242] },
    ]);
  });
  it("★★★ không có kết nối ⇒ ném LoiKhungThu THIEU_CSDL_TEST (không trả 0 im lặng)", async () => {
    await expect(demHangRoRi(1, URL_TEST, undefined, async () => null)).rejects.toMatchObject({ ma: "THIEU_CSDL_TEST" });
    await expect(demHangRoRi(1, URL_TEST, undefined, async () => null)).rejects.toBeInstanceOf(LoiKhungThu);
  });
  it("★★★ URL sai ⇒ ném TRƯỚC khi hỏi kết nối (bộ lấy kết nối không được gọi)", async () => {
    let daHoi = 0;
    await expect(
      demHangRoRi(1, "postgresql://u:p@127.0.0.1:5434/aoi_management", undefined, async () => {
        daHoi++;
        return null;
      }),
    ).rejects.toMatchObject({ ma: "SAI_CSDL_DO_RO_RI" });
    expect(daHoi).toBe(0);
  });
});
