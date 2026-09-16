/**
 * n2-hinh.mjs — lấy HÌNH HỌC MÔ HÌNH của sa bàn 2D (đơn vị mét, đọc thẳng từ
 * thuộc tính `x/y/width/height` của `<rect>`), để mô phỏng các hướng vá NGOÀI
 * trang trước khi sửa một dòng mã nào (`_t21-sim.mts` đã bác bỏ 2 hướng theo
 * đúng cách này).
 *
 *   node .qa-tapdoan/n2-hinh.mjs
 */
import { chromium } from "playwright";
import fs from "node:fs";

const GOC = "http://localhost:3064";
const MK = "Qatd!2026";
const VAI = ["qatd_giamdoc", "qatd_quanly", "qatd_kythuat", "qatd_congnhan", "qatd_admin"];

const trinh = await chromium.launch({
  args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const ra = {};

for (const vai of VAI) {
  const ctx = await trinh.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await page.request.post(`${GOC}/api/auth/login`, { data: { username: vai, password: MK } });
  await page.goto(`${GOC}/twin?pv=tapdoan&do=1`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("man-twin-van-hanh").waitFor({ timeout: 90_000 }).catch(() => {});
  await page
    .waitForFunction(
      () => {
        const n = document.querySelectorAll("[data-testid='nhan-cum-sa-ban']").length;
        const on = window.__n2 === n && n > 0;
        window.__n2 = n;
        return on;
      },
      undefined,
      { timeout: 120_000, polling: 1000 },
    )
    .catch(() => {});
  await page.getByTestId("nut-che-2d").click({ timeout: 15_000 }).catch(() => {});
  await page.getByTestId("canh-van-hanh-2d").waitFor({ timeout: 45_000 }).catch(() => {});
  await page.waitForTimeout(1200);

  ra[vai] = await page.evaluate(() => {
    const svg = document.querySelector("[data-testid='canh-van-hanh-2d']");
    const r = svg.getBoundingClientRect();
    const so = (e, a) => Number(e.getAttribute(a));
    const cum = [...svg.querySelectorAll("[data-testid='cum-2d-sa-ban']")].map((e) => ({
      factoryId: so(e, "data-factory-id"),
      x: so(e, "x"),
      y: so(e, "y"),
      w: so(e, "width"),
      h: so(e, "height"),
    }));
    const toa = [...svg.querySelectorAll("[data-testid='toa-2d-sa-ban']")].map((e) => ({
      toaNhaId: so(e, "data-toa-nha-id"),
      factoryId: so(e, "data-factory-id"),
      x: so(e, "x"),
      y: so(e, "y"),
      w: so(e, "width"),
      h: so(e, "height"),
    }));
    const nhanCum = [...svg.querySelectorAll("[data-testid='nhan-cum-sa-ban-2d']")].map((e) => {
      const bb = e.getBBox();
      return {
        factoryId: so(e, "data-factory-id"),
        chu: e.textContent.trim(),
        x: so(e, "x"),
        y: so(e, "y"),
        co: Number(e.getAttribute("font-size")),
        bb: { x: bb.x, y: bb.y, w: bb.width, h: bb.height },
      };
    });
    const nhanToa = [...svg.querySelectorAll("[data-testid='nhan-toa-sa-ban-2d']")].map((e) => {
      const bb = e.getBBox();
      return {
        toaNhaId: so(e, "data-toa-nha-id"),
        chu: e.textContent.trim(),
        x: so(e, "x"),
        y: so(e, "y"),
        co: Number(e.getAttribute("font-size")),
        bb: { x: bb.x, y: bb.y, w: bb.width, h: bb.height },
      };
    });
    const lopPhu = [...document.querySelectorAll("[data-che-nhan]")]
      .map((e) => {
        const b = e.getBoundingClientRect();
        return {
          ten: e.getAttribute("data-testid"),
          trai: b.x - r.x,
          phai: b.right - r.x,
          tren: b.y - r.y,
          duoi: b.bottom - r.y,
        };
      })
      .filter((o) => o.phai > o.trai && o.duoi > o.tren);
    return {
      viewBox: svg.getAttribute("viewBox"),
      svgPx: { w: r.width, h: r.height },
      cum,
      toa,
      nhanCum,
      nhanToa,
      lopPhu,
    };
  });
  console.log(
    `${vai}: viewBox=${ra[vai].viewBox} cụm=${ra[vai].cum.length} toà=${ra[vai].toa.length}` +
      ` cỡChữCụm=${ra[vai].nhanCum[0] && ra[vai].nhanCum[0].co}`,
  );
  await ctx.close();
}
await trinh.close();
fs.writeFileSync(".qa-tapdoan/n2-hinh.json", JSON.stringify(ra, null, 1));
console.log("→ .qa-tapdoan/n2-hinh.json");
