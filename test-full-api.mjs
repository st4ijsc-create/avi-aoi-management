/**
 * Test: Upload Compressed Image via HTTP REST
 * 
 * Tests the full flow: submit NG inspection → upload compressed images (PNG, JPEG)
 * Verifies file storage, response URLs, and file accessibility.
 * 
 * Machine: AOI-TEST-FRESH-001 (apiKey: mach_test_1771425478998)
 */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const BASE = 'http://localhost:3001';
const API_KEY = 'mach_test_1771425478998';

// ── Helper: Generate a valid compressed PNG image (100x100, with pattern) ──
function generateCompressedPNG() {
  // Minimal valid PNG with IDAT containing zlib-compressed data
  // This creates a 4x4 RGB PNG (smallest useful compressed image)
  const width = 4, height = 4;

  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Build raw image data (filter byte + RGB pixels per row)
  const rawRows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    row[0] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const offset = 1 + x * 3;
      // Create a red/blue checkerboard pattern
      if ((x + y) % 2 === 0) {
        row[offset] = 255;     // R
        row[offset + 1] = 0;   // G
        row[offset + 2] = 0;   // B
      } else {
        row[offset] = 0;       // R
        row[offset + 1] = 0;   // G
        row[offset + 2] = 255; // B
      }
    }
    rawRows.push(row);
  }
  const rawData = Buffer.concat(rawRows);

  // Compress with zlib (deflate)
  const zlib = await_import_zlib();
  const compressed = zlib.deflateSync(rawData);

  // IDAT chunk
  const idatData = compressed;

  // Build chunks
  const chunks = [];
  chunks.push(makeChunk('IHDR', ihdr));
  chunks.push(makeChunk('IDAT', idatData));
  chunks.push(makeChunk('IEND', Buffer.alloc(0)));

  return Buffer.concat([signature, ...chunks]);
}

function await_import_zlib() {
  return require('zlib');
}

function makeChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const combined = Buffer.concat([typeBuffer, data]);
  const crc = crc32(combined);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc >>> 0, 0);
  return Buffer.concat([length, combined, crcBuffer]);
}

// CRC32 for PNG chunks
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return ~crc;
}

// ── Helper: Generate a minimal valid JPEG ──
function generateMinimalJPEG() {
  // Create a minimal valid JPEG: SOI + APP0 + DQT + SOF0 + DHT + SOS + EOI
  // This is a 1x1 pixel JPEG (white)
  return Buffer.from([
    0xFF, 0xD8, // SOI
    0xFF, 0xE0, // APP0
    0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xFF, 0xDB, // DQT
    0x00, 0x43, 0x00,
    0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07,
    0x07, 0x07, 0x09, 0x09, 0x08, 0x0A, 0x0C, 0x14,
    0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12, 0x13,
    0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A,
    0x1C, 0x1C, 0x20, 0x24, 0x2E, 0x27, 0x20, 0x22,
    0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29, 0x2C,
    0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27, 0x39,
    0x3D, 0x38, 0x32, 0x3C, 0x2E, 0x33, 0x34, 0x32,
    0xFF, 0xC0, // SOF0 (Baseline DCT)
    0x00, 0x0B, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01,
    0x01, 0x11, 0x00,
    0xFF, 0xC4, // DHT
    0x00, 0x1F, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01,
    0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04,
    0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B,
    0xFF, 0xC4, // DHT (AC table)
    0x00, 0xB5, 0x10, 0x00, 0x02, 0x01, 0x03, 0x03,
    0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00,
    0x00, 0x01, 0x7D, 0x01, 0x02, 0x03, 0x00, 0x04,
    0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13,
    0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81,
    0x91, 0xA1, 0x08, 0x23, 0x42, 0xB1, 0xC1, 0x15,
    0x52, 0xD1, 0xF0, 0x24, 0x33, 0x62, 0x72, 0x82,
    0x09, 0x0A, 0x16, 0x17, 0x18, 0x19, 0x1A, 0x25,
    0x26, 0x27, 0x28, 0x29, 0x2A, 0x34, 0x35, 0x36,
    0x37, 0x38, 0x39, 0x3A, 0x43, 0x44, 0x45, 0x46,
    0x47, 0x48, 0x49, 0x4A, 0x53, 0x54, 0x55, 0x56,
    0x57, 0x58, 0x59, 0x5A, 0x63, 0x64, 0x65, 0x66,
    0x67, 0x68, 0x69, 0x6A, 0x73, 0x74, 0x75, 0x76,
    0x77, 0x78, 0x79, 0x7A, 0x83, 0x84, 0x85, 0x86,
    0x87, 0x88, 0x89, 0x8A, 0x92, 0x93, 0x94, 0x95,
    0x96, 0x97, 0x98, 0x99, 0x9A, 0xA2, 0xA3, 0xA4,
    0xA5, 0xA6, 0xA7, 0xA8, 0xA9, 0xAA, 0xB2, 0xB3,
    0xB4, 0xB5, 0xB6, 0xB7, 0xB8, 0xB9, 0xBA, 0xC2,
    0xC3, 0xC4, 0xC5, 0xC6, 0xC7, 0xC8, 0xC9, 0xCA,
    0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8, 0xD9,
    0xDA, 0xE1, 0xE2, 0xE3, 0xE4, 0xE5, 0xE6, 0xE7,
    0xE8, 0xE9, 0xEA, 0xF1, 0xF2, 0xF3, 0xF4, 0xF5,
    0xF6, 0xF7, 0xF8, 0xF9, 0xFA,
    0xFF, 0xDA, // SOS
    0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00,
    0x7B, 0x94, 0x11, 0x00, // minimal scan data
    0xFF, 0xD9  // EOI
  ]);
}

