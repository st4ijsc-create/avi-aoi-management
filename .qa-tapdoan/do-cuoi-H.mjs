/** NGHIỆM-THU CUỐI — PHẦN 3: hiệu năng H1/H2/H3, đúng khuôn lô F để so được.
 *  node .qa-tapdoan/do-cuoi-H.mjs --ca=H1|H3|all
 *  H1: 4 màn × 3 lượt × CONTEXT MỚI mỗi lượt, vai qatd_kythuat @1600×900. 1 worker, tuần tự.
 *  H2 đo kèm trong H1 (mỗi lượt). H3 đo chiều cao THẬT của khoi-tong-quan ở 2 bề rộng.
 */
import { chromium } from "@playwright/test";
import { arg, BASE, LAUNCH, MOC, luu, bao, phan, layCookie, anh, choCanh, pct } from "./lib-cuoi.mjs";

const CA = arg("ca", "all");
const chay = (c) => CA === "all" || CA === c;
const LUOT = Number(arg("luot", "3"));
const VAI = "qatd_kythuat";
const KQ = {};
const TRAN = { calls: 150, tamGiac: 500_000, nhan: 30 };

const td = MOC.tangDong, may = MOC.mayDong[0];
const MAN = {
  twin: { duong: `/twin?do=1&nm=${MOC.F["QATD-A"]}&toa=${td.toa_id}&tang=${td.tang_id}`, tid: "man-twin-van-hanh", ghi: `tầng đông nhất ${td.fcode} ${td.toa_ma} cấp${td.cap} = ${td.so_may} máy (tang_id ${td.tang_id})` },
  line: { duong: `/twin/line/${may.chuyen}?do=1`, tid: "man-twin-line", ghi: `chuyền ${may.chuyen} trên tầng đông` },
  may: { duong: `/twin/may/${may.id}?do=1`, tid: "man-twin-may", ghi: `máy ${may.id} (${may.code})` },
  studio: { duong: "/twin-studio?do=1", tid: "man-twin-studio", ghi: "studio" },
};

