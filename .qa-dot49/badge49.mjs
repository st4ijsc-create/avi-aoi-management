// ĐỢT 49 · mục D — đo badge bị GIẤU + chip "còn N cảnh báo ẩn" (bbox trong canvas — G122).
//   node .qa-dot49/badge49.mjs  (BASE=http://localhost:3049, OUT=.qa-dot49/badge-<tag>)
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
const BASE = process.env.BASE || "http://localhost:3049";
const OUT = process.env.OUT || ".qa-dot49/badge-va"; mkdirSync(OUT, { recursive: true });
const TK = { username: "e2e_tai_loE", password: "E2eTaiLoE!2026" };
async function trpcGet(ctx, proc) { const r = await ctx.request.get(`${BASE}/api/trpc/${proc}`); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return j?.result?.data?.json ?? j?.result?.data ?? null; }
async function dangNhap(ctx) { const f = `.qa-dot49/state-${TK.username}.json`; if (existsSync(f)) { await ctx.addCookies(JSON.parse(readFileSync(f, "utf8"))); if ((await trpcGet(ctx, "auth.me"))?.username === TK.username) return; await ctx.clearCookies(); } const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: TK }); if (r.status() !== 200) throw new Error("login fail"); writeFileSync(f, JSON.stringify(await ctx.cookies())); }
const MAN = [["/twin", "man-twin-van-hanh"], ["/twin/line/2", "man-twin-line"]];
const DO = (manTid) => {
  const canvas = document.querySelector(`[data-testid="${manTid}"] canvas`); const cv = canvas.getBoundingClientRect();
  const b = window.__demBadge ?? null;
  const chipEl = document.querySelector('[data-testid="chip-canh-bao-bi-an"]');
  const cum = document.querySelector('[data-testid="cum-chip-nhan"]');
  const che = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2; const tren = document.elementFromPoint(x, y); return { trenCung: tren === el || el.contains(tren), theTren: tren?.getAttribute?.("data-testid") ?? tren?.tagName ?? null }; };
  const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), trongCanvas: r.left >= cv.left - 1 && r.top >= cv.top - 1 && r.right <= cv.right + 1 && r.bottom <= cv.bottom + 1 }; };
  return { badge: b ? { ve: b.ve, tong: b.tong, soAn: b.soAn, biChe: b.biChe, soBiChongLap: b.soBiChongLap, doiCho: b.doiCho, capConChong: b.capConChong } : null,
    soBadgeDom: document.querySelectorAll('[data-testid^="badge-canh-bao-"]').length,
    chip: chipEl ? { chu: chipEl.textContent?.trim(), so: chipEl.getAttribute("data-so"), rect: R(chipEl), ...che(chipEl) } : null,
    cumChip: R(cum), canvas: { x: Math.round(cv.left), y: Math.round(cv.top), w: Math.round(cv.width), h: Math.round(cv.height) } };
};
const browser = await chromium.launch(); const tong = {};
try { for (const vp of ["1600x900", "1280x720"]) { const [W, H] = vp.split("x").map(Number);
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.addInitScript(() => { try { localStorage.setItem("i18nextLng", "vi"); } catch {} }); await dangNhap(ctx);
  for (const [duong, man] of MAN) { const page = await ctx.newPage();
    await page.goto(`${BASE}${duong}?do=1`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(`[data-testid="${man}"] canvas`, { timeout: 90_000 });
    await page.waitForTimeout(4_000);
    const r = await page.evaluate(DO, man);
    tong[`${vp}${duong}`] = r;
    console.log(`[${vp} ${duong}] badge ve/tong/soAn/biChe/doiCho = ${r.badge?.ve}/${r.badge?.tong}/${r.badge?.soAn}/${r.badge?.biChe}/${r.badge?.doiCho} · dom ${r.soBadgeDom} · chip ${r.chip ? `"${r.chip.chu}" so=${r.chip.so} bbox=${JSON.stringify(r.chip.rect)} trenCung=${r.chip.trenCung} (${r.chip.theTren})` : "KHONG CO"}`);
    await page.screenshot({ path: `${OUT}/badge-${man}-${vp}.png` });
    await page.close(); }
  await ctx.close(); } } finally { await browser.close(); }
writeFileSync(`${OUT}/tong.json`, JSON.stringify(tong, null, 2)); console.log("=== badge49 xong ===");
