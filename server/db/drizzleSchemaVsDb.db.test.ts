/**
 * LƯỚI CHUNG (CỔNG CSDL THẬT) — MỌI bảng khai trong `drizzle/schema/*` phải có đủ cột khai trên DB test.
 *
 * Vì sao: drizzle `INSERT` liệt kê MỌI cột đã khai. Mã khai một cột mà DB chưa có (migration chưa áp / quên viết) thì mọi câu INSERT
 * vào bảng đó nổ — hoặc tệ hơn, ghi hỏng im lặng ở nơi khác. Các lưới theo từng bảng (cayKetQuaSchema, cayCauHinhSchema…) chỉ phủ vài bảng;
 * lưới này duyệt TẤT CẢ trong một lần đọc `information_schema.columns`.
 *
 * Chỉ MỘT chiều: Drizzle ⊆ DB. Cột DB thừa (migration đi trước mã, cột cũ) KHÔNG sao ⇒ không canh.
 *
 * Nợ cũ lộ ra ⇒ ghi vào MIEN_TRU với ngày + lý do + bằng chứng; không có chỗ nào để lặng lẽ bỏ qua. Mục miễn trừ mà DB nay đã đủ cột
 * ⇒ test ĐỎ (miễn trừ cũ phải bị gỡ, không để thành lỗ thủng vĩnh viễn).
 *
 * Chống tự thoả: số bảng duyệt phải ≥ ngưỡng, và mọi `pgTable("tên"` trong mã nguồn schema phải nằm trong tập bảng thu được qua barrel
 * (bảng quên `export *` ở index sẽ không bị lưới bỏ sót).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { bangKhaiTuModule, gomCotDb, tinhThieu } from "./schemaCotDiff";
import { NGUON_SCHEMA_RUNTIME } from "./kiemSchemaChung";
// MỌI tệp trong drizzle/schema (không chỉ barrel index — có tệp không export qua barrel)
const tatCa = import.meta.glob("../../drizzle/schema/*.ts", { eager: true }) as Record<string, Record<string, unknown>>;

type MienTru = { bang: string; cot: string | "*"; ngay: string; lyDo: string; bangChung: string };
/** `cot: "*"` = cả bảng chưa có trên DB. Thêm mục ⇒ phải đủ 3 trường; không xoá cột/bảng khỏi Drizzle mà không gỡ mục. */
const MIEN_TRU: MienTru[] = [];

const DB_URL = process.env.DATABASE_URL;
let sql: ReturnType<typeof postgres>;
let dbCot: Map<string, Set<string>>;

const bangKhai = () => bangKhaiTuModule(Object.values(tatCa));

beforeAll(async () => {
  sql = postgres(DB_URL!, { max: 1 });
  const rows = await sql<{ t: string; c: string }[]>`
    SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = 'public'`;
  dbCot = gomCotDb(rows);
});
afterAll(async () => { await sql?.end({ timeout: 5 }); });

describe("★ lưới chung — cột Drizzle khai ⊆ cột có thật trên DB test", () => {
  it("chống tự thoả: duyệt đủ nhiều bảng và không sót bảng nào khai trong mã nguồn schema (kể cả tệp không qua barrel)", () => {
    const khai = bangKhai();
    expect(khai.length).toBeGreaterThanOrEqual(300);
    expect(dbCot.size).toBeGreaterThanOrEqual(300);
    const dir = join(__dirname, "..", "..", "drizzle", "schema");
    const trongMa = new Set<string>();
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".ts")) continue;
      const src = readFileSync(join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      for (const m of src.matchAll(/\bpgTable\(\s*["']([^"']+)["']/g)) trongMa.add(m[1]);
    }
    const duocDuyet = new Set(khai.map((b) => b.ten));
    expect([...trongMa].filter((t) => !duocDuyet.has(t)).sort(), "bảng khai trong mã nhưng test không nạp được").toEqual([]);
  });

  it("★ nguồn schema của server lúc chạy (NGUON_SCHEMA_RUNTIME) phủ MỌI bảng tìm thấy qua glob", () => {
    const runtime = new Set(bangKhaiTuModule(NGUON_SCHEMA_RUNTIME).map((b) => b.ten));
    expect(bangKhai().map((b) => b.ten).filter((t) => !runtime.has(t)), "tệp schema mới chưa thêm vào NGUON_SCHEMA_RUNTIME ⇒ kiểm lúc khởi động mù bảng đó").toEqual([]);
  });

  it("★ mọi cột khai tồn tại trên DB (trừ mục MIEN_TRU có ngày + lý do + bằng chứng)", () => {
    const thieu = tinhThieu(bangKhai(), dbCot);
    const mien = new Set(MIEN_TRU.map((m) => `${m.bang}.${m.cot === "*" ? "*" : m.cot}`));
    // miễn bảng "*" phủ mọi cột của bảng đó
    const bangMien = new Set(MIEN_TRU.filter((m) => m.cot === "*").map((m) => m.bang));
    const chuaMien = thieu.filter((x) => !mien.has(x) && !bangMien.has(x.split(".")[0]));
    expect(chuaMien, "cột Drizzle khai mà DB chưa có ⇒ INSERT sẽ nổ; áp migration hoặc ghi MIEN_TRU có bằng chứng").toEqual([]);
  });

  it("mục MIEN_TRU hợp lệ và không lỗi thời (DB nay đã đủ ⇒ phải gỡ)", () => {
    const thieu = new Set(tinhThieu(bangKhai(), dbCot));
    const hong: string[] = [];
    for (const m of MIEN_TRU) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(m.ngay) || m.lyDo.trim().length < 10 || m.bangChung.trim().length < 5) hong.push(`${m.bang}.${m.cot}: thiếu ngày/lý do/bằng chứng`);
      const con = m.cot === "*" ? thieu.has(`${m.bang}.*`) : thieu.has(`${m.bang}.${m.cot}`) || thieu.has(`${m.bang}.*`);
      if (!con) hong.push(`${m.bang}.${m.cot}: DB đã đủ — gỡ mục miễn trừ`);
    }
    expect(hong).toEqual([]);
  });

  it("tinhThieu bắt cột giả và bảng vắng (đột biến trong bộ nhớ)", () => {
    const khai = bangKhai();
    const b0 = khai[0];
    const khaiGia = [...khai.slice(1), { ten: b0.ten, cot: [...b0.cot, "__cot_gia__"] }, { ten: "__bang_gia__", cot: ["id"] }];
    const nen = new Set(tinhThieu(khai, dbCot)); // nợ thật (nếu có) không làm phép thử lệch
    expect(tinhThieu(khaiGia, dbCot).filter((x) => !nen.has(x))).toEqual([`${b0.ten}.__cot_gia__`, "__bang_gia__.*"].sort());
  });
});
