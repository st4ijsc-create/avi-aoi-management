/**
 * Test all external APIs: A7, A8, A9, A10, C1-C8
 * Station AVI-01 (id=1), Product GB300-BOARD-03 (id=22), Point MP-008 (id=109)
 */

const BASE = "http://localhost:3000";
const MASTER_KEY = "master_avi_aoi_2026_G8kLmN3pQrStUvpnp";
const STATION_ID = 1;
const PRODUCT_MODEL_ID = 22;
const POINT_DEF_ID = 109;
const START_DATE = "2026-03-01";
const END_DATE = "2026-03-31";

async function api(path, params = {}) {
  const url = new URL(path, BASE);
  Object.entries(params).forEach(([k, v]) => {
    if (v != null) url.searchParams.set(k, String(v));
  });
  const res = await fetch(url.toString(), {
    headers: { "x-master-key": MASTER_KEY },
  });
  const json = await res.json();
  return { status: res.status, ...json };
}

let pass = 0, fail = 0;
function check(name, condition, detail = "") {
  if (condition) {
    pass++;
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function testA7() {
  console.log("\n=== A7. Station Statistics ===");
  const r = await api(`/api/external/stations/${STATION_ID}/statistics`, {
    startDate: START_DATE, endDate: END_DATE,
  });
  check("success", r.success === true, `success=${r.success}`);
  check("has totalInspections", r.data?.totalInspections > 0, `total=${r.data?.totalInspections}`);
  check("has okCount", r.data?.okCount >= 0, `ok=${r.data?.okCount}`);
  check("has ngCount", r.data?.ngCount >= 0, `ng=${r.data?.ngCount}`);
  check("has firstPassYield", typeof r.data?.firstPassYield === "number", `fpy=${r.data?.firstPassYield}`);
  check("station info present", !!r.data?.station?.code, `station=${r.data?.station?.code}`);

  // With productModelId filter
  const r2 = await api(`/api/external/stations/${STATION_ID}/statistics`, {
    startDate: START_DATE, endDate: END_DATE, productModelId: PRODUCT_MODEL_ID,
  });
  check("with productModelId filter", r2.success && r2.data?.totalInspections >= 0,
    `total=${r2.data?.totalInspections} (filtered)`);
}

async function testA8() {
  console.log("\n=== A8. Measurement Stats ===");
  const r = await api(`/api/external/stations/${STATION_ID}/measurement-stats`, {
    startDate: START_DATE, endDate: END_DATE,
  });
  check("success", r.success === true);
  check("has points", Array.isArray(r.data?.points) && r.data.points.length > 0,
    `pointCount=${r.data?.points?.length}`);

  // Check if MP-008 (id=109) is found
  const mp008 = r.data?.points?.find(p => p.pointDefId === POINT_DEF_ID);
  check("MP-008 (id=109) found", !!mp008, mp008
    ? `total=${mp008.totalChecks} ok=${mp008.okCount} ng=${mp008.ngCount}`
    : "NOT FOUND — workstationId points may be missing");

  // With productModelId filter
  const r2 = await api(`/api/external/stations/${STATION_ID}/measurement-stats`, {
    startDate: START_DATE, endDate: END_DATE, productModelId: PRODUCT_MODEL_ID,
  });
  check("with productModelId filter", r2.success && r2.data?.points?.length >= 0,
    `pointCount=${r2.data?.points?.length}`);

  // With groupBy=day
  const r3 = await api(`/api/external/stations/${STATION_ID}/measurement-stats`, {
    startDate: START_DATE, endDate: END_DATE, groupBy: "day",
  });
  check("groupBy=day works", r3.success && r3.data?.points?.length >= 0,
    `pointCount=${r3.data?.points?.length}`);
}

async function testA9() {
  console.log("\n=== A9. Fail History ===");
  const r = await api(`/api/external/stations/${STATION_ID}/fail-history`, {
    startDate: START_DATE, endDate: END_DATE,
  });
  check("success", r.success === true);
  check("has inspections", Array.isArray(r.data?.inspections) && r.data.inspections.length > 0,
    `inspCount=${r.data?.inspections?.length}`);
  if (r.data?.inspections?.length > 0) {
    const first = r.data.inspections[0];
    check("has serialNumber", !!first.serialNumber, `sn=${first.serialNumber}`);
    check("has failedPoints", Array.isArray(first.failedPoints), `failedPts=${first.failedPoints?.length}`);
    check("has inspectionTime", !!first.inspectionTime);
  }

  // Check if MP-008 appears in any failedPoints
  const hasMP008 = r.data?.inspections?.some(i =>
    i.failedPoints?.some(p => p.pointDefId === POINT_DEF_ID)
  );
  check("MP-008 in failedPoints", hasMP008 !== undefined,
    hasMP008 ? "YES found" : "not found (may be OK if MP-008 didn't fail)");
}

async function testA10() {
  console.log("\n=== A10. Point Detail ===");
  const r = await api(`/api/external/stations/${STATION_ID}/point-detail`, {
    startDate: START_DATE, endDate: END_DATE,
  });
  check("success", r.success === true);
  check("has points", Array.isArray(r.data?.points) && r.data.points.length > 0,
    `pointCount=${r.data?.points?.length}`);
  check("has station info", !!r.data?.station?.code, `station=${r.data?.station?.code}`);

  // Check if MP-008 (id=109) is found 
  const mp008 = r.data?.points?.find(p => p.id === POINT_DEF_ID);
  check("MP-008 (id=109) found", !!mp008, mp008
    ? `total=${mp008.totalInspected} ng=${mp008.ngCount} defectRate=${mp008.defectRate}% status=${mp008.status} errorImages=${mp008.errorImages?.length}`
    : "NOT FOUND — BUG: workstationId points missing!");

  // All points should have stats
  const pointsWithStats = r.data?.points?.filter(p => p.totalInspected > 0);
  check("points with stats", pointsWithStats?.length > 0,
    `${pointsWithStats?.length}/${r.data?.points?.length} points have data`);

  // With productModelId filter
  const r2 = await api(`/api/external/stations/${STATION_ID}/point-detail`, {
    startDate: START_DATE, endDate: END_DATE, productModelId: PRODUCT_MODEL_ID,
  });
  check("with productModelId filter", r2.success, `pointCount=${r2.data?.points?.length}`);

  // Single point filter
  const r3 = await api(`/api/external/stations/${STATION_ID}/point-detail`, {
    startDate: START_DATE, endDate: END_DATE, pointDefId: POINT_DEF_ID,
  });
  check("single point filter (MP-008)", r3.success && r3.data?.points?.length >= 0,
    `found=${r3.data?.points?.length} points`);
  if (r3.data?.points?.length === 0) {
    check("CRITICAL: MP-008 not found with pointDefId filter", false,
      "BUG: point-detail cannot find workstationId-linked points!");
  }
}

async function testC1() {
  console.log("\n=== C1. Inspection Summary ===");
  const r = await api("/api/external/inspections/summary", {
    startDate: START_DATE, endDate: END_DATE,
  });
  check("success", r.success === true);
  check("has totals", r.data?.totals?.totalInspections > 0,
    `total=${r.data?.totals?.totalInspections} ok=${r.data?.totals?.okCount} ng=${r.data?.totals?.ngCount}`);
  check("has details", Array.isArray(r.data?.details) && r.data.details.length > 0,
    `detailCount=${r.data?.details?.length}`);

  // With stationId filter
  const r2 = await api("/api/external/inspections/summary", {
    startDate: START_DATE, endDate: END_DATE, stationId: STATION_ID,
  });
  check("with stationId filter", r2.success && r2.data?.totals?.totalInspections >= 0,
    `total=${r2.data?.totals?.totalInspections}`);

  // With productModelId filter
  const r3 = await api("/api/external/inspections/summary", {
    startDate: START_DATE, endDate: END_DATE, stationId: STATION_ID, productModelId: PRODUCT_MODEL_ID,
  });
  check("with stationId+productModelId", r3.success, `total=${r3.data?.totals?.totalInspections}`);
}

async function testC2() {
  console.log("\n=== C2. Inspection Trend ===");
  // Day trend
  const r = await api("/api/external/inspections/trend", {
    startDate: START_DATE, endDate: END_DATE, groupBy: "day", stationId: STATION_ID,
  });
  check("success", r.success === true);
  check("has trend data", Array.isArray(r.data?.trend) && r.data.trend.length > 0,
    `trendPoints=${r.data?.trend?.length}`);
  if (r.data?.trend?.[0]) {
    check("trend has okCount", r.data.trend[0].okCount >= 0);
    check("trend has ngCount", r.data.trend[0].ngCount >= 0);
  }

  // Hour trend
  const r2 = await api("/api/external/inspections/trend", {
    startDate: "2026-03-15", endDate: "2026-03-15", groupBy: "hour", stationId: STATION_ID,
  });
  check("hour groupBy", r2.success, `hourlyPoints=${r2.data?.trend?.length}`);

  // Measurement-level trend (with pointDefId)
  const r3 = await api("/api/external/inspections/trend", {
    startDate: START_DATE, endDate: END_DATE, groupBy: "day", pointDefId: POINT_DEF_ID,
  });
  check("measurement-level trend (MP-008)", r3.success && r3.data?.pointDefId === POINT_DEF_ID,
    `trendPoints=${r3.data?.trend?.length} pointDefId=${r3.data?.pointDefId}`);
}

async function testC3() {
  console.log("\n=== C3. Defect Pareto ===");
  const r = await api("/api/external/inspections/defect-pareto", {
    startDate: START_DATE, endDate: END_DATE, stationId: STATION_ID,
  });
  check("success", r.success === true);
  check("has items", Array.isArray(r.data?.items) && r.data.items.length > 0,
    `itemCount=${r.data?.items?.length} totalNG=${r.data?.totalNGCount}`);
  if (r.data?.items?.[0]) {
    const top = r.data.items[0];
    check("top defect has fields", !!top.pointCode && top.ngCount > 0,
      `top: ${top.pointCode} ng=${top.ngCount} rate=${top.ngRate}%`);
    check("has cumulative percentage", typeof top.cumulativePercentage === "number");
  }
}

async function testC4() {
  console.log("\n=== C4. Inspection Images ===");
  const r = await api("/api/external/inspections/images", {
    startDate: START_DATE, endDate: END_DATE, stationId: STATION_ID, result: "NG", limit: 5,
  });
  check("success", r.success === true);
  check("has images", Array.isArray(r.data?.images), `imageCount=${r.data?.images?.length}`);
  check("has pagination", typeof r.data?.pagination?.total === "number",
    `total=${r.data?.pagination?.total}`);
  if (r.data?.images?.[0]) {
    const img = r.data.images[0];
    check("image has fields", !!img.imageUrl && !!img.result, 
      `pointCode=${img.pointCode} result=${img.result}`);
  }

  // All results
  const r2 = await api("/api/external/inspections/images", {
    startDate: START_DATE, endDate: END_DATE, stationId: STATION_ID, limit: 3,
  });
  check("all results", r2.success, `total=${r2.data?.pagination?.total}`);

  // Filter by pointDefId
  const r3 = await api("/api/external/inspections/images", {
    startDate: START_DATE, endDate: END_DATE, pointDefId: POINT_DEF_ID, result: "NG", limit: 3,
  });
  check("filter by MP-008 pointDefId", r3.success,
    `images=${r3.data?.images?.length} total=${r3.data?.pagination?.total}`);
}

async function testC5() {
  console.log("\n=== C5. Inspection Events ===");
  const r = await api("/api/external/inspections/events", {
    startDate: START_DATE, endDate: END_DATE, stationId: STATION_ID, limit: 10,
  });
  check("success", r.success === true);
  check("has events array", Array.isArray(r.data?.events), `eventCount=${r.data?.events?.length}`);
  check("has pagination", typeof r.data?.pagination?.total === "number",
    `total=${r.data?.pagination?.total}`);
  if (r.data?.events?.[0]) {
    check("event has fields", !!r.data.events[0].event, `event=${r.data.events[0].event}`);
  }
}

async function testC6() {
  console.log("\n=== C6. Measurements (MP-008) ===");
  const r = await api("/api/external/inspections/measurements", {
    pointDefId: POINT_DEF_ID, startDate: START_DATE, endDate: END_DATE, limit: 10,
  });
  check("success", r.success === true);
  check("has pointDef info", !!r.data?.pointDef?.code, `code=${r.data?.pointDef?.code} name=${r.data?.pointDef?.name}`);
  check("has measurements", Array.isArray(r.data?.measurements),
    `count=${r.data?.measurements?.length} total=${r.data?.pagination?.total}`);
  if (r.data?.measurements?.[0]) {
    const m = r.data.measurements[0];
    check("measurement has fields", m.result && m.inspectionTime,
      `result=${m.result} value=${m.measuredValue}`);
  }
  check("has pagination", typeof r.data?.pagination?.total === "number",
    `total=${r.data?.pagination?.total} hasMore=${r.data?.pagination?.hasMore}`);
}

async function testC7() {
  console.log("\n=== C7. Products List ===");
  const r = await api("/api/external/products", { limit: 10 });
  check("success", r.success === true);
  check("has products", Array.isArray(r.data?.products) && r.data.products.length > 0,
    `count=${r.data?.products?.length}`);
  check("has pagination", typeof r.data?.pagination?.total === "number",
    `total=${r.data?.pagination?.total}`);

  // Search
  const r2 = await api("/api/external/products", { search: "GB300", limit: 5 });
  check("search works", r2.success && r2.data?.products?.length >= 0,
    `found=${r2.data?.products?.length}`);

  // Check GB300-BOARD-03 exists
  const gb300 = r.data?.products?.find(p => p.id === PRODUCT_MODEL_ID);
  check("GB300-BOARD-03 in list", !!gb300, gb300 ? `code=${gb300.code}` : "not found in first page");
}

async function testC8() {
  console.log("\n=== C8. Product Detail (GB300-BOARD-03) ===");
  const r = await api(`/api/external/products/${PRODUCT_MODEL_ID}`);
  check("success", r.success === true);
  check("has product", !!r.data?.product?.code, `code=${r.data?.product?.code} name=${r.data?.product?.name}`);
  check("has measurementPoints", Array.isArray(r.data?.measurementPoints),
    `total=${r.data?.totalPoints} active=${r.data?.activePoints}`);

  // Check if MP-008 is in measurement points
  const mp008 = r.data?.measurementPoints?.find(p => p.id === POINT_DEF_ID);
  check("MP-008 in product points", !!mp008, mp008
    ? `code=${mp008.code} machineId=${mp008.machineId} type=${mp008.measurementType}`
    : "NOT FOUND");

  // 404 for non-existent product
  const r2 = await api("/api/external/products/999999");
  check("404 for missing product", r2.status === 404 || r2.success === false);
}

async function main() {
  console.log("╔═══════════════════════════════════════════════╗");
  console.log("║  External API Test — A7, A8, A9, A10, C1-C8  ║");
  console.log("╚═══════════════════════════════════════════════╝");
  console.log(`Base: ${BASE}`);
  console.log(`Station: ${STATION_ID}, Product: ${PRODUCT_MODEL_ID}, Point: ${POINT_DEF_ID}`);
  console.log(`Date: ${START_DATE} → ${END_DATE}`);

  await testA7();
  await testA8();
  await testA9();
  await testA10();
  await testC1();
  await testC2();
  await testC3();
  await testC4();
  await testC5();
  await testC6();
  await testC7();
  await testC8();

  console.log("\n════════════════════════════════════");
  console.log(`RESULTS: ${pass} passed, ${fail} failed (total: ${pass + fail})`);
  if (fail > 0) {
    console.log("⚠️  SOME TESTS FAILED — see details above");
  } else {
    console.log("✅ ALL TESTS PASSED");
  }
}

main().catch(console.error);
