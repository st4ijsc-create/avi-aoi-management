/**
 * B3 — AI Anomaly Detection Router (tRPC)
 *
 * Public-ish (protected): score / getProfile / stats.
 * Admin: buildBank / rebuild / deleteBank.
 *
 * Ảnh nhận base64 (data URI prefix optional) theo pattern aiAdvancedVisionRouter.
 * Mọi output mang cờ source/degraded → UI nói đúng sự thật về tầng degrade.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  router,
  protectedProcedure as thuTucVanHanh,
  moduleProcedure,
  moduleGate,
  adminProcedure as adminProcedureBase,
} from "../_core/trpc";
// ★ Cổng giấy phép MOD_AI — chỉ THÊM chiều giấy phép, RBAC/vai/2FA giữ nguyên từng ký tự.
//   Không-brick + fail-safe ở `_core/moduleGate.ts`; lượng từ canh ở `congGiayPhepAiCensus.test.ts`.
const protectedProcedure = moduleProcedure("MOD_AI");
const adminProcedure = adminProcedureBase.use(moduleGate("MOD_AI"));
import { appError } from "../_core/appError";
import {
  scoreImage,
  buildMemoryBank,
  buildBankFromStoredEmbeddings,
  backfillAnomalyScores,
  getAnomalyStats,
  anomalyModelCode,
} from "../services/aiAnomalyDetection";
import { buildPatchMemoryBank } from "../services/aiPatchAnomaly";
import { getProfile, deleteScope } from "../db/aiAnomaly";
import { getDb } from "../db/connection";
import { sql } from "drizzle-orm";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_BANK_IMAGES = 500;

function decodeBase64Image(b64: string): Buffer {
  const cleaned = b64.includes(",") ? b64.slice(b64.indexOf(",") + 1) : b64;
  let buf: Buffer;
  try {
    buf = Buffer.from(cleaned, "base64");
  } catch {
    // Task 5 (doc 71) — xem ghi chú cùng pattern ở aiAdvancedVisionRouter.ts:
    // reason tách 3 nguyên nhân trước đây render 1 câu; nhánh vượt dung lượng tái
    // dùng KB_FILE_TOO_LARGE{limitMb}, KHÔNG nhồi vào INVALID_VALUE.
    throw appError("BAD_REQUEST", "INVALID_VALUE", { field: "image", reason: "invalidBase64Image" }, "Invalid base64 image");
  }
  if (buf.length === 0) {
    throw appError("BAD_REQUEST", "INVALID_VALUE", { field: "image", reason: "emptyImagePayload" }, "Empty image payload");
  }
  if (buf.length > MAX_IMAGE_BYTES) {
    throw appError(
      "PAYLOAD_TOO_LARGE",
      "KB_FILE_TOO_LARGE",
      { limitMb: Math.round((MAX_IMAGE_BYTES / (1024 * 1024)) * 10) / 10 },
      `Image exceeds ${MAX_IMAGE_BYTES} bytes`,
    );
  }
  return buf;
}

const base64Image = z.string().min(16);

// ── Per-machine latest anomaly status (read-only) ─────────────────────────────
const RECENT_WINDOW = 50; // số ảnh đã-chấm gần nhất để tính tỷ lệ bất thường.

export interface MachineAnomalyStatus {
  hasData: boolean;
  latestScore: number | null;
  latestThreshold: number | null;
  isAnomaly: boolean;
  latestAt: Date | null;
  recent: { windowCount: number; anomalyCount: number; anomalyRate: number };
}

function emptyStatus(): MachineAnomalyStatus {
  return {
    hasData: false,
    latestScore: null,
    latestThreshold: null,
    isAnomaly: false,
    latestAt: null,
    recent: { windowCount: 0, anomalyCount: 0, anomalyRate: 0 },
  };
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Đọc trạng thái anomaly mới nhất cho 1..N máy từ ai_image_embeddings.metadata->'anomaly'.
 * Fail-safe tuyệt đối: DB null / lỗi / không có dòng → status rỗng (hasData:false), không throw.
 *
 * Cách đọc JSON: lọc `metadata->'anomaly' IS NOT NULL`, lấy cửa sổ RECENT_WINDOW
 * dòng đã-chấm gần nhất / mỗi máy (ROW_NUMBER theo createdAt desc), rồi gộp:
 *   - latest*  ← dòng rn=1 (mới nhất)
 *   - recent.* ← đếm trên toàn cửa sổ (anomalyCount = số dòng (anomaly->>'isAnomaly')='true')
 */
