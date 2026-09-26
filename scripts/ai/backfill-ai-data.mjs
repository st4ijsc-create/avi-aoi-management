#!/usr/bin/env -S npx tsx
/**
 * doc-48 R2 — SYNAPSE AI/ML data-layer BACKFILL (end-to-end, REAL services only).
 *
 * PROBLEM (audit L4): the W5 "intelligence" tables are empty, so the real DL-head /
 * anomaly / feature-store / model-registry machinery has nothing to operate on:
 *   ai_image_embeddings 0 · ai_anomaly_memory_bank 0 · ai_models 0 · model_versions 0
 *   · ml_feature_cache 0 · predictive_alerts 0 · rul_estimates … · twin_trust 0.
 *
 * THIS SCRIPT feeds that pipeline using the REAL worker functions (NOT hand-inserted
 * rows, NO fabricated ML artifacts). It runs under `tsx` so it can import the actual
 * TypeScript services the server uses:
 *
 *   1. Register the DINOv2 ONNX embedding model in the registry (ai_models) so the
 *      real embedding worker can resolve it (extractEmbedding needs an ACTIVE row).
 *   2. Embed REAL inspection images on disk via the REAL service
 *      aiImageEmbedding.extractEmbedding (DINOv2 ONNX, 384-d CLS) + storeEmbedding.
 *        • Primary source: the AOI packages under uploads/aoi/** — real PCB
 *          inspection images with REAL per-measurement-point OK/NG labels in each
 *          package meta.json.  → ai_image_embeddings (labelled).
 *        • Optional: a bounded batch of the legacy uploads/inspections/** images
 *          (real images, but ORPHANED from a prior DB → stored unlabelled/unscoped,
 *          honestly tagged in metadata). → additional ai_image_embeddings.
 *   3. Build the PatchCore anomaly memory bank from the OK-labelled embedding vectors
 *      via the REAL shared builder aiAnomalyDetection.buildBankFromVectors.
 *        → ai_anomaly_memory_bank + ai_anomaly_profiles.
 *   4. Snapshot a versioned dataset + train & register a first defect-classifier HEAD
 *      via the REAL orchestrator embeddingHead.snapshotEmbeddingDataset +
 *      trainAndRegisterHead (pure logreg head over the frozen DINOv2 embeddings), then
 *      stamp its lifecycle stage via the REAL modelStagePipeline.promoteStage.
 *        → ai_embedding_datasets + ai_models(+CUSTOM head) + model_versions(staged)
 *        → ml_feature_cache (populated by the feature store during collect, flag ON).
 *   5. (Optional, SIM-labelled) seed a few failure_events + run the REAL Weibull
 *      estimator rulEstimatorService.estimateRulForMachine/persistRulEstimate, and
 *      trigger the REAL twin fidelity sweep twinFidelityService.sweepTwinFidelity.
 *
 * HONEST — no fabrication:
 *   • Real images + a real ONNX model → real embeddings. When an image can't be
 *     decoded / the model is absent, the row is SKIPPED (never a fake vector).
 *   • The current 14,730 product_inspections have NO image files on disk and are NOT
 *     referenced by measurement_results.imageUrl (0) or inspection_packages (0). The
 *     on-disk images (AOI packages + uploads/inspections/**) are orphaned from a prior
 *     database — their machine/product/serial do not exist in the current DB. This
 *     script embeds the REAL images that DO exist and reports the linkage gap plainly.
 *   • Seeded failure_events are clearly SIM-labelled (source='manual', reason carries
 *     "SIM"). Nothing else is invented.
 *
 * Idempotent + bounded: embeddings dedupe by (imageUrl, modelCode); the bank rebuild
 * clears its scope first; the dataset/head get a fresh version each run.
 *
 * USAGE
 *   npm run ai:backfill                 # full run (real images on disk)
 *   npm run ai:backfill -- --quick      # small smoke: 3 AOI packages, no legacy imgs
 *   npm run ai:backfill -- --no-legacy  # only the labelled AOI packages
 *   npm run ai:backfill -- --legacy 300 # cap legacy inspection-dir images at 300
 *   npm run ai:backfill -- --no-step4   # skip the optional RUL/twin step
 *
 * ENV (optional overrides)
 *   AI_BACKFILL_DATABASE_URL   full-access DB URL (default aoi:aoi@127.0.0.1:5434/aoi_management).
 *   AOI_MAX_PACKAGES           cap AOI packages processed (default: all).
 *   LEGACY_INSPECTION_SAMPLE   cap legacy inspection-dir images (default 600; 0 = none).
 *
 * NO server restart, NO flag flips (R1 already set them), NO code changes.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, "..", "..");
/** repo-relative path → file:// URL href (required for ESM dynamic import on Windows). */
const imp = (rel) => pathToFileURL(path.join(PROJECT_ROOT, rel)).href;

