/**
 * ★ Đợt 10.1 A1 — `aiChonModel.danhMuc`: danh mục model chọn được cho MỌI bề mặt (ô chọn của chat, lập trình, agent,
 * node Luồng). Không cần admin — chỉ cổng giấy phép MOD_AI; không trả tên tệp / đường dẫn / cổng (xem `chonModel/danhMuc.ts`).
 */
import { router, moduleProcedure } from "../_core/trpc";
import { phamViCua } from "./_phamViNguoiXem";

const protectedProcedure = moduleProcedure("MOD_AI");

export const aiChonModelRouter = router({
  danhMuc: protectedProcedure.query(async ({ ctx }) => {
    const [{ layDanhMucModel, layPhuThuocDanhMucMacDinh }, { resolveTenantFactoryScope }] = await Promise.all([
      import("../services/ai/chonModel/danhMuc"),
      import("../db/reportAggregators"),
    ]);
    // Nhà máy người gọi (cho mục model NGOÀI — 10.3): nhà máy đầu của phạm vi; admin không gắn nhà máy ⇒ null ⇒ không có mục ngoài.
    const { factoryIds } = await resolveTenantFactoryScope(phamViCua(ctx));
    return layDanhMucModel(factoryIds?.[0] ?? null, await layPhuThuocDanhMucMacDinh());
  }),
});
