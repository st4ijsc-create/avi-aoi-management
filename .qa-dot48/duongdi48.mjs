// ĐỢT 46 · D-6 — ĐƯỜNG ĐI THẬT CÓ ẢNH @1280 vi: /twin (chưa chọn) → hover máy → bấm Line (cây phân cấp › node-cay-line:2) → Line → bấm máy (o-tram-14) → Máy → Back.
//   node .qa-dot48/duongdi46.mjs [--base=http://localhost:3048] [--lang=vi]  ⇒ .qa-dot48/duongdi/<buoc>.png + duongdi.json (URL, ms, nhãn/badge/chip từng bước)
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? m.slice(k.length + 3) : d; };
const BASE = arg("base", "http://localhost:3048"); const LANG = arg("lang", "vi");
const OUT = ".qa-dot48/duongdi"; mkdirSync(OUT, { recursive: true });
const TK = { username: "e2e_tai_loE", password: "E2eTaiLoE!2026" };
async function trpcGet(ctx, proc) { const r = await ctx.request.get(`${BASE}/api/trpc/${proc}`); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { data: j?.result?.data?.json ?? j?.result?.data ?? null }; }
async function dangNhap(ctx) { const f = `.qa-dot48/state-${TK.username}.json`; const ai = async () => (await trpcGet(ctx, "auth.me")).data?.username ?? null; if (existsSync(f)) { await ctx.addCookies(JSON.parse(readFileSync(f, "utf8"))); if ((await ai()) === TK.username) return; await ctx.clearCookies(); } const res = await ctx.request.post(`${BASE}/api/auth/login`, { data: TK }); if (res.status() !== 200 || (await ai()) !== TK.username) throw new Error("dang nhap that bai"); writeFileSync(f, JSON.stringify(await ctx.cookies())); }
const trang = (page) => page.evaluate(() => ({ url: location.pathname + location.search, man: [...document.querySelectorAll('[data-testid^="man-twin"]')].map((e) => e.getAttribute("data-testid")), canvas: document.querySelectorAll("canvas").length, nhan: [...document.querySelectorAll('[data-testid="nhan-may-twin3d"]')].map((e) => e.textContent?.trim()), badge: document.querySelectorAll('[data-testid^="badge-canh-bao-"]').length, chip: document.querySelector('[data-testid="chip-nhan-bi-an"]')?.textContent?.trim() ?? null, tieuDe: document.querySelector('[data-testid="ten-line"], [data-testid="ten-may"]')?.textContent?.trim() ?? null, ketNoi: document.querySelector('[data-testid="trang-thai-ket-noi"]')?.textContent?.trim() ?? null, panelPhaiW: Math.round(document.querySelector('[data-testid="panel-phai"]')?.getBoundingClientRect().width ?? -1), goiY: document.querySelector('[data-testid="goi-y-chon-may"]')?.textContent?.trim() ?? null }));
const browser = await chromium.launch();
const ds = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript((l) => { try { localStorage.setItem("i18nextLng", l); localStorage.removeItem("twin3d.nhan.macDinh"); } catch {} }, LANG);
  await dangNhap(ctx); const page = await ctx.newPage();
  const buoc = async (ten, ms) => { await page.screenshot({ path: `${OUT}/${ten}.png` }); const t = await trang(page); ds.push({ buoc: ten, ms, ...t }); console.log(`   ${ten}: ${t.url} · màn ${t.man} · canvas ${t.canvas} · nhãn ${t.nhan.length} · badge ${t.badge} · chip "${t.chip}" · ${ms ?? ""} ms`); };
  let t0 = Date.now();
  await page.goto(`${BASE}/twin`, { waitUntil: "domcontentloaded" }); await page.waitForSelector('[data-testid="man-twin-van-hanh"] canvas', { timeout: 90_000 }); const msCanvas = Date.now() - t0; await page.waitForTimeout(7000);
  await buoc("1-twin-chua-chon", msCanvas);
  // hover: rê chuột vào một máy giữa cảnh (đi dọc một đường ngang tới khi số nhãn tăng)
  const cv = await page.evaluate(() => { const b = document.querySelector('[data-testid="man-twin-van-hanh"] canvas').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
  const truoc = (await trang(page)).nhan.length; let hoverTai = null;
  for (let i = 0; i < 24 && !hoverTai; i++) { const x = cv.x + cv.w * (0.3 + 0.4 * ((i * 7) % 24) / 24), y = cv.y + cv.h * (0.45 + 0.3 * ((i * 5) % 12) / 12); await page.mouse.move(x, y); await page.waitForTimeout(350); const n = (await trang(page)).nhan.length; if (n > truoc) hoverTai = { x: Math.round(x), y: Math.round(y), nhan: n }; }
  await page.waitForTimeout(500); await buoc("2-twin-hover-may", null); ds[ds.length - 1].hoverTai = hoverTai; console.log(`      hover tại ${JSON.stringify(hoverTai)} (nhãn trước ${truoc})`);
  await page.mouse.move(5, 5);
  // bấm Line: tab Cây phân cấp → node line 2
  if ((await page.locator('[data-testid="mo-cay-phan-cap"]').count()) > 0) { await page.getByTestId("mo-cay-phan-cap").click(); await page.waitForTimeout(800); }
  if ((await page.locator('[data-testid="node-cay-line:2"]').count()) === 0) { const ws = page.locator('[data-testid^="node-cay-workshop:"] button').first(); if ((await ws.count()) > 0) { await ws.click(); await page.waitForTimeout(500); } }
  await page.screenshot({ path: `${OUT}/3a-twin-cay-phan-cap.png` });
  t0 = Date.now(); const coNode = (await page.locator('[data-testid="node-cay-line:2"]').count()) > 0;
  if (coNode) await page.getByTestId("node-cay-line:2").click();
  await page.waitForFunction(() => location.pathname.startsWith("/twin/line/"), null, { timeout: 30_000 }).catch(() => {}); const msLine = Date.now() - t0;
  await page.waitForSelector('[data-testid="man-twin-line"] canvas', { timeout: 90_000 }).catch(() => {}); await page.waitForTimeout(6000);
  await buoc("3-line-2", msLine); ds[ds.length - 1].coNode = coNode;
  // bấm máy: ô trạm 14 trên dải
  t0 = Date.now(); const coOTram = (await page.locator('[data-testid="o-tram-14"]').count()) > 0;
  if (coOTram) await page.getByTestId("o-tram-14").click();
  await page.waitForFunction(() => location.pathname.startsWith("/twin/may/"), null, { timeout: 30_000 }).catch(() => {}); const msMay = Date.now() - t0;
  await page.waitForSelector('[data-testid="khoi-canh-may"] canvas', { timeout: 90_000 }).catch(() => {}); await page.waitForSelector('[data-testid="cockpit-2d"] [role="tablist"]', { timeout: 60_000 }).catch(() => {}); await page.waitForTimeout(5000);
  await buoc("4-may-14", msMay); ds[ds.length - 1].coOTram = coOTram;
  // Back
  t0 = Date.now(); await page.goBack({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => location.pathname.startsWith("/twin/line/"), null, { timeout: 30_000 }).catch(() => {}); const msBack = Date.now() - t0;
  await page.waitForSelector('[data-testid="man-twin-line"] canvas', { timeout: 90_000 }).catch(() => {}); await page.waitForTimeout(5000);
  await buoc("5-back-line-2", msBack);
  t0 = Date.now(); await page.goBack({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => location.pathname === "/twin", null, { timeout: 30_000 }).catch(() => {}); const msBack2 = Date.now() - t0;
  await page.waitForSelector('[data-testid="man-twin-van-hanh"] canvas', { timeout: 90_000 }).catch(() => {}); await page.waitForTimeout(6000);
  await buoc("6-back-twin", msBack2);
  await ctx.close();
} finally { await browser.close(); }
writeFileSync(`${OUT}/duongdi.json`, JSON.stringify(ds, null, 2));
console.log(`=== duongdi46: ${ds.length} bước → ${OUT}/ ===`);
