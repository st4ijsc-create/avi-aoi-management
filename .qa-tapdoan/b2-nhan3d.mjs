/**
 * b2-nhan3d.mjs — bản 3D giấu/hiện bao nhiêu nhãn ở CÙNG khung mặc định?
 * Dùng để so PARITY: nếu 3D cũng bị lớp phủ nuốt nhãn cụm thì đó là nợ bố cục
 * trang có TRƯỚC lượt này (Task 20 đã khai), không phải thứ bản vá 2D sinh ra.
 */
import { chromium } from "playwright";
const GOC = "http://localhost:3064";
const trinh = await chromium.launch({ args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"] });
for (const vai of ["qatd_giamdoc", "qatd_quanly"]) {
  const ctx = await trinh.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await page.request.post(`${GOC}/api/auth/login`, { data: { username: vai, password: "Qatd!2026" } });
  await page.goto(`${GOC}/twin?pv=tapdoan&do=1`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("man-twin-van-hanh").waitFor({ timeout: 90_000 }).catch(() => {});
  await page.waitForTimeout(8000);
  const o = await page.evaluate(() => {
    const ds = [...document.querySelectorAll("[data-testid='nhan-cum-sa-ban']")];
    const svg = null;
    const canvas = document.querySelector("canvas");
    return {
      soNhan: window.__demSaBan?.soNhan?.() ?? null,
      cum: ds.map((e) => {
        const st = getComputedStyle(e).display;
        const r = e.getBoundingClientRect();
        const tren = r.width ? document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) : null;
        return {
          chu: e.textContent.trim(),
          display: st,
          hop: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
          tren: tren ? `${tren.tagName}${tren.getAttribute?.("data-testid") ? "#" + tren.getAttribute("data-testid") : ""}` : null,
          laNhanNay: tren === e || e.contains(tren),
        };
      }),
      canvasCo: canvas ? { w: canvas.clientWidth, h: canvas.clientHeight } : null,
    };
  });
  console.log(`\n══ ${vai} ══ soNhan=${JSON.stringify(o.soNhan)}`);
  for (const c of o.cum) console.log(`  "${c.chu}" display=${c.display} hop=${JSON.stringify(c.hop)} trên=${c.tren} đọcĐược=${c.laNhanNay}`);
  await ctx.close();
}
await trinh.close();
