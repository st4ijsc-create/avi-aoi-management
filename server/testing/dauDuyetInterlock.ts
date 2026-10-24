/**
 * ★ Tiện ích TEST (kiem-dinh R1b-1 I1 a, 2026-10-25) — "ĐÓNG DẤU DUYỆT" cho luật interlock GIEO THẲNG BẢNG với `approvedBy` khác NULL.
 *
 * Từ mig 0434, một luật chỉ "đã duyệt còn hiệu lực" khi `approvedDefHash` == bám định nghĩa tag nguồn / đích HIỆN TẠI
 * (`services/interlock/dinhNghiaDuyet.ts`). Luật gieo thẳng bảng (fixture) không đi qua `interlock.approve` nên không có bám ⇒ enable / engine /
 * dispatcher coi là CHƯA duyệt (đúng hành vi sản phẩm). Tệp test nào muốn mô phỏng "luật ĐÃ được duyệt hợp lệ" gọi hàm này SAU khi gieo luật +
 * tag: nó chụp bám HIỆN TẠI vào `approvedDefHash` — đúng điều `approve` làm. Chỉ đụng hàng có `approvedBy` khác NULL.
 */
import { inArray } from "drizzle-orm";
import { getDb } from "../db/connection";
import { interlockRules } from "../../drizzle/schema";
import { bamDinhNghiaNhieu } from "../services/interlock/dinhNghiaDuyet";

export async function dongDauDuyetLuat(...ids: Array<number | number[]>): Promise<void> {
  const ds = ids.flat().map(Number).filter((x) => Number.isFinite(x));
  if (ds.length === 0) return;
  const db = await getDb();
  if (!db) throw new Error("dongDauDuyetLuat: không có CSDL test");
  const rows = await db.select().from(interlockRules).where(inArray(interlockRules.id, ds));
  const bam = await bamDinhNghiaNhieu(db as never, rows);
  for (const r of rows) {
    if (r.approvedBy == null) continue;
    await db.update(interlockRules).set({ approvedDefHash: bam.get(r.id) as string }).where(inArray(interlockRules.id, [r.id]));
  }
}
