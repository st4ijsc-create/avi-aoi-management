/**
 * doc 81 Đợt 1C Task 4 — `machine.gatewayAllowlist.*`: xem / thay allowlist thiết bị của một khoá
 * gateway (`IOT_GATEWAY`). Luật ingest: `api/v1/ingestRangBuoc.ts`; lưu trữ + audit:
 * `services/gatewayAllowlistService.ts` (mig 0361).
 *
 * Cổng:
 *   • `get` — `settings_factory` canView + gateway trong phạm vi người xem (`phamViCua(ctx)`). Chỉ trả
 *     ĐẦY ĐỦ các thiết bị trong phạm vi người xem; mục ngoài phạm vi chỉ hiện dưới dạng SỐ ĐẾM
 *     (`outOfScopeCount`) — không mã, không tên, không loại (fix round 1 #4).
 *   • `set` — vai admin HOẶC engineer (quyết định chủ dự án 2026-09-27) VÀ `settings_factory` canEdit
 *     (cùng cổng `machine.update`). Phạm vi người sửa tính MỘT lần (`idsTrongPhamVi`) rồi kiểm TRONG
 *     transaction của `datAllowlist` (fix #5 — không còn N truy vấn/thiết bị, không TOCTOU): gateway lẫn
 *     mọi thiết bị gửi lên phải trong phạm vi; mục có sẵn ngoài phạm vi được GIỮ (fix #4). Audit: `control_audit_log` trong CÙNG transaction
 *     (bắt buộc) + `audit_logs` (vết cho màn Nhật ký, best-effort như mọi mutation master-data).
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { appError } from "../_core/appError";
import { requirePermission } from "../_core/accessControl";
import { phamViCua } from "./_phamViNguoiXem";
import * as db from "../db";
import { createAuditContext, logCrudOperation, ENTITY_TYPES } from "../services/auditTrailService";
import {
  ALLOWLIST_TOI_DA,
  AllowlistLoi,
  LOAI_MAY_GATEWAY,
  datAllowlist,
  docAllowlist,
} from "../services/gatewayAllowlistService";

/** Vai được SỬA allowlist (quyết định chủ dự án 2026-09-27: admin/engineer). */
const VAI_SUA_ALLOWLIST: ReadonlySet<string> = new Set(["admin", "engineer"]);

/** Gateway trong phạm vi người xem, hoặc NOT_FOUND (không phân biệt "không có" với "không được thấy"). */
async function gatewayTrongPhamVi(gatewayId: number, ctx: Parameters<typeof phamViCua>[0]) {
  const gw = await db.getMachineById(gatewayId, phamViCua(ctx));
  if (!gw || gw.isActive === false) {
    throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "machine" }, "Gateway not found");
  }
  if (gw.machineType !== LOAI_MAY_GATEWAY) {
    throw appError(
      "BAD_REQUEST",
      "INVALID_VALUE",
      { field: "gatewayId" },
      `Machine ${gw.code} is not an IOT_GATEWAY (${gw.machineType}); only gateway keys use an allowlist.`,
    );
  }
  return gw;
}

export const gatewayAllowlistRouter = router({
  get: protectedProcedure
    .use(requirePermission("settings_factory", "canView"))
    .input(z.object({ gatewayId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const gw = await gatewayTrongPhamVi(input.gatewayId, ctx);
      const tatCa = await docAllowlist(gw.id);
      const ids = await db.idsTrongPhamVi("machine", phamViCua(ctx));
      const phamVi = ids === null ? null : new Set(ids);
      const devices = phamVi === null ? tatCa : tatCa.filter((d) => phamVi.has(d.id));
      return { gatewayId: gw.id, gatewayCode: gw.code, devices, outOfScopeCount: tatCa.length - devices.length };
    }),

  set: protectedProcedure
    .use(requirePermission("settings_factory", "canEdit"))
    .input(
      z.object({
        gatewayId: z.number().int().positive(),
        deviceIds: z.array(z.number().int().positive()).max(ALLOWLIST_TOI_DA),
        reason: z.string().trim().max(500).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (!VAI_SUA_ALLOWLIST.has(String(ctx.user.role))) {
        throw appError(
          "FORBIDDEN",
          "PERMISSION_DENIED",
          { action: "insufficientRole" },
          "Required role: admin or engineer",
        );
      }
      // Phạm vi người sửa: MỘT lần; kiểm gateway + thiết bị TRONG transaction (datAllowlist).
      const phamViIds = await db.idsTrongPhamVi("machine", phamViCua(ctx));

      let kq;
      try {
        kq = await datAllowlist({
          gatewayId: input.gatewayId,
          deviceIds: input.deviceIds,
          actorId: ctx.user.id ?? null,
          reason: input.reason ?? null,
          phamViIds,
        });
      } catch (e) {
        if (e instanceof AllowlistLoi) {
          if (e.loai === "gateway_not_found") {
            throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "machine" }, "Gateway not found");
          }
          throw appError(
            "BAD_REQUEST",
            "INVALID_VALUE",
            { field: e.loai === "not_a_gateway" ? "gatewayId" : "deviceIds" },
            `Allowlist rejected: ${e.loai} ${JSON.stringify(e.chiTiet)}`,
          );
        }
        throw e;
      }

      await logCrudOperation(createAuditContext(ctx), {
        action: "machine.gatewayAllowlist.set",
        entityType: ENTITY_TYPES.MACHINE,
        entityId: kq.gatewayId,
        entityName: kq.gatewayCode,
        details: {
          operation: "machine.gatewayAllowlist.set",
          before: { deviceIds: kq.truoc },
          after: { deviceIds: kq.sau },
          metadata: { added: kq.them, removed: kq.bot, keptOutOfScope: kq.giuNgoaiPhamVi.length, reason: input.reason ?? null },
        },
        status: "success",
      });

      return {
        gatewayId: kq.gatewayId,
        gatewayCode: kq.gatewayCode,
        // Chỉ id trong phạm vi người gọi; mục ngoài phạm vi được giữ và chỉ báo SỐ ĐẾM.
        deviceIds: kq.sau.filter((id) => !kq.giuNgoaiPhamVi.includes(id)),
        added: kq.them,
        removed: kq.bot,
        outOfScopeCount: kq.giuNgoaiPhamVi.length,
      };
    }),
});
