/**
 * CỔNG CSDL THẬT — khai Drizzle của cây KẾT QUẢ 3 cấp (migration 0339) khớp CHÍNH XÁC
 * cột thật trong Postgres, canh CẢ HAI CHIỀU:
 *   (1) Drizzle → DB — mọi cột Drizzle khai đều tồn tại thật (bắt cột MA khai nhầm/gõ sai
 *       tên SQL, hoặc migration chưa áp).
 *   (2) DB → Drizzle — không cột DB nào vắng mặt trong khai Drizzle (bắt cột migration
 *       thêm mà quên khai, hoặc Drizzle bị xoá nhầm một cột đang sống).
 * Một lưới chỉ so MỘT chiều là thước xanh giả: (1) một mình không bắt được cột thừa trong
 * Drizzle (2) một mình không bắt được cột DB có mà Drizzle thiếu.
 *
 * Đọc trực tiếp `pg_attribute` (không phải danh sách chép tay) — nguồn sự thật DUY NHẤT
 * là chính catalog Postgres, cùng khuôn với `server/db/cayCauHinhSchema.db.test.ts` (0338).
 *
 * Ca chống-tự-thoả: nếu tên bảng gõ sai / bảng rỗng cột (0 dòng pg_attribute trả về), số
 * cột đọc được sẽ ≤ 5 (per-bảng) hoặc ≤ 30 (tổng ba bảng) và các ca đó tự nó ĐỎ — ngăn
 * lưới xanh vì so sánh hai tập RỖNG.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { getTableColumns, getTableName, type Table } from "drizzle-orm";
import {
  inspectionSurfaces,
  inspectionPositions,
  inspectionCaptures,
  productInspections,
  measurementResults,
} from "../../drizzle/schema";

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

const BANG_MOI: Array<{ ten: string; drizzle: Table }> = [
  { ten: "inspection_surfaces", drizzle: inspectionSurfaces as unknown as Table },
  { ten: "inspection_positions", drizzle: inspectionPositions as unknown as Table },
  { ten: "inspection_captures", drizzle: inspectionCaptures as unknown as Table },
];

/** 4 cột mới trên product_inspections (migration 0339). */
const COT_MOI_PRODUCT_INSPECTIONS = ["ntfSource", "machineProductIndex", "configDriftFlags", "summaryCounts"];
/** 8 cột mới trên measurement_results (migration 0339). */
const COT_MOI_MEASUREMENT_RESULTS = [
  "captureRowId", "componentExtId", "ntf", "ntfSource", "errorCode", "errorDesc", "startedAt", "completedAt",
];

describe.skipIf(!DB_URL)("cây kết quả 3 cấp — Drizzle khớp cột THẬT trong DB (0339)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
  });

  afterAll(async () => {
    await sql?.end();
  });

  for (const { ten, drizzle } of BANG_MOI) {
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

  describe("mở rộng hai hypertable (0339)", () => {
    it("4 cột mới trên product_inspections tồn tại THẬT trong DB", async () => {
      const cotDb = new Set(await moiCotThatTrongDb("product_inspections"));
      const thieu = COT_MOI_PRODUCT_INSPECTIONS.filter((c) => !cotDb.has(c));
      expect(thieu, `product_inspections THIẾU cột mới 0339: ${thieu.join(", ")}`).toEqual([]);
      // Đối chứng: cũng phải có mặt trong khai Drizzle (productInspections import từ inspection.ts).
      const cotDrizzle = new Set(moiCotKhaiDrizzle(productInspections as unknown as Table));
      const thieuKhai = COT_MOI_PRODUCT_INSPECTIONS.filter((c) => !cotDrizzle.has(c));
      expect(thieuKhai, `Drizzle productInspections THIẾU khai cột mới 0339: ${thieuKhai.join(", ")}`).toEqual([]);
    });

    it("8 cột mới trên measurement_results tồn tại THẬT trong DB", async () => {
      const cotDb = new Set(await moiCotThatTrongDb("measurement_results"));
      const thieu = COT_MOI_MEASUREMENT_RESULTS.filter((c) => !cotDb.has(c));
      expect(thieu, `measurement_results THIẾU cột mới 0339: ${thieu.join(", ")}`).toEqual([]);
      const cotDrizzle = new Set(moiCotKhaiDrizzle(measurementResults as unknown as Table));
      const thieuKhai = COT_MOI_MEASUREMENT_RESULTS.filter((c) => !cotDrizzle.has(c));
      expect(thieuKhai, `Drizzle measurementResults THIẾU khai cột mới 0339: ${thieuKhai.join(", ")}`).toEqual([]);
    });
  });

  it("chống-tự-thoả TOÀN CỤC: tổng số cột đọc từ pg_attribute cho ba bảng mới phải > 30", async () => {
    const tongCot = (
      await Promise.all(BANG_MOI.map(({ ten }) => moiCotThatTrongDb(ten)))
    ).reduce((tong, cot) => tong + cot.length, 0);
    expect(
      tongCot,
      "tổng cột ba bảng mới quá thấp — pg_attribute có thể đang trả về RỖNG (tên bảng sai / " +
        "migration chưa áp), khiến mọi so sánh CHIỀU 1/CHIỀU 2 ở trên tự thoả trên hai tập rỗng",
    ).toBeGreaterThan(30);
  });
});