// ─── args ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const argVal = (f, d) => { const i = args.indexOf(f); return i !== -1 && args[i + 1] ? args[i + 1] : d; };
const QUICK = has("--quick");
const NO_LEGACY = has("--no-legacy");
const NO_STEP4 = has("--no-step4");

// ─── env MUST be set BEFORE importing any server module (they read env at import) ──
// Full-access role for writes (the .env DATABASE_URL is the append-only WORM role).
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    process.env.AI_BACKFILL_DATABASE_URL || "postgresql://aoi:aoi@127.0.0.1:5434/aoi_management";
}
// The real images live under the repo's uploads/ (the server's LOCAL_STORAGE_DIR=/uploads
// points at an empty D:\uploads). Point the embedder at the real files.
if (!process.env.LOCAL_STORAGE_DIR || process.env.LOCAL_STORAGE_DIR === "/uploads") {
  process.env.LOCAL_STORAGE_DIR = path.join(PROJECT_ROOT, "uploads");
}
// Activate the feature store (train==serve contract) so collecting training pairs
// also warms ml_feature_cache. RUL Weibull path on for the optional step-4 estimate.
process.env.FEATURE_STORE_ENABLED = process.env.FEATURE_STORE_ENABLED ?? "true";
process.env.RUL_WEIBULL_ENABLED = process.env.RUL_WEIBULL_ENABLED ?? "true";
// Embedding runs on CPU here (ENABLE_CUDA unset) → no VRAM contention with the
// resident server embedder (task constraint). Do not force CUDA.
delete process.env.ENABLE_CUDA;

// Load the rest of .env WITHOUT overriding what we already set (GGUF paths, flags…).
function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const idx = t.indexOf("=");
    if (idx === -1) continue;
    const k = t.slice(0, idx).trim();
    let v = t.slice(idx + 1).trim();
    const hash = v.indexOf(" #");
    if (hash !== -1) v = v.slice(0, hash).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadEnvFile(path.join(PROJECT_ROOT, ".env"));
// Re-assert the full-access URL in case .env pre-set nothing but something else did.
process.env.DATABASE_URL =
  process.env.AI_BACKFILL_DATABASE_URL || process.env.DATABASE_URL || "postgresql://aoi:aoi@127.0.0.1:5434/aoi_management";

const DINOV2_MODEL_PATH = path.resolve(
  process.env.AI_DINOV2_MODEL_PATH || process.env.DINOV2_MODEL_PATH || path.join(PROJECT_ROOT, "models", "dinov2.onnx"),
);
const MODEL_CODE = "dinov2-small";
const EMBED_DIM = 384;
const AOI_MAX_PACKAGES = QUICK ? 3 : Number(process.env.AOI_MAX_PACKAGES ?? 0); // 0 = all
const LEGACY_SAMPLE = QUICK || NO_LEGACY ? 0 : Number(argVal("--legacy", process.env.LEGACY_INSPECTION_SAMPLE ?? 600));

const line = "══════════════════════════════════════════════════════════════";
const log = (...a) => console.log(...a);

// ─── dynamic imports (AFTER env is set) ──────────────────────────────────────
const postgres = (await import("postgres")).default;
const JSZip = (await import("jszip")).default;
const { sql } = await import("drizzle-orm");

const { getDb } = await import(imp("server/db/connection.ts"));
const { createAiModel, getAiModelByCode, updateAiModel } = await import(imp("server/db/ai.ts"));
const { extractEmbedding, storeEmbedding, parseVectorLiteral } = await import(imp("server/services/aiImageEmbedding.ts"));
const { buildBankFromVectors } = await import(imp("server/services/aiAnomalyDetection.ts"));
const { snapshotEmbeddingDataset, trainAndRegisterHead } = await import(imp("server/services/ai/embeddingHead.ts"));
const { promoteStage } = await import(imp("server/services/ai/modelStagePipeline.ts"));

// A dedicated client for our own bookkeeping (counts / OK-vector read / seeds).
const sqlc = postgres(process.env.DATABASE_URL, { connect_timeout: 30, max: 3 });

