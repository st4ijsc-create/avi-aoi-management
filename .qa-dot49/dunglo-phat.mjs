// ĐỢT 49 · mục B (đo có ĐIỀU KIỆN XẢY RA) — bật PHÁT LẠI x20 để trạng thái/màu máy THẬT SỰ đổi,
// rồi đếm số lần dựng lại BatchedMesh. Phép đo idle (dunglo49.mjs) cho 0 ở CẢ HAI bản vì giá trị
// `may` không đổi trong 60 s trên DB dev — 0 = 0 không phân biệt được gì.
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
const BASE = process.env.BASE || "http://localhost:3049";
const OUT = process.env.OUT || ".qa-dot49/dunglo-phat-va"; mkdirSync(OUT, { recursive: true });
const GIAY = Number(process.env.GIAY || 45);
const TK = { username: "e2e_tai_loE", password: "E2eTaiLoE!2026" };
async function trpcGet(ctx, proc) { const r = await ctx.request.get(`${BASE}/api/trpc/${proc}`); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return j?.result?.data?.json ?? j?.result?.data ?? null; }
async function dangNhap(ctx) { const f = `.qa-dot49/state-${TK.username}.json`; if (existsSync(f)) { await ctx.addCookies(JSON.parse(readFileSync(f, "utf8"))); if ((await trpcGet(ctx, "auth.me"))?.username === TK.username) return; await ctx.clearCookies(); } const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: TK }); if (r.status() !== 200) throw new Error("login fail"); writeFileSync(f, JSON.stringify(await ctx.cookies())); }
const browser = await chromium.launch(); const out = {};
try { const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem("i18nextLng", "vi"); } catch {} }); await dangNhap(ctx);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/twin?do=1`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="man-twin-van-hanh"] canvas', { timeout: 90_000 });
  await page.waitForTimeout(6_000);
  // x20 + phát
  const bam = async (sel) => { const l = page.locator(sel); if ((await l.count()) > 0) { await l.first().click({ timeout: 5_000 }).catch(() => {}); return true; } return false; };
  out.nut = { x20: await bam('[data-testid="nut-toc-do-20"]'), phat: false };
  // Nút phát: thanh tua ở đáy canvas — thử vài bộ chọn, ghi lại cái nào trúng.
  for (const sel of ['[data-testid="tua-phat"]', '[data-testid="nut-phat"]', 'button:has(svg.lucide-play)', 'button[aria-label*="hát"]', 'button[title*="hát"]']) {
    if (await bam(sel)) { out.nut.phat = sel; break; }
  }
  out.nutCoTren = await page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.getAttribute("data-testid") || b.getAttribute("aria-label") || b.textContent?.trim().slice(0, 18)).filter(Boolean).slice(-24));
  await page.waitForTimeout(1_500);
  const doc = () => ({ dungLo: window.__demTuongTac?.soLanDungLo ?? null, khung: window.__thongKeVe?.calls ?? null });
  const t0 = await page.evaluate(doc);
  const mau0 = await page.evaluate(() => (window.__demTuongTac?.dsMay?.() ?? []).length);
  await page.waitForTimeout(GIAY * 1000);
  const t1 = await page.evaluate(doc);
  out.phatLai = { giay: GIAY, truoc: t0, sau: t1, dungLo: (t1.dungLo ?? 0) - (t0.dungLo ?? 0), soMay: mau0, khungTang: (t1.khung ?? 0) - (t0.khung ?? 0) };
  console.log(`[phát lại x20, ${GIAY}s] dựng lô ${t0.dungLo} → ${t1.dungLo} (=${out.phatLai.dungLo}) · khung vẽ +${out.phatLai.khungTang} · máy ${mau0}`);
  await page.screenshot({ path: `${OUT}/sau-phat.png` });
  await page.close(); await ctx.close(); } finally { await browser.close(); }
writeFileSync(`${OUT}/tong.json`, JSON.stringify(out, null, 2)); console.log("=== dunglo-phat xong ===");
