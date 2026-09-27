/**
 * doc 81 Đợt 1C Task 4 — `machine.gatewayAllowlist.*`: xem / thay allowlist thiết bị của một khoá
 * gateway (`IOT_GATEWAY`). Luật ingest: `api/v1/ingestRangBuoc.ts`; lưu trữ + audit:
 * `services/gatewayAllowlistService.ts` (mig 0361).
 *
 * Cổng:
 *   • `get` — `settings_factory` canView + gateway trong phạm vi người xem (`phamViCua(ctx)`).
 *   • `set` — vai admin HOẶC engineer (quyết định chủ dự án 2026-09-27) VÀ `settings_factory` canEdit
 *     (cùng cổng `machine.update`); gateway lẫn MỌI thiết bị phải nằm trong phạm vi người sửa — không
 *     thêm được thiết bị của nhà máy mình không thấy. Audit: `control_audit_log` trong CÙNG transaction
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
      const devices = await docAllowlist(gw.id);
      return { gatewayId: gw.id, gatewayCode: gw.code, devices };
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
      const gw = await gatewayTrongPhamVi(input.gatewayId, ctx);
      // Mọi thiết bị phải nằm trong phạm vi người sửa (admin: không lọc).
      const scope = phamViCua(ctx);
      for (const id of new Set(input.deviceIds)) {
        const d = await db.getMachineById(id, scope);
        if (!d || d.isActive === false) {
          throw appError(
            "BAD_REQUEST",
            "INVALID_VALUE",
            { field: "deviceIds" },
            `Device #${id} does not exist, is inactive, or is outside your scope.`,
          );
        }
      }

      let kq;
      try {
        kq = await datAllowlist({
          gatewayId: gw.id,
          deviceIds: input.deviceIds,
          actorId: ctx.user.id ?? null,
          reason: input.reason ?? null,
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
          metadata: { added: kq.them, removed: kq.bot, reason: input.reason ?? null },
        },
        status: "success",
      });

      return {
        gatewayId: kq.gatewayId,
        gatewayCode: kq.gatewayCode,
        deviceIds: kq.sau,
        added: kq.them,
        removed: kq.bot,
      };
    }),
});
