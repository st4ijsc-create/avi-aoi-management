/**
 * Hàng của kết quả `db.execute(...)` — MỘT helper chung (W18, kiểm định 2026-10-25). postgres-js trả MỘT MẢNG hàng (không có `.rows`); node-pg trả `{ rows }`.
 * Mã đọc `result.rows` trần luôn ra `undefined` trên postgres-js ⇒ số liệu luôn 0 / danh sách luôn rỗng mà không lỗi nào. Census `execRowsCensus.test.ts` đỏ nếu
 * có `.rows` trần trên kết quả `execute` ngoài các helper được khai.
 */
export function hangKetQua<T = Record<string, any>>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown } | null | undefined)?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}
