/**
 * ════════════════════════════════════════════════════════════════════════════
 * `workshopTangId.db.test.ts` — Task 1: cột `workshops.tangId` CÓ TRONG DB mà
 * schema Drizzle KHÔNG khai ⇒ mọi truy vấn có kiểu đều mù với nó.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ĐO ĐƯỢC (2026-09-15, cả DB dev `aoi_management` lẫn DB test `aoi_management_test`):
 * `information_schema.columns` trả `workshops.tangId integer, is_nullable=YES` — cột có
 * thật, do migration `drizzle/0350_twin_toa_nha_va_tang.sql:127` thêm (khoá ngoại
 * `fk_workshops_tang → twin_tang(id) ON DELETE SET NULL` dòng 134, chỉ mục
 * `idx_workshops_tang` dòng 138). Nhưng `drizzle/schema/hierarchy.ts` bảng `workshops`
 * KHÔNG khai cột này, nên `workshops.tangId` là `undefined` ở thời gian chạy và
 * `Property 'tangId' does not exist` ở thời gian biên dịch. Một agent trong đợt QA đã
 * đọc schema rồi kết luận "cột không tồn tại" và phải đi đường vòng.
 *
 * LƯỚI NÀY ĐO GÌ — ba lớp, cố ý KHÔNG lớp nào tự thoả được:
 *   (1) DB nói gì: hỏi thẳng `information_schema.columns`. Nếu cột KHÔNG có trong DB thì
 *       lưới này đo nhầm bài toán ⇒ ĐỎ với tên dữ kiện thiếu, KHÔNG skip.
 *   (2) Drizzle khai gì: `getTableColumns(workshops)` phải chứa `tangId`. Đây là ca ĐỎ
 *       dứt khoát trước bản vá — không phụ thuộc dữ liệu.
 *   (3) Đọc thật qua Drizzle: `select({ id, tangId })` phải chạy VÀ trả ≥ 1 hàng. Ràng
 *       buộc "≥ 1 hàng" là bắt buộc: `expect(Array.isArray([])).toBe(true)` xanh trên tập
 *       RỖNG, mà tập rỗng là HỎNG chứ không phải ĐẠT.
 *   (4) Vào được `WHERE`: `isNotNull(workshops.tangId)` phải dựng và chạy được câu lệnh.
 *       ⚠ KHÔNG canh số hàng trả về: đo 2026-09-15 trên DB test có 6.160 xưởng mà ĐÚNG 0
 *       xưởng gắn tầng (DB dev: 25/26). Ca này chứng minh cột vào được mệnh đề lọc, không
 *       chứng minh có dữ liệu — nên nó KHÔNG được dùng làm bằng chứng đọc được (ca 3 làm).
 *
 * ⚠ Chạy trên DB TEST (vitest.setup ép `DATABASE_URL` → `<db>_test`). Lưới CHỈ ĐỌC:
 *   không INSERT/UPDATE/DELETE hàng nào.
 */
import { describe, expect, it, beforeAll } from "vitest";
import { getTableColumns, isNotNull, sql } from "drizzle-orm";

import { getDb } from "./connection";
import { workshops } from "../../drizzle/schema/hierarchy";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

let db: Db;

beforeAll(async () => {
  const d = await getDb();
  if (!d) throw new Error("KHÔNG ĐỌC ĐƯỢC: kết nối DB (DATABASE_URL chưa đặt hoặc kết nối hỏng)");
  db = d;
});

describe("workshops.tangId — cột có trong DB phải đọc được qua Drizzle", () => {
  it("dữ kiện nền: DB THẬT có cột tangId kiểu integer nullable (nếu không, lưới này đo nhầm bài)", async () => {
    const rows = (await db.execute(sql`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'workshops' AND column_name = 'tangId'
    `)) as unknown as Array<{ column_name: string; data_type: string; is_nullable: string }>;
    if (rows.length !== 1) {
      throw new Error(
        `KHÔNG ĐỌC ĐƯỢC: DB không có cột workshops.tangId (migration 0350 chưa áp?) — ` +
        `information_schema trả ${rows.length} dòng`,
      );
    }
    expect(rows[0].data_type).toBe("integer");
    expect(rows[0].is_nullable).toBe("YES");
  });

  it("schema Drizzle KHAI cột tangId (ca đỏ dứt khoát trước bản vá, không phụ thuộc dữ liệu)", () => {
    const cot = getTableColumns(workshops);
    expect(Object.keys(cot)).toContain("tangId");
    expect(cot.tangId?.name).toBe("tangId");
  });

  it("chọn được cột tangId mà không lỗi kiểu, và trả về ≥ 1 hàng (tập rỗng = HỎNG)", async () => {
    const hang = await db
      .select({ id: workshops.id, tangId: workshops.tangId })
      .from(workshops)
      .limit(5);
    expect(Array.isArray(hang)).toBe(true);
    if (hang.length === 0) {
      throw new Error("KHÔNG ĐỌC ĐƯỢC: bảng workshops rỗng — không có hàng nào để chứng minh cột đọc được");
    }
    for (const h of hang) {
      expect(h.tangId === null || typeof h.tangId === "number").toBe(true);
    }
  });

  it("lọc theo tangId khác null chạy được (chứng minh cột vào được WHERE)", async () => {
    const hang = await db
      .select({ id: workshops.id })
      .from(workshops)
      .where(isNotNull(workshops.tangId))
      .limit(5);
    expect(Array.isArray(hang)).toBe(true);
  });
});
