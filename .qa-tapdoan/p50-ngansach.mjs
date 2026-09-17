/**
 * p50-ngansach.mjs — NGÂN SÁCH VẼ + FPS cho **CẢ 5 VAI CÓ CỤM**, khung MẶC ĐỊNH.
 *
 *   node .qa-tapdoan/p50-ngansach.mjs <nhan>
 *
 * `t21-do.mjs` chỉ đo 2 vai (giamdoc, quanly). Tiêu chí 2 của chủ đợt đòi bốn ô
 * ngân sách cho **bốn vai QATD**, còn tiêu chí 1 đòi ba trong bốn ô ấy cho
 * `qatd_admin` — nên phải có một lượt đo phủ cả năm. Thước GIỮ NGUYÊN của t21:
 *   lệnh vẽ · tam giác · số nhãn DOM · fps khi ĐANG XOAY (ANGLE+GPU, không SwiftShader).
 *
 * ★ Chốt "khác rỗng + qua N giây" (luật 3): đợi số nhãn ỔN ĐỊNH và **> 0**, rồi
 *   chờ thêm — một harness đứng yên trên tập rỗng đã khai sai một lần ở vòng trước.
 *   ⚠ Ngoại lệ có chủ ý: `qatd_admin` TRƯỚC VÁ có 19 nhãn DOM nhưng 0 biểu tượng
 *     chiếu được; chốt theo nhãn DOM vẫn khác rỗng nên vẫn hợp lệ.
 */
import { chromium } from "playwright";
import fs from "node:fs";

const NHAN = process.argv[2] ?? "truoc";
const GOC = "http://localhost:3064";
const MK = "Qatd!2026";
const RA = `.qa-tapdoan/p50-ngansach-${NHAN}.json`;
const VAI = ["qatd_giamdoc", "qatd_quanly", "qatd_kythuat", "qatd_congnhan", "qatd_admin"];

const trinh = await chromium.launch({
  args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const ra = { nhan: NHAN, luc: new Date().toISOString(), khung: "1280x720 mặc định, không thu panel", vai: {} };

for (const vai of VAI) {
  const ctx = await trinh.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const loi = [];
  page.on("pageerror", (e) => loi.push(String(e).slice(0, 200)));
  await page.request.post(`${GOC}/api/auth/login`, { data: { username: vai, password: MK } });
  await page.goto(`${GOC}/twin?pv=tapdoan&do=1`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("man-twin-van-hanh").waitFor({ timeout: 90_000 }).catch(() => {});
  await page
    .waitForFunction(
      () => {
        const n = document.querySelectorAll("[data-testid='nhan-cum-sa-ban']").length;
        const on = window.__p50ns === n && n > 0;
        window.__p50ns = n;
        return on;
      },
      undefined,
      { timeout: 120_000, polling: 1000 },
    )
    .catch(() => {});
  await page.waitForTimeout(3000);

  const truoc = await page.evaluate(() => ({
    thongKe: window.__thongKeVe ?? null,
    soBieuTuong: window.__demSaBan?.bieuTuong?.()?.length ?? -1,
    rongPx: (window.__demSaBan?.bieuTuong?.() ?? []).map((b) => Math.round(b.rongPx * 10) / 10),
    soNhan: window.__demSaBan?.soNhan?.() ?? null,
    nhanDom:
      document.querySelectorAll("[data-testid='nhan-toa-sa-ban']").length +
      document.querySelectorAll("[data-testid='nhan-cum-sa-ban']").length,
    banner: (() => {
      const e = document.querySelector("[data-testid='banner-vi-tri-tam-sinh']");
      if (!e) return null;
      const g = (k) => e.getAttribute(k);
      return {
        chu: (e.textContent ?? "").trim().slice(0, 420),
        rongThatMm: g("data-rong-that-mm"),
        rongSoDoMm: g("data-rong-so-do-mm"),
        bieuTuongRongMm: g("data-bieu-tuong-rong-mm"),
        bieuTuongSauMm: g("data-bieu-tuong-sau-mm"),
        thatCanhNhoMm: g("data-that-canh-nho-mm"),
        thatCanhLonMm: g("data-that-canh-lon-mm"),
      };
    })(),
  }));

  // ── fps khi ĐANG XOAY (thước t21 giữ nguyên) ───────────────────────────────
  let xoay = null;
  const c = await page.$("canvas");
  const box = c ? await c.boundingBox() : null;
  if (box) {
    await page.evaluate(() => {
      window.__p50k = 0;
      const dem = () => {
        window.__p50k += 1;
        window.__p50raf = requestAnimationFrame(dem);
      };
      window.__p50raf = requestAnimationFrame(dem);
      window.__p50t0 = performance.now();
    });
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 0; i < 40; i += 1) {
      await page.mouse.move(cx + Math.sin(i / 4) * 160, cy + Math.cos(i / 6) * 40);
      await page.waitForTimeout(40);
    }
    await page.mouse.up();
    xoay = await page.evaluate(() => {
      const ms = performance.now() - window.__p50t0;
      cancelAnimationFrame(window.__p50raf);
      return {
        khung: window.__p50k,
        ms: Math.round(ms),
        fps: Math.round((window.__p50k / ms) * 1000),
        thongKe: window.__thongKeVe ?? null,
        soBieuTuong: window.__demSaBan?.bieuTuong?.()?.length ?? -1,
      };
    });
  }

  ra.vai[vai] = { truoc, xoay, loi };
  console.log(
    `${vai.padEnd(15)} calls=${truoc.thongKe?.calls} tri=${truoc.thongKe?.triangles}` +
      ` biểuTượng=${truoc.soBieuTuong} nhãnDOM=${truoc.nhanDom}` +
      ` soNhan=${JSON.stringify(truoc.soNhan)} fps=${xoay?.fps ?? "-"}` +
      ` rộngPx=${truoc.rongPx.length ? `${Math.min(...truoc.rongPx)}..${Math.max(...truoc.rongPx)}` : "—"}` +
      ` lỗi=${loi.length}`,
  );
  if (truoc.banner) console.log(`   banner: ${JSON.stringify(truoc.banner)}`);
  await ctx.close();
}
await trinh.close();
fs.writeFileSync(RA, JSON.stringify(ra, null, 1));
console.log("→ " + RA);
