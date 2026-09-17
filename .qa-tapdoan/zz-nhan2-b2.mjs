/**
 * b2-mot-nha-may.mjs — ★★★ ĐỐI CHỨNG ÂM: `/twin` MỘT NHÀ MÁY, **CẢ 2D LẪN 3D**.
 *
 *   node .qa-tapdoan/b2-mot-nha-may.mjs <nhan>
 *
 * `t19-mot-nha-may.mjs` (đã có) đo đường một nhà máy ở bản **3D**. Tiêu chí 4
 * của chủ đợt lần này nói rõ "ở **cả** 2D lẫn 3D", mà bản vá lượt này đụng đúng
 * `CanhVanHanh2D` — nên đối chứng cũ MỘT MÌNH không đủ: nó mù đúng chỗ bản vá
 * chạm vào.
 *
 * ⇒ Tệp này đo cùng đường ấy ở CẢ HAI chế độ và ghi ra JSON để so BYTE giữa hai
 *   bản dựng. Số phải khớp tuyệt đối; lệch một ô là một hồi quy.
 *
 * ⚠ KHÔNG so với `t19-mot-nha-may-sau.json` của lượt trước cho các ô `toa`/
 *   `tang`: dữ liệu QATD đã được SINH LẠI lúc 2026-09-16T09:05Z nên mã định
 *   danh đổi hết. Vì thế phép so phải là TRƯỚC↔SAU trên CÙNG bộ dữ liệu, chạy
 *   trong cùng phiên — không kế thừa mốc của lượt khác.
 */
import { chromium } from "playwright";
import fs from "node:fs";

const NHAN = process.argv[2] ?? "sau";
const GOC = process.env.GOC_QA || "http://localhost:3064";
const trinh = await chromium.launch({
  args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const ra = {};
const ANH = `.qa-tapdoan/anh/b2-mnm-${NHAN}`;
fs.mkdirSync(ANH, { recursive: true });

for (const ten of ["qatd_giamdoc", "qatd_quanly"]) {
  const ctx = await trinh.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const loi = [];
  page.on("pageerror", (e) => loi.push(String(e).slice(0, 160)));
  await page.request.post(`${GOC}/api/auth/login`, {
    data: { username: ten, password: "Qatd!2026" },
  });
  await page.goto(`${GOC}/twin?do=1`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("man-twin-van-hanh").waitFor({ timeout: 90_000 }).catch(() => {});
  await page
    .waitForFunction(() => (window.__demTuongTac?.dsMay?.()?.length ?? 0) > 0, undefined, {
      timeout: 120_000,
      polling: 1000,
    })
    .catch(() => {});
  await page.waitForTimeout(2500);

  const doc3d = await page.evaluate(() => {
    const q = (id) => document.querySelector(`[data-testid='${id}']`);
    return {
      soMayVe: window.__demTuongTac?.dsMay?.()?.length ?? -1,
      demMay: q("dem-may")?.textContent?.trim() ?? null,
      breadcrumb: q("breadcrumb-twin")?.textContent?.trim() ?? null,
      toa: q("chon-toa-nha")?.value ?? null,
      tang: q("chon-tang")?.value ?? null,
      soTang: q("chon-tang")?.options?.length ?? -1,
      calls: window.__thongKeVe?.calls ?? null,
      triangles: window.__thongKeVe?.triangles ?? null,
      soNhan: window.__demTuongTac?.hopNhanDaVe?.()?.length ?? -1,
      soHangMay: document.querySelectorAll("[data-testid^='may-hang-']").length,
      soViec: q("dai-hop-nhat")?.getAttribute("data-so-viec") ?? null,
      // ★ Sa bàn PHẢI rỗng ở cấp một nhà máy — nếu không thì bản vá đã rò sang đây.
      soBieuTuongSaBan: window.__demSaBan?.bieuTuong?.()?.length ?? 0,
    };
  });
  const c3 = await page.$("canvas");
  if (c3) await c3.screenshot({ path: `${ANH}/${ten}-3d.png` }).catch(() => {});

  // ── SANG 2D, cùng trang, cùng phạm vi ────────────────────────────────────
  await page.getByTestId("nut-che-2d").click({ timeout: 15_000 });
  await page.getByTestId("canh-van-hanh-2d").waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1800);
  const osvg = await page.$("[data-testid='canh-van-hanh-2d']");
  if (osvg) await osvg.screenshot({ path: `${ANH}/${ten}-2d.png` }).catch(() => {});

  const doc2d = await page.evaluate(() => {
    const svg = document.querySelector("[data-testid='canh-van-hanh-2d']");
    const g = [...document.querySelectorAll("[data-testid^='may-2d-']")];
    const ws = g
      .map((e) => e.querySelector("rect")?.getBoundingClientRect().width ?? 0)
      .sort((a, b) => a - b);
    return {
      viewBox: svg.getAttribute("viewBox"),
      donViVe: svg.getAttribute("data-don-vi-ve"),
      soMay2D: g.length,
      soBieuTuong2D: svg.querySelectorAll("[data-testid='toa-2d-sa-ban']").length,
      soNenCum2D: svg.querySelectorAll("[data-testid='cum-2d-sa-ban']").length,
      soNutSvg: svg.querySelectorAll("*").length,
      rongPxMin: Math.round((ws[0] ?? 0) * 100) / 100,
      rongPxMax: Math.round((ws.at(-1) ?? 0) * 100) / 100,
      aria: svg.getAttribute("aria-label"),
      trangThaiDau: g[0]?.getAttribute("data-trang-thai") ?? null,
    };
  });

  ra[ten] = { "3D": doc3d, "2D": doc2d, loi };
  console.log(`[${NHAN}] ${ten}`);
  console.log(`   3D ${JSON.stringify(doc3d)}`);
  console.log(`   2D ${JSON.stringify(doc2d)}`);
  await ctx.close();
}
await trinh.close();
fs.writeFileSync(`.qa-tapdoan/b2-mot-nha-may-${NHAN}.json`, JSON.stringify(ra, null, 1));
console.log(`→ .qa-tapdoan/b2-mot-nha-may-${NHAN}.json · ảnh ${ANH}`);
