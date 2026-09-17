/**
 * p50-banner.mjs — ĐỌC NGUYÊN VĂN banner `banner-vi-tri-tam-sinh` sau khi MỞ dải
 * hợp nhất (mặc định nó thu lại — đó là cơ chế CÓ SẴN của màn, không phải do vá).
 *   node .qa-tapdoan/p50-banner.mjs <vai...>
 */
import { chromium } from "playwright";
const GOC = "http://localhost:3064", MK = "Qatd!2026";
const VAI = process.argv.slice(2).length ? process.argv.slice(2) : ["qatd_admin", "qatd_giamdoc", "qatd_congnhan"];
const trinh = await chromium.launch({ args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"] });
for (const vai of VAI) {
  const ctx = await trinh.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await page.request.post(`${GOC}/api/auth/login`, { data: { username: vai, password: MK } });
  await page.goto(`${GOC}/twin?pv=tapdoan&do=1`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("man-twin-van-hanh").waitFor({ timeout: 90000 }).catch(() => {});
  await page.waitForFunction(() => { const n = document.querySelectorAll("[data-testid='nhan-cum-sa-ban']").length; const on = window.__pb === n && n > 0; window.__pb = n; return on; }, undefined, { timeout: 120000, polling: 1000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.getByTestId("nut-mo-dai-hop-nhat").click({ timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(800);
  const ra = await page.evaluate(() => {
    const e = document.querySelector("[data-testid='banner-vi-tri-tam-sinh']");
    if (!e) return { co: false };
    const g = (k) => e.getAttribute(k);
    return {
      co: true,
      chu: (e.textContent ?? "").trim(),
      rongThatMm: g("data-rong-that-mm"), rongSoDoMm: g("data-rong-so-do-mm"),
      bieuTuongRongMm: g("data-bieu-tuong-rong-mm"), bieuTuongSauMm: g("data-bieu-tuong-sau-mm"),
      thatCanhNhoMm: g("data-that-canh-nho-mm"), thatCanhLonMm: g("data-that-canh-lon-mm"),
    };
  });
  console.log(`\n══ ${vai} ══\n` + JSON.stringify(ra, null, 1));
  await ctx.close();
}
await trinh.close();
