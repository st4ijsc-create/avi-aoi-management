// ★ F1b — MSA + ABLATION CỠ DỮ LIỆU cho F1. Trả lời: 2,6 s là do 26× dữ liệu, hay là chi phí KHỞI ĐỘNG CLIENT cố định?
//   Bốn phép đo trên CÙNG thiết bị, CÙNG phiên, tuần tự:
//   ① `attached` vs `visible` (QA10 dùng waitForSelector mặc định = attached) — loại giả thuyết "đổi thước đo".
//   ② Cảnh 41 máy (SIM-FAC nm=1, ĐÚNG cỡ dữ liệu QA lần 10) vs cảnh 68 máy (QATD-A T2 tầng 1) — CÙNG tài khoản admin.
//   ③ Màn KHÔNG-3D (`/oee-dashboard`) — sàn của chi phí khởi động vỏ ứng dụng; nếu nó cũng ~2,5 s thì twin không phải thủ phạm.
//   ④ Lượt thứ hai TRONG CÙNG context (cache HTTP nóng) — tách chi phí tải bundle khỏi chi phí dựng cảnh.
//   Kèm mốc resource timing của bundle chính + vi.json.
import { chromium } from "@playwright/test";
import { arg, BASE, layCookie, ghi, p as pct } from "./lib-F.mjs";

const LUOT = Number(arg("luot", "3"));
const VP = arg("vp", "1600x900").split("x").map(Number);

const MOC = () => {
  const n = performance.getEntriesByType("navigation")[0];
  const res = performance.getEntriesByType("resource").map((e) => ({ n: e.name.replace(location.origin, ""), t0: Math.round(e.startTime), t1: Math.round(e.responseEnd), kb: Math.round((e.transferSize || e.encodedBodySize || 0) / 1024) }));
  const lon = res.filter((r) => r.kb >= 60).sort((a, b) => b.kb - a.kb).slice(0, 8);
  return {
    dcl: n ? Math.round(n.domContentLoadedEventEnd) : null, load: n ? Math.round(n.loadEventEnd) : null, ttfb: n ? Math.round(n.responseStart) : null,
    soRes: res.length, tongKb: res.reduce((a, r) => a + r.kb, 0), resLon: lon,
    viJson: res.find((r) => /vi.*\.json/i.test(r.n)) || null,
    jsChinh: res.filter((r) => /\.js(\?|$)/.test(r.n)).sort((a, b) => b.kb - a.kb).slice(0, 3),
    calls: window.__thongKeVe?.calls ?? null, khoi: window.__demNhan?.soHopKhoi ?? null, soCanvas: window.__soCanvas ?? null,
  };
};

