/**
 * Test: Android App API — Danh sách sản phẩm, điểm đo, ảnh sản phẩm, ảnh mẫu điểm đo
 *
 * Sử dụng 2 nhóm API:
 *   1. Machine API (REST proxy)  — dùng X-API-Key hoặc machineCode
 *   2. Public Product API (tRPC) — dùng apiKey hoặc machineCode
 *
 * Chạy:  node test-android-api.mjs
 * Hoặc:  node test-android-api.mjs --base http://192.168.1.100:3000 --key YOUR_API_KEY
 */

// ── Config ──
const args = process.argv.slice(2);
function getArg(name, fallback) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}

const BASE = getArg("base", "http://localhost:3000");
const API_KEY = getArg("key", "mach_x29D4K46rfQwZN2aWAugVOU24pnHznQ0");
const MACHINE_CODE = getArg("machine", "");
const TRPC = `${BASE}/api/trpc`;

// ── Helpers ──
const SEP = "=".repeat(70);
const LINE = "-".repeat(50);
let passed = 0;
let failed = 0;

function header(title) {
  console.log(`\n${SEP}`);
  console.log(`  ${title}`);
  console.log(SEP);
}

function section(title) {
  console.log(`\n${LINE}`);
  console.log(`  ${title}`);
  console.log(LINE);
}

function ok(msg) {
  passed++;
  console.log(`  ✅ ${msg}`);
}

function fail(msg, detail) {
  failed++;
  console.error(`  ❌ ${msg}`);
  if (detail) {
    const s = detail instanceof Error ? detail.message : typeof detail === "string" ? detail : JSON.stringify(detail, null, 2);
    console.error(`     ${s}`);
  }
}

function json(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

/** tRPC GET helper — serializes input as query‑string JSON (superjson wrapped) */
async function trpcGet(procedure, input) {
  const qs = input ? `?input=${encodeURIComponent(JSON.stringify({ json: input }))}` : "";
  const url = `${TRPC}/${procedure}${qs}`;
  let res;
  try {
    res = await fetch(url, { headers: { Accept: "application/json" } });
  } catch (e) {
    throw new Error(`Network error: ${e.cause?.code || e.message}`);
  }
  const body = await res.json();
  if (!res.ok || body.error) throw { status: res.status, body };
  // superjson wraps data inside { result: { data: { json: ... } } }
  return body.result?.data?.json ?? body.result?.data ?? body;
}

/** REST GET helper */
async function restGet(path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `${BASE}${path}${qs ? `?${qs}` : ""}`;
  let res;
  try {
    res = await fetch(url, {
      headers: { "X-API-Key": API_KEY, Accept: "application/json" },
    });
  } catch (e) {
    throw new Error(`Network error: ${e.cause?.code || e.message}`);
  }
  const body = await res.json();
  if (!res.ok || body.success === false) throw { status: res.status, body };
  return body;
}

/** REST POST helper */
async function restPost(path, payload) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": API_KEY,
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    throw new Error(`Network error: ${e.cause?.code || e.message}`);
  }
  const body = await res.json();
  if (!res.ok || body.success === false) throw { status: res.status, body };
  return body;
}

// ── Auth input (used by tRPC calls) ──
const auth = API_KEY ? { apiKey: API_KEY } : { machineCode: MACHINE_CODE };

