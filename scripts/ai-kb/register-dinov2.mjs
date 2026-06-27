#!/usr/bin/env node
/**
 * B4 — Đăng ký model DINOv2 ONNX (visual embedding) vào registry `ai_models`.
 *
 * Idempotent: nếu code đã tồn tại → UPDATE; chưa có → INSERT. In ra modelId + code.
 *
 * Model thật: D:/16.AI/model.onnx = DINOv2-small
 *   input  pixel_values [1,3,224,224]
 *   output last_hidden_state [1,257,384]  (token 0 = CLS → embedding 384-dim)
 *   normalize: ImageNet (mean .485/.456/.406, std .229/.224/.225)
 *
 * Cách dùng:
 *   node scripts/ai-kb/register-dinov2.mjs
 *   DINOV2_MODEL_PATH=D:/16.AI/model.onnx node scripts/ai-kb/register-dinov2.mjs
 *
 * ENV:
 *   DATABASE_URL        (bắt buộc)
 *   DINOV2_MODEL_PATH   (mặc định D:/16.AI/model.onnx) — đường ABSOLUTE tới .onnx
 *   DINOV2_MODEL_CODE   (mặc định "dinov2-small")
 *   DINOV2_EMBED_DIM    (mặc định 384) — D của last_hidden_state
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, "..", "..");

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

const MODEL_PATH = process.env.DINOV2_MODEL_PATH ?? "D:/SOURCES/16.AI/model.onnx";
const MODEL_CODE = process.env.DINOV2_MODEL_CODE ?? "dinov2-small";
const EMBED_DIM = Number(process.env.DINOV2_EMBED_DIM ?? 384);

if (!fs.existsSync(MODEL_PATH)) {
  console.error(`ERROR: model file not found: ${MODEL_PATH}`);
  process.exit(1);
}

const inputShape = [1, 3, 224, 224];
const preprocessConfig = {
  resize: { width: 224, height: 224 },
  colorSpace: "RGB",
  channelFirst: true,
  normalize: { mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225] },
};
const metadata = { embeddingDim: EMBED_DIM, pooling: "cls" };
const labels = [];

let fileSize = null;
try {
  fileSize = fs.statSync(MODEL_PATH).size;
} catch {
  /* best-effort */
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
console.log("  B4 — Register DINOv2 ONNX embedding model");
console.log("══════════════════════════════════════════════════════════════");
console.log(`  code:     ${MODEL_CODE}`);
console.log(`  filePath: ${MODEL_PATH}`);
console.log(`  dim:      ${EMBED_DIM}  pooling: cls`);

try {
  await sql`SELECT 1`;

  const existing = await sql`SELECT id FROM ai_models WHERE code = ${MODEL_CODE} LIMIT 1`;

  let modelId;
  if (existing.length > 0) {
    modelId = existing[0].id;
    await sql`
      UPDATE ai_models SET
        name             = ${"DINOv2 Small (visual embedding)"},
        description      = ${"DINOv2-small ONNX — CLS-token visual embedding (B4 image search / B3 anomaly)."},
        "modelType"      = ${"embedding"},
        format           = ${"ONNX"},
        "filePath"       = ${MODEL_PATH},
        "fileSize"       = ${fileSize},
        "inputShape"     = ${sql.json(inputShape)},
        labels           = ${sql.json(labels)},
        "preprocessConfig" = ${sql.json(preprocessConfig)},
        status           = ${"ACTIVE"},
        metadata         = ${sql.json(metadata)},
        "updatedAt"      = now()
      WHERE id = ${modelId}
    `;
    console.log(`\n  UPDATED existing model (code already present).`);
  } else {
    const [row] = await sql`
      INSERT INTO ai_models
        (code, name, description, "modelType", format, "filePath", "fileSize",
         "inputShape", labels, "preprocessConfig", status, metadata)
      VALUES
        (${MODEL_CODE},
         ${"DINOv2 Small (visual embedding)"},
         ${"DINOv2-small ONNX — CLS-token visual embedding (B4 image search / B3 anomaly)."},
         ${"embedding"}, ${"ONNX"}, ${MODEL_PATH}, ${fileSize},
         ${sql.json(inputShape)}, ${sql.json(labels)}, ${sql.json(preprocessConfig)},
         ${"ACTIVE"}, ${sql.json(metadata)})
      RETURNING id
    `;
    modelId = row.id;
    console.log(`\n  INSERTED new model.`);
  }

  console.log("══════════════════════════════════════════════════════════════");
  console.log(`  DONE  modelId=${modelId}  modelCode=${MODEL_CODE}`);
  console.log("══════════════════════════════════════════════════════════════");
} catch (e) {
  console.error("\nERROR:", e.message);
  await sql.end();
  process.exit(1);
}

await sql.end();
process.exit(0);
