/**
 * p50b-chup-nac.mjs — ẢNH TẠI MỘT SỐ NẤC CUỘN CỐ ĐỊNH (cho mắt người).
 *
 * Vì sao cần thêm ảnh này bên cạnh ảnh "trần zoom": ở TRẦN, biểu tượng toà chỉ còn
 * **9 px** (admin) / **14 px** (giám đốc) trên nền tối — chúng CÓ được vẽ (đo được:
 * `soBT` 0→14, số màu trong vùng 3→271) nhưng mắt không phân xử nổi trên ảnh. Ở nấc
 * 4–6 thì khác hẳn: bản TRƯỚC đã mất sạch cảnh trong khi bản SAU còn đủ 14 toà ở
 * 28–37 px. Đó là cặp ảnh nói được sự thật bằng mắt.
 *
 *   node .qa-tapdoan/p50b-chup-nac.mjs <nhan> <nac1,nac2,...>
 */
import { chromium } from "playwright";
import fs from "node:fs";

const GOC = "http://localhost:3064";
const MK = "Qatd!2026";
const NHAN = process.argv[2] ?? "sau";
const NACS = (process.argv[3] ?? "4,6").split(",").map(Number);
const THU = ".qa-tapdoan/anh/p50b-CUOI";
fs.mkdirSync(THU, { recursive: true });

const trinh = await chromium.launch({ args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"] });
for (const vai of ["qatd_admin", "qatd_giamdoc"]) {
  const ctx = await trinh.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await page.request.post(`${GOC}/api/auth/login`, { data: { username: vai, password: MK } });
  await page.goto(`${GOC}/twin?pv=tapdoan&do=1`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("man-twin-van-hanh").waitFor({ timeout: 90000 }).catch(() => {});
  await page
    .waitForFunction(
      () => {
        const n = (window.__demSaBan?.bieuTuong?.() ?? []).length;
        const on = window.__p50b === n && n > 0;
        window.__p50b = n;
        return on;
      },
      undefined,
      { timeout: 120000, polling: 1000 },
    )
    .catch(() => {});
  await page.waitForTimeout(2500);
  const canvas = page.locator("canvas").first();
  const cv = await canvas.boundingBox();
  await page.mouse.move(cv.x + cv.width / 2, cv.y + cv.height / 2);
  let da = 0;
  for (const nac of NACS) {
    for (; da < nac; da += 1) {
      await page.mouse.wheel(0, 240);
      await page.waitForTimeout(160);
    }
    await page.waitForTimeout(700);
    await canvas.screenshot({ path: `${THU}/NAC${nac}-${vai}-${NHAN}-canvas.png` });
    const d = await page.evaluate(() => {
      const bt = window.__demSaBan?.bieuTuong?.() ?? [];
      return {
        soBT: bt.length,
        rongMax: bt.length ? Math.round(Math.max(...bt.map((b) => b.rongPx)) * 10) / 10 : null,
        far: window.__thongKeVe?.far ?? null,
        camXa: window.__thongKeVe?.camXa ?? null,
      };
    });
    console.log(`  ${vai} nấc ${nac} (${NHAN}): soBT=${d.soBT} rộngMax=${d.rongMax} far=${d.far} camXa=${d.camXa}`);
  }
  await ctx.close();
}
await trinh.close();
