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
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
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
    .input(z.object({ factoryId: z.number().int().positive().optional() }).optional())
    .query(async ({ input }) => {
      return getFactoryCommandOverview({ factoryId: input?.factoryId });
    }),

  /**
   * Tóm tắt cho drawer khi bấm 1 máy — status/oee/alarms/recipe/workorders/
   * telemetryTags. NOT_FOUND khi máy không tồn tại; các phần khác honest-null.
   */
  machineDetail: protectedProcedure
    .use(requirePermission("machine_status", "canView"))
    .input(z.object({ machineId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const detail = await getCommandMachineDetail(input.machineId);
      if (!detail) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "machine" }, `Machine ${input.machineId} not found`);
      }
      return detail;
    }),
});
