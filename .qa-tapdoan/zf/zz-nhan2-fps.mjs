/**
 * zf/fps.mjs — KHUNG/GIÂY TRONG MỘT CỬA SỔ THỜI GIAN CỐ ĐỊNH.
 *
 * VÌ SAO THÊM THƯỚC NÀY (KHÔNG THAY THƯỚC CŨ — `n4-ngansach.mjs` vẫn chạy và vẫn
 * được in nguyên số): `n4` kéo chuột ĐÚNG 40 bước rồi lấy `khung / thời gian trôi`.
 * Mẫu số ấy là thời gian Playwright giao xong 40 sự kiện — một đại lượng của MÁY
 * CHỦ, không phải của bộ dựng. Đo được trên 16 lượt: **số khung gần như không đổi**
 * (157,5 → 156,1) trong khi **thời gian trôi** dao động 3.335–5.535 ms. Tức `n4.fps`
 * trộn hai thứ, và phần dao động nằm ở mẫu số.
 *
 * Ở đây CỬA SỔ do ta ấn định (mặc định 5.000 ms): kéo liên tục trong đúng ngần ấy
 * mili giây rồi đếm `requestAnimationFrame`. Bộ dựng chậm đi ⇒ ÍT khung hơn. Không
 * còn đường nào cho độ trễ nhập liệu chui vào mẫu số.
 *
 *   node .qa-tapdoan/zf/fps.mjs <nhan> [vai] [ms]
 */
import { chromium } from "playwright";
import fs from "node:fs";

const NHAN = process.argv[2] ?? "x";
const VAI = process.argv[3] ?? "qatd_admin";
const CUA_SO_MS = Number(process.argv[4] ?? 5000);
const GOC = process.env.GOC_QA || "http://localhost:3064";

const trinh = await chromium.launch({
  args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const ctx = await trinh.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
await page.request.post(`${GOC}/api/auth/login`, { data: { username: VAI, password: "Qatd!2026" } });
await page.goto(`${GOC}/twin?pv=tapdoan&do=1`, { waitUntil: "domcontentloaded" });
await page.getByTestId("man-twin-van-hanh").waitFor({ timeout: 90_000 }).catch(() => {});
await page
  .waitForFunction(
    () => {
      const tk = window.__thongKeVe;
      if (!tk || !tk.calls) return false;
      const k = `${tk.calls}`;
      const on = window.__zfF === k;
      window.__zfF = k;
      return on;
    },
    undefined,
    { timeout: 120_000, polling: 900 },
  )
  .catch(() => {});
await page.waitForTimeout(2500);

const tk0 = await page.evaluate(() => ({ ...(window.__thongKeVe ?? {}) }));
const box = await (await page.$("canvas")).boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;

await page.evaluate(() => {
  window.__zfN = 0;
  const dem = () => {
    window.__zfN += 1;
    window.__zfR = requestAnimationFrame(dem);
  };
  window.__zfR = requestAnimationFrame(dem);
});
await page.mouse.move(cx, cy);
await page.mouse.down();
const t0 = Date.now();
let i = 0;
// Kéo qua lại quanh tâm cho tới khi HẾT cửa sổ — số bước KHÔNG cố định, thời gian thì có.
while (Date.now() - t0 < CUA_SO_MS) {
  i += 1;
  await page.mouse.move(cx + ((i % 20) - 10) * 6, cy + ((i % 14) - 7) * 5);
}
const troi = Date.now() - t0;
await page.mouse.up();
const khung = await page.evaluate(() => {
  cancelAnimationFrame(window.__zfR);
  return window.__zfN;
});
const fps = Math.round((khung / (troi / 1000)) * 10) / 10;
const ket = { nhan: NHAN, vai: VAI, cuaSoMs: CUA_SO_MS, troiMs: troi, soBuoc: i, khung, fps, calls: tk0.calls, tris: tk0.tris ?? null };
fs.mkdirSync(".qa-tapdoan/zf/tho", { recursive: true });
fs.writeFileSync(`.qa-tapdoan/zf/tho/fps-${NHAN}.json`, JSON.stringify(ket, null, 1));
console.log(`${NHAN.padEnd(12)} ${VAI} · cửa sổ ${CUA_SO_MS}ms (trôi ${troi}) · ${i} bước · ${khung} khung ⇒ ${fps} fps · calls=${tk0.calls}`);
await ctx.close();
await trinh.close();
