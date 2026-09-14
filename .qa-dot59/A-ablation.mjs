// ĐỢT 59 — MỤC A · ABLATION HAI CHIỀU TRÊN CÙNG MỘT BẢN DỰNG (1600×900, vi).
// Chiều 1 (bản dựng): `dist-head0` (chưa vá) vs `dist-A` (đã vá) — xem A-truoc/A-sau.
// Chiều 2 (chạy thật, KHÔNG sửa mã): trên bản ĐÃ VÁ, gỡ `data-che-nhan` của tay nắm ⇒ phép đo
//   PHẢI kêu ĐỎ trở lại sau thu→mở. Nếu nó vẫn 0 thì phép đo đã chết, và "0 px²" của A-sau vô nghĩa.
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? m.slice(k.length + 3) : d; };
const BASE = arg("base", "http://localhost:3059");
const TAG = arg("tag", "A");
const OUT = `.qa-dot59/Aab-${TAG}`;
mkdirSync(OUT, { recursive: true });
const TK = { username: "e2e_tai_loE", password: "E2eTaiLoE!2026" };
async function dangNhap(ctx) {
  const f = `.qa-dot59/state-${TK.username}.json`;
  const ai = async () => { const r = await ctx.request.get(`${BASE}/api/trpc/auth.me`); try { return JSON.parse(await r.text())?.result?.data?.json?.username ?? null; } catch { return null; } };
  if (existsSync(f)) { await ctx.addCookies(JSON.parse(readFileSync(f, "utf8"))); if ((await ai()) === TK.username) return; await ctx.clearCookies(); }
  const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: TK });
  if (r.status() !== 200 || (await ai()) !== TK.username) throw new Error("dang nhap that bai");
  writeFileSync(f, JSON.stringify(await ctx.cookies()));
}
const DO = () => {
  const giao = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const hien = (el) => { const cs = getComputedStyle(el); if (cs.display === "none" || cs.visibility === "hidden") return false; const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
  const nhan = [...document.querySelectorAll('[data-testid="nhan-may-twin3d"]')].filter(hien);
  const el = document.querySelector('[data-testid="nut-thu-trai"]');
  const ra = { soNhan: nhan.length, tong: 0, che: [], cheNhan: el?.getAttribute("data-che-nhan") ?? null, hong: null };
  if (nhan.length === 0) { ra.hong = "0 nhan doc duoc"; return ra; }
  if (!el || !hien(el)) { ra.hong = "khong thay nut-thu-trai"; return ra; }
  const r = el.getBoundingClientRect();
  for (const n of nhan) { const g = giao(r, n.getBoundingClientRect()); if (g > 0.5) { ra.che.push({ chu: n.textContent.trim().slice(0, 24), giao: Math.round(g) }); ra.tong += Math.round(g); } }
  return ra;
};
const kq = { base: BASE, tag: TAG, moc: {} };
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem("i18nextLng", "vi"); } catch {} });
  await dangNhap(ctx);
  const page = await ctx.newPage();
  const thuMo = async () => {
    await page.click('[data-testid="nut-thu-trai"]'); await page.waitForTimeout(2000);
    await page.click('[data-testid="nut-thu-trai"]'); await page.waitForTimeout(4000);
  };
  await page.goto(`${BASE}/twin?thu=nhanTatCa`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="man-twin-van-hanh"] canvas', { timeout: 90_000 });
  await page.waitForTimeout(8000);
  await thuMo();
  kq.moc.A_conThuocTinh = await DO_(page);
  await page.screenshot({ path: `${OUT}/A-con-thuoc-tinh.png` });
  await page.evaluate(() => document.querySelector('[data-testid="nut-thu-trai"]')?.removeAttribute("data-che-nhan"));
  await thuMo();
  kq.moc.B_daGo = await DO_(page);
  await page.screenshot({ path: `${OUT}/B-da-go.png` });
  await page.evaluate(() => document.querySelector('[data-testid="nut-thu-trai"]')?.setAttribute("data-che-nhan", "1"));
  await thuMo();
  kq.moc.C_hoanNguyen = await DO_(page);
  await page.screenshot({ path: `${OUT}/C-hoan-nguyen.png` });
  await ctx.close();
} finally { await browser.close(); }
async function DO_(page) { return page.evaluate(DO); }
const d = (m) => (kq.moc[m].hong ? `HỎNG(${kq.moc[m].hong})` : `${kq.moc[m].che.length}/${kq.moc[m].tong}px² (nhãn ${kq.moc[m].soNhan}, data-che-nhan=${kq.moc[m].cheNhan})`);
console.log(`A(còn)=${d("A_conThuocTinh")} · B(GỠ)=${d("B_daGo")} · C(gắn lại)=${d("C_hoanNguyen")}`);
console.log(`   B che: ${JSON.stringify(kq.moc.B_daGo.che)}`);
writeFileSync(`${OUT}/kq.json`, JSON.stringify(kq, null, 2));
