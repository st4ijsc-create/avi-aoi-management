// ĐỢT 54 — ĐO CẶP nhãn ∩ badge + chẩn đoán TỪ CƠ CHẾ (`__demNhan`/`__demBadge`) trên 4 MÀN.
//   Bản chép của `.qa-dot52/nhanbadge52.mjs` (G130: đường ra qua ENV/argv, không ghim .qa-dot52).
//   node .qa-dot54/nhanbadge53.mjs --base=http://localhost:3054 --out=.qa-dot54/probe/truoc [--man=...]
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? m.slice(k.length + 3) : d; };
const BASE = arg("base", "http://localhost:3054");
const VPS = arg("vp", "1600x900,1280x720").split(",");
const MANS = arg("man", "/twin,/twin/line/2,/twin/may/18,/twin/may/14").split(",");
const LANGS = arg("lang", "vi,en").split(",");
const OUT = arg("out", ".qa-dot54/probe/truoc"); mkdirSync(OUT, { recursive: true });
const ANH = arg("anh", "1") === "1";
const TK = { username: "e2e_tai_loE", password: "E2eTaiLoE!2026" };
const STATE = arg("state", ".qa-dot54/state-e2e_tai_loE.json");
async function trpcGet(ctx, proc) { const r = await ctx.request.get(`${BASE}/api/trpc/${proc}`); let j = null; try { j = JSON.parse(await r.text()); } catch {} return j?.result?.data?.json ?? j?.result?.data ?? null; }
async function dangNhap(ctx) {
  const ai = async () => (await trpcGet(ctx, "auth.me"))?.username ?? null;
  if (existsSync(STATE)) { await ctx.addCookies(JSON.parse(readFileSync(STATE, "utf8"))); if ((await ai()) === TK.username) return; await ctx.clearCookies(); }
  const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: TK }); if (r.status() !== 200 || (await ai()) !== TK.username) throw new Error("dang nhap that bai");
  writeFileSync(STATE, JSON.stringify(await ctx.cookies()));
}
const DO = () => {
  const R = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), phai: Math.round(b.right), day: Math.round(b.bottom) }; };
  const z = (el) => { let e = el; while (e && e !== document.body) { const cs = getComputedStyle(e); if (cs.position !== "static" && cs.zIndex !== "auto") return Number(cs.zIndex); e = e.parentElement; } return 0; };
  const hien = (el) => { if (!el || el.hidden) return false; const b = el.getBoundingClientRect(); if (b.width <= 0 || b.height <= 0) return false; const cs = getComputedStyle(el); return cs.visibility !== "hidden" && Number(cs.opacity) > 0.05; };
  const giao = (a, b) => Math.max(0, Math.min(a.phai, b.phai) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.day, b.day) - Math.max(a.y, b.y));
  const canvas = document.querySelector("canvas");
  const cvB = canvas ? R(canvas) : null;
  const nhan = [...document.querySelectorAll('[data-testid="nhan-may-twin3d"]')].filter(hien).map((el) => ({ id: Number(el.getAttribute("data-machine-id")), chu: el.textContent?.trim().slice(0, 40), rect: R(el), z: z(el) }));
  const badge = [...document.querySelectorAll('[data-testid^="badge-canh-bao-"]')].filter(hien).map((el) => ({ t: el.getAttribute("data-testid"), doiCho: el.getAttribute("data-doi-cho"), chu: el.textContent?.trim().slice(0, 40), rect: R(el), z: z(el) }));
  const cap = [];
  for (const n of nhan) for (const b of badge) { const d = giao(n.rect, b.rect); if (d > 0) cap.push({ nhan: n.chu, nhanId: n.id, badge: b.t, px2: d, tiLeNhan: +(d / (n.rect.w * n.rect.h)).toFixed(3), badgeTren: b.z >= n.z }); }
  const ngoai = (r) => !cvB ? null : r.x < cvB.x - 1 || r.y < cvB.y - 1 || r.phai > cvB.phai + 1 || r.day > cvB.day + 1;
  return {
    url: location.href, canvas: cvB, soNhan: nhan.length, soBadge: badge.length, nhan, badge,
    capNhanBadge: cap, soCapNhanBadge: cap.length, tongPx2: cap.reduce((a, c) => a + c.px2, 0),
    nhanNgoaiCanvas: nhan.filter((n) => ngoai(n.rect)).length,
    badgeNgoaiCanvas: badge.filter((b) => ngoai(b.rect)).length,
    demBadge: window.__demBadge ? { ...window.__demBadge } : null,
    demNhan: window.__demNhan ? { ...window.__demNhan } : null,
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
    for (const man of MANS) {
      const r = { lang, vp, man };
      try {
        await page.goto(`${BASE}${man}?do=1`, { waitUntil: "domcontentloaded" });
        await page.waitForSelector("canvas", { timeout: 60_000 });
        await page.waitForFunction(() => document.querySelectorAll('[data-testid="may-dang-tai"]').length === 0 && (window.__thongKeVe?.calls ?? 0) > 0, null, { timeout: 60_000 }).catch(() => {});
        await page.waitForTimeout(2_500);
        Object.assign(r, await page.evaluate(DO));
        if (ANH) await page.screenshot({ path: `${OUT}/${man.replace(/\//g, "_")}-${vp}-${lang}.png` });
      } catch (e) { r.loi = String(e).slice(0, 200); }
      tong.ca.push(r);
      const d = r.demNhan ?? {};
      console.log(`   [${lang} ${vp}] ${man}: nhãn ${r.soNhan} badge ${r.soBadge} · CẶP ${r.soCapNhanBadge} (${r.tongPx2 ?? 0} px²)${r.soCapNhanBadge ? " ⇒ " + r.capNhanBadge.map((c) => `"${c.nhan}"∩${c.badge} ${c.px2}px² (${Math.round(c.tiLeNhan * 100)}%, badge ${c.badgeTren ? "TRÊN" : "dưới"})`).join(" ; ") : ""} · __demNhan{ve:${d.ve},biChe:${d.biChe},vuotMep:${d.vuotMep},soVungCam:${d.soVungCam},soHopBadge:${d.soHopBadge},soLopPhuDom:${d.soLopPhuDom},capConChong:${d.capConChong}} · __demBadge{ve:${r.demBadge?.ve},doiCho:${r.demBadge?.doiCho},soVungCam:${r.demBadge?.soVungCam}}${r.loi ? " · LỖI " + r.loi : ""}`);
    }
    await page.close(); await ctx.close();
  }
} finally { await browser.close(); }
writeFileSync(`${OUT}/tong.json`, JSON.stringify(tong, null, 2));
const xau = tong.ca.filter((c) => (c.soCapNhanBadge ?? 0) > 0);
console.log(`=== nhãn×badge: ${xau.length}/${tong.ca.length} ca CÓ chồng · tổng cặp ${tong.ca.reduce((a, c) => a + (c.soCapNhanBadge ?? 0), 0)} · tổng px² ${tong.ca.reduce((a, c) => a + (c.tongPx2 ?? 0), 0)} ===`);
