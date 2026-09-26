/**
 * server/routers/cayDayRouter.ts
 *
 * ★★★ Khối C — Task 9 (QĐ-6): ĐƯỜNG ĐỌC cây dạy — TRƯỚC bản vá này KHÔNG có
 * procedure đọc cây nào (spec, mục "Đường đọc"). Task 10/11 (tab "Cây dạy" của
 * `ProductModels.tsx`) tiêu thụ router này.
 *
 * ── Bốn procedure, đọc CHỈ — mọi ghi vẫn qua `measurementPoint.update`/
 * `setLimitsBatch` (QĐ-5) và `submitMachineTemplate` (Khối B) ─────────────────
 *   `listMachinesForProduct` — máy nào đã dạy cây cho sản phẩm + bản dạy hiện hành.
 *   `getTree`                — surface→position→capture (không kèm component).
 *   `listComponents`         — point-def cấp component + trạng thái giới hạn.
 *   `thongKeGioiHan`         — đếm `daDay`/`chuaCoGioiHan`, CÙNG phân loại với
 *                              `listComponents` (một nguồn — QĐ-6).
 *
 * ⚠⚠ PHẠM VI TENANT — `protectedProcedure` + danh tính LUÔN từ `ctx.user`
 * (`phamViCua(ctx)`), KHÔNG BAO GIỜ từ `input`. Cây dạy phơi bí quyết công nghệ
 * (ROI, số lượng linh kiện, giới hạn đã dạy) — đúng lớp dữ liệu mà bài học
 * "hàng rào tenant lọc theo cột CLIENT TỰ KHAI" (`pham-vi-tenant-dot-lon`) đã đốt
 * một lượt. `machineId`/`captureRowId` trong `input` của ba procedure dưới là LỜI
 * TỰ KHAI — mỗi hàm `server/db/cayDay.ts` tương ứng tự tra máy THẬT của đối tượng
 * rồi kiểm `trongPhamVi` TRƯỚC khi đọc, không suy phạm vi từ chính input đó
 * (docblock đầy đủ ở `cayDay.ts`, ngay trên bốn hàm).
 *
 * Ngoài phạm vi ⇒ hình dạng RỖNG (mảng rỗng / cây rỗng / đếm 0) — KHÔNG phân biệt
 * "không tồn tại" khỏi "có thật nhưng của tenant khác", cùng khuôn
 * `productRouters.getReadiness`. Một câu riêng cho "tồn tại nhưng bạn không thấy"
 * là một oracle rò rỉ tồn-tại.
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { phamViCua } from "./_phamViNguoiXem";
import {
  traMayCoBanDay,
  traCayDay,
  traComponentTheoCapture,
  traThongKeGioiHan,
} from "../db/cayDay";

export const cayDayRouter = router({
  listMachinesForProduct: protectedProcedure
    .input(z.object({ productModelId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      return traMayCoBanDay({ productModelId: input.productModelId, scope: phamViCua(ctx) });
    }),

  getTree: protectedProcedure
    .input(z.object({
      productModelId: z.number().int().positive(),
      machineId: z.number().int().positive(),
    }))
    .query(async ({ input, ctx }) => {
      return traCayDay({
        productModelId: input.productModelId,
        machineId: input.machineId,
        scope: phamViCua(ctx),
      });
    }),

  listComponents: protectedProcedure
    .input(z.object({ captureRowId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      return traComponentTheoCapture({ captureRowId: input.captureRowId, scope: phamViCua(ctx) });
    }),

  thongKeGioiHan: protectedProcedure
    .input(z.object({
      productModelId: z.number().int().positive(),
      machineId: z.number().int().positive(),
    }))
    .query(async ({ input, ctx }) => {
      return traThongKeGioiHan({
        productModelId: input.productModelId,
        machineId: input.machineId,
        scope: phamViCua(ctx),
      });
    }),
});

export type CayDayRouter = typeof cayDayRouter;
