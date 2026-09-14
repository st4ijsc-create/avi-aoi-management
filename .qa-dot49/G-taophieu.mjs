// ĐỢT 49 · mục G — đo KẾT CỤC: `/twin/may/14` có `<section nhom-tao-viec>` hay không, theo vai.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
const BASE = process.env.BASE || "http://localhost:3049";
const OUT = process.env.OUT || ".qa-dot49/G"; mkdirSync(OUT, { recursive: true });
const VAI = [
  { u: "e2e_dot49_co", p: "Dot49Co!2026", mong: true },
  { u: "e2e_dot49_khong", p: "Dot49Khong!2026", mong: false },
];
const browser = await chromium.launch(); const kq = [];
try { for (const v of VAI) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem("i18nextLng", "vi"); } catch {} });
  const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: v.u, password: v.p } });
  const me = await (await ctx.request.get(`${BASE}/api/trpc/auth.me`)).text();
  let j = null; try { j = JSON.parse(me); } catch {}
  const danhTinh = j?.result?.data?.json?.username ?? j?.result?.data?.username ?? null;
  const page = await ctx.newPage();
  await page.goto(`${BASE}/twin/may/14`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="man-twin-may"]', { timeout: 90_000 }).catch(() => {});
  await page.waitForTimeout(6_000);
  const do_ = await page.evaluate(() => ({
    nhomTaoViec: document.querySelectorAll('[data-testid="nhom-tao-viec"]').length,
    nganXuLy: document.querySelectorAll('[data-testid="ngan-xu-ly"]').length,
    nutTaoPhieu: [...document.querySelectorAll("button")].filter((b) => /Tạo phiếu/i.test(b.textContent || "")).length,
    coCanvas: document.querySelectorAll('[data-testid="man-twin-may"] canvas').length,
  }));
  const hang = { vai: v.u, login: r.status(), danhTinh, mongCo: v.mong, ...do_, dat: (do_.nhomTaoViec > 0) === v.mong };
  kq.push(hang);
  console.log(`[${v.u}] login=${r.status()} auth.me=${danhTinh} · canvas=${do_.coCanvas} · nhom-tao-viec=${do_.nhomTaoViec} (mong ${v.mong ? "CÓ" : "KHÔNG"}) · nút "Tạo phiếu"=${do_.nutTaoPhieu} ⇒ ${hang.dat ? "ĐẠT" : "SAI"}`);
  await page.screenshot({ path: `${OUT}/may14-${v.u}.png` });
  await page.close(); await ctx.close();
} } finally { await browser.close(); }
writeFileSync(`${OUT}/tong.json`, JSON.stringify(kq, null, 2));
console.log(`=== G: ${kq.filter((k) => k.dat).length}/${kq.length} ĐẠT (hai chiều) ===`);
