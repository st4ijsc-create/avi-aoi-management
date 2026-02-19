/**
 * Test: Submit Inspection + Upload Image APIs
 * Uses machine AOI-TEST-FRESH-001 (approved, apiKey: mach_test_1771425478998)
 */

const BASE = 'http://localhost:3001';
const API_KEY = 'mach_test_1771425478998';

async function run() {
  console.log('='.repeat(60));
  console.log('  TEST: SUBMIT INSPECTION + UPLOAD IMAGE');
  console.log('='.repeat(60));

  // ── STEP 1: Submit Inspection (OK result) ──
  console.log('\n--- STEP 1: POST /api/machine/submit-inspection (OK) ---');
  const okPayload = {
    apiKey: API_KEY,
    serialNumber: 'BOARD-2026-001',
    productModel: 'PCB-SMT-001',
    overallResult: 'OK',
    inspectionTime: new Date().toISOString(),
    cycleTime: 2.5,
    companyCode: 'CORP001',
    factoryCode: 'FAC001',
    lineCode: 'LINE-01',
    measurements: [
      {
        pointCode: 'R101',
        measuredValue: 0.15,
        result: 'OK',
        remark: 'Within tolerance'
      },
      {
        pointCode: 'C201',
        measuredValue: 0.12,
        result: 'OK'
      }
    ]
  };

  const okRes = await fetch(`${BASE}/api/machine/submit-inspection`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(okPayload)
  });
  const okData = await okRes.json();
  console.log('Status:', okRes.status);
  console.log('Response:', JSON.stringify(okData, null, 2));

  // ── STEP 2: Submit Inspection (NG result with image) ──
  console.log('\n--- STEP 2: POST /api/machine/submit-inspection (NG + inline image) ---');
  
  // Create a tiny 1x1 red pixel PNG as base64 for testing
  const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
  
  const ngPayload = {
    apiKey: API_KEY,
    serialNumber: 'BOARD-2026-002',
    productModel: 'PCB-SMT-001',
    overallResult: 'NG',
    inspectionTime: new Date().toISOString(),
    cycleTime: 3.1,
    batchNumber: 'BATCH-2026-02-18',
    measurements: [
      {
        pointCode: 'R101',
        measuredValue: 0.14,
        result: 'OK'
      },
      {
        pointCode: 'C201',
        measuredValue: 0.55,
        result: 'NG',
        remark: 'Solder bridge detected'
      },
      {
        pointCode: 'U301',
        measuredValue: 'MISSING',
        result: 'NG',
        remark: 'Component missing'
      }
    ]
  };

  const ngRes = await fetch(`${BASE}/api/machine/submit-inspection`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ngPayload)
  });
  const ngData = await ngRes.json();
  console.log('Status:', ngRes.status);
  console.log('Response:', JSON.stringify(ngData, null, 2));

  // ── STEP 3: Upload Image separately ──
  if (ngData.inspectionId) {
    console.log('\n--- STEP 3: POST /api/machine/upload-image ---');
    const uploadPayload = {
      apiKey: API_KEY,
      inspectionId: ngData.inspectionId,
      pointCode: 'R101',
      imageBase64: tinyPngBase64,
      mimeType: 'image/png'
    };

    const uploadRes = await fetch(`${BASE}/api/machine/upload-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(uploadPayload)
    });
    const uploadData = await uploadRes.json();
    console.log('Status:', uploadRes.status);
    console.log('Response:', JSON.stringify(uploadData, null, 2));
  } else {
    console.log('\n--- STEP 3: SKIPPED (no inspectionId from step 2) ---');
  }

  // ── STEP 4: Submit using X-API-Key header instead of body ──
  console.log('\n--- STEP 4: POST /api/machine/submit-inspection (via X-API-Key header) ---');
  const headerPayload = {
    serialNumber: 'BOARD-2026-003',
    productModel: 'PCB-SMT-001',
    overallResult: 'OK',
    inspectionTime: new Date().toISOString(),
    measurements: [
      {
        pointCode: 'R102',
        measuredValue: 0.18,
        result: 'OK'
      }
    ]
  };

  const headerRes = await fetch(`${BASE}/api/machine/submit-inspection`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY
    },
    body: JSON.stringify(headerPayload)
  });
  const headerData = await headerRes.json();
  console.log('Status:', headerRes.status);
  console.log('Response:', JSON.stringify(headerData, null, 2));

  // ── STEP 5: Error cases ──
  console.log('\n--- STEP 5a: Invalid API key ---');
  const badKeyRes = await fetch(`${BASE}/api/machine/submit-inspection`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: 'invalid-key',
      serialNumber: 'BOARD-X',
      overallResult: 'OK',
      measurements: []
    })
  });
  console.log('Status:', badKeyRes.status);
  console.log('Response:', JSON.stringify(await badKeyRes.json()));

  console.log('\n--- STEP 5b: Missing required fields ---');
  const missingRes = await fetch(`${BASE}/api/machine/submit-inspection`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey: API_KEY })
  });
  console.log('Status:', missingRes.status);
  console.log('Response:', JSON.stringify(await missingRes.json()).substring(0, 300));

  console.log('\n' + '='.repeat(60));
  console.log('  ALL TESTS COMPLETE');
  console.log('='.repeat(60));
}

run().catch(e => console.error('FATAL:', e));
