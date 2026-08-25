/**
 * CỔNG CSDL THẬT — khai Drizzle của cây CẤU HÌNH 4 cấp (migration 0338) khớp CHÍNH XÁC cột
 * thật trong Postgres, canh CẢ HAI CHIỀU:
 *   (1) Drizzle → DB — mọi cột Drizzle khai đều tồn tại thật (bắt cột MA khai nhầm/gõ sai tên
 *       SQL, hoặc migration chưa áp).
 *   (2) DB → Drizzle — không cột DB nào vắng mặt trong khai Drizzle (bắt cột migration thêm mà
 *       quên khai, hoặc Drizzle bị xoá nhầm một cột đang sống).
 * Một lưới chỉ so MỘT chiều là thước xanh giả: (1) một mình không bắt được cột (2) ngược lại.
 *
 * Đọc trực tiếp `pg_attribute` (không phải danh sách chép tay) — nguồn sự thật DUY NHẤT là
 * chính catalog Postgres, y hệt quy ước `getTableColumns()` đã dùng ở `server/_core/publicUser.ts`.
 *
 * Ca chống-tự-thoả: nếu tên bảng gõ sai / bảng rỗng cột (0 dòng pg_attribute trả về), số cột
 * đọc được sẽ ≤ 5 và ca "> 5 cột" tự nó ĐỎ — ngăn lưới xanh vì so sánh hai tập RỖNG.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { getTableColumns, getTableName, type Table } from "drizzle-orm";
import { productSurfaces, productPositions, productCaptures } from "../../drizzle/schema";

const DB_URL = process.env.DATABASE_URL;

let sql: ReturnType<typeof postgres>;

/** Tên cột THẬT trong DB — hỏi thẳng `pg_attribute`, loại cột hệ thống và cột đã DROP. */
async function moiCotThatTrongDb(tenBang: string): Promise<string[]> {
  const rows = await sql<{ name: string }[]>`
    SELECT a.attname AS name
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = ${tenBang}
      AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY a.attname`;
  return rows.map((r) => r.name);
}

/** Tên cột KHAI trong Drizzle — tên SQL thật (`.name`), không phải tên field JS. */
function moiCotKhaiDrizzle(bang: Table): string[] {
  const cot = getTableColumns(bang) as unknown as Record<string, { name: string }>;
  return Object.values(cot).map((c) => c.name).sort();
}

const BANG: Array<{ ten: string; drizzle: Table }> = [
  { ten: "product_surfaces", drizzle: productSurfaces as unknown as Table },
  { ten: "product_positions", drizzle: productPositions as unknown as Table },
  { ten: "product_captures", drizzle: productCaptures as unknown as Table },
];

describe.skipIf(!DB_URL)("cây cấu hình 4 cấp — Drizzle khớp cột THẬT trong DB (0338)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
  });

  afterAll(async () => {
    await sql?.end();
  });

  for (const { ten, drizzle } of BANG) {
    describe(`bảng ${ten}`, () => {
      it(`getTableName(drizzle) khớp tên bảng SQL thật "${ten}"`, () => {
        expect(getTableName(drizzle)).toBe(ten);
      });

      it("chống-tự-thoả: đọc được > 5 cột từ pg_attribute (không phải bảng rỗng/tên sai)", async () => {
        const cotDb = await moiCotThatTrongDb(ten);
        expect(cotDb.length).toBeGreaterThan(5);
      });

      it("CHIỀU 1 — Drizzle → DB: mọi cột Drizzle khai đều tồn tại thật trong DB", async () => {
        const cotDb = new Set(await moiCotThatTrongDb(ten));
        const cotDrizzle = moiCotKhaiDrizzle(drizzle);
        const maKhai = cotDrizzle.filter((c) => !cotDb.has(c));
        expect(maKhai, `Drizzle khai cột KHÔNG tồn tại thật trong "${ten}": ${maKhai.join(", ")}`).toEqual([]);
      });

      it("CHIỀU 2 — DB → Drizzle: không cột DB nào vắng mặt trong khai Drizzle", async () => {
        const cotDb = await moiCotThatTrongDb(ten);
        const cotDrizzle = new Set(moiCotKhaiDrizzle(drizzle));
        const thieuKhai = cotDb.filter((c) => !cotDrizzle.has(c));
        expect(thieuKhai, `DB "${ten}" có cột mà Drizzle KHÔNG khai: ${thieuKhai.join(", ")}`).toEqual([]);
      });
    });
  }
});
