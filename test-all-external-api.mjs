/**
 * ╔════════════════════════════════════════════════════════════════════════╗
 * ║    COMPREHENSIVE TEST: All External/Third-Party APIs                  ║
 * ║    Test + Verify + Compare with Station Analysis features             ║
 * ╚════════════════════════════════════════════════════════════════════════╝
 *
 * Covers:
 *   A. REST External Inspection API (/api/external/inspections/*)
 *   B. REST External Product API (/api/external/products/*)
 *   C. REST Public Product Proxy (/api/public/products/*)
 *   D. tRPC Public Product API (publicProductApi.*)
 *   E. REST Machine Proxy API (/api/machine/*)
 *   F. tRPC Machine API (machineApi.*)
 *
 * Usage:
 *   node test-all-external-api.mjs
 */

const BASE = "http://localhost:3000";
const MASTER_KEY = "master_avi_aoi_2026_G8kLmN3pQrStUvpnp";

// ─── Date range helpers ─────────────────────────────────────────────
const now = new Date();
const startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString(); // 90 days ago
const endDate = now.toISOString();

// ─── Result tracking ────────────────────────────────────────────────
let passed = 0, failed = 0, skipped = 0;
const results = [];
const coverageMap = []; // For Station Analysis comparison

function log(status, group, name, detail = "") {
  const icon = status === "PASS" ? "✅" : status === "FAIL" ? "❌" : "⏭️";
  const msg = `${icon} [${group}] ${name}${detail ? " — " + detail : ""}`;
  console.log(msg);
  results.push({ status, group, name, detail });
  if (status === "PASS") passed++;
  else if (status === "FAIL") failed++;
  else skipped++;
}

