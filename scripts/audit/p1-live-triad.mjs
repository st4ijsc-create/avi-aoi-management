// scripts/audit/p1-live-triad.mjs
// ─────────────────────────────────────────────────────────────────────────────
// P1-LIVE — audit "bộ ba" LIVE / STALE / RECOVER cho mọi màn (ưu tiên #1).
//
// 4 ĐIỀU KIỆN BẮT BUỘC (theo Q7b):
//   1) Tài khoản chỉ-đọc (chọn account read-only + role qua env).
//   2) Ưu tiên staging có phát lại — ở đây dùng bản nội bộ + simOtTelemetry (realtime).
//   3) CHẶN MỌI REQUEST ≠ GET ở tầng route Playwright (context.route abort).
//   4) Script KHÔNG sửa gì — chỉ điều hướng, chụp, đo. Login là setup (trước khi bật chặn).
//
// Bộ ba mỗi màn: LIVE → context.setOffline(true) → chờ → STALE → setOffline(false) → RECOVER.
// Quan sát máy-đọc: banner offline có hiện? badge live/stream có KẸT khi offline? (AUD-01/G8).
//
// KHÔNG hardcode credential. Đọc từ env:
//   AUDIT_BASE (mặc định http://localhost:3000)
//   AUDIT_USER, AUDIT_PASS   (bắt buộc — account đã TẮT 2FA)
//   AUDIT_ROLE               (nhãn: operator|admin|... — chỉ để đặt tên thư mục/kết quả)
//   AUDIT_MODE               (tier1 [mặc định] | full)
//   AUDIT_OUT                (thư mục ảnh + json; mặc định ./audit-artifacts/p1-live)
//   AUDIT_SETTLE / AUDIT_STALE_WAIT / AUDIT_RECOVER_WAIT (ms; mặc định 3500 / 12000 / 10000)
//   AUDIT_LIMIT              (số màn tối đa; để trống = tất cả theo MODE)
// ─────────────────────────────────────────────────────────────────────────────
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const BASE = process.env.AUDIT_BASE || "http://localhost:3000";
const USER = process.env.AUDIT_USER;
const PASS = process.env.AUDIT_PASS;
const ROLE = process.env.AUDIT_ROLE || "unknown";
const MODE = (process.env.AUDIT_MODE || "tier1").toLowerCase();
const OUT = process.env.AUDIT_OUT || path.resolve("audit-artifacts", "p1-live");
const SETTLE = Number(process.env.AUDIT_SETTLE || 3500);
const STALE_WAIT = Number(process.env.AUDIT_STALE_WAIT || 12000);
const RECOVER_WAIT = Number(process.env.AUDIT_RECOVER_WAIT || 10000);
const LIMIT = process.env.AUDIT_LIMIT ? Number(process.env.AUDIT_LIMIT) : Infinity;
const VIEWPORT = { width: 1600, height: 900 }; // ~màn HMI phổ biến; đo "cái nhìn thấy" (G4)

if (!USER || !PASS) {
  console.error("THIẾU AUDIT_USER / AUDIT_PASS. Đặt env cho account đã TẮT 2FA rồi chạy lại.");
  process.exit(2);
}

// Màn realtime-bearing (bộ ba có giá trị chẩn đoán cao nhất — test trực tiếp G8/AUD-01/06).
const TIER1 = [
  "/dashboard", "/andon", "/predictive-alerts", "/control-tower", "/production-dashboard",
  "/war-room", "/mes-control-tower", "/wip-dashboard", "/digital-twin", "/device-monitor",
  "/factory-command", "/line-view", "/alarm-kpi", "/sla-cockpit", "/machine-status",
  "/machine-health", "/oee-dashboard", "/factory-live-map", "/field-devices", "/mqtt-dashboard",
  "/command-center", "/digital-twin-center", "/engineering", "/fleet-orchestration",
  "/safety-workforce", "/robot-control", "/alerts",
];

