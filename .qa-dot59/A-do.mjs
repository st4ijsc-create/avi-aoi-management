// ĐỢT 59 — MỤC A: NHÃN 3D NẰM DƯỚI TAY NẮM SAU KHI **THU RỒI MỞ LẠI** PANEL TRÁI.
//
// Phép đo là KẾT CỤC NGƯỜI DÙNG: diện tích giao (px²) giữa hộp nhãn `nhan-may-twin3d` và hộp
// tay nắm `nut-thu-trai` / `nut-thu-phai`, ĐỌC TỪ DOM SỐNG (getBoundingClientRect), tại 5 mốc:
//   t0  — vừa nạp xong (trạng thái mặc định, panel MỞ)
//   thu — sau khi bấm tay nắm trái (panel THU), chờ ổn định
//   +2s / +5s / +17s sau khi bấm MỞ LẠI  — "ở lì" là một đại lượng, phải đo bằng thời gian.
//   hich— sau một chu kỳ đổi cỡ cửa sổ (1600→1500→1600): nếu số về 0 ở đây thì bệnh là
//         "không tính lại", không phải "thuật toán sai".
//
// ★ G146 FAIL-CLOSED: không đọc được (0 nhãn, hoặc không thấy tay nắm) ⇒ ghi `hong: "..."`,
//   KHÔNG ghi 0 px². "0 vì không có gì để đo" phải khác "đo được 0".
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? m.slice(k.length + 3) : d; };
const BASE = arg("base", "http://localhost:3059");
const TAG = arg("tag", "truoc");
const OUT = `.qa-dot59/A-${TAG}`;
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
  const ra = { soNhan: nhan.length, tong: 0, che: [], tayNam: {}, hong: null };
  if (nhan.length === 0) { ra.hong = "0 nhan doc duoc"; return ra; }
  let thayTayNam = 0;
  for (const tid of ["nut-thu-trai", "nut-thu-phai"]) {
    const el = document.querySelector(`[data-testid="${tid}"]`);
    if (!el) { ra.tayNam[tid] = null; continue; }
    if (!hien(el)) { ra.tayNam[tid] = "an"; continue; }
    thayTayNam++;
    const r = el.getBoundingClientRect();
    ra.tayNam[tid] = { left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), neo: el.getAttribute("data-neo") };
    for (const n of nhan) {
      const g = giao(r, n.getBoundingClientRect());
      if (g > 0.5) { ra.che.push({ tayNam: tid, chu: n.textContent.trim().slice(0, 24), giao: Math.round(g) }); ra.tong += Math.round(g); }
    }
  }
  if (thayTayNam === 0) ra.hong = "khong thay tay nam nao";
  const p = document.querySelector('[data-testid="panel-trai"]');
  ra.panelTrai = p ? { w: Math.round(p.getBoundingClientRect().width), thu: p.getAttribute("data-thu") } : null;
  return ra;
};
const kq = { base: BASE, tag: TAG, luc: new Date().toISOString(), ca: [] };
const browser = await chromium.launch();
try {
  for (const vp of [{ width: 1600, height: 900 }, { width: 1280, height: 720 }]) {
    for (const lang of ["vi", "en"]) {
      const ten = `${vp.width}x${vp.height}-${lang}`;
      const ctx = await browser.newContext({ viewport: vp });
      await ctx.addInitScript((l) => { try { localStorage.setItem("i18nextLng", l); } catch {} }, lang);
      await dangNhap(ctx);
      const page = await ctx.newPage();
      const ca = { ten, vp, lang, moc: {} };
      try {
        await page.goto(`${BASE}/twin?thu=nhanTatCa`, { waitUntil: "domcontentloaded" });
        await page.waitForSelector('[data-testid="man-twin-van-hanh"] canvas', { timeout: 90_000 });
        await page.waitForTimeout(8000);
        ca.moc.t0 = await page.evaluate(DO);
        await page.screenshot({ path: `${OUT}/${ten}-0-mac-dinh.png` });
        // THU
        await page.click('[data-testid="nut-thu-trai"]');
        await page.waitForTimeout(2500);
        ca.moc.thu = await page.evaluate(DO);
        await page.screenshot({ path: `${OUT}/${ten}-1-thu.png` });
        // MỞ LẠI
        await page.click('[data-testid="nut-thu-trai"]');
        await page.waitForTimeout(2000);
        ca.moc.mo2s = await page.evaluate(DO);
        await page.screenshot({ path: `${OUT}/${ten}-2-mo-2s.png` });
        await page.waitForTimeout(3000);
        ca.moc.mo5s = await page.evaluate(DO);
        await page.waitForTimeout(12000);
        ca.moc.mo17s = await page.evaluate(DO);
        await page.screenshot({ path: `${OUT}/${ten}-3-mo-17s.png` });
        // HÍCH: một chu kỳ đổi cỡ cửa sổ
        await page.setViewportSize({ width: vp.width - 100, height: vp.height - 40 });
        await page.waitForTimeout(2500);
        await page.setViewportSize(vp);
        await page.waitForTimeout(3500);
        ca.moc.hich = await page.evaluate(DO);
        await page.screenshot({ path: `${OUT}/${ten}-4-da-hich.png` });
      } catch (e) { ca.loi = String(e).slice(0, 300); }
      kq.ca.push(ca);
      await ctx.close();
      const d = (m) => (ca.moc[m]?.hong ? `HỎNG(${ca.moc[m].hong})` : ca.moc[m] ? `${ca.moc[m].che.length}/${ca.moc[m].tong}px²` : "—");
      console.log(`${ten}: t0=${d("t0")} thu=${d("thu")} mở2s=${d("mo2s")} mở5s=${d("mo5s")} mở17s=${d("mo17s")} hích=${d("hich")}${ca.loi ? " LỖI:" + ca.loi : ""}`);
    }
  }
} finally { await browser.close(); }
writeFileSync(`${OUT}/kq.json`, JSON.stringify(kq, null, 2));
const soHong = kq.ca.reduce((s, c) => s + Object.values(c.moc).filter((m) => m.hong).length, 0) + kq.ca.filter((c) => c.loi).length;
console.log(`=== A-do ${TAG} xong → ${OUT}/kq.json · ca=${kq.ca.length} · mốc HỎNG/lỗi=${soHong} ===`);
