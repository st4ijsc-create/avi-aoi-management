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
import { NGUON_SCHEMA_RUNTIME } from "./nguonSchemaRuntime";
import { pgSchema, pgTable as pgTableGia, serial as serialGia } from "drizzle-orm/pg-core";
// MỌI tệp trong drizzle/schema (không chỉ barrel index — có tệp không export qua barrel)
const tatCa = import.meta.glob("../../drizzle/schema/*.ts", { eager: true }) as Record<string, Record<string, unknown>>;

type MienTru = { bang: string; cot: string | "*"; ngay: string; lyDo: string; bangChung: string };
/** `cot: "*"` = cả bảng chưa có trên DB. Thêm mục ⇒ phải đủ 3 trường; không xoá cột/bảng khỏi Drizzle mà không gỡ mục. */
const MIEN_TRU: MienTru[] = [];

const DB_URL = process.env.DATABASE_URL;
let sql: ReturnType<typeof postgres>;
let dbCot: Map<string, Set<string>>;

// Hợp glob drizzle/schema/*.ts và nguồn runtime (bảng khai ngoài drizzle/schema: hierarchy, edge, robot…).
const bangKhai = () => bangKhaiTuModule([...Object.values(tatCa), ...NGUON_SCHEMA_RUNTIME]);

/** Mọi tên `pgTable("tên"` trong mã nguồn không-test của drizzle/schema và server/** (bỏ chú thích). */
function tenBangTrongMa(): Set<string> {
  const ra = new Set<string>();
  const duyet = (dir: string) => {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      if (f.name === "node_modules") continue;
      const p = join(dir, f.name);
      if (f.isDirectory()) { duyet(p); continue; }
      if (!/\.tsx?$/.test(f.name) || /\.(test|spec)\./.test(f.name) || /\.d\.ts$/.test(f.name)) continue;
      const src = readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      for (const m of src.matchAll(/\bpgTable\(\s*["']([^"']+)["']/g)) ra.add(m[1]);
    }
  };
  duyet(join(__dirname, "..", "..", "drizzle", "schema"));
  duyet(join(__dirname, "..")); // server/
  return ra;
}

beforeAll(async () => {
  sql = postgres(DB_URL!, { max: 1 });
  const rows = await sql<{ t: string; c: string }[]>`
    SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = 'public'`;
  dbCot = gomCotDb(rows);
});
afterAll(async () => { await sql?.end({ timeout: 5 }); });

describe("★ lưới chung — cột Drizzle khai ⊆ cột có thật trên DB test", () => {
  it("chống tự thoả: duyệt đủ nhiều bảng và không sót bảng nào khai bằng pgTable trong drizzle/schema VÀ server/** (kể cả tệp không qua barrel, const không export)", () => {
    const khai = bangKhai();
    expect(khai.length).toBeGreaterThanOrEqual(300);
    expect(dbCot.size).toBeGreaterThanOrEqual(300);
    const trongMa = tenBangTrongMa();
    expect(trongMa.size).toBeGreaterThanOrEqual(400);
    const duocDuyet = new Set(khai.map((b) => b.ten));
    expect([...trongMa].filter((t) => !duocDuyet.has(t)).sort(), "bảng khai trong mã nhưng không nạp được — export nó và thêm module vào nguonSchemaRuntime.ts").toEqual([]);
  });

  it("★ nguồn schema của server lúc chạy (NGUON_SCHEMA_RUNTIME) phủ MỌI bảng: glob drizzle/schema và mọi pgTable trong server/**", () => {
    const runtime = new Set(bangKhaiTuModule(NGUON_SCHEMA_RUNTIME).map((b) => b.ten));
    const can = new Set([...bangKhai().map((b) => b.ten), ...tenBangTrongMa()]);
    expect([...can].filter((t) => !runtime.has(t)).sort(), "tệp schema mới chưa thêm vào NGUON_SCHEMA_RUNTIME ⇒ kiểm lúc khởi động mù bảng đó").toEqual([]);
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

  it("★ bảng thuộc schema KHÁC public bị loại (pgSchema giả); trùng tên bảng thì HỢP cột", () => {
    const khac = pgSchema("khac_gia");
    const bGia = khac.table("bang_schema_khac", { id: serialGia("id") });
    const a = pgTableGia("bang_chieu", { id: serialGia("id") });
    const b = pgTableGia("bang_chieu", { id: serialGia("id"), them: serialGia("them") });
    const kq = bangKhaiTuModule([{ bGia, b }, { a }]); // bản đầy đủ TRƯỚC, bản chiếu một phần SAU: giữ-bản-cuối sẽ mất cột "them"
    expect(kq.map((x) => x.ten)).toEqual(["bang_chieu"]);
    expect(kq[0].cot.sort()).toEqual(["id", "them"]);
  });

  it("tinhThieu bắt cột giả và bảng vắng (đột biến trong bộ nhớ)", () => {
    const khai = bangKhai();
    const b0 = khai[0];
    const khaiGia = [...khai.slice(1), { ten: b0.ten, cot: [...b0.cot, "__cot_gia__"] }, { ten: "__bang_gia__", cot: ["id"] }];
    const nen = new Set(tinhThieu(khai, dbCot)); // nợ thật (nếu có) không làm phép thử lệch
    expect(tinhThieu(khaiGia, dbCot).filter((x) => !nen.has(x))).toEqual([`${b0.ten}.__cot_gia__`, "__bang_gia__.*"].sort());
  });
});
