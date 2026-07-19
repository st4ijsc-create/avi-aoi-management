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

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "vi-VN" });
await ctx.request.post(BASE + "/api/auth/login", {
  data: { username: "p1_audit_admin", password: "P1audit_2026x" },
  headers: { "Content-Type": "application/json" },
});
const page = await ctx.newPage();

// Vitals collector — phải cài TRƯỚC điều hướng.
await page.addInitScript(() => {
  const w = window;
  w.__poc = { lcp: 0, longtasks: 0, longtaskMs: 0 };
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) w.__poc.lcp = Math.max(w.__poc.lcp, e.startTime);
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) { w.__poc.longtasks++; w.__poc.longtaskMs += e.duration; }
    }).observe({ type: "longtask", buffered: true });
  } catch { /* observer không hỗ trợ → số 0 trung thực */ }
});

// CPU throttle ×4 (CDP).
const cdp = await ctx.newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

// ── 1) /dashboard: LCP + interaction ──
await page.goto(BASE + "/dashboard", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(9000);
const dash = await page.evaluate(() => ({ ...window.__poc }));
// Interaction: click nút "Làm mới"/tab đầu tiên thấy được → đo tới double-rAF.
const interactionMs = await page.evaluate(async () => {
  const btn = Array.from(document.querySelectorAll("button")).find((b) => (b.textContent ?? "").trim().length > 0 && !b.disabled);
  if (!btn) return -1;
  const t0 = performance.now();
  btn.click();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return Math.round(performance.now() - t0);
});
console.log(`DASHBOARD  LCP=${Math.round(dash.lcp)}ms (G5<2000)  longtasks=${dash.longtasks} (${Math.round(dash.longtaskMs)}ms)  interaction=${interactionMs}ms (G5<200)`);

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
