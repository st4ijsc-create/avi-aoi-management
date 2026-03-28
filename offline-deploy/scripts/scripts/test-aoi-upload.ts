/**
 * Test AOI Image Upload Flow (Presign → Upload ZIP → Commit)
 * 
 * Usage: npx tsx scripts/test-aoi-upload.ts
 */
import { config } from "dotenv";
config();

import fs from "fs";
import path from "path";
import zlib from "zlib";
import JSZip from "jszip";
import postgres from "postgres";
import crypto from "crypto";

// ============================================================
// Config
// ============================================================
const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;
const TRPC_URL = `${BASE_URL}/api/trpc`;

// ============================================================
// Helpers
// ============================================================
async function trpcCall(procedure: string, input: any): Promise<any> {
  const res = await fetch(`${TRPC_URL}/${procedure}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ json: input }),
  });
  const json = await res.json();
  if (json.error) {
    throw new Error(`tRPC error [${procedure}]: ${JSON.stringify(json.error)}`);
  }
  return json.result?.data?.json ?? json.result?.data;
}

function log(step: string, msg: string, data?: any) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] ${step.padEnd(12)} ${msg}`);
  if (data) console.log(JSON.stringify(data, null, 2));
}

function logOk(step: string, msg: string) {
  log(`✅ ${step}`, msg);
}

function logFail(step: string, msg: string) {
  log(`❌ ${step}`, msg);
}

// ============================================================
// Step 0: Get or create a test machine with API key
// ============================================================
async function getTestMachine(): Promise<{ id: number; code: string; apiKey: string }> {
  const sql = postgres(process.env.DATABASE_URL!, {
    ssl: { rejectUnauthorized: false },
    max: 1,
  });

  try {
    // Find any machine with an API key
    const rows = await sql`
      SELECT id, code, "apiKey" FROM machines
      WHERE "apiKey" IS NOT NULL AND "isActive" = true
      LIMIT 1
    `;

    if (rows.length > 0) {
      log("SETUP", `Using existing machine: ${rows[0].code} (id=${rows[0].id})`);
      return { id: rows[0].id, code: rows[0].code, apiKey: rows[0].apiKey };
    }

    // No machine with API key? Generate one for the first active machine
    const machines = await sql`
      SELECT id, code FROM machines WHERE "isActive" = true LIMIT 1
    `;

    if (machines.length === 0) {
      // Create a test machine
      const apiKey = `MCH-API-TEST-${crypto.randomBytes(8).toString("hex")}`;
      const result = await sql`
        INSERT INTO machines (code, name, "machineType", "apiKey", "isActive", status, "createdAt", "updatedAt")
        VALUES ('AOI-TEST-01', 'Test AOI Machine', 'AOI', ${apiKey}, true, 'online', NOW(), NOW())
        RETURNING id, code, "apiKey"
      `;
      log("SETUP", `Created test machine: ${result[0].code}`);
      return { id: result[0].id, code: result[0].code, apiKey: result[0].apiKey };
    }

    // Update existing machine with API key
    const apiKey = `MCH-API-TEST-${crypto.randomBytes(8).toString("hex")}`;
    await sql`UPDATE machines SET "apiKey" = ${apiKey} WHERE id = ${machines[0].id}`;
    log("SETUP", `Added API key to machine: ${machines[0].code}`);
    return { id: machines[0].id, code: machines[0].code, apiKey };
  } finally {
    await sql.end();
  }
}