// ── Helper: Generate a larger realistic compressed image using zlib ──
function generateLargerPNG(width = 64, height = 64) {
  const zlib = require('zlib');
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rawRows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    row[0] = 0; // no filter
    for (let x = 0; x < width; x++) {
      const offset = 1 + x * 3;
      // Create gradient pattern with noise (simulates real AOI inspection image)
      row[offset] = Math.floor(Math.sin(x * 0.1 + y * 0.05) * 127 + 128);       // R
      row[offset + 1] = Math.floor(Math.cos(y * 0.15) * 100 + 128);              // G
      row[offset + 2] = Math.floor(Math.sin(x * 0.2 - y * 0.1) * 80 + 128);     // B
    }
    rawRows.push(row);
  }
  const rawData = Buffer.concat(rawRows);

  // Compress with maximum zlib compression (level 9)
  const compressed = zlib.deflateSync(rawData, { level: 9 });

  const chunks = [];
  chunks.push(makeChunk('IHDR', ihdr));
  chunks.push(makeChunk('IDAT', compressed));
  chunks.push(makeChunk('IEND', Buffer.alloc(0)));

  return { 
    buffer: Buffer.concat([signature, ...chunks]),
    rawSize: rawData.length,
    compressedSize: compressed.length,
  };
}

async function run() {
  console.log('='.repeat(70));
  console.log('  TEST: UPLOAD COMPRESSED IMAGE via HTTP REST');
  console.log('='.repeat(70));

  // ── STEP 1: Submit NG inspection (to get inspectionId for image upload) ──
  console.log('\n┌─ STEP 1: Submit NG inspection ────────────────────────────────┐');
  const ngPayload = {
    serialNumber: `BOARD-IMG-TEST-${Date.now()}`,
    productModel: 'PCB-SMT-001',
    overallResult: 'NG',
    inspectionTime: new Date().toISOString(),
    cycleTime: 2.8,
    measurements: [
      { pointCode: 'R101', measuredValue: 0.14, result: 'OK' },
      { pointCode: 'C201', measuredValue: 0.62, result: 'NG', remark: 'Solder bridge' },
      { pointCode: 'U301', measuredValue: 'MISSING', result: 'NG', remark: 'Component absent' },
    ]
  };

  const ngRes = await fetch(`${BASE}/api/machine/submit-inspection`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
    body: JSON.stringify(ngPayload)
  });
  const ngData = await ngRes.json();
  console.log(`  Status: ${ngRes.status}`);
  console.log(`  Response:`, JSON.stringify(ngData));

  if (!ngData.inspectionId) {
    console.error('❌ Cannot continue — no inspectionId returned');
    return;
  }
  const inspectionId = ngData.inspectionId;
  console.log(`  ✅ Inspection created: ID = ${inspectionId}`);
  console.log('└───────────────────────────────────────────────────────────────┘');

  // ── STEP 2: Upload small compressed PNG (4x4) ──
  console.log('\n┌─ STEP 2: Upload small PNG (4x4 zlib-compressed) ─────────────┐');
  const smallPng = generateCompressedPNG();
  const smallB64 = smallPng.toString('base64');
  console.log(`  Raw PNG size: ${smallPng.length} bytes`);
  console.log(`  Base64 size:  ${smallB64.length} chars`);

  const upload1Res = await fetch(`${BASE}/api/machine/upload-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
    body: JSON.stringify({
      inspectionId,
      pointCode: 'R101',
      imageBase64: smallB64,
      mimeType: 'image/png'
    })
  });
  const upload1Data = await upload1Res.json();
  console.log(`  Status: ${upload1Res.status}`);
  console.log(`  Response:`, JSON.stringify(upload1Data));
  if (upload1Data.imageUrl) {
    console.log(`  ✅ PNG uploaded → ${upload1Data.imageUrl}`);
    // Verify file exists on disk
    const filePath = path.join(process.cwd(), upload1Data.imageUrl);
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      console.log(`  📁 File on disk: ${stat.size} bytes`);
    } else {
      console.log(`  ⚠️ File not found on disk: ${filePath}`);
    }
  }
  console.log('└───────────────────────────────────────────────────────────────┘');

  // ── STEP 3: Upload larger compressed PNG (64x64, max zlib compression) ──
  console.log('\n┌─ STEP 3: Upload larger PNG (64x64 zlib-9 compressed) ────────┐');
  const { buffer: largePng, rawSize, compressedSize } = generateLargerPNG(64, 64);
  const largeB64 = largePng.toString('base64');
  console.log(`  Raw pixel data: ${rawSize} bytes`);
  console.log(`  Zlib compressed: ${compressedSize} bytes (ratio: ${((1 - compressedSize / rawSize) * 100).toFixed(1)}%)`);
  console.log(`  Full PNG size:   ${largePng.length} bytes`);
  console.log(`  Base64 size:     ${largeB64.length} chars`);

  const upload2Res = await fetch(`${BASE}/api/machine/upload-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
    body: JSON.stringify({
      inspectionId,
      pointCode: 'C201',
      imageBase64: largeB64,
      mimeType: 'image/png'
    })
  });
  const upload2Data = await upload2Res.json();
  console.log(`  Status: ${upload2Res.status}`);
  console.log(`  Response:`, JSON.stringify(upload2Data));
  if (upload2Data.imageUrl) {
    console.log(`  ✅ Large PNG uploaded → ${upload2Data.imageUrl}`);
    const filePath = path.join(process.cwd(), upload2Data.imageUrl);
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      console.log(`  📁 File on disk: ${stat.size} bytes`);
    }
  }
  console.log('└───────────────────────────────────────────────────────────────┘');

  // ── STEP 4: Upload JPEG image ──
  console.log('\n┌─ STEP 4: Upload JPEG image ──────────────────────────────────┐');
  const jpegBuf = generateMinimalJPEG();
  const jpegB64 = jpegBuf.toString('base64');
  console.log(`  JPEG size:   ${jpegBuf.length} bytes`);
  console.log(`  Base64 size: ${jpegB64.length} chars`);

  const upload3Res = await fetch(`${BASE}/api/machine/upload-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
    body: JSON.stringify({
      inspectionId,
      pointCode: 'C201',  // same point — should update
      imageBase64: jpegB64,
      mimeType: 'image/jpeg'
    })
  });
  const upload3Data = await upload3Res.json();
  console.log(`  Status: ${upload3Res.status}`);
  console.log(`  Response:`, JSON.stringify(upload3Data));
  if (upload3Data.imageUrl) {
    console.log(`  ✅ JPEG uploaded → ${upload3Data.imageUrl}`);
    const filePath = path.join(process.cwd(), upload3Data.imageUrl);
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      console.log(`  📁 File on disk: ${stat.size} bytes`);
    }
  }
  console.log('└───────────────────────────────────────────────────────────────┘');

  // ── STEP 5: Verify uploaded files are accessible via HTTP ──
  console.log('\n┌─ STEP 5: Verify images accessible via HTTP GET ──────────────┐');
  const imageUrls = [upload1Data.imageUrl, upload2Data.imageUrl, upload3Data.imageUrl].filter(Boolean);
  for (const imgUrl of imageUrls) {
    try {
      const getRes = await fetch(`${BASE}${imgUrl}`);
      const contentType = getRes.headers.get('content-type');
      const contentLen = getRes.headers.get('content-length');
      console.log(`  GET ${imgUrl}`);
      console.log(`    → ${getRes.status} | type: ${contentType} | size: ${contentLen} bytes`);
    } catch (e) {
      console.log(`  ❌ GET ${imgUrl} failed: ${e.message}`);
    }
  }
  console.log('└───────────────────────────────────────────────────────────────┘');

  // ── STEP 6: Test large image upload (simulated 512x512 AOI inspection image) ──
  console.log('\n┌─ STEP 6: Upload simulated AOI image (512x512, ~786KB raw) ───┐');
  const { buffer: aoiPng, rawSize: aoiRaw, compressedSize: aoiComp } = generateLargerPNG(512, 512);
  const aoiB64 = aoiPng.toString('base64');
  console.log(`  Raw pixel data: ${(aoiRaw / 1024).toFixed(1)} KB`);
  console.log(`  Zlib compressed: ${(aoiComp / 1024).toFixed(1)} KB (ratio: ${((1 - aoiComp / aoiRaw) * 100).toFixed(1)}%)`);
  console.log(`  Full PNG size:   ${(aoiPng.length / 1024).toFixed(1)} KB`);
  console.log(`  Base64 payload:  ${(aoiB64.length / 1024).toFixed(1)} KB`);

  // Submit a new quick inspection for this large image  
  const largeNgRes = await fetch(`${BASE}/api/machine/submit-inspection`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
    body: JSON.stringify({
      serialNumber: `BOARD-LARGE-IMG-${Date.now()}`,
      productModel: 'PCB-SMT-001',
      overallResult: 'NG',
      measurements: [
        { pointCode: 'R101', measuredValue: 0.99, result: 'NG', remark: 'Defect detected' }
      ]
    })
  });
  const largeNgData = await largeNgRes.json();
  const largeInspId = largeNgData.inspectionId;
  console.log(`  New inspection: ID=${largeInspId}`);

  if (largeInspId) {
    const t0 = performance.now();
    const upload4Res = await fetch(`${BASE}/api/machine/upload-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
      body: JSON.stringify({
        inspectionId: largeInspId,
        pointCode: 'R101',
        imageBase64: aoiB64,
        mimeType: 'image/png'
      })
    });
    const elapsed = (performance.now() - t0).toFixed(0);
    const upload4Data = await upload4Res.json();
    console.log(`  Status: ${upload4Res.status} (${elapsed}ms)`);
    console.log(`  Response:`, JSON.stringify(upload4Data));
    if (upload4Data.imageUrl) {
      console.log(`  ✅ 512x512 image uploaded → ${upload4Data.imageUrl}`);
      const filePath = path.join(process.cwd(), upload4Data.imageUrl);
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        console.log(`  📁 File on disk: ${(stat.size / 1024).toFixed(1)} KB`);
      }
    }
  }
  console.log('└───────────────────────────────────────────────────────────────┘');

  // ── STEP 7: Error cases ──
  console.log('\n┌─ STEP 7: Error cases ────────────────────────────────────────┐');
  
  // 7a: Upload to non-existent inspection
  const err1Res = await fetch(`${BASE}/api/machine/upload-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
    body: JSON.stringify({
      inspectionId: 999999,
      pointCode: 'R101',
      imageBase64: 'dGVzdA==',
      mimeType: 'image/png'
    })
  });
  console.log(`  7a) Non-existent inspection → ${err1Res.status}: ${(await err1Res.json()).message}`);

  // 7b: Upload with invalid API key
  const err2Res = await fetch(`${BASE}/api/machine/upload-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': 'invalid-key-xxx' },
    body: JSON.stringify({
      inspectionId,
      pointCode: 'R101',
      imageBase64: 'dGVzdA==',
      mimeType: 'image/png'
    })
  });
  console.log(`  7b) Invalid API key → ${err2Res.status}: ${(await err2Res.json()).message}`);

  // 7c: Upload with non-existent point code
  const err3Res = await fetch(`${BASE}/api/machine/upload-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
    body: JSON.stringify({
      inspectionId,
      pointCode: 'NONEXISTENT-POINT-999',
      imageBase64: 'dGVzdA==',
      mimeType: 'image/png'
    })
  });
  console.log(`  7c) Non-existent point → ${err3Res.status}: ${(await err3Res.json()).message}`);

  console.log('└───────────────────────────────────────────────────────────────┘');

  console.log('\n' + '='.repeat(70));
  console.log('  ALL IMAGE UPLOAD TESTS COMPLETE');
  console.log('='.repeat(70));
}

run().catch(e => console.error('FATAL:', e));
