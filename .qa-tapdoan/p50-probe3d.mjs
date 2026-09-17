/**
 * p50-probe3d.mjs — VÌ SAO canvas 3D của `qatd_admin` ĐEN, và vì sao `anNgoaiKhung = 19`?
 * Đọc camera THẬT (near/far/vị trí), cỡ sàn, và phép chiếu của MỘT điểm trong cảnh.
 *   node .qa-tapdoan/p50-probe3d.mjs [vai...]
 */
import { chromium } from "playwright";

const GOC = "http://localhost:3064";
const MK = "Qatd!2026";
const VAI = process.argv.slice(2).length ? process.argv.slice(2) : ["qatd_admin", "qatd_giamdoc"];

const trinh = await chromium.launch({ args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"] });
for (const vai of VAI) {
  const ctx = await trinh.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await page.request.post(`${GOC}/api/auth/login`, { data: { username: vai, password: MK } });
  await page.goto(`${GOC}/twin?pv=tapdoan&do=1`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("man-twin-van-hanh").waitFor({ timeout: 90_000 }).catch(() => {});
  // Chốt "khác rỗng + qua N giây" (luật 3 chủ đợt): đợi số nhãn ỔN ĐỊNH và > 0.
  await page
    .waitForFunction(
      () => {
        const n = document.querySelectorAll("[data-testid='nhan-cum-sa-ban']").length;
        const on = window.__p50 === n && n > 0;
        window.__p50 = n;
        return on;
      },
      undefined,
      { timeout: 120_000, polling: 1000 },
    )
    .catch(() => {});
  await page.waitForTimeout(3000);

  const ra = await page.evaluate(() => {
    const cv = document.querySelector("canvas");
    const bn = document.querySelector("[data-testid='banner-vi-tri-tam-sinh']");
    return {
      soNhan: window.__demSaBan?.soNhan?.() ?? null,
      soBieuTuong: window.__demSaBan?.bieuTuong?.()?.length ?? -1,
      hopBieuTuongDau: window.__demSaBan?.bieuTuong?.()?.[0] ?? null,
      canvas: cv ? { w: cv.width, h: cv.height, css: cv.getBoundingClientRect().width } : null,
      thongKe: window.__thongKeVe ?? null,
      bannerRongThatMm: bn?.getAttribute("data-rong-that-mm") ?? null,
      bannerRongSoDoMm: bn?.getAttribute("data-rong-so-do-mm") ?? null,
      soToa: bn?.getAttribute("data-so-toa") ?? null,
      soKhoi: bn?.getAttribute("data-so-khoi") ?? null,
      lopSaBan: (() => {
        const e = document.querySelector("[data-testid='lop-sa-ban']");
        return e ? { soToa: e.getAttribute("data-so-toa"), soCum: e.getAttribute("data-so-cum") } : null;
      })(),
    };
  });
  console.log(`\n══ ${vai} ══`);
  console.log(JSON.stringify(ra, null, 1));
  await ctx.close();
}
await trinh.close();
