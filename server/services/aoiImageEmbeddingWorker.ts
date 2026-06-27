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
 */

import path from "path";
import fs from "fs";
import JSZip from "jszip";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { getDb } from "../db/connection";
import { getAiModelByCode } from "../db/ai";
import { measurementResults, productInspections, aiImageEmbeddings } from "../../drizzle/schema";
import { extractEmbedding, storeEmbedding } from "./aiImageEmbedding";
import { storageGet } from "../storage";

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
      await storeEmbedding({
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
