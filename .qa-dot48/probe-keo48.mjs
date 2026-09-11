// ĐỢT 47 — PROBE KÉO: vì sao kéo 200 px trên /twin lại điều hướng (T1d đỏ) trong khi Line không?
//   Móc: history.pushState ghi STACK + thời điểm; document click (capture) ghi toạ độ; pointerdown/up trên canvas ghi toạ độ.
//   Đồng thời đo lại badge/nhãn sau khi ÉP một khung (dispatch resize) để tách "thuật toán sai" khỏi "không có khung".
//   node .qa-dot48/probe-keo47.mjs [--base=http://localhost:3048] [--vp=1600x900]
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? m.slice(k.length + 3) : d; };
const BASE = arg("base", "http://localhost:3048"); const VP = arg("vp", "1600x900");
const OUT = ".qa-dot48/probe"; mkdirSync(OUT, { recursive: true });
const TK = { username: "e2e_tai_loE", password: "E2eTaiLoE!2026" };
async function trpcGet(ctx, proc) { const r = await ctx.request.get(`${BASE}/api/trpc/${proc}`); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { data: j?.result?.data?.json ?? j?.result?.data ?? null }; }
async function dangNhap(ctx) { const f = `.qa-dot48/state-${TK.username}.json`; const ai = async () => (await trpcGet(ctx, "auth.me")).data?.username ?? null; if (existsSync(f)) { await ctx.addCookies(JSON.parse(readFileSync(f, "utf8"))); if ((await ai()) === TK.username) return; await ctx.clearCookies(); } const res = await ctx.request.post(`${BASE}/api/auth/login`, { data: TK }); if (res.status() !== 200 || (await ai()) !== TK.username) throw new Error("dang nhap that bai"); writeFileSync(f, JSON.stringify(await ctx.cookies())); }
const MOC = () => {
  window.__vet = { push: [], click: [], ptr: [] };
  const goc = history.pushState.bind(history);
  history.pushState = function (...a) { window.__vet.push.push({ t: performance.now(), url: String(a[2] ?? ""), stack: (new Error().stack || "").split("\n").slice(1, 9).map((s) => s.trim()).join(" <- ") }); return goc(...a); };
  document.addEventListener("click", (e) => window.__vet.click.push({ t: performance.now(), x: e.clientX, y: e.clientY, tag: e.target?.tagName, tid: e.target?.getAttribute?.("data-testid") }), true);
  document.addEventListener("pointerdown", (e) => window.__vet.ptr.push({ k: "down", t: performance.now(), x: e.clientX, y: e.clientY, tag: e.target?.tagName }), true);
  document.addEventListener("pointerup", (e) => window.__vet.ptr.push({ k: "up", t: performance.now(), x: e.clientX, y: e.clientY, tag: e.target?.tagName }), true);
};
const browser = await chromium.launch();
const kq = {};
try {
  const [VW, VH] = VP.split("x").map(Number);
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH } });
  await ctx.addInitScript(MOC);
  await ctx.addInitScript(() => { try { localStorage.setItem("i18nextLng", "vi"); localStorage.removeItem("twin3d.nhan.macDinh"); } catch {} });
  await dangNhap(ctx);
  for (const [duong, man] of [["/twin", "man-twin-van-hanh"], ["/twin/line/2", "man-twin-line"]]) {
    const page = await ctx.newPage();
    await page.goto(`${BASE}${duong}?do=1`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(`[data-testid="${man}"] canvas`, { timeout: 90_000 });
    await page.waitForFunction(() => (window.__demTuongTac?.dsMay?.() ?? []).some((m) => m.trongKhung), null, { timeout: 60_000 });
    await page.waitForTimeout(2500);
    // badge/nhãn TRƯỚC và SAU khi ép một khung
    const doBadge = () => page.evaluate((manTid) => { const cv = document.querySelector(`[data-testid="${manTid}"] canvas`).getBoundingClientRect(); const kpi = document.querySelector('[data-testid="bang-kpi-noi"]')?.getBoundingClientRect(); const R = (b) => ({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }); return { kpi: kpi ? R(kpi) : null, demBadge: window.__demBadge, demNhan: { ve: window.__demNhan?.ve, biChe: window.__demNhan?.biChe, soVungCam: window.__demNhan?.soVungCam }, badge: [...document.querySelectorAll('[data-testid^="badge-canh-bao-"]')].map((el) => ({ chu: el.textContent.trim().slice(0, 20), doi: el.getAttribute("data-doi-cho"), r: R(el.getBoundingClientRect()) })), nhan: document.querySelectorAll('[data-testid="nhan-may-twin3d"]').length, cv: R(cv) }; }, man);
    const truoc = await doBadge();
    await page.evaluate(() => window.dispatchEvent(new Event("resize")));
    await page.waitForTimeout(1200);
    const sauEp = await doBadge();
    console.log(`   [${duong}] KPI ${JSON.stringify(truoc.kpi)} · TRƯỚC ép khung: badge ${truoc.badge.map((b) => `${b.chu}${b.doi === "1" ? "(dời)" : ""}@${b.r.x},${b.r.y}`).join("|")} · demBadge ${JSON.stringify(truoc.demBadge)} · nhãn ${truoc.nhan} ${JSON.stringify(truoc.demNhan)}`);
    console.log(`   [${duong}] SAU ép khung: badge ${sauEp.badge.map((b) => `${b.chu}${b.doi === "1" ? "(dời)" : ""}@${b.r.x},${b.r.y}`).join("|")} · demBadge ${JSON.stringify(sauEp.demBadge)} · nhãn ${sauEp.nhan} ${JSON.stringify(sauEp.demNhan)}`);
    // KÉO 200 px từ tâm máy
    const may = await page.evaluate((manTid) => { const canvas = document.querySelector(`[data-testid="${manTid}"] canvas`); const cv = canvas.getBoundingClientRect(); for (const m of (window.__demTuongTac.dsMay() ?? []).filter((m) => m.trongKhung)) { const X = cv.left + m.x, Y = cv.top + m.y; if (document.elementFromPoint(X, Y) !== canvas) continue; const t = window.__demTuongTac.tamMay(m.machineId); const h = window.__demTuongTac.hitTai(t.ndcX, t.ndcY); if (h?.ten === "twin3d-lo-may") return { id: m.machineId, X, Y }; } return null; }, man);
    await page.evaluate(() => { window.__vet = { push: [], click: [], ptr: [] }; });
    const urlTruoc = page.url();
    await page.mouse.move(may.X, may.Y, { steps: 4 }); await page.mouse.down({ button: "left" });
    for (let i = 1; i <= 20; i++) { await page.mouse.move(may.X + i * 10, may.Y, { steps: 1 }); await page.waitForTimeout(16); }
    await page.mouse.up({ button: "left" }); await page.waitForTimeout(1200);
    const vet = await page.evaluate(() => window.__vet);
    const r = { may, urlTruoc: urlTruoc.replace(BASE, ""), urlSau: page.url().replace(BASE, ""), vet, truoc, sauEp };
    kq[duong] = r;
    console.log(`   [${duong}] kéo từ máy ${may.id} @${Math.round(may.X)},${Math.round(may.Y)} ⇒ URL ${r.urlSau} · ptr ${JSON.stringify(vet.ptr)} · click ${JSON.stringify(vet.click)} · push ${vet.push.length}`);
    for (const p of vet.push) console.log(`      pushState ${p.url} @${p.t.toFixed(0)} :: ${p.stack.slice(0, 600)}`);
    await page.close();
  }
  await ctx.close();
} finally { await browser.close(); }
writeFileSync(`${OUT}/keo47-${VP}.json`, JSON.stringify(kq, null, 2));
console.log("=== probe-keo47 xong ===");
