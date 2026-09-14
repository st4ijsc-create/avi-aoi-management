// ĐỢT 58 — PHÂN XỬ 2 SAI của D-1 (#15 trạng thái · #16 tuổi dữ liệu).
// Đường đo ĐỘC LẬP VỚI testid: chỉ đọc CHỮ NGƯỜI DÙNG NHÌN THẤY (innerText từng vùng),
// không đọc `data-gia-tri`/`data-trang-thai`. Ba nguồn cho CÙNG một máy phải nói một điều:
//   ① chữ trên màn Máy (cảnh + ngăn phải)   ② chữ trong cockpit 2D nhúng   ③ chữ trên /twin
// (DB đo riêng bằng .qa-dot37/db.mjs may — SQL thô, không qua tRPC.)
//   node .qa-dot58/bat-bien-may.mjs --base=... --tag=head --may=14,18 --lang=vi
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? m.slice(k.length + 3) : d; };
const BASE = arg("base", "http://localhost:3058");
const TAG = arg("tag", "head");
const LANG = arg("lang", "vi");
const MAYS = arg("may", "14,18").split(",");
const OUT = `.qa-dot58/batbien-${TAG}-${LANG}`;
mkdirSync(OUT, { recursive: true });
const TK = { username: "e2e_tai_loE", password: "E2eTaiLoE!2026" };
async function dangNhap(ctx) {
  const f = `.qa-dot58/state-${TK.username}.json`;
  const ai = async () => { const r = await ctx.request.get(`${BASE}/api/trpc/auth.me`); try { return JSON.parse(await r.text())?.result?.data?.json?.username ?? null; } catch { return null; } };
  if (existsSync(f)) { await ctx.addCookies(JSON.parse(readFileSync(f, "utf8"))); if ((await ai()) === TK.username) return; await ctx.clearCookies(); }
  const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: TK });
  if (r.status() !== 200 || (await ai()) !== TK.username) throw new Error("dang nhap that bai");
  writeFileSync(f, JSON.stringify(await ctx.cookies()));
}
/* Gom CHỮ theo VÙNG HÌNH HỌC, không theo testid: chia màn thành "khối cảnh" (canvas + lớp phủ
   trên nó), "ngăn phải" (x > 65 % bề ngang), "thanh trên" (y < 64), "cockpit" (phần còn lại). */
const GOM_CHU = () => {
  const hien = (el) => { const cs = getComputedStyle(el); if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false; const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && b.right > 0 && b.bottom > 0 && b.left < innerWidth && b.top < innerHeight; };
  const la = [];
  for (const el of document.querySelectorAll("body *")) {
    if (!(el instanceof HTMLElement)) continue;
    const truc = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").replace(/\s+/g, " ").trim();
    if (!truc) continue;
    if (!hien(el)) continue;
    const b = el.getBoundingClientRect();
    la.push({ chu: truc, x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) });
  }
  const cv = document.querySelector("canvas");
  const cb = cv ? cv.getBoundingClientRect() : null;
  const trong = (t, r) => t.x >= r.left - 2 && t.x + t.w <= r.right + 2 && t.y >= r.top - 2 && t.y + t.h <= r.bottom + 2;
  const vung = { thanhTren: [], khoiCanh: [], nganPhai: [], cockpit: [], khac: [] };
  for (const t of la) {
    if (t.y < 64) { vung.thanhTren.push(t); continue; }
    if (cb && trong(t, cb)) { vung.khoiCanh.push(t); continue; }
    if (t.x > innerWidth * 0.65) { vung.nganPhai.push(t); continue; }
    vung.cockpit.push(t);
  }
  const sap = (a) => a.sort((p, q) => p.y - q.y || p.x - q.x).map((t) => `${t.chu}`);
  return { canvasRect: cb ? { x: Math.round(cb.x), y: Math.round(cb.y), w: Math.round(cb.width), h: Math.round(cb.height) } : null, thanhTren: sap(vung.thanhTren), khoiCanh: sap(vung.khoiCanh), nganPhai: sap(vung.nganPhai), cockpit: sap(vung.cockpit), toanVan: document.body.innerText.replace(/\n{2,}/g, "\n").slice(0, 6000) };
};
const kq = {};
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await ctx.addInitScript((l) => { try { localStorage.setItem("i18nextLng", l); } catch {} }, LANG);
  await dangNhap(ctx);
  const page = await ctx.newPage();
  for (const id of MAYS) {
    await page.goto(`${BASE}/twin/may/${id}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="khoi-canh-may"] canvas', { timeout: 90_000 }).catch(() => {});
    await page.waitForSelector('[data-testid="cockpit-2d"] [role="tablist"]', { timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(9000);
    const g = await page.evaluate(GOM_CHU);
    await page.screenshot({ path: `${OUT}/may-${id}.png` });
    kq[`may${id}`] = g;
    console.log(`--- máy ${id} (${LANG}) ---`);
    console.log(`  THANH TRÊN : ${g.thanhTren.join(" | ").slice(0, 200)}`);
    console.log(`  KHỐI CẢNH  : ${g.khoiCanh.join(" | ").slice(0, 300)}`);
    console.log(`  NGĂN PHẢI  : ${g.nganPhai.join(" | ").slice(0, 400)}`);
    console.log(`  COCKPIT    : ${g.cockpit.join(" | ").slice(0, 400)}`);
  }
  /* /twin — hàng của máy trong danh sách (nguồn thứ ba) */
  await page.goto(`${BASE}/twin`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="man-twin-van-hanh"] canvas', { timeout: 90_000 }).catch(() => {});
  await page.waitForTimeout(8000);
  kq.twinHang = await page.evaluate((ids) => {
    const ra = {};
    for (const id of ids) {
      const el = document.querySelector(`[data-testid="may-hang-${id}"]`);
      ra[id] = el ? (el.innerText || "").replace(/\s+/g, " ").trim() : null;
    }
    return ra;
  }, MAYS.map(Number));
  await page.screenshot({ path: `${OUT}/twin.png` });
  console.log(`  /twin hàng máy: ${JSON.stringify(kq.twinHang)}`);
  await ctx.close();
} finally { await browser.close(); }
writeFileSync(`${OUT}/kq.json`, JSON.stringify(kq, null, 2));
console.log(`=== bat-bien-may tag=${TAG} lang=${LANG} xong → ${OUT}/kq.json ===`);
