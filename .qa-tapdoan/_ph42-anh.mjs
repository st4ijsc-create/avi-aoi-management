/**
 * _ph42-anh.mjs — ẢNH NGHIỆM THU: ba bề mặt chọn, ĐỦ TO ĐỂ NHÌN BẰNG MẮT.
 *
 * Ảnh khung mặc định của `/factory-command` với 1.108 máy cho mỗi khối ~vài px, và
 * lớp phủ `sheet-overlay` còn làm tối thêm — nhìn không ra viền trắng hay nhấn sáng.
 * Nên ở đây: CUỘN VÀO trước, chọn một máy Ở NỬA TRÁI canvas (ngăn chi tiết chiếm nửa
 * phải), rồi cắt đúng vùng canvas.
 *
 * Ba khung: ① chưa chọn · ② đã chọn · ③ sau khi bỏ chọn. Mỗi khung kèm số của
 * `window.__demChonChiHuy()` để ảnh và số không thể nói hai điều khác nhau.
 */
import { chromium } from "playwright";
import fs from "node:fs";

const NHAN = process.argv[2] ?? "sau";
const GOC = process.env.PH42_GOC ?? "http://localhost:3066";
const THU_MUC = `.qa-tapdoan/anh/ph42-mat-${NHAN}`;
fs.mkdirSync(THU_MUC, { recursive: true });

const trinh = await chromium.launch({
  args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const ctx = await trinh.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
const loi = [];
page.on("pageerror", (e) => loi.push(String(e).slice(0, 200)));

await page.request.post(`${GOC}/api/auth/login`, {
  data: { username: "qatd_giamdoc", password: "Qatd!2026" },
});
await page.goto(`${GOC}/factory-command?do=1`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
await page.getByRole("button", { name: "3D", exact: true }).click();
await page
  .waitForFunction(() => (window.__demTuongTac?.dsMay?.()?.length ?? 0) > 0, undefined, {
    timeout: 120_000,
    polling: 500,
  })
  .catch(() => {});
await page.waitForTimeout(2500);

const hop = await page.evaluate(() => {
  const r = document.querySelector("canvas").getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
});

// ── CUỘN VÀO: khối máy ở khung mặc định chỉ vài px (PH-44), không nhìn ra viền ──
await page.mouse.move(hop.x + hop.width / 2, hop.y + hop.height / 2);
for (let i = 0; i < 14; i += 1) {
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(120);
}
await page.waitForTimeout(1500);

const doc = () =>
  page.evaluate(() => ({
    chon: window.__demChonChiHuy?.() ?? null,
    sheetMo: Boolean(document.querySelector("[data-slot='sheet-content']")),
    nhanChon: [...document.querySelectorAll("[data-testid='nhan-may-twin3d']")]
      .filter((e) => /59, 130, 246|#3b82f6|--primary/.test(e.style.border))
      .map((e) => Number(e.getAttribute("data-machine-id"))),
    rongKhoiPx: (() => {
      const ds = window.__demTuongTac?.hopKhoiMay?.() ?? [];
      const w = ds.map((k) => k.hop.phai - k.hop.trai).sort((a, b) => a - b);
      return w.length ? Math.round(w[Math.floor(w.length / 2)] * 10) / 10 : null;
    })(),
  }));

const so = [];
const chup = async (ten) => {
  const d = await doc();
  so.push({ ten, ...d });
  await page.screenshot({ path: `${THU_MUC}/${ten}.png`, clip: hop });
  console.log(ten, JSON.stringify(d));
};

await chup("1-chua-chon");

// ── chọn một máy ở NỬA TRÁI canvas (ngăn chi tiết chiếm nửa phải) ──
const muc = await page.evaluate((w) => {
  const ds = (window.__demTuongTac?.dsMay?.() ?? []).filter((m) => m.trongKhung && m.x < w * 0.45);
  return ds[Math.floor(ds.length / 2)] ?? null;
}, hop.width);
if (!muc) throw new Error("không tìm được máy ở nửa trái — ảnh sẽ vô nghĩa, dừng");
await page.mouse.click(hop.x + muc.x, hop.y + muc.y);
await page.waitForTimeout(4000); // camera BAY (focusId) rồi mới chụp
await chup("2-da-chon");

// ── bỏ chọn qua Escape (đóng ngăn ⇒ `setSelectedId(null)`) ──
await page.keyboard.press("Escape");
await page.waitForTimeout(1500);
await chup("3-sau-bo-chon");

fs.writeFileSync(`.qa-tapdoan/_ph42-anh-${NHAN}.json`, JSON.stringify({ so, loi, muc }, null, 1));
console.log("loi:", JSON.stringify(loi));
await ctx.close();
await trinh.close();
