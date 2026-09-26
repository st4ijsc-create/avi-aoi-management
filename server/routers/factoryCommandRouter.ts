/**
 * Factory Command View — tRPC router (doc 40 Wave 4d §13.1-13.3).
 *
 * Hai endpoint READ-ONLY cho màn hình chỉ huy toàn nhà máy (2D/3D theo Line):
 *   • overview      — mọi máy (vị trí + trạng thái live + OEE + andon + PdM) + issue feed.
 *   • machineDetail — tóm tắt cho drawer khi bấm 1 máy.
 *
 * Cả hai chỉ là lớp mỏng gọi factoryCommandService — nơi AGGREGATE trên các
 * service/bảng SẴN CÓ (oeeService, assetCockpitService, machine_status_logs,
 * machine_positions, andon_events, machine_health_history, maintenance_work_orders,
 * alert_history). KHÔNG tính lại OEE/health/alarm; KHÔNG có đường điều khiển.
 *
 * RBAC: read-only, mọi procedure yêu cầu machine_status/canView (alias của
 * machine_monitoring — doc 40 Wave 0). NO writes.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐỢT 40 (QA Đợt 39 Pareto #2, G113) — PHẠM VI TENANT: MỌI thủ tục truyền `phamViCua(ctx)`
 * ════════════════════════════════════════════════════════════════════════════
 * Đo trước vá (`.qa-dot39/qd18/B-1600x900.json`, dist, HTTP thật): `operator1` (id 48, **0 hàng**
 * `user_factory_assignments`) gọi `overview(1)` ⇒ 200 / **41 máy**, `overview(18)` ⇒ 200 / 1 —
 * `requirePermission` chỉ hỏi "có quyền xem trạng thái máy không", KHÔNG hỏi "máy của nhà máy nào".
 * Đợt 34 đổi nguồn sự thật của BA màn twin sang chính `overview` này, và router ấy có **0** tham
 * chiếu `phamViCua` (twinCanh: 36). UI che được (EmptyState), dữ liệu vẫn rời server qua API.
 *
 * ⇒ Cùng khuôn `twinCanhRouter`/`maintenanceRouter`: danh tính LUÔN từ `ctx.user` qua `phamViCua`
 *   (không từ `input`), xuống tận WHERE ở service. Ngoài phạm vi: danh sách ⇒ RỖNG (như
 *   `twinCanh.trangThaiHangLoat`), theo id ⇒ `NOT_FOUND` — KHÔNG `FORBIDDEN`, vì một mã riêng xác
 *   nhận máy ấy có thật (G82, `maintenanceRouter.ts` docblock `getRow`). admin: `resolveTenantFactoryScope`
 *   trả `null` ⇒ không thêm mệnh đề nào — cùng bypass với các router khác.
 * ⚠ Lưới `phamViTwinCanh.unit.test.ts` quét MỌI thủ tục của router này: thêm thủ tục mới mà quên
 *   `phamViCua(ctx)` ⇒ ĐỎ. Lưới DB `factoryCommandAssetCockpitPhamVi.db.test.ts` đo hai chiều.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { phamViCua } from "./_phamViNguoiXem";
import {
  getFactoryCommandOverview,
  getCommandMachineDetail,
} from "../services/factoryCommandService";

export const factoryCommandRouter = router({
  /**
   * Toàn cảnh nhà máy cho lăng kính chỉ huy. Truyền `factoryId` để giới hạn 1 nhà
   * máy; bỏ trống = tất cả máy đang hoạt động. Set-based (không N+1). Trả về
   * { factories, machines, issues } đúng hợp đồng liên agent.
   */
  overview: protectedProcedure
    .use(requirePermission("machine_status", "canView"))
    .input(
      z
        .object({
          factoryId: z.number().int().positive().optional(),
          /**
           * ★★★ PH-45 — DANH SÁCH MÃ NHÀ MÁY, trần **8** (CÙNG con số
           * `twinCanhRouter.TRAN_NHA_MAY_MOT_LUOT`).
           *
           * Cảnh cấp Tập đoàn nạp cả ba nhà máy QATD (1.108 máy) trong khi thủ tục
           * này hỏi đúng MỘT ⇒ 737 máy được vẽ mà **không có lời khai trạng thái**
           * và nhận màu "chưa rõ" (PH-45), còn thẻ `Metrics` in mẫu số của một nhà
           * máy cạnh một cảnh nói về ba (PH-48). Hai triệu chứng, một gốc.
           *
           * ⚠⚠ Vượt trần ⇒ Zod `BAD_REQUEST`. TUYỆT ĐỐI KHÔNG `slice`/`take`: một
           *   danh sách bị cắt câm cho ra đúng lớp lỗi vừa vá, chỉ nhỏ hơn.
           */
          factoryIds: z.array(z.number().int().positive()).min(1).max(8).optional(),
        })
        /**
         * ★★★ KHÔNG ĐƯỢC KHAI CẢ HAI — nhưng **vắng cả hai VẪN HỢP LỆ**, và đó là
         * chỗ thủ tục này CỐ Ý khác `twinCanh.canhThietKe` (vốn đòi ĐÚNG MỘT).
         *
         * `input` của `overview` vốn `.optional()` và `FactoryCommandView.tsx:232`
         * gọi `{ factoryId: undefined }` khi chưa chọn bộ lọc, với nghĩa **"mọi nhà
         * máy TRONG PHẠM VI"** — một hợp đồng đang chạy, không phải một kẽ hở. Ép
         * "đúng một" ở đây là đổi hành vi của một màn khác để cho gọn một bộ luật.
         *
         * ⚠ Nửa nguy hiểm của ngoại lệ ấy ("mọi nhà máy" trượt thành "mọi nhà máy
         *   CÓ THẬT") được ghim bằng ô riêng ở
         *   `trangThaiNhieuNhaMayPhamVi.db.test.ts`: vắng cả hai vẫn phải lọc phạm vi.
         */
        .refine((v) => v.factoryId === undefined || v.factoryIds === undefined, {
          message: "Khai `factoryId` (một nhà máy) HOẶC `factoryIds` (danh sách), không phải cả hai.",
          path: ["factoryIds"],
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      // ★ Đợt 40 — `factoryId`/`factoryIds` là lời TỰ KHAI của client; phạm vi thật lấy từ `ctx` (G113).
      return getFactoryCommandOverview({
        factoryId: input?.factoryId,
        factoryIds: input?.factoryIds,
        scope: phamViCua(ctx),
      });
    }),

  /**
   * Tóm tắt cho drawer khi bấm 1 máy — status/oee/alarms/recipe/workorders/
   * telemetryTags. NOT_FOUND khi máy không tồn tại; các phần khác honest-null.
   */
  machineDetail: protectedProcedure
    .use(requirePermission("machine_status", "canView"))
    .input(z.object({ machineId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      // ★ Đợt 40 — ngoài phạm vi ⇒ `null` ⇒ `NOT_FOUND`, cùng hình dạng với máy không tồn tại (G82).
      const detail = await getCommandMachineDetail(input.machineId, phamViCua(ctx));
      if (!detail) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "machine" }, `Machine ${input.machineId} not found`);
      }
      return detail;
    }),
});
