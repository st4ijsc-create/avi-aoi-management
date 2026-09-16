/**
 * b2-che.mjs — AI đang che nhãn cụm, và che ở ĐÂU.
 *
 * Phép đo `b2-do.mjs` nói "Công ty A ← SPAN" nhưng không nói SPAN nào, to bằng
 * nào, thuộc lớp phủ nào. Không biết thủ phạm thì mọi bản vá đều là đoán.
 * Tệp này in: bao hình nhãn, chuỗi tổ tiên của phần tử che, và TOÀN BỘ vùng cấm
 * mà `layVungCam()` (hàm bản 3D dùng) nhìn thấy.
 */
import { chromium } from "playwright";

const GOC = "http://localhost:3064";
const vai = process.argv[2] ?? "qatd_giamdoc";
const trinh = await chromium.launch({
  args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const ctx = await trinh.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
await page.request.post(`${GOC}/api/auth/login`, { data: { username: vai, password: "Qatd!2026" } });
await page.goto(`${GOC}/twin?pv=tapdoan&do=1`, { waitUntil: "domcontentloaded" });
await page.getByTestId("man-twin-van-hanh").waitFor({ timeout: 90_000 }).catch(() => {});
await page.waitForTimeout(6000);
await page.getByTestId("nut-che-2d").click({ timeout: 15_000 });
await page.getByTestId("canh-van-hanh-2d").waitFor({ timeout: 30_000 });
await page.waitForTimeout(1500);

const o = await page.evaluate(() => {
  const svg = document.querySelector("[data-testid='canh-van-hanh-2d']");
  const r0 = svg.getBoundingClientRect();
  const ten = (e) =>
    `${e.tagName.toLowerCase()}${e.getAttribute?.("data-testid") ? "[" + e.getAttribute("data-testid") + "]" : ""}${e.className && typeof e.className === "string" ? "." + e.className.split(/\s+/).slice(0, 3).join(".") : ""}`;
  const to = (e) => {
    const r = e.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const nhan = [...svg.querySelectorAll("[data-testid='nhan-cum-sa-ban-2d']")].map((e) => {
    const r = e.getBoundingClientRect();
    const x = r.x + r.width / 2;
    const y = r.y + r.height / 2;
    const tren = document.elementFromPoint(x, y);
    const to3 = [];
    let p = tren;
    for (let i = 0; i < 6 && p; i += 1) {
      to3.push(`${ten(p)} ${JSON.stringify(to(p))} z=${getComputedStyle(p).zIndex}`);
      p = p.parentElement;
    }
    return { chu: e.textContent.trim(), hop: to(e), diem: { x: Math.round(x), y: Math.round(y) }, to3 };
  });
  const cheNhan = [...document.querySelectorAll("[data-che-nhan]")].map((e) => ({
    ten: ten(e),
    hop: to(e),
  }));
  return { hopSvg: to(svg), r0: { x: r0.x, y: r0.y }, nhan, cheNhan };
});

console.log("svg:", JSON.stringify(o.hopSvg));
console.log("\nlớp tự khai `data-che-nhan` (thứ `layVungCam` nhìn thấy):");
for (const c of o.cheNhan) console.log("  ", c.ten, JSON.stringify(c.hop));
console.log("\nnhãn cụm:");
for (const n of o.nhan) {
  console.log(`  "${n.chu}" hop=${JSON.stringify(n.hop)} tâm=${JSON.stringify(n.diem)}`);
  for (const t of n.to3) console.log("      ↑", t);
}
await ctx.close();
await trinh.close();
