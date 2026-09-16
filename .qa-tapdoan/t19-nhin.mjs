/**
 * t19-nhin.mjs — CẢNH TẬP ĐOÀN CÓ NHÌN THẤY ĐƯỢC KHÔNG?
 *
 * Ngân sách vẽ (§4) ĐẠT không chứng minh người dùng THẤY gì: 1.108 khối đúng chỗ
 * trên một khuôn viên 2,25 km chiếu xuống 968 px là ~0,2 px mỗi máy. Script này
 * đo ĐỘ RỘNG THẬT của một khối máy trên màn, và chụp ảnh ở ba mức thu phóng để
 * người đọc tự nhìn thay vì tin một con số.
 */
import { chromium } from "playwright";
import fs from "node:fs";

const NHAN = process.argv[2] ?? "sau";
const GOC = "http://localhost:3064";
const ANH = `.qa-tapdoan/anh/t19-nhin-${NHAN}`;
fs.mkdirSync(ANH, { recursive: true });

const trinh = await chromium.launch({
  args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const ctx = await trinh.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
await page.request.post(`${GOC}/api/auth/login`, {
  data: { username: "qatd_giamdoc", password: "Qatd!2026" },
});
await page.goto(`${GOC}/twin?pv=tapdoan&do=1`, { waitUntil: "domcontentloaded" });
await page.getByTestId("man-twin-van-hanh").waitFor({ timeout: 90_000 });
await page
  .waitForFunction(() => (window.__demTuongTac?.dsMay?.()?.length ?? 0) > 0, undefined, {
    timeout: 120_000,
    polling: 1000,
  })
  .catch(() => {});
await page.waitForTimeout(2500);

const doHop = () =>
  page.evaluate(() => {
    const hop = window.__demTuongTac?.hopKhoiMay?.() ?? [];
    const ds = window.__demTuongTac?.dsMay?.() ?? [];
    const rong = hop.map((h) => h.hop.phai - h.hop.trai).filter((n) => Number.isFinite(n));
    rong.sort((a, b) => a - b);
    const c = document.querySelector("canvas")?.getBoundingClientRect();
    return {
      soMay: ds.length,
      soHopKhoi: hop.length,
      rongKhoiPx: {
        min: rong[0] ?? null,
        giua: rong[Math.floor(rong.length / 2)] ?? null,
        max: rong[rong.length - 1] ?? null,
      },
      trongKhung: ds.filter((m) => m.trongKhung).length,
      trai: Math.min(...ds.map((m) => m.x)),
      phai: Math.max(...ds.map((m) => m.x)),
      canvasW: c ? Math.round(c.width) : null,
    };
  });

const buoc = [];
buoc.push({ muc: "mac-dinh", ...(await doHop()) });
await page.screenshot({ path: `${ANH}/0-mac-dinh.png` });

const c = await page.$("canvas");
const box = await c.boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;
for (const [i, lan] of [8, 16].entries()) {
  await page.mouse.move(cx, cy);
  for (let k = 0; k < lan; k += 1) {
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(1200);
  buoc.push({ muc: `cuon-vao-${lan}`, ...(await doHop()) });
  await page.screenshot({ path: `${ANH}/${i + 1}-cuon-${lan}.png` });
}

console.table(buoc.map((b) => ({ muc: b.muc, soMay: b.soMay, khoiPx_giua: b.rongKhoiPx.giua, khoiPx_max: b.rongKhoiPx.max, trai: Math.round(b.trai), phai: Math.round(b.phai), canvasW: b.canvasW })));
fs.writeFileSync(`.qa-tapdoan/t19-nhin-${NHAN}.json`, JSON.stringify(buoc, null, 1));
await trinh.close();
