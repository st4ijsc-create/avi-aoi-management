#!/usr/bin/env node
/**
 * B7 — Đăng ký model SEGMENTATION ONNX (YOLOv8-seg) vào registry `ai_models`,
 * để nút "chạy segmentation" trên /mask-annotation (runSegmentation) dùng được.
 *
 * Idempotent: code đã tồn tại → UPDATE; chưa có → INSERT. In ra modelId.
 *
 * YOLOv8-seg ONNX preprocessing = resize imgsz + chia 255 (KHÔNG ImageNet mean/std)
 *   → normalize mean=[0,0,0] std=[1,1,1]. Decode tự nhận YOLO-seg qua output shape
 *   (output0 [1,4+nc+32,N] + output1 [1,32,h,w]) hoặc postprocessConfig.format.
 *
 * Cách dùng:
 *   SEG_MODEL_PATH=D:/16.AI/yolov8n-seg.onnx \
 *   SEG_MODEL_CODE=defect-seg-v1 \
 *   SEG_LABELS="scratch,dent,stain" \
 *   SEG_IMGSZ=640 \
 *   node scripts/ai-kb/register-seg-model.mjs
 *
 * ENV:
 *   DATABASE_URL     (bắt buộc)
 *   SEG_MODEL_PATH   (bắt buộc) — đường ABSOLUTE tới .onnx (YOLOv8-seg export)
 *   SEG_MODEL_CODE   (mặc định "defect-seg-v1")
 *   SEG_LABELS       (CSV tên lớp, đúng THỨ TỰ index lúc train; rỗng → decode dùng class_<i>)
 *   SEG_IMGSZ        (mặc định 640) — phải KHỚP imgsz lúc export ONNX
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..", "..");

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnvFile(path.join(process.cwd(), ".env"));
loadEnvFile(path.join(PROJECT_ROOT, ".env"));

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("ERROR: DATABASE_URL not set."); process.exit(1); }

const MODEL_PATH = process.env.SEG_MODEL_PATH;
if (!MODEL_PATH) { console.error("ERROR: SEG_MODEL_PATH not set (absolute path to YOLOv8-seg .onnx)."); process.exit(1); }
if (!fs.existsSync(MODEL_PATH)) { console.error(`ERROR: model file not found: ${MODEL_PATH}`); process.exit(1); }

const MODEL_CODE = process.env.SEG_MODEL_CODE ?? "defect-seg-v1";
const IMGSZ = Number(process.env.SEG_IMGSZ ?? 640);
const labels = (process.env.SEG_LABELS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const inputShape = [1, 3, IMGSZ, IMGSZ];
const preprocessConfig = {
  resize: { width: IMGSZ, height: IMGSZ },
  colorSpace: "RGB",
  channelFirst: true,
  // YOLOv8: chỉ /255, KHÔNG trừ mean/chia std.
  normalize: { mean: [0, 0, 0], std: [1, 1, 1] },
};
const postprocessConfig = {
  type: "segmentation",
  format: "yolo-seg",
  confidenceThreshold: 0.25,
  nmsThreshold: 0.45,
};
const fileSize = (() => { try { return fs.statSync(MODEL_PATH).size; } catch { return null; } })();

let postgres;
try { postgres = (await import("postgres")).default; }
catch (e) { console.error('ERROR: cannot import "postgres" driver.', e.message); process.exit(1); }

const needsSsl = DATABASE_URL.includes("sslmode=require") || DATABASE_URL.includes("ssl=true");
const sql = postgres(DATABASE_URL, { ...(needsSsl ? { ssl: { rejectUnauthorized: false } } : {}), connect_timeout: 30, max: 1 });

console.log("══════════════════════════════════════════════════════════════");
console.log("  B7 — Register YOLOv8-seg ONNX (segmentation)");
console.log(`  code:     ${MODEL_CODE}`);
console.log(`  filePath: ${MODEL_PATH}`);
console.log(`  imgsz:    ${IMGSZ}   labels: ${labels.length ? labels.join(", ") : "(none → class_<i>)"}`);
console.log("══════════════════════════════════════════════════════════════");

try {
  await sql`SELECT 1`;
  const existing = await sql`SELECT id FROM ai_models WHERE code = ${MODEL_CODE} LIMIT 1`;
  const name = "Defect Segmentation (YOLOv8-seg)";
  const desc = "YOLOv8-seg ONNX — instance segmentation cho defect (B7 mask + metrology).";
  let modelId;
  if (existing.length > 0) {
    modelId = existing[0].id;
    await sql`
      UPDATE ai_models SET
        name = ${name}, description = ${desc},
        "modelType" = ${"segmentation"}, format = ${"ONNX"},
        "filePath" = ${MODEL_PATH}, "fileSize" = ${fileSize},
        "inputShape" = ${sql.json(inputShape)}, labels = ${sql.json(labels)},
        "preprocessConfig" = ${sql.json(preprocessConfig)},
        "postprocessConfig" = ${sql.json(postprocessConfig)},
        status = ${"ACTIVE"}, "updatedAt" = now()
      WHERE id = ${modelId}`;
    console.log("  UPDATED existing model.");
  } else {
    const [row] = await sql`
      INSERT INTO ai_models
        (code, name, description, "modelType", format, "filePath", "fileSize",
         "inputShape", labels, "preprocessConfig", "postprocessConfig", status)
      VALUES
        (${MODEL_CODE}, ${name}, ${desc}, ${"segmentation"}, ${"ONNX"}, ${MODEL_PATH}, ${fileSize},
         ${sql.json(inputShape)}, ${sql.json(labels)}, ${sql.json(preprocessConfig)},
         ${sql.json(postprocessConfig)}, ${"ACTIVE"})
      RETURNING id`;
    modelId = row.id;
    console.log("  INSERTED new model.");
  }
  console.log("══════════════════════════════════════════════════════════════");
  console.log(`  DONE  modelId=${modelId}  → nhập số này vào ô Model ID ở /mask-annotation`);
  console.log("══════════════════════════════════════════════════════════════");
} catch (e) {
  console.error("\nERROR:", e.message);
  await sql.end();
  process.exit(1);
}
await sql.end();
process.exit(0);
