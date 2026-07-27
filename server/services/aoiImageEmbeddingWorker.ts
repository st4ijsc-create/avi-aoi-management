/**
 * AOI Image Embedding Worker — "embed-at-ingest" (Phase A2/A4)
 *
 * Khi một package AOI mới được COMMIT (aoiPackageRouter.commit), router gọi
 * `enqueueAoiImageEmbedding({ inspectionId, packageId, storageKey })`. Worker này
 * (in-memory queue, concurrency-limited) sẽ:
 *   1) Lấy các measurement_results của inspection có imageUrl (lọc NG mặc định),
 *      CHƯA có embedding cùng modelCode → tránh trùng (idempotent).
 *   2) Giải ảnh từ package ZIP đã lưu (storageKey) — bytes có sẵn vì ZIP được giữ lại.
 *   3) extractEmbedding (DINOv2 ONNX) → storeEmbedding vào ai_image_embeddings.
 *
 * Vì sao tách khỏi commit: KHÔNG thêm độ trễ cho commit (fire-and-forget), an toàn
 * (lỗi embedding không làm hỏng ingest), và chỉ xử lý ẢNH MỚI (không quét lại 11.884
 * ảnh cũ đã mất ở server trước).
 *
 * Honest-degradation: nếu model chưa ACTIVE / ZIP không resolve / ảnh thiếu → bỏ qua
 * và log, KHÔNG bịa embedding.
 *
 * ENV:
 *   AOI_EMBEDDING_ENABLED       bật/tắt (mặc định "false" → enqueue là no-op)
 *   AOI_EMBEDDING_MODEL_CODE    code model ONNX trong ai_models (mặc định "dinov2-small")
 *   AOI_EMBEDDING_CONCURRENCY   số inspection xử lý song song (mặc định 2, CPU-bound)
 *   AOI_EMBEDDING_RESULT_FILTER "NG" (mặc định) | "ALL" — lọc measurement result để embed
 *   AOI_EMBEDDING_MAX_POINTS    trần số điểm/inspection mỗi lần (mặc định 500)
 *
 * B3 — sau khi embed, MỘT bước phụ flag-gated (ANOMALY_DETECTION_ENABLED, default OFF):
 *   • chấm anomaly score (DINOv2 + PatchCore) → lưu vào ai_image_embeddings.metadata,
 *   • CỔNG leo VL (shouldEscalateToVision): chỉ ảnh NG/nghi ngờ (2–10%) mới đưa qua
 *     Qwen3-VL để mô tả inline — sau khi crop ROI (autoDetectRoi). Fire-and-forget,
 *     idempotent (bỏ qua nếu metadata.anomaly đã có), KHÔNG bao giờ chặn embed/commit.
 */

import path from "path";
import fs from "fs";
import JSZip from "jszip";
import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { getAiModelByCode } from "../db/ai";
import { measurementResults, productInspections, aiImageEmbeddings } from "../../drizzle/schema";
import { extractEmbedding, storeEmbedding } from "./aiImageEmbedding";
import { storageGet } from "../storage";
import { isMissingTable, isMissingColumn } from "../_core/dbErrors";

// ─── Config ────────────────────────────────────────────────────
const ENABLED = process.env.AOI_EMBEDDING_ENABLED === "true";
const MODEL_CODE = process.env.AOI_EMBEDDING_MODEL_CODE || "dinov2-small";
const CONCURRENCY = (() => {
  const n = parseInt(process.env.AOI_EMBEDDING_CONCURRENCY || "2", 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 8) : 2;
})();
const RESULT_FILTER = (process.env.AOI_EMBEDDING_RESULT_FILTER || "NG").toUpperCase();
const MAX_POINTS = (() => {
  const n = parseInt(process.env.AOI_EMBEDDING_MAX_POINTS || "500", 10);
  return Number.isFinite(n) && n > 0 ? n : 500;
})();

export interface AoiEmbeddingJob {
  inspectionId: number;
  packageId: string;
  storageKey: string | null;
}

const queue: AoiEmbeddingJob[] = [];
let active = 0;
let modelIdCache: number | null = null;
let modelMissingLogged = false;