// ─── helpers ─────────────────────────────────────────────────────────────────
async function count(table) {
  try { const r = await sqlc.unsafe(`SELECT count(*)::int c FROM ${table}`); return r[0].c; }
  catch (e) { return `ERR(${e.message.split("\n")[0]})`; }
}
async function snapshotCounts() {
  const tables = [
    "ai_image_embeddings", "ai_anomaly_memory_bank", "ai_anomaly_profiles", "ai_models",
    "model_versions", "ai_embedding_datasets", "ml_feature_cache", "ml_inference_audit",
    "predictive_alerts", "rul_estimates", "failure_events", "twin_trust",
  ];
  const out = {};
  for (const t of tables) out[t] = await count(t);
  return out;
}
function printCounts(title, c) {
  log(`\n${title}`);
  for (const [k, v] of Object.entries(c)) log(`  ${k.padEnd(26)} = ${v}`);
}
function walkFiles(dir, exts) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (exts.some((x) => e.name.toLowerCase().endsWith(x))) out.push(p);
    }
  }
  return out;
}

// ─── run ──────────────────────────────────────────────────────────────────────
log(line);
log("  doc-48 R2 — SYNAPSE AI/ML data-layer backfill (REAL services)");
log(line);
log(`  DB:            ${process.env.DATABASE_URL.replace(/:(.*?)@/, ":****@")}`);
log(`  DINOv2 model:  ${DINOV2_MODEL_PATH}  present=${fs.existsSync(DINOV2_MODEL_PATH)}`);
log(`  uploads root:  ${process.env.LOCAL_STORAGE_DIR}`);
log(`  mode:          ${QUICK ? "QUICK " : ""}legacySample=${LEGACY_SAMPLE} maxPkgs=${AOI_MAX_PACKAGES || "all"} step4=${!NO_STEP4}`);

const db = await getDb();
if (!db) { console.error("FATAL: getDb() returned null — check DATABASE_URL."); process.exit(1); }

const before = await snapshotCounts();
printCounts("BEFORE counts:", before);

const summary = { embeddedAoi: 0, skippedAoi: 0, embeddedLegacy: 0, skippedLegacy: 0, okLabel: 0, ngLabel: 0 };

// ── PHASE 1 — register DINOv2 embedding model (ACTIVE) ─────────────────────────
log(`\n${line}\n  PHASE 1 — register DINOv2 embedding model (ai_models)\n${line}`);
let modelId = null;
try {
  if (!fs.existsSync(DINOV2_MODEL_PATH)) {
    throw new Error(`DINOv2 ONNX not found at ${DINOV2_MODEL_PATH}; cannot produce real embeddings. Aborting (no fabrication).`);
  }
  const fileSize = fs.statSync(DINOV2_MODEL_PATH).size;
  const modelRow = {
    code: MODEL_CODE,
    name: "DINOv2 Small (visual embedding)",
    description: "DINOv2-small ONNX — CLS-token visual embedding (backfill: image search / PatchCore anomaly / DL head).",
    modelType: "embedding",
    format: "ONNX",
    filePath: DINOV2_MODEL_PATH,
    fileSize,
    inputShape: [1, 3, 224, 224],
    labels: [],
    preprocessConfig: {
      resize: { width: 224, height: 224 },
      colorSpace: "RGB",
      channelFirst: true,
      normalize: { mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225] },
    },
    status: "ACTIVE",
    metadata: { embeddingDim: EMBED_DIM, pooling: "cls", registeredBy: "ai:backfill" },
  };
  const existing = await getAiModelByCode(MODEL_CODE);
  if (existing) {
    await updateAiModel(existing.id, modelRow);
    modelId = existing.id;
    log(`  UPDATED existing ai_models row (code=${MODEL_CODE}) → id=${modelId} status=ACTIVE`);
  } else {
    const created = await createAiModel(modelRow);
    modelId = created.id;
    log(`  INSERTED ai_models row (code=${MODEL_CODE}) → id=${modelId} status=ACTIVE`);
  }
} catch (e) {
  console.error("  PHASE 1 FAILED:", e.message);
  await sqlc.end(); process.exit(1);
}

// ── PHASE 2 — embed REAL inspection images via the real embedding service ──────
log(`\n${line}\n  PHASE 2 — embed real inspection images (extractEmbedding + storeEmbedding)\n${line}`);

