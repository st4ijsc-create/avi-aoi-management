/**
 * Test: Submit Inspection (no images) → AOI Package Upload (with images) → Verify Mapping
 *
 * Demonstrates the full workflow:
 *   1. POST /api/machine/submit-inspection — submit measurement results WITHOUT images
 *   2. POST /api/aoi/presign              — get upload URL for AOI image package
 *   3. PUT  /api/aoi/upload/:packageId    — upload ZIP with real images + meta.json
 *   4. POST /api/aoi/commit               — parse meta.json, link images to inspection
 *   5. Verify: GET /api/aoi/image/:pkg/:file — ensure images are viewable
 *
 * Uses real sample images from: D:\1.ST4I\FOxconn\DATA\Sample 1
 *
 * Machine: requires a machine with valid apiKey in database
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const JSZip = require('jszip');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ── Configuration ──
const BASE = 'http://localhost:3000';
const API_KEY = 'avi_7c66acf0af866158745a98674a3b7c73e2e1533a228907c8'; // MCH-FAC-HN-SMT-LA-ST3 (Máy AOI)

// Sample images folder
const SAMPLE_IMAGES_DIR = 'D:\\1.ST4I\\FOxconn\\DATA\\Sample 1';

// Generate unique serial number for this test (ensures both steps link to same inspection)
const SERIAL_NUMBER = `TEST-BOARD-${Date.now()}`;
const INSPECTION_ID = `AOI-MAP-${Date.now()}`;

// ════════════════════════════════════════════════════════════════════════════
// JSON Template #1: submitInspection (no images)
// ════════════════════════════════════════════════════════════════════════════
const submitInspectionPayload = {
  apiKey: API_KEY,
  serialNumber: SERIAL_NUMBER,
  productModel: 'PCB-SMT-001',
  batchNumber: 'BATCH-2026-01',
  overallResult: 'NG',
  cycleTime: 3.8,
  inspectionTime: new Date().toISOString(),

  // Enterprise hierarchy
  companyCode: 'FOXCONN',
  factoryCode: 'FAC-SZ-001',
  workshopCode: 'WS-A3',
  lineCode: 'LINE-05',
  stageCode: 'SMT-AOI',

  // Production context
  productionOrderCode: 'PO-2026-00152',
  operatorId: 'OP-0088',

  // Measurement data (no images)
  measurements: [
    {
      pointCode: 'MP-001',
      measuredValue: 0.12,
      result: 'OK',
      remark: 'Resistor R101 - Position check OK'
    },
    {
      pointCode: 'MP-002',
      measuredValue: 0.08,
      result: 'OK',
      remark: 'Resistor R102 - Solder joint OK'
    },
    {
      pointCode: 'MP-003',
      measuredValue: 0.55,
      result: 'NG',
      remark: 'Capacitor C201 - Solder bridge detected'
    },
    {
      pointCode: 'MP-004',
      measuredValue: 0.03,
      result: 'OK',
      remark: 'Capacitor C202 - Alignment OK'
    },
    {
      pointCode: 'MP-005',
      measuredValue: 'MISSING',
      result: 'NG',
      remark: 'IC U301 - Component absent'
    },
    {
      pointCode: 'MP-006',
      measuredValue: 0.22,
      result: 'OK',
      remark: 'IC U302 - Pin alignment OK'
    },
    {
      pointCode: 'MP-007',
      measuredValue: 0.41,
      result: 'NG',
      remark: 'Connector J1 - Lifted lead detected'
    },
    {
      pointCode: 'MP-008',
      measuredValue: 0.09,
      result: 'OK',
      remark: 'Connector J2 - Solder quality OK'
    },
    {
      pointCode: 'MP-009',
      measuredValue: 0.15,
      result: 'OK',
      remark: 'Diode D1 - Polarity correct'
    },
    {
      pointCode: 'MP-010',
      measuredValue: 0.33,
      result: 'NG',
      remark: 'Diode D2 - Tombstone detected'
    },
    {
      pointCode: 'MP-011',
      measuredValue: 0.05,
      result: 'OK',
      remark: 'Transistor Q1 - Position OK'
    },
    {
      pointCode: 'MP-012',
      measuredValue: 0.07,
      result: 'OK',
      remark: 'Crystal Y1 - Placement OK'
    }
  ]
};

// ════════════════════════════════════════════════════════════════════════════
// JSON Template #2: meta.json (inside AOI ZIP package)
// ════════════════════════════════════════════════════════════════════════════
function buildMetaJson(imageFiles) {
  return {
    machineCode: 'AOI-TEST-FRESH-001',
    inspectionId: INSPECTION_ID,
    serialNumber: SERIAL_NUMBER, // Same serial → links to the inspection from Step 1
    productModel: 'PCB-SMT-001',
    batchNumber: 'BATCH-2026-01',
    overallResult: 'NG',
    startedAt: new Date(Date.now() - 5000).toISOString(),
    finishedAt: new Date().toISOString(),
    cycleTime: 3.8,

    // Enterprise hierarchy (same as submitInspection)
    companyCode: 'FOXCONN',
    factoryCode: 'FAC-SZ-001',
    workshopCode: 'WS-A3',
    lineCode: 'LINE-05',
    stageCode: 'SMT-AOI',

    // Production context
    productionOrderCode: 'PO-2026-00152',
    operatorId: 'OP-0088',

    // Each measurement maps to an image file in the ZIP
    measurements: imageFiles.map((file, idx) => ({
      pointCode: `MP-${String(idx + 1).padStart(3, '0')}`,
      name: `Measurement Point ${idx + 1}`,
      fileName: file,
      result: submitInspectionPayload.measurements[idx]?.result || 'OK',
      measuredValue: submitInspectionPayload.measurements[idx]?.measuredValue ?? 0,
      unit: 'mm',
      remark: submitInspectionPayload.measurements[idx]?.remark || `Check point ${idx + 1}`
    })),

    summary: {
      totalPoints: imageFiles.length,
      ok: submitInspectionPayload.measurements.filter(m => m.result === 'OK').length,
      ng: submitInspectionPayload.measurements.filter(m => m.result === 'NG').length,
      ntf: 0
    }
  };
}

// ── Build ZIP from real images ──
async function buildAoiZip(meta, imagesDir) {
  const zip = new JSZip();
  zip.file('meta.json', JSON.stringify(meta, null, 2));

  const imgFolder = zip.folder('images');
  for (const m of meta.measurements) {
    const imgPath = path.join(imagesDir, m.fileName);
    if (fs.existsSync(imgPath)) {
      const buf = fs.readFileSync(imgPath);
      imgFolder.file(m.fileName, buf);
      console.log(`  📷 Added: ${m.fileName} (${(buf.length / 1024).toFixed(1)} KB)`);
    } else {
      console.warn(`  ⚠️  Image not found: ${imgPath}`);
    }
  }

  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });
}

// ════════════════════════════════════════════════════════════════════════════
async function run() {
  console.log('═'.repeat(72));
  console.log('  TEST: Submit Inspection → AOI Package Upload → Verify Mapping');
  console.log('═'.repeat(72));
  console.log(`  Serial Number: ${SERIAL_NUMBER}`);
  console.log(`  Inspection ID: ${INSPECTION_ID}`);
  console.log(`  Images source: ${SAMPLE_IMAGES_DIR}`);

  // Check sample images exist
  if (!fs.existsSync(SAMPLE_IMAGES_DIR)) {
    console.error(`\n❌ Sample images directory not found: ${SAMPLE_IMAGES_DIR}`);
    return;
  }
  const availableImages = fs.readdirSync(SAMPLE_IMAGES_DIR)
    .filter(f => /\.(jpg|jpeg|png|bmp)$/i.test(f))
    .sort();
  console.log(`  Available images: ${availableImages.length} files`);
  if (availableImages.length === 0) {
    console.error('❌ No image files found');
    return;
  }

  // ══════════════════════════════════════════════════════════════
  // STEP 1: Submit Inspection (no images) via REST API
  // ══════════════════════════════════════════════════════════════
  console.log('\n┌─ STEP 1: POST /api/machine/submit-inspection (no images) ──┐');
  console.log('  Payload preview:');
  console.log(`    serialNumber:  ${submitInspectionPayload.serialNumber}`);
  console.log(`    productModel:  ${submitInspectionPayload.productModel}`);
  console.log(`    overallResult: ${submitInspectionPayload.overallResult}`);
  console.log(`    measurements:  ${submitInspectionPayload.measurements.length} points`);
  console.log(`    hierarchy:     ${submitInspectionPayload.companyCode} > ${submitInspectionPayload.factoryCode} > ${submitInspectionPayload.workshopCode} > ${submitInspectionPayload.lineCode} > ${submitInspectionPayload.stageCode}`);

  const t1 = performance.now();
  const submitRes = await fetch(`${BASE}/api/machine/submit-inspection`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY,
    },
    body: JSON.stringify(submitInspectionPayload),
  });
  const submitData = await submitRes.json();
  console.log(`  Status: ${submitRes.status} (${(performance.now() - t1).toFixed(0)}ms)`);
  console.log(`  Response:`, JSON.stringify(submitData, null, 4));

  if (!submitData.success && submitRes.status >= 400) {
    console.error('  ❌ Submit inspection failed — aborting');
    return;
  }
  console.log(`  ✅ Inspection created (DB ID: ${submitData.inspectionId || 'N/A'})`);
  console.log('└────────────────────────────────────────────────────────────────┘');

  // ══════════════════════════════════════════════════════════════
  // STEP 2: Build AOI ZIP Package with real images
  // ══════════════════════════════════════════════════════════════
  console.log('\n┌─ STEP 2: Build AOI ZIP package with real images ────────────┐');
  const meta = buildMetaJson(availableImages);
  console.log(`  meta.json measurements: ${meta.measurements.length}`);

  const zipBuffer = await buildAoiZip(meta, SAMPLE_IMAGES_DIR);
  const sha256 = crypto.createHash('sha256').update(zipBuffer).digest('hex');

  console.log(`  ZIP size:   ${(zipBuffer.length / 1024).toFixed(1)} KB`);
  console.log(`  SHA-256:    ${sha256.substring(0, 20)}...`);
  console.log('└────────────────────────────────────────────────────────────────┘');

  // ══════════════════════════════════════════════════════════════
  // STEP 3: Presign — get upload URL
  // ══════════════════════════════════════════════════════════════
  console.log('\n┌─ STEP 3: POST /api/aoi/presign ─────────────────────────────┐');
  const t3 = performance.now();
  const presignRes = await fetch(`${BASE}/api/aoi/presign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
    body: JSON.stringify({
      inspectionId: INSPECTION_ID,
      sizeBytes: zipBuffer.length,
      sha256,
    }),
  });
  const presignData = await presignRes.json();
  console.log(`  Status: ${presignRes.status} (${(performance.now() - t3).toFixed(0)}ms)`);
  console.log(`  Response:`, JSON.stringify(presignData, null, 4));

  if (!presignData.success) {
    console.error('  ❌ Presign failed — aborting');
    return;
  }

  const packageId = presignData.packageId;
  const uploadUrl = presignData.uploadUrl;
  console.log(`  ✅ Package ID: ${packageId}`);
  console.log(`  ✅ Upload URL: ${uploadUrl}`);
  console.log('└────────────────────────────────────────────────────────────────┘');

  // ══════════════════════════════════════════════════════════════
  // STEP 4: Upload ZIP (binary PUT)
  // ══════════════════════════════════════════════════════════════
  console.log('\n┌─ STEP 4: PUT /api/aoi/upload/:packageId (binary ZIP) ──────┐');
  const fullUploadUrl = `${BASE}${uploadUrl}`;
  console.log(`  URL:  ${fullUploadUrl}`);
  console.log(`  Body: ${zipBuffer.length} bytes`);

  const t4 = performance.now();
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
  console.log(`  Status: ${uploadRes.status} (${(performance.now() - t4).toFixed(0)}ms)`);
  console.log(`  Response:`, JSON.stringify(uploadData, null, 4));

  if (!uploadData.success) {
    console.error('  ❌ Upload failed — aborting');
    return;
  }
  console.log(`  ✅ ZIP uploaded: ${uploadData.sizeBytes} bytes`);
  console.log('└────────────────────────────────────────────────────────────────┘');

  // ══════════════════════════════════════════════════════════════
  // STEP 5: Commit — parse meta.json, create measurement records with image URLs
  // ══════════════════════════════════════════════════════════════
  console.log('\n┌─ STEP 5: POST /api/aoi/commit ──────────────────────────────┐');
  const t5 = performance.now();
  const commitRes = await fetch(`${BASE}/api/aoi/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
    body: JSON.stringify({
      packageId,
      sizeBytes: zipBuffer.length,
      sha256,
    }),
  });
  const commitData = await commitRes.json();
  console.log(`  Status: ${commitRes.status} (${(performance.now() - t5).toFixed(0)}ms)`);
  console.log(`  Response:`, JSON.stringify(commitData, null, 4));

  if (commitData.success) {
    console.log(`  ✅ Package committed`);
    console.log(`  ✅ Inspection ID: ${commitData.inspectionId || 'linked to existing'}`);
    console.log(`  ✅ Images parsed: ${commitData.imageCount || 'N/A'}`);
    console.log(`  ✅ Created new inspection: ${commitData.createdInspection ?? 'N/A'}`);
  } else {
    console.error('  ❌ Commit failed:', commitData.message);
  }
  console.log('└────────────────────────────────────────────────────────────────┘');

  // ══════════════════════════════════════════════════════════════
  // STEP 6: Verify — retrieve images from AOI package
  // ══════════════════════════════════════════════════════════════
  console.log('\n┌─ STEP 6: Verify image access GET /api/aoi/image/:pkg/:file ┐');
  let okCount = 0;
  let failCount = 0;
  for (const imgFile of availableImages) {
    const imgUrl = `${BASE}/api/aoi/image/${packageId}/${imgFile}`;
    try {
      const imgRes = await fetch(imgUrl);
      const contentType = imgRes.headers.get('content-type') || '';
      const body = await imgRes.arrayBuffer();
      const status = imgRes.status === 200 ? '✅' : '❌';
      if (imgRes.status === 200) okCount++;
      else failCount++;
      console.log(`  ${status} ${imgFile} → ${imgRes.status} | ${contentType} | ${(body.byteLength / 1024).toFixed(1)} KB`);
    } catch (e) {
      failCount++;
      console.log(`  ❌ ${imgFile}: ${e.message}`);
    }
  }
  console.log(`\n  Summary: ${okCount}/${availableImages.length} images accessible`);
  if (failCount > 0) console.log(`  ⚠️  ${failCount} images failed`);
  console.log('└────────────────────────────────────────────────────────────────┘');

  // ══════════════════════════════════════════════════════════════
  // STEP 7: Verify — check inspection has measurement records with image URLs
  // ══════════════════════════════════════════════════════════════
  console.log('\n┌─ STEP 7: Verify inspection data in database ────────────────┐');
  try {
    // Query inspection via REST API or direct DB
    const inspectionListUrl = `${BASE}/api/inspection/${submitData.inspectionId || commitData.inspectionId}/images`;
    const inspRes = await fetch(inspectionListUrl);
    const inspData = await inspRes.json();
    console.log(`  GET ${inspectionListUrl}`);
    console.log(`  Status: ${inspRes.status}`);
    console.log(`  Response:`, JSON.stringify(inspData, null, 4));

    if (inspData.success && inspData.images) {
      console.log(`\n  ✅ ${inspData.images.length} images linked to inspection`);
      for (const img of inspData.images) {
        console.log(`    - ${img.pointCode || img.fileName}: ${img.imageUrl}`);
      }
    }
  } catch (e) {
    console.log(`  ⚠️  Could not verify via API: ${e.message}`);
    console.log(`  → Open browser: ${BASE}/inspection/${submitData.inspectionId || commitData.inspectionId}`);
  }
  console.log('└────────────────────────────────────────────────────────────────┘');

  // ══════════════════════════════════════════════════════════════
  // Summary
  // ══════════════════════════════════════════════════════════════
  console.log('\n═'.repeat(72));
  console.log('  SUMMARY');
  console.log('═'.repeat(72));
  console.log(`  Serial Number:   ${SERIAL_NUMBER}`);
  console.log(`  Inspection DB ID: ${submitData.inspectionId || 'N/A'}`);
  console.log(`  AOI Package ID:  ${packageId}`);
  console.log(`  Images uploaded: ${availableImages.length}`);
  console.log(`  Images viewable: ${okCount}/${availableImages.length}`);
  console.log(`\n  View in browser: ${BASE}/inspection/${submitData.inspectionId || commitData.inspectionId}`);
  console.log(`  Image URL pattern: ${BASE}/api/aoi/image/${packageId}/<filename>`);
  console.log('═'.repeat(72));

  // ══════════════════════════════════════════════════════════════
  // Save JSON templates to files for reference
  // ══════════════════════════════════════════════════════════════
  const templatesDir = path.join(process.cwd(), 'docs', 'examples');
  if (!fs.existsSync(templatesDir)) fs.mkdirSync(templatesDir, { recursive: true });

  // Template 1: submitInspection payload
  const template1 = { ...submitInspectionPayload };
  template1.apiKey = '<YOUR_API_KEY>';
  template1.serialNumber = '<SERIAL_NUMBER>';
  fs.writeFileSync(
    path.join(templatesDir, 'submit-inspection-template.json'),
    JSON.stringify(template1, null, 2),
    'utf-8'
  );
  console.log(`\n  📄 Saved: docs/examples/submit-inspection-template.json`);

  // Template 2: meta.json for AOI package
  const template2 = buildMetaJson(availableImages);
  template2.machineCode = '<MACHINE_CODE>';
  template2.inspectionId = '<INSPECTION_ID>';
  template2.serialNumber = '<SERIAL_NUMBER>';
  fs.writeFileSync(
    path.join(templatesDir, 'aoi-meta-template.json'),
    JSON.stringify(template2, null, 2),
    'utf-8'
  );
  console.log(`  📄 Saved: docs/examples/aoi-meta-template.json`);
}

run().catch(err => {
  console.error('\n❌ Fatal error:', err);
  process.exit(1);
});