export function isAoiEmbeddingEnabled(): boolean {
  return ENABLED;
}

/**
 * Enqueue an inspection for visual embedding. No-op when AOI_EMBEDDING_ENABLED !== "true".
 * Fire-and-forget: returns immediately, never throws — safe to call from commit.
 */
export function enqueueAoiImageEmbedding(job: AoiEmbeddingJob): void {
  if (!ENABLED) return;
  if (!job?.inspectionId || !job?.storageKey) return;
  queue.push(job);
  pump();
}

function pump(): void {
  while (active < CONCURRENCY && queue.length > 0) {
    const job = queue.shift()!;
    active++;
    runAoiInspectionEmbedding(job)
      .catch((e) => console.warn(`[aoiEmbed] job inspection ${job.inspectionId} error:`, (e as Error)?.message ?? e))
      .finally(() => {
        active--;
        pump();
      });
  }
}

async function resolveModelId(): Promise<number | null> {
  if (modelIdCache != null) return modelIdCache;
  const m = await getAiModelByCode(MODEL_CODE);
  if (!m || m.status !== "ACTIVE") {
    if (!modelMissingLogged) {
      console.warn(`[aoiEmbed] model code "${MODEL_CODE}" not found/ACTIVE in ai_models — embedding disabled until registered.`);
      modelMissingLogged = true;
    }
    return null;
  }
  modelIdCache = m.id;
  return m.id;
}

function uploadsRoot(): string {
  return process.env.LOCAL_STORAGE_DIR
    ? path.resolve(process.env.LOCAL_STORAGE_DIR)
    : path.join(process.cwd(), "uploads");
}

/** Load the saved package ZIP (mirrors aoiPackageRouter local/forge resolution). null on failure. */
async function loadPackageZip(storageKey: string): Promise<JSZip | null> {
  try {
    const storageMode = process.env.STORAGE_MODE ?? "forge";
    let buf: Buffer;
    if (storageMode === "local") {
      const filePath = path.join(uploadsRoot(), storageKey);
      if (!fs.existsSync(filePath)) return null;
      buf = fs.readFileSync(filePath);
    } else {
      const { url } = await storageGet(storageKey);
      const res = await fetch(url);
      if (!res.ok) return null;
      buf = Buffer.from(await res.arrayBuffer());
    }
    return await JSZip.loadAsync(buf);
  } catch (e) {
    console.warn(`[aoiEmbed] ZIP load failed (${storageKey}):`, (e as Error)?.message ?? e);
    return null;
  }
}