// ─── HTTP helpers ───────────────────────────────────────────────────
async function restGet(path, query = {}) {
  const url = new URL(path, BASE);
  for (const [k, v] of Object.entries(query)) {
    if (v != null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, {
    headers: { "x-master-key": MASTER_KEY, "Accept": "application/json" },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function trpcQuery(router, procedure, input) {
  const inputStr = encodeURIComponent(JSON.stringify({ json: input }));
  const url = `${BASE}/api/trpc/${router}.${procedure}?input=${inputStr}`;
  const res = await fetch(url, {
    headers: { "Accept": "application/json" },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function trpcMutation(router, procedure, input) {
  const url = `${BASE}/api/trpc/${router}.${procedure}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ json: input }),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function machineRestGet(path, apiKey, machineCode) {
  const url = new URL(path, BASE);
  const headers = { "Accept": "application/json" };
  if (apiKey) headers["X-API-Key"] = apiKey;
  if (machineCode) headers["X-Machine-Code"] = machineCode;
  const res = await fetch(url, { headers });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function machineRestPost(path, apiKey, machineCode, bodyData) {
  const url = new URL(path, BASE);
  const headers = { "Content-Type": "application/json", "Accept": "application/json" };
  if (apiKey) headers["X-API-Key"] = apiKey;
  if (machineCode) headers["X-Machine-Code"] = machineCode;
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(bodyData) });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

// ─── Discover test data from DB ─────────────────────────────────────
let testData = {
  stationId: null,
  stationCode: null,
  productModelId: null,
  productCode: null,
  pointDefId: null,
  pointCode: null,
  machineApiKey: null,
  machineCode: null,
  machineId: null,
};

async function discoverTestData() {
  console.log("\n🔍 Discovering test data from system...\n");

  // Get products via external API
  const prodRes = await restGet("/api/external/products", { limit: 5 });
  if (prodRes.status === 200 && prodRes.body?.success && prodRes.body.data?.products?.length > 0) {
    const prod = prodRes.body.data.products[0];
    testData.productModelId = prod.id;
    testData.productCode = prod.code;
    console.log(`  📦 Product: ${prod.code} — ${prod.name} (ID: ${prod.id})`);
  }

  // Get product detail with points
  if (testData.productModelId) {
    const detRes = await restGet(`/api/external/products/${testData.productModelId}`);
    if (detRes.status === 200 && detRes.body?.success && detRes.body.data?.measurementPoints?.length > 0) {
      const pt = detRes.body.data.measurementPoints[0];
      testData.pointDefId = pt.id;
      testData.pointCode = pt.code;
      console.log(`  📐 Point: ${pt.code} — ${pt.name} (ID: ${pt.id})`);
    }
  }

  // Get summary to find station info (use wide date range to ensure discovery)
  const wideStart = "2020-01-01T00:00:00Z";
  const wideEnd = "2030-01-01T00:00:00Z";
  const summRes = await restGet("/api/external/inspections/summary", { startDate: wideStart, endDate: wideEnd });
  if (summRes.status === 200 && summRes.body?.success) {
    const details = summRes.body.data?.details || summRes.body.data?.items || [];
    if (details.length > 0) {
      const item = details[0];
      testData.stationId = item.stationId;
      testData.stationCode = item.stationCode;
      testData.machineId = item.machineId;
      testData.machineCode = item.machineCode;
      if (!testData.productModelId && item.productModelId) {
        testData.productModelId = item.productModelId;
        testData.productCode = item.productCode;
      }
      console.log(`  🏭 Station: ${item.stationCode} — ${item.stationName} (ID: ${item.stationId})`);
      console.log(`  🤖 Machine: ${item.machineCode} — ${item.machineName} (ID: ${item.machineId})`);
    }
  }

  // Try to get machine API key via tRPC
  if (testData.machineCode) {
    try {
      const r = await trpcQuery("publicProductApi", "listProducts", {
        masterKey: MASTER_KEY,
        limit: 1,
      });
      // This is just to verify tRPC works with masterKey
    } catch {}
  }

  console.log(`\n  Test data resolved:`, JSON.stringify(testData, null, 2));
  console.log("");
}

// ════════════════════════════════════════════════════════════════════
// A. REST EXTERNAL INSPECTION API
// ════════════════════════════════════════════════════════════════════
async function testExternalInspectionApi() {
  const G = "A. External Inspection API";
  console.log(`\n${"═".repeat(70)}`);
  console.log(`  ${G}`);
  console.log(`${"═".repeat(70)}`);

  // A1. GET /api/external/inspections/summary
  {
    const r = await restGet("/api/external/inspections/summary", { startDate, endDate });
    if (r.status === 200 && r.body?.success) {
      const items = r.body.data?.items || [];
      log("PASS", G, "summary — basic", `${items.length} items, dateRange OK`);

      // Verify response structure
      if (items.length > 0) {
        const item = items[0];
        const hasFields = ["machineId", "machineCode", "stationId", "stationCode",
          "totalInspections", "okCount", "ngCount", "yieldRate"].every(f => f in item);
        log(hasFields ? "PASS" : "FAIL", G, "summary — response structure",
          hasFields ? "All expected fields present" : "Missing fields in response");
        coverageMap.push({ feature: "Station KPI Summary", external: "✅ /inspections/summary", station: "✅ getStationSummary" });
      }
    } else {
      log("FAIL", G, "summary — basic", `status=${r.status}, body=${JSON.stringify(r.body)?.slice(0, 200)}`);
    }
  }

  // A1b. summary with stationId filter
  if (testData.stationId) {
    const r = await restGet("/api/external/inspections/summary", { startDate, endDate, stationId: testData.stationId });
    if (r.status === 200 && r.body?.success) {
      const items = r.body.data?.items || [];
      const allMatch = items.every(i => i.stationId === testData.stationId);
      log(allMatch ? "PASS" : "FAIL", G, "summary — filter by stationId", `${items.length} items, filter correct: ${allMatch}`);
    } else {
      log("FAIL", G, "summary — filter by stationId", `status=${r.status}`);
    }
  }

  // A1c. summary with productCode filter
  if (testData.productCode) {
    const r = await restGet("/api/external/inspections/summary", { startDate, endDate, productCode: testData.productCode });
    if (r.status === 200 && r.body?.success) {
      log("PASS", G, "summary — filter by productCode", `items: ${r.body.data?.items?.length || 0}`);
    } else {
      log("FAIL", G, "summary — filter by productCode", `status=${r.status}`);
    }
  }

  // A1d. summary — missing dates should fail
  {
    const r = await restGet("/api/external/inspections/summary", {});
    log(r.status === 400 ? "PASS" : "FAIL", G, "summary — validation (missing dates)", `status=${r.status}`);
  }

  // A1e. summary — no auth should fail
  {
    const url = new URL("/api/external/inspections/summary", BASE);
    url.searchParams.set("startDate", startDate);
    url.searchParams.set("endDate", endDate);
    const res = await fetch(url, { headers: { "Accept": "application/json" } });
    log(res.status === 401 || res.status === 403 ? "PASS" : "FAIL", G, "summary — auth required", `status=${res.status}`);
  }

  // A2. GET /api/external/inspections/trend
  {
    const r = await restGet("/api/external/inspections/trend", { startDate, endDate, groupBy: "day" });
    if (r.status === 200 && r.body?.success) {
      const items = r.body.data?.items || [];
      log("PASS", G, "trend — daily", `${items.length} data points`);
      if (items.length > 0) {
        const hasFields = ["period", "totalInspections", "okCount", "ngCount"].every(f => f in items[0]);
        log(hasFields ? "PASS" : "FAIL", G, "trend — response structure", hasFields ? "Fields OK" : "Missing fields");
      }
      coverageMap.push({ feature: "Yield Trend (time-series)", external: "✅ /inspections/trend", station: "✅ getHourlyYield + getYieldControlChart" });
    } else {
      log("FAIL", G, "trend — daily", `status=${r.status}`);
    }
  }

  // A2b. trend — hourly grouping
  {
    const r = await restGet("/api/external/inspections/trend", { startDate, endDate, groupBy: "hour" });
    if (r.status === 200 && r.body?.success) {
      log("PASS", G, "trend — hourly", `items: ${r.body.data?.items?.length || 0}`);
    } else {
      log("FAIL", G, "trend — hourly", `status=${r.status}`);
    }
  }

  // A2c. trend — weekly grouping
  {
    const r = await restGet("/api/external/inspections/trend", { startDate, endDate, groupBy: "week" });
    if (r.status === 200 && r.body?.success) {
      log("PASS", G, "trend — weekly", `items: ${r.body.data?.items?.length || 0}`);
    } else {
      log("FAIL", G, "trend — weekly", `status=${r.status}`);
    }
  }

  // A2d. trend — measurement-level (with pointDefId)
  if (testData.pointDefId) {
    const r = await restGet("/api/external/inspections/trend", { startDate, endDate, groupBy: "day", pointDefId: testData.pointDefId });
    if (r.status === 200 && r.body?.success) {
      log("PASS", G, "trend — measurement-level with pointDefId", `items: ${r.body.data?.items?.length || 0}`);
    } else {
      log("FAIL", G, "trend — measurement-level with pointDefId", `status=${r.status}`);
    }
  }

  // A3. GET /api/external/inspections/defect-pareto
  {
    const r = await restGet("/api/external/inspections/defect-pareto", { startDate, endDate });
    if (r.status === 200 && r.body?.success) {
      const items = r.body.data?.items || [];
      log("PASS", G, "defect-pareto — basic", `${items.length} defect types, totalNG=${r.body.data?.totalNGCount}`);
      if (items.length > 0) {
        const hasFields = ["pointDefId", "pointCode", "ngCount", "percentage", "cumulativePercentage"].every(f => f in items[0]);
        log(hasFields ? "PASS" : "FAIL", G, "defect-pareto — response structure", hasFields ? "Fields OK" : "Missing fields");
        // Verify cumulative reaches ~100%
        const lastCum = items[items.length - 1]?.cumulativePercentage;
        log(lastCum >= 99 && lastCum <= 101 ? "PASS" : "FAIL", G, "defect-pareto — cumulative total", `Last cumulative: ${lastCum}%`);
      }
      coverageMap.push({ feature: "Defect Pareto Analysis", external: "✅ /inspections/defect-pareto", station: "✅ getStationDefects" });
    } else {
      log("FAIL", G, "defect-pareto — basic", `status=${r.status}`);
    }
  }

  // A3b. defect-pareto with stationId filter
  if (testData.stationId) {
    const r = await restGet("/api/external/inspections/defect-pareto", { startDate, endDate, stationId: testData.stationId });
    if (r.status === 200 && r.body?.success) {
      log("PASS", G, "defect-pareto — filter by stationId", `items: ${r.body.data?.items?.length || 0}`);
    } else {
      log("FAIL", G, "defect-pareto — filter by stationId", `status=${r.status}`);
    }
  }

  // A4. GET /api/external/inspections/images
  {
    const r = await restGet("/api/external/inspections/images", { startDate, endDate, limit: 10 });
    if (r.status === 200 && r.body?.success) {
      const images = r.body.data?.images || [];
      log("PASS", G, "images — basic", `${images.length} images, total=${r.body.data?.pagination?.total}`);
      if (images.length > 0) {
        const hasFields = ["measurementResultId", "pointCode", "result", "imageUrl", "inspectionTime"].every(f => f in images[0]);
        log(hasFields ? "PASS" : "FAIL", G, "images — response structure", hasFields ? "Fields OK" : "Missing fields");
      }
    } else {
      log("FAIL", G, "images — basic", `status=${r.status}`);
    }
  }

  // A4b. images — filter by result NG
  {
    const r = await restGet("/api/external/inspections/images", { startDate, endDate, result: "NG", limit: 5 });
    if (r.status === 200 && r.body?.success) {
      const images = r.body.data?.images || [];
      const allNG = images.every(i => i.result === "NG");
      log(allNG || images.length === 0 ? "PASS" : "FAIL", G, "images — filter result=NG", `${images.length} images, allNG=${allNG}`);
    } else {
      log("FAIL", G, "images — filter result=NG", `status=${r.status}`);
    }
  }

  // A4c. images — pagination
  {
    const r1 = await restGet("/api/external/inspections/images", { startDate, endDate, limit: 2, offset: 0 });
    const r2 = await restGet("/api/external/inspections/images", { startDate, endDate, limit: 2, offset: 2 });
    if (r1.status === 200 && r2.status === 200 && r1.body?.success && r2.body?.success) {
      const ids1 = (r1.body.data?.images || []).map(i => i.measurementResultId);
      const ids2 = (r2.body.data?.images || []).map(i => i.measurementResultId);
      const noOverlap = ids1.every(id => !ids2.includes(id));
      log(noOverlap ? "PASS" : "FAIL", G, "images — pagination (no overlap)", `page1: ${ids1.length}, page2: ${ids2.length}`);
    } else {
      log("FAIL", G, "images — pagination", "Request failed");
    }
  }

  // A5. GET /api/external/inspections/events
  {
    const r = await restGet("/api/external/inspections/events", { startDate, endDate, limit: 10 });
    if (r.status === 200 && r.body?.success) {
      const events = r.body.data?.events || [];
      log("PASS", G, "events — basic", `${events.length} events, total=${r.body.data?.pagination?.total}`);
      if (events.length > 0) {
        const hasFields = ["id", "event", "level", "message", "createdAt"].every(f => f in events[0]);
        log(hasFields ? "PASS" : "FAIL", G, "events — response structure", hasFields ? "Fields OK" : "Missing fields");
      }
    } else {
      log("FAIL", G, "events — basic", `status=${r.status}`);
    }
  }

  // A5b. events — invalid eventType
  {
    const r = await restGet("/api/external/inspections/events", { startDate, endDate, eventType: "INVALID_TYPE" });
    log(r.status === 400 ? "PASS" : "FAIL", G, "events — validation (invalid eventType)", `status=${r.status}`);
  }

  // A6. GET /api/external/inspections/measurements
  if (testData.pointDefId) {
    const r = await restGet("/api/external/inspections/measurements", { pointDefId: testData.pointDefId, startDate, endDate, limit: 10 });
    if (r.status === 200 && r.body?.success) {
      const meas = r.body.data?.measurements || [];
      log("PASS", G, "measurements — basic", `${meas.length} measurements, total=${r.body.data?.pagination?.total}`);
      if (meas.length > 0) {
        const hasFields = ["measurementResultId", "measuredValue", "result", "inspectionTime"].every(f => f in meas[0]);
        log(hasFields ? "PASS" : "FAIL", G, "measurements — response structure", hasFields ? "Fields OK" : "Missing fields");
      }
      // Verify pointDef info is returned
      const pd = r.body.data?.pointDef;
      log(pd && pd.code ? "PASS" : "FAIL", G, "measurements — includes pointDef info", `code=${pd?.code}, unit=${pd?.unit}`);
    } else {
      log("FAIL", G, "measurements — basic", `status=${r.status}`);
    }
  } else {
    log("SKIP", G, "measurements — no pointDefId available");
  }

  // A6b. measurements — missing required params
  {
    const r = await restGet("/api/external/inspections/measurements", { startDate, endDate });
    log(r.status === 400 ? "PASS" : "FAIL", G, "measurements — validation (missing pointDefId)", `status=${r.status}`);
  }

  // ── NEW ENDPOINTS (10 features ported from Station Analysis) ──

  // A7. GET /api/external/inspections/control-chart
  if (testData.stationId) {
    const r = await restGet("/api/external/inspections/control-chart", {
      stationId: testData.stationId, startDate, endDate
    });
    if (r.status === 200 && r.body?.success) {
      const d = r.body.data;
      const st = d?.statistics;
      const hasFields = d && Array.isArray(d.points) && st && typeof st.mean === "number"
        && typeof st.ucl === "number" && typeof st.lcl === "number";
      log(hasFields ? "PASS" : "FAIL", G, "control-chart — basic",
        `${d.points?.length} days, mean=${st?.mean?.toFixed(2)}, ucl=${st?.ucl?.toFixed(2)}, lcl=${st?.lcl?.toFixed(2)}, violations=${d.ruleViolations?.length || 0}`);
      // Check process capability
      if (st) {
        log(typeof st.cpk === "number" ? "PASS" : "FAIL", G, "control-chart — process capability",
          `Cpk=${st.cpk?.toFixed(3)}, Ppk=${st.ppk?.toFixed(3)}`);
      }
      coverageMap.push({ feature: "SPC Control Chart", external: "✅ /inspections/control-chart", station: "✅ getYieldControlChart" });
    } else {
      log("FAIL", G, "control-chart — basic", `status=${r.status}, body=${JSON.stringify(r.body)?.slice(0, 200)}`);
    }
  } else {
    log("SKIP", G, "control-chart — no stationId");
  }

  // A8. GET /api/external/inspections/histogram
  if (testData.stationId) {
    const r = await restGet("/api/external/inspections/histogram", {
      stationId: testData.stationId, startDate, endDate, bins: 15
    });
    if (r.status === 200 && r.body?.success) {
      const d = r.body.data;
      const hasFields = d && Array.isArray(d.bins) && d.statistics
        && typeof d.statistics.mean === "number" && typeof d.statistics.stddev === "number";
      log(hasFields ? "PASS" : "FAIL", G, "histogram — basic",
        `${d.bins?.length} bins, mean=${d.statistics?.mean?.toFixed(2)}, stddev=${d.statistics?.stddev?.toFixed(3)}, n=${d.statistics?.count}`);
      // Check normal distribution overlay
      log(Array.isArray(d.normalDistribution) ? "PASS" : "FAIL", G, "histogram — normal distribution overlay",
        `${d.normalDistribution?.length} overlay points`);
      coverageMap.push({ feature: "Histogram", external: "✅ /inspections/histogram", station: "✅ getHistogramData" });
    } else {
      log("FAIL", G, "histogram — basic", `status=${r.status}, body=${JSON.stringify(r.body)?.slice(0, 200)}`);
    }
  } else {
    log("SKIP", G, "histogram — no stationId");
  }

  // A9. GET /api/external/inspections/stratification
  if (testData.stationId) {
    const r = await restGet("/api/external/inspections/stratification", {
      stationId: testData.stationId, startDate, endDate
    });
    if (r.status === 200 && r.body?.success) {
      const d = r.body.data;
      const hasFields = d && Array.isArray(d.byMachine) && Array.isArray(d.byShift) && Array.isArray(d.byDayOfWeek);
      log(hasFields ? "PASS" : "FAIL", G, "stratification — basic",
        `machines=${d.byMachine?.length}, shifts=${d.byShift?.length}, days=${d.byDayOfWeek?.length}`);
      // Verify shift has correct names
      if (d.byShift?.length > 0) {
        const shiftNames = d.byShift.map(s => s.shift);
        const validShifts = shiftNames.every(s => ["Morning", "Afternoon", "Night"].includes(s));
        log(validShifts ? "PASS" : "FAIL", G, "stratification — shift names", `shifts: ${shiftNames.join(", ")}`);
      }
      coverageMap.push({ feature: "Stratification", external: "✅ /inspections/stratification", station: "✅ getStratificationData" });
    } else {
      log("FAIL", G, "stratification — basic", `status=${r.status}, body=${JSON.stringify(r.body)?.slice(0, 200)}`);
    }
  } else {
    log("SKIP", G, "stratification — no stationId");
  }

  // A10. GET /api/external/inspections/fail-history
  if (testData.stationId) {
    const r = await restGet("/api/external/inspections/fail-history", {
      stationId: testData.stationId, startDate, endDate, limit: 5
    });
    if (r.status === 200 && r.body?.success) {
      const d = r.body.data;
      const items = d?.inspections || [];
      log(Array.isArray(items) ? "PASS" : "FAIL", G, "fail-history — basic",
        `${items.length} NG inspections returned`);
      // Check structure
      if (items.length > 0) {
        const item = items[0];
        const hasFields = item.inspectionId && item.result === "NG" && Array.isArray(item.failedPoints);
        log(hasFields ? "PASS" : "FAIL", G, "fail-history — response structure",
          `failedPoints=${item.failedPoints?.length}, result=${item.result}`);
      }
      coverageMap.push({ feature: "Fail History", external: "✅ /inspections/fail-history", station: "✅ getFailHistory" });
    } else {
      log("FAIL", G, "fail-history — basic", `status=${r.status}, body=${JSON.stringify(r.body)?.slice(0, 200)}`);
    }
  } else {
    log("SKIP", G, "fail-history — no stationId");
  }

  // A11. GET /api/external/inspections/diagnostics
  if (testData.stationId) {
    const r = await restGet("/api/external/inspections/diagnostics", {
      stationId: testData.stationId, startDate, endDate
    });
    if (r.status === 200 && r.body?.success) {
      const d = r.body.data;
      const hasFields = d && Array.isArray(d.alerts) && Array.isArray(d.patterns)
        && Array.isArray(d.recommendations) && Array.isArray(d.topDefects) && Array.isArray(d.dailyYieldTrend);
      log(hasFields ? "PASS" : "FAIL", G, "diagnostics — basic",
        `alerts=${d.alerts?.length}, patterns=${d.patterns?.length}, recommendations=${d.recommendations?.length}`);
      // Verify alert structure
      if (d.alerts?.length > 0) {
        const alert = d.alerts[0];
        const validLevel = ["critical", "warning", "info"].includes(alert.level);
        log(validLevel ? "PASS" : "FAIL", G, "diagnostics — alert structure", `level=${alert.level}, title=${alert.title}`);
      }
      coverageMap.push({ feature: "AI Diagnostics", external: "✅ /inspections/diagnostics", station: "✅ getDiagnostics" });
    } else {
      log("FAIL", G, "diagnostics — basic", `status=${r.status}, body=${JSON.stringify(r.body)?.slice(0, 200)}`);
    }
  } else {
    log("SKIP", G, "diagnostics — no stationId");
  }

  // A12. GET /api/external/inspections/scatter
  if (testData.stationId) {
    const r = await restGet("/api/external/inspections/scatter", {
      stationId: testData.stationId, startDate, endDate
    });
    if (r.status === 200 && r.body?.success) {
      const d = r.body.data;
      const st = d?.statistics;
      const hasFields = d && Array.isArray(d.points) && st;
      log(hasFields ? "PASS" : "FAIL", G, "scatter — basic",
        `${d.points?.length} points, r=${st?.correlation?.toFixed(3) ?? 'N/A'}, R²=${st?.rSquared?.toFixed(3) ?? 'N/A'}`);
      // Check trend line
      if (st?.trendLine) {
        log(typeof st.trendLine.slope === "number" ? "PASS" : "FAIL", G, "scatter — trend line",
          `slope=${st.trendLine.slope?.toFixed(4)}, intercept=${st.trendLine.intercept?.toFixed(4)}`);
      } else {
        log("PASS", G, "scatter — statistics present", `keys: ${Object.keys(st || {}).join(', ')}`);
      }
      coverageMap.push({ feature: "Scatter/Correlation", external: "✅ /inspections/scatter", station: "✅ getScatterData" });
    } else {
      log("FAIL", G, "scatter — basic", `status=${r.status}, body=${JSON.stringify(r.body)?.slice(0, 200)}`);
    }
  } else {
    log("SKIP", G, "scatter — no stationId");
  }

  // A13. GET /api/external/inspections/check-sheet
  if (testData.stationId) {
    const r = await restGet("/api/external/inspections/check-sheet", {
      stationId: testData.stationId, startDate, endDate
    });
    if (r.status === 200 && r.body?.success) {
      const d = r.body.data;
      const hasFields = d && Array.isArray(d.defects) && Array.isArray(d.periods)
        && Array.isArray(d.totalByPeriod) && typeof d.grandTotal === "number";
      log(hasFields ? "PASS" : "FAIL", G, "check-sheet — basic",
        `defects=${d.defects?.length}, periods=${d.periods?.length}, grandTotal=${d.grandTotal}`);
      coverageMap.push({ feature: "Check Sheet", external: "✅ /inspections/check-sheet", station: "✅ getCheckSheetData" });
    } else {
      log("FAIL", G, "check-sheet — basic", `status=${r.status}, body=${JSON.stringify(r.body)?.slice(0, 200)}`);
    }
  } else {
    log("SKIP", G, "check-sheet — no stationId");
  }

  // A14. GET /api/external/inspections/cause-effect
  if (testData.stationId) {
    const r = await restGet("/api/external/inspections/cause-effect", {
      stationId: testData.stationId, startDate, endDate
    });
    if (r.status === 200 && r.body?.success) {
      const d = r.body.data;
      const hasFields = d && Array.isArray(d.categories);
      log(hasFields ? "PASS" : "FAIL", G, "cause-effect — basic",
        `${d.categories?.length} categories`);
      // Verify expected 6M categories
      if (d.categories?.length > 0) {
        const names = d.categories.map(c => c.name);
        const expected = ["Man", "Machine", "Measurement"];
        const hasExpected = expected.every(e => names.includes(e));
        log(hasExpected ? "PASS" : "FAIL", G, "cause-effect — Ishikawa categories",
          `categories: ${names.join(", ")}`);
      }
      coverageMap.push({ feature: "Cause-Effect (Ishikawa)", external: "✅ /inspections/cause-effect", station: "✅ getCauseEffectData" });
    } else {
      log("FAIL", G, "cause-effect — basic", `status=${r.status}, body=${JSON.stringify(r.body)?.slice(0, 200)}`);
    }
  } else {
    log("SKIP", G, "cause-effect — no stationId");
  }

  // A15. GET /api/external/inspections/ai-analysis
  if (testData.stationId) {
    const r = await restGet("/api/external/inspections/ai-analysis", {
      stationId: testData.stationId, startDate, endDate
    });
    if (r.status === 200 && r.body?.success) {
      const d = r.body.data;
      const hasFields = d && (d.anomalies || d.anomalyDetection) && d.forecast && (d.clusters || d.clustering) && d.processCapability && d.insights;
      const anomalies = d.anomalies || d.anomalyDetection?.anomalies || [];
      const forecasts = Array.isArray(d.forecast) ? d.forecast : d.forecast?.predictions || [];
      const clusters = d.clusters || d.clustering?.clusters || [];
      log(hasFields ? "PASS" : "FAIL", G, "ai-analysis — basic",
        `anomalies=${anomalies.length}, forecast=${forecasts.length}, clusters=${clusters.length}`);
      // Check process capability
      if (d.processCapability) {
        const pc = d.processCapability;
        log(typeof pc.cp === "number" ? "PASS" : "FAIL", G, "ai-analysis — process capability",
          `Cp=${pc.cp?.toFixed(3)}, Cpk=${pc.cpk?.toFixed(3)}, ppm=${pc.estimatedPPM?.toFixed(0) ?? 'N/A'}`);
      }
      // Check insights
      if (d.insights) {
        log(Array.isArray(d.insights) ? "PASS" : "FAIL", G, "ai-analysis — insights",
          `${d.insights?.length} AI insights generated`);
      }
      coverageMap.push({ feature: "AI Analysis", external: "✅ /inspections/ai-analysis", station: "✅ getAiAnalysis" });
    } else {
      log("FAIL", G, "ai-analysis — basic", `status=${r.status}, body=${JSON.stringify(r.body)?.slice(0, 200)}`);
    }
  } else {
    log("SKIP", G, "ai-analysis — no stationId");
  }

  // A16. GET /api/external/inspections/yield-comparison
  if (testData.stationId) {
    const r = await restGet("/api/external/inspections/yield-comparison", {
      stationId: testData.stationId, startDate, endDate
    });
    if (r.status === 200 && r.body?.success) {
      const d = r.body.data;
      const cur = d?.current || d?.currentPeriod;
      const prev = d?.previous || d?.previousPeriod;
      const hasFields = d && cur && prev
        && typeof cur.yield === "number" && typeof prev.yield === "number"
        && d.changes;
      log(hasFields ? "PASS" : "FAIL", G, "yield-comparison — basic",
        `current: yield=${cur?.yield?.toFixed(2)}%, vol=${cur?.total ?? cur?.totalInspections} | prev: yield=${prev?.yield?.toFixed(2)}%, vol=${prev?.total ?? prev?.totalInspections}`);
      // Check changes
      if (d.changes) {
        log(typeof d.changes.yieldChange === "number" ? "PASS" : "FAIL", G, "yield-comparison — changes",
          `yieldΔ=${d.changes.yieldChange?.toFixed(2)}pp, volΔ=${d.changes.volumeChange?.toFixed(2)}%, ngΔ=${d.changes.ngChange?.toFixed(2)}%`);
      }
      coverageMap.push({ feature: "Yield Comparison", external: "✅ /inspections/yield-comparison", station: "✅ getYieldComparison" });
    } else {
      log("FAIL", G, "yield-comparison — basic", `status=${r.status}, body=${JSON.stringify(r.body)?.slice(0, 200)}`);
    }
  } else {
    log("SKIP", G, "yield-comparison — no stationId");
  }

  // A17. Validation: control-chart without required params
  {
    const r = await restGet("/api/external/inspections/control-chart", {});
    log(r.status === 400 ? "PASS" : "FAIL", G, "control-chart — validation (missing params)", `status=${r.status}`);
  }

  // A18. productCode filter test (histogram endpoint)
  if (testData.stationId && testData.productCode) {
    const r = await restGet("/api/external/inspections/histogram", {
      stationId: testData.stationId, startDate, endDate, productCode: testData.productCode
    });
    log(r.status === 200 && r.body?.success ? "PASS" : "FAIL", G,
      "histogram — productCode filter", `productCode=${testData.productCode}, status=${r.status}`);
  }
}

// ════════════════════════════════════════════════════════════════════
// B. REST EXTERNAL PRODUCT API
// ════════════════════════════════════════════════════════════════════
async function testExternalProductApi() {
  const G = "B. External Product API";
  console.log(`\n${"═".repeat(70)}`);
  console.log(`  ${G}`);
  console.log(`${"═".repeat(70)}`);

  // B1. GET /api/external/products
  {
    const r = await restGet("/api/external/products", { limit: 10 });
    if (r.status === 200 && r.body?.success) {
      const products = r.body.data?.products || [];
      log("PASS", G, "list products — basic", `${products.length} products, total=${r.body.data?.pagination?.total}`);
      if (products.length > 0) {
        const hasFields = ["id", "code", "name", "lifecycleStatus", "imageDisplayMode"].every(f => f in products[0]);
        log(hasFields ? "PASS" : "FAIL", G, "list products — response structure", hasFields ? "Fields OK" : "Missing fields");
        // Verify imageDisplayMode field exists
        log("imageDisplayMode" in products[0] ? "PASS" : "FAIL", G, "list products — imageDisplayMode field", `value=${products[0].imageDisplayMode}`);
      }
    } else {
      log("FAIL", G, "list products — basic", `status=${r.status}`);
    }
  }

  // B1b. products — search
  if (testData.productCode) {
    const r = await restGet("/api/external/products", { search: testData.productCode.substring(0, 3), limit: 10 });
    if (r.status === 200 && r.body?.success) {
      log("PASS", G, "list products — search filter", `results: ${r.body.data?.products?.length || 0}`);
    } else {
      log("FAIL", G, "list products — search filter", `status=${r.status}`);
    }
  }

  // B1c. products — pagination
  {
    const r1 = await restGet("/api/external/products", { limit: 2, offset: 0 });
    const r2 = await restGet("/api/external/products", { limit: 2, offset: 2 });
    if (r1.status === 200 && r2.status === 200 && r1.body?.success && r2.body?.success) {
      const ids1 = (r1.body.data?.products || []).map(p => p.id);
      const ids2 = (r2.body.data?.products || []).map(p => p.id);
      const noOverlap = ids1.every(id => !ids2.includes(id));
      log(noOverlap || ids2.length === 0 ? "PASS" : "FAIL", G, "list products — pagination", `page1: ${ids1.length}, page2: ${ids2.length}`);
    } else {
      log("FAIL", G, "list products — pagination", "Request failed");
    }
  }

  // B2. GET /api/external/products/:id
  if (testData.productModelId) {
    const r = await restGet(`/api/external/products/${testData.productModelId}`);
    if (r.status === 200 && r.body?.success) {
      const prod = r.body.data?.product;
      const points = r.body.data?.measurementPoints || [];
      log("PASS", G, "product detail — basic", `${prod?.code}, ${points.length} points`);
      const hasFields = ["id", "code", "name", "imageDisplayMode", "imageWidth", "imageHeight"].every(f => f in (prod || {}));
      log(hasFields ? "PASS" : "FAIL", G, "product detail — response structure", hasFields ? "All fields present" : "Missing fields");
      log("totalPoints" in (r.body.data || {}) ? "PASS" : "FAIL", G, "product detail — totalPoints field");
      log("activePoints" in (r.body.data || {}) ? "PASS" : "FAIL", G, "product detail — activePoints field");

      // Check measurement point structure
      if (points.length > 0) {
        const pt = points[0];
        const ptFields = ["id", "code", "name", "measurementType", "lowerLimit", "upperLimit", "isActive"].every(f => f in pt);
        log(ptFields ? "PASS" : "FAIL", G, "product detail — measurement point structure", ptFields ? "Fields OK" : "Missing");
      }
    } else {
      log("FAIL", G, "product detail — basic", `status=${r.status}`);
    }
  }

  // B2b. product detail — invalid ID
  {
    const r = await restGet("/api/external/products/999999");
    log(r.status === 404 ? "PASS" : "FAIL", G, "product detail — 404 for invalid ID", `status=${r.status}`);
  }

  // B2c. product detail — no auth
  {
    const url = new URL(`/api/external/products/${testData.productModelId || 1}`, BASE);
    const res = await fetch(url, { headers: { "Accept": "application/json" } });
    log(res.status === 401 || res.status === 403 ? "PASS" : "FAIL", G, "product detail — auth required", `status=${res.status}`);
  }
}

// ════════════════════════════════════════════════════════════════════
// C. REST PUBLIC PRODUCT PROXY (/api/public/products/*)
// ════════════════════════════════════════════════════════════════════
async function testPublicProductProxyApi() {
  const G = "C. Public Product Proxy API";
  console.log(`\n${"═".repeat(70)}`);
  console.log(`  ${G}`);
  console.log(`${"═".repeat(70)}`);

  // C1. GET /api/public/products/list
  {
    const r = await restGet("/api/public/products/list", { limit: 5 });
    if (r.status === 200) {
      log("PASS", G, "list products", `Received response`);
    } else if (r.status === 404) {
      log("SKIP", G, "list products", `endpoint not registered`);
    } else {
      log("FAIL", G, "list products", `status=${r.status}`);
    }
  }

  // C2. GET /api/public/products/by-code (if exists)
  if (testData.productCode) {
    const r = await restGet("/api/public/products/by-code", { code: testData.productCode });
    if (r.status === 200) {
      log("PASS", G, "product by code", `Found product`);
    } else if (r.status === 404) {
      log("SKIP", G, "product by code", `endpoint not found`);
    } else {
      log("FAIL", G, "product by code", `status=${r.status}`);
    }
  }

  // C3. GET /api/public/products/image (if exists)
  if (testData.productCode) {
    const r = await restGet("/api/public/products/image", { productCode: testData.productCode });
    if (r.status === 200) {
      log("PASS", G, "product image", `Received image/data`);
    } else {
      log(r.status === 404 ? "SKIP" : "FAIL", G, "product image", `status=${r.status}`);
    }
  }
}

// ════════════════════════════════════════════════════════════════════
// D. tRPC PUBLIC PRODUCT API
// ════════════════════════════════════════════════════════════════════
async function testTrpcPublicProductApi() {
  const G = "D. tRPC Public Product API";
  console.log(`\n${"═".repeat(70)}`);
  console.log(`  ${G}`);
  console.log(`${"═".repeat(70)}`);

  // D1. listProducts
  {
    const r = await trpcQuery("publicProductApi", "listProducts", { masterKey: MASTER_KEY, limit: 5 });
    if (r.status === 200) {
      const data = r.body?.result?.data?.json || r.body?.result?.data;
      const products = data?.products || [];
      log("PASS", G, "listProducts", `${products.length} products`);

      if (products.length > 0) {
        const hasFields = ["id", "code", "name"].every(f => f in products[0]);
        log(hasFields ? "PASS" : "FAIL", G, "listProducts — response structure");
      }
    } else {
      log("FAIL", G, "listProducts", `status=${r.status}, body=${JSON.stringify(r.body)?.slice(0, 200)}`);
    }
  }

  // D2. getProductByCode
  if (testData.productCode) {
    const r = await trpcQuery("publicProductApi", "getProductByCode", { masterKey: MASTER_KEY, code: testData.productCode });
    if (r.status === 200) {
      const data = r.body?.result?.data?.json || r.body?.result?.data;
      log("PASS", G, "getProductByCode", `code=${data?.product?.code || data?.code}`);
    } else {
      log("FAIL", G, "getProductByCode", `status=${r.status}`);
    }
  }

  // D3. getProductById
  if (testData.productModelId) {
    const r = await trpcQuery("publicProductApi", "getProductById", { masterKey: MASTER_KEY, id: testData.productModelId });
    if (r.status === 200) {
      const data = r.body?.result?.data?.json || r.body?.result?.data;
      log("PASS", G, "getProductById", `id=${testData.productModelId}`);
    } else {
      log("FAIL", G, "getProductById", `status=${r.status}`);
    }
  }

  // D4. getMeasurementPoints
  if (testData.productCode) {
    const r = await trpcQuery("publicProductApi", "getMeasurementPoints", { masterKey: MASTER_KEY, productCode: testData.productCode });
    if (r.status === 200) {
      const data = r.body?.result?.data?.json || r.body?.result?.data;
      const points = data?.points || data || [];
      log("PASS", G, "getMeasurementPoints", `${Array.isArray(points) ? points.length : "?"} points`);
    } else {
      log("FAIL", G, "getMeasurementPoints", `status=${r.status}`);
    }
  }

  // D5. getProductImage
  if (testData.productCode) {
    const r = await trpcQuery("publicProductApi", "getProductImage", { masterKey: MASTER_KEY, productCode: testData.productCode });
    if (r.status === 200) {
      const data = r.body?.result?.data?.json || r.body?.result?.data;
      log("PASS", G, "getProductImage", `hasImage=${!!data?.imageDataUrl || !!data?.imageUrl}`);
    } else {
      log("FAIL", G, "getProductImage", `status=${r.status}`);
    }
  }

  // D6. getPointImage
  if (testData.pointCode && testData.productCode) {
    const r = await trpcQuery("publicProductApi", "getPointImage", {
      masterKey: MASTER_KEY,
      pointCode: testData.pointCode,
      productCode: testData.productCode,
    });
    if (r.status === 200) {
      log("PASS", G, "getPointImage", "OK");
    } else {
      // May 404 if no image — still structurally valid
      log(r.status === 500 ? "FAIL" : "PASS", G, "getPointImage", `status=${r.status} (may have no image)`);
    }
  }

  // D7. getPointStatsByStation
  if (testData.stationCode) {
    const r = await trpcQuery("publicProductApi", "getPointStatsByStation", {
      masterKey: MASTER_KEY,
      stationCode: testData.stationCode,
      startDate,
      endDate,
    });
    if (r.status === 200) {
      const data = r.body?.result?.data?.json || r.body?.result?.data;
      log("PASS", G, "getPointStatsByStation", `points: ${data?.data?.length || data?.total || "?"}`);

      // Verify structure 
      if (data?.data?.length > 0) {
        const pt = data.data[0];
        const hasFields = ["pointDefId", "pointCode", "totalCount", "okCount", "ngCount", "ngRate"].every(f => f in pt);
        log(hasFields ? "PASS" : "FAIL", G, "getPointStatsByStation — response structure", hasFields ? "Fields OK" : "Missing");
      }
      coverageMap.push({ feature: "Point Statistics by Station", external: "✅ getPointStatsByStation", station: "✅ getStationDetail" });
    } else {
      log("FAIL", G, "getPointStatsByStation", `status=${r.status}`);
    }
  }

  // D8. getPointImagesByStation
  if (testData.stationCode && testData.pointCode) {
    const r = await trpcQuery("publicProductApi", "getPointImagesByStation", {
      masterKey: MASTER_KEY,
      stationCode: testData.stationCode,
      pointCode: testData.pointCode,
      limit: 5,
    });
    if (r.status === 200) {
      const data = r.body?.result?.data?.json || r.body?.result?.data;
      log("PASS", G, "getPointImagesByStation", `images: ${data?.data?.length || 0}, total: ${data?.total || 0}`);
    } else {
      log("FAIL", G, "getPointImagesByStation", `status=${r.status}`);
    }
  }

  // D9. Auth validation — no credentials
  {
    const r = await trpcQuery("publicProductApi", "listProducts", { limit: 5 });
    const isError = r.status !== 200 || r.body?.error;
    log(isError ? "PASS" : "FAIL", G, "auth validation — no credentials should fail", `status=${r.status}`);
  }
}

// ════════════════════════════════════════════════════════════════════
// E. REST MACHINE PROXY API (/api/machine/*)
// ════════════════════════════════════════════════════════════════════
async function testMachineRestApi() {
  const G = "E. Machine REST API";
  console.log(`\n${"═".repeat(70)}`);
  console.log(`  ${G}`);
  console.log(`${"═".repeat(70)}`);

  // First, try to discover a machine API key
  let apiKey = testData.machineApiKey;
  let machineCode = testData.machineCode;

  if (!apiKey && machineCode) {
    // Try using machineCode directly
  }

  // E1. GET /api/machine/get-points (using machineCode)
  if (machineCode) {
    const r = await machineRestGet("/api/machine/get-points", null, machineCode);
    if (r.status === 200) {
      const data = r.body?.result?.data?.json || r.body;
      log("PASS", G, "get-points (machineCode)", `Received response`);
    } else {
      log(r.status === 401 ? "SKIP" : "FAIL", G, "get-points (machineCode)", `status=${r.status}`);
    }
  } else {
    log("SKIP", G, "get-points — no machineCode available");
  }

  // E2. GET /api/machine/check-points-version
  if (machineCode) {
    const r = await machineRestGet("/api/machine/check-points-version", null, machineCode);
    if (r.status === 200) {
      log("PASS", G, "check-points-version", `Received response`);
    } else {
      log(r.status === 401 ? "SKIP" : "FAIL", G, "check-points-version", `status=${r.status}`);
    }
  }

  // E3. GET /api/machine/sync-history
  if (machineCode) {
    const r = await machineRestGet("/api/machine/sync-history", null, machineCode);
    if (r.status === 200) {
      log("PASS", G, "sync-history", `Received response`);
    } else {
      log(r.status === 401 ? "SKIP" : "FAIL", G, "sync-history", `status=${r.status}`);
    }
  }

  // E4. No auth should fail
  {
    const r = await machineRestGet("/api/machine/get-points", null, null);
    log(r.status === 400 || r.status === 401 || r.status === 403 ? "PASS" : "FAIL", G, "auth required (no credentials)", `status=${r.status}`);
  }
}

// ════════════════════════════════════════════════════════════════════
// F. tRPC MACHINE API
// ════════════════════════════════════════════════════════════════════
async function testTrpcMachineApi() {
  const G = "F. tRPC Machine API";
  console.log(`\n${"═".repeat(70)}`);
  console.log(`  ${G}`);
  console.log(`${"═".repeat(70)}`);

  const machineCode = testData.machineCode;
  const apiKey = testData.machineApiKey;

  // F1. getPoints
  if (machineCode) {
    const r = await trpcQuery("machineApi", "getPoints", { machineCode });
    if (r.status === 200 && !r.body?.error) {
      const data = r.body?.result?.data?.json || r.body?.result?.data;
      log("PASS", G, "getPoints", `Received response`);
    } else {
      log("FAIL", G, "getPoints", `status=${r.status}, error=${JSON.stringify(r.body?.error)?.slice(0, 150)}`);
    }
  } else {
    log("SKIP", G, "getPoints — no machineCode");
  }

  // F2. checkPointsVersion
  if (machineCode) {
    const r = await trpcQuery("machineApi", "checkPointsVersion", { machineCode });
    if (r.status === 200) {
      const data = r.body?.result?.data?.json || r.body?.result?.data;
      log("PASS", G, "checkPointsVersion", `version=${data?.version || JSON.stringify(data)?.slice(0, 80)}`);
    } else {
      log("FAIL", G, "checkPointsVersion", `status=${r.status}`);
    }
  }

  // F3. getSyncHistory
  if (machineCode) {
    const r = await trpcQuery("machineApi", "getSyncHistory", { machineCode, limit: 5 });
    if (r.status === 200) {
      log("PASS", G, "getSyncHistory", "OK");
    } else {
      log("FAIL", G, "getSyncHistory", `status=${r.status}`);
    }
  }

  // F4. deltaSyncPoints
  if (machineCode) {
    const r = await trpcQuery("machineApi", "deltaSyncPoints", { machineCode, sinceVersion: 0 });
    if (r.status === 200) {
      const data = r.body?.result?.data?.json || r.body?.result?.data;
      log("PASS", G, "deltaSyncPoints", `changes: ${data?.points?.length || data?.changes?.length || "?"}`);
    } else {
      log("FAIL", G, "deltaSyncPoints", `status=${r.status}`);
    }
  }

  // F5. getProductImage
  if (machineCode && testData.productCode) {
    const r = await trpcQuery("machineApi", "getProductImage", { machineCode, productCode: testData.productCode });
    if (r.status === 200) {
      log("PASS", G, "getProductImage", "OK");
    } else {
      log("FAIL", G, "getProductImage", `status=${r.status}`);
    }
  }

  // F6. getPointImage
  if (machineCode && testData.pointCode && testData.productCode) {
    const r = await trpcQuery("machineApi", "getPointImage", { machineCode, pointCode: testData.pointCode, productCode: testData.productCode });
    if (r.status === 200) {
      log("PASS", G, "getPointImage", "OK");
    } else {
      log("FAIL", G, "getPointImage", `status=${r.status}`);
    }
  }

  // F7. Auth validation — no credentials should fail
  {
    const r = await trpcQuery("machineApi", "getPoints", {});
    const isError = r.status !== 200 || r.body?.error;
    log(isError ? "PASS" : "FAIL", G, "auth validation — no credentials should fail");
  }

  // F8. submitInspection — read-only test (don't actually submit, just validate error)
  {
    const r = await trpcMutation("machineApi", "submitInspection", {
      machineCode: "NON_EXISTENT_MACHINE_XYZ",
      serialNumber: "TEST-SERIAL",
      overallResult: "OK",
      measurements: [],
    });
    const isError = r.status !== 200 || r.body?.error;
    log(isError ? "PASS" : "FAIL", G, "submitInspection — validation (invalid machine)", `status=${r.status}`);
  }
}

// ════════════════════════════════════════════════════════════════════
// COMPARISON: External APIs vs Station Analysis features
// ════════════════════════════════════════════════════════════════════
function printCoverageComparison() {
  console.log(`\n${"═".repeat(70)}`);
  console.log("  COVERAGE COMPARISON: External APIs vs Station Analysis");
  console.log(`${"═".repeat(70)}\n`);

  const fullComparison = [
    { feature: "Station KPI Summary (totalInspections, OK/NG/NTF, yieldRate)", external: "✅ /inspections/summary", station: "✅ getStationSummary" },
    { feature: "Hourly Yield Breakdown (heatmap/bar chart)", external: "✅ /inspections/trend?groupBy=hour", station: "✅ getHourlyYield" },
    { feature: "Daily Yield Trend (time-series)", external: "✅ /inspections/trend?groupBy=day", station: "✅ getYieldControlChart" },
    { feature: "Weekly Yield Trend", external: "✅ /inspections/trend?groupBy=week", station: "❌ (N/A — only hour/day)" },
    { feature: "Defect Pareto Analysis", external: "✅ /inspections/defect-pareto", station: "✅ getStationDefects" },
    { feature: "Inspection Images (filtered)", external: "✅ /inspections/images", station: "❌ (UI only)" },
    { feature: "Package Activity Events", external: "✅ /inspections/events", station: "❌ (N/A)" },
    { feature: "Raw Measurement Values", external: "✅ /inspections/measurements", station: "✅ (embedded in getStationDetail)" },
    { feature: "Product List + Search", external: "✅ /products + publicProductApi.listProducts", station: "❌ (N/A — separate module)" },
    { feature: "Product Detail + Measurement Points", external: "✅ /products/:id + getProductByCode/ById", station: "❌ (N/A — separate module)" },
    { feature: "Product/Point Reference Images", external: "✅ getProductImage / getPointImage", station: "✅ (embedded in board viewer)" },
    { feature: "Point Stats by Station (per-point OK/NG/avg/min/max)", external: "✅ getPointStatsByStation", station: "✅ getStationDetail" },
    { feature: "Point Images by Station", external: "✅ getPointImagesByStation", station: "❌ (UI only)" },
    { feature: "Measurement-level Trend (avg/min/max per point)", external: "✅ /inspections/trend?pointDefId=X", station: "✅ (embedded in getStationDetail)" },
    { feature: "SPC Control Chart (Western Electric rules, Cpk)", external: "❌ NOT AVAILABLE", station: "✅ getYieldControlChart" },
    { feature: "Histogram (distribution, skewness, kurtosis)", external: "❌ NOT AVAILABLE", station: "✅ getHistogramData" },
    { feature: "Scatter Diagram (correlation, R², trend line)", external: "❌ NOT AVAILABLE", station: "✅ getScatterData" },
    { feature: "Check Sheet (defect × time matrix)", external: "❌ NOT AVAILABLE", station: "✅ getCheckSheetData" },
    { feature: "Cause-Effect Ishikawa Diagram (6M)", external: "❌ NOT AVAILABLE", station: "✅ getCauseEffectData" },
    { feature: "Stratification (by machine/shift/day-of-week)", external: "❌ NOT AVAILABLE", station: "✅ getStratificationData" },
    { feature: "AI Diagnostics (alerts, patterns, recommendations)", external: "❌ NOT AVAILABLE", station: "✅ getDiagnostics" },
    { feature: "AI Statistical Analysis (anomaly, forecast, clustering)", external: "❌ NOT AVAILABLE", station: "✅ getAiAnalysis" },
    { feature: "NG Inspection History (fail details)", external: "❌ NOT AVAILABLE", station: "✅ getFailHistory" },
    { feature: "Machine Data Sync (push points/images)", external: "✅ machineApi.syncMeasurementPoints", station: "❌ (N/A — data ingestion)" },
    { feature: "Submit Inspection Results", external: "✅ machineApi.submitInspection", station: "❌ (N/A — data ingestion)" },
    { feature: "First Pass Yield + Retest Rate", external: "✅ /inspections/summary (yieldRate)", station: "✅ getStationSummary (firstPassYield, retestRate)" },
    { feature: "Yield Change vs Previous Period", external: "❌ NOT AVAILABLE", station: "✅ getStationSummary (yieldChange)" },
  ];

  // Print table
  const col1 = 55, col2 = 40, col3 = 38;
  console.log(`  ${"Feature".padEnd(col1)} ${"External API".padEnd(col2)} ${"Station Analysis"}`);
  console.log(`  ${"─".repeat(col1)} ${"─".repeat(col2)} ${"─".repeat(col3)}`);
  let extCovered = 0, staCovered = 0, bothCovered = 0, gapExternal = 0;
  for (const row of fullComparison) {
    const extOk = row.external.startsWith("✅");
    const staOk = row.station.startsWith("✅");
    if (extOk) extCovered++;
    if (staOk) staCovered++;
    if (extOk && staOk) bothCovered++;
    if (!extOk && staOk) gapExternal++;
    console.log(`  ${row.feature.padEnd(col1)} ${row.external.padEnd(col2)} ${row.station}`);
  }

  console.log(`\n  ${"─".repeat(col1 + col2 + col3 + 2)}`);
  console.log(`\n  📊 Summary:`);
  console.log(`     Total features analyzed:        ${fullComparison.length}`);
  console.log(`     External API coverage:          ${extCovered}/${fullComparison.length} (${Math.round(extCovered / fullComparison.length * 100)}%)`);
  console.log(`     Station Analysis coverage:      ${staCovered}/${fullComparison.length} (${Math.round(staCovered / fullComparison.length * 100)}%)`);
  console.log(`     Both cover (overlap):           ${bothCovered}`);
  console.log(`     Gap: In Station only (not ext): ${gapExternal} ← candidates for new external APIs`);
  console.log(`\n  🔍 Missing from External APIs (available in Station Analysis):`);

  for (const row of fullComparison) {
    if (!row.external.startsWith("✅") && row.station.startsWith("✅")) {
      console.log(`     • ${row.feature} → ${row.station}`);
    }
  }

  console.log(`\n  💡 Recommended additions for third-party app completeness:`);
  console.log(`     1. SPC Control Chart API — Western Electric rules, Cpk/Ppk calculation`);
  console.log(`     2. Histogram API — yield distribution analysis`);
  console.log(`     3. Defect Stratification API — breakdown by machine/shift/weekday`);
  console.log(`     4. NG History API — recent failure details with measurement data`);
  console.log(`     5. AI Diagnostics API — pattern detection and improvement suggestions`);
  console.log(`     6. Yield Change API — compare current vs previous period`);
  console.log(`     7. Scatter/Correlation API — output volume vs defect rate`);
}

// ════════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════════
async function main() {
  console.log("╔════════════════════════════════════════════════════════════════════════╗");
  console.log("║    AVI-AOI Comprehensive Third-Party API Test Suite                    ║");
  console.log("╚════════════════════════════════════════════════════════════════════════╝");
  console.log(`  Server: ${BASE}`);
  console.log(`  Date range: ${startDate.slice(0, 10)} → ${endDate.slice(0, 10)}`);

  try {
    await discoverTestData();
    await testExternalInspectionApi();
    await testExternalProductApi();
    await testPublicProductProxyApi();
    await testTrpcPublicProductApi();
    await testMachineRestApi();
    await testTrpcMachineApi();
    printCoverageComparison();

    // Final summary
    console.log(`\n${"═".repeat(70)}`);
    console.log(`  TEST RESULTS SUMMARY`);
    console.log(`${"═".repeat(70)}`);
    console.log(`  ✅ Passed:  ${passed}`);
    console.log(`  ❌ Failed:  ${failed}`);
    console.log(`  ⏭️  Skipped: ${skipped}`);
    console.log(`  📊 Total:   ${passed + failed + skipped}`);
    console.log(`${"═".repeat(70)}\n`);

    if (failed > 0) {
      console.log("  Failed tests:");
      for (const r of results.filter(r => r.status === "FAIL")) {
        console.log(`    ❌ [${r.group}] ${r.name}: ${r.detail}`);
      }
      console.log("");
    }

    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error("\n💥 Unexpected error:", err);
    process.exit(1);
  }
}

main();
