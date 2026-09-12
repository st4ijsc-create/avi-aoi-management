// ĐỢT 52 — ĐO CHỒNG NHÃN × BADGE trên MÀN MÁY (trạng thái mà Đợt 46–50 chưa đo: máy CÓ cảnh báo đang mở).
//   Mắt đọc được "badge cảnh báo đè lên nhãn tên máy" ở ảnh k8-K8b-1600x900-may2-18-sau.png.
//   Mắt KHÔNG phải phép đo (bài học Đợt 30) ⇒ đo bbox thật từ DOM, cho MỌI máy, 2 vp, vi+en.
//   node .qa-dot52/nhanbadge52.mjs --base=http://localhost:3052 [--may=18,22,14,246] [--vp=1600x900,1280x720]
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? m.slice(k.length + 3) : d; };
const BASE = arg("base", "http://localhost:3052");
const VPS = arg("vp", "1600x900,1280x720").split(",");
const MAYS = arg("may", "18,22,14,246,13,20,21,7").split(",").map(Number);
const LANGS = arg("lang", "vi,en").split(",");
const OUT = ".qa-dot52/nhanbadge"; mkdirSync(OUT, { recursive: true });
const TK = { username: "e2e_tai_loE", password: "E2eTaiLoE!2026" };
async function trpcGet(ctx, proc) { const r = await ctx.request.get(`${BASE}/api/trpc/${proc}`); let j = null; try { j = JSON.parse(await r.text()); } catch {} return j?.result?.data?.json ?? j?.result?.data ?? null; }
async function dangNhap(ctx) {
  const f = ".qa-dot52/state-e2e_tai_loE.json";
  const ai = async () => (await trpcGet(ctx, "auth.me"))?.username ?? null;
  if (existsSync(f)) { await ctx.addCookies(JSON.parse(readFileSync(f, "utf8"))); if ((await ai()) === TK.username) return; await ctx.clearCookies(); }
  const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: TK }); if (r.status() !== 200 || (await ai()) !== TK.username) throw new Error("dang nhap that bai");
  writeFileSync(f, JSON.stringify(await ctx.cookies()));
}
// Đo TRONG TRANG: mọi nhãn máy + mọi badge cảnh báo đang hiện, bbox thật, giao nhau, và ai nằm TRÊN.
const DO = () => {
  const R = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), phai: Math.round(b.right), day: Math.round(b.bottom) }; };
  const z = (el) => { let e = el; while (e && e !== document.body) { const cs = getComputedStyle(e); if (cs.position !== "static" && cs.zIndex !== "auto") return Number(cs.zIndex); e = e.parentElement; } return 0; };
  const hien = (el) => { if (!el || el.hidden) return false; const b = el.getBoundingClientRect(); if (b.width <= 0 || b.height <= 0) return false; const cs = getComputedStyle(el); return cs.visibility !== "hidden" && Number(cs.opacity) > 0.05; };
  const giao = (a, b) => Math.max(0, Math.min(a.phai, b.phai) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.day, b.day) - Math.max(a.y, b.y));
  const canvas = document.querySelector('[data-testid="man-twin-may"] canvas') ?? document.querySelector("canvas");
  const cvB = canvas ? R(canvas) : null;
  const nhan = [...document.querySelectorAll('[data-testid="nhan-may-twin3d"]')].filter(hien).map((el) => ({ id: Number(el.getAttribute("data-machine-id")), chu: el.textContent?.trim().slice(0, 40), rect: R(el), z: z(el) }));
  const badge = [...document.querySelectorAll('[data-testid^="badge-canh-bao-"]')].filter(hien).map((el) => ({ t: el.getAttribute("data-testid"), chu: el.textContent?.trim().slice(0, 40), rect: R(el), z: z(el) }));
  const cap = [];
  for (const n of nhan) for (const b of badge) { const d = giao(n.rect, b.rect); if (d > 0) cap.push({ nhan: n.chu, nhanId: n.id, badge: b.t, badgeChu: b.chu, px2: d, tiLeNhan: +(d / (n.rect.w * n.rect.h)).toFixed(3), badgeTren: b.z >= n.z }); }
  const ngoai = (r) => !cvB ? null : r.x < cvB.x - 1 || r.y < cvB.y - 1 || r.phai > cvB.phai + 1 || r.day > cvB.day + 1;
  return {
    url: location.href, canvas: cvB,
    soNhan: nhan.length, soBadge: badge.length,
    nhan, badge,
    capNhanBadge: cap, soCapNhanBadge: cap.length, tongPx2: cap.reduce((a, c) => a + c.px2, 0),
    nhanNgoaiCanvas: nhan.filter((n) => ngoai(n.rect)).length,
    badgeNgoaiCanvas: badge.filter((b) => ngoai(b.rect)).length,
    demBadge: window.__demBadge ? { ve: window.__demBadge.ve, tong: window.__demBadge.tong, soAn: window.__demBadge.soAn, biChe: window.__demBadge.biChe, doiCho: window.__demBadge.doiCho } : null,
  };
};
const browser = await chromium.launch();
const tong = { luc: new Date().toISOString(), base: BASE, ca: [] };
try {
  for (const lang of LANGS) for (const vp of VPS) {
    const [W, H] = vp.split("x").map(Number);
    const ctx = await browser.newContext({ viewport: { width: W, height: H } });
    await ctx.addInitScript((l) => { try { localStorage.setItem("i18nextLng", l); } catch {} }, lang);
    await dangNhap(ctx);
    const page = await ctx.newPage();
    for (const id of MAYS) {
      const r = { lang, vp, may: id };
      try {
        await page.goto(`${BASE}/twin/may/${id}?do=1`, { waitUntil: "domcontentloaded" });
        await page.waitForSelector('[data-testid="man-twin-may"] canvas', { timeout: 60_000 });
        await page.waitForFunction(() => document.querySelectorAll('[data-testid="may-dang-tai"]').length === 0 && (window.__thongKeVe?.calls ?? 0) > 0, null, { timeout: 60_000 }).catch(() => {});
        await page.waitForTimeout(2_500);
        Object.assign(r, await page.evaluate(DO));
        if (r.soCapNhanBadge > 0) await page.screenshot({ path: `${OUT}/chong-may${id}-${vp}-${lang}.png` });
      } catch (e) { r.loi = String(e).slice(0, 200); }
      tong.ca.push(r);
      console.log(`   [${lang} ${vp}] /twin/may/${id}: nhãn ${r.soNhan} badge ${r.soBadge} · CẶP nhãn∩badge ${r.soCapNhanBadge} (${r.tongPx2 ?? 0} px²)${r.soCapNhanBadge ? " ⇒ " + r.capNhanBadge.map((c) => `"${c.nhan}"∩${c.badge} ${c.px2}px² (${Math.round(c.tiLeNhan * 100)}% nhãn, badge ${c.badgeTren ? "TRÊN" : "dưới"})`).join(" ; ") : ""} · ngoài canvas nhãn ${r.nhanNgoaiCanvas} badge ${r.badgeNgoaiCanvas}${r.loi ? " · LỖI " + r.loi : ""}`);
    }
    await page.close(); await ctx.close();
  }
} finally { await browser.close(); }
writeFileSync(`${OUT}/tong.json`, JSON.stringify(tong, null, 2));
const xau = tong.ca.filter((c) => (c.soCapNhanBadge ?? 0) > 0);
console.log(`=== nhãn×badge màn MÁY: ${xau.length}/${tong.ca.length} ca CÓ chồng · tổng cặp ${tong.ca.reduce((a, c) => a + (c.soCapNhanBadge ?? 0), 0)} ===`);