/** /api/aoi/image/{packageId}/{fileName} → fileName (decoded). null if not an AOI image URL. */
function fileNameFromImageUrl(imageUrl: string): string | null {
  const m = imageUrl.match(/\/api\/aoi\/image\/[^/]+\/([^/?#]+)/i);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Embed all eligible images of one inspection (awaitable). Used by the queue pump and
 * exposed for manual/admin trigger + tests. Returns counts; never throws on per-image errors.
 */
export async function runAoiInspectionEmbedding(
  job: AoiEmbeddingJob,
): Promise<{ embedded: number; skipped: number }> {
  const db = await getDb();
  if (!db) return { embedded: 0, skipped: 0 };
  const modelId = await resolveModelId();
  if (modelId == null) return { embedded: 0, skipped: 0 };

  // Candidate measurement results: this inspection, has image, (optionally) NG only.
  const baseWhere = and(
    eq(measurementResults.inspectionId, job.inspectionId),
    isNotNull(measurementResults.imageUrl),
  );
  const where =
    RESULT_FILTER === "ALL"
      ? baseWhere
      : and(baseWhere, eq(measurementResults.result, "NG"));

  const rows = await db
    .select({
      id: measurementResults.id,
      imageUrl: measurementResults.imageUrl,
      result: measurementResults.result,
    })
    .from(measurementResults)
    .where(where)
    .limit(MAX_POINTS);

  if (rows.length === 0) return { embedded: 0, skipped: 0 };

  // Idempotency: skip rows already embedded for this modelCode.
  const ids = rows.map((r) => r.id);
  const existing = await db
    .select({ mrid: aiImageEmbeddings.measurementResultId })
    .from(aiImageEmbeddings)
    .where(and(inArray(aiImageEmbeddings.measurementResultId, ids), eq(aiImageEmbeddings.modelCode, MODEL_CODE)));
  const done = new Set(existing.map((e) => e.mrid));
  const todo = rows.filter((r) => !done.has(r.id) && r.imageUrl);
  if (todo.length === 0) return { embedded: 0, skipped: 0 };

  // Inspection context (machine/product) for downstream search filters.
  const [insp] = await db
    .select({ machineId: productInspections.machineId, productModelId: productInspections.productModelId })
    .from(productInspections)
    .where(eq(productInspections.id, job.inspectionId))
    .limit(1);

  const zip = await loadPackageZip(job.storageKey!);
  if (!zip) {
    console.warn(`[aoiEmbed] inspection ${job.inspectionId}: package ZIP not resolvable (${job.storageKey}); ${todo.length} image(s) skipped.`);
    return { embedded: 0, skipped: todo.length };
  }

  let ok = 0;
  let skip = 0;
  for (const r of todo) {
    try {
      const fileName = fileNameFromImageUrl(r.imageUrl!);
      if (!fileName) {
        skip++;
        continue;
      }
      const f = zip.file(`images/${fileName}`) || zip.file(fileName);
      if (!f) {
        skip++;
        continue;
      }
      const buf = Buffer.from(await f.async("uint8array"));
      const emb = await extractEmbedding(modelId, buf);
      // storeEmbedding now inserts via raw SQL omitting the pgvector embedding_vec column,
      // so it is safe on the no-pgvector DB (and sets embedding_vec on pgvector DBs for dim 1024).
      const embeddingId = await storeEmbedding({
        measurementResultId: r.id,
        inspectionId: job.inspectionId,
        imageUrl: r.imageUrl!,
        embedding: emb.embedding,
        dim: emb.dim,
        modelCode: emb.modelCode,
        label: r.result ?? undefined,
        machineId: insp?.machineId ?? undefined,
        productModelId: insp?.productModelId ?? undefined,
      });
      ok++;

      // B3 — anomaly score + VL escalation gate (flag-gated, fire-and-forget).
      // Không await để không thêm độ trễ cho vòng embed; mọi lỗi nuốt bên trong.
      if (isAnomalyDetectionEnabled() && embeddingId != null) {
        void runAnomalyAndEscalation({
          embeddingId,
          measurementResultId: r.id,
          buffer: buf,
          classification: r.result ?? null,
          machineId: insp?.machineId ?? null,
          productModelId: insp?.productModelId ?? null,
          modelId,
        }).catch((e) =>
          console.warn(`[aoiEmbed] anomaly step mr#${r.id} failed:`, (e as Error)?.message ?? e),
        );
      }
    } catch (e) {
      skip++;
      console.warn(`[aoiEmbed] mr#${r.id} failed:`, (e as Error)?.message ?? e);
    }
  }
  if (ok > 0 || skip > 0) {
    console.log(`[aoiEmbed] inspection ${job.inspectionId}: embedded ${ok}, skipped ${skip} (model=${MODEL_CODE}, filter=${RESULT_FILTER}).`);
  }
  return { embedded: ok, skipped: skip };
}

// ─── B3 — anomaly score + VL escalation (post-embed, flag-gated) ────────────────

/** Cờ master B3 (ANOMALY_DETECTION_ENABLED, default OFF) — re-export qua service. */
function isAnomalyDetectionEnabled(): boolean {
  // Đọc lười để tôn trọng env tại runtime (đồng bộ với aiAnomalyDetection.isAnomalyDetectionEnabled).
  return (process.env.ANOMALY_DETECTION_ENABLED ?? "false").toLowerCase() === "true";
}

export interface AnomalyEscalationParams {
  embeddingId: number;
  /** measurement_results.id this embedding/image belongs to — the row whose
   *  aiAnalysisResult the auto-generated VLM description is routed to. */
  measurementResultId: number;
  buffer: Buffer;
  classification: string | null;
  machineId: number | null;
  productModelId: number | null;
  modelId: number | null;
}

/**
 * B3 — chấm anomaly score cho ảnh vừa embed, lưu vào ai_image_embeddings.metadata,
 * rồi CỔNG leo VL (shouldEscalateToVision): chỉ ảnh NG/nghi ngờ mới mô tả inline qua
 * Qwen3-VL (sau khi crop ROI). Mọi bước best-effort, không bao giờ ném.
 *
 * Idempotent: nếu metadata.anomaly đã tồn tại cho dòng này → bỏ qua (tránh chấm lại
 * khi re-run). VL chỉ chạy khi sidecar khả dụng; concurrency=1 do sidecar tự serial.
 */
export async function runAnomalyAndEscalation(params: AnomalyEscalationParams): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // Idempotency: bỏ qua nếu đã có metadata.anomaly.
  try {
    const [existing] = await db
      .select({ metadata: aiImageEmbeddings.metadata })
      .from(aiImageEmbeddings)
      .where(eq(aiImageEmbeddings.id, params.embeddingId))
      .limit(1);
    if (existing?.metadata && (existing.metadata as Record<string, unknown>).anomaly != null) {
      return;
    }
  } catch {
    // đọc lỗi → vẫn thử chấm (best-effort).
  }

  const { scoreImage, shouldEscalateToVision } = await import("./aiAnomalyDetection");
  const result = await scoreImage({
    buffer: params.buffer,
    productModelId: params.productModelId,
    machineId: params.machineId,
    modelId: params.modelId,
  });

  // CỔNG leo VL (§B8ter): chỉ NG/nghi ngờ → VL. Đo lường qua meter trong gate.
  const decision = shouldEscalateToVision(result.score, params.classification, {
    profileThreshold: result.threshold,
    enabled: true, // đã gated bởi isAnomalyDetectionEnabled ở call-site.
  });

  // Mô tả VL inline (ROI-crop trước) CHỈ khi cổng cho phép + sidecar khả dụng.
  let visionDescription: string | null = null;
  let visionRoiCropped = false;
  if (decision.escalate) {
    try {
      const { isVisionSidecarAvailable, describeImageViaSidecar } = await import("./llamaVisionSidecar");
      if (isVisionSidecarAvailable()) {
        const { cropToRoiForVision } = await import("./aiAdvancedVision");
        const roi = await cropToRoiForVision(params.buffer);
        visionRoiCropped = roi.cropped;
        const r = await describeImageViaSidecar({
          image: roi.buffer,
          prompt:
            "You are an AOI quality engineer. Briefly describe any visible defect in this inspection image (1-3 sentences). If none, say 'No defect detected'.",
          maxTokens: 256,
          temperature: 0.2,
        });
        visionDescription = (r.text ?? "").trim().slice(0, 1000) || null;
      }
    } catch (e) {
      // Sidecar/describe lỗi → giữ score, bỏ mô tả (degrade trung thực).
      console.warn(`[aoiEmbed] VL escalation emb#${params.embeddingId} failed:`, (e as Error)?.message ?? e);
    }
  }

  // Lưu kết quả vào metadata (merge JSON, best-effort). Dùng jsonb concat để không
  // mất các khóa metadata khác đã có.
  const anomalyMeta = {
    anomaly: {
      score: Number(result.score.toFixed(6)),
      threshold: result.threshold,
      isAnomaly: result.isAnomaly,
      source: result.source,
      degraded: result.degraded,
      bankSize: result.bankSize,
      k: result.k,
      reason: result.reason ?? null,
      escalation: {
        escalated: decision.escalate,
        reason: decision.reason,
        suspectThreshold: decision.suspectThreshold,
        roiCropped: visionRoiCropped,
      },
      visionDescription,
      scoredAt: new Date().toISOString(),
    },
  };

  try {
    const metaStr = JSON.stringify(anomalyMeta);
    // COALESCE: nếu metadata NULL → '{}'. jsonb '||' merge giữ khóa cũ, ghi đè "anomaly".
    await db.execute(sql`
      UPDATE ai_image_embeddings
      SET metadata = (COALESCE(metadata::jsonb, '{}'::jsonb) || ${metaStr}::jsonb)::json
      WHERE id = ${params.embeddingId}
    `);
  } catch (e) {
    console.warn(`[aoiEmbed] persist anomaly meta emb#${params.embeddingId} failed:`, (e as Error)?.message ?? e);
  }

  // Route the auto-generated VLM description to measurement_results.aiAnalysisResult so
  // Repair Station's existing "Sparkles" AI panel (RepairStation.tsx vlmSummary(), which reads
  // measurement_results.aiAnalysisResult — NOT ai_image_embeddings.metadata) shows the
  // already-computed explanation with zero new UI. Only when there's actually a description
  // (VL didn't escalate, or the sidecar was unavailable/failed → visionDescription is null →
  // nothing to write).
  //
  // No-clobber: aiAnalysisResult is a plain `text` column (inspectionRouters.ts analyzeWithAI
  // writes a JSON.stringify'd string, not native jsonb), so a true SQL jsonb '||' merge — like
  // the metadata write above — isn't natural here. Instead this UPDATE is conditional on the
  // cell still being empty/null (WHERE aiAnalysisResult IS NULL OR = ''), which is atomic and
  // race-free: a MANUAL analysis (inspectionRouters.ts analyzeWithAI, an unconditional UPDATE)
  // either already occupies the cell — this write is then a no-op — or arrives afterwards and
  // freely overwrites this auto value, exactly as V24's "re-analyze overwrites" behaviour
  // already documents. The payload is additionally tagged `source:"vision-escalation"`
  // (provenance) so any downstream reader can tell an auto value apart from a manual one, and
  // the `description` key is what vlmSummary() (RepairStation.tsx) looks for first.
  if (visionDescription) {
    try {
      const payload = JSON.stringify({
        description: visionDescription,
        source: "vision-escalation",
        isAnomaly: result.isAnomaly,
        score: Number(result.score.toFixed(6)),
        scoredAt: anomalyMeta.anomaly.scoredAt,
      });
      await db
        .update(measurementResults)
        .set({ aiAnalysisResult: payload })
        .where(
          and(
            eq(measurementResults.id, params.measurementResultId),
            or(isNull(measurementResults.aiAnalysisResult), eq(measurementResults.aiAnalysisResult, "")),
          ),
        );
    } catch (e) {
      // Fail-safe: NEVER throw out of this fire-and-forget worker. Use the cause-walking
      // helpers (not a naive `.code` check — drizzle-orm ≥0.44 wraps the real driver error,
      // code and all, inside `.cause`) to recognize an unmigrated schema and log accordingly;
      // any other DB error still degrades the same way (log + continue).
      if (isMissingTable(e) || isMissingColumn(e)) {
        console.warn(
          `[aoiEmbed] measurement_results.aiAnalysisResult write skipped mr#${params.measurementResultId} (schema not migrated yet):`,
          (e as Error)?.message ?? e,
        );
      } else {
        console.warn(
          `[aoiEmbed] measurement_results.aiAnalysisResult write failed mr#${params.measurementResultId}:`,
          (e as Error)?.message ?? e,
        );
      }
    }
  }

  // U1-a — publish anomaly.detected for a positive image anomaly (fire-and-forget;
  // never throws into the embedding worker). Feeds the unified alert stream + subscribers.
  if (result.isAnomaly) {
    try {
      const { publishAnomalyDetected } = await import("./ecosystem/ecosystemEvents");
      publishAnomalyDetected({
        kind: "image_anomaly",
        severity: result.degraded ? "low" : "high",
        source: "image",
        machineId: params.machineId,
        productModelId: params.productModelId,
        score: Number(result.score.toFixed(6)),
        message: `Image anomaly detected (score ${result.score.toFixed(4)}, source ${result.source})${visionDescription ? `: ${visionDescription}` : ""}`,
      }, "imageAnomaly");
    } catch { /* best-effort */ }
  }
}