async function moLuot(browser, ck, ca) {
  const ctx = await browser.newContext({ viewport: { width: VP[0], height: VP[1] } });
  await ctx.addCookies(ck);
  const page = await ctx.newPage();
  const r = { ten: ca.ten, duong: ca.duong, tid: ca.tid };
  const t0 = Date.now();
  await page.goto(`${BASE}${ca.duong}`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch((e) => { r.gotoLoi = String(e.message).slice(0, 100); });
  r.msGoto = Date.now() - t0;
  // hai thước SONG SONG trên cùng một lượt: attached (thước QA10) và visible (thước lô F)
  const pAtt = page.waitForSelector(`[data-testid="${ca.tid}"]`, { state: "attached", timeout: 60000 }).then(() => Date.now() - t0).catch(() => null);
  const pVis = page.waitForSelector(`[data-testid="${ca.tid}"]`, { state: "visible", timeout: 60000 }).then(() => Date.now() - t0).catch(() => null);
  r.msAttached = await pAtt; r.msVisible = await pVis;
  if (ca.canvas !== false) {
    r.msKhungDau = await page.waitForFunction(() => (window.__thongKeVe?.calls ?? 0) > 0, null, { timeout: 90000 }).then(() => Date.now() - t0).catch(() => null);
  }
  await page.waitForTimeout(6000);
  Object.assign(r, await page.evaluate(MOC));
  // ④ lượt thứ hai TRONG CÙNG context (cache nóng) — điều hướng trong-SPA bị loại trừ bằng reload thật
  const t1 = Date.now();
  await page.goto(`${BASE}${ca.duong}`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  r.nong = { msGoto: Date.now() - t1 };
  r.nong.msVisible = await page.waitForSelector(`[data-testid="${ca.tid}"]`, { state: "visible", timeout: 60000 }).then(() => Date.now() - t1).catch(() => null);
  if (ca.canvas !== false) r.nong.msKhungDau = await page.waitForFunction(() => (window.__thongKeVe?.calls ?? 0) > 0, null, { timeout: 60000 }).then(() => Date.now() - t1).catch(() => null);
  await ctx.close();
  return r;
}

const browser = await chromium.launch();
const kq = { ca: "F1b", base: BASE, luc: new Date().toISOString(), soWorker: 1, vp: `${VP[0]}x${VP[1]}`, luot: [] };
try {
  const ck = await layCookie(browser, "qatd_admin");
  kq.taiKhoan = "qatd_admin (thấy cả SIM-FAC 41 máy và QATD 1.108 máy — ablation cỡ dữ liệu trên CÙNG tài khoản)";
  const CA = [
    { ten: "twin-SIMFAC-41may", duong: "/twin?nm=1", tid: "man-twin-van-hanh" },
    { ten: "twin-QATD-68may", duong: "/twin?nm=38&toa=54&tang=88", tid: "man-twin-van-hanh" },
    { ten: "oee-dashboard-KHONG-3D", duong: "/oee-dashboard", tid: null, canvas: false },
  ];
  // /oee-dashboard: không biết testid ⇒ dùng mốc "h1 hiện" (đo sàn khởi động vỏ, không phải twin)
  CA[2].tid = "__H1__";
  for (let i = 1; i <= LUOT; i += 1) for (const c of CA) {
    let r;
    if (c.tid === "__H1__") {
      const ctx = await browser.newContext({ viewport: { width: VP[0], height: VP[1] } });
      await ctx.addCookies(ck); const page = await ctx.newPage();
      const t0 = Date.now();
      await page.goto(`${BASE}${c.duong}`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
      r = { ten: c.ten, duong: c.duong, tid: "h1", msGoto: Date.now() - t0 };
      r.msVisible = await page.waitForSelector("h1", { state: "visible", timeout: 60000 }).then(() => Date.now() - t0).catch(() => null);
      r.msAttached = r.msVisible;
      await page.waitForTimeout(4000);
      Object.assign(r, await page.evaluate(MOC));
      await ctx.close();
    } else r = await moLuot(browser, ck, c);
    r.luot = i;
    kq.luot.push(r);
    console.log(`  [lượt ${i}] ${r.ten.padEnd(24)} goto ${r.msGoto} · attached ${r.msAttached} · VISIBLE ${r.msVisible} · khung đầu ${r.msKhungDau ?? "—"} · dcl ${r.dcl} · res ${r.soRes}/${r.tongKb} KB · khối ${r.khoi} · NÓNG visible ${r.nong?.msVisible ?? "—"} khung ${r.nong?.msKhungDau ?? "—"}`);
  }
  kq.tomTat = {};
  for (const c of CA) {
    const ds = kq.luot.filter((x) => x.ten === c.ten);
    kq.tomTat[c.ten] = {
      msVisible: { so: ds.map((x) => x.msVisible), p50: pct(ds.map((x) => x.msVisible), 50), p90: pct(ds.map((x) => x.msVisible), 90), max: Math.max(...ds.map((x) => x.msVisible ?? 0)) },
      msAttached: { so: ds.map((x) => x.msAttached), p50: pct(ds.map((x) => x.msAttached), 50) },
      msKhungDau: { so: ds.map((x) => x.msKhungDau), p50: pct(ds.map((x) => x.msKhungDau), 50) },
      nongVisible: { so: ds.map((x) => x.nong?.msVisible ?? null), p50: pct(ds.map((x) => x.nong?.msVisible ?? null), 50) },
      khoi: ds.map((x) => x.khoi), tongKb: ds.map((x) => x.tongKb),
    };
  }
  console.log("\n=== F1b TÓM TẮT ===");
  for (const [k, v] of Object.entries(kq.tomTat)) console.log(`  ${k.padEnd(24)} visible p50 ${v.msVisible.p50} (p90 ${v.msVisible.p90} max ${v.msVisible.max}) · attached p50 ${v.msAttached.p50} · khung đầu p50 ${v.msKhungDau.p50} · NÓNG p50 ${v.nongVisible.p50} · khối ${JSON.stringify(v.khoi)} · KB ${JSON.stringify(v.tongKb)}`);
  const r0 = kq.luot.find((x) => x.resLon);
  if (r0) console.log(`  tài nguyên ≥60 KB (lượt đầu): ${JSON.stringify(r0.resLon)}`);
} finally { ghi("F1b", kq); await browser.close(); }
