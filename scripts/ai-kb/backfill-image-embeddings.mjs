#!/usr/bin/env node
/**
 * WS-3 — Backfill image embeddings (text-of-image pipeline, offline-first)
 *
 * Với mỗi ảnh inspection (measurement_results NG có imageUrl) CHƯA có embedding:
 *   1) Mô tả ảnh bằng LLM vision qua Ollama /api/generate (model OLLAMA_VISION_MODEL).
 *   2) Embed mô tả qua Ollama /api/embed (mxbai-embed-large, 1024-dim, L2-normalize).
 *   3) Lưu vào ai_image_embeddings: cột TEXT "embedding" + cột pgvector "embedding_vec".
 *
 * Đặc tính:
 *   - IDEMPOTENT / RESUME: bỏ qua measurementResultId đã có embedding.
 *   - Log tiến độ mỗi N ảnh; tổng kết processed/skipped/failed.
 *   - Offline-first: chỉ cần Ollama + Postgres; KHÔNG cần ONNX, KHÔNG cần cloud.
 *   - Lỗi 1 ảnh (đọc file / mô tả / embed) → skip, không dừng cả batch.
 *
 * Build HNSW index SAU khi backfill (migration 0091 đã tạo index IF NOT EXISTS;
 * pgvector tự cập nhật index khi UPDATE embedding_vec).
 *
 * Cách dùng:
 *   node scripts/ai-kb/backfill-image-embeddings.mjs                 (chạy thật)
 *   node scripts/ai-kb/backfill-image-embeddings.mjs --dry-run       (chỉ đếm)
 *   IMG_BACKFILL_LIMIT=500 node scripts/ai-kb/backfill-image-embeddings.mjs
 *
 * ENV:
 *   DATABASE_URL            (bắt buộc)
 *   OLLAMA_BASE_URL         (mặc định http://127.0.0.1:11434)
 *   OLLAMA_EMBED_MODEL      (mặc định mxbai-embed-large)
 *   OLLAMA_VISION_MODEL     (mặc định llava)  — model mô tả ảnh
 *   LOCAL_STORAGE_DIR       (mặc định ./uploads) — gốc giải ảnh tương đối
 *   IMG_BACKFILL_LIMIT      (mặc định 0 = không giới hạn)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, "..", "..");

// ─── args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");

// ─── .env (simple parser, no deps) ───────────────────────────────────────────
function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvFile(path.join(process.cwd(), ".env"));
loadEnvFile(path.join(PROJECT_ROOT, ".env"));

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL not set (in .env or env).");
  process.exit(1);
}

const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/$/, "");
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL ?? "mxbai-embed-large";
const OLLAMA_VISION_MODEL = process.env.OLLAMA_VISION_MODEL ?? "llava";
const EMBEDDING_DIM = 1024;
// GIỮ NGUYÊN modelCode để tương thích dữ liệu cũ trong ai_image_embeddings (cùng không gian mxbai
// 1024-dim dù embed bằng Ollama hay GGUF). KHÔNG đổi giá trị này.
const MODEL_CODE = "ollama-text-of-image:mxbai-embed-large";

// WS-G4 — embed MẶC ĐỊNH bằng GGUF mxbai in-process (không cần Ollama daemon).
// USE_LEGACY_OLLAMA=true → embed qua Ollama HTTP (rollback). Vision describe vẫn dùng
// Ollama-vision (llava) trừ khi sau này gắn LLaVA GGUF — embed PHẢI là mxbai để cùng không gian.
const USE_LEGACY_OLLAMA = (process.env.USE_LEGACY_OLLAMA ?? "false").toLowerCase() === "true";
const LIMIT = Number(process.env.IMG_BACKFILL_LIMIT ?? 0);
const LOCAL_STORAGE_DIR = process.env.LOCAL_STORAGE_DIR
  ? path.resolve(process.env.LOCAL_STORAGE_DIR)
  : path.join(PROJECT_ROOT, "uploads");

// ─── helpers ─────────────────────────────────────────────────────────────────
function l2norm(vec) {
  const norm = Math.sqrt(vec.reduce((a, v) => a + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

function resolveImagePath(imageUrl) {
  let key = String(imageUrl).trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (/^https?:\/\//i.test(key)) {
    try {
      key = new URL(key).pathname.replace(/^\/+/, "");
    } catch {
      /* keep */
    }
  }
  key = key.replace(/^uploads\//i, "");
  return path.join(LOCAL_STORAGE_DIR, key);
}

