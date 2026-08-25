import { describe, it, expect } from "vitest";
import { getDb } from "./connection";
import { sql } from "drizzle-orm";

/**
 * BẤT BIẾN (spec §3.3, Pha 1A Task 5): một `productModelId` HOẶC đã chuyển sang cây (mọi
 * điểm đo LIVE có `captureRowId` khác NULL), HOẶC còn phẳng (mọi điểm LIVE có `captureRowId`
 * NULL). Trạng thái nửa vời — một phần điểm trỏ vào cây, phần còn lại vẫn phẳng — là nguồn
 * của lỗi phân giải KHÔNG THỂ CHẨN ĐOÁN: engine hiển thị/nghiệm thu sẽ đọc đúng cho nửa này,
 * sai cho nửa kia, và không có tín hiệu nào báo cho biết đang ở trường hợp nào.
 *
 * Cố ý KHÔNG làm CHECK constraint: lúc ĐANG chuyển đổi trong một transaction (di trú một
 * `productModelId` từ phẳng sang cây, điểm-theo-điểm) thì trạng thái nửa vời là HỢP LỆ —
 * đó là điều kiện cần trong lúc thi công. Lưới này canh trạng thái ĐÃ COMMIT, tức là canh
 * biên giới GIỮA hai giao dịch, không canh bên trong một giao dịch.
 *
 * Đo thật lúc dựng lưới (2026-08-25, DB `aoi_management_test`, vai `avi_app`):
 * `measurement_point_defs` có 2.340 hàng LIVE (`deletedAt IS NULL`), CẢ 2.340 hàng đều có
 * `captureRowId IS NULL` (0 hàng đã chuyển sang cây — Pha 1A mới dựng NỀN, chưa có đường ghi
 * nào gắn `captureRowId` thật). Vì vậy ca thứ nhất hiện xanh MỘT CÁCH CÓ NGHĨA — không có
 * `productModelId` nào trộn hai loại — và ca thứ hai (chống tự thoả) xanh nhờ 2.340 hàng
 * THẬT, không phải bảng rỗng ngụy trang thành "không vi phạm". Không cần tự chèn dữ liệu
 * trong `beforeAll` cho hai ca này.
 *
 * ★ Đã CHỨNG MINH lưới ĐỎ ĐƯỢC (không phải thước chết): dựng thủ công một `productModelId`
 * cô lập (`_probe` riêng, không đụng 2.340 hàng thật) với 1 điểm phẳng + 1 điểm cây, chạy lại
 * ca thứ nhất → ĐỎ, đúng `productModelId` bị nêu tên trong thông điệp lỗi; dọn sạch → chạy
 * lại → xanh trở lại. Xem `task-5-report.md` để có nguyên văn output của cả hai lượt chạy.
 */
describe("bất biến: sản phẩm không trộn điểm phẳng và điểm cây", () => {
  it("KHÔNG sản phẩm nào có CẢ điểm phẳng LẪN điểm cây", async () => {
    const db = await getDb();
    if (!db) throw new Error("không có DB test — chạy: node scripts/setup-test-db.mjs");
    const r: any = await db.execute(sql`
      SELECT "productModelId",
             count(*) FILTER (WHERE "captureRowId" IS NULL)     AS phang,
             count(*) FILTER (WHERE "captureRowId" IS NOT NULL) AS cay
      FROM measurement_point_defs
      WHERE "deletedAt" IS NULL
      GROUP BY "productModelId"
      HAVING count(*) FILTER (WHERE "captureRowId" IS NULL) > 0
         AND count(*) FILTER (WHERE "captureRowId" IS NOT NULL) > 0`);
    const rows = (r.rows ?? r) as Array<{ productModelId: number; phang: string; cay: string }>;
    expect(rows, `sản phẩm trộn hai loại: ${rows.map((x) => x.productModelId).join(", ")}`).toEqual([]);
  });

  it("mệnh đề KHÔNG tự thoả — phải có điểm đo trong bảng để phép đo có nghĩa", async () => {
    const db = await getDb();
    const r: any = await db!.execute(sql`
      SELECT count(*)::int AS n FROM measurement_point_defs WHERE "deletedAt" IS NULL`);
    const n = ((r.rows ?? r) as Array<{ n: number }>)[0].n;
    expect(n, "bảng rỗng ⇒ ca trên tự thoả, phép đo vô nghĩa").toBeGreaterThan(0);
  });
});
