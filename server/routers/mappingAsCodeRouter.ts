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
 *   - SCADA R1b-1 Task 9 (+ fix round 1–3): lô đụng tag ĐƯỢC BẢO VỆ (định nghĩa T9 r3, services/scada/troLaiKenh.ts: đã khai / kênh chế độ /
 *     ĐÍCH hoặc NGUỒN telemetry của luật interlock không-alert ĐANG BẬT HOẶC ĐÃ DUYỆT) — trỏ lại (address/scale/offset/dataType/writable/
 *     tagKey/adapterId), tạo lên khoá mồ côi, hoặc prune — ⇒ `totpCode` tươi (mức 5, `kiemTotpCauHinh`), MỘT mã cho cả lô, trần 200 tag được
 *     bảo vệ, kiểm lại nhất quán từng tag (cả lô hoặc không gì; diff tính lại TRONG giao dịch) — nhóm giới hạn "2fa".
 * ════════════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { appError } from "../_core/appError";
import { adapterTheoMaTrongPhamVi, maAdapterTrongPhamVi } from "./_adapterPhamVi";
import {
  parseMappingYaml,
  exportAdapterMapping,
  exportAllMappings,
  importMapping,
  listMappingFiles,
  MappingImportError,
  MappingValidationError,
} from "../services/ot/mappingAsCode";
import { kiemTotpCauHinh, totpCauHinhInput } from "../services/scada/totpCauHinh";

/** Giới hạn kích thước YAML upload (1 MiB) — file mapping thật cỡ vài KB. */
const yamlInput = z.string().min(1).max(1_048_576);

/** Map lỗi service → TRPCError với code phù hợp (không leak stack/SQL). */
function toTrpcError(err: unknown): TRPCError {
  if (err instanceof MappingValidationError) {
    return appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "validateMappingAsCode" }, err.message);
  }
  if (err instanceof MappingImportError) {
    const code =
      err.code === "ADAPTER_NOT_FOUND" ? "NOT_FOUND" : err.code === "VERSION_REGRESSION" ? "PRECONDITION_FAILED" : "INTERNAL_SERVER_ERROR";
    return appError(code, "OPERATION_FAILED", { operation: "importMappingAsCode" }, err.message);
  }
  if (err instanceof TRPCError) return err;
  return appError("INTERNAL_SERVER_ERROR", "OPERATION_FAILED", { operation: "mappingAsCodeSync" }, "Mapping-as-code thất bại. Kiểm tra log server.");
}

function actorName(user: { username?: string | null; name?: string | null } | null | undefined): string | null {
  return user?.username ?? user?.name ?? null;
}

/**
 * Phạm vi nhà máy cho nhập/xem trước (rà bảo mật 2026-10-24): adapter mà YAML nhắm tới phải trong phạm vi người gọi — nếu không, dry-run lộ diff với DB của nhà máy khác và import ghi đè cấu hình của họ.
 * YAML hỏng ⇒ để `importMapping` báo lỗi hợp lệ như cũ (không đoán); adapter không có / ngoài phạm vi ⇒ cùng NOT_FOUND.
 */
async function kiemPhamViYaml(ctx: Parameters<typeof adapterTheoMaTrongPhamVi>[0], yaml: string): Promise<void> {
  let ma: string;
  try {
    ma = parseMappingYaml(yaml).adapter;
  } catch {
    return;
  }
  if (!(await adapterTheoMaTrongPhamVi(ctx, ma))) {
    throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "adapter" }, "Adapter không tồn tại.");
  }
}

export const mappingAsCodeRouter = router({
  /** Danh sách file YAML hiện có trong contracts/mappings (đã export/commit). */
  list: protectedProcedure
    .use(requirePermission("machine_control", "canView"))
    .query(async ({ ctx }) => {
      // phạm vi nhà máy (rà bảo mật 2026-10-24): người phạm vi hẹp chỉ thấy file của adapter trong phạm vi (toàn quyền: như cũ)
      const files = await listMappingFiles();
      const trong = await maAdapterTrongPhamVi(ctx);
      return trong === null ? files : files.filter((f) => trong.has(f.adapterCode));
    }),

  /** Export một adapter (theo code) → YAML string cho client tải về/commit. */
  exportOne: protectedProcedure
    .use(requirePermission("machine_control", "canView"))
    .input(z.object({ adapterCode: z.string().min(1).max(64) }))
    .query(async ({ input, ctx }) => {
      if (!(await adapterTheoMaTrongPhamVi(ctx, input.adapterCode))) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "adapter" }, "Adapter không tồn tại.");
      }
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
      await kiemPhamViYaml(ctx, input.yaml);
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
  // SCADA R1b-1 Task 9 — lô trỏ lại ≥ 1 tag ĐÃ KHAI kênh ⇒ MỘT mã TOTP tươi (`totpCode`, mức 5) cho cả lô; trần 200 tag đã khai / lô;
  // hỏng nhất quán một tag ⇒ cả lô bị từ chối (service `importMapping`, `services/scada/troLaiKenh.ts`). Lô chỉ đụng tag chưa khai ⇒ như cũ.
  applyImport: adminProcedure
    .input(z.object({ yaml: yamlInput, prune: z.boolean().default(false), totpCode: totpCauHinhInput }))
    .mutation(async ({ input, ctx }) => {
      await kiemPhamViYaml(ctx, input.yaml);
      try {
        return await importMapping(input.yaml, {
          dryRun: false,
          prune: input.prune,
          actorId: ctx.user.id,
          actorName: actorName(ctx.user as { username?: string | null; name?: string | null }),
          source: "trpc",
          xacThucKenhDaKhai: () => kiemTotpCauHinh(ctx, input.totpCode),
        });
      } catch (err) {
        throw toTrpcError(err);
      }
    }),
});
