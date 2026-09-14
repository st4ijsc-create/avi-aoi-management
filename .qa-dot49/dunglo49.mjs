// ĐỢT 49 · mục B — ĐẾM SỐ LẦN DỰNG LẠI BatchedMesh trong 60 s LIVE (dữ liệu realtime đang chảy).
//   node .qa-dot49/dunglo49.mjs   (BASE, OUT, GIAY)
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
const BASE = process.env.BASE || "http://localhost:3049";
const OUT = process.env.OUT || ".qa-dot49/dunglo-va"; mkdirSync(OUT, { recursive: true });
const GIAY = Number(process.env.GIAY || 60);
const TK = { username: "e2e_tai_loE", password: "E2eTaiLoE!2026" };
async function trpcGet(ctx, proc) { const r = await ctx.request.get(`${BASE}/api/trpc/${proc}`); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return j?.result?.data?.json ?? j?.result?.data ?? null; }
async function dangNhap(ctx) { const f = `.qa-dot49/state-${TK.username}.json`; if (existsSync(f)) { await ctx.addCookies(JSON.parse(readFileSync(f, "utf8"))); if ((await trpcGet(ctx, "auth.me"))?.username === TK.username) return; await ctx.clearCookies(); } const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: TK }); if (r.status() !== 200) throw new Error("login fail"); writeFileSync(f, JSON.stringify(await ctx.cookies())); }
const DOC = () => ({ dungLo: window.__demTuongTac?.soLanDungLo ?? null, khung: window.__thongKeVe?.calls ?? null, nhanVe: window.__demNhan?.ve ?? null });
const browser = await chromium.launch(); const tong = {};
try { const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem("i18nextLng", "vi"); } catch {} }); await dangNhap(ctx);
  for (const [duong, man] of [["/twin", "man-twin-van-hanh"], ["/twin/line/2", "man-twin-line"]]) {
    const page = await ctx.newPage();
    // Đếm gói realtime tới trang — để biết "0 lần dựng" KHÔNG phải vì 0 dữ liệu (tiền đề của phép đo).
    let goiWs = 0;
    page.on("websocket", (ws) => ws.on("framereceived", () => { goiWs += 1; }));
    await page.goto(`${BASE}${duong}?do=1`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(`[data-testid="${man}"] canvas`, { timeout: 90_000 });
    await page.waitForTimeout(6_000);
    const t0 = await page.evaluate(DOC); const wsT0 = goiWs;
    await page.waitForTimeout(GIAY * 1000);
    const t1 = await page.evaluate(DOC);
    const r = { duong, giay: GIAY, truoc: t0, sau: t1, dungLoTrong60s: (t1.dungLo ?? 0) - (t0.dungLo ?? 0), goiWsTrong60s: goiWs - wsT0 };
    tong[duong] = r;
    console.log(`[${duong}] dựng lô: ${t0.dungLo} → ${t1.dungLo} (=${r.dungLoTrong60s} lần/${GIAY}s) · gói ws nhận trong khoảng: ${r.goiWsTrong60s} · khung vẽ ${t0.khung} → ${t1.khung}`);
    await page.close();
  }
  await ctx.close(); } finally { await browser.close(); }
writeFileSync(`${OUT}/tong.json`, JSON.stringify(tong, null, 2)); console.log("=== dunglo49 xong ===");
