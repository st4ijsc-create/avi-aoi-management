/**
 * doc 81 Đợt 1C Task 4 fix round 1 (#3) — đọc allowlist gateway lỗi ⇒ 503, và LOG phải nói NGUYÊN NHÂN.
 *
 * Bản đầu log "[api/v1 ingest] transient failure → 503: Failed query: select …" — che mất mã Postgres
 * ở `err.cause` (vd 42P01 khi DB chưa áp mig 0361), nên vận hành đọc log sẽ tưởng DB chớp và cứ chờ.
 * Oracle độc lập: lỗi THẬT từ Postgres `_test` qua drizzle THẬT (truy vấn một bảng không tồn tại ⇒
 * DrizzleQueryError với cause.code = 42P01), không dựng tay hình dạng lỗi.
 * Tệp riêng: bộ gộp log 503 là trạng thái module (cửa sổ 10 s) — tệp khác log 503 trước sẽ nuốt lượt này.
 */
import { describe, it, expect, vi } from "vitest";
import { sql } from "drizzle-orm";
import { rangBuocMauTheoKhoa } from "./ingestRangBuoc";

const DB_URL = process.env.DATABASE_URL;

describe.skipIf(!DB_URL)("Task 4 fix #3 — log 503 của đường allowlist mang mã nguyên nhân (DB _test thật)", () => {
  it("★ bảng allowlist vắng (42P01 thật) ⇒ 503 db_unavailable; log nêu 'gateway allowlist' + 42P01 + thông điệp nguyên nhân; lượt thứ hai trong cửa sổ bị GỘP", async () => {
    const { getDb } = await import("../../db/connection");
    const docHong = async () => {
      const db = await getDb();
      await db!.execute(sql`SELECT 1 FROM "gateway_device_allowlist_khong_ton_tai_t4"`);
      return [];
    };
    const gw = { id: 1, code: "T4-GW-LOG", machineType: "IOT_GATEWAY" };
    const mau = [{ deviceId: "X", machineId: null }];
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(rangBuocMauTheoKhoa(mau, gw, docHong)).rejects.toMatchObject({ status: 503, code: "db_unavailable" });
      expect(spy).toHaveBeenCalledTimes(1);
      const dong = spy.mock.calls[0].map(String).join(" ");
      expect(dong).toContain("gateway allowlist");
      expect(dong).toContain("42P01");
      expect(dong).toMatch(/gateway_device_allowlist_khong_ton_tai_t4.*does not exist|does not exist.*gateway_device_allowlist_khong_ton_tai_t4/);
      // Vẫn gộp theo tần suất: lượt thứ hai trong cửa sổ 10 s KHÔNG in thêm dòng nào.
      await expect(rangBuocMauTheoKhoa(mau, gw, docHong)).rejects.toMatchObject({ status: 503 });
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});