export async function readMachineStatuses(
  machineIds: number[],
  productModelId: number | null,
): Promise<Record<number, MachineAnomalyStatus>> {
  const out: Record<number, MachineAnomalyStatus> = {};
  const ids = Array.from(new Set(machineIds.filter((n) => Number.isInteger(n) && n > 0)));
  for (const id of ids) out[id] = emptyStatus();
  if (ids.length === 0) return out;

  try {
    const db = await getDb();
    if (!db) return out;

    const idList = sql.join(ids.map((id) => sql`${id}`), sql`, `);
    const productCond =
      productModelId == null ? sql`` : sql` AND "productModelId" = ${productModelId}`;

    // Cửa sổ RECENT_WINDOW dòng đã-chấm mới nhất / máy.
    const result = await db.execute(sql`
      SELECT
        "machineId" AS machine_id,
        ("metadata"->'anomaly'->>'score')::float8     AS score,
        ("metadata"->'anomaly'->>'threshold')::float8 AS threshold,
        ("metadata"->'anomaly'->>'isAnomaly')         AS is_anomaly,
        "createdAt"                                   AS created_at,
        ROW_NUMBER() OVER (
          PARTITION BY "machineId"
          ORDER BY "createdAt" DESC, "id" DESC
        ) AS rn
      FROM ai_image_embeddings
      WHERE "machineId" IN (${idList})
        AND "metadata"->'anomaly' IS NOT NULL
        ${productCond}
    `);

    const rows = ((result as { rows?: unknown[] }).rows ?? (result as unknown[])) as Array<{
      machine_id: number | string;
      score: number | string | null;
      threshold: number | string | null;
      is_anomaly: string | boolean | null;
      created_at: Date | string | null;
      rn: number | string;
    }>;

    for (const r of rows) {
      const rn = Number(r.rn);
      if (rn > RECENT_WINDOW) continue; // bound: chỉ tính trong cửa sổ.
      const mid = Number(r.machine_id);
      const status = out[mid];
      if (!status) continue;

      const isAnom = r.is_anomaly === true || r.is_anomaly === "true";
      status.recent.windowCount += 1;
      if (isAnom) status.recent.anomalyCount += 1;

      if (rn === 1) {
        status.hasData = true;
        status.latestScore = toNum(r.score);
        status.latestThreshold = toNum(r.threshold);
        status.isAnomaly = isAnom;
        status.latestAt = r.created_at == null ? null : new Date(r.created_at as string);
      }
    }

    for (const id of ids) {
      const s = out[id];
      s.recent.anomalyRate =
        s.recent.windowCount > 0 ? s.recent.anomalyCount / s.recent.windowCount : 0;
    }

    return out;
  } catch {
    // Hot path UI → không bao giờ ném; trả rỗng an toàn.
    const safe: Record<number, MachineAnomalyStatus> = {};
    for (const id of ids) safe[id] = emptyStatus();
    return safe;
  }
}
const scopeInput = z.object({
  productModelId: z.number().int().positive().nullish(),
  machineId: z.number().int().positive().nullish(),
  modelId: z.number().int().positive().nullish(),
});

