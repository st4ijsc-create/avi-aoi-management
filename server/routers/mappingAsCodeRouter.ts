/**
 * doc 44 Batch W2-B3 (gap G1.13) — Mapping-as-code router (SYNAPSE Tầng-1 Chương 10).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Vòng Git quanh mapping DB (device_tags + uns_tag_mappings):
 *   list      — đọc danh sách contracts/mappings/*.mapping.yaml   (canView)
 *   exportOne — YAML một adapter (client tự tải/commit)           (canView)
 *   exportAll — ghi TẤT CẢ file server-side vào contracts/mappings (ADMIN)
 *   preview   — dry-run diff một YAML vs DB, KHÔNG ghi            (canEdit)
 *   applyImport — import thật (upsert theo khóa tự nhiên, prune opt-in) (ADMIN)
 *
 * AN TOÀN:
 *   - `apply` đổi cấu hình thiết bị ⇒ adminProcedure — chuỗi này ĐÃ gồm:
 *     role admin + BẮT BUỘC 2FA + auditMutationMiddleware (server/_core/trpc.ts).
 *     Service còn ghi thêm audit chi tiết (mapping_as_code.import) + refresh
 *     config-drift baseline. Import KHÔNG restart adapter — trả cờ
 *     `requiresAdapterRestart` cho người vận hành.
 *   - KHÔNG có đường ghi xuống thiết bị ở đây (config-only, như deviceAdapterRouter).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { appError } from "../_core/appError";
import {
  exportAdapterMapping,
  exportAllMappings,
  importMapping,
  listMappingFiles,
  MappingImportError,
  MappingValidationError,
} from "../services/ot/mappingAsCode";

/** Giới hạn kích thước YAML upload (1 MiB) — file mapping thật cỡ vài KB. */
const yamlInput = z.string().min(1).max(1_048_576);

/** Map lỗi service → TRPCError với code phù hợp (không leak stack/SQL). */
function toTrpcError(err: unknown): TRPCError {
  if (err instanceof MappingValidationError) {
    return new TRPCError({ code: "BAD_REQUEST", message: err.message });
  }
  if (err instanceof MappingImportError) {
    const code =
      err.code === "ADAPTER_NOT_FOUND" ? "NOT_FOUND" : err.code === "VERSION_REGRESSION" ? "PRECONDITION_FAILED" : "INTERNAL_SERVER_ERROR";
    return new TRPCError({ code, message: err.message });
  }
  if (err instanceof TRPCError) return err;
  return appError("INTERNAL_SERVER_ERROR", "OPERATION_FAILED", { operation: "mappingAsCodeSync" }, "Mapping-as-code thất bại. Kiểm tra log server.");
}

function actorName(user: { username?: string | null; name?: string | null } | null | undefined): string | null {
  return user?.username ?? user?.name ?? null;
}

export const mappingAsCodeRouter = router({
  /** Danh sách file YAML hiện có trong contracts/mappings (đã export/commit). */
  list: protectedProcedure
    .use(requirePermission("machine_control", "canView"))
    .query(async () => listMappingFiles()),

  /** Export một adapter (theo code) → YAML string cho client tải về/commit. */
  exportOne: protectedProcedure
    .use(requirePermission("machine_control", "canView"))
    .input(z.object({ adapterCode: z.string().min(1).max(64) }))
    .query(async ({ input }) => {
      try {
        const res = await exportAdapterMapping(input.adapterCode);
        return { adapterId: res.adapterId, adapterCode: res.adapterCode, fileName: res.fileName, yaml: res.yaml };
      } catch (err) {
        throw toTrpcError(err);
      }
    }),

  /** Export TẤT CẢ adapter — ghi file server-side vào contracts/mappings/. ADMIN (ghi FS). */
  exportAll: adminProcedure.mutation(async () => {
    try {
      return await exportAllMappings();
    } catch (err) {
      throw toTrpcError(err);
    }
  }),

  /** Dry-run: upload YAML → diff vs DB. KHÔNG ghi gì (kể cả metadata). */
  preview: protectedProcedure
    .use(requirePermission("machine_control", "canEdit"))
    .input(z.object({ yaml: yamlInput, prune: z.boolean().default(false) }))
    .mutation(async ({ input, ctx }) => {
      try {
        return await importMapping(input.yaml, {
          dryRun: true,
          prune: input.prune,
          actorId: ctx.user.id,
          actorName: actorName(ctx.user as { username?: string | null; name?: string | null }),
          source: "trpc",
        });
      } catch (err) {
        throw toTrpcError(err);
      }
    }),

  /**
   * Import thật. adminProcedure = role admin + 2FA bắt buộc + audit middleware
   * (đổi cấu hình thiết bị là hành vi nhạy cảm). prune mặc định false —
   * xoá row DB vắng mặt trong file phải bật tường minh.
   */
  // Tên KHÔNG được là `apply` — reserved trên callable proxy của tRPC router
  // (đụng Function.prototype.apply) → vỡ appRouter khi load.
  applyImport: adminProcedure
    .input(z.object({ yaml: yamlInput, prune: z.boolean().default(false) }))
    .mutation(async ({ input, ctx }) => {
      try {
        return await importMapping(input.yaml, {
          dryRun: false,
          prune: input.prune,
          actorId: ctx.user.id,
          actorName: actorName(ctx.user as { username?: string | null; name?: string | null }),
          source: "trpc",
        });
      } catch (err) {
        throw toTrpcError(err);
      }
    }),
});
