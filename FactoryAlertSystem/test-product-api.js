/**
 * Test script: Kiểm tra kết nối API lấy danh sách sản phẩm
 * 
 * Chạy: node test-product-api.js <SERVER_IP> [API_KEY] [MACHINE_CODE]
 * VD:   node test-product-api.js 192.168.1.100
 *       node test-product-api.js 192.168.1.100 YOUR_API_KEY
 *       node test-product-api.js 192.168.1.100 "" MACHINE-001
 */

const http = require('http');
const https = require('https');

// ============================================
// CONFIG
// ============================================
const SERVER_IP = process.argv[2] || 'localhost';
const API_KEY = process.argv[3] || '';
const MACHINE_CODE = process.argv[4] || '';
const PORT = 3000;
const BASE_URL = `http://${SERVER_IP}:${PORT}`;

function log(tag, ...args) {
  console.log(`[${tag}]`, ...args);
}

function logError(tag, ...args) {
  console.error(`[${tag}] ❌`, ...args);
}

function logOk(tag, ...args) {
  console.log(`[${tag}] ✅`, ...args);
}

// ============================================
// HTTP GET Helper (with optional custom headers)
// ============================================
function httpGet(url, timeoutMs = 10000, customHeaders = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      timeout: timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        ...customHeaders,
      },
    };
    const req = mod.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode, headers: res.headers, body });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

// ============================================
// TEST 1: Basic connectivity
// ============================================
async function testConnectivity() {
  log('TEST-1', `Checking connectivity to ${BASE_URL} ...`);
  try {
    const res = await httpGet(`${BASE_URL}/`, 5000);
    logOk('TEST-1', `Server reachable, HTTP ${res.status}`);
    return true;
  } catch (e) {
    logError('TEST-1', `Cannot reach ${BASE_URL}: ${e.message}`);
    return false;
  }
}

// ============================================
// TEST 2: tRPC endpoint - /trpc/... (correct per API guide)
// ============================================
async function testTrpcEndpoint() {
  log('TEST-2', 'Testing tRPC endpoint path...');

  // Build auth input
  const input = {};
  if (API_KEY) input.apiKey = API_KEY;
  if (MACHINE_CODE) input.machineCode = MACHINE_CODE;
  input.limit = 10;
  input.offset = 0;

  // tRPC v10 + superjson: wrap input as {"json": {...}}
  const encodedInput = encodeURIComponent(JSON.stringify({ json: input }));

  // Test 2a: /api/trpc/ (correct path — server processes as API, not SPA)
  const url1 = `${BASE_URL}/api/trpc/publicProductApi.listProducts?input=${encodedInput}`;
  log('TEST-2a', `GET ${url1}`);
  try {
    const res = await httpGet(url1, 10000);
    log('TEST-2a', `HTTP ${res.status}`);
    if (res.status === 200) {
      logOk('TEST-2a', `/api/trpc/ path works!`);
      log('TEST-2a', 'Response:', res.body.substring(0, 500));
      try {
        const json = JSON.parse(res.body);
        const data = json?.result?.data;
        if (data?.success) {
          logOk('TEST-2a', `Got ${data.data?.length || 0} products, total: ${data.total}`);
          if (data.data && data.data.length > 0) {
            log('TEST-2a', 'First product:', JSON.stringify(data.data[0], null, 2));
          }
        } else {
          logError('TEST-2a', 'Response success=false:', JSON.stringify(data));
        }
      } catch (e) {
        logError('TEST-2a', 'Cannot parse JSON response');
      }
    } else {
      logError('TEST-2a', `/api/trpc/ returned HTTP ${res.status}`);
      log('TEST-2a', 'Body:', res.body.substring(0, 300));
    }
  } catch (e) {
    logError('TEST-2a', `Failed: ${e.message}`);
  }

  // Test 2b: /trpc/ (old SPA path — returns HTML, not API)
  const url2 = `${BASE_URL}/trpc/publicProductApi.listProducts?input=${encodedInput}`;
  log('TEST-2b', `GET ${url2}`);
  try {
    const res = await httpGet(url2, 10000);
    log('TEST-2b', `HTTP ${res.status}`);
    const isHtml = res.body.trimStart().startsWith('<!') || res.body.trimStart().startsWith('<html');
    if (isHtml) {
      log('TEST-2b', `⚠️ /trpc/ returned HTML (SPA fallback) — this path is WRONG`);
    } else if (res.status === 200) {
      log('TEST-2b', '⚠️ /trpc/ also works (server supports both paths)');
      log('TEST-2b', 'Response:', res.body.substring(0, 300));
    } else {
      log('TEST-2b', `/trpc/ returned HTTP ${res.status}`);
    }
  } catch (e) {
    log('TEST-2b', `/trpc/ failed: ${e.message}`);
  }
}

