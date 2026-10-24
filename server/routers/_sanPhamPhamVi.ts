/**
 * ★★★ Luật GHI theo SẢN PHẨM, dùng chung (productRouters · lineControllerRouter …) — tách từ productRouters (lô W8, 2026-10-24).
 */
import { sql } from "drizzle-orm";
import { appError } from "../_core/appError";
import * as db from "../db";
import { phamViCua, type CoDanhTinh } from "./_phamViNguoiXem";

/**
 * LUẬT GHI THEO SẢN PHẨM (chủ dự án duyệt 2026-10-24). `product_models` KHÔNG có cột nhà máy; sản phẩm tới nhà máy qua ba bảng liên kết
 * (`product_machine_mappings` · `measurement_point_defs` · `product_inspections`, vị từ hợp `congSanPhamTrongNhaMay` — cùng đường ĐỌC). Ghi được khi:
 *   (1) sản phẩm TRONG phạm vi người gọi (có liên kết tới một nhà máy của họ), HOẶC
 *   (2) sản phẩm CHƯA gắn nhà máy nào (nháp — vừa tạo, chưa ánh xạ máy / điểm đo gắn máy / lượt kiểm tra);
 * chặn khi sản phẩm chỉ gắn nhà máy NGOÀI phạm vi ⇒ NOT_FOUND "productModel" (cùng lỗi id không có thật). Toàn quyền (admin) ⇒ không kiểm.
 * ⚠ GIỚI HẠN (đã chốt): sản phẩm DÙNG CHUNG nhiều nhà máy ⇒ kỹ sư của BẤT KỲ nhà máy có gắn đều sửa được, tức "sửa ở A ảnh hưởng B".
 * Không chặn được nếu không đổi chính sách (vd. chỉ admin sửa sản phẩm đa nhà máy).
 */
export async function sanPhamGhiTrongPhamVi(ctx: CoDanhTinh, productModelId: number): Promise<void> {
  const pv = phamViCua(ctx);
  if (await db.sanPhamTrongPhamVi(productModelId, pv)) return;
  const d = await db.getDb();
  if (!d) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not connected");
  const rows = (await d.execute(sql`SELECT (
      NOT EXISTS (SELECT 1 FROM product_machine_mappings WHERE "productModelId" = ${productModelId})
      AND NOT EXISTS (SELECT 1 FROM measurement_point_defs WHERE "productModelId" = ${productModelId} AND "machineId" IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM product_inspections WHERE "productModelId" = ${productModelId} AND "machineId" IS NOT NULL)
    ) AS nhap`)) as unknown as Array<{ nhap: boolean }>;
  if (rows[0]?.nhap === true) return;
  throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "productModel" }, "Sản phẩm không tồn tại");
}