// ============================================================
//  RUN ALL TESTS
// ============================================================
async function run() {
  header("TEST: Android App API (Products, Points, Images)");
  console.log(`  Server : ${BASE}`);
  console.log(`  API Key: ${API_KEY || "(none — using machineCode)"}`);
  console.log(`  Machine: ${MACHINE_CODE || "(none — using apiKey)"}`);

  // Store data for downstream tests
  let firstProductCode = null;
  let firstPointCode = null;
  let firstPointId = null;

  // ──────────────────────────────────────────────────────────
  //  1. DANH SÁCH SẢN PHẨM (Public Product API — tRPC)
  // ──────────────────────────────────────────────────────────
  section("1a. publicProductApi.listProducts (tRPC)");
  try {
    const data = await trpcGet("publicProductApi.listProducts", {
      ...auth,
      limit: 10,
      offset: 0,
    });
    console.log(`  Total products: ${data.total}`);
    if (data.data && data.data.length > 0) {
      data.data.forEach((p) => {
        console.log(`    [${p.code}] ${p.name} — ${p.lifecycleStatus} | img: ${p.referenceImageUrl || "—"}`);
      });
      firstProductCode = data.data[0].code;
      ok(`Lấy danh sách sản phẩm thành công (${data.data.length} items)`);
    } else {
      ok("API hoạt động nhưng chưa có sản phẩm nào trong hệ thống");
    }
  } catch (e) {
    fail("listProducts failed", e.body || e);
  }

  // ──────────────────────────────────────────────────────────
  //  1b. DANH SÁCH SẢN PHẨM qua Machine API (REST — get-points trả product models)
  // ──────────────────────────────────────────────────────────
  section("1b. GET /api/machine/get-points — all product models (REST)");
  try {
    const data = await restGet("/api/machine/get-points", {
      ...(API_KEY ? { apiKey: API_KEY } : { machineCode: MACHINE_CODE }),
    });
    console.log(`  Machine: ${data.machineCode} (id=${data.machineId})`);
    console.log(`  Product models returned: ${data.productModels?.length ?? 0}`);
    if (data.productModels) {
      data.productModels.forEach((pm) => {
        console.log(`    [${pm.productModelCode}] ${pm.productModelName} — ${pm.totalPoints} points | refImg: ${pm.referenceImageUrl || "—"}`);
      });
      if (!firstProductCode && data.productModels.length > 0) {
        firstProductCode = data.productModels[0].productModelCode;
      }
    }
    ok("Lấy tất cả product models + points của máy thành công");
  } catch (e) {
    fail("get-points (all) failed", e.body || e);
  }

  if (!firstProductCode) {
    console.log("\n⚠️  Không có sản phẩm nào → bỏ qua các test còn lại.");
    return printSummary();
  }

  // ──────────────────────────────────────────────────────────
  //  2. DANH SÁCH ĐIỂM ĐO (Public Product API — tRPC)
  // ──────────────────────────────────────────────────────────
  section(`2a. publicProductApi.getMeasurementPoints — product: ${firstProductCode}`);
  try {
    const data = await trpcGet("publicProductApi.getMeasurementPoints", {
      ...auth,
      productCode: firstProductCode,
    });
    console.log(`  Total points: ${data.total}`);
    if (data.data && data.data.length > 0) {
      data.data.forEach((mp) => {
        console.log(`    [${mp.code}] ${mp.name} — ${mp.measurementType} pos(${mp.positionX},${mp.positionY}) refImg: ${mp.referenceImageUrl || "—"}`);
      });
      firstPointCode = data.data[0].code;
      firstPointId = data.data[0].id;
      ok(`Lấy danh sách điểm đo thành công (${data.data.length} points)`);
    } else {
      ok("API hoạt động nhưng product này chưa có điểm đo");
    }
  } catch (e) {
    fail("getMeasurementPoints failed", e.body || e);
  }

  // ──────────────────────────────────────────────────────────
  //  2b. ĐIỂM ĐO qua Machine API (REST — get-points với productModelCode)
  // ──────────────────────────────────────────────────────────
  section(`2b. GET /api/machine/get-points?productModelCode=${firstProductCode} (REST)`);
  try {
    const data = await restGet("/api/machine/get-points", {
      ...(API_KEY ? { apiKey: API_KEY } : { machineCode: MACHINE_CODE }),
      productModelCode: firstProductCode,
    });
    const pm = data.productModels?.[0];
    if (pm) {
      console.log(`  Product: [${pm.productModelCode}] ${pm.productModelName}`);
      console.log(`  Reference image: ${pm.referenceImageUrl || "—"}`);
      console.log(`  Image size: ${pm.imageWidth ?? "?"}×${pm.imageHeight ?? "?"}`);
      console.log(`  Points: ${pm.totalPoints}`);
      pm.points?.slice(0, 5).forEach((p) => {
        console.log(`    [${p.code}] ${p.name} — refImg: ${p.referenceImageUrl || "—"}`);
      });
      if (!firstPointCode && pm.points?.length > 0) {
        firstPointCode = pm.points[0].code;
        firstPointId = pm.points[0].id;
      }
      ok("Lấy điểm đo theo product model thành công");
    } else {
      fail("Không tìm thấy product model trong response");
    }
  } catch (e) {
    fail("get-points (by product) failed", e.body || e);
  }

  // ──────────────────────────────────────────────────────────
  //  3. ẢNH SẢN PHẨM (Product Reference Image)
  // ──────────────────────────────────────────────────────────

  // 3a. tRPC publicProductApi
  section(`3a. publicProductApi.getProductImage — product: ${firstProductCode}`);
  try {
    const data = await trpcGet("publicProductApi.getProductImage", {
      ...auth,
      productCode: firstProductCode,
    });
    console.log(`  Product: ${data.data?.productName}`);
    console.log(`  Image URL: ${data.data?.imageUrl}`);
    console.log(`  Size: ${data.data?.imageWidth ?? "?"}×${data.data?.imageHeight ?? "?"}`);
    ok("Lấy ảnh mẫu sản phẩm thành công (tRPC)");
  } catch (e) {
    if (e.body?.error?.message?.includes("no reference image") || e.body?.message?.includes("no reference image")) {
      ok("Product chưa có ảnh mẫu — API trả NOT_FOUND đúng logic");
    } else {
      fail("getProductImage (tRPC) failed", e.body || e);
    }
  }

  // 3b. Machine API REST
  section(`3b. GET /api/machine/product-image — product: ${firstProductCode}`);
  try {
    const data = await restGet("/api/machine/product-image", {
      ...(API_KEY ? { apiKey: API_KEY } : { machineCode: MACHINE_CODE }),
      productModelCode: firstProductCode,
    });
    console.log(`  Image URL: ${data.data?.imageUrl}`);
    console.log(`  Size: ${data.data?.imageWidth ?? "?"}×${data.data?.imageHeight ?? "?"}`);
    ok("Lấy ảnh mẫu sản phẩm thành công (REST)");
  } catch (e) {
    if (JSON.stringify(e.body).includes("no reference image")) {
      ok("Product chưa có ảnh mẫu — API trả NOT_FOUND đúng logic");
    } else {
      fail("product-image (REST) failed", e.body || e);
    }
  }

  if (!firstPointCode) {
    console.log("\n⚠️  Không có điểm đo → bỏ qua test ảnh điểm đo.");
    return printSummary();
  }

  // ──────────────────────────────────────────────────────────
  //  4. ẢNH MẪU ĐIỂM ĐO (Point Reference Image)
  // ──────────────────────────────────────────────────────────

  // 4a. tRPC publicProductApi — by pointCode + productCode
  section(`4a. publicProductApi.getPointImage — point: ${firstPointCode} (by code)`);
  try {
    const data = await trpcGet("publicProductApi.getPointImage", {
      ...auth,
      pointCode: firstPointCode,
      productCode: firstProductCode,
    });
    console.log(`  Point: [${data.data?.pointCode}] ${data.data?.pointName}`);
    console.log(`  Image URL: ${data.data?.imageUrl}`);
    ok("Lấy ảnh mẫu điểm đo thành công (tRPC — by code)");
  } catch (e) {
    if (JSON.stringify(e.body).includes("no reference image")) {
      ok("Điểm đo chưa có ảnh mẫu — API trả NOT_FOUND đúng logic");
    } else {
      fail("getPointImage (by code) failed", e.body || e);
    }
  }

  // 4b. tRPC publicProductApi — by pointId
  if (firstPointId) {
    section(`4b. publicProductApi.getPointImage — pointId: ${firstPointId} (by ID)`);
    try {
      const data = await trpcGet("publicProductApi.getPointImage", {
        ...auth,
        pointId: firstPointId,
      });
      console.log(`  Point: [${data.data?.pointCode}] ${data.data?.pointName}`);
      console.log(`  Image URL: ${data.data?.imageUrl}`);
      ok("Lấy ảnh mẫu điểm đo thành công (tRPC — by ID)");
    } catch (e) {
      if (JSON.stringify(e.body).includes("no reference image")) {
        ok("Điểm đo chưa có ảnh mẫu — API trả NOT_FOUND đúng logic");
      } else {
        fail("getPointImage (by ID) failed", e.body || e);
      }
    }
  }

  // 4c. Machine API REST — GET /api/machine/point-image
  section(`4c. GET /api/machine/point-image — point: ${firstPointCode} (REST)`);
  try {
    const data = await restGet("/api/machine/point-image", {
      ...(API_KEY ? { apiKey: API_KEY } : { machineCode: MACHINE_CODE }),
      productModelCode: firstProductCode,
      pointCode: firstPointCode,
    });
    console.log(`  Point: [${data.pointCode}] ${data.pointName}`);
    console.log(`  Image URL: ${data.referenceImageUrl}`);
    console.log(`  Position: (${data.position?.x}, ${data.position?.y})`);
    ok("Lấy ảnh mẫu điểm đo thành công (REST)");
  } catch (e) {
    if (JSON.stringify(e.body).includes("no reference image")) {
      ok("Điểm đo chưa có ảnh mẫu — API trả NOT_FOUND đúng logic");
    } else {
      fail("point-image (REST) failed", e.body || e);
    }
  }

  // ──────────────────────────────────────────────────────────
  //  4d. STANDALONE REST — GET /api/measurement-point/:id/reference-image
  // ──────────────────────────────────────────────────────────
  if (firstPointId) {
    section(`4d. GET /api/measurement-point/${firstPointId}/reference-image (standalone)`);
    try {
      const data = await restGet(`/api/measurement-point/${firstPointId}/reference-image`);
      console.log(`  Point: [${data.pointCode}] ${data.pointName}`);
      console.log(`  Reference image: ${data.referenceImageUrl || "—"}`);
      console.log(`  Product ref image: ${data.productReferenceImageUrl || "—"}`);
      ok("Lấy reference image (standalone) thành công");
    } catch (e) {
      fail("measurement-point/:id/reference-image failed", e.body || e);
    }
  }

  // ──────────────────────────────────────────────────────────
  //  4e. STANDALONE REST — GET /api/product-model/:id/reference-images
  // ──────────────────────────────────────────────────────────
  section("4e. GET /api/product-model/:id/reference-images (standalone)");
  try {
    // We need the numeric product model ID — get it from get-points response
    const pts = await restGet("/api/machine/get-points", {
      ...(API_KEY ? { apiKey: API_KEY } : { machineCode: MACHINE_CODE }),
      productModelCode: firstProductCode,
    });
    const pmId = pts.productModels?.[0]?.productModelId;
    if (pmId) {
      const data = await restGet(`/api/product-model/${pmId}/reference-images`);
      console.log(`  Product: [${data.productModel?.code}] ${data.productModel?.name}`);
      console.log(`  Product ref image: ${data.productModel?.referenceImageUrl || "—"}`);
      console.log(`  Total points: ${data.totalPoints}`);
      console.log(`  Points with ref images: ${data.pointsWithRefImages}`);
      data.points?.slice(0, 5).forEach((p) => {
        console.log(`    [${p.code}] ${p.name} — refImg: ${p.referenceImageUrl || "—"}`);
      });
      ok("Lấy tất cả reference images cho product model thành công");
    } else {
      fail("Không lấy được productModelId");
    }
  } catch (e) {
    fail("product-model/:id/reference-images failed", e.body || e);
  }

  // ──────────────────────────────────────────────────────────
  //  5. UPLOAD ẢNH MẪU ĐIỂM ĐO (POST /api/machine/sync-point-image)
  // ──────────────────────────────────────────────────────────
  section(`5. POST /api/machine/sync-point-image — point: ${firstPointCode}`);
  try {
    // Tiny 1×1 red PNG for testing
    const tinyPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

    const data = await restPost("/api/machine/sync-point-image", {
      productModelCode: firstProductCode,
      pointCode: firstPointCode,
      imageBase64: tinyPng,
      imageMimeType: "image/png",
    });
    console.log(`  Point: [${data.pointCode}] (id=${data.pointId})`);
    console.log(`  Uploaded image URL: ${data.referenceImageUrl}`);
    ok("Upload ảnh mẫu điểm đo thành công");
  } catch (e) {
    fail("sync-point-image failed", e.body || e);
  }

  // ──────────────────────────────────────────────────────────
  //  6. UPLOAD ẢNH MẪU SẢN PHẨM (POST /api/machine/sync-product-image)
  // ──────────────────────────────────────────────────────────
  section(`6. POST /api/machine/sync-product-image — product: ${firstProductCode}`);
  try {
    const tinyPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

    const data = await restPost("/api/machine/sync-product-image", {
      productModelCode: firstProductCode,
      imageBase64: tinyPng,
      imageMimeType: "image/png",
      imageWidth: 1,
      imageHeight: 1,
    });
    console.log(`  Product: [${data.productModelCode}] (id=${data.productModelId})`);
    console.log(`  Uploaded image URL: ${data.imageUrl}`);
    ok("Upload ảnh mẫu sản phẩm thành công");
  } catch (e) {
    fail("sync-product-image failed", e.body || e);
  }

  // ──────────────────────────────────────────────────────────
  //  7. VERIFY UPLOADED IMAGES — Re-download and confirm
  // ──────────────────────────────────────────────────────────
  section("7. Verify — Re-download uploaded images");

  // 7a. Product image
  try {
    const data = await restGet("/api/machine/product-image", {
      ...(API_KEY ? { apiKey: API_KEY } : { machineCode: MACHINE_CODE }),
      productModelCode: firstProductCode,
    });
    if (data.data?.imageUrl) {
      ok(`Product image URL verified: ${data.data.imageUrl}`);
    } else {
      fail("Product image URL missing after upload");
    }
  } catch (e) {
    fail("verify product image failed", e.body || e);
  }

  // 7b. Point image
  try {
    const data = await restGet("/api/machine/point-image", {
      ...(API_KEY ? { apiKey: API_KEY } : { machineCode: MACHINE_CODE }),
      productModelCode: firstProductCode,
      pointCode: firstPointCode,
    });
    if (data.referenceImageUrl) {
      ok(`Point image URL verified: ${data.referenceImageUrl}`);
    } else {
      fail("Point image URL missing after upload");
    }
  } catch (e) {
    fail("verify point image failed", e.body || e);
  }

  printSummary();
}

function printSummary() {
  console.log(`\n${SEP}`);
  console.log(`  SUMMARY: ${passed} passed, ${failed} failed (total: ${passed + failed})`);
  console.log(SEP);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("\n💥 Unexpected error:", err);
  process.exit(1);
});
