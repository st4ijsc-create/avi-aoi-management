/**
 * ★★★ Thẻ tenant (factoryId · corporateCode) do CLIENT khai / nằm trên hàng chuẩn dùng chung — kiểm phạm vi (lô W10, 2026-10-25).
 * Hàng chuẩn không thẻ (toàn tập đoàn) ai có quyền ghi đều thao tác (danh mục chuẩn dùng chung — chủ dự án duyệt); hàng CÓ thẻ thì thẻ phải trong phạm vi người gọi:
 * factoryId ∈ nhà máy trong phạm vi; corporateCode ∈ tập đoàn được gán HOẶC là tập đoàn của một nhà máy trong phạm vi. Cả hai cùng nêu ⇒ cả hai phải hợp lệ. Toàn quyền ⇒ true.
 */
import { inArray } from "drizzle-orm";
import { getDb } from "../db/connection";
import { factories } from "../../drizzle/schema";
import { idsTrongPhamVi } from "../db/hierarchy";
import { phamViCua, type CoDanhTinh } from "./_phamViNguoiXem";

export async function theTenantHopLe(ctx: CoDanhTinh, the: { factoryId?: number | null; corporateCode?: string | null }): Promise<boolean> {
  const pv = phamViCua(ctx);
  const nhaMay = await idsTrongPhamVi("factory", pv, { strict: true });
  if (nhaMay === null) return true;
  if (the.factoryId == null && the.corporateCode == null) return true;
  if (the.factoryId != null && !nhaMay.includes(the.factoryId)) return false;
  if (the.corporateCode != null) {
    const { getUserAssignmentCodes } = await import("../_core/accessControl");
    const g = await getUserAssignmentCodes(pv.userId!, pv.userRole ?? "user");
    let ok = g.corporateCodes.includes(the.corporateCode);
    if (!ok && nhaMay.length > 0) {
      const d = await getDb();
      if (d) {
        const rows = await d.select({ c: factories.corporateCode }).from(factories).where(inArray(factories.id, nhaMay));
        ok = rows.some((r) => r.c === the.corporateCode);
      }
    }
    if (!ok) return false;
  }
  return true;
}