async function describeImageOllama(imageBase64) {
  const prompt =
    "You are an AOI (Automated Optical Inspection) quality engineer. " +
    "Describe in detail any defects visible in this inspection image: defect type, " +
    "location, severity, and likely causes. Be concise and factual.";
  const res = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_VISION_MODEL,
      prompt,
      images: [imageBase64],
      stream: false,
    }),
  });
  if (!res.ok) throw new Error(`Ollama /api/generate ${res.status}: ${await res.text().catch(() => "")}`);
  const json = await res.json();
  const text = (json.response ?? "").trim();
  if (!text) throw new Error("Ollama vision returned empty description");
  return text;
}

async function embedTextOllama(text) {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: OLLAMA_EMBED_MODEL, input: text }),
  });
  if (!res.ok) throw new Error(`Ollama /api/embed ${res.status}: ${await res.text().catch(() => "")}`);
  const json = await res.json();
  const vec = json.embeddings?.[0];
  if (!Array.isArray(vec) || !vec.length) throw new Error("Ollama /api/embed returned no embeddings");
  return l2norm(vec);
}

// Lazily-loaded GGUF embedder (mxbai). Only imported when not using legacy Ollama.
let _embedTextGguf = null;
async function embedText(text) {
  if (USE_LEGACY_OLLAMA) return embedTextOllama(text);
  if (!_embedTextGguf) {
    const mod = await import("./_gguf-embed.mjs");
    _embedTextGguf = mod.embedTextGguf;
  }
  // _gguf-embed already L2-normalizes.
  return _embedTextGguf(text);
}

// ─── postgres driver ─────────────────────────────────────────────────────────
let postgres;
try {
  postgres = (await import("postgres")).default;
} catch (e) {
  console.error('ERROR: cannot import "postgres" driver. Run npm/pnpm install.', e.message);
  process.exit(1);
}

