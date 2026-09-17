/**
 * p50-probe-far.mjs — ĐO `far` của camera GIÁN TIẾP, bằng hành vi người dùng THẬT:
 * cuộn ra xa từng nấc và xem cảnh BIẾN MẤT ở nấc nào.
 *   · `far` thích ứng (= banKinh*24) ⇒ cảnh KHÔNG bao giờ mất trong tầm OrbitControls.
 *   · `far` đóng băng ở 2000 m ⇒ cảnh mất khi camera vượt ~2000 m.
 * Thước: `__demSaBan.bieuTuong().length` (0 = mọi góc hộp có z>1 = ngoài far).
 *   node .qa-tapdoan/p50-probe-far.mjs <vai>
 */
import { chromium } from "playwright";
const GOC = "http://localhost:3064", MK = "Qatd!2026";
const vai = process.argv[2] ?? "qatd_giamdoc";
const trinh = await chromium.launch({ args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"] });
const ctx = await trinh.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
await page.request.post(`${GOC}/api/auth/login`, { data: { username: vai, password: MK } });
await page.goto(`${GOC}/twin?pv=tapdoan&do=1`, { waitUntil: "domcontentloaded" });
await page.getByTestId("man-twin-van-hanh").waitFor({ timeout: 90000 }).catch(() => {});
await page.waitForFunction(() => { const n = document.querySelectorAll("[data-testid='nhan-cum-sa-ban']").length; const on = window.__p === n && n > 0; window.__p = n; return on; }, undefined, { timeout: 120000, polling: 1000 }).catch(() => {});
await page.waitForTimeout(2500);
const cv = await page.locator("canvas").first().boundingBox();
const tam = { x: cv.x + cv.width / 2, y: cv.y + cv.height / 2 };
const doc = async () => page.evaluate(() => ({
  soBT: window.__demSaBan?.bieuTuong?.()?.length ?? -1,
  rongMax: Math.round((Math.max(0, ...(window.__demSaBan?.bieuTuong?.() ?? []).map(b => b.rongPx))) * 10) / 10,
  soNhan: window.__demSaBan?.soNhan?.() ?? null,
  tri: window.__thongKeVe?.triangles ?? -1,
}));
console.log(`vai=${vai} nấc=0 ` + JSON.stringify(await doc()));
await page.mouse.move(tam.x, tam.y);
for (let nac = 1; nac <= 40; nac += 1) {
  await page.mouse.wheel(0, 240); // cuộn RA XA
  await page.waitForTimeout(160);
  if (nac % 2 === 0 || nac <= 6) console.log(`  nấc ${String(nac).padStart(2)} ` + JSON.stringify(await doc()));
}
await ctx.close();
await trinh.close();