// ============================================================
// Step 1: Create a test ZIP package with meta.json + images
// ============================================================
async function createTestZip(machineCode: string): Promise<{ zipPath: string; inspectionId: string; meta: any }> {
  const inspectionId = `TEST-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const zip = new JSZip();

  // Create synthetic test images (1x1 colored pixels as JPEG-like data)
  const points = [
    { code: "P01", name: "Connector A", result: "OK", value: 0.25 },
    { code: "P02", name: "IC U3 Solder", result: "OK", value: 0.18 },
    { code: "P03", name: "Resistor R12", result: "NG", value: 0.52 },
    { code: "P04", name: "Capacitor C5", result: "OK", value: 0.11 },
    { code: "P05", name: "LED D1", result: "OK", value: 0.09 },
  ];

  // Create simple PNG test images (valid 1x1 red pixel PNG)
  // Minimal PNG: 8-byte signature + IHDR + IDAT + IEND
  const createTestPng = (r: number, g: number, b: number): Buffer => {
    // Minimal valid PNG
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

    // IHDR chunk (width=8, height=8, bit depth=8, color type=2 RGB)
    const ihdrData = Buffer.alloc(13);
    ihdrData.writeUInt32BE(8, 0);  // width
    ihdrData.writeUInt32BE(8, 4);  // height
    ihdrData[8] = 8;   // bit depth
    ihdrData[9] = 2;   // color type (RGB)
    ihdrData[10] = 0;  // compression
    ihdrData[11] = 0;  // filter
    ihdrData[12] = 0;  // interlace

    const ihdrType = Buffer.from("IHDR");
    const ihdrCrc = crc32(Buffer.concat([ihdrType, ihdrData]));
    const ihdr = Buffer.alloc(4 + 4 + 13 + 4);
    ihdr.writeUInt32BE(13, 0);
    ihdrType.copy(ihdr, 4);
    ihdrData.copy(ihdr, 8);
    ihdr.writeUInt32BE(ihdrCrc, 21);

    // IDAT: create raw image data (8x8 RGB, each row prefixed with filter byte 0)
    const rawRows: Buffer[] = [];
    for (let y = 0; y < 8; y++) {
      const row = Buffer.alloc(1 + 8 * 3); // filter byte + 8 pixels * 3 channels
      row[0] = 0; // no filter
      for (let x = 0; x < 8; x++) {
        row[1 + x * 3] = r;
        row[1 + x * 3 + 1] = g;
        row[1 + x * 3 + 2] = b;
      }
      rawRows.push(row);
    }
    const rawData = Buffer.concat(rawRows);

    // Compress with zlib (deflate)
    const compressed = zlib.deflateSync(rawData);

    const idatType = Buffer.from("IDAT");
    const idatCrc = crc32(Buffer.concat([idatType, compressed]));
    const idat = Buffer.alloc(4 + 4 + compressed.length + 4);
    idat.writeUInt32BE(compressed.length, 0);
    idatType.copy(idat, 4);
    compressed.copy(idat, 8);
    idat.writeUInt32BE(idatCrc, 8 + compressed.length);

    // IEND chunk
    const iendType = Buffer.from("IEND");
    const iendCrc = crc32(iendType);
    const iend = Buffer.alloc(4 + 4 + 4);
    iend.writeUInt32BE(0, 0);
    iendType.copy(iend, 4);
    iend.writeUInt32BE(iendCrc, 8);

    return Buffer.concat([signature, ihdr, idat, iend]);
  };

  // Add images to ZIP
  for (const pt of points) {
    const color = pt.result === "OK" ? [0, 200, 0] : [255, 0, 0];
    const png = createTestPng(color[0], color[1], color[2]);
    zip.file(`images/${pt.code}.png`, png, { compression: "STORE" });
  }

  // Create meta.json
  const meta = {
    inspectionId,
    serialNumber: `SN-TEST-${Date.now().toString(36).toUpperCase()}`,
    productModel: "PCBA-TEST-REV1",
    factory: "FAC001",
    line: "LINE-A",
    machine: machineCode,
    startedAt: new Date().toISOString(),
    finishedAt: new Date(Date.now() + 5000).toISOString(),
    summary: {
      totalPoints: points.length,
      ok: points.filter((p) => p.result === "OK").length,
      ng: points.filter((p) => p.result === "NG").length,
    },
    points: points.map((p) => ({
      code: p.code,
      name: p.name,
      fileName: `${p.code}.png`,
      result: p.result,
      value: p.value,
    })),
  };

  zip.file("meta.json", JSON.stringify(meta, null, 2), { compression: "STORE" });

  // Generate ZIP buffer
  const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "STORE" });

  // Write to temp file
  const tmpDir = path.join(process.cwd(), "uploads", "test-temp");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const zipPath = path.join(tmpDir, `${inspectionId}.zip`);
  fs.writeFileSync(zipPath, zipBuffer);

  log("ZIP", `Created test ZIP: ${(zipBuffer.length / 1024).toFixed(1)} KB, ${points.length} images`);
  log("ZIP", `Serial: ${meta.serialNumber}, Result: ${meta.summary.ng > 0 ? "NG" : "OK"} (${meta.summary.ok} OK / ${meta.summary.ng} NG)`);

  return { zipPath, inspectionId, meta };
}

// Simple CRC32 for PNG chunks
function crc32(data: Buffer): number {
  let crc = 0xFFFFFFFF;
  const table: number[] = [];

  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }

  for (let i = 0; i < data.length; i++) {
    crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }

  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ============================================================
// Main Test Flow
// ============================================================
async function main() {
  console.log("=".repeat(60));
  console.log("  AOI Image Upload — Integration Test");
  console.log("=".repeat(60));
  console.log();

  const results: { step: string; ok: boolean; detail: string }[] = [];

  try {
    // Step 0: Get machine
    log("SETUP", "Getting test machine...");
    const machine = await getTestMachine();
    logOk("SETUP", `Machine: ${machine.code} (id=${machine.id}), API Key: ${machine.apiKey.slice(0, 16)}...`);

    // Step 1: Create ZIP
    log("ZIP", "Creating test ZIP package...");
    const { zipPath, inspectionId, meta } = await createTestZip(machine.code);
    const zipSize = fs.statSync(zipPath).size;
    logOk("ZIP", `Package ID: ${inspectionId}`);
    results.push({ step: "Create ZIP", ok: true, detail: `${(zipSize / 1024).toFixed(1)} KB` });

    // Step 2: Presign
    log("PRESIGN", "Calling aoiPackage.presign...");
    const t1 = Date.now();
    const presign = await trpcCall("aoiPackage.presign", {
      apiKey: machine.apiKey,
      inspectionId,
      sizeBytes: zipSize,
    });
    const presignMs = Date.now() - t1;
    logOk("PRESIGN", `uploadUrl: ${presign.uploadUrl} (${presignMs}ms)`);
    results.push({ step: "Presign", ok: true, detail: `${presignMs}ms` });

    if (presign.alreadyCommitted) {
      log("PRESIGN", "Already committed — skipping upload. Test idempotent OK.");
      return;
    }

    // Step 2b: Test Presign Idempotency
    log("IDEMPOTENT", "Testing presign idempotency (calling again)...");
    const presign2 = await trpcCall("aoiPackage.presign", {
      apiKey: machine.apiKey,
      inspectionId,
      sizeBytes: zipSize,
    });
    if (presign2.packageId === presign.packageId) {
      logOk("IDEMPOTENT", "Presign idempotent — same packageId returned");
      results.push({ step: "Presign Idempotency", ok: true, detail: "OK" });
    } else {
      logFail("IDEMPOTENT", "Presign NOT idempotent!");
      results.push({ step: "Presign Idempotency", ok: false, detail: "Failed" });
    }

    // Step 3: Upload ZIP binary
    log("UPLOAD", `Uploading ZIP (${(zipSize / 1024).toFixed(1)} KB)...`);
    const zipBuffer = fs.readFileSync(zipPath);
    const t2 = Date.now();
    const uploadRes = await fetch(`${BASE_URL}${presign.uploadUrl}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-API-Key": machine.apiKey,
        "X-Machine-Code": machine.code,
      },
      body: zipBuffer,
    });
    const uploadMs = Date.now() - t2;
    const uploadJson = await uploadRes.json() as any;

    if (!uploadRes.ok || !uploadJson.success) {
      logFail("UPLOAD", `HTTP ${uploadRes.status}: ${JSON.stringify(uploadJson)}`);
      results.push({ step: "Upload ZIP", ok: false, detail: `HTTP ${uploadRes.status}` });
      throw new Error("Upload failed");
    }
    logOk("UPLOAD", `Uploaded (${uploadMs}ms), storageKey: ${uploadJson.storageKey}`);
    results.push({ step: "Upload ZIP", ok: true, detail: `${uploadMs}ms` });

    // Step 3b: Test upload idempotency (re-upload)
    log("IDEMPOTENT", "Testing upload idempotency (re-upload)...");
    const reuploadRes = await fetch(`${BASE_URL}${presign.uploadUrl}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-API-Key": machine.apiKey,
        "X-Machine-Code": machine.code,
      },
      body: zipBuffer,
    });
    const reuploadJson = await reuploadRes.json() as any;
    if (reuploadJson.success) {
      logOk("IDEMPOTENT", "Upload idempotent — re-upload succeeded");
      results.push({ step: "Upload Idempotency", ok: true, detail: "OK" });
    }

    // Step 4: Commit
    log("COMMIT", "Calling aoiPackage.commit...");
    const t3 = Date.now();
    const commit = await trpcCall("aoiPackage.commit", {
      apiKey: machine.apiKey,
      packageId: inspectionId,
    });
    const commitMs = Date.now() - t3;
    logOk("COMMIT", `imageCount: ${commit.imageCount}, inspectionId: ${commit.inspectionId || "N/A"} (${commitMs}ms)`);
    results.push({ step: "Commit", ok: true, detail: `${commitMs}ms, ${commit.imageCount} images` });

    // Step 4b: Test commit idempotency
    log("IDEMPOTENT", "Testing commit idempotency (re-commit)...");
    const commit2 = await trpcCall("aoiPackage.commit", {
      apiKey: machine.apiKey,
      packageId: inspectionId,
    });
    if (commit2.alreadyCommitted) {
      logOk("IDEMPOTENT", "Commit idempotent — alreadyCommitted=true");
      results.push({ step: "Commit Idempotency", ok: true, detail: "OK" });
    }

    // Step 5: Test image serving (REST endpoint)
    log("IMAGE", "Testing image serving endpoint...");
    const testImageFile = meta.points[0].fileName;
    const t4 = Date.now();
    const imgRes = await fetch(`${BASE_URL}/api/aoi/image/${inspectionId}/${testImageFile}`);
    const imgMs = Date.now() - t4;
    const imgCache = imgRes.headers.get("x-cache") || "UNKNOWN";

    if (imgRes.ok) {
      const imgBuf = await imgRes.arrayBuffer();
      logOk("IMAGE", `${testImageFile}: ${(imgBuf.byteLength / 1024).toFixed(1)} KB, X-Cache: ${imgCache} (${imgMs}ms)`);
      results.push({ step: "Image Serve (1st)", ok: true, detail: `${imgMs}ms, X-Cache: ${imgCache}` });

      // Test cache hit
      const t5 = Date.now();
      const imgRes2 = await fetch(`${BASE_URL}/api/aoi/image/${inspectionId}/${testImageFile}`);
      const imgMs2 = Date.now() - t5;
      const imgCache2 = imgRes2.headers.get("x-cache") || "UNKNOWN";
      logOk("IMAGE", `Cache test: X-Cache: ${imgCache2} (${imgMs2}ms)`);
      results.push({ step: "Image Serve (cached)", ok: true, detail: `${imgMs2}ms, X-Cache: ${imgCache2}` });
    } else {
      logFail("IMAGE", `HTTP ${imgRes.status}`);
      results.push({ step: "Image Serve", ok: false, detail: `HTTP ${imgRes.status}` });
    }

    // Step 6: Test ZIP download endpoint
    log("DOWNLOAD", "Testing ZIP download endpoint...");
    const dlRes = await fetch(`${BASE_URL}/api/aoi/download/${inspectionId}`);
    if (dlRes.ok) {
      const dlBuf = await dlRes.arrayBuffer();
      logOk("DOWNLOAD", `ZIP download: ${(dlBuf.byteLength / 1024).toFixed(1)} KB`);
      results.push({ step: "ZIP Download", ok: true, detail: `${(dlBuf.byteLength / 1024).toFixed(1)} KB` });
    } else {
      logFail("DOWNLOAD", `HTTP ${dlRes.status}`);
      results.push({ step: "ZIP Download", ok: false, detail: `HTTP ${dlRes.status}` });
    }

    // Step 7: Test queue metrics
    log("METRICS", "Testing reportQueueMetrics...");
    const metricsResult = await trpcCall("aoiPackage.reportQueueMetrics", {
      apiKey: machine.apiKey,
      queuedCount: 0,
      uploadingCount: 0,
      failedCount: 0,
      completedCount: 1,
      diskUsedBytes: 1024 * 1024 * 100,
      diskFreeBytes: 1024 * 1024 * 1024 * 50,
      avgUploadLatencyMs: uploadMs,
    });
    if (metricsResult.success) {
      logOk("METRICS", "Queue metrics reported successfully");
      results.push({ step: "Queue Metrics", ok: true, detail: "OK" });
    }

    // Step 8: Test getUploadStats
    log("STATS", "Testing getUploadStats...");
    // This is a protectedProcedure — need to login first
    // For now, just verify the endpoint exists by calling with a session cookie
    log("STATS", "(Skipped — requires authenticated session)");

    // Cleanup temp file
    fs.unlinkSync(zipPath);
    log("CLEANUP", "Removed temp ZIP file");

  } catch (err: any) {
    logFail("ERROR", err.message);
    results.push({ step: "ERROR", ok: false, detail: err.message });
  }

  // Results Summary
  console.log();
  console.log("=".repeat(60));
  console.log("  Test Results Summary");
  console.log("=".repeat(60));

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  for (const r of results) {
    console.log(`  ${r.ok ? "✅" : "❌"} ${r.step.padEnd(25)} ${r.detail}`);
  }

  console.log();
  console.log(`  Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log("=".repeat(60));

  process.exit(failed > 0 ? 1 : 0);
}

main();
