/** zf/chup-studio.mjs — chụp canvas màn `/twin-studio` (CanhThietKe) ở khung mặc định. */
import { chromium } from "playwright";
import fs from "node:fs";
const NHAN = process.argv[2] ?? "x";
const GOC = "http://localhost:3064";
const THU = `.qa-tapdoan/zf/anh/${NHAN}`;
fs.mkdirSync(THU, { recursive: true });
const trinh = await chromium.launch({ args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"] });
const ctx = await trinh.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
await page.request.post(`${GOC}/api/auth/login`, { data: { username: "qatd_admin", password: "Qatd!2026" } });
await page.goto(`${GOC}/twin-studio?do=1`, { waitUntil: "domcontentloaded" });
await page.locator("canvas").first().waitFor({ timeout: 90000 }).catch(() => {});
await page.waitForFunction(() => {
  const tk = window.__thongKeVe; if (!tk || !tk.calls) return false;
  const k = `${tk.calls}`; const on = window.__zfS === k; window.__zfS = k; return on;
}, undefined, { timeout: 120000, polling: 900 }).catch(() => {});
await page.waitForTimeout(2500);
const d = await page.evaluate(() => ({ ...(window.__thongKeVe ?? {}), soCanvas: document.querySelectorAll("canvas").length }));
await page.locator("canvas").first().screenshot({ path: `${THU}/studio.png` });
console.log(`${NHAN}: near=${d.near} far=${d.far} camXa=${d.camXa} calls=${d.calls} canvas=${d.soCanvas}`);
await ctx.close(); await trinh.close();