// Toàn bộ màn thật (bỏ /login /setup /404 và các route cần :param bắt buộc).
const FULL = [
  "/", "/api-docs", "/dashboard", "/ops-console", "/andon", "/predictive-alerts",
  "/dashboard-center", "/drill-down", "/corporate-dashboard", "/control-tower", "/executive",
  "/corporate-layout", "/production-dashboard", "/war-room", "/mes-control-tower", "/wip-dashboard",
  "/traceability", "/digital-twin", "/history", "/aoi-packages", "/production-orders",
  "/production-scheduling", "/production-signoff", "/history-export-scheduling", "/bom-management",
  "/product-comparison", "/quality-cockpit", "/quality-home", "/golden-samples", "/defect-catalog",
  "/measurement-point-health", "/repair-station", "/quality-gate-templates", "/quality-gates",
  "/spc-analysis", "/spc-advanced", "/pareto-analysis", "/annotation-statistics",
  "/annotation-comparison", "/defect-heatmap", "/defect-prediction", "/root-cause-analysis",
  "/device-monitor", "/factory-command", "/line-view", "/sop", "/sop-management", "/alarm-kpi",
  "/sla-cockpit", "/machine-status", "/machine-health", "/oee-dashboard", "/factory-live-map",
  "/field-devices", "/connectivity", "/mqtt-dashboard", "/mqtt-bulletin", "/mqtt-replay",
  "/mqtt-clients", "/mqtt-alerts", "/mqtt-profiles", "/mqtt-topics", "/mqtt-ng-rate",
  "/machine-onboarding", "/aoi-onboarding", "/product-onboarding", "/product-changeover",
  "/machine-registration", "/device-adapters", "/uns-mapping", "/system-health", "/control-readiness",
  "/edge-nodes", "/hot-folders", "/robot-control", "/command-console", "/fleet-orchestration",
  "/control-plane", "/safety-workforce", "/robot-model-health", "/equipment-standards",
  "/equipment-integration", "/engineering-home", "/engineering", "/recipes", "/interlock-rules",
  "/orchestration-studio", "/ir-editor", "/pou-studio", "/programming-copilot", "/factory-floor-editor",
  "/rf-test-cell", "/cell-twin", "/digital-twin-center", "/command-center", "/technician-copilot",
  "/work-orders", "/cmms", "/feeder-verify", "/alerts", "/monitoring-setting", "/command-audit",
  "/reporting-studio", "/reports", "/scheduled-reports", "/enhanced-scheduled-reports",
  "/report-builder", "/category-analytics", "/correlation-analysis", "/data-comparison",
  "/comparison-studio", "/realtime-report", "/energy-analytics", "/process-analytics",
  "/device-onboarding", "/carbon-dashboard", "/pdf-reports", "/powerpoint-export", "/threshold-approvals",
  "/engineering-changes", "/nonconformance", "/routing-master", "/oee-target-settings",
  "/analytics-setting", "/ai-chat", "/ai-hub", "/management-insight", "/ai-local-kb", "/ai-brain",
  "/ai-monitoring", "/ai-performance", "/ai-models", "/model-versions", "/ai-settings",
  "/ai-active-learning", "/ai-batch-jobs", "/ai-data-processing", "/ai-time-series", "/ai-reports",
  "/ai-quality-gate", "/ai-image-search", "/ai-advanced-vision-lab", "/anomaly-banks",
  "/mask-annotation", "/causal-graph", "/ai-inspection-analytics", "/ai-gguf-models", "/ai-ab-testing",
  "/admin-home", "/users", "/role-builder", "/audit-logs", "/admin-monitoring", "/enhanced-audit",
  "/license", "/api-keys", "/sites", "/federation-dashboard", "/modules", "/synapse-platform",
  "/backup-restore", "/system-config", "/admin-setting", "/import-export", "/user-assignments",
  "/corporate-management", "/data-management", "/product-workspace", "/ai-studio", "/maintenance-hub",
  "/settings-hub", "/engineering-studio", "/master-data", "/operator-badges", "/component-library",
  "/master-data-audit", "/data-quality", "/metric-catalog", "/products", "/product-mapping", "/layout",
  "/workstation-management", "/process-management", "/datasettings", "/settings", "/custom-dashboard",
  "/inbox", "/approvals-inbox", "/today", "/operator", "/maintenance-home", "/supervisor-home",
  "/viewer-home", "/profile", "/sessions", "/request-role", "/user-guide", "/about-system",
  "/dashboard-templates", "/template-marketplace", "/dashboard-marketplace",
];

const OFFLINE_RX = /mất kết nối|ngoại tuyến|offline|mất kết nối realtime|disconnect|dữ liệu cũ|dữ liệu tính đến|stale|chậm|reconnect|đang kết nối lại|không có kết nối/i;
const LIVE_RX = /trực tiếp|đang stream|streaming|realtime|thời gian thực|\blive\b/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slug = (p) => (p === "/" ? "root" : p.replace(/[^\w]+/g, "_").replace(/^_|_$/g, ""));

