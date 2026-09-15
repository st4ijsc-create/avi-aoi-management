// ★ F3b — SỬA THIẾT BỊ ĐO FPS. F3 đo được 31,5 FPS nhưng 113 khung / 40 lần di chuột = 2,8 khung mỗi sự kiện vào
//   ⇒ con số ấy bị CHẶN TRÊN bởi tốc độ tôi bơm sự kiện (CDP ~90 ms/bước), KHÔNG phải bởi bộ dựng hình.
//   Sửa: ghi MỐC THỜI GIAN từng khung (performance.now() khi `__thongKeVe` đổi định danh) rồi lấy KHOẢNG GIỮA HAI KHUNG.
//   FPS tức thời = 1000 / khoảng. Ngưỡng ≥30 FPS ⇔ khoảng p90 ≤ 33,3 ms. Kéo LIÊN TỤC (không waitForTimeout).
//   Ba đối chứng: ① đứng yên ⇒ 0 khung ② kéo ⇒ nhiều khung ③ cùng thiết bị trên cảnh NHỎ (12 máy) để so.
import { chromium } from "@playwright/test";
import { arg, BASE, layCookie, ghi, ANH, TANG_DONG, p as pct } from "./lib-F.mjs";

const VPS = arg("vp", "1600x900,1280x720").split(",");
const GPU = arg("gpu", "0") === "1";
const TAG = arg("tag", GPU ? "F3b-gpu" : "F3b");
const BAT_MOC = () => { window.__moc = []; window.__watch && clearInterval(window.__watch); let a = window.__thongKeVe; window.__watch = setInterval(() => { const b = window.__thongKeVe; if (b !== a) { a = b; window.__moc.push(performance.now()); } }, 4); };
const LAY_MOC = () => { clearInterval(window.__watch); const m = window.__moc || []; const d = []; for (let i = 1; i < m.length; i += 1) d.push(+(m[i] - m[i - 1]).toFixed(1)); return { soKhung: m.length, dt: d, t0: m[0] ?? null, t1: m[m.length - 1] ?? null }; };

const CANH = [
  { ten: "twin-tang-dong-68may", duong: `/twin?nm=${TANG_DONG.nm}&toa=${TANG_DONG.toa}&tang=${TANG_DONG.tang}`, tid: "man-twin-van-hanh" },
  { ten: "line-217-12may", duong: "/twin/line/217", tid: "man-twin-line" },
];

const browser = await chromium.launch(GPU ? { args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"] } : {});
const kq = { ca: TAG, gpu: GPU, base: BASE, luc: new Date().toISOString(), soWorker: 1, doGhiChu: "FPS lấy từ KHOẢNG GIỮA HAI KHUNG (1000/Δt), không lấy từ số khung/giây của cửa sổ — số kia bị chặn bởi tốc độ bơm sự kiện của harness", canh: [] };
try {
  const ck = await layCookie(browser, "qatd_kythuat");
  for (const vp of VPS) for (const c of CANH) {
    const [W, H] = vp.split("x").map(Number);
    const ctx = await browser.newContext({ viewport: { width: W, height: H } });
    await ctx.addCookies(ck);
    const page = await ctx.newPage();
    await page.goto(`${BASE}${c.duong}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector(`[data-testid="${c.tid}"]`, { state: "visible", timeout: 60000 });
    await page.waitForFunction(() => (window.__thongKeVe?.calls ?? 0) > 0, null, { timeout: 90000 });
    await page.waitForTimeout(7000);
    const box = await page.locator(`[data-testid="${c.tid}"] canvas`).boundingBox();
    const X = box.x + box.width / 2; const Y = box.y + box.height / 2;
    const r = { ten: c.ten, vp, duong: c.duong };
    r.gl = await page.evaluate(() => { const cv = document.querySelector('canvas'); const g = cv?.getContext('webgl2') || cv?.getContext('webgl'); if (!g) { const t = document.createElement('canvas'); const h = t.getContext('webgl2'); const d2 = h?.getExtension('WEBGL_debug_renderer_info'); return d2 ? h.getParameter(d2.UNMASKED_RENDERER_WEBGL) : null; } const d = g.getExtension('WEBGL_debug_renderer_info'); return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER); });
    // ① ĐỐI CHỨNG ÂM — đứng yên 4 s
    await page.evaluate(BAT_MOC); await page.waitForTimeout(4000);
    r.im = await page.evaluate(LAY_MOC);
    // ② KÉO LIÊN TỤC 40 bước, KHÔNG chờ giữa các bước
    await page.evaluate(BAT_MOC);
    const t0 = Date.now();
    await page.mouse.move(X, Y, { steps: 2 });
    await page.mouse.down();
    for (let i = 1; i <= 40; i += 1) await page.mouse.move(X + Math.round(Math.sin(i / 5) * 160), Y + Math.round(Math.cos(i / 7) * 60), { steps: 1 });
    await page.mouse.up();
    r.msKeo = Date.now() - t0;
    await page.waitForTimeout(300);
    r.keo = await page.evaluate(LAY_MOC);
    const dt = r.keo.dt.filter((x) => x > 0.5); // bỏ khung trùng mốc do interval 4 ms
    r.dtP50 = pct(dt, 50); r.dtP90 = pct(dt, 90); r.dtMax = dt.length ? Math.max(...dt) : null;
    r.fpsP50 = r.dtP50 ? +(1000 / r.dtP50).toFixed(1) : null;
    r.fpsP10 = r.dtP90 ? +(1000 / r.dtP90).toFixed(1) : null; // FPS tệ nhất trong 10 % khung chậm nhất
    r.fpsMin = r.dtMax ? +(1000 / r.dtMax).toFixed(1) : null;
    r.khungTrenSuKien = +(r.keo.soKhung / 40).toFixed(2);
    r.fpsCuaSo = +(r.keo.soKhung / (r.msKeo / 1000)).toFixed(1);
    Object.assign(r, await page.evaluate(() => ({ calls: window.__thongKeVe?.calls ?? null, tri: window.__thongKeVe?.triangles ?? null, khoi: window.__demNhan?.soHopKhoi ?? null })));
    kq.canh.push(r);
    console.log(`  [${vp}] GL ${String(r.gl).slice(0, 62)}`);
    console.log(`  [${vp}] ${c.ten.padEnd(22)} IM 4 s ${r.im.soKhung} khung · KÉO ${r.msKeo} ms ⇒ ${r.keo.soKhung} khung (${r.khungTrenSuKien}/sự kiện, ${r.fpsCuaSo} khung/s cửa sổ)`);
    console.log(`        Δt giữa hai khung: p50 ${r.dtP50} ms (${r.fpsP50} FPS) · p90 ${r.dtP90} ms (${r.fpsP10} FPS) · max ${r.dtMax} ms (${r.fpsMin} FPS) · khối ${r.khoi} · draw ${r.calls} · tam giác ${r.tri}`);
    await page.screenshot({ path: `${ANH}/F-${TAG}-${c.ten}-${vp}.png` }).catch(() => {});
    await ctx.close();
  }
} finally { ghi(TAG, kq); await browser.close(); }
