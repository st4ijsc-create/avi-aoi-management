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
 *
 * ★★ Task 8 (BG-4, 2026-08-28) — NÓI THẬT về ca chống-tự-thoả thứ hai dưới đây: kế hoạch gốc
 * đòi siết nó thành `count(*) FILTER (WHERE "captureRowId" IS NOT NULL) > 0` (tức đòi bằng
 * chứng đã có điểm đo THẬT SỰ CHUYỂN SANG CÂY). Đo lại tại đây cho thấy điều đó BẤT KHẢ THI
 * trong Pha 1B: `measurement_point_defs.captureRowId` chỉ được ghi bởi đồng bộ teach data
 * (Khối B, CHƯA CHẠY) — Pha 1B chỉ ghi cây KẾT QUẢ (`inspection_surfaces/positions/captures`,
 * xem ca chống-tự-thoả tương ứng ở cuối `server/db/cayKetQuaSchema.db.test.ts`), không đụng gì
 * đến cây CẤU HÌNH. Nên GIỮ NGUYÊN mệnh đề `count(*) > 0` — nhưng phải khai ĐÚNG những gì nó
 * canh: bảng `measurement_point_defs` KHÔNG RỖNG, hết. Nó KHÔNG canh, và CHƯA THỂ canh, việc
 * "có điểm đo nào đã chuyển sang cây cấu hình" — một tên ca nghe rộng hơn phạm vi thật của nó
 * là đúng khuôn sinh "xanh giả" mà dự án này đã trả giá nhiều lần. Việc siết thật (đòi
 * `captureRowId > 0`) chuyển sang Khối B (BG-20), sau khi đồng bộ teach data chạy.
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

  it("chống-tự-thoả — CHỈ canh bảng KHÔNG RỖNG (Task 8: CHƯA canh đã có điểm nào chuyển sang cây)", async () => {
    // ⚠ Đọc kỹ trước khi "siết" ca này: nó KHÔNG chứng minh có điểm đo nào đã chuyển sang cây
    // cấu hình (đòi hỏi đó là `captureRowId > 0`, xem doc-comment đầu file, Task 8/BG-4) — chỉ
    // chứng minh bảng có hàng, đủ để ca bất biến phía trên không tự thoả trên tập RỖNG. Việc
    // siết thành `captureRowId > 0` chuyển sang Khối B (BG-20) sau khi đồng bộ teach data chạy.
    const db = await getDb();
    const r: any = await db!.execute(sql`
      SELECT count(*)::int AS n FROM measurement_point_defs WHERE "deletedAt" IS NULL`);
    const n = ((r.rows ?? r) as Array<{ n: number }>)[0].n;
    expect(n, "bảng rỗng ⇒ ca bất biến phía trên tự thoả, phép đo vô nghĩa").toBeGreaterThan(0);
  });
});
