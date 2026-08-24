import { describe, it, expect } from "vitest";
import { getDb } from "./connection";
import { sql } from "drizzle-orm";

/**
 * BẤT BIẾN: `ntfConfirmedAt` và `overallResult` KHÔNG được lệch nhau.
 *
 * `classifyInspectionResult` (server/services/liveStatsRollupService.ts) coi
 * `ntfConfirmedAt != null` là NTF kể cả khi `overallResult` còn là NG — một quy tắc
 * ưu tiên phòng vệ, có tài liệu và có ca test đơn vị riêng (đọc docblock ở đó). Mọi
 * nơi KHÁC trong repo chỉ đọc `overallResult`. Hai hành vi đó chỉ khác nhau khi hai
 * cột lệch, và đường ghi duy nhất (`updateProductInspectionNTF`, server/db/inspection.ts)
 * set cả hai cùng lúc trong CÙNG một UPDATE — nên hôm nay chúng không lệch được.
 *
 * Lưới này canh đúng điều đó bằng số liệu, không bằng niềm tin. Nó ĐỎ ngay khi có
 * mã mới ghi một cột mà quên cột kia (kể cả một lời gọi `.set(...)` mới ở nơi khác
 * mà chỉ gán ntfConfirmedAt, hay một sửa lỗi vô tình bỏ overallResult khỏi
 * `updateProductInspectionNTF`).
 *
 * Đo 2026-08-24: DB dev (aoi_management, KHÔNG phải DB test này) có đúng 244 hàng
 * rơi vào bucket NTF (overallResult='NTF' HOẶC ntfConfirmedAt khác NULL), và 0/244
 * trong số đó dùng nhánh `ntfConfirmedAt` (tức 0 hàng có ntfConfirmedAt khác NULL) —
 * nhánh phòng vệ CHƯA từng được nhánh chính dùng tới, nhưng nó vẫn phải còn đó vì
 * nó là lưới an toàn cho đường ghi trong tương lai. Trên chính DB TEST mà ca dưới
 * đây chạy, dữ liệu seed từ các suite khác để lại 41.716 hàng product_inspections,
 * 115 hàng có ntfConfirmedAt khác NULL, và 0 hàng lệch — bảng KHÔNG rỗng nên ca thứ
 * hai dưới đây (chống tự thoả) xanh vì có dữ liệu thật, không phải vì bảng trống.
 */
describe("bất biến: ntfConfirmedAt không lệch với overallResult", () => {
  it("KHÔNG hàng nào có ntfConfirmedAt mà overallResult khác 'NTF'", async () => {
    const db = await getDb();
    if (!db) throw new Error("không có DB test — chạy: node scripts/setup-test-db.mjs");
    const r: any = await db.execute(sql`
      SELECT count(*)::int AS lech
      FROM product_inspections
      WHERE "ntfConfirmedAt" IS NOT NULL AND "overallResult" <> 'NTF'`);
    const lech = ((r.rows ?? r) as Array<{ lech: number }>)[0].lech;
    expect(lech, `${lech} hàng có ntfConfirmedAt nhưng overallResult khác NTF`).toBe(0);
  });

  it("mệnh đề KHÔNG tự thoả — bảng phải có dữ liệu để phép đo có nghĩa", async () => {
    const db = await getDb();
    if (!db) throw new Error("không có DB test — chạy: node scripts/setup-test-db.mjs");
    const r: any = await db.execute(sql`SELECT count(*)::int AS n FROM product_inspections`);
    const n = ((r.rows ?? r) as Array<{ n: number }>)[0].n;
    expect(n, "bảng rỗng ⇒ ca trên tự thoả, phép đo vô nghĩa").toBeGreaterThan(0);
  });
});
