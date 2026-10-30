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
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
// MỌI tệp trong drizzle/schema (không chỉ barrel index — có tệp không export qua barrel)
const tatCa = import.meta.glob("../../drizzle/schema/*.ts", { eager: true }) as Record<string, Record<string, unknown>>;

type MienTru = { bang: string; cot: string | "*"; ngay: string; lyDo: string; bangChung: string };
/** `cot: "*"` = cả bảng chưa có trên DB. Thêm mục ⇒ phải đủ 3 trường; không xoá cột/bảng khỏi Drizzle mà không gỡ mục. */
const MIEN_TRU: MienTru[] = [];

const DB_URL = process.env.DATABASE_URL;
let sql: ReturnType<typeof postgres>;
let dbCot: Map<string, Set<string>>;

function bangKhai(): { ten: string; cot: string[] }[] {
  const ra = new Map<string, string[]>();
  for (const v of Object.values(tatCa).flatMap((m) => Object.values(m))) {
    if (!is(v, PgTable)) continue;
    const cfg = getTableConfig(v as PgTable);
    if ((cfg.schema ?? "public") !== "public") continue;
    ra.set(cfg.name, cfg.columns.map((c) => c.name));
  }
  return [...ra].map(([ten, cot]) => ({ ten, cot })).sort((a, b) => a.ten.localeCompare(b.ten));
}

/** Tập cột thiếu: "bang.cot" hoặc "bang.*" khi cả bảng vắng. */
export function tinhThieu(khai: { ten: string; cot: string[] }[], db: Map<string, Set<string>>): string[] {
  const thieu: string[] = [];
  for (const b of khai) {
    const co = db.get(b.ten);
    if (!co) { thieu.push(`${b.ten}.*`); continue; }
    for (const c of b.cot) if (!co.has(c)) thieu.push(`${b.ten}.${c}`);
  }
  return thieu.sort();
}

beforeAll(async () => {
  sql = postgres(DB_URL!, { max: 1 });
  const rows = await sql<{ t: string; c: string }[]>`
    SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = 'public'`;
  dbCot = new Map();
  for (const r of rows) (dbCot.get(r.t) ?? dbCot.set(r.t, new Set()).get(r.t)!).add(r.c);
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
    expect(tinhThieu(khaiGia, dbCot)).toEqual([`${b0.ten}.__cot_gia__`, "__bang_gia__.*"].sort());
  });
});