const needsSsl = DATABASE_URL.includes("sslmode=require") || DATABASE_URL.includes("ssl=true");
const sql = postgres(DATABASE_URL, {
  ...(needsSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  connect_timeout: 30,
  max: 1,
});

console.log("══════════════════════════════════════════════════════════════");
console.log("  WS-3 Backfill Image Embeddings (text-of-image, Ollama)");
console.log("══════════════════════════════════════════════════════════════");
console.log(
  `  Vision model: ${OLLAMA_VISION_MODEL}   Embed: ${USE_LEGACY_OLLAMA ? `Ollama ${OLLAMA_EMBED_MODEL}` : `GGUF ${process.env.GGUF_EMBED_MODEL ?? "mxbai-embed-large-v1-f16"}`} (${EMBEDDING_DIM}d)`,
);
console.log(`  Storage root: ${LOCAL_STORAGE_DIR}`);
console.log(`  Mode: ${DRY_RUN ? "DRY-RUN" : "APPLY"}${LIMIT > 0 ? `  Limit: ${LIMIT}` : ""}`);

let processed = 0;
let skipped = 0;
let failed = 0;

try {
  await sql`SELECT 1`;

  // Ứng viên: measurement_results NG có ảnh, CHƯA có embedding (LEFT JOIN NULL).
  // Join inspection để lấy machineId / productModelId.
  const limitClause = LIMIT > 0 ? sql`LIMIT ${LIMIT}` : sql``;
  const candidates = await sql`
    SELECT mr.id            AS "measurementResultId",
           mr."inspectionId" AS "inspectionId",
           mr."imageUrl"      AS "imageUrl",
           mr."defectSeverity" AS "defectSeverity",
           pi."machineId"      AS "machineId",
           pi."productModelId" AS "productModelId"
    FROM measurement_results mr
    JOIN product_inspections pi ON pi.id = mr."inspectionId"
    LEFT JOIN ai_image_embeddings e ON e."measurementResultId" = mr.id
    WHERE mr."imageUrl" IS NOT NULL
      AND mr.result = 'NG'
      AND e.id IS NULL
    ORDER BY mr.id DESC
    ${limitClause}
  `;

  console.log(`\n  Candidates (NG, có ảnh, chưa embedding): ${candidates.length}\n`);

  if (DRY_RUN) {
    console.log("  [DRY-RUN] Không ghi gì. Bỏ --dry-run để chạy thật.");
    await sql.end();
    process.exit(0);
  }

  const startedAt = Date.now();
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    try {
      const imgPath = resolveImagePath(c.imageUrl);
      if (!fs.existsSync(imgPath)) {
        skipped++;
        console.warn(`  SKIP mr#${c.measurementResultId}: file không tồn tại (${c.imageUrl})`);
        continue;
      }
      const base64 = fs.readFileSync(imgPath).toString("base64");
      const description = await describeImageOllama(base64);
      const vector = await embedText(description);

      if (vector.length !== EMBEDDING_DIM) {
        skipped++;
        console.warn(`  SKIP mr#${c.measurementResultId}: dim=${vector.length} != ${EMBEDDING_DIM}`);
        continue;
      }

      const embStr = `[${vector.join(",")}]`;

      // Insert (text + metadata); embedding_vec set riêng để chịu được khi pgvector chưa có.
      const [row] = await sql`
        INSERT INTO ai_image_embeddings
          ("inspectionId", "measurementResultId", "imageUrl", "embedding", "embeddingDim",
           "modelCode", "defectType", "machineId", "productModelId", "metadata")
        VALUES
          (${c.inspectionId}, ${c.measurementResultId}, ${c.imageUrl}, ${embStr}, ${EMBEDDING_DIM},
           ${MODEL_CODE}, ${c.defectSeverity ?? null}, ${c.machineId ?? null}, ${c.productModelId ?? null},
           ${sql.json({ source: "backfill-ws3", description: description.slice(0, 2000) })})
        RETURNING id
      `;

      // Best-effort ghi pgvector column.
      try {
        await sql`UPDATE ai_image_embeddings SET embedding_vec = ${embStr}::vector(${sql.unsafe(String(EMBEDDING_DIM))}) WHERE id = ${row.id}`;
      } catch (ve) {
        // pgvector chưa sẵn sàng — bỏ qua, cột TEXT vẫn dùng được (fallback brute-force).
        if (processed === 0) {
          console.warn(`  (info) embedding_vec chưa ghi được (pgvector?): ${ve.message}`);
        }
      }

      processed++;
    } catch (err) {
      failed++;
      console.warn(`  FAIL mr#${c.measurementResultId}: ${err?.message ?? err}`);
    }

    if ((i + 1) % 10 === 0 || i === candidates.length - 1) {
      console.log(`  Progress ${i + 1}/${candidates.length}  (ok=${processed} skip=${skipped} fail=${failed})`);
    }
  }

  console.log("\n══════════════════════════════════════════════════════════════");
  console.log(`  DONE  processed=${processed}  skipped=${skipped}  failed=${failed}`);
  console.log(`  Elapsed: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  console.log("══════════════════════════════════════════════════════════════");
} catch (e) {
  console.error("\nERROR:", e.message);
  if (!USE_LEGACY_OLLAMA && _embedTextGguf) {
    try {
      const mod = await import("./_gguf-embed.mjs");
      await mod.disposeGgufEmbed();
    } catch {
      /* best-effort */
    }
  }
  await sql.end();
  process.exit(1);
}

if (!USE_LEGACY_OLLAMA && _embedTextGguf) {
  try {
    const mod = await import("./_gguf-embed.mjs");
    await mod.disposeGgufEmbed();
  } catch {
    /* best-effort */
  }
}
await sql.end();
process.exit(0);
