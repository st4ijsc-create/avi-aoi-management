// ★ F1c — F1b lộ ra: CÙNG URL `/twin?nm=38&toa=54&tang=88`, `qatd_admin` visible p50 1.259 ms còn `qatd_kythuat` 2.876 ms.
//   Nghi vấn: chênh 1,6 s KHÔNG do cỡ dữ liệu (cùng cảnh 68 máy) mà do TÀI KHOẢN hoặc do thời điểm.
//   Phép đo: XEN KẼ hai tài khoản trên CÙNG URL, CÙNG vp, tuần tự, N lượt ⇒ loại trừ "trôi theo thời gian".
//   Kèm mốc mạng của từng lời gọi trpc (cái nào chặn màn) + mốc "man có trong DOM nhưng chưa visible".
import { chromium } from "@playwright/test";
import { arg, BASE, layCookie, ghi, p as pct } from "./lib-F.mjs";

const LUOT = Number(arg("luot", "4"));
const URL = arg("url", "/twin?nm=38&toa=54&tang=88");
const TIDS = arg("tid", "man-twin-van-hanh");
const TKS = arg("tk", "qatd_kythuat,qatd_admin,qatd_giamdoc").split(",");

const browser = await chromium.launch();
const kq = { ca: "F1c", base: BASE, url: URL, luc: new Date().toISOString(), soWorker: 1, luot: [] };
try {
  const ck = {};
  for (const t of TKS) ck[t] = await layCookie(browser, t);
  for (let i = 1; i <= LUOT; i += 1) for (const tk of TKS) {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    await ctx.addCookies(ck[tk]);
    const page = await ctx.newPage();
    const mang = [];
    page.on("response", (r) => { const u = r.url().replace(BASE, ""); if (u.startsWith("/api/")) mang.push({ u: u.slice(0, 110), st: r.status() }); });
    const t0 = Date.now();
    const r = { tk, luot: i };
    await page.goto(`${BASE}${URL}`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch((e) => { r.gotoLoi = String(e.message).slice(0, 90); });
    r.msGoto = Date.now() - t0;
    const pAtt = page.waitForSelector(`[data-testid="${TIDS}"]`, { state: "attached", timeout: 60000 }).then(() => Date.now() - t0).catch(() => null);
    const pVis = page.waitForSelector(`[data-testid="${TIDS}"]`, { state: "visible", timeout: 60000 }).then(() => Date.now() - t0).catch(() => null);
    r.msAttached = await pAtt; r.msVisible = await pVis;
    r.msKhungDau = await page.waitForFunction(() => (window.__thongKeVe?.calls ?? 0) > 0, null, { timeout: 90000 }).then(() => Date.now() - t0).catch(() => null);
    await page.waitForTimeout(5000);
    Object.assign(r, await page.evaluate(() => {
      const res = performance.getEntriesByType("resource").filter((e) => e.name.includes("/api/trpc/")).map((e) => ({ n: decodeURIComponent(e.name.split("/api/trpc/")[1] ?? "").split("?")[0].slice(0, 90), t0: Math.round(e.startTime), t1: Math.round(e.responseEnd), ms: Math.round(e.duration) })).sort((a, b) => b.ms - a.ms).slice(0, 8);
      const n = performance.getEntriesByType("navigation")[0];
      return { dcl: n ? Math.round(n.domContentLoadedEventEnd) : null, trpcChamNhat: res, khoi: window.__demNhan?.soHopKhoi ?? null, soCanvas: window.__soCanvas ?? null, demMay: document.querySelector('[data-testid="dem-may"]')?.textContent?.trim() ?? null };
    }));
    r.soApi = mang.length;
    kq.luot.push(r);
    console.log(`  [lượt ${i}] ${tk.padEnd(15)} attached ${r.msAttached} · VISIBLE ${r.msVisible} · khung đầu ${r.msKhungDau} · dcl ${r.dcl} · khối ${r.khoi} · demMay ${r.demMay} · api ${r.soApi}`);
    console.log(`        trpc chậm nhất: ${(r.trpcChamNhat || []).slice(0, 4).map((x) => `${x.n}=${x.ms}ms(t0 ${x.t0})`).join(" · ")}`);
    await ctx.close();
  }
  kq.tomTat = {};
  for (const tk of TKS) {
    const ds = kq.luot.filter((x) => x.tk === tk);
    kq.tomTat[tk] = { visible: { so: ds.map((x) => x.msVisible), p50: pct(ds.map((x) => x.msVisible), 50), p90: pct(ds.map((x) => x.msVisible), 90), max: Math.max(...ds.map((x) => x.msVisible ?? 0)) }, khungDau: { so: ds.map((x) => x.msKhungDau), p50: pct(ds.map((x) => x.msKhungDau), 50), p90: pct(ds.map((x) => x.msKhungDau), 90) }, khoi: ds.map((x) => x.khoi) };
  }
  console.log("\n=== F1c: cùng URL, ba tài khoản XEN KẼ ===");
  for (const [k, v] of Object.entries(kq.tomTat)) console.log(`  ${k.padEnd(15)} visible p50 ${v.visible.p50} p90 ${v.visible.p90} max ${v.visible.max} [${v.visible.so.join(", ")}] · khung đầu p50 ${v.khungDau.p50} · khối ${JSON.stringify(v.khoi)}`);
} finally { ghi("F1c", kq); await browser.close(); }
