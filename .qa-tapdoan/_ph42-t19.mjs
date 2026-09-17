/**
 * t19-mot-nha-may.mjs — N7: ĐƯỜNG MỘT NHÀ MÁY KHÔNG ĐƯỢC VỠ.
 *
 * Task 19 chỉ đổi hành vi ở `?pv=tapdoan`. Ô này đo `/twin` MẶC ĐỊNH (không
 * `pv=`) — đường đi phổ biến nhất của màn — và so TRƯỚC/SAU. Bất kỳ số nào lệch
 * là một hồi quy, không phải một cải tiến.
 */
import { chromium } from "playwright";
import fs from "node:fs";

const NHAN = process.argv[2] ?? "sau";
const GOC = process.env.PH42_GOC ?? "http://localhost:3066";
const trinh = await chromium.launch({
  args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const ra = {};
for (const ten of ["qatd_giamdoc", "qatd_quanly"]) {
  const ctx = await trinh.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const loi = [];
  page.on("pageerror", (e) => loi.push(String(e).slice(0, 160)));
  await page.request.post(`${GOC}/api/auth/login`, { data: { username: ten, password: "Qatd!2026" } });
  await page.goto(`${GOC}/twin?do=1`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("man-twin-van-hanh").waitFor({ timeout: 90_000 }).catch(() => {});
  await page
    .waitForFunction(() => (window.__demTuongTac?.dsMay?.()?.length ?? 0) > 0, undefined, {
      timeout: 120_000,
      polling: 1000,
    })
    .catch(() => {});
  await page.waitForTimeout(2500);
  ra[ten] = await page.evaluate(() => {
    const q = (id) => document.querySelector(`[data-testid='${id}']`);
    const ds = window.__demTuongTac?.dsMay?.() ?? [];
    return {
      soMayVe: ds.length,
      demMay: q("dem-may")?.textContent?.trim() ?? null,
      breadcrumb: q("breadcrumb-twin")?.textContent?.trim() ?? null,
      toa: q("chon-toa-nha")?.value ?? null,
      tang: q("chon-tang")?.value ?? null,
      soTang: q("chon-tang")?.options?.length ?? -1,
      calls: window.__thongKeVe?.calls ?? null,
      triangles: window.__thongKeVe?.triangles ?? null,
      soNhan: window.__demTuongTac?.hopNhanDaVe?.()?.length ?? -1,
      soHangMay: document.querySelectorAll("[data-testid^='may-hang-']").length,
      soViec: q("dai-hop-nhat")?.getAttribute("data-so-viec") ?? null,
    };
  });
  ra[ten].loi = loi;
  console.log(`[${NHAN}] ${ten.padEnd(14)} ${JSON.stringify(ra[ten])}`);
  await ctx.close();
}
await trinh.close();
fs.writeFileSync(`.qa-tapdoan/_ph42-t19-${NHAN}.json`, JSON.stringify(ra, null, 1));
