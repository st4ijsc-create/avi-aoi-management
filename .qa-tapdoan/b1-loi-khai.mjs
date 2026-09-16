/**
 * b1-loi-khai.mjs — MÀN NÓI GÌ ở chế độ 2D cấp tập đoàn?
 *
 *   node .qa-tapdoan/b1-loi-khai.mjs <nhan>
 *
 * Banner nằm SAU nút `nut-mo-dai-hop-nhat`; không bấm thì mọi phép đọc trả null
 * và ta sẽ kết luận sai là "màn không nói gì". Ở đây bấm mở dải rồi đọc NGUYÊN
 * VĂN từng banner ở CẢ HAI chế độ, cùng vai, cùng khung.
 *
 * Câu hỏi quyết định: `banner-vi-tri-tam-sinh` (Task 20) khai *"mỗi toà nhà là
 * một biểu tượng"*. Câu ấy có còn đứng khi người dùng bấm sang 2D — nơi màn vẽ
 * 1.108 KHỐI MÁY chứ không phải biểu tượng toà — hay không.
 */
import { chromium } from "playwright";
import fs from "node:fs";

const NHAN = process.argv[2] ?? "truoc";
const GOC = "http://localhost:3064";
const MK = "Qatd!2026";

const trinh = await chromium.launch({
  args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const ctx = await trinh.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
await page.request.post(`${GOC}/api/auth/login`, { data: { username: "qatd_giamdoc", password: MK } });
await page.goto(`${GOC}/twin?pv=tapdoan&do=1`, { waitUntil: "domcontentloaded" });
await page.getByTestId("man-twin-van-hanh").waitFor({ timeout: 90_000 }).catch(() => {});
await page
  .waitForFunction(() => (window.__thongKeVe?.calls ?? 0) > 0, undefined, { timeout: 120_000 })
  .catch(() => {});
await page.waitForTimeout(4000);

const docBanner = () =>
  page.evaluate(() => {
    const ds = [...document.querySelectorAll("[data-testid^='banner-']")];
    return {
      soBieuTuong3D: window.__demSaBan?.bieuTuong?.()?.length ?? null,
      soMay2D: document.querySelectorAll("[data-testid^='may-2d-']").length,
      coSvg2D: !!document.querySelector("[data-testid='canh-van-hanh-2d']"),
      coCanvas: document.querySelectorAll("canvas").length,
      nutChe2D: document.querySelector("[data-testid='nut-che-2d']")?.textContent?.trim() ?? null,
      ariaCanh:
        document.querySelector("[data-testid='canh-van-hanh-2d']")?.getAttribute("aria-label") ??
        document.querySelector("canvas")?.closest("[aria-label]")?.getAttribute("aria-label") ??
        null,
      banner: ds.map((e) => ({
        id: e.getAttribute("data-testid"),
        hien: getComputedStyle(e).display !== "none" && e.getBoundingClientRect().width > 0,
        chu: e.textContent.trim().replace(/\s+/g, " ").slice(0, 320),
        soToa: e.getAttribute("data-so-toa"),
        soKhoi: e.getAttribute("data-so-khoi"),
      })),
    };
  });

await page.getByTestId("nut-mo-dai-hop-nhat").click({ timeout: 10_000 }).catch(() => {});
await page.waitForTimeout(600);
const o3d = await docBanner();

await page.getByTestId("nut-che-2d").click({ timeout: 15_000 });
await page.getByTestId("canh-van-hanh-2d").waitFor({ timeout: 30_000 });
await page.waitForTimeout(2500);
/*
 * ⚠ SỬA THIẾT BỊ ĐO (in cả hai số, không âm thầm đổi thước):
 *   Lần chạy đầu bấm `nut-mo-dai-hop-nhat` LẦN HAI sau khi đổi sang 2D. Dải đã
 *   mở từ lượt 3D và trạng thái ấy SỐNG QUA lần đổi chế độ, nên cú bấm thứ hai
 *   ĐÓNG dải ⇒ đọc ra "0 banner trong DOM". Đó là lỗi của phép đo, không phải
 *   lời khai của sản phẩm. Nay: ĐỌC TRƯỚC, chỉ bấm khi thật sự chưa có banner.
 *   Số cũ (sai): 2D → 0 banner. Số mới ở dưới.
 */
const o2dTruocBam = await docBanner();
if (o2dTruocBam.banner.length === 0) {
  await page.getByTestId("nut-mo-dai-hop-nhat").click({ timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(600);
}
const o2d = await docBanner();
console.log(
  `\n(thiết bị đo) 2D trước khi bấm thêm: ${o2dTruocBam.banner.length} banner` +
    ` · sau: ${o2d.banner.length} banner`,
);

for (const [ten, o] of [
  ["3D", o3d],
  ["2D", o2d],
]) {
  console.log(
    `\n════ ${ten} ════ nút="${o.nutChe2D}" canvas=${o.coCanvas} svg2D=${o.coSvg2D}` +
      ` bieuTuong3D=${o.soBieuTuong3D} may2D=${o.soMay2D}`,
  );
  console.log(`  aria cảnh: ${o.ariaCanh}`);
  for (const b of o.banner) console.log(`  [${b.hien ? "HIỆN" : " ẩn "}] ${b.id} soToa=${b.soToa} :: ${b.chu}`);
  if (!o.banner.length) console.log("  (không banner nào trong DOM)");
}

fs.writeFileSync(
  `.qa-tapdoan/b1-loikhai-${NHAN}.json`,
  JSON.stringify({ nhan: NHAN, luc: new Date().toISOString(), o3d, o2d }, null, 1),
);
await ctx.close();
await trinh.close();
console.log(`\n→ .qa-tapdoan/b1-loikhai-${NHAN}.json`);