async function bodyText(page) {
  try { return (await page.evaluate(() => document.body?.innerText || "")).slice(0, 20000); }
  catch { return ""; }
}
async function isLoggedIn(page) {
  // Sau login, /dashboard KHÔNG được redirect về /login.
  await page.goto(BASE + "/dashboard", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  await sleep(1500);
  return !/\/login/.test(page.url());
}

async function main() {
  const screens = (MODE === "full" ? FULL : TIER1).slice(0, LIMIT);
  const outRole = path.join(OUT, ROLE);
  await mkdir(outRole, { recursive: true });
  console.log(`[P1-live] BASE=${BASE} ROLE=${ROLE} MODE=${MODE} screens=${screens.length}`);
  console.log(`[P1-live] OUT=${outRole}  waits: settle=${SETTLE} stale=${STALE_WAIT} recover=${RECOVER_WAIT}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: VIEWPORT, locale: "vi-VN" });

  // ── SETUP: login qua API (cookie vào context) — TRƯỚC khi bật chặn non-GET ──
  const loginRes = await context.request.post(BASE + "/api/auth/login", {
    data: { username: USER, password: PASS },
    headers: { "Content-Type": "application/json" },
    failOnStatusCode: false,
  });
  const loginBody = await loginRes.text().catch(() => "");
  console.log(`[P1-live] login status=${loginRes.status()} body=${loginBody.slice(0, 200)}`);

  const probe = await context.newPage();
  const authed = await isLoggedIn(probe);
  if (!authed) {
    console.error("[P1-live] AUTH THẤT BẠI — có thể account còn bật 2FA hoặc sai mật khẩu. Dừng.");
    await browser.close();
    process.exit(3);
  }
  console.log("[P1-live] auth OK");
  await probe.close();

  // ── BẬT CHẶN NON-GET ở route layer (điều kiện #3) cho toàn context ──
  await context.route("**/*", (route) => {
    const m = route.request().method();
    if (m === "GET" || m === "HEAD") route.continue();
    else route.abort(); // POST/PUT/PATCH/DELETE bị chặn — audit tuyệt đối không ghi
  });

  const page = await context.newPage();
  const results = [];

  for (let i = 0; i < screens.length; i++) {
    const p = screens[i];
    const s = slug(p);
    const rec = { path: p, role: ROLE, idx: i + 1, errors: [], pageErrors: [] };
    const onConsole = (msg) => { if (msg.type() === "error") rec.errors.push(msg.text().slice(0, 300)); };
    const onPageErr = (err) => rec.pageErrors.push(String(err).slice(0, 300));
    page.on("console", onConsole);
    page.on("pageerror", onPageErr);
    try {
      await page.goto(BASE + p, { waitUntil: "domcontentloaded", timeout: 30000 });
      await sleep(SETTLE);
      const liveText = await bodyText(page);
      rec.blankish = liveText.replace(/\s+/g, "").length < 40;
      rec.landedUrl = page.url();
      rec.noAccess = /\/login/.test(rec.landedUrl) || /(không có quyền|forbidden|403|truy cập bị từ chối)/i.test(liveText);
      await page.screenshot({ path: path.join(outRole, `${String(i + 1).padStart(3, "0")}_${s}__1-live.png`) });

      // STALE
      await context.setOffline(true);
      await sleep(STALE_WAIT);
      const staleText = await bodyText(page);
      rec.offlineBannerAppeared = OFFLINE_RX.test(staleText);
      rec.livePresentWhileOffline = LIVE_RX.test(staleText);
      // Tín hiệu G8: còn "live/stream" mà KHÔNG có dấu hiệu offline/stale ⇒ nghi hiển thị cũ-như-sống.
      rec.g8Suspect = rec.livePresentWhileOffline && !rec.offlineBannerAppeared;
      await page.screenshot({ path: path.join(outRole, `${String(i + 1).padStart(3, "0")}_${s}__2-stale.png`) });

      // RECOVER
      await context.setOffline(false);
      await sleep(RECOVER_WAIT);
      const recoverText = await bodyText(page);
      rec.offlineBannerGoneAfterRecover = !OFFLINE_RX.test(recoverText);
      rec.recovered = !/\/login/.test(page.url());
      await page.screenshot({ path: path.join(outRole, `${String(i + 1).padStart(3, "0")}_${s}__3-recover.png`) });
      rec.ok = true;
    } catch (e) {
      rec.ok = false;
      rec.fatal = String(e).slice(0, 300);
      await context.setOffline(false).catch(() => {});
    } finally {
      page.off("console", onConsole);
      page.off("pageerror", onPageErr);
    }
    results.push(rec);
    const flag = rec.g8Suspect ? " ⚠G8-SUSPECT" : "";
    console.log(`[${String(i + 1).padStart(3, "0")}/${screens.length}] ${p} — offBanner=${rec.offlineBannerAppeared} liveOff=${rec.livePresentWhileOffline}${flag} err=${rec.errors.length} noAccess=${rec.noAccess || false}${rec.ok ? "" : " FATAL"}`);
  }

  const summary = {
    base: BASE, role: ROLE, mode: MODE, count: results.length,
    g8Suspects: results.filter((r) => r.g8Suspect).map((r) => r.path),
    noOfflineBanner: results.filter((r) => r.ok && !r.offlineBannerAppeared).map((r) => r.path),
    noAccess: results.filter((r) => r.noAccess).map((r) => r.path),
    withConsoleErrors: results.filter((r) => r.errors.length).map((r) => ({ path: r.path, n: r.errors.length })),
    blankish: results.filter((r) => r.blankish).map((r) => r.path),
    fatal: results.filter((r) => !r.ok).map((r) => ({ path: r.path, err: r.fatal })),
  };
  await writeFile(path.join(outRole, `results-${ROLE}.json`), JSON.stringify({ summary, results }, null, 2));
  console.log(`\n[P1-live] XONG. g8Suspects=${summary.g8Suspects.length} noOfflineBanner=${summary.noOfflineBanner.length} noAccess=${summary.noAccess.length} fatal=${summary.fatal.length}`);
  console.log(`[P1-live] JSON: ${path.join(outRole, `results-${ROLE}.json`)}`);
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
