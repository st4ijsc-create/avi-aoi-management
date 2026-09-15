// ★ F7b — F7 đo 4 khung trong 40 s đứng yên (ngưỡng ≤2). Hai giả thuyết KHÁC NHAU về hậu quả:
//   (a) frameloop KHÔNG dừng (vẽ liên tục, tốn pin) — SAI thật;
//   (b) cảnh vẽ lại vì DỮ LIỆU SỐNG đổi (broadcaster `twin:trangThai` ~10 s + nhịp làm tươi heartbeat 45 s của tôi)
//       — đây là hành vi ĐÚNG: màu máy đổi thì phải vẽ lại.
//   Phân biệt bằng MỐC THỜI GIAN từng khung trong 90 s + đếm khung/giây: (a) cho ~60 khung/s liên tục,
//   (b) cho chùm rời rạc cách nhau ~10 s. Kèm đếm bản tin websocket/truy vấn để nối khung với nguyên nhân.
import { chromium } from "@playwright/test";
import { arg, BASE, layCookie, ghi, ANH, TANG_DONG } from "./lib-F.mjs";

const GIAY = Number(arg("giay", "90"));
const browser = await chromium.launch({ args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"] });
const kq = { ca: "F7b", base: BASE, luc: new Date().toISOString(), soWorker: 1, giay: GIAY };
try {
  const ck = await layCookie(browser, "qatd_kythuat");
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await ctx.addCookies(ck);
  // đếm bản tin websocket TRƯỚC khi trang chạy
  await ctx.addInitScript(() => {
    window.__ws = [];
    const W = window.WebSocket;
    window.WebSocket = function (...a) { const s = new W(...a); s.addEventListener("message", (e) => { let k = null; try { k = JSON.parse(e.data)?.type ?? JSON.parse(e.data)?.event ?? null; } catch (x) { k = String(e.data).slice(0, 24); } window.__ws.push({ t: Math.round(performance.now()), k }); }); return s; };
    window.WebSocket.prototype = W.prototype; Object.assign(window.WebSocket, W);
  });
  const page = await ctx.newPage();
  const apiSau = [];
  await page.goto(`${BASE}/twin?nm=${TANG_DONG.nm}&toa=${TANG_DONG.toa}&tang=${TANG_DONG.tang}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('[data-testid="man-twin-van-hanh"]', { state: "visible", timeout: 60000 });
  await page.waitForFunction(() => (window.__thongKeVe?.calls ?? 0) > 0, null, { timeout: 90000 });
  await page.waitForTimeout(8000);
  const tBatDau = Date.now();
  page.on("response", (r) => { const u = r.url().replace(BASE, ""); if (u.startsWith("/api/")) apiSau.push({ t: Date.now() - tBatDau, u: decodeURIComponent(u.split("?")[0]).slice(0, 70) }); });
  const kqTrang = await page.evaluate((ms) => new Promise((res) => {
    const moc = []; let a = window.__thongKeVe; const wsBd = (window.__ws || []).length;
    const id = setInterval(() => { const b = window.__thongKeVe; if (b !== a) { a = b; moc.push(Math.round(performance.now())); } }, 4);
    setTimeout(() => { clearInterval(id); res({ moc, wsThem: (window.__ws || []).slice(wsBd).map((w) => ({ t: w.t, k: w.k })), soWs: (window.__ws || []).length - wsBd }); }, ms);
  }), GIAY * 1000);
  const moc = kqTrang.moc;
  const d = []; for (let i = 1; i < moc.length; i += 1) d.push(moc[i] - moc[i - 1]);
  const cuaSo1s = {}; for (const m of moc) { const s = Math.floor(m / 1000); cuaSo1s[s] = (cuaSo1s[s] || 0) + 1; }
  kq.ketQua = {
    soKhungTong: moc.length, giay: GIAY,
    khungTrenGiayToiDa: Math.max(0, ...Object.values(cuaSo1s)),
    soGiayCoKhung: Object.keys(cuaSo1s).length,
    moc, khoangGiuaKhung: d,
    soWs: kqTrang.soWs, wsThem: kqTrang.wsThem.slice(0, 40),
    apiSau: apiSau.slice(0, 40), soApiSau: apiSau.length,
    idle40sDauTien: moc.filter((m) => m <= 40000).length,
  };
  Object.assign(kq.ketQua, await page.evaluate(() => ({ soCanvas: window.__soCanvas, calls: window.__thongKeVe?.calls, khoi: window.__demNhan?.soHopKhoi })));
  console.log(`  ĐỨNG YÊN ${GIAY} s: TỔNG ${moc.length} khung · 40 s đầu ${kq.ketQua.idle40sDauTien} khung · tối đa ${kq.ketQua.khungTrenGiayToiDa} khung/giây · ${kq.ketQua.soGiayCoKhung}/${GIAY} giây CÓ khung`);
  console.log(`  mốc khung (ms): ${JSON.stringify(moc)}`);
  console.log(`  khoảng giữa hai khung (ms): ${JSON.stringify(d)}`);
  console.log(`  bản tin websocket trong cửa sổ: ${kq.ketQua.soWs} ${JSON.stringify(kqTrang.wsThem.slice(0, 12))}`);
  console.log(`  lời gọi /api trong cửa sổ: ${apiSau.length} ${JSON.stringify(apiSau.slice(0, 10))}`);
  await page.screenshot({ path: `${ANH}/F-F7b-sau-idle-${GIAY}s.png` }).catch(() => {});
  await ctx.close();
} finally { ghi("F7b", kq); await browser.close(); }