// Idempotency: existing imageUrls for this modelCode.
const existingUrls = new Set();
try {
  const rows = await sqlc`SELECT "imageUrl" FROM ai_image_embeddings WHERE "modelCode"=${MODEL_CODE} AND "imageUrl" IS NOT NULL`;
  for (const r of rows) existingUrls.add(r.imageUrl);
  if (existingUrls.size) log(`  (idempotent) ${existingUrls.size} image(s) already embedded for ${MODEL_CODE} — will skip.`);
} catch { /* table may be empty */ }

// 2a) AOI packages — real images WITH real per-MP OK/NG labels (meta.json).
const aoiRoot = path.join(process.env.LOCAL_STORAGE_DIR, "aoi");
let zips = walkFiles(aoiRoot, [".zip"]).sort();
if (AOI_MAX_PACKAGES > 0) zips = zips.slice(0, AOI_MAX_PACKAGES);
log(`\n  [2a] AOI packages: ${zips.length} zip(s) under ${aoiRoot}`);
const t2a = Date.now();
for (let z = 0; z < zips.length; z++) {
  const zipPath = zips[z];
  let meta, zip;
  try {
    zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
    const metaFile = zip.file("meta.json");
    if (!metaFile) { log(`  SKIP ${path.basename(zipPath)}: no meta.json`); continue; }
    meta = JSON.parse(await metaFile.async("string"));
  } catch (e) { log(`  SKIP ${path.basename(zipPath)}: ${e.message}`); continue; }

  const pkgId = meta.inspectionId || path.basename(zipPath, ".zip");
  const measurements = Array.isArray(meta.measurements) ? meta.measurements : [];
  for (const mp of measurements) {
    if (!mp.fileName) { summary.skippedAoi++; continue; }
    const imageUrl = `/api/aoi/image/${encodeURIComponent(pkgId)}/${encodeURIComponent(mp.fileName)}`;
    if (existingUrls.has(imageUrl)) { summary.skippedAoi++; continue; }
    // ★★★ I-3 (review lượt 8, đóng nốt vòng 9) — MỘT ĐƯỜNG DẪN DUY NHẤT.
    // Fallback `|| zip.file(mp.fileName)` ở đây là CỬA THỨ HAI để tìm CÙNG một
    // ảnh: đường ghi (`commit`, bất biến 2) chỉ chấp nhận `images/<fileName>`,
    // nên đường ĐỌC rộng hơn đường GHI là mở lại đúng lớp lỗi BG-87 đã đóng ở
    // ba chỗ khác. Đây là chỗ thứ NĂM — census `aoiZipMotDuongDanCensus.test.ts`
    // mù nó theo CẤU TẠO (chỉ soi `server/**`, chỉ `.ts`) cho tới vòng 9.
    // Thất bại nay NÓI RA thay vì tự cứu im lặng.
    const f = zip.file(`images/${mp.fileName}`);
    if (!f) {
      log(`  SKIP ảnh ${pkgId}/${mp.fileName}: không có images/${mp.fileName} trong ZIP (đường dẫn ảnh DUY NHẤT)`);
      summary.skippedAoi++;
      continue;
    }
    try {
      const buf = Buffer.from(await f.async("uint8array"));
      const emb = await extractEmbedding(modelId, buf); // REAL DINOv2 ONNX inference
      const label = String(mp.result || "").toUpperCase() === "NG" ? "NG" : String(mp.result || "").toUpperCase() === "OK" ? "OK" : null;
      await storeEmbedding({
        imageUrl,
        embedding: emb.embedding,
        dim: emb.dim,
        modelCode: emb.modelCode, // = dinov2-small
        label: label ?? undefined,
        defectType: label === "NG" ? "NG" : undefined,
        metadata: {
          source: "ai:backfill/aoi-package",
          packageId: pkgId,
          machineCode: meta.machineCode ?? null,
          productModel: meta.productModel ?? null,
          serialNumber: meta.serialNumber ?? null,
          pointCode: mp.pointCode ?? mp.name ?? null,
          measuredValue: mp.measuredValue ?? null,
          unit: mp.unit ?? null,
          boardOverallResult: meta.overallResult ?? null,
          note: "orphaned-from-prior-db: machineCode/productModel not in current DB (embedded with real per-MP label)",
        },
      });
      existingUrls.add(imageUrl);
      summary.embeddedAoi++;
      if (label === "OK") summary.okLabel++; else if (label === "NG") summary.ngLabel++;
    } catch (e) {
      summary.skippedAoi++;
      if (summary.skippedAoi <= 5) log(`  SKIP ${pkgId}/${mp.fileName}: ${e.message.split("\n")[0]}`);
    }
  }
  log(`  pkg ${z + 1}/${zips.length} ${pkgId} (${meta.overallResult}) → embedded so far ok=${summary.embeddedAoi} skip=${summary.skippedAoi}`);
}
log(`  [2a] done: embedded=${summary.embeddedAoi} (OK=${summary.okLabel} NG=${summary.ngLabel}) skipped=${summary.skippedAoi} in ${((Date.now() - t2a) / 1000).toFixed(1)}s`);

