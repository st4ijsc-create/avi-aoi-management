/**
 * p50b-do-far.mjs — ĐỌC `camera.far` **SỐNG** (không suy từ px nữa).
 *
 * Nguồn: `window.__thongKeVe.{near,far,camXa,tiLeFarNear}` — do `BomThongKe`
 * (trong `<Canvas>`, dùng `useThree`) bơm ra mỗi khung. Ba đường `__r3f`/fiber của
 * vòng trước (`p50-probe-cam*.mjs`) đều tắc: R3F 9.5 không treo store lên canvas.
 *
 * Mỗi vai × mỗi phạm vi:
 *   ① far/near/camXa lúc khung mặc định;
 *   ② `far` mà prop LẼ RA phải cho: banKinh*24 (đọc banner `data-rong-that-mm`);
 *   ③ cuộn ra từng nấc: far có ĐỔI không, và biểu tượng mất ở nấc nào.
 *
 * ★ CHỐNG TỰ THOẢ: khẳng định KÍCH THƯỚC trước — `soBT0 > 0` và `far > 0`, nếu
 *   không thì in "KHÔNG ĐO ĐƯỢC" chứ không im lặng trả 0.
 */
import { chromium } from "playwright";
import fs from "node:fs";

const GOC = "http://localhost:3064", MK = "Qatd!2026";
const NHAN = process.argv[2] ?? "t";
const VAI = (process.argv[3] ?? "qatd_admin,qatd_giamdoc,qatd_quanly,qatd_kythuat,qatd_congnhan").split(",");
const NAC = Number(process.argv[4] ?? 12);

const trinh = await chromium.launch({ args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"] });
const ra = {};
for (const vai of VAI) {
  const ctx = await trinh.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await page.request.post(`${GOC}/api/auth/login`, { data: { username: vai, password: MK } });
  await page.goto(`${GOC}/twin?pv=tapdoan&do=1`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("man-twin-van-hanh").waitFor({ timeout: 90000 }).catch(() => {});
  // Chốt "khác rỗng + ổn định": số nhãn > 0 VÀ hai lượt đọc bằng nhau.
  await page.waitForFunction(() => {
    const n = document.querySelectorAll("[data-testid='nhan-cum-sa-ban']").length;
    const on = window.__p === n && n > 0; window.__p = n; return on;
  }, undefined, { timeout: 120000, polling: 1000 }).catch(() => {});
  await page.waitForTimeout(3000);

  const doc = async () => page.evaluate(() => {
    const tk = window.__thongKeVe ?? null;
    const bt = window.__demSaBan?.bieuTuong?.() ?? null;
    const bn = document.querySelector("[data-testid='banner-vi-tri-tam-sinh']");
    return {
      near: tk?.near ?? null, far: tk?.far ?? null, camXa: tk?.camXa ?? null, tiLe: tk?.tiLeFarNear ?? null,
      calls: tk?.calls ?? null, tri: tk?.triangles ?? null,
      soBT: bt ? bt.length : -1,
      rongMax: bt && bt.length ? Math.round(Math.max(...bt.map(b => b.rongPx)) * 10) / 10 : null,
      soNhan: window.__demSaBan?.soNhan?.() ?? null,
      yeuCau: window.__catCanhYeuCau ?? null,
      rongThatMm: bn?.getAttribute("data-rong-that-mm") ?? null,
      rongSoDoMm: bn?.getAttribute("data-rong-so-do-mm") ?? null,
    };
  });

  const d0 = await doc();
  // KHẲNG ĐỊNH KÍCH THƯỚC ĐẦU VÀO — không có thì phép đo vô nghĩa.
  const dungDuoc = d0.far !== null && d0.far > 0 && d0.soBT > 0;
  const banKinhM = d0.rongSoDoMm ? Math.max(Number(d0.rongSoDoMm) / 1000, 10) : null;
  console.log(`\n══ ${vai} ══  ${dungDuoc ? "" : "⚠ KHÔNG ĐO ĐƯỢC (far/soBT rỗng)"}`);
  console.log(` YÊU CẦU (prop): ${JSON.stringify(d0.yeuCau)}`);
  console.log(` nấc 0: far=${d0.far} near=${d0.near} tỉ lệ=${d0.tiLe} camXa=${d0.camXa} soBT=${d0.soBT} rộngMax=${d0.rongMax} nhãn=${JSON.stringify(d0.soNhan)}`);
  console.log(` sa bàn (rongSoDoMm)=${d0.rongSoDoMm} ⇒ banKinh≈${banKinhM} ⇒ far LẼ RA (banKinh*24)=${banKinhM ? Math.round(Math.max(2000, banKinhM * 24)) : "?"}`);

  const cv = await page.locator("canvas").first().boundingBox();
  const nac = [];
  if (cv) {
    await page.mouse.move(cv.x + cv.width / 2, cv.y + cv.height / 2);
    for (let i = 1; i <= NAC; i += 1) {
      await page.mouse.wheel(0, 240);
      await page.waitForTimeout(200);
      const d = await doc();
      nac.push({ i, ...d });
      console.log(`  nấc ${String(i).padStart(2)}: far=${d.far} camXa=${d.camXa} soBT=${d.soBT} rộngMax=${d.rongMax} calls=${d.calls} tri=${d.tri}`);
    }
  }
  ra[vai] = { dungDuoc, banKinhM, nac0: d0, nac };
  await ctx.close();
}
fs.writeFileSync(`.qa-tapdoan/p50b-far-${NHAN}.json`, JSON.stringify(ra, null, 1));
await trinh.close();
console.log(`\n→ .qa-tapdoan/p50b-far-${NHAN}.json`);
