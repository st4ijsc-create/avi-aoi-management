// ĐỢT 38 · P1 (tái dùng D-6 Đợt 37) — HIỆU NĂNG 4 màn, MỘT MÌNH: thời gian tới canvas đầu tiên · long tasks (PerformanceObserver longtask, buffered) khi mở màn ·
//   draw calls (`__thongKeVe.calls`) · idle ≤ 2 khung/4 s (×2 cửa sổ) · nhịp làm mới (mốc từng khung trong 40 s, chỉ --lan=1).
//   node .qa-dot44/hieu-nang.mjs --lan=1|2 [--vp=1600x900] [--base=…]  → .qa-dot44/hieu-nang/lan<N>.json ; node .qa-dot44/hieu-nang.mjs --tomtat=1 → trung vị
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? m.slice(k.length + 3) : d; };
const LAN = Number(arg("lan", "1"));
const [VW, VH] = arg("vp", "1600x900").split("x").map(Number);
const BASE = arg("base", "http://localhost:3044");
const OUT = (process.env.QA_OUT ?? ".qa-dot52/hieu-nang");
mkdirSync(OUT, { recursive: true });
const TK = { username: "e2e_tai_loE", password: "E2eTaiLoE!2026" };

if (arg("tomtat", "0") === "1") {
  const ds = [1, 2].map((n) => (existsSync(`${OUT}/lan${n}-${arg("vp","1600x900")}.json`) ? JSON.parse(readFileSync(`${OUT}/lan${n}-${arg("vp","1600x900")}.json`, "utf8")) : null)).filter(Boolean);
  const med = (xs) => { const a = xs.filter((x) => x != null).sort((p, q) => p - q); return a.length ? a[Math.floor((a.length - 1) / 2)] : null; };
  for (const man of Object.keys(ds[0].man)) {
    const g = (k) => med(ds.map((d) => d.man[man]?.[k]));
    const r = ds.map((d) => d.man[man]);
    console.log(`${man.padEnd(14)} canvas ${g("msToiCanvas")} ms (${r.map((x) => x?.msToiCanvas).join("/")}) · DCL ${g("domContentLoaded")} ms · longTasks ${g("ltSo")} cái/${g("ltTongMs")} ms/max ${g("ltMaxMs")} ms (${r.map((x) => `${x?.ltSo}/${x?.ltTongMs}/${x?.ltMaxMs}`).join(" | ")}) · draw ${g("drawCalls")} · tri ${g("triangles")} · idle ${r.map((x) => `${x?.idle1}/${x?.idle2}`).join(" | ")} khung/4s · canvasDom=${r.map((x) => x?.canvasDom).join("/")} __soCanvas=${r.map((x) => x?.__soCanvas).join("/")}${r[0]?.moc40s ? ` · 40 s: ${r[0].moc40s.tong} khung, cửa sổ 4 s ${JSON.stringify(r[0].moc40s.cuaSo)}, mốc ${JSON.stringify(r[0].moc40s.moc.slice(0, 16))}` : ""}`);
  }
  process.exit(0);
}