// 2b) Legacy inspection-dir images — real images, ORPHANED (no label/scope). Optional.
if (LEGACY_SAMPLE > 0) {
  const inspRoot = path.join(process.env.LOCAL_STORAGE_DIR, "inspections");
  let files = walkFiles(inspRoot, [".jpg", ".jpeg", ".png"]);
  // Prefer larger files (real photos over tiny placeholders) and bound the batch.
  files = files
    .map((p) => { try { return { p, size: fs.statSync(p).size }; } catch { return { p, size: 0 }; } })
    .filter((x) => x.size > 2048)
    .sort((a, b) => b.size - a.size)
    .slice(0, LEGACY_SAMPLE)
    .map((x) => x.p);
  log(`\n  [2b] legacy inspection-dir images: embedding up to ${files.length} (real, unlabelled — orphaned from prior DB)`);
  const t2b = Date.now();
  for (let i = 0; i < files.length; i++) {
    const fp = files[i];
    const rel = "/uploads/" + path.relative(process.env.LOCAL_STORAGE_DIR, fp).split(path.sep).join("/");
    if (existingUrls.has(rel)) { summary.skippedLegacy++; continue; }
    try {
      const buf = fs.readFileSync(fp);
      const emb = await extractEmbedding(modelId, buf);
      await storeEmbedding({
        imageUrl: rel,
        embedding: emb.embedding,
        dim: emb.dim,
        modelCode: emb.modelCode,
        metadata: { source: "ai:backfill/legacy-inspection-dir", note: "orphaned-from-prior-db: no machine/product/label linkage in current DB" },
      });
      existingUrls.add(rel);
      summary.embeddedLegacy++;
    } catch (e) {
      summary.skippedLegacy++;
      if (summary.skippedLegacy <= 5) log(`  SKIP ${rel}: ${e.message.split("\n")[0]}`);
    }
    if ((i + 1) % 100 === 0) log(`  [2b] ${i + 1}/${files.length} (ok=${summary.embeddedLegacy} skip=${summary.skippedLegacy})`);
  }
  log(`  [2b] done: embedded=${summary.embeddedLegacy} skipped=${summary.skippedLegacy} in ${((Date.now() - t2b) / 1000).toFixed(1)}s`);
} else {
  log(`\n  [2b] legacy inspection-dir images: skipped (LEGACY_SAMPLE=0)`);
}

// ── PHASE 3 — build PatchCore anomaly memory bank from OK vectors ──────────────
log(`\n${line}\n  PHASE 3 — build anomaly memory bank from OK embeddings (buildBankFromVectors)\n${line}`);
let bankResult = null;
try {
  const okRows = await sqlc`
    SELECT "embedding" FROM ai_image_embeddings
    WHERE "modelCode"=${MODEL_CODE} AND label='OK' AND "embedding" IS NOT NULL`;
  const vectors = [];
  for (const r of okRows) {
    const v = parseVectorLiteral(r.embedding);
    if (v.length === EMBED_DIM) vectors.push({ vector: v, imageUrl: null });
  }
  log(`  OK-labelled ${MODEL_CODE} vectors available: ${vectors.length}`);
  if (vectors.length >= 2) {
    // Scope key matches the ecosystem's stored-embedding bank naming so runtime
    // scoreFromVector / the auto-rebuild scheduler resolve THIS bank.
    bankResult = await buildBankFromVectors({
      vectors,
      scope: { productModelId: null, machineId: null, modelCode: `anomaly:onnx:${MODEL_CODE}` },
      source: "onnx",
      degraded: false,
      bootstrap: vectors.length < 10,
    });
    log(`  bank built: bankSize=${bankResult.bankSize} rawCount=${bankResult.rawCount} ` +
        `threshold=${bankResult.threshold.toFixed(6)} k=${bankResult.k} ` +
        `p99=${bankResult.distStats.p99.toFixed(6)}${vectors.length < 10 ? " [BOOTSTRAP]" : ""}`);
  } else {
    log("  SKIP: fewer than 2 OK vectors — cannot build a memory bank.");
  }
} catch (e) {
  console.error("  PHASE 3 FAILED:", e.message);
}

