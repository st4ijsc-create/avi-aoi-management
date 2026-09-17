/**
 * p50b-chup.mjs — ẢNH CHO MẮT NGƯỜI (tiêu chí 6) + hai hazard do CHÍNH bản vá sinh ra.
 *
 * Mỗi vai chụp 4 khung, đặt tên tự nói:
 *   1) `-a-macdinh`   khung mặc định (đối chiếu nghiệm thu 616de103)
 *   2) `-b-tran`      SAU KHI cuộn ra tới TRẦN zoom (camXa ngừng tăng)
 *   3) `-c-zoomsat`   cuộn VÀO tới trần gần — hazard `near` tăng ⇒ vật bị cắt đôi?
 *   4) `-d-nghieng`   hạ góc nhìn sát mặt sàn — hazard `far/near` lớn ⇒ z-fighting?
 *
 * Chụp CẢ hai: toàn màn (`-toan-man`) và riêng phần tử canvas (`-canvas`).
 * ⚠ `preserveDrawingBuffer` tắt ⇒ `toDataURL` cho 0 pixel; `element.screenshot()`
 *   của Playwright đi qua trình duyệt nên VẪN lấy được pixel WebGL.
 */
import { chromium } from "playwright";
import fs from "node:fs";

const GOC = "http://localhost:3064";
const MK = "Qatd!2026";
const NHAN = process.argv[2] ?? "s";
const VAI = (process.argv[3] ?? "qatd_admin,qatd_giamdoc").split(",");
const THU = `.qa-tapdoan/anh/p50b-${NHAN}`;
fs.mkdirSync(THU, { recursive: true });

const trinh = await chromium.launch({ args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"] });
const so = [];
for (const vai of VAI) {
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
  await page.waitForTimeout(3000);

  const doc = async () =>
    page.evaluate(() => ({
      soBT: (window.__demSaBan?.bieuTuong?.() ?? []).length,
      far: window.__thongKeVe?.far ?? null,
      near: window.__thongKeVe?.near ?? null,
      camXa: window.__thongKeVe?.camXa ?? null,
      nhan: window.__demSaBan?.soNhan?.() ?? null,
    }));
  const canvas = page.locator("canvas").first();
  const cv = await canvas.boundingBox();
  const chup = async (ten) => {
    await page.screenshot({ path: `${THU}/${vai}-${ten}-toan-man.png` });
    await canvas.screenshot({ path: `${THU}/${vai}-${ten}-canvas.png` });
    const d = await doc();
    so.push({ vai, khung: ten, ...d });
    console.log(`  ${vai} ${ten.padEnd(12)} soBT=${d.soBT} far=${d.far} near=${d.near} camXa=${d.camXa} nhãn=${JSON.stringify(d.nhan)}`);
  };

  await chup("a-macdinh");

  // (2) cuộn RA tới trần
  await page.mouse.move(cv.x + cv.width / 2, cv.y + cv.height / 2);
  let truoc = (await doc()).camXa;
  let yen = 0;
  for (let i = 0; i < 60; i += 1) {
    await page.mouse.wheel(0, 240);
    await page.waitForTimeout(140);
    const c = (await doc()).camXa;
    if (Math.abs(c - truoc) < 0.01) {
      yen += 1;
      if (yen >= 2) break;
    } else yen = 0;
    truoc = c;
  }
  await page.waitForTimeout(600);
  await chup("b-tran");

  // (3) cuộn VÀO tới trần gần — hazard `near` tăng
  for (let i = 0; i < 90; i += 1) {
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(800);
  await chup("c-zoomsat");

  // (4) kéo chuột hạ góc nhìn xuống sát sàn — hazard z-fighting
  for (let i = 0; i < 25; i += 1) {
    await page.mouse.wheel(0, 240);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(400);
  await page.mouse.move(cv.x + cv.width / 2, cv.y + cv.height / 2);
  await page.mouse.down();
  await page.mouse.move(cv.x + cv.width / 2, cv.y + cv.height / 2 + 260, { steps: 26 });
  await page.mouse.up();
  await page.waitForTimeout(900);
  await chup("d-nghieng");

  await ctx.close();
}
fs.writeFileSync(`.qa-tapdoan/p50b-chup-${NHAN}.json`, JSON.stringify(so, null, 1));
console.log(`\n→ ${THU}  ·  .qa-tapdoan/p50b-chup-${NHAN}.json`);
await trinh.close();