async function trpcGet(ctx, proc) { const r = await ctx.request.get(`${BASE}/api/trpc/${proc}`); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { status: r.status(), data: j?.result?.data?.json ?? j?.result?.data ?? null }; }
async function dangNhap(ctx) {
  const f = (process.env.QA_STATE ?? ".qa-dot52/state-e2e_tai_loE.json");
  const ai = async () => { const r = await trpcGet(ctx, "auth.me"); return { ten: r.data?.username ?? null }; };
  if (existsSync(f)) { await ctx.addCookies(JSON.parse(readFileSync(f, "utf8"))); if ((await ai()).ten === TK.username) return "cache"; await ctx.clearCookies(); }
  const res = await ctx.request.post(`${BASE}/api/auth/login`, { data: TK }); if (res.status() !== 200 || (await ai()).ten !== TK.username) throw new Error("dang nhap that bai");
  writeFileSync(f, JSON.stringify(await ctx.cookies())); return "moi";
}
const demKhungIdle = (page, ms = 4000) => page.evaluate((t) => new Promise((r) => { let n = 0; let a = window.__thongKeVe; const id = setInterval(() => { const b = window.__thongKeVe; if (b !== a) { n += 1; a = b; } }, 25); setTimeout(() => { clearInterval(id); r(n); }, t); }), ms);
const MAN = {
  twin: { duong: "/twin", canvas: '[data-testid="man-twin-van-hanh"] canvas' },
  line: { duong: "/twin/line/2", canvas: '[data-testid="man-twin-line"] canvas' },
  may: { duong: "/twin/may/14", canvas: '[data-testid="khoi-canh-may"] canvas' },
  studio: { duong: "/twin-studio", canvas: '[data-testid="man-twin-studio"] canvas', tab: "tab-thiet-ke" },
};
const browser = await chromium.launch();
const kq = { lan: LAN, vp: `${VW}x${VH}`, luc: new Date().toISOString(), man: {} };
try {
  for (const [ten, m] of Object.entries(MAN)) {
    const ctx = await browser.newContext({ viewport: { width: VW, height: VH } });
    const cach = await dangNhap(ctx);
    const page = await ctx.newPage();
    // yêu cầu mạng THẤT BẠI (console "Failed to fetch" không nói thủ tục nào) + lỗi console
    const reqFail = []; const conErr = [];
    page.on("requestfailed", (r) => reqFail.push({ url: r.url().replace(BASE, "").slice(0, 160), loi: r.failure()?.errorText ?? null, t: Date.now() - t0 }));
    page.on("console", (m) => { if (m.type() === "error") conErr.push(m.text().slice(0, 140)); });
    page.on("response", (r) => { if (r.status() >= 400) reqFail.push({ url: r.url().replace(BASE, "").slice(0, 160), status: r.status(), t: Date.now() - t0 }); });
    // long tasks: quan sát buffered từ đầu tài liệu
    await page.addInitScript(() => { window.__lt = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push({ t: Math.round(e.startTime), d: Math.round(e.duration) }); }).observe({ type: "longtask", buffered: true }); } catch {} });
    var t0 = Date.now();
    await page.goto(`${BASE}${m.duong}`, { waitUntil: "domcontentloaded" });
    if (m.tab) { await page.waitForSelector('[data-testid="man-twin-studio"]', { timeout: 60_000 }).catch(() => {}); if ((await page.locator(`[data-testid="${m.tab}"]`).count()) > 0) await page.getByTestId(m.tab).click(); }
    const coCanvas = await page.waitForSelector(m.canvas, { timeout: 90_000 }).then(() => true).catch(() => false);
    const msToiCanvas = Date.now() - t0;
    // chờ khung đầu tiên được vẽ (__thongKeVe xuất hiện) ⇒ "canvas có nội dung"
    const msKhungDau = await page.waitForFunction(() => !!window.__thongKeVe, null, { timeout: 60_000 }).then(() => Date.now() - t0).catch(() => null);
    // /twin: chỉ báo kết nối theo thời gian (broadcaster `twin:trangThai` phát theo interval 10 s, KHÔNG phát ngay khi subscribe)
    let ketNoi = null;
    if (ten === "twin") { ketNoi = []; for (let i = 0; i < 16; i += 1) { ketNoi.push({ t: Date.now() - t0, chu: await page.evaluate(() => document.querySelector('[data-testid="trang-thai-ket-noi"]')?.textContent?.trim() ?? null) }); await page.waitForTimeout(1000); } }
    else await page.waitForTimeout(8000);
    const nav = await page.evaluate(() => { const n = performance.getEntriesByType("navigation")[0]; return n ? { domContentLoaded: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd) } : null; });
    const lt = await page.evaluate(() => window.__lt ?? []);
    const tk = await page.evaluate(() => ({ __soCanvas: window.__soCanvas ?? null, canvasDom: document.querySelectorAll("canvas").length, drawCalls: window.__thongKeVe?.calls ?? null, triangles: window.__thongKeVe?.triangles ?? null, matContext: window.__thongKeVe?.matContext ?? null }));
    const idle1 = await demKhungIdle(page, 4000); const idle2 = await demKhungIdle(page, 4000);
    let moc40s = null;
    if (LAN === 1) { const moc = await page.evaluate((t) => new Promise((r) => { const s = performance.now(); const ds = []; let a = window.__thongKeVe; const id = setInterval(() => { const b = window.__thongKeVe; if (b !== a) { ds.push(Math.round(performance.now() - s)); a = b; } }, 25); setTimeout(() => { clearInterval(id); r(ds); }, t); }), 40_000); const cuaSo = []; for (let i = 0; i < 10; i += 1) cuaSo.push(moc.filter((x) => x >= i * 4000 && x < (i + 1) * 4000).length); moc40s = { tong: moc.length, cuaSo, moc }; }
    kq.man[ten] = { duong: m.duong, cach, coCanvas, msToiCanvas, msKhungDau, ketNoi, reqFail, conErr: conErr.slice(0, 10), ...nav, ltSo: lt.length, ltTongMs: lt.reduce((s, x) => s + x.d, 0), ltMaxMs: lt.reduce((s, x) => Math.max(s, x.d), 0), lt: lt.slice(0, 30), ...tk, idle1, idle2, moc40s };
    console.log(`   [lan ${LAN}] ${ten.padEnd(7)} canvas ${msToiCanvas} ms · khung đầu ${msKhungDau} ms · DCL ${nav?.domContentLoaded} · longTasks ${lt.length}/${kq.man[ten].ltTongMs} ms/max ${kq.man[ten].ltMaxMs} · draw ${tk.drawCalls} · tri ${tk.triangles} · idle ${idle1}/${idle2} · canvasDom ${tk.canvasDom} __soCanvas ${tk.__soCanvas}${moc40s ? ` · 40 s ${moc40s.tong} khung ${JSON.stringify(moc40s.cuaSo)}` : ""}`);
    await ctx.close();
  }
} finally { await browser.close(); }
writeFileSync(`${OUT}/lan${LAN}-${VW}x${VH}.json`, JSON.stringify(kq, null, 2));
