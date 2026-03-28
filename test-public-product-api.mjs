/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║    TEST: Public Product REST API                                ║
 * ║    For third-party clients: Android, React Native, C#, Python   ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Usage:
 *   node test-public-product-api.mjs
 *   node test-public-product-api.mjs --base http://192.168.1.100:3000
 *   node test-public-product-api.mjs --api-key YOUR_KEY
 *   node test-public-product-api.mjs --machine-code YOUR_MACHINE
 *
 * Prerequisites:
 *   - Server running (pnpm dev or pnpm start)
 *   - At least one machine registered with an API key
 */

// ── Configuration ──────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name, fallback) {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}

const BASE_URL = getArg("--base", "http://localhost:3000");
const API_KEY = getArg("--api-key", "");
const MACHINE_CODE = getArg("--machine-code", "");

if (!API_KEY && !MACHINE_CODE) {
  console.log("⚠️  No --api-key or --machine-code provided.");
  console.log("   Will try to auto-detect from MASTER_API_KEY or existing machines.\n");
}

// ── Helpers ────────────────────────────────────────────────────────
let passed = 0, failed = 0;

async function request(method, path, { query, headers: extra } = {}) {
  const url = new URL(path, BASE_URL);
  if (query) Object.entries(query).forEach(([k, v]) => v != null && url.searchParams.set(k, String(v)));

  const headers = { "Accept": "application/json", ...extra };
  if (API_KEY) headers["X-API-Key"] = API_KEY;
  else if (MACHINE_CODE) headers["X-Machine-Code"] = MACHINE_CODE;

  const res = await fetch(url, { method, headers });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

function test(name, fn) {
  return async () => {
    process.stdout.write(`  ${name} ... `);
    try {
      await fn();
      passed++;
      console.log("✅ PASS");
    } catch (err) {
      failed++;
      console.log(`❌ FAIL: ${err.message}`);
    }
  };
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

// ── Detect auth credentials if not provided ────────────────────────
async function detectCredentials() {
  if (API_KEY || MACHINE_CODE) return;

  // Try master API key from common env
  const masterKeys = ["master_avi_aoi_2026_G8kLmN3pQrStUvpnp", "mach_test_1771425478998"];
  for (const key of masterKeys) {
    const { status, body } = await request("GET", "/api/public/products", {
      query: { limit: 1 },
      headers: { "X-API-Key": key },
    });
    if (status === 200 && body?.success) {
      console.log(`🔑 Auto-detected working API key: ${key.slice(0, 20)}...`);
      // Inject into global headers
      Object.defineProperty(globalThis, "_autoApiKey", { value: key });
      return;
    }
  }
  console.log("⚠️  Could not auto-detect credentials. Tests may fail with 401.\n");
}

// Override request to use auto-detected key
const _originalRequest = request;
async function authRequest(method, path, opts = {}) {
  if (!API_KEY && !MACHINE_CODE && globalThis._autoApiKey) {
    opts.headers = { ...opts.headers, "X-API-Key": globalThis._autoApiKey };
  }
  return _originalRequest(method, path, opts);
}

// ── Tests ──────────────────────────────────────────────────────────
async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  Public Product API Test Suite                              ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log(`  Base URL:     ${BASE_URL}`);
  console.log(`  API Key:      ${API_KEY || "(auto-detect)"}`);
  console.log(`  Machine Code: ${MACHINE_CODE || "(none)"}\n`);

  await detectCredentials();

  let firstProductCode = null;
  let firstProductId = null;

  // ── 1. Health check ──────────────────────────────────────────
  console.log("\n── Health Check ──");
  await test("GET /health returns ok", async () => {
    const { status, body } = await _originalRequest("GET", "/health");
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body?.status === "ok", `Expected status ok, got ${JSON.stringify(body)}`);
  })();

  // ── 2. List Products ─────────────────────────────────────────
  console.log("\n── List Products ──");

  await test("GET /api/public/products (no auth) → 401", async () => {
    const url = new URL("/api/public/products", BASE_URL);
    const res = await fetch(url, { headers: { "Accept": "application/json" } });
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  })();

  await test("GET /api/public/products (with auth) → 200", async () => {
    const { status, body } = await authRequest("GET", "/api/public/products", {
      query: { limit: 50 },
    });
    assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert(body?.success === true, `Expected success=true, got ${JSON.stringify(body)}`);
    assert(Array.isArray(body?.data), `Expected data to be an array, got ${typeof body?.data}`);
    console.log(`\n     📦 Found ${body.data.length} products (total: ${body.total})`);

    if (body.data.length > 0) {
      firstProductCode = body.data[0].code;
      firstProductId = body.data[0].id;
      console.log(`     First product: [${firstProductCode}] ${body.data[0].name}`);
    }
  })();

  await test("GET /api/public/products?search=... (search filter)", async () => {
    const { status, body } = await authRequest("GET", "/api/public/products", {
      query: { search: "test", limit: 5 },
    });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body?.success === true, "Expected success=true");
  })();

  await test("GET /api/public/products?limit=2&offset=0 (pagination)", async () => {
    const { status, body } = await authRequest("GET", "/api/public/products", {
      query: { limit: 2, offset: 0 },
    });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(Array.isArray(body?.data) && body.data.length <= 2, `Expected <=2 products`);
  })();

  // ── 3. Get Product by Code ───────────────────────────────────
  if (firstProductCode) {
    console.log("\n── Get Product by Code ──");

    await test(`GET /api/public/products/by-code/${firstProductCode}`, async () => {
      const { status, body } = await authRequest("GET", `/api/public/products/by-code/${firstProductCode}`);
      assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
      assert(body?.success === true, "Expected success=true");
      assert(body?.data?.product?.code === firstProductCode, "Product code mismatch");
      console.log(`\n     📋 Product: ${body.data.product.name}`);
      console.log(`     Points: ${body.data.measurementPoints?.length || 0}`);
    })();

    await test("GET /api/public/products/by-code/NONEXISTENT → 404", async () => {
      const { status } = await authRequest("GET", "/api/public/products/by-code/NONEXISTENT_CODE_XYZ");
      assert(status === 404, `Expected 404, got ${status}`);
    })();
  }

  // ── 4. Get Product by ID ─────────────────────────────────────
  if (firstProductId) {
    console.log("\n── Get Product by ID ──");

    await test(`GET /api/public/products/by-id/${firstProductId}`, async () => {
      const { status, body } = await authRequest("GET", `/api/public/products/by-id/${firstProductId}`);
      assert(status === 200, `Expected 200, got ${status}`);
      assert(body?.data?.product?.id === firstProductId, "Product ID mismatch");
    })();
  }

  // ── 5. Get Measurement Points ────────────────────────────────
  if (firstProductCode) {
    console.log("\n── Measurement Points ──");

    await test(`GET /api/public/products/${firstProductCode}/measurement-points`, async () => {
      const { status, body } = await authRequest(
        "GET",
        `/api/public/products/${encodeURIComponent(firstProductCode)}/measurement-points`
      );
      assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
      assert(body?.success === true, "Expected success=true");
      const points = Array.isArray(body?.data) ? body.data : [];
      console.log(`\n     📍 ${points.length} measurement points`);
      points.slice(0, 3).forEach((p) => {
        console.log(`        - [${p.code}] ${p.name} (type: ${p.measurementType})`);
      });
    })();
  }

  // ── 6. Get Product Image ─────────────────────────────────────
  if (firstProductCode) {
    console.log("\n── Product Image ──");

    await test(`GET /api/public/products/${firstProductCode}/image`, async () => {
      const { status, body } = await authRequest(
        "GET",
        `/api/public/products/${encodeURIComponent(firstProductCode)}/image`
      );
      // May return 200 with imageUrl=null if no image, or 404
      assert(status === 200 || status === 404, `Expected 200 or 404, got ${status}`);
      if (status === 200) {
        console.log(`\n     🖼️  Image URL: ${body?.data?.imageUrl || "(none)"}`);
      }
    })();
  }

  // ── Summary ──────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log(`  Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log("══════════════════════════════════════════════════════════════\n");

  if (firstProductCode) {
    printAndroidGuide(firstProductCode);
  }

  process.exit(failed > 0 ? 1 : 0);
}

