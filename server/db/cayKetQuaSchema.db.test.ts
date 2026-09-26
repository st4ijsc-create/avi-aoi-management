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
 *
 * ★ Task 8 (BG-4) — CHIỀU 1/2 ở trên chỉ so TÊN cột, nên MÙ trước một đột biến thu hẹp kiểu:
 * đo thật cho thấy thu `product_captures.captureExtId` (bảng chị em ở cây CẤU HÌNH, cùng
 * khuôn `captureExtId varchar(64)` như `inspection_captures.captureExtId` ở đây) xuống
 * `varchar(8)` vẫn để CẢ 27 ca của hai file lưới schema xanh. CHIỀU 3 dưới đây vá đúng lỗ đó:
 * so `data_type` + `character_maximum_length` (+ `numeric_precision/scale`, `udt_name` cho
 * enum) đọc từ `information_schema.columns`, đối chiếu đúng kiểu Drizzle khai (suy từ
 * `columnType` THẬT của mỗi cột, không chép tay).
 *
 * ★ Task 8 (BG-4) — thêm ca chống-tự-thoả CÂY KẾT QUẢ ở cuối file: kế hoạch gốc đòi siết
 * `measurement_point_defs.captureRowId > 0` (cây CẤU HÌNH) nhưng đo thật cho thấy BẤT KHẢ THI
 * trong Pha 1B — cột đó CHỈ được ghi bởi đồng bộ teach data (Khối B, chưa chạy): 2.354 hàng
 * `measurement_point_defs`, captureRowId khác NULL = 0. Mệnh đề chuyển sang canh cây KẾT QUẢ
 * (`inspection_surfaces/positions/captures`) — cây mà Pha 1B THẬT SỰ ghi được (6 hàng đo lúc
 * viết ca này). Xem BG-20 cho việc siết cây CẤU HÌNH ở Khối B.
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
 * `PgSerial`, …), KHÔNG chép tay danh sách cột→kiểu. Chỉ phủ các `columnType` đang thật sự
 * dùng trong cây kết quả — gặp loại lạ thì NÉM LỖI RÕ thay vì bỏ qua.
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

const BANG_MOI: Array<{ ten: string; drizzle: Table }> = [
  { ten: "inspection_surfaces", drizzle: inspectionSurfaces as unknown as Table },
  { ten: "inspection_positions", drizzle: inspectionPositions as unknown as Table },
  { ten: "inspection_captures", drizzle: inspectionCaptures as unknown as Table },
];

/** 4 cột mới trên product_inspections (migration 0339). */
const COT_MOI_PRODUCT_INSPECTIONS = ["ntfSource", "machineProductIndex", "configDriftFlags", "summaryCounts"];
/**
 * 8 cột mới trên measurement_results (migration 0339). "captureRowId" ĐÃ ĐỔI TÊN thành
 * "inspectionCaptureRowId" ở migration 0340 (Pha 1B, BG-8 Critical) — hai cột cùng tên
 * "captureRowId" từng trỏ HAI bảng khác nhau (đây trỏ inspection_captures — cây KẾT QUẢ;
 * measurement_point_defs."captureRowId" trỏ product_captures — cây CẤU HÌNH), chỉ MỘT có FK.
 */
const COT_MOI_MEASUREMENT_RESULTS = [
  "inspectionCaptureRowId", "componentExtId", "ntf", "ntfSource", "errorCode", "errorDesc", "startedAt", "completedAt",
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
        // Chống-tự-thoả CỤC BỘ: nếu 0 cột nào so được, vòng lặp trên không sinh lỗi nào —
        // lech=[] một cách VÔ NGHĨA (so hai tập RỖNG luôn xanh).
        expect(soCotDaSo, `chỉ so được ${soCotDaSo} cột ở "${ten}" — CHIỀU 3 có thể đang so trên tập RỖNG`).toBeGreaterThan(5);
        expect(lech, `lệch KIỂU/ĐỘ DÀI giữa Drizzle và DB thật ở "${ten}":\n${lech.join("\n")}`).toEqual([]);
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

  /**
   * Task 8 (BG-4) — thay cho mệnh đề bất khả thi "measurement_point_defs.captureRowId > 0"
   * (cây CẤU HÌNH — đo thật cho thấy KHÔNG có hàng nào chuyển sang cây trong Pha 1B, cột đó
   * chỉ được ghi bởi đồng bộ teach data ở Khối B chưa chạy). Ca này canh đúng cây mà Pha 1B
   * THẬT SỰ ghi được: cây KẾT QUẢ.
   *
   * Nếu cả ba bảng đều = 0, mọi khẳng định "khớp schema"/"kiểu đúng" ở các ca CHIỀU 1/2/3 phía
   * trên vẫn xanh (chúng canh CẤU TRÚC cột, không canh SỐ HÀNG) — nhưng khi đó không có bằng
   * chứng THẬT nào cho biết ai đó từng ghi được vào cây KẾT QUẢ. Ca này là bằng chứng đó.
   */
  it("chống-tự-thoả CÂY KẾT QUẢ (Task 8, BG-4): inspection_surfaces/positions/captures đã có dữ liệu THẬT", async () => {
    const [row] = await sql<{ surfaces: number; positions: number; captures: number }[]>`
      SELECT
        (SELECT count(*)::int FROM inspection_surfaces)  AS surfaces,
        (SELECT count(*)::int FROM inspection_positions) AS positions,
        (SELECT count(*)::int FROM inspection_captures)  AS captures`;
    expect(
      row.captures,
      "inspection_captures RỖNG — Pha 1B CHƯA từng ghi được cây KẾT QUẢ nào; mọi phép đo về " +
        "cây kết quả (kể cả các ca CHIỀU 1/2/3 ở trên, vốn chỉ canh CẤU TRÚC cột chứ không canh " +
        "SỐ HÀNG) đang TỰ THOẢ trên dữ liệu rỗng và vô nghĩa. (Lưu ý: đây KHÔNG phải " +
        "measurement_point_defs.captureRowId — đó là cây CẤU HÌNH, luôn = 0 trong Pha 1B vì chỉ " +
        "đồng bộ teach data ở Khối B mới ghi cột đó; xem BG-20.)",
    ).toBeGreaterThan(0);
    expect(row.surfaces, "inspection_surfaces RỖNG").toBeGreaterThan(0);
    expect(row.positions, "inspection_positions RỖNG").toBeGreaterThan(0);
  });
});
