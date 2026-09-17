/**
 * ph52/fps.mjs — KHUNG/GIÂY TRONG MỘT CỬA SỔ THỜI GIAN CỐ ĐỊNH, cho HAI màn tôi sửa.
 *
 * Cùng nguyên tắc `zf/fps.mjs` (PH-51) và VÌ ĐÚNG LÝ DO ẤY: thước fps theo-sự-kiện
 * (kéo đúng N bước rồi lấy `khung / thời gian trôi`) có MẪU SỐ là thời gian
 * Playwright giao xong N sự kiện — một đại lượng của máy chủ, không của bộ dựng.
 * Ở đây CỬA SỔ do ta ấn định (mặc định 5.000 ms): kéo liên tục ngần ấy mili giây
 * rồi đếm `requestAnimationFrame`. Bộ dựng chậm đi ⇒ ÍT khung hơn, không lối thoát.
 *
 *   node .qa-tapdoan/ph52/fps.mjs <nhan> <fc|studio> [ms]
 */
import { chromium } from "playwright";
import fs from "node:fs";

const NHAN = process.argv[2] ?? "x";
const MAN = process.argv[3] ?? "fc";
const CUA_SO_MS = Number(process.argv[4] ?? 5000);
const GOC = "http://localhost:3077";

const trinh = await chromium.launch({
  args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const ctx = await trinh.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
await page.request.post(`${GOC}/api/auth/login`, { data: { username: "qatd_admin", password: "Qatd!2026" } });

if (MAN === "fc") {
  await page.goto(`${GOC}/factory-command`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "3D", exact: true }).click({ timeout: 60000 });
} else {
  await page.goto(`${GOC}/twin-studio?do=1`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("man-twin-studio").waitFor({ timeout: 90000 });
}
await page.locator("canvas").first().waitFor({ timeout: 90000 });
await page
  .waitForFunction(
    () => {
      const tk = window.__thongKeVe;
      if (!tk || !tk.calls) return false;
      const k = `${tk.calls}|${tk.triangles ?? tk.tris ?? 0}`;
      const on = window.__ph52F === k;
      window.__ph52F = k;
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
  window.__ph52N = 0;
  const dem = () => {
    window.__ph52N += 1;
    window.__ph52R = requestAnimationFrame(dem);
  };
  window.__ph52R = requestAnimationFrame(dem);
});
await page.mouse.move(cx, cy);
await page.mouse.down();
const t0 = Date.now();
let i = 0;
while (Date.now() - t0 < CUA_SO_MS) {
  i += 1;
  await page.mouse.move(cx + ((i % 20) - 10) * 6, cy + ((i % 14) - 7) * 5);
}
const troi = Date.now() - t0;
await page.mouse.up();
const khung = await page.evaluate(() => {
  cancelAnimationFrame(window.__ph52R);
  return window.__ph52N;
});
const fps = Math.round((khung / (troi / 1000)) * 10) / 10;
const ket = {
  nhan: NHAN,
  man: MAN,
  cuaSoMs: CUA_SO_MS,
  troiMs: troi,
  soBuoc: i,
  khung,
  fps,
  calls: tk0.calls,
  tris: tk0.triangles ?? tk0.tris ?? null,
};
fs.mkdirSync(".qa-tapdoan/ph52/tho", { recursive: true });
fs.writeFileSync(`.qa-tapdoan/ph52/tho/fps-${NHAN}.json`, JSON.stringify(ket, null, 1));
console.log(
  `${NHAN.padEnd(14)} ${MAN.padEnd(7)} cửa sổ ${CUA_SO_MS}ms (trôi ${troi}) · ${i} bước · ${khung} khung ⇒ ${fps} fps · calls=${tk0.calls} tris=${ket.tris}`,
);
await ctx.close();
await trinh.close();
