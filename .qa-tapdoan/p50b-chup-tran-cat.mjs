/**
 * p50b-chup-tran-cat.mjs — ẢNH "TRẦN ZOOM" CẮT ĐÚNG VÙNG BIỂU TƯỢNG.
 *
 * Ở trần zoom biểu tượng toà chỉ còn ~15 px trên nền tối; ảnh 1280×720 thu nhỏ
 * không cho mắt phân xử "có vẽ hay không". Script này hỏi `__demSaBan.bieuTuong()`
 * hộp bao THẬT của các biểu tượng (px gốc canvas), chụp canvas, rồi cắt + phóng
 * ĐÚNG vùng ấy. Với bản TRƯỚC, `bieuTuong()` trả rỗng ⇒ truyền vùng của bản SAU
 * qua tham số để hai ảnh cắt CÙNG MỘT chỗ — nếu không thì so hai vùng khác nhau
 * và kết luận vô nghĩa.
 *
 *   node .qa-tapdoan/p50b-chup-tran-cat.mjs <nhan> [x0 y0 w h]
 */
import { chromium } from "playwright";
import fs from "node:fs";
import { PNG } from "pngjs";

const GOC = "http://localhost:3064";
const MK = "Qatd!2026";
const NHAN = process.argv[2] ?? "sau";
const VUNG = process.argv.slice(3, 7).map(Number);
const THU = ".qa-tapdoan/anh/p50b-CUOI";
fs.mkdirSync(THU, { recursive: true });

function phong(vao, ra, x0, y0, w, h, lan) {
  const A = PNG.sync.read(fs.readFileSync(vao));
  const R = new PNG({ width: w * lan, height: h * lan });
  for (let y = 0; y < h * lan; y += 1)
    for (let x = 0; x < w * lan; x += 1) {
      const sx = Math.max(0, Math.min(A.width - 1, x0 + Math.floor(x / lan)));
      const sy = Math.max(0, Math.min(A.height - 1, y0 + Math.floor(y / lan)));
      const i = (sy * A.width + sx) * 4;
      const j = (y * w * lan + x) * 4;
      R.data[j] = A.data[i];
      R.data[j + 1] = A.data[i + 1];
      R.data[j + 2] = A.data[i + 2];
      R.data[j + 3] = 255;
    }
  fs.writeFileSync(ra, PNG.sync.write(R));
}

const trinh = await chromium.launch({ args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"] });
const vungRa = {};
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
  let truoc = await page.evaluate(() => window.__thongKeVe?.camXa ?? 0);
  let yen = 0;
  for (let i = 0; i < 60; i += 1) {
    await page.mouse.wheel(0, 240);
    await page.waitForTimeout(140);
    const c = await page.evaluate(() => window.__thongKeVe?.camXa ?? 0);
    if (Math.abs(c - truoc) < 0.01) {
      yen += 1;
      if (yen >= 2) break;
    } else yen = 0;
    truoc = c;
  }
  await page.waitForTimeout(800);

  const info = await page.evaluate(() => {
    const bt = window.__demSaBan?.bieuTuong?.() ?? [];
    const tk = window.__thongKeVe ?? null;
    if (!bt.length) return { so: 0, hop: null, tk, rong: null };
    return {
      so: bt.length,
      hop: {
        trai: Math.min(...bt.map((b) => b.hop.trai)),
        phai: Math.max(...bt.map((b) => b.hop.phai)),
        tren: Math.min(...bt.map((b) => b.hop.tren)),
        duoi: Math.max(...bt.map((b) => b.hop.duoi)),
      },
      tk,
      rong: bt.map((b) => Math.round(b.rongPx * 10) / 10),
    };
  });

  const goc = `${THU}/TRAN-${vai}-${NHAN}-canvas.png`;
  await canvas.screenshot({ path: goc });
  const tiLe = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    return c ? c.getBoundingClientRect().width / c.width : 1;
  });
  let v = VUNG.length === 4 ? VUNG : null;
  if (!v && info.hop) {
    const dem = 14;
    v = [
      Math.round(info.hop.trai * tiLe) - dem,
      Math.round(info.hop.tren * tiLe) - dem,
      Math.round((info.hop.phai - info.hop.trai) * tiLe) + dem * 2,
      Math.round((info.hop.duoi - info.hop.tren) * tiLe) + dem * 2,
    ];
  }
  if (v) {
    const lan = Math.max(2, Math.min(8, Math.round(640 / Math.max(v[2], v[3]))));
    phong(goc, `${THU}/TRAN-${vai}-${NHAN}-PHONG.png`, v[0], v[1], v[2], v[3], lan);
    vungRa[vai] = v;
  }
  console.log(
    `${vai} ${NHAN}: soBT=${info.so} far=${info.tk?.far} camXa=${info.tk?.camXa} tiLe=${tiLe.toFixed(3)} vùng=${JSON.stringify(v)} rộngPx=${JSON.stringify(info.rong)}`,
  );
  await ctx.close();
}
fs.writeFileSync(`.qa-tapdoan/p50b-vung-tran-${NHAN}.json`, JSON.stringify(vungRa, null, 1));
await trinh.close();