// ── PHASE 4 — snapshot dataset + train & register a defect-classifier head ─────
log(`\n${line}\n  PHASE 4 — train + register defect head (snapshotEmbeddingDataset + trainAndRegisterHead)\n${line}`);
let headResult = null;
try {
  // Resolve an actor for the stage ledger (any admin/user; falls back to 0).
  let actor = 0;
  try { const u = await sqlc`SELECT id FROM users ORDER BY id LIMIT 1`; if (u[0]) actor = u[0].id; } catch { /* ok */ }

  const dataset = await snapshotEmbeddingDataset({
    modelCode: MODEL_CODE,
    name: `aoi-defect-head-backfill-${new Date().toISOString().slice(0, 10)}`,
    description: "Backfill: DINOv2 384-d embeddings of AOI package images, labelled OK/NG from package meta.json.",
    createdBy: actor || undefined,
  });
  const snap = dataset.snapshot;
  log(`  dataset: id=${dataset.id} samples=${snap.sampleCount} classes=[${snap.classLabels.join(", ")}] ` +
      `dist=${JSON.stringify(snap.labelDistribution)} dim=${snap.inputDim} dropped=${JSON.stringify(snap.dropped)}`);

  if (snap.classLabels.length >= 2 && snap.sampleCount >= 8) {
    // Re-runnable: pick a non-colliding version (1.0.0, then 1.0.1, …) for this head code.
    const HEAD_CODE = "aoi-defect-head-dinov2";
    let version = "1.0.0";
    try {
      const vrows = await sqlc`
        SELECT v.version FROM model_versions v JOIN ai_models m ON m.id = v."modelId"
        WHERE m.code = ${HEAD_CODE}`;
      const taken = new Set(vrows.map((r) => r.version));
      for (let p = 0; taken.has(version); p++) version = `1.0.${p + 1}`;
    } catch { /* fresh model — 1.0.0 */ }
    headResult = await trainAndRegisterHead(dataset, {
      code: HEAD_CODE,
      name: "AOI Defect Head (DINOv2 384-d logreg)",
      version,
      autoContext: true, // create the version as READY (not auto-activated) — then stage it explicitly
      createdBy: actor || undefined,
    });
    log(`  trained head: modelId=${headResult.modelId} versionId=${headResult.versionId} ` +
        `train/val/test=${headResult.trainCount}/${headResult.valCount}/${headResult.testCount}`);
    log(`  val metrics:  acc=${headResult.valMetrics.accuracy.toFixed(4)} f1=${headResult.valMetrics.f1Score.toFixed(4)}`);
    log(`  test metrics: acc=${headResult.testMetrics.accuracy.toFixed(4)} f1=${headResult.testMetrics.f1Score.toFixed(4)}`);
    log(`  quality gate: pass=${headResult.gate.pass} (${headResult.gate.reason ?? headResult.gate.status ?? ""})  activated=${headResult.activated}`);
    log(`  artifact:     ${headResult.artifactPath}`);

    if (headResult.versionId != null) {
      const promo = await promoteStage(headResult.versionId, "staging", { actor, reason: "ai:backfill first head registration" });
      log(`  stage:        ${promo.fromStage ?? "null"} → ${promo.toStage} (ok=${promo.ok}${promo.code ? " code=" + promo.code : ""})`);
    }
  } else {
    log(`  SKIP training: need ≥2 classes and ≥8 samples (have ${snap.classLabels.length} classes, ${snap.sampleCount} samples).`);
  }
} catch (e) {
  console.error("  PHASE 4 FAILED:", e.message);
  if (process.env.AI_BACKFILL_DEBUG) console.error(e.stack);
}