const browser = await chromium.launch(LAUNCH);
try {
  const ck = await layCookie(browser, VAI);
  const gl = await (async () => { const c = await browser.newContext(); const p = await c.newPage(); const g = await p.evaluate(() => { const cv = document.createElement("canvas"); const g = cv.getContext("webgl2") || cv.getContext("webgl"); const d = g ? g.getExtension("WEBGL_debug_renderer_info") : null; return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : (g ? g.getParameter(g.RENDERER) : null); }); await c.close(); return g; })();
  console.log(`  GL = ${gl}`);

  /* ══ H1 + H2 ══════════════════════════════════════════════════════════ */
  if (chay("H1")) {
    const r = { ca: "H1", vai: VAI, vp: "1600x900", gl, deBai: "4 man deep-link × 3 luot × CONTEXT MOI moi luot; ms toi man-* va toi khung dau; so moc vong1 p50 2615 / vong2 p50 2137 / admin 1087", man: MAN, luot: [] };
    for (let i = 1; i <= LUOT; i += 1) {
      for (const [ten, m] of Object.entries(MAN)) {
        const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
        await ctx.addCookies(ck);
        await ctx.addInitScript(() => { window.__lt = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push({ t: Math.round(e.startTime), d: Math.round(e.duration) }); }).observe({ type: "longtask", buffered: true }); } catch (e) { /* */ } });
        const page = await ctx.newPage();
        const loi = []; const req400 = [];
        page.on("console", (x) => { if (x.type() === "error") loi.push(x.text().slice(0, 140)); });
        page.on("response", (x) => { if (x.status() >= 400) req400.push(`${x.status()} ${x.url().replace(BASE, "").slice(0, 100)}`); });
        const t0 = Date.now();
        const o = { man: ten, luot: i, duong: m.duong, tid: m.tid };
        try { await page.goto(`${BASE}${m.duong}`, { waitUntil: "domcontentloaded", timeout: 60_000 }); o.msGoto = Date.now() - t0; } catch (e) { o.gotoLoi = String(e.message).split("\n")[0].slice(0, 120); o.msGoto = Date.now() - t0; }
        try { await page.waitForSelector(`[data-testid="${m.tid}"]`, { state: "visible", timeout: 60_000 }); o.msToiMan = Date.now() - t0; } catch (e) { o.msToiMan = null; }
        try { await page.waitForFunction(() => (window.__thongKeVe && window.__thongKeVe.calls > 0), null, { timeout: 90_000 }); o.msKhungDau = Date.now() - t0; } catch (e) { o.msKhungDau = null; }
        try {
          const nav = await page.evaluate(() => { const n = performance.getEntriesByType("navigation")[0]; return n ? { dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), ttfb: Math.round(n.responseStart) } : null; });
          Object.assign(o, nav || {});
          const lt = await page.evaluate(() => window.__lt || []);
          o.ltSo = lt.length; o.ltTongMs = lt.reduce((s, x) => s + x.d, 0); o.ltMaxMs = lt.reduce((s, x) => Math.max(s, x.d), 0);
          // H2 — đo SAU khi cảnh ổn định
          await choCanh(page, 0);
          const h2 = await page.evaluate(() => ({
            soCanvas: window.__soCanvas === undefined ? null : window.__soCanvas,
            canvasDom: document.querySelectorAll("canvas").length,
            calls: window.__thongKeVe ? window.__thongKeVe.calls : null,
            tamGiac: window.__thongKeVe ? window.__thongKeVe.triangles : null,
            nhanDom: document.querySelectorAll('[data-testid="nhan-may-twin3d"]').length,
            demNhan: window.__demNhan === undefined ? null : window.__demNhan,
            soKhoi: (() => { const ds = window.__demTuongTac && window.__demTuongTac.dsMay ? window.__demTuongTac.dsMay() : null; return Array.isArray(ds) ? ds.length : null; })(),
          }));
          Object.assign(o, h2);
        } catch (e) { o.loi = String(e.message).slice(0, 140); }
        o.soLoiConsole = loi.length; o.loiConsole = loi.slice(0, 4); o.req400 = req400.slice(0, 4);
        if (i === 1) o.anh = await anh(page, `H1-${ten}-luot1`);
        r.luot.push(o);
        console.log(`  [lượt ${i}] ${ten.padEnd(7)} MÀN ${o.msToiMan === null ? "KHÔNG" : o.msToiMan} ms · khung đầu ${o.msKhungDau === null ? "KHÔNG" : o.msKhungDau} ms · canvas ${o.soCanvas} · calls ${o.calls} · tri ${o.tamGiac} · nhãn ${o.nhanDom} · khối ${o.soKhoi} · err ${o.soLoiConsole}`);
        await ctx.close();
      }
    }
    r.tomTat = {};
    for (const ten of Object.keys(MAN)) {
      const ds = r.luot.filter((x) => x.man === ten);
      for (const moc of ["msToiMan", "msKhungDau"]) {
        const xs = ds.map((x) => x[moc]);
        const co = xs.filter((x) => x != null);
        r.tomTat[`${ten}-${moc}`] = { so: xs, p50: pct(xs, 50), p90: pct(xs, 90), max: co.length ? Math.max(...co) : null, thieu: xs.length - co.length };
      }
    }
    const moiMsToiMan = r.luot.map((x) => x.msToiMan);
    r.p50ToiMan = pct(moiMsToiMan, 50); r.p90ToiMan = pct(moiMsToiMan, 90);
    r.vuot2500 = r.luot.filter((x) => x.msToiMan == null || x.msToiMan > 2500).map((x) => ({ man: x.man, luot: x.luot, msToiMan: x.msToiMan }));
    r.soMoc = { vong1_p50: 2615, vong1_vuot2500: "48/48", vong2_p50: 2137, admin_p50: 1087 };
    Object.assign(r, phan(
      { "so luot": r.luot.length, "p50 msToiMan": r.p50ToiMan },
      [
        { ten: `du ${4 * LUOT} luot, khong luot nao thieu moc msToiMan`, ok: r.luot.length === 4 * LUOT && moiMsToiMan.every((x) => x != null), thay: `${r.luot.length} lượt · thiếu ${moiMsToiMan.filter((x) => x == null).length}` },
        { ten: "p50 msToiMan THAP HON moc vong 2 (2137 ms)", ok: r.p50ToiMan < 2137, thay: `p50 ${r.p50ToiMan} ms (vòng1 2615 · vòng2 2137 · admin 1087)` },
        { ten: "so luot vuot 2500 ms GIAM so voi 48/48 cua vong 1", ok: r.vuot2500.length < r.luot.length, thay: `${r.vuot2500.length}/${r.luot.length} lượt vượt` },
      ]));
    KQ.H1 = r; bao("H1", r.pq, r.vi); luu("H1", r);
    console.log("\n  --- tóm tắt H1 ---");
    for (const [k, v] of Object.entries(r.tomTat)) console.log(`   ${k.padEnd(24)} p50 ${v.p50} · p90 ${v.p90} · max ${v.max} · [${v.so.join(", ")}]`);

    /* H2 — phán quyết riêng trên cùng dữ liệu */
    const h2 = { ca: "H2", deBai: `__soCanvas=1 moi man · draw calls <= ${TRAN.calls} · tam giac <= ${TRAN.tamGiac} · nhan DOM <= ${TRAN.nhan}`, tran: TRAN };
    const co3d = r.luot.filter((x) => x.man !== "studio" || x.soCanvas != null);
    h2.bang = r.luot.map((x) => ({ man: x.man, luot: x.luot, soCanvas: x.soCanvas, canvasDom: x.canvasDom, calls: x.calls, tamGiac: x.tamGiac, nhanDom: x.nhanDom }));
    const xauCanvas = r.luot.filter((x) => x.soCanvas !== 1);
    const xauCalls = r.luot.filter((x) => x.calls == null || x.calls > TRAN.calls);
    const xauTri = r.luot.filter((x) => x.tamGiac == null || x.tamGiac > TRAN.tamGiac);
    const xauNhan = r.luot.filter((x) => x.nhanDom > TRAN.nhan);
    h2.thay = { xauCanvas: xauCanvas.map((x) => `${x.man}#${x.luot}=${x.soCanvas}`), xauCalls: xauCalls.map((x) => `${x.man}#${x.luot}=${x.calls}`), xauTri: xauTri.map((x) => `${x.man}#${x.luot}=${x.tamGiac}`), xauNhan: xauNhan.map((x) => `${x.man}#${x.luot}=${x.nhanDom}`),
      maxCalls: Math.max(...r.luot.map((x) => x.calls || 0)), maxTri: Math.max(...r.luot.map((x) => x.tamGiac || 0)), maxNhan: Math.max(...r.luot.map((x) => x.nhanDom || 0)) };
    Object.assign(h2, phan(
      { "so luot do duoc": co3d.length === 0 ? null : co3d.length },
      [
        { ten: "__soCanvas = 1 o MOI man MOI luot", ok: xauCanvas.length === 0, thay: JSON.stringify(h2.thay.xauCanvas) },
        { ten: `draw calls <= ${TRAN.calls}`, ok: xauCalls.length === 0, thay: `max ${h2.thay.maxCalls} · xấu ${JSON.stringify(h2.thay.xauCalls)}` },
        { ten: `tam giac <= ${TRAN.tamGiac}`, ok: xauTri.length === 0, thay: `max ${h2.thay.maxTri} · xấu ${JSON.stringify(h2.thay.xauTri)}` },
        { ten: `nhan DOM <= ${TRAN.nhan}`, ok: xauNhan.length === 0, thay: `max ${h2.thay.maxNhan} · xấu ${JSON.stringify(h2.thay.xauNhan)}` },
      ]));
    KQ.H2 = h2; bao("H2", h2.pq, h2.vi); luu("H2", h2);
  }

  /* ══ H3 — chiều cao THẬT của khoi-tong-quan ═══════════════════════════ */
  if (chay("H3")) {
    const r = { ca: "H3", vai: VAI, deBai: "doc getBoundingClientRect().height THAT cua khoi-tong-quan @1280x720 va @1600x900; dem so hang THAT cua nhom ton dong va danh-sach-may", hangTrongLuoi: 41, uocChuaDo: 69, ghiChu: "CHI BAO SO — khong sua hang trong boCucPanelTrai.unit.test.ts", do: {} };
    for (const [w, h] of [[1280, 720], [1600, 900]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h } });
      await ctx.addCookies(ck);
      const page = await ctx.newPage();
      await page.goto(`${BASE}${MAN.twin.duong}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForSelector('[data-testid="man-twin-van-hanh"]', { timeout: 90_000 }).catch(() => {});
      await choCanh(page, 0);
      await page.waitForFunction(() => document.querySelectorAll('[data-testid^="may-hang-"]').length > 0 || !!document.querySelector('[data-testid="danh-sach-rong"]'), null, { timeout: 45_000 }).catch(() => {});
      await page.waitForFunction(() => !!document.querySelector('[data-testid="bang-suc-khoe"]'), null, { timeout: 45_000 }).catch(() => {});
      const d = await page.evaluate(() => {
        const el = (t) => document.querySelector(`[data-testid="${t}"]`);
        const H = (t) => { const e = el(t); return e ? Number(e.getBoundingClientRect().height.toFixed(2)) : null; };
        const R = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Number(b.height.toFixed(2)) }; };
        const tonDong = el("nhom-ton-dong");
        const hienThuc = (e) => { const b = e.getBoundingClientRect(); return b.height > 0 && b.width > 0; };
        const hangTonDong = tonDong ? [...tonDong.querySelectorAll("[data-ma-may]")].filter(hienThuc) : [];
        const homNay = el("nhom-hom-nay");
        const hangHomNay = homNay ? [...homNay.querySelectorAll("[data-ma-may]")].filter(hienThuc) : [];
        const ul = el("danh-sach-may") ? el("danh-sach-may").querySelector("ul[data-so-may]") : null;
        const hangMay = [...document.querySelectorAll('[data-testid^="may-hang-"]')].filter(hienThuc);
        const khungHienThi = (e) => { // số hàng THẤY ĐƯỢC trong ô cuộn (không bị cắt)
          if (!ul || !e) return null;
          const ru = ul.getBoundingClientRect(), re = e.getBoundingClientRect();
          return re.top >= ru.top - 0.5 && re.bottom <= ru.bottom + 0.5;
        };
        return {
          vp: { w: innerWidth, h: innerHeight },
          caoKhoiTongQuan: H("khoi-tong-quan"),
          rectKhoiTongQuan: R(el("khoi-tong-quan")),
          caoBangSucKhoe: H("bang-suc-khoe"),
          caoHangTongQuan: H("hang-tong-quan"),
          caoPanelTrai: H("panel-trai"),
          caoDaiCanhBao: H("dai-canh-bao"),
          caoDanhSachMay: H("danh-sach-may"),
          rectUl: R(ul),
          soHangTonDong: hangTonDong.length,
          maTonDong: hangTonDong.map((e) => e.getAttribute("data-ma-may")),
          soHangHomNay: hangHomNay.length,
          soHangMayDom: hangMay.length,
          soHangMayThayDuoc: hangMay.filter(khungHienThi).length,
          soHangVe: ul ? Number(ul.getAttribute("data-so-hang-ve")) : null,
          soMayTongDs: ul ? Number(ul.getAttribute("data-so-may")) : null,
          caoHangMay: hangMay.length ? Number(hangMay[0].getBoundingClientRect().height.toFixed(2)) : null,
          caoDaiCuon: (() => { const e = el("dai-canh-bao-cuon"); return e ? Number(e.getBoundingClientRect().height.toFixed(2)) : null; })(),
        };
      });
      r.do[`${w}x${h}`] = d;
      r[`anh${w}`] = await anh(page, `H3-khoi-tong-quan-${w}x${h}`);
      console.log(`  @${w}x${h}: khoi-tong-quan CAO ${d.caoKhoiTongQuan} px (hằng lưới 41, ước 69) · tồn đọng ${d.soHangTonDong} hàng · danh-sách-máy ${d.soHangMayThayDuoc} hàng thấy được / ${d.soHangVe} vẽ`);
      await ctx.close();
    }
    const a = r.do["1280x720"], b = r.do["1600x900"];
    r.moHinhDuDoan = { tonDong1280: "3 → 2", danhSachMay1600: "9 → 8" };
    r.thay = {
      cao1280: a ? a.caoKhoiTongQuan : null, cao1600: b ? b.caoKhoiTongQuan : null,
      tonDong1280: a ? a.soHangTonDong : null, tonDong1600: b ? b.soHangTonDong : null,
      hangMayThayDuoc1280: a ? a.soHangMayThayDuoc : null, hangMayThayDuoc1600: b ? b.soHangMayThayDuoc : null,
      hangMayVe1280: a ? a.soHangVe : null, hangMayVe1600: b ? b.soHangVe : null,
    };
    Object.assign(r, phan(
      { "cao khoi-tong-quan @1280": a ? a.caoKhoiTongQuan : null, "cao khoi-tong-quan @1600": b ? b.caoKhoiTongQuan : null,
        "so hang ton dong @1280": a ? a.soHangTonDong : null, "so hang may thay duoc @1600": b ? b.soHangMayThayDuoc : null },
      [
        { ten: "doc duoc chieu cao THAT o ca hai be rong", ok: !!a && !!b && a.caoKhoiTongQuan > 0 && b.caoKhoiTongQuan > 0, thay: `${a ? a.caoKhoiTongQuan : null} / ${b ? b.caoKhoiTongQuan : null}` },
        { ten: "chieu cao that KHAC hang 41 dang nam trong luoi (hang da lac thuc te)", ok: !!a && Math.abs(a.caoKhoiTongQuan - 41) > 1, thay: `@1280 đo ${a ? a.caoKhoiTongQuan : null} px vs hằng 41` },
      ]));
    KQ.H3 = r; bao("H3", r.pq, r.vi); luu("H3", r);
  }
} finally { await browser.close(); }
console.log("\n=== TOM TAT H ===");
for (const [k, v] of Object.entries(KQ)) console.log(` ${k}: ${v.pq}`);
