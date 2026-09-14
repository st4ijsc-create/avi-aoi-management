// ĐỢT 43 · F1/F4 — bốn màn deep-link trên CONTEXT MỚI, mạng theo --mang (mang.mjs: chan|treo|thuong), ghi THÔ từng màn.
//   node .qa-dot44/f1-fonts.mjs --vp=1600x900 --tag=f1-sau --base=http://localhost:3044 [--mang=chan] [--lang=vi]
// Đo: ms tới [data-testid=man-*] và tới canvas; document.fonts.status; fonts.check('12px Geist' / '12px "Geist Mono"');
//     getComputedStyle(body).fontFamily; bbox + font tính toán của tiêu đề (h1 đầu) + breadcrumb (F4); request ra ngoài
//     (page.on('request') + performance resource); ảnh từng màn. ĐẠT (F1): tới màn ≤ 2 500 ms · fonts loaded · check Geist true · 0 request ngoài.
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { boc, CHE_DO_MANG } from "./mang.mjs";

const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? m.slice(k.length + 3) : d; };
const [VW, VH] = arg("vp", "1600x900").split("x").map(Number);
const VP = `${VW}x${VH}`;
const TAG = arg("tag", "f1");
const BASE = arg("base", "http://localhost:3044");
const LANG = arg("lang", "vi");
// ĐỢT 50 (G129) — ĐƯỜNG RA + TỆP PHIÊN lấy từ ENV, KHÔNG ghi đè thư mục của đợt trước.
const OUT = process.env.QA_OUT ?? `.qa-dot51/${TAG}`;
mkdirSync(OUT, { recursive: true });
const TK = { username: "e2e_tai_loE", password: "E2eTaiLoE!2026" };
const STATE = process.env.QA_STATE ?? ".qa-dot51/state-e2e_tai_loE.json";
const MAN = [["/twin", "man-twin-van-hanh"], ["/twin/line/2", "man-twin-line"], ["/twin/may/14", "man-twin-may"], ["/twin-studio", "man-twin-studio"]];

async function trpcGet(ctx, proc) { const r = await ctx.request.get(`${BASE}/api/trpc/${proc}`); let j = null; try { j = JSON.parse(await r.text()); } catch {} return { status: r.status(), data: j?.result?.data?.json ?? j?.result?.data ?? null }; }
async function dangNhap(ctx) {
  const ai = async () => { const r = await trpcGet(ctx, "auth.me"); return { status: r.status, ten: r.data?.username ?? null }; };
  if (existsSync(STATE)) { await ctx.addCookies(JSON.parse(readFileSync(STATE, "utf8"))); const me = await ai(); if (me.ten === TK.username) return { cach: "cache", ...me }; await ctx.clearCookies(); }
  const res = await ctx.request.post(`${BASE}/api/auth/login`, { data: TK });
  const me = await ai();
  if (res.status() !== 200 || me.ten !== TK.username) throw new Error(`dang nhap that bai: login=${res.status()} me=${me.ten}`);
  writeFileSync(STATE, JSON.stringify(await ctx.cookies()));
  return { cach: "moi", ...me };
}

