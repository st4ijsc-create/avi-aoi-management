#!/usr/bin/env node
/**
 * B4 — Re-embed ảnh inspection bằng DINOv2 ONNX (visual embedding THẬT).
 *
 * Pipeline mỗi ảnh:
 *   1) Resolve buffer ảnh: AOI cache → giải nén images/{fileName} từ package ZIP.
 *   2) Preprocess (sharp): resize 224×224, RGB, ImageNet normalize, NCHW [1,3,224,224].
 *   3) onnxruntime-node chạy model.onnx → last_hidden_state [1,257,384].
 *   4) CLS-pool: lấy token 0 = 384 giá trị đầu → L2-normalize → vector 384-d.
 *   5) Lưu ai_image_embeddings: embedding TEXT + embeddingDim=384 + modelCode="dinov2-small"
 *      (+ label/defectType/machineId/productModelId/imageUrl).
 *      Lưu ý: 384-dim ≠ 1024 (cột embedding_vec/HNSW chỉ cho 1024) → KHÔNG ghi embedding_vec.
 *      B4 dùng exact-cast/brute-force cho dim 384 (chấp nhận, trung thực).
 *
 * IDEMPOTENT: bỏ qua measurementResultId đã có embedding cùng modelCode.
 *
 * Cách dùng:
 *   node scripts/ai-kb/reembed-images-onnx.mjs --limit 3
 *   node scripts/ai-kb/reembed-images-onnx.mjs --dry-run
 *   node scripts/ai-kb/reembed-images-onnx.mjs            (toàn bộ)
 *
 * ENV (AOI-A — đường dẫn model CẤU HÌNH ĐƯỢC, không hardcode absolute):
 *   DATABASE_URL          (bắt buộc)
 *   AI_DINOV2_MODEL_PATH  đường tới .onnx (absolute HOẶC relative theo repo root).
 *                         Mặc định: models/dinov2.onnx.
 *   DINOV2_MODEL_PATH     alias LEGACY — vẫn đọc để backward-compat.
 *   DINOV2_MODEL_CODE     (mặc định "dinov2-small")
 *   LOCAL_STORAGE_DIR     (gốc giải package ZIP, mặc định ./uploads)
 *   AOI_CACHE_DIR         (cache ảnh đã giải, mặc định {LOCAL_STORAGE_DIR}/aoi-cache)
 *   ENABLE_CUDA=true      (tuỳ chọn EP)
 *
 * Script này CHẠY inference ONNX thật → BẮT BUỘC có file model. Vắng file → exit rõ ràng
 * (KHÔNG bịa vector). Muốn embedding degrade tự động khi thiếu model → dùng embed-at-ingest
 * worker (aoiImageEmbeddingWorker) / anomaly pipeline, không phải script backfill này.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as ort from "onnxruntime-node";
import sharp from "sharp";
import JSZip from "jszip";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, "..", "..");

// ─── args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx !== -1 ? Number(args[limitIdx + 1]) : 0;

// ─── .env ────────────────────────────────────────────────────────────────────
function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const idx = t.indexOf("=");
    if (idx === -1) continue;
    const k = t.slice(0, idx).trim();
    let v = t.slice(idx + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnvFile(path.join(process.cwd(), ".env"));
loadEnvFile(path.join(PROJECT_ROOT, ".env"));

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL not set.");
  process.exit(1);
}

// AOI-A — đường dẫn model cấu hình được (AI_DINOV2_MODEL_PATH → legacy → default repo-relative).
const DEFAULT_MODEL_PATH = "models/dinov2.onnx";
const RAW_MODEL_PATH =
  process.env.AI_DINOV2_MODEL_PATH || process.env.DINOV2_MODEL_PATH || DEFAULT_MODEL_PATH;
const MODEL_PATH = path.isAbsolute(RAW_MODEL_PATH)
  ? RAW_MODEL_PATH
  : path.resolve(PROJECT_ROOT, RAW_MODEL_PATH);
const MODEL_CODE = process.env.DINOV2_MODEL_CODE ?? "dinov2-small";
const LOCAL_STORAGE_DIR = process.env.LOCAL_STORAGE_DIR
  ? path.resolve(process.env.LOCAL_STORAGE_DIR)
  : path.join(PROJECT_ROOT, "uploads");
const AOI_CACHE_DIR = process.env.AOI_CACHE_DIR
  ? path.resolve(process.env.AOI_CACHE_DIR)
  : path.join(LOCAL_STORAGE_DIR, "aoi-cache");

const IMAGENET_MEAN = [0.485, 0.456, 0.406];
const IMAGENET_STD = [0.229, 0.224, 0.225];
const INPUT_SIZE = 224;

if (!fs.existsSync(MODEL_PATH)) {
  console.error(
    `ERROR: DINOv2 model file not found: ${MODEL_PATH}\n` +
      `Set AI_DINOV2_MODEL_PATH (absolute or repo-relative) to a real .onnx, ` +
      `or place one at the default ${DEFAULT_MODEL_PATH}. This backfill script needs a real ` +
      `model and will NOT fabricate embeddings.`,
  );
  process.exit(1);
}

// ─── helpers ─────────────────────────────────────────────────────────────────
function l2norm(vec) {
  const norm = Math.sqrt(vec.reduce((a, v) => a + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

/** CLS-pool: 3-D [batch,T,D] → token 0 (first D); phẳng → nguyên. Khớp poolEmbeddingFromOutput. */
function poolCls(data, dims) {
  const flat = Array.from(data);
  if (Array.isArray(dims) && dims.length === 3) {
    const D = dims[2];
    if (D > 0 && flat.length >= D) return flat.slice(0, D);
  }
  return flat;
}

