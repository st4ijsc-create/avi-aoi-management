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
 *
 * ★ Task 8 (BG-4) — CHIỀU 1/2 ở trên chỉ so TÊN cột (`pg_attribute.attname`), nên MÙ trước một
 * đột biến thu hẹp kiểu: đo thật cho thấy thu `product_captures.captureExtId` từ `varchar(64)`
 * xuống `varchar(8)` (không chứa nổi một GUID 36 ký tự) vẫn để CẢ 27 ca ở hai file lưới schema
 * xanh, vì không ca nào canh KIỂU/ĐỘ DÀI. CHIỀU 3 dưới đây vá đúng lỗ đó: so `data_type` +
 * `character_maximum_length` (+ `numeric_precision/scale` cho numeric, `udt_name` cho enum) đọc
 * từ `information_schema.columns`, đối chiếu với đúng kiểu Drizzle khai (suy từ `columnType`
 * THẬT của mỗi cột — không chép tay — nên KHÔNG lệch khi ai đó đổi loại cột mà quên sửa test).
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

/** Kiểu + độ dài của MỘT cột, dạng chuẩn hoá để so được cả hai phía (Drizzle lẫn DB thật). */
type KieuCot = {
  dataType: string;
  charMaxLen: number | null;
  numericPrecision: number | null;
  numericScale: number | null;
  udtName: string | null;
};

function dinhDangKieuCot(k: KieuCot): string {
  if (k.charMaxLen !== null) return `${k.dataType}(${k.charMaxLen})`;
  if (k.numericPrecision !== null) return `${k.dataType}(${k.numericPrecision},${k.numericScale ?? 0})`;
  if (k.dataType === "USER-DEFINED") return `enum ${k.udtName}`;
  return k.dataType;
}

/** Kiểu + độ dài THẬT trong DB — `information_schema.columns` (ép `::int` vì các cột
 *  `character_maximum_length`/`numeric_precision`/`numeric_scale` mang domain
 *  `information_schema.cardinal_number`, driver `postgres` không tự nhận diện OID lạ đó
 *  và có thể trả về CHUỖI thay vì số nếu không ép kiểu tường minh). */
async function moiKieuCotThatTrongDb(tenBang: string): Promise<Map<string, KieuCot>> {
  const rows = await sql<
    { name: string; dataType: string; charMaxLen: number | null; numericPrecision: number | null; numericScale: number | null; udtName: string }[]
  >`
    SELECT column_name AS name,
           data_type AS "dataType",
           character_maximum_length::int AS "charMaxLen",
           numeric_precision::int AS "numericPrecision",
           numeric_scale::int AS "numericScale",
           udt_name AS "udtName"
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${tenBang}`;
  return new Map(rows.map((r) => [r.name, {
    dataType: r.dataType, charMaxLen: r.charMaxLen, numericPrecision: r.numericPrecision,
    numericScale: r.numericScale, udtName: r.udtName,
  }]));
}

/**
 * Kiểu + độ dài KHAI trong Drizzle — suy từ `columnType` THẬT của mỗi cột (`PgVarchar`,
 * `PgSerial`, …), KHÔNG chép tay danh sách cột→kiểu (chép tay sẽ lệch âm thầm khi ai đó đổi
 * loại cột mà quên sửa test). Chỉ phủ các `columnType` đang thật sự dùng trong cây cấu hình/
 * kết quả — gặp loại lạ thì NÉM LỖI RÕ thay vì bỏ qua, để không lặp lại đúng lỗi "canh tên,
 * mù kiểu" mà Task 8 vừa vá.
 */
function moiKieuCotKhaiDrizzle(bang: Table): Map<string, KieuCot> {
  const cot = getTableColumns(bang) as unknown as Record<string, any>;
  const ket = new Map<string, KieuCot>();
  for (const c of Object.values(cot)) {
    const rong: KieuCot = { dataType: "", charMaxLen: null, numericPrecision: null, numericScale: null, udtName: null };
    switch (c.columnType) {
      case "PgSerial":
      case "PgInteger":
        ket.set(c.name, { ...rong, dataType: "integer" });
        break;
      case "PgVarchar":
        ket.set(c.name, { ...rong, dataType: "character varying", charMaxLen: c.length ?? null });
        break;
      case "PgText":
        ket.set(c.name, { ...rong, dataType: "text" });
        break;
      case "PgTimestamp":
        ket.set(c.name, { ...rong, dataType: c.withTimezone ? "timestamp with time zone" : "timestamp without time zone" });
        break;
      case "PgNumeric":
        ket.set(c.name, { ...rong, dataType: "numeric", numericPrecision: c.precision ?? null, numericScale: c.scale ?? null });
        break;
      case "PgBoolean":
        ket.set(c.name, { ...rong, dataType: "boolean" });
        break;
      case "PgEnumColumn":
      case "PgEnumObjectColumn":
        ket.set(c.name, { ...rong, dataType: "USER-DEFINED", udtName: c.enum.enumName });
        break;
      default:
        throw new Error(
          `moiKieuCotKhaiDrizzle: columnType lạ "${c.columnType}" (cột "${c.name}") — thêm case ` +
            `mới thay vì bỏ qua, nếu không CHIỀU 3 sẽ ÂM THẦM không canh kiểu cho cột này`,
        );
    }
  }
  return ket;
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

      it("CHIỀU 3 (Task 8, BG-4) — KIỂU và ĐỘ DÀI mọi cột khớp THẬT trong DB, không chỉ TÊN", async () => {
        const kieuDb = await moiKieuCotThatTrongDb(ten);
        const kieuDrizzle = moiKieuCotKhaiDrizzle(drizzle);
        const lech: string[] = [];
        let soCotDaSo = 0;
        for (const [tenCot, khai] of kieuDrizzle) {
          const that = kieuDb.get(tenCot);
          if (!that) continue; // CHIỀU 1 ở trên đã báo cột vắng mặt — không lặp lại lỗi ở đây
          soCotDaSo++;
          // So charMaxLen CHỈ khi kiểu là chuỗi có độ dài, so precision/scale CHỈ khi là
          // numeric — Postgres báo numeric_precision=32/scale=0 cho CẢ CỘT integer (đúng theo
          // chuẩn SQL, integer thuộc họ "exact numeric"), so vô điều kiện sẽ ĐỎ OAN cột integer.
          const khop = khai.dataType === that.dataType
            && (khai.dataType !== "character varying" || khai.charMaxLen === that.charMaxLen)
            && (khai.dataType !== "numeric" || (khai.numericPrecision === that.numericPrecision && khai.numericScale === that.numericScale))
            && (khai.dataType !== "USER-DEFINED" || khai.udtName === that.udtName);
          if (!khop) {
            lech.push(`"${tenCot}": Drizzle khai ${dinhDangKieuCot(khai)}, DB thật ${dinhDangKieuCot(that)}`);
          }
        }
        // Chống-tự-thoả CỤC BỘ: nếu 0 cột nào so được (tên bảng sai / Drizzle rỗng cột), vòng
        // lặp trên không sinh lỗi nào — lech=[] một cách VÔ NGHĨA (đúng lỗ đã chứng minh ở đột
        // biến varchar(8): so hai tập RỖNG luôn xanh).
        expect(soCotDaSo, `chỉ so được ${soCotDaSo} cột ở "${ten}" — CHIỀU 3 có thể đang so trên tập RỖNG`).toBeGreaterThan(5);
        expect(lech, `lệch KIỂU/ĐỘ DÀI giữa Drizzle và DB thật ở "${ten}":\n${lech.join("\n")}`).toEqual([]);
      });
    });
  }
});
