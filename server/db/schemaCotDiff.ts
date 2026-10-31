/**
 * So cột Drizzle khai ⊆ cột có thật trên DB — MỘT hàm dùng chung cho lưới CỔNG (`drizzleSchemaVsDb.db.test.ts`) và kiểm lúc KHỞI ĐỘNG server.
 *
 * Vì sao: drizzle `INSERT`/`select()` liệt kê MỌI cột đã khai; mã lên TRƯỚC migration ⇒ mọi câu chạm bảng đó nổ "column does not exist" (hoặc ghi hỏng
 * im lặng nơi khác). Lưới cổng chỉ canh `_test`; lỗi thật xảy ra trên DEV/sản xuất ⇒ cùng phép so chạy một lần lúc boot (xem `kiemSchemaChung.ts`).
 *
 * Thuần: không import DB. Một chiều — cột DB thừa không sao.
 */
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";

export interface BangKhai { ten: string; cot: string[] }

/** Mọi bảng schema `public` tìm được trong các module (export của tệp schema). Trùng tên bảng gộp một. */
export function bangKhaiTuModule(modules: ReadonlyArray<Record<string, unknown>>): BangKhai[] {
  const ra = new Map<string, string[]>();
  for (const m of modules) {
    for (const v of Object.values(m)) {
      if (!is(v, PgTable)) continue;
      const cfg = getTableConfig(v as PgTable);
      if ((cfg.schema ?? "public") !== "public") continue;
      ra.set(cfg.name, cfg.columns.map((c) => c.name));
    }
  }
  return [...ra].map(([ten, cot]) => ({ ten, cot })).sort((a, b) => a.ten.localeCompare(b.ten));
}

/** Gom dòng `information_schema.columns` (table_name, column_name) thành bảng → tập cột. */
export function gomCotDb(rows: ReadonlyArray<{ t: unknown; c: unknown }>): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const r of rows) {
    const t = String(r.t);
    (m.get(t) ?? m.set(t, new Set()).get(t)!).add(String(r.c));
  }
  return m;
}

/** "bang.cot" cho mỗi cột khai mà DB vắng; "bang.*" khi cả bảng vắng. Đã sắp xếp. */
export function tinhThieu(khai: ReadonlyArray<BangKhai>, db: ReadonlyMap<string, ReadonlySet<string>>): string[] {
  const thieu: string[] = [];
  for (const b of khai) {
    const co = db.get(b.ten);
    if (!co) { thieu.push(`${b.ten}.*`); continue; }
    for (const c of b.cot) if (!co.has(c)) thieu.push(`${b.ten}.${c}`);
  }
  return thieu.sort();
}