// ============================================
// TEST 3: Auth methods
// ============================================
async function testAuth() {
  log('TEST-3', 'Testing auth methods...');

  // Test 3a: with apiKey in input
  if (API_KEY) {
    const input = { apiKey: API_KEY, limit: 5, offset: 0 };
    const url = `${BASE_URL}/api/trpc/publicProductApi.listProducts?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
    log('TEST-3a', `Auth via apiKey in input: ${API_KEY.substring(0, 8)}...`);
    try {
      const res = await httpGet(url, 10000);
      log('TEST-3a', `HTTP ${res.status}`);
      if (res.status === 200) {
        const json = JSON.parse(res.body);
        logOk('TEST-3a', `apiKey auth works, success=${json?.result?.data?.success}`);
      } else {
        logError('TEST-3a', `apiKey auth failed: HTTP ${res.status}`, res.body.substring(0, 200));
      }
    } catch (e) {
      logError('TEST-3a', `Failed: ${e.message}`);
    }
  } else {
    log('TEST-3a', 'Skipped — no API_KEY provided');
  }

  // Test 3b: with machineCode in input
  if (MACHINE_CODE) {
    const input = { machineCode: MACHINE_CODE, limit: 5, offset: 0 };
    const url = `${BASE_URL}/api/trpc/publicProductApi.listProducts?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
    log('TEST-3b', `Auth via machineCode in input: ${MACHINE_CODE}`);
    try {
      const res = await httpGet(url, 10000);
      log('TEST-3b', `HTTP ${res.status}`);
      if (res.status === 200) {
        const json = JSON.parse(res.body);
        logOk('TEST-3b', `machineCode auth works, success=${json?.result?.data?.success}`);
        const products = json?.result?.data?.data;
        if (products && products.length > 0) {
          log('TEST-3b', `Products: ${products.map(p => p.code).join(', ')}`);
        }
      } else {
        logError('TEST-3b', `machineCode auth failed: HTTP ${res.status}`, res.body.substring(0, 200));
      }
    } catch (e) {
      logError('TEST-3b', `Failed: ${e.message}`);
    }
  } else {
    log('TEST-3b', 'Skipped — no MACHINE_CODE provided');
  }

  // Test 3c: no auth at all (expect error)
  {
    const input = { limit: 5, offset: 0 };
    const url = `${BASE_URL}/api/trpc/publicProductApi.listProducts?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
    log('TEST-3c', 'No auth (expect error)...');
    try {
      const res = await httpGet(url, 10000);
      log('TEST-3c', `HTTP ${res.status}, body: ${res.body.substring(0, 200)}`);
    } catch (e) {
      log('TEST-3c', `Failed: ${e.message}`);
    }
  }
}

// ============================================
// TEST 4: Hierarchy tree (for machineCode resolution)
// ============================================
async function testHierarchy() {
  log('TEST-4', 'Testing hierarchy tree endpoint...');

  // Build headers with x-master-key
  const headers = {};
  if (API_KEY) headers['x-master-key'] = API_KEY;

  const url = `${BASE_URL}/api/external/hierarchy/tree`;
  log('TEST-4', `GET ${url}`, API_KEY ? `(x-master-key: ${API_KEY.substring(0, 8)}...)` : '(no API key)');
  try {
    const res = await httpGet(url, 10000, headers);
    log('TEST-4', `HTTP ${res.status}`);
    if (res.status === 200) {
      try {
        const json = JSON.parse(res.body);
        let data;
        if (Array.isArray(json)) data = json;
        else if (Array.isArray(json?.data)) data = json.data;
        else if (Array.isArray(json?.result?.data)) data = json.result.data;

        if (data) {
          logOk('TEST-4', `Hierarchy tree: ${data.length} factories`);
          // Print station→machine mapping
          for (const factory of data) {
            for (const ws of (factory.workshops || [])) {
              for (const line of (ws.lines || [])) {
                for (const station of (line.stations || [])) {
                  const machines = (station.machines || []).map(m => m.code).join(', ');
                  log('TEST-4', `  Station id=${station.id} code="${station.code}" name="${station.name}" → machines=[${machines}]`);
                }
              }
            }
          }
        } else {
          logError('TEST-4', 'Unexpected format:', res.body.substring(0, 300));
        }
      } catch (e) {
        logError('TEST-4', 'Cannot parse JSON:', e.message);
      }
    } else {
      logError('TEST-4', `HTTP ${res.status}`, res.body.substring(0, 300));
    }
  } catch (e) {
    logError('TEST-4', `Failed: ${e.message}`);
  }
}

// ============================================
// TEST 5: getProductByCode
// ============================================
async function testGetProductByCode(productCode) {
  if (!productCode) return;
  log('TEST-5', `Testing getProductByCode for "${productCode}"...`);

  const input = {};
  if (API_KEY) input.apiKey = API_KEY;
  if (MACHINE_CODE) input.machineCode = MACHINE_CODE;
  input.code = productCode;

  const url = `${BASE_URL}/api/trpc/publicProductApi.getProductByCode?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  try {
    const res = await httpGet(url, 10000);
    log('TEST-5', `HTTP ${res.status}`);
    if (res.status === 200) {
      const json = JSON.parse(res.body);
      const data = json?.result?.data;
      logOk('TEST-5', `Product: ${JSON.stringify(data?.product || data, null, 2).substring(0, 500)}`);
      if (data?.measurementPoints) {
        log('TEST-5', `Measurement points: ${data.measurementPoints.length}`);
      }
    } else {
      logError('TEST-5', res.body.substring(0, 300));
    }
  } catch (e) {
    logError('TEST-5', `Failed: ${e.message}`);
  }
}

// ============================================
// MAIN
// ============================================
async function main() {
  console.log('='.repeat(60));
  console.log('  Factory Alert System — Product API Test');
  console.log(`  Server: ${BASE_URL}`);
  console.log(`  API Key: ${API_KEY ? API_KEY.substring(0, 8) + '...' : '(none)'}`);
  console.log(`  Machine Code: ${MACHINE_CODE || '(none)'}`);
  console.log('='.repeat(60));
  console.log();

  // Test 1: connectivity
  const reachable = await testConnectivity();
  if (!reachable) {
    logError('MAIN', 'Server not reachable. Check IP and port.');
    process.exit(1);
  }
  console.log();

  // Test 2: tRPC endpoint paths
  await testTrpcEndpoint();
  console.log();

  // Test 3: Auth methods
  await testAuth();
  console.log();

  // Test 4: Hierarchy tree
  await testHierarchy();
  console.log();

  // Test 6: Simulate exact app flow
  await testAppFlow();
  console.log();

  console.log('='.repeat(60));
  console.log('  Test complete');
  console.log('='.repeat(60));
}

// ============================================
// TEST 6: Simulate exact app flow (hierarchy → machineCode → products)
// ============================================
async function testAppFlow() {
  log('TEST-6', '=== Simulating exact app flow ===');

  // Step 1: Fetch hierarchy to get machineCode
  const headers = {};
  if (API_KEY) headers['x-master-key'] = API_KEY;

  let machineCode = MACHINE_CODE;
  let stationCode = null;

  if (!machineCode) {
    log('TEST-6', 'Step 1: Fetching hierarchy tree to resolve machineCode...');
    try {
      const res = await httpGet(`${BASE_URL}/api/external/hierarchy/tree`, 10000, headers);
      if (res.status === 200) {
        const json = JSON.parse(res.body);
        let data;
        if (Array.isArray(json)) data = json;
        else if (Array.isArray(json?.data)) data = json.data;
        else if (Array.isArray(json?.result?.data)) data = json.result.data;

        if (data) {
          // Find first station with a machine
          for (const factory of data) {
            for (const ws of (factory.workshops || [])) {
              for (const line of (ws.lines || [])) {
                for (const station of (line.stations || [])) {
                  if (station.machines && station.machines.length > 0) {
                    machineCode = station.machines[0].code;
                    stationCode = station.code;
                    logOk('TEST-6', `Found station "${station.code}" (id=${station.id}) → machine "${machineCode}"`);
                    break;
                  }
                }
                if (machineCode) break;
              }
              if (machineCode) break;
            }
            if (machineCode) break;
          }
          if (!machineCode) {
            logError('TEST-6', 'No stations with machines found in hierarchy!');
          }
        } else {
          logError('TEST-6', 'Could not parse hierarchy response');
        }
      } else {
        logError('TEST-6', `Hierarchy returned HTTP ${res.status}`);
      }
    } catch (e) {
      logError('TEST-6', `Hierarchy fetch failed: ${e.message}`);
    }
  }

  // Step 2: Call listProducts with resolved machineCode (or apiKey fallback)
  log('TEST-6', 'Step 2: Calling listProducts with machineCode="' + (machineCode || '(none)') + '" ...');
  const input = { limit: 10, offset: 0, lifecycleStatus: 'active' };
  if (machineCode) input.machineCode = machineCode;
  else if (API_KEY) input.apiKey = API_KEY;

  const url = `${BASE_URL}/api/trpc/publicProductApi.listProducts?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  try {
    const res = await httpGet(url, 10000);
    log('TEST-6', `HTTP ${res.status}`);
    if (res.status === 200) {
      const json = JSON.parse(res.body);
      const payload = json?.result?.data;
      if (payload?.success) {
        const products = payload.data || [];
        logOk('TEST-6', `SUCCESS! Got ${products.length} products (total: ${payload.total})`);
        products.forEach((p, i) => {
          log('TEST-6', `  [${i + 1}] code="${p.code}" name="${p.name}" status="${p.lifecycleStatus}"`);
        });

        // Test 5: getProductByCode for first product
        if (products.length > 0) {
          await testGetProductByCode(products[0].code);
        }
      } else {
        logError('TEST-6', `API returned success=false:`, JSON.stringify(payload).substring(0, 300));
      }
    } else {
      logError('TEST-6', `HTTP ${res.status}:`, res.body.substring(0, 300));
    }
  } catch (e) {
    logError('TEST-6', `listProducts failed: ${e.message}`);
  }

  // Step 3: Also try with NO auth at all
  log('TEST-6', 'Step 3: Trying listProducts with NO auth (testing if server allows public access)...');
  const noAuthInput = { limit: 5, offset: 0 };
  const noAuthUrl = `${BASE_URL}/api/trpc/publicProductApi.listProducts?input=${encodeURIComponent(JSON.stringify({ json: noAuthInput }))}`;
  try {
    const res = await httpGet(noAuthUrl, 10000);
    log('TEST-6', `No-auth HTTP ${res.status}`);
    if (res.status === 200) {
      const json = JSON.parse(res.body);
      const payload = json?.result?.data;
      if (payload?.success && (payload.data || []).length > 0) {
        logOk('TEST-6', `Server allows public access! ${(payload.data || []).length} products returned without auth.`);
        log('TEST-6', '→ App should work even without apiKey or machineCode!');
      } else {
        log('TEST-6', `No-auth response:`, JSON.stringify(payload).substring(0, 200));
      }
    } else {
      log('TEST-6', `No-auth failed: HTTP ${res.status} — auth IS required`);
    }
  } catch (e) {
    log('TEST-6', `No-auth failed: ${e.message}`);
  }
}

main().catch((e) => {
  logError('MAIN', 'Unexpected error:', e);
  process.exit(1);
});
