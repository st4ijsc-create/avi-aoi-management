/**
 * Test: AOI Package Upload (Presign → Upload ZIP → Commit)
 *
 * Full 3-step flow that AOI machines use to upload inspection packages:
 *   1. POST /api/aoi/presign        — get upload URL + packageId
 *   2. PUT  /api/aoi/upload/:id      — send binary ZIP with images + meta.json
 *   3. POST /api/aoi/commit          — finalize, parse meta.json, create inspection
 *
 * Also tests:
 *   4. GET  /api/aoi/image/:id/:file — retrieve image from ZIP
 *   5. GET  /api/aoi/download/:id    — download original ZIP
 *   6. Error cases
 *
 * Machine: AOI-TEST-FRESH-001 (apiKey: mach_test_1771425478998)
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const JSZip = require('jszip');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BASE = 'http://localhost:3001';
const API_KEY = 'mach_test_1771425478998';

// ── Helper: Generate a compressed PNG image ──
function generatePNG(width = 32, height = 32, color = { r: 255, g: 0, b: 0 }) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  ihdr[9] = 2;  ihdr[10] = 0;  ihdr[11] = 0;  ihdr[12] = 0;

  const rawRows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    row[0] = 0;
    for (let x = 0; x < width; x++) {
      const o = 1 + x * 3;
      // gradient pattern
      row[o]     = Math.min(255, color.r + Math.floor(x * 3));
      row[o + 1] = Math.min(255, color.g + Math.floor(y * 3));
      row[o + 2] = Math.min(255, color.b + Math.floor((x + y) * 2));
    }
    rawRows.push(row);
  }
  const compressed = zlib.deflateSync(Buffer.concat(rawRows), { level: 9 });
  return Buffer.concat([signature, makeChunk('IHDR', ihdr), makeChunk('IDAT', compressed), makeChunk('IEND', Buffer.alloc(0))]);
}

function makeChunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const combined = Buffer.concat([t, data]);
  const c = crc32(combined);
  const cb = Buffer.alloc(4); cb.writeUInt32BE(c >>> 0, 0);
  return Buffer.concat([len, combined, cb]);
}

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xEDB88320 : 0);
  }
  return ~c;
}

// ── Helper: Build AOI inspection ZIP package ──
async function buildAoiZip(meta, images) {
  const zip = new JSZip();

  // Add meta.json
  zip.file('meta.json', JSON.stringify(meta, null, 2));

  // Add images/ folder
  const imgFolder = zip.folder('images');
  for (const { name, buffer } of images) {
    imgFolder.file(name, buffer);
  }

  // Generate compressed ZIP
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
}

async function run() {
  console.log('='.repeat(70));
  console.log('  TEST: AOI PACKAGE UPLOAD (Presign → Upload ZIP → Commit)');
  console.log('='.repeat(70));

  const inspectionId = `AOI-INS-${Date.now()}`;

  // ── Generate test images ──
  const img1 = generatePNG(64, 64, { r: 200, g: 50, b: 30 });    // Red-ish (NG)
  const img2 = generatePNG(64, 64, { r: 30, g: 200, b: 50 });    // Green-ish (OK)
  const img3 = generatePNG(128, 128, { r: 50, g: 30, b: 200 });   // Blue-ish (NG)

  // ── Build meta.json ──
  const meta = {
    machineCode: 'AOI-TEST-FRESH-001',
    inspectionId,
    serialNumber: `BOARD-PKG-${Date.now()}`,
    productModel: 'PCB-SMT-001',
    batchNumber: 'BATCH-2026-02-18',
    overallResult: 'NG',
    startedAt: new Date(Date.now() - 5000).toISOString(),
    finishedAt: new Date().toISOString(),
    cycleTime: 4.2,
    companyCode: 'CORP001',
    factoryCode: 'FAC001',
    lineCode: 'LINE-01',
    measurements: [
      {
        pointCode: 'R101',
        name: 'Resistor R101 Position',
        fileName: 'R101_check.png',
        result: 'OK',
        measuredValue: 0.15,
        unit: 'mm',
        remark: 'Within tolerance'
      },
      {
        pointCode: 'C201',
        name: 'Capacitor C201 Solder',
        fileName: 'C201_solder.png',
        result: 'NG',
        measuredValue: 0.62,
        unit: 'mm',
        remark: 'Solder bridge detected'
      },
      {
        pointCode: 'U301',
        name: 'IC U301 Presence',
        fileName: 'U301_missing.png',
        result: 'NG',
        measuredValue: 'MISSING',
        remark: 'Component absent'
      }
    ],
    summary: {
      totalPoints: 3,
      ok: 1,
      ng: 2,
      ntf: 0
    }
  };

  // ── Build ZIP ──
  const zipBuffer = await buildAoiZip(meta, [
    { name: 'R101_check.png', buffer: img1 },
    { name: 'C201_solder.png', buffer: img2 },
    { name: 'U301_missing.png', buffer: img3 },
  ]);
  const sha256 = crypto.createHash('sha256').update(zipBuffer).digest('hex');

  console.log(`\n  Package ID:  ${inspectionId}`);
  console.log(`  ZIP size:    ${(zipBuffer.length / 1024).toFixed(1)} KB`);
  console.log(`  SHA-256:     ${sha256.substring(0, 16)}...`);
  console.log(`  Images:      3 (R101_check.png, C201_solder.png, U301_missing.png)`);

  // ════════════════════════════════════════════════════════════
  // STEP 1: Presign
  // ════════════════════════════════════════════════════════════
  console.log('\n┌─ STEP 1: POST /api/aoi/presign ─────────────────────────────┐');
  const t1 = performance.now();
  const presignRes = await fetch(`${BASE}/api/aoi/presign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
    body: JSON.stringify({
      inspectionId,
      sizeBytes: zipBuffer.length,
      sha256,
    })
  });
  const presignData = await presignRes.json();
  console.log(`  Status: ${presignRes.status} (${(performance.now() - t1).toFixed(0)}ms)`);
  console.log(`  Response:`, JSON.stringify(presignData, null, 4));

  if (!presignData.success) {
    console.error('  ❌ Presign failed — aborting');
    return;
  }

  const packageId = presignData.packageId;
  const uploadUrl = presignData.uploadUrl;
  console.log(`  ✅ Package ID: ${packageId}`);
  console.log(`  ✅ Upload URL: ${uploadUrl}`);
  console.log('└──────────────────────────────────────────────────────────────┘');

  // ════════════════════════════════════════════════════════════
  // STEP 2: Upload ZIP (binary body)
  // ════════════════════════════════════════════════════════════
  console.log('\n┌─ STEP 2: PUT /api/aoi/upload/:packageId (binary ZIP) ───────┐');
  const fullUploadUrl = `${BASE}${uploadUrl}`;
  console.log(`  URL: ${fullUploadUrl}`);
  console.log(`  Body: ${zipBuffer.length} bytes (application/zip)`);

  const t2 = performance.now();
  const uploadRes = await fetch(fullUploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/zip',
      'X-API-Key': API_KEY,
      'Content-Length': String(zipBuffer.length),
    },
    body: zipBuffer,
  });
  const uploadData = await uploadRes.json();
  const uploadMs = (performance.now() - t2).toFixed(0);
  console.log(`  Status: ${uploadRes.status} (${uploadMs}ms)`);
  console.log(`  Response:`, JSON.stringify(uploadData, null, 4));

  if (!uploadData.success) {
    console.error('  ❌ Upload failed — aborting');
    return;
  }
  console.log(`  ✅ ZIP uploaded: ${uploadData.sizeBytes} bytes`);
  console.log(`  ✅ Storage key: ${uploadData.storageKey}`);

  // Verify file on disk
  const diskPath = path.join(process.cwd(), 'uploads', uploadData.storageKey);
  if (fs.existsSync(diskPath)) {
    const stat = fs.statSync(diskPath);
    console.log(`  📁 File on disk: ${stat.size} bytes at ${diskPath}`);
  } else {
    console.log(`  ⚠️  File not found on disk: ${diskPath}`);
  }
  console.log('└──────────────────────────────────────────────────────────────┘');

  // ════════════════════════════════════════════════════════════
  // STEP 3: Commit (parse meta.json, create inspection)
  // ════════════════════════════════════════════════════════════
  console.log('\n┌─ STEP 3: POST /api/aoi/commit ──────────────────────────────┐');
  const t3 = performance.now();
  const commitRes = await fetch(`${BASE}/api/aoi/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
    body: JSON.stringify({
      packageId,
      sizeBytes: zipBuffer.length,
      sha256,
    })
  });
  const commitData = await commitRes.json();
  console.log(`  Status: ${commitRes.status} (${(performance.now() - t3).toFixed(0)}ms)`);
  console.log(`  Response:`, JSON.stringify(commitData, null, 4));

  if (commitData.success) {
    console.log(`  ✅ Package committed`);
    if (commitData.inspectionId) console.log(`  ✅ Inspection ID: ${commitData.inspectionId}`);
    if (commitData.imageCount !== undefined) console.log(`  ✅ Images parsed: ${commitData.imageCount}`);
    if (commitData.overallResult) console.log(`  ✅ Result: ${commitData.overallResult}`);
  } else {
    console.error('  ❌ Commit failed');
  }
  console.log('└──────────────────────────────────────────────────────────────┘');

  // ════════════════════════════════════════════════════════════
  // STEP 4: Retrieve image from package
  // ════════════════════════════════════════════════════════════
  console.log('\n┌─ STEP 4: GET /api/aoi/image/:packageId/:fileName ───────────┐');
  const imageFiles = ['R101_check.png', 'C201_solder.png', 'U301_missing.png'];
  for (const imgFile of imageFiles) {
    const imgUrl = `${BASE}/api/aoi/image/${packageId}/${imgFile}`;
    try {
      const imgRes = await fetch(imgUrl);
      const contentType = imgRes.headers.get('content-type');
      const contentLen = imgRes.headers.get('content-length');
      const body = await imgRes.arrayBuffer();
      console.log(`  GET /api/aoi/image/${packageId}/${imgFile}`);
      console.log(`    → ${imgRes.status} | type: ${contentType} | size: ${body.byteLength} bytes`);
    } catch (e) {
      console.log(`  ❌ ${imgFile}: ${e.message}`);
    }
  }
  console.log('└──────────────────────────────────────────────────────────────┘');

  // ════════════════════════════════════════════════════════════
  // STEP 5: Download original ZIP
  // ════════════════════════════════════════════════════════════
  console.log('\n┌─ STEP 5: GET /api/aoi/download/:packageId ──────────────────┐');
  try {
    const dlRes = await fetch(`${BASE}/api/aoi/download/${packageId}`);
    const contentType = dlRes.headers.get('content-type');
    const body = await dlRes.arrayBuffer();
    console.log(`  Status: ${dlRes.status}`);
    console.log(`  Content-Type: ${contentType}`);
    console.log(`  Downloaded: ${(body.byteLength / 1024).toFixed(1)} KB`);

    if (body.byteLength > 0) {
      // Verify it's a valid ZIP by checking magic bytes
      const buf = Buffer.from(body);
      const isZip = buf[0] === 0x50 && buf[1] === 0x4B;
      console.log(`  Valid ZIP: ${isZip ? '✅ Yes' : '❌ No'}`);

      // Verify contents
      const downloadedZip = await JSZip.loadAsync(buf);
      const files = Object.keys(downloadedZip.files);
      console.log(`  ZIP contents: ${files.join(', ')}`);

      // Verify SHA-256 matches
      const dlHash = crypto.createHash('sha256').update(buf).digest('hex');
      const hashMatch = dlHash === sha256;
      console.log(`  SHA-256 match: ${hashMatch ? '✅ Yes' : '❌ No'} (${dlHash.substring(0, 16)}...)`);
    }
  } catch (e) {
    console.log(`  ❌ Download failed: ${e.message}`);
  }
  console.log('└──────────────────────────────────────────────────────────────┘');

  // ════════════════════════════════════════════════════════════
  // STEP 6: Idempotency — call presign + commit again
  // ════════════════════════════════════════════════════════════
  console.log('\n┌─ STEP 6: Idempotency test ───────────────────────────────────┐');
  
  // Presign again with same inspectionId
  const presign2Res = await fetch(`${BASE}/api/aoi/presign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
    body: JSON.stringify({ inspectionId, sizeBytes: zipBuffer.length })
  });
  const presign2Data = await presign2Res.json();
  console.log(`  Presign (retry): ${presign2Res.status} — alreadyCommitted: ${presign2Data.alreadyCommitted}`);

  // Commit again
  const commit2Res = await fetch(`${BASE}/api/aoi/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
    body: JSON.stringify({ packageId })
  });
  const commit2Data = await commit2Res.json();
  console.log(`  Commit (retry):  ${commit2Res.status} — alreadyCommitted: ${commit2Data.alreadyCommitted}`);
  console.log('└──────────────────────────────────────────────────────────────┘');

  // ════════════════════════════════════════════════════════════
  // STEP 7: Error cases
  // ════════════════════════════════════════════════════════════
  console.log('\n┌─ STEP 7: Error cases ────────────────────────────────────────┐');

  // 7a: Upload without presign
  const err1 = await fetch(`${BASE}/api/aoi/upload/NONEXISTENT-PKG`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/zip', 'X-API-Key': API_KEY },
    body: Buffer.from('test'),
  });
  console.log(`  7a) Upload without presign → ${err1.status}: ${(await err1.json()).message}`);

  // 7b: Presign with invalid API key
  const err2 = await fetch(`${BASE}/api/aoi/presign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': 'invalid-key' },
    body: JSON.stringify({ inspectionId: 'test', sizeBytes: 100 })
  });
  console.log(`  7b) Presign invalid key   → ${err2.status}: ${(await err2.json()).message}`);

  // 7c: Upload empty body
  const presign3 = await fetch(`${BASE}/api/aoi/presign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
    body: JSON.stringify({ inspectionId: `EMPTY-${Date.now()}`, sizeBytes: 0 })
  });
  const presign3Data = await presign3.json();
  if (presign3Data.uploadUrl) {
    const err3 = await fetch(`${BASE}${presign3Data.uploadUrl}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/zip', 'X-API-Key': API_KEY },
      body: Buffer.alloc(0),
    });
    console.log(`  7c) Upload empty body     → ${err3.status}: ${(await err3.json()).message}`);
  }

  // 7d: Download non-existent package
  const err4 = await fetch(`${BASE}/api/aoi/download/NONEXISTENT-PKG-999`);
  console.log(`  7d) Download non-existent → ${err4.status}`);

  console.log('└──────────────────────────────────────────────────────────────┘');

  // ════════════════════════════════════════════════════════════
  // STEP 8: Large package test (256x256 images x 10)
  // ════════════════════════════════════════════════════════════
  console.log('\n┌─ STEP 8: Large package (10 images × 256x256) ────────────────┐');

  const largeInspId = `AOI-LARGE-${Date.now()}`;
  const largeMeasurements = [];
  const largeImages = [];

  for (let i = 0; i < 10; i++) {
    const code = `PT${String(i + 1).padStart(3, '0')}`;
    const fileName = `${code}_inspection.png`;
    const img = generatePNG(256, 256, {
      r: Math.floor(Math.random() * 200) + 30,
      g: Math.floor(Math.random() * 200) + 30,
      b: Math.floor(Math.random() * 200) + 30,
    });
    largeImages.push({ name: fileName, buffer: img });
    largeMeasurements.push({
      pointCode: code,
      name: `Test Point ${i + 1}`,
      fileName,
      result: Math.random() > 0.3 ? 'OK' : 'NG',
      measuredValue: +(Math.random() * 2).toFixed(3),
      unit: 'mm',
    });
  }

  const largeMeta = {
    inspectionId: largeInspId,
    serialNumber: `BOARD-LARGE-${Date.now()}`,
    productModel: 'PCB-SMT-001',
    overallResult: largeMeasurements.some(m => m.result === 'NG') ? 'NG' : 'OK',
    startedAt: new Date(Date.now() - 8000).toISOString(),
    finishedAt: new Date().toISOString(),
    cycleTime: 7.5,
    factoryCode: 'FAC001',
    lineCode: 'LINE-01',
    measurements: largeMeasurements,
    summary: {
      totalPoints: largeMeasurements.length,
      ok: largeMeasurements.filter(m => m.result === 'OK').length,
      ng: largeMeasurements.filter(m => m.result === 'NG').length,
    }
  };

  const largeZip = await buildAoiZip(largeMeta, largeImages);
  console.log(`  ZIP size: ${(largeZip.length / 1024).toFixed(1)} KB (${largeImages.length} images)`);

  // Presign
  const lp = await fetch(`${BASE}/api/aoi/presign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
    body: JSON.stringify({ inspectionId: largeInspId, sizeBytes: largeZip.length })
  });
  const lpData = await lp.json();
  console.log(`  Presign: ${lp.status} — packageId: ${lpData.packageId}`);

  // Upload
  const t8 = performance.now();
  const lu = await fetch(`${BASE}${lpData.uploadUrl}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/zip', 'X-API-Key': API_KEY },
    body: largeZip,
  });
  const luData = await lu.json();
  const uploadTime = (performance.now() - t8).toFixed(0);
  console.log(`  Upload:  ${lu.status} (${uploadTime}ms) — ${luData.sizeBytes} bytes`);

  // Commit
  const t8c = performance.now();
  const lc = await fetch(`${BASE}/api/aoi/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
    body: JSON.stringify({ packageId: lpData.packageId })
  });
  const lcData = await lc.json();
  const commitTime = (performance.now() - t8c).toFixed(0);
  console.log(`  Commit:  ${lc.status} (${commitTime}ms)`);
  console.log(`  Response:`, JSON.stringify(lcData, null, 4));
  console.log('└──────────────────────────────────────────────────────────────┘');

  console.log('\n' + '='.repeat(70));
  console.log('  ALL AOI PACKAGE TESTS COMPLETE');
  console.log('='.repeat(70));
}

run().catch(e => console.error('FATAL:', e));