// ── Integration Guide ──────────────────────────────────────────────
function printAndroidGuide(sampleCode) {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  📱 HƯỚNG DẪN TÍCH HỢP API CHO APP ANDROID / REACT NATIVE         ║
╚══════════════════════════════════════════════════════════════════════╝

🔗 BASE URL:  ${BASE_URL}
🔑 Auth:      Header "X-API-Key: <your_machine_api_key>"
              hoặc "X-Machine-Code: <your_machine_code>"

────────────────────────────────────────────────────────────────────────
1️⃣  DANH SÁCH SẢN PHẨM
────────────────────────────────────────────────────────────────────────
GET ${BASE_URL}/api/public/products
    ?limit=50&offset=0  (phân trang)
    &search=keyword      (tìm kiếm)
    &lifecycleStatus=active  (lọc trạng thái)

Headers:
  X-API-Key: <your_api_key>

Response:
  {
    "success": true,
    "data": {
      "products": [
        { "id": 1, "code": "${sampleCode}", "name": "...", ... }
      ],
      "total": 42
    }
  }

────────────────────────────────────────────────────────────────────────
2️⃣  CHI TIẾT SẢN PHẨM (theo Code hoặc ID)
────────────────────────────────────────────────────────────────────────
GET ${BASE_URL}/api/public/products/by-code/${sampleCode}
GET ${BASE_URL}/api/public/products/by-id/1

────────────────────────────────────────────────────────────────────────
3️⃣  DANH SÁCH ĐIỂM ĐO (Measurement Points)
────────────────────────────────────────────────────────────────────────
GET ${BASE_URL}/api/public/products/${sampleCode}/measurement-points

────────────────────────────────────────────────────────────────────────
4️⃣  ẢNH THAM CHIẾU SẢN PHẨM
────────────────────────────────────────────────────────────────────────
GET ${BASE_URL}/api/public/products/${sampleCode}/image

────────────────────────────────────────────────────────────────────────
5️⃣  ẢNH ĐIỂM ĐO
────────────────────────────────────────────────────────────────────────
GET ${BASE_URL}/api/public/measurement-points/123/image

════════════════════════════════════════════════════════════════════════
📱 VÍ DỤ REACT NATIVE (fetch)
════════════════════════════════════════════════════════════════════════

const API_BASE = "${BASE_URL}";
const API_KEY  = "your_machine_api_key_here";

async function fetchProducts(search = "", page = 0) {
  const limit = 20;
  const url = \`\${API_BASE}/api/public/products?limit=\${limit}&offset=\${page * limit}&search=\${search}\`;
  const res = await fetch(url, {
    headers: { "X-API-Key": API_KEY },
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error);
  return json.data; // { products: [...], total: N }
}

async function fetchProductDetail(code) {
  const res = await fetch(\`\${API_BASE}/api/public/products/by-code/\${code}\`, {
    headers: { "X-API-Key": API_KEY },
  });
  return (await res.json()).data;
}

async function fetchMeasurementPoints(productCode) {
  const res = await fetch(
    \`\${API_BASE}/api/public/products/\${productCode}/measurement-points\`,
    { headers: { "X-API-Key": API_KEY } }
  );
  return (await res.json()).data;
}

════════════════════════════════════════════════════════════════════════
🔧 VÍ DỤ CURL
════════════════════════════════════════════════════════════════════════

# Danh sách sản phẩm
curl -H "X-API-Key: your_key" "${BASE_URL}/api/public/products?limit=10"

# Chi tiết sản phẩm
curl -H "X-API-Key: your_key" "${BASE_URL}/api/public/products/by-code/${sampleCode}"

# Điểm đo
curl -H "X-API-Key: your_key" "${BASE_URL}/api/public/products/${sampleCode}/measurement-points"

════════════════════════════════════════════════════════════════════════
🐍 VÍ DỤ PYTHON
════════════════════════════════════════════════════════════════════════

import requests

BASE = "${BASE_URL}"
HEADERS = {"X-API-Key": "your_key"}

# Danh sách sản phẩm
r = requests.get(f"{BASE}/api/public/products", headers=HEADERS, params={"limit": 50})
products = r.json()["data"]["products"]

# Chi tiết
r = requests.get(f"{BASE}/api/public/products/by-code/${sampleCode}", headers=HEADERS)
product = r.json()["data"]["product"]

════════════════════════════════════════════════════════════════════════
🔷 VÍ DỤ C# (.NET HttpClient)  
════════════════════════════════════════════════════════════════════════

var client = new HttpClient();
client.BaseAddress = new Uri("${BASE_URL}");
client.DefaultRequestHeaders.Add("X-API-Key", "your_key");

var response = await client.GetAsync("/api/public/products?limit=50");
var json = await response.Content.ReadAsStringAsync();
`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
