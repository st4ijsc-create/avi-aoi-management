/**
 * doc 64 / doc 63 §S5 POC (Q4 user: "POC tạm trên máy dev") — đo ngân sách render
 * dưới CPU THROTTLE ×4 (xấp xỉ panel-PC yếu) trên tải SIM thật:
 *   • LCP (largest-contentful-paint) — mục tiêu G5 < 2.0s
 *   • Interaction latency (click → double-rAF paint) — proxy INP, mục tiêu < 200ms
 *   • Long tasks (count + tổng ms) trong cửa sổ đo
 *   • Memory soak /andon (poll 15s realtime): sample usedJSHeapSize → slope MB/phút
 *     (CHÚ THÍCH TRUNG THỰC: soak ngắn chỉ là chỉ báo slope, KHÔNG thay ca 8h thật)
 *
 * Chạy: node scripts/audit/s5-poc.mjs   (server :3000 đang chạy; account audit active)
 */
import { chromium } from "@playwright/test";

const BASE = "http://localhost:3000";
const SOAK_MS = Number(process.env.POC_SOAK_MS ?? 180_000); // 3 phút mặc định
const SAMPLE_MS = 10_000;
// doc64 S5-OPT: đo được MỌI màn (mặc định /dashboard theo Q4); màn operator pilot S1
// (/andon, /line-view, /device-monitor…) là bề mặt G5 đích thật của persona #1.
const ROUTE = process.env.POC_ROUTE ?? "/dashboard";
const SKIP_SOAK = !!process.env.POC_SKIP_SOAK;

// doc65: account audit giờ BẬT 2FA (đúng trạng thái admin thật) — login qua helper TOTP.
import { loginAuditAdmin } from "./login-totp.mjs";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "vi-VN" });
await loginAuditAdmin(ctx, BASE);
const page = await ctx.newPage();

// doc64 S5-OPT V4 — chế độ đo STEADY-STATE (mặc định): nudge template (doc10 U11) chỉ hiện
// đúng 1 lần/đời user; context Playwright mới luôn "lần đầu" → banner to paint muộn cướp LCP,
// làm số không đại diện ca vận hành thường ngày. Pre-dismiss key localStorage của account POC.
// Đo kịch bản lần-đầu: POC_FIRST_VISIT=1.
if (!process.env.POC_FIRST_VISIT) {
  await page.addInitScript(() => {
    try { window.localStorage.setItem("dashboardTemplate:admin:1546", "1"); } catch { /* ignore */ }
  });
}

// Vitals collector — phải cài TRƯỚC điều hướng.
await page.addInitScript(() => {
  const w = window;
  w.__poc = { lcp: 0, longtasks: 0, longtaskMs: 0, lcpLog: [] };
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        w.__poc.lcp = Math.max(w.__poc.lcp, e.startTime);
        // Ghi LỊCH SỬ element LCP (tag.class + text đầu) — biết nền paint lúc nào vs entry cuối,
        // tránh tối ưu mù khi 1 phần tử muộn (dialog/ảnh) "cướp" LCP.
        const el = e.element;
        w.__poc.lcpLog.push(`${Math.round(e.startTime)}ms size=${e.size} <${el?.tagName?.toLowerCase() ?? "?"}${el?.className ? "." + String(el.className).slice(0, 50) : ""}> "${(el?.textContent ?? "").trim().slice(0, 60)}"`);
      }
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) { w.__poc.longtasks++; w.__poc.longtaskMs += e.duration; }
    }).observe({ type: "longtask", buffered: true });
  } catch { /* observer không hỗ trợ → số 0 trung thực */ }
});

// CPU throttle ×4 (CDP).
const cdp = await ctx.newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

// ── 1) ROUTE chính: LCP + interaction ──
await page.goto(BASE + ROUTE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(9000);
const dash = await page.evaluate(() => ({ ...window.__poc }));
if (process.env.POC_SHOT) await page.screenshot({ path: process.env.POC_SHOT });
// Interaction: click nút an toàn (ưu tiên Làm mới/Lọc; né logout/link điều hướng) → đo tới double-rAF.
// try/catch: nếu nút vẫn gây navigation (context destroyed) → -2, không giết cả phép đo LCP.
let interactionMs = -1;
try {
  interactionMs = await page.evaluate(async () => {
    const all = Array.from(document.querySelectorAll("button:not([disabled])"));
    const bad = /đăng xuất|logout|xóa|delete/i;
    const prefer = /làm mới|refresh|lọc|filter|tải lại/i;
    const btn =
      all.find((b) => prefer.test(b.textContent ?? "")) ??
      all.find((b) => (b.textContent ?? "").trim().length > 0 && !bad.test(b.textContent ?? "") && !b.closest("a"));
    if (!btn) return -1;
    const t0 = performance.now();
    btn.click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return Math.round(performance.now() - t0);
  });
} catch { interactionMs = -2; }
console.log(`${ROUTE}  LCP=${Math.round(dash.lcp)}ms (G5<2000)  longtasks=${dash.longtasks} (${Math.round(dash.longtaskMs)}ms)  interaction=${interactionMs}ms (G5<200)`);
for (const line of dash.lcpLog ?? []) console.log(`  LCP entry: ${line}`);
if (SKIP_SOAK) {
  await browser.close();
  console.log("S5-POC DONE (skip soak)");
  process.exit(0);
}

// ── 2) /andon soak: memory slope ──
await page.goto(BASE + "/andon", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
const samples = [];
const n = Math.max(3, Math.floor(SOAK_MS / SAMPLE_MS));
for (let i = 0; i < n; i++) {
  const m = await page.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize : -1));
  samples.push(m);
  await page.waitForTimeout(SAMPLE_MS);
}
const andon = await page.evaluate(() => ({ ...window.__poc }));
const mb = (b) => b / 1048576;
const first = samples[0], last = samples[samples.length - 1];
const minutes = ((samples.length - 1) * SAMPLE_MS) / 60000;
const slope = first > 0 ? (mb(last) - mb(first)) / minutes : NaN;
console.log(`ANDON soak ${minutes.toFixed(1)}min  heap ${mb(first).toFixed(1)}→${mb(last).toFixed(1)}MB  slope=${slope.toFixed(2)}MB/min  longtasks=${andon.longtasks}`);
console.log(`samples(MB): ${samples.map((s) => mb(s).toFixed(1)).join(", ")}`);
const extrap8h = slope * 480;
console.log(`extrapolation 8h (CHỈ BÁO, không phải phép đo): ${extrap8h >= 0 ? "+" : ""}${extrap8h.toFixed(0)}MB`);

await browser.close();
console.log("S5-POC DONE");
