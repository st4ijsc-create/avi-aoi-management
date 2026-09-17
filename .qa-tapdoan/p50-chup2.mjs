/**
 * p50-chup2.mjs — CHỤP HAI LẦN CÙNG MỘT BẢN DỰNG để đo ĐỘ LẶP của thiết bị chụp.
 * Không có số này thì mọi "lệch N px" giữa trước/sau là lời khai chưa kiểm.
 *   node .qa-tapdoan/p50-chup2.mjs <vai> <thuMuc>
 */
import { chromium } from "playwright";
import fs from "node:fs";
const GOC = "http://localhost:3064", MK = "Qatd!2026";
const vai = process.argv[2] ?? "qatd_giamdoc";
const THU = process.argv[3] ?? ".qa-tapdoan/anh/p50/lap";
fs.mkdirSync(THU, { recursive: true });
const trinh = await chromium.launch({ args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"] });
for (const lan of ["a", "b"]) {
  const ctx = await trinh.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await page.request.post(`${GOC}/api/auth/login`, { data: { username: vai, password: MK } });
  await page.goto(`${GOC}/twin?pv=tapdoan&do=1`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("man-twin-van-hanh").waitFor({ timeout: 90000 }).catch(() => {});
  await page.waitForFunction(() => { const n = document.querySelectorAll("[data-testid='nhan-cum-sa-ban']").length; const on = window.__c2 === n && n > 0; window.__c2 = n; return on; }, undefined, { timeout: 120000, polling: 1000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const c = await page.$("canvas");
  await c.screenshot({ path: `${THU}/${vai}-3d-${lan}.png` });
  console.log(`chụp ${lan} → ${THU}/${vai}-3d-${lan}.png`);
  await ctx.close();
}
await trinh.close();