// ── PHASE 5 — (optional) RUL Weibull via SIM failure_events + twin sweep ───────
if (!NO_STEP4) {
  log(`\n${line}\n  PHASE 5 — (optional) RUL (SIM failure_events → Weibull) + twin fidelity sweep\n${line}`);
  try {
    const { estimateRulForMachine, persistRulEstimate } = await import(imp("server/services/ai/rulEstimatorService.ts"));

    // Seed a few SIM-labelled failure_events for one machine so the forward store
    // feeds the survival fit (idempotent: only when failure_events is empty).
    const feCount = await count("failure_events");
    const targetMachine = (await sqlc`SELECT id, "machineType" mt FROM machines WHERE "isActive"=true ORDER BY id LIMIT 1`)[0];
    if (feCount === 0 && targetMachine) {
      const now = Date.now();
      const gapsH = [720, 690, 810, 700, 760, 730]; // ~monthly inter-arrival, hours
      let ts = now - gapsH.reduce((a, b) => a + b, 0) * 3600_000;
      let prev = null;
      for (let i = 0; i < gapsH.length; i++) {
        ts += gapsH[i] * 3600_000;
        const occurredAt = new Date(ts);
        const ttf = prev ? (ts - prev) / 3600_000 : null;
        await sqlc`
          INSERT INTO failure_events (machine_id, machine_type, component_key, failure_mode, failure_mode_reason,
            occurred_at, ttf_hours, censored, source, features, confidence)
          VALUES (${targetMachine.id}, ${targetMachine.mt}, 'machine', 'unknown',
            'SIM-seeded backfill (no vibration sensor) — doc48 R2', ${occurredAt}, ${ttf}, false, 'manual',
            ${sqlc.json({ sim: true, seededBy: "ai:backfill" })}, ${null})`;
        prev = ts;
      }
      log(`  seeded ${gapsH.length} SIM failure_events for machine#${targetMachine.id} (${targetMachine.mt}).`);
    } else {
      log(`  failure_events already has ${feCount} row(s) — not seeding.`);
    }

    // Real Weibull estimate over the (now-fed) failure history → persist.
    if (targetMachine) {
      const est = await estimateRulForMachine(targetMachine.id, { componentKey: "machine" });
      if (est) {
        await persistRulEstimate(est);
        log(`  RUL machine#${targetMachine.id}: method=${est.method} rulHours=${est.rulHours == null ? "null" : est.rulHours.toFixed(1)} ` +
            `shape=${est.shape?.toFixed?.(2) ?? "-"} scale=${est.scale?.toFixed?.(1) ?? "-"} failures=${est.failures} conf=${est.confidence.toFixed(3)}`);
        log(`    note: ${est.note}`);
      } else {
        log(`  RUL: estimateRulForMachine returned null (flag off?).`);
      }
    }
  } catch (e) {
    console.error("  RUL step failed:", e.message);
  }

  // Twin fidelity sweep — honest: needs line_balance_metrics + a simulatable line.
  try {
    const { sweepTwinFidelity } = await import(imp("server/services/twin/twinFidelityService.ts"));
    const res = await sweepTwinFidelity();
    log(`  twin fidelity sweep: checked=${res.checked} skipped=${res.skipped}` +
        (res.checked === 0 ? " (skipped — no measured line_balance_metrics to compare against; twin has no reality feed yet)" : ""));
  } catch (e) {
    console.error("  twin sweep failed:", e.message);
  }
}

// ── SUMMARY ─────────────────────────────────────────────────────────────────
const after = await snapshotCounts();
log(`\n${line}\n  RESULT — row counts BEFORE → AFTER\n${line}`);
for (const k of Object.keys(before)) {
  const b = before[k], a = after[k];
  const delta = typeof a === "number" && typeof b === "number" ? (a - b >= 0 ? `+${a - b}` : `${a - b}`) : "";
  const mark = typeof a === "number" && typeof b === "number" && a > b ? "  ✎" : "";
  log(`  ${k.padEnd(26)} ${String(b).padStart(6)} → ${String(a).padStart(6)}  ${delta}${mark}`);
}
log(`\n  embeddings: AOI ok=${summary.embeddedAoi} (OK=${summary.okLabel}/NG=${summary.ngLabel}) skip=${summary.skippedAoi} · ` +
    `legacy ok=${summary.embeddedLegacy} skip=${summary.skippedLegacy}`);
if (bankResult) log(`  anomaly bank: bankSize=${bankResult.bankSize} threshold=${bankResult.threshold.toFixed(6)}`);
if (headResult) log(`  head model:   modelId=${headResult.modelId} versionId=${headResult.versionId} testAcc=${headResult.testMetrics.accuracy.toFixed(4)}`);
log(line);

await sqlc.end();
process.exit(0);