/** Preprocess buffer → Float32Array NCHW [1,3,224,224], ImageNet normalize. */
async function preprocess(buf) {
  const raw = await sharp(buf).resize(INPUT_SIZE, INPUT_SIZE).removeAlpha().raw().toBuffer();
  const totalPixels = INPUT_SIZE * INPUT_SIZE;
  const tensor = new Float32Array(3 * totalPixels);
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < totalPixels; i++) {
      const px = raw[i * 3 + c] / 255.0;
      tensor[c * totalPixels + i] = (px - IMAGENET_MEAN[c]) / IMAGENET_STD[c]; // channel-first
    }
  }
  return tensor;
}

// Cache ZIP đã mở (per packageId) để không giải lại nhiều ảnh cùng package.
const zipCache = new Map();

/**
 * Resolve buffer ảnh từ imageUrl. Hỗ trợ:
 *  - /api/aoi/image/{packageId}/{fileName} → AOI cache trước, rồi giải images/{fileName} từ ZIP.
 *  - đường dẫn thường (/uploads/... hoặc tương đối) → đọc file trực tiếp dưới LOCAL_STORAGE_DIR.
 * Trả null nếu không resolve được (caller skip).
 */
async function resolveImageBuffer(row) {
  const url = String(row.imageUrl).trim();
  const m = url.match(/\/api\/aoi\/image\/([^/]+)\/([^/?#]+)/i);
  if (m) {
    const packageId = decodeURIComponent(m[1]);
    const fileName = decodeURIComponent(m[2]);
    // 1) AOI cache (ảnh đã giải sẵn từ runtime serve).
    const cachePath = path.join(AOI_CACHE_DIR, packageId, fileName);
    if (fs.existsSync(cachePath)) return fs.readFileSync(cachePath);
    // 2) Giải từ package ZIP.
    if (row.storageKey) {
      const zipPath = path.join(LOCAL_STORAGE_DIR, row.storageKey);
      if (!fs.existsSync(zipPath)) return null;
      let zip = zipCache.get(packageId);
      if (!zip) {
        zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
        if (zipCache.size > 8) zipCache.clear();
        zipCache.set(packageId, zip);
      }
      // ★★★ I-3 (review lượt 8, đóng nốt vòng 9) — MỘT ĐƯỜNG DẪN DUY NHẤT.
      // Fallback `|| zip.file(fileName)` ở đây là CỬA THỨ HAI để tìm CÙNG một
      // ảnh: đường ghi (`commit`, bất biến 2) chỉ chấp nhận `images/<fileName>`,
      // nên đường ĐỌC rộng hơn đường GHI là mở lại đúng lớp lỗi BG-87 đã đóng ở
      // ba chỗ khác. Đây là chỗ thứ SÁU — census
      // `aoiZipMotDuongDanCensus.test.ts` mù nó theo CẤU TẠO (chỉ soi
      // `server/**`, chỉ `.ts`) cho tới vòng 9. Thất bại nay NÓI RA thay vì tự
      // cứu im lặng.
      const f = zip.file(`images/${fileName}`);
      if (!f) {
        console.warn(`[reembed] BỎ QUA ${packageId}/${fileName}: không có images/${fileName} trong ZIP (đường dẫn ảnh DUY NHẤT)`);
        return null;
      }
      return Buffer.from(await f.async("uint8array"));
    }
    return null;
  }
  // Đường dẫn thường.
  let key = url.replace(/\\/g, "/").replace(/^\/+/, "");
  if (/^https?:\/\//i.test(key)) {
    try { key = new URL(key).pathname.replace(/^\/+/, ""); } catch { /* keep */ }
  }
  key = key.replace(/^uploads\//i, "");
  const p = path.join(LOCAL_STORAGE_DIR, key);
  return fs.existsSync(p) ? fs.readFileSync(p) : null;
}

// ─── ONNX session ──────────────────────────────────────────────────────────
const providers = [];
if (process.env.ENABLE_CUDA === "true") providers.push("cuda");
providers.push("cpu");
const session = await ort.InferenceSession.create(MODEL_PATH, {
  executionProviders: providers,
  graphOptimizationLevel: "all",
});
const inputName = session.inputNames[0];
const outputName =
  session.outputNames.find((n) => /embed|feature|pool|hidden/i.test(n)) ??
  session.outputNames[session.outputNames.length - 1];

async function embedBuffer(buf) {
  const tensorData = await preprocess(buf);
  const inputTensor = new ort.Tensor("float32", tensorData, [1, 3, INPUT_SIZE, INPUT_SIZE]);
  const results = await session.run({ [inputName]: inputTensor });
  const out = results[outputName];
  const pooled = poolCls(out.data, out.dims);
  return { vector: l2norm(pooled), dim: pooled.length, dims: out.dims };
}

// ─── postgres ────────────────────────────────────────────────────────────────
let postgres;
try {
  postgres = (await import("postgres")).default;
} catch (e) {
  console.error('ERROR: cannot import "postgres". Run pnpm install.', e.message);
  process.exit(1);
}
const needsSsl = DATABASE_URL.includes("sslmode=require") || DATABASE_URL.includes("ssl=true");
const sql = postgres(DATABASE_URL, {
  ...(needsSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  connect_timeout: 30,
  max: 1,
});

console.log("══════════════════════════════════════════════════════════════");
console.log("  B4 — Re-embed inspection images via DINOv2 ONNX (CLS, 384-d)");
console.log("══════════════════════════════════════════════════════════════");
console.log(`  model:   ${MODEL_PATH}  (code=${MODEL_CODE})`);
console.log(`  output:  ${outputName}   EP: ${providers.join(",")}`);
console.log(`  storage: ${LOCAL_STORAGE_DIR}   cache: ${AOI_CACHE_DIR}`);
console.log(`  Mode: ${DRY_RUN ? "DRY-RUN" : "APPLY"}${LIMIT > 0 ? `  Limit: ${LIMIT}` : ""}`);

let processed = 0, skipped = 0, failed = 0;

try {
  await sql`SELECT 1`;

  const limitClause = LIMIT > 0 ? sql`LIMIT ${LIMIT}` : sql``;
  // Ứng viên: measurement_results NG có ảnh, CHƯA có embedding cùng modelCode dinov2.
  // Join package để resolve ZIP; lấy 1 package theo inspection (DISTINCT ON id mr).
  const candidates = await sql`
    SELECT mr.id            AS "measurementResultId",
           mr."inspectionId" AS "inspectionId",
           mr."imageUrl"      AS "imageUrl",
           mr."defectSeverity" AS "defectSeverity",
           pi."machineId"      AS "machineId",
           pi."productModelId" AS "productModelId",
           pkg."packageId"     AS "packageId",
           pkg."storageKey"    AS "storageKey"
    FROM measurement_results mr
    JOIN product_inspections pi ON pi.id = mr."inspectionId"
    LEFT JOIN LATERAL (
      SELECT p."packageId", p."storageKey"
      FROM inspection_packages p
      WHERE p."inspectionId" = mr."inspectionId"
      ORDER BY p.id DESC LIMIT 1
    ) pkg ON true
    LEFT JOIN ai_image_embeddings e
      ON e."measurementResultId" = mr.id AND e."modelCode" = ${MODEL_CODE}
    WHERE mr."imageUrl" IS NOT NULL
      AND mr.result = 'NG'
      AND e.id IS NULL
    ORDER BY mr.id DESC
    ${limitClause}
  `;

  console.log(`\n  Candidates (NG, có ảnh, chưa có embedding ${MODEL_CODE}): ${candidates.length}\n`);

  if (DRY_RUN) {
    console.log("  [DRY-RUN] Không ghi gì.");
    await sql.end();
    process.exit(0);
  }

  const startedAt = Date.now();
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    try {
      const buf = await resolveImageBuffer(c);
      if (!buf) {
        skipped++;
        console.warn(`  SKIP mr#${c.measurementResultId}: không resolve được ảnh (${c.imageUrl})`);
        continue;
      }
      const { vector, dim, dims } = await embedBuffer(buf);
      const norm = Math.sqrt(vector.reduce((a, v) => a + v * v, 0));
      const embStr = `[${vector.join(",")}]`;

      await sql`
        INSERT INTO ai_image_embeddings
          ("inspectionId", "measurementResultId", "imageUrl", "embedding", "embeddingDim",
           "modelCode", "defectType", "machineId", "productModelId", "metadata")
        VALUES
          (${c.inspectionId}, ${c.measurementResultId}, ${c.imageUrl}, ${embStr}, ${dim},
           ${MODEL_CODE}, ${c.defectSeverity ?? null}, ${c.machineId ?? null}, ${c.productModelId ?? null},
           ${sql.json({ source: "reembed-onnx-b4", pooling: "cls", onnxDims: dims })})
      `;
      processed++;
      if (processed <= 5 || (i + 1) % 25 === 0) {
        console.log(`  OK   mr#${c.measurementResultId}  dim=${dim}  L2-norm=${norm.toFixed(6)}  dims=${JSON.stringify(dims)}`);
      }
    } catch (err) {
      failed++;
      console.warn(`  FAIL mr#${c.measurementResultId}: ${err?.message ?? err}`);
    }

    if ((i + 1) % 25 === 0 || i === candidates.length - 1) {
      console.log(`  Progress ${i + 1}/${candidates.length}  (ok=${processed} skip=${skipped} fail=${failed})`);
    }
  }

  console.log("\n══════════════════════════════════════════════════════════════");
  console.log(`  DONE  processed=${processed}  skipped=${skipped}  failed=${failed}`);
  console.log(`  Elapsed: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  console.log("══════════════════════════════════════════════════════════════");
} catch (e) {
  console.error("\nERROR:", e.message);
  await sql.end();
  process.exit(1);
}

await sql.end();
process.exit(0);
