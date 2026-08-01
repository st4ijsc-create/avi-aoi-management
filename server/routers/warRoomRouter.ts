/**
 * War-Room Briefing — tRPC router (doc 40 Wave 4c · §11).
 *
 * MỘT endpoint READ-ONLY cho màn hình "phòng chỉ huy ca" (/war-room): bản tin
 * điều hành theo LINE + so sánh theo CA + kế-hoạch-vs-thực-tế. Chỉ là lớp mỏng
 * gọi warRoomService (nơi AGGREGATE set-based trên oeeService + các bảng SẴN CÓ).
 * KHÔNG tính lại OEE; KHÔNG có đường điều khiển.
 *
 * RBAC: read-only, yêu cầu machine_status/canView (cùng grant với factoryCommand
 * — doc 40 Wave 0 alias của machine_monitoring).
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { getWarRoomBriefing } from "../services/warRoomService";

export const warRoomRouter = router({
  /**
   * Bản tin phòng chỉ huy. `factoryId` giới hạn 1 nhà máy (bỏ trống = tất cả);
   * `date` (ISO) chọn ngày (mặc định hôm nay); `shiftConfigId` thu hẹp cửa sổ về
   * đúng 1 ca. Trả về { asOf, lines, shiftCompare, planVsActual } đúng hợp đồng.
   */
  briefing: protectedProcedure
    .use(requirePermission("machine_status", "canView"))
    .input(z.object({
      factoryId: z.number().int().positive().optional(),
      date: z.string().datetime().optional(),
      shiftConfigId: z.number().int().positive().optional(),
    }).optional())
    .query(async ({ input }) => {
      return getWarRoomBriefing({
        factoryId: input?.factoryId,
        date: input?.date,
        shiftConfigId: input?.shiftConfigId,
      });
    }),
});