export const aiAnomalyRouter = router({
  // ── score (protected) ──────────────────────────────────────────────────────
  score: protectedProcedure
    .input(scopeInput.extend({ image: base64Image }))
    .mutation(async ({ input }) => {
      return scoreImage({
        buffer: decodeBase64Image(input.image),
        productModelId: input.productModelId ?? null,
        machineId: input.machineId ?? null,
        modelId: input.modelId ?? null,
      });
    }),

  // ── getProfile (protected) ──────────────────────────────────────────────────
  // Trả profile cho cả 3 modelCode khả dĩ (onnx/text-of-image/heuristic).
  getProfile: protectedProcedure
    .input(scopeInput)
    .query(async ({ input }) => {
      const base = {
        productModelId: input.productModelId ?? null,
        machineId: input.machineId ?? null,
      };
      const sources = [
        anomalyModelCode("onnx", input.modelId ?? null),
        anomalyModelCode("text-of-image", null),
        anomalyModelCode("heuristic", null),
      ];
      const profiles = await Promise.all(
        sources.map((modelCode) => getProfile({ ...base, modelCode })),
      );
      return { profiles: profiles.filter((p) => p != null) };
    }),

  // ── stats (protected) ───────────────────────────────────────────────────────
  stats: protectedProcedure
    .input(z.object({
      productModelId: z.number().int().positive().nullish(),
      machineId: z.number().int().positive().nullish(),
    }))
    .query(async ({ input }) => {
      return getAnomalyStats({
        productModelId: input.productModelId ?? null,
        machineId: input.machineId ?? null,
      });
    }),

  // ── latestForMachine (protected) — trạng thái anomaly realtime / 1 máy ────────
  // ⚠⚠ CỐ Ý **KHÔNG** khoá sau MOD_AI. Dữ liệu là AI thật, nhưng nơi hiển thị KHÔNG phải màn AI:
  //    `components/MachineAISummary.tsx` được gắn ở `/production-dashboard` (MOD_PRODUCTION),
  //    `/quality-cockpit`, `/repair-station`, `MachineWorkspace`. Khoá ở đây ⇒ khách mua
  //    MOD_PRODUCTION/MOD_QUALITY nhưng không mua AI nhận FORBIDDEN trên màn của HỌ. Muốn khoá thì
  //    phải ẩn `MachineAISummary` theo module ở client TRƯỚC — xem báo cáo mục (b).
  latestForMachine: thuTucVanHanh
    .input(z.object({
      machineId: z.number().int().positive(),
      productModelId: z.number().int().positive().nullish(),
    }))
    .query(async ({ input }): Promise<MachineAnomalyStatus> => {
      const map = await readMachineStatuses([input.machineId], input.productModelId ?? null);
      return map[input.machineId] ?? emptyStatus();
    }),

  // ── machineStatuses (protected) — batch cho production dashboard ──────────────
  machineStatuses: protectedProcedure
    .input(z.object({
      machineIds: z.array(z.number().int().positive()).max(500),
      productModelId: z.number().int().positive().nullish(),
    }))
    .query(async ({ input }): Promise<Record<number, MachineAnomalyStatus>> => {
      return readMachineStatuses(input.machineIds, input.productModelId ?? null);
    }),

  // ── buildBank (admin) ───────────────────────────────────────────────────────
  buildBank: adminProcedure
    .input(scopeInput.extend({
      images: z.array(base64Image).min(1).max(MAX_BANK_IMAGES),
      coresetRatio: z.number().min(0.01).max(1).optional(),
      k: z.number().int().min(1).max(50).optional(),
    }))
    .mutation(async ({ input }) => {
      const buffers = input.images.map((img, i) => {
        const b = decodeBase64Image(img);
        return { buffer: b, imageUrl: `upload:${i}` };
      });
      return buildMemoryBank({
        productModelId: input.productModelId ?? null,
        machineId: input.machineId ?? null,
        modelId: input.modelId ?? null,
        images: buffers,
        coresetRatio: input.coresetRatio,
        k: input.k,
      });
    }),

  // ── rebuild (admin) — alias build (xóa cũ cùng scope đã nằm trong buildMemoryBank) ──
  rebuild: adminProcedure
    .input(scopeInput.extend({
      images: z.array(base64Image).min(1).max(MAX_BANK_IMAGES),
      coresetRatio: z.number().min(0.01).max(1).optional(),
      k: z.number().int().min(1).max(50).optional(),
    }))
    .mutation(async ({ input }) => {
      const buffers = input.images.map((img, i) => ({ buffer: decodeBase64Image(img), imageUrl: `upload:${i}` }));
      return buildMemoryBank({
        productModelId: input.productModelId ?? null,
        machineId: input.machineId ?? null,
        modelId: input.modelId ?? null,
        images: buffers,
        coresetRatio: input.coresetRatio,
        k: input.k,
      });
    }),

  // ── buildBankFromDb (admin) — dựng bank từ vector ĐÃ LƯU (DINOv2), không cần ảnh ──
  // Nguồn: ai_image_embeddings (modelCode mặc định "dinov2-small"). okOnly → chỉ ảnh OK.
  // Trung thực với dữ liệu nhỏ: < ngưỡng OK → bank bootstrap/low-confidence (cờ trong kết quả).
  buildBankFromDb: adminProcedure
    .input(z.object({
      machineId: z.number().int().positive().nullish(),
      productModelId: z.number().int().positive().nullish(),
      modelCode: z.string().min(1).max(100).optional(),
      okOnly: z.boolean().optional(),
      coresetRatio: z.number().min(0.01).max(1).optional(),
      k: z.number().int().min(1).max(50).optional(),
    }))
    .mutation(async ({ input }) => {
      return buildBankFromStoredEmbeddings({
        machineId: input.machineId ?? null,
        productModelId: input.productModelId ?? null,
        modelCode: input.modelCode,
        okOnly: input.okOnly,
        coresetRatio: input.coresetRatio,
        k: input.k,
      });
    }),

  // ── backfillScores (admin) — chấm anomaly cho vector đã lưu, ghi metadata.anomaly ──
  // Idempotent jsonb merge (backfill:true). Fail-safe per row. Không cần ảnh/model.
  backfillScores: adminProcedure
    .input(z.object({
      machineId: z.number().int().positive().nullish(),
      productModelId: z.number().int().positive().nullish(),
      modelCode: z.string().min(1).max(100).optional(),
      limit: z.number().int().min(1).max(1000000).optional(),
    }))
    .mutation(async ({ input }) => {
      return backfillAnomalyScores({
        machineId: input.machineId ?? null,
        productModelId: input.productModelId ?? null,
        modelCode: input.modelCode,
        limit: input.limit,
      });
    }),

  // ── buildPatchBank (admin) — patch-level (pixel-localizing) memory bank ───────
  // Tiles each OK image into a grid of patches, embeds each patch (same honest tier
  // ladder), and pools them into a PATCH memory bank (scope modelCode carries ":patch:"
  // + grid → isolated from the whole-image bank). Enables the heatmap on `score` when
  // ANOMALY_PATCH_ENABLED=true. Additive; default flag OFF leaves scoring unchanged.
  buildPatchBank: adminProcedure
    .input(scopeInput.extend({
      images: z.array(base64Image).min(1).max(MAX_BANK_IMAGES),
      grid: z.number().int().min(2).max(32).optional(),
      coresetRatio: z.number().min(0.01).max(1).optional(),
      k: z.number().int().min(1).max(50).optional(),
    }))
    .mutation(async ({ input }) => {
      const buffers = input.images.map((img, i) => ({ buffer: decodeBase64Image(img), imageUrl: `upload:${i}` }));
      return buildPatchMemoryBank({
        productModelId: input.productModelId ?? null,
        machineId: input.machineId ?? null,
        modelId: input.modelId ?? null,
        images: buffers,
        grid: input.grid,
        coresetRatio: input.coresetRatio,
        k: input.k,
      });
    }),

  // ── deleteBank (admin) ──────────────────────────────────────────────────────
  deleteBank: adminProcedure
    .input(scopeInput.extend({
      // Nguồn cần xóa: "onnx" cần modelId; "text-of-image"/"heuristic" không cần.
      source: z.enum(["onnx", "text-of-image", "heuristic"]),
    }))
    .mutation(async ({ input }) => {
      const modelCode = anomalyModelCode(input.source, input.modelId ?? null);
      await deleteScope({
        productModelId: input.productModelId ?? null,
        machineId: input.machineId ?? null,
        modelCode,
      });
      return { deleted: true, modelCode };
    }),
});