const doFont = (page) => page.evaluate(async () => {
  const bb = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const ff = (el) => (el ? getComputedStyle(el).fontFamily : null);
  await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 5000))]);
  const faces = [...document.fonts].map((f) => ({ family: f.family, weight: f.weight, style: f.style, status: f.status }));
  const h1 = document.querySelector("h1");
  const bc = document.querySelector('[data-testid="breadcrumb-twin"]');
  const mono = document.querySelector("code, pre, .font-mono, [class*='font-mono']");
  const tieuDeEl = [...document.querySelectorAll("h1, h2, h3")].find((e) => e.getBoundingClientRect().width > 0 && (e.textContent || "").trim());
  const thanhTrenEl = document.querySelector('[data-testid^="thanh-tren-"]') || document.querySelector('[data-testid="khoi-tong-quan"]') || document.querySelector('[role="tablist"]');
  const res = performance.getEntriesByType("resource").map((e) => e.name);
  return {
    fontsStatus: document.fonts.status, soFace: faces.length, faces,
    faceGeistLoaded: faces.filter((f) => f.family.replace(/"/g, "") === "Geist" && f.status === "loaded").length,
    faceMonoLoaded: faces.filter((f) => f.family.replace(/"/g, "") === "Geist Mono" && f.status === "loaded").length,
    checkGeist: document.fonts.check("12px Geist"), checkGeist600: document.fonts.check("600 12px Geist"), checkMono: document.fonts.check('12px "Geist Mono"'),
    bodyFont: ff(document.body), h1: h1 ? { text: (h1.textContent || "").trim().slice(0, 60), bbox: bb(h1), font: ff(h1), size: getComputedStyle(h1).fontSize, weight: getComputedStyle(h1).fontWeight } : null,
    breadcrumb: bc ? { text: (bc.innerText || "").replace(/\n+/g, " › ").slice(0, 80), bbox: bb(bc), font: ff(bc) } : null,
    mono: mono ? { tag: mono.tagName, font: ff(mono) } : null,
    tieuDe: tieuDeEl ? { tag: tieuDeEl.tagName, text: (tieuDeEl.textContent || "").trim().slice(0, 60), bbox: bb(tieuDeEl), font: ff(tieuDeEl), size: getComputedStyle(tieuDeEl).fontSize, weight: getComputedStyle(tieuDeEl).fontWeight } : null,
    thanhTren: thanhTrenEl ? { tid: thanhTrenEl.getAttribute("data-testid") || thanhTrenEl.getAttribute("role"), text: (thanhTrenEl.innerText || "").replace(/\s+/g, " ").slice(0, 60), bbox: bb(thanhTrenEl), font: ff(thanhTrenEl) } : null,
    soCanvas: document.querySelectorAll("canvas").length, __soCanvas: window.__soCanvas ?? null,
    tongResource: res.length, resourceNgoai: res.filter((n) => /^https?:\/\//i.test(n) && !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/i.test(n)).slice(0, 20),
    woff2: res.filter((n) => /\.woff2(\?|$)/i.test(n)).map((n) => n.replace(/^https?:\/\/[^/]+/, "")),
    lang: document.documentElement.lang,
  };
});

// F4: neo bố cục đo SAU KHI ỔN ĐỊNH 6 s (breadcrumb/thanh trên nạp dữ liệu sau) — tách khỏi mốc F1 (đo ngay khi tới màn).
const doNeo = (page) => page.evaluate(() => {
  const bb = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const ff = (el) => (el ? getComputedStyle(el).fontFamily : null);
  const lay = (el, ten) => (el ? { ten, tag: el.tagName, tid: el.getAttribute("data-testid"), text: (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 70), bbox: bb(el), font: ff(el), size: getComputedStyle(el).fontSize, weight: getComputedStyle(el).fontWeight } : null);
  const tieuDe = [...document.querySelectorAll("h1, h2, h3")].find((e) => e.getBoundingClientRect().width > 0 && (e.textContent || "").trim());
  const thanhTren = document.querySelector('[data-testid^="thanh-tren-"]') || document.querySelector('[data-testid="khoi-tong-quan"]') || document.querySelector('[role="tablist"]');
  const bc = document.querySelector('[data-testid="breadcrumb-twin"]');
  const nhan = document.querySelector('[data-testid="nhan-may-twin3d"]');
  const nut = [...document.querySelectorAll("button")].find((b) => b.getBoundingClientRect().width > 0 && (b.textContent || "").trim().length > 2);
  return { breadcrumb: lay(bc, "breadcrumb"), tieuDe: lay(tieuDe, "tieuDe"), thanhTren: lay(thanhTren, "thanhTren"), nhan: lay(nhan, "nhan"), nut: lay(nut, "nut"), soNhan: document.querySelectorAll('[data-testid="nhan-may-twin3d"]').length, bodyFont: ff(document.body) };
});

const browser = boc(await chromium.launch());
const kq = { mang: CHE_DO_MANG, vp: VP, base: BASE, lang: LANG, luc: new Date().toISOString(), man: {} };
try {
  const ctx0 = await browser.newContext({ viewport: { width: VW, height: VH } });
  const dn = await dangNhap(ctx0);
  const cookies = await ctx0.cookies();
  await ctx0.close();
  console.log(`▶ F1 mang=${CHE_DO_MANG} vp=${VP} tag=${TAG} dang nhap=${dn.cach} ${dn.ten}`);
  for (const [duong, tid] of MAN) {
    const c = await browser.newContext({ viewport: { width: VW, height: VH }, locale: LANG === "vi" ? "vi-VN" : LANG });
    await c.addCookies(cookies);
    const ngoai = [];
    const r = { duong, tid };
    let p;
    const t0 = Date.now();
    try {
      p = await c.newPage();
      p.on("request", (q) => { const u = q.url(); if (/^https?:\/\//i.test(u) && !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/i.test(u)) ngoai.push({ url: u.slice(0, 160), loai: q.resourceType() }); });
      if (LANG !== "vi") await p.addInitScript((l) => { try { localStorage.setItem("i18nextLng", l); } catch {} }, LANG);
      try { await p.goto(`${BASE}${duong}`, { waitUntil: "domcontentloaded", timeout: 30_000 }); r.msGoto = Date.now() - t0; }
      catch (e) { r.gotoLoi = String(e.message).split("\n")[0].slice(0, 160); r.msGoto = Date.now() - t0; }
      try { await p.waitForSelector(`[data-testid="${tid}"]`, { timeout: 30_000 }); r.msToiMan = Date.now() - t0; } catch { r.msToiMan = null; }
      try { await p.waitForSelector(`[data-testid="${tid}"] canvas`, { timeout: 30_000 }); r.msToiCanvas = Date.now() - t0; } catch { r.msToiCanvas = null; }
      try { r.msTruocDoFont = Date.now() - t0; Object.assign(r, await doFont(p)); r.msSauDoFont = Date.now() - t0; } catch (e) { r.doFontLoi = String(e.message).split("\n")[0].slice(0, 160); }
      r.url = p.url().replace(BASE, "");
      try { await p.waitForTimeout(6000); r.neo = await doNeo(p); r.msNeo = Date.now() - t0; } catch (e) { r.neoLoi = String(e.message).split("\n")[0].slice(0, 120); }
      await p.screenshot({ path: `${OUT}/f1-${CHE_DO_MANG}-${VP}${duong.replace(/[\/:]/g, "_")}.png`, timeout: 20_000 }).catch((e) => { r.anhLoi = String(e.message).split("\n")[0].slice(0, 120); });
    } catch (e) { r.loi = String(e.message).split("\n")[0].slice(0, 200); }
    r.requestNgoai = ngoai.length; r.requestNgoaiDs = ngoai.slice(0, 20);
    // MSA (chủ dự án): fonts.check() trả true cả khi soFace 0 (không @font-face ⇒ không gì phải tải) ⇒ chỉ báo MÙ; chỉ số chính = faceGeistLoaded ≥ 1 (mặt chữ Geist THẬT đã tải), check chỉ phụ.
    r.dat = r.msToiMan != null && r.msToiMan <= 2500 && r.fontsStatus === "loaded" && (r.faceGeistLoaded ?? 0) >= 1 && r.checkGeist === true && ngoai.length === 0;
    kq.man[duong] = r;
    console.log(`   ${r.dat ? "✓" : "✗"} ${duong.padEnd(14)} goto ${r.msGoto ?? "?"} ms${r.gotoLoi ? " (" + r.gotoLoi + ")" : ""} · màn ${r.msToiMan ?? "KHÔNG"} ms · canvas ${r.msToiCanvas ?? "KHÔNG"} ms · fonts ${r.fontsStatus} (Geist ${r.faceGeistLoaded}/${r.soFace} loaded) · check Geist ${r.checkGeist} Mono ${r.checkMono} · body "${(r.bodyFont || "").slice(0, 24)}" · ngoài ${ngoai.length}${ngoai.length ? " " + JSON.stringify(ngoai.slice(0, 3).map((n) => n.url)) : ""}`);
    await c.close().catch(() => {});
  }
  kq.datTatCa = Object.values(kq.man).every((m) => m.dat);
  kq.tomTat = Object.fromEntries(Object.entries(kq.man).map(([k, m]) => [k, { msToiMan: m.msToiMan, msToiCanvas: m.msToiCanvas, fonts: m.fontsStatus, checkGeist: m.checkGeist, ngoai: m.requestNgoai, dat: m.dat }]));
  console.log(`   ⇒ F1 ${CHE_DO_MANG} ${VP}: ${kq.datTatCa ? "ĐẠT 4/4" : "TRƯỢT " + Object.values(kq.man).filter((m) => m.dat).length + "/4"}`);
} finally {
  writeFileSync(`${OUT}/f1-${CHE_DO_MANG}-${VP}.json`, JSON.stringify(kq, null, 2));
  await browser.close();
}
