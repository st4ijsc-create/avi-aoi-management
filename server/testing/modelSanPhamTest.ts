/**
 * ★ Tiện ích TEST (2026-10-23) — ĐĂNG KÝ model sản phẩm do test tạo để TỰ DỌN ở afterAll.
 *
 * Vì sao: tệp test tạo `product_models` bằng `createProductModel` / `INSERT INTO product_models` rồi bỏ đó ⇒ `_test` chất hàng nghìn model sống KHÔNG có biến thể BASE (đo 2026-10-23: 1.357
 * model sống thiếu BASE; mỗi lượt chạy cả bộ thêm hàng chục). Ca `doc55 PV0` từng đếm TOÀN BẢNG nên đỏ vì rác của tệp khác (xem productVariant.test.ts).
 *
 * Dọn: xoá HẲN model (kèm biến thể BASE nếu có); FK chặn (dữ liệu con còn trỏ tới) ⇒ XOÁ MỀM (`deletedAt = now()`) + cảnh báo — model đã xoá mềm không còn "sống" nên không phá bất biến.
 * Hook của helper đăng ký TRƯỚC hook của tệp test (import đầu tiên) ⇒ chạy SAU hook dọn riêng của tệp.
 */
import { afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";

const daDangKy = new Set<number>();

/** Đăng ký một model đã tạo; trả lại chính id để dùng như `x = dangKyModelSanPhamTest(await createProductModel(...))`. */
export function dangKyModelSanPhamTest<T extends number>(id: T): T {
  daDangKy.add(id);
  return id;
}

/** Chỉ cho test của helper. */
export function __modelDangGiu(): number[] {
  return [...daDangKy];
}

/** Dọn mọi model đã đăng ký. Không bao giờ ném. */
export async function donModelSanPhamTest(): Promise<{ daXoa: number; xoaMem: number }> {
  const ids = [...daDangKy];
  daDangKy.clear();
  let daXoa = 0;
  let xoaMem = 0;
  if (ids.length === 0) return { daXoa, xoaMem };
  const db = await getDb();
  if (!db) return { daXoa, xoaMem };
  for (const id of ids) {
    try {
      await db.execute(sql`DELETE FROM public.product_variants WHERE "productModelId" = ${id}`);
    } catch {
      /* biến thể còn bị tham chiếu — để bước xoá model quyết định */
    }
    try {
      await db.execute(sql`DELETE FROM public.product_models WHERE id = ${id}`);
      daXoa++;
    } catch (e) {
      const ly = String((e as { cause?: Error })?.cause?.message ?? (e as Error)?.message ?? e).replace(/\s+/g, " ").slice(0, 200);
      console.warn(`[modelSanPhamTest] FK chặn xoá product_models ${id} (${ly}) ⇒ xoá mềm`);
      try {
        await db.execute(sql`UPDATE public.product_models SET "deletedAt" = now() WHERE id = ${id} AND "deletedAt" IS NULL`);
        xoaMem++;
      } catch {
        /* không còn cách nào */
      }
    }
  }
  return { daXoa, xoaMem };
}

afterAll(async () => {
  await donModelSanPhamTest();
}, 60_000);
