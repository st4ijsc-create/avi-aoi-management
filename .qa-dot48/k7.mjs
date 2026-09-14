// ĐỢT 48 · K7 — KẾT CỤC GỐC ĐÚNG ĐƯỜNG NGƯỜI DÙNG (G123): `page.mouse.click` vào TÂM KHỐI MÁY trên canvas (không danh sách/dải/cây),
//   vai e2e_tai_loE (auth.me THẬT — G100), 2 màn × 2 vp, URL `?do=1` mở cửa sổ đo `__demTuongTac`. Ghi THÔ .qa-dot48/k7/*.json + PNG TRƯỚC/SAU.
//   K7a /twin · K7b /twin/line/2: bấm tâm khối ⇒ /twin/may/:id đúng id, trễ trong trang click→pushState, chụp TRƯỚC + SAU khi màn Máy VẼ XONG
//   K7c bấm sàn trống ⇒ URL không đổi · K7d KÉO 60 px ⇒ camera đổi, pathname không đổi · K7e rê ⇒ cursor pointer, rời ⇒ không
//   K7f bấm NHÃN ⇒ /twin/may/<data-machine-id>, Back 1 lần về màn gốc, rồi bấm KHỐI cùng máy ⇒ CÙNG ĐÍCH
//   K7g cơ chế: demObject coHandler===soObject===trongScene ≥ 1, tên nhóm `twin3d-lo-may-su-kien`
//   K7h đối chứng dương cùng kit: /factory-command bật 3D ⇒ bấm tâm khối ⇒ Sheet (role=dialog) mở, URL không đổi
//   node .qa-dot48/k7.mjs [--base=http://localhost:3048] [--vp=1600x900,1280x720] [--tag=k7] [--fc=1]
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? m.slice(k.length + 3) : d; };
const BASE = arg("base", "http://localhost:3048"); const VPS = arg("vp", "1600x900,1280x720").split(","); const TAG = arg("tag", "k7"); const FC = arg("fc", "1") === "1";
const OUT = ".qa-dot48/k7"; mkdirSync(OUT, { recursive: true });
const TK = { username: "e2e_tai_loE", password: "E2eTaiLoE!2026" };
const MAN = [["/twin", "man-twin-van-hanh", "K7a"], ["/twin/line/2", "man-twin-line", "K7b"]];
const TRE_TOI_DA_MS = 500;
async function trpcGet(ctx, proc) { const r = await ctx.request.get(`${BASE}/api/trpc/${proc}`); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { status: r.status(), data: j?.result?.data?.json ?? j?.result?.data ?? null, ct: r.headers()["content-type"] ?? "" }; }
async function dangNhap(ctx) {
  const f = `.qa-dot48/state-${TK.username}.json`;
  const ai = async () => { const r = await trpcGet(ctx, "auth.me"); return { ten: r.data?.username ?? null, status: r.status, ct: r.ct }; };
  if (existsSync(f)) { await ctx.addCookies(JSON.parse(readFileSync(f, "utf8"))); const a = await ai(); if (a.ten === TK.username) return { cache: true, ...a }; await ctx.clearCookies(); }
  const res = await ctx.request.post(`${BASE}/api/auth/login`, { data: TK }); const a = await ai();
  if (res.status() !== 200 || a.ten !== TK.username) throw new Error(`dang nhap that bai login=${res.status()} me=${JSON.stringify(a)}`);
  writeFileSync(f, JSON.stringify(await ctx.cookies())); return { cache: false, login: res.status(), ...a };
}
const GHI_DO_BAM = () => { window.__doBam = { tClick: null, tPush: null }; document.addEventListener("click", () => { window.__doBam.tClick = performance.now(); window.__doBam.tPush = null; }, true); const goc = history.pushState.bind(history); history.pushState = function (...a) { window.__doBam.tPush = performance.now(); return goc(...a); }; };
async function moMan(page, duong, man) {
  const t0 = Date.now();
  await page.goto(`${BASE}${duong}${duong.includes("?") ? "&" : "?"}do=1`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(man ? `[data-testid="${man}"] canvas` : "canvas", { timeout: 90_000 });
  const msCanvas = Date.now() - t0;
  const coMay = await page.waitForFunction(() => (window.__demTuongTac?.dsMay?.() ?? []).some((m) => m.trongKhung), null, { timeout: 60_000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(2_500);
  return { msCanvas, msSanSang: Date.now() - t0, coMayTrongKhung: coMay };
}
const mayBamDuoc = (page, man) => page.evaluate((manTid) => {
  const canvas = manTid ? document.querySelector(`[data-testid="${manTid}"] canvas`) : document.querySelector("canvas"); const cv = canvas.getBoundingClientRect();
  const ds = (window.__demTuongTac?.dsMay?.() ?? []).filter((m) => m.trongKhung); const loai = [];
  for (const m of ds) {
    const X = cv.left + m.x, Y = cv.top + m.y; const duoi = document.elementFromPoint(X, Y);
    if (duoi !== canvas) { loai.push(`${m.machineId}:duoi=${duoi?.getAttribute?.("data-testid") ?? duoi?.tagName ?? "null"}`); continue; }
    const t = window.__demTuongTac?.tamMay?.(m.machineId); if (!t) continue;
    const hit = window.__demTuongTac?.hitTai?.(t.ndcX, t.ndcY);
    if (!hit || hit.ten !== "twin3d-lo-may") { loai.push(`${m.machineId}:hit=${hit?.ten ?? "null"}`); continue; }
    return { id: m.machineId, X, Y, cv: [cv.left, cv.top, cv.width, cv.height], soTrongKhung: ds.length, loai: loai.slice(0, 6), hit };
  }
  return { id: null, soTrongKhung: ds.length, loai: loai.slice(0, 10) };
}, man);
const sanTrong = (page, man) => page.evaluate((manTid) => {
  const canvas = manTid ? document.querySelector(`[data-testid="${manTid}"] canvas`) : document.querySelector("canvas"); const cv = canvas.getBoundingClientRect();
  for (const fy of [0.08, 0.12, 0.16, 0.2, 0.25]) for (const fx of [0.5, 0.42, 0.58, 0.34, 0.66]) {
    const X = cv.left + cv.width * fx, Y = cv.top + cv.height * fy;
    if (document.elementFromPoint(X, Y) !== canvas) continue;
    if (window.__demTuongTac?.hitTai?.(fx * 2 - 1, 1 - fy * 2)) continue;
    return { X, Y };
  }
  return null;
}, man);
const cursorCanvas = (page, man) => page.evaluate((manTid) => { const c = manTid ? document.querySelector(`[data-testid="${manTid}"] canvas`) : document.querySelector("canvas"); return c.style.cursor || getComputedStyle(c).cursor; }, man);
const tinhTrangManMay = (page) => page.evaluate(() => {
  const man = document.querySelector('[data-testid="man-twin-may"]');
  return { coMan: !!man, canvasDom: document.querySelectorAll("canvas").length, canvasTrongMan: man ? man.querySelectorAll("canvas").length : 0, __soCanvas: window.__soCanvas ?? null, dangTai: document.querySelectorAll('[data-testid="may-dang-tai"]').length, spin: man ? man.querySelectorAll(".animate-spin, .animate-pulse").length : -1, calls: window.__thongKeVe?.calls ?? null, thanhTren: document.querySelector('[data-testid="thanh-tren-may"]')?.textContent?.trim().slice(0, 120) ?? null, h1: document.querySelector('[data-testid="man-twin-may"] h1, [data-testid="man-twin-may"] h2')?.textContent?.trim().slice(0, 80) ?? null, cockpit: document.querySelectorAll('[data-testid="cockpit-2d"]').length, lyDo: document.querySelector("[data-ly-do]")?.getAttribute("data-ly-do") ?? null };
});
async function choManMayVeXong(page) {
  const t0 = Date.now();
  const coCanvas = await page.waitForSelector('[data-testid="man-twin-may"] canvas', { timeout: 60_000 }).then(() => true).catch(() => false);
  const on = await page.waitForFunction(() => { const man = document.querySelector('[data-testid="man-twin-may"]'); return !!man && man.querySelectorAll("canvas").length >= 1 && document.querySelectorAll('[data-testid="may-dang-tai"]').length === 0 && (window.__thongKeVe?.calls ?? 0) > 0; }, null, { timeout: 60_000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(3_000);
  return { coCanvas, onDinh: on, msVeXong: Date.now() - t0 };
}
const luu = (ten, obj) => writeFileSync(`${OUT}/${ten}.json`, JSON.stringify({ luc: new Date().toISOString(), base: BASE, ...obj }, null, 2));
const PQ = (ok) => (ok ? "ĐẠT" : "SAI");
const browser = await chromium.launch();
const tong = { tag: TAG, luc: new Date().toISOString(), ca: [] };
const ghiCa = (ma, man, vp, ok, so) => { tong.ca.push({ ma, man, vp, pq: PQ(ok), so }); console.log(`   ${PQ(ok).padEnd(4)} ${ma} ${man} @${vp}: ${so}`); };
const pathOf = (u) => { try { return new URL(u).pathname; } catch { return String(u); } };
try {
  for (const vp of VPS) {
    const [W, H] = vp.split("x").map(Number);
    const ctx = await browser.newContext({ viewport: { width: W, height: H } });
    await ctx.addInitScript(() => { try { localStorage.setItem("i18nextLng", "vi"); } catch {} });
    const me = await dangNhap(ctx);
    for (const [duong, man, MA] of MAN) {
      const page = await ctx.newPage(); await page.addInitScript(GHI_DO_BAM);
      const kq = { duong, man, vp, me };
      try {
        kq.mo = await moMan(page, duong, man);
        kq.coChe = await page.evaluate(() => window.__demTuongTac?.demObject?.() ?? null);
        kq.lop = await page.evaluate((manTid) => { const cv = document.querySelector(`[data-testid="${manTid}"] canvas`); const R = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; }; return { canvas: R(cv), lopNhan: R(document.querySelector('[data-testid="lop-nhan-twin3d"]')), lopBadge: R(document.querySelector('[data-testid="lop-canh-bao"]')), soBadge: document.querySelectorAll('[data-testid^="badge-canh-bao-"]').length, soNhan: document.querySelectorAll('[data-testid="nhan-may-twin3d"]').length }; }, man);
        // K7g cơ chế
        const c = kq.coChe; const okG = !!c && c.coHandler >= 1 && c.coHandler === c.soObject && c.trongScene === c.soObject && c.ten.includes("twin3d-lo-may-su-kien");
        ghiCa("K7g", duong, vp, okG, `demObject ${JSON.stringify(c)}`);
        const may = await mayBamDuoc(page, man); kq.may = may;
        if (may.id == null) throw new Error(`khong tim duoc may bam duoc: ${JSON.stringify(may)}`);
        // K7e rê
        await page.mouse.move(may.X - 40, may.Y - 40); await page.waitForTimeout(150); await page.mouse.move(may.X, may.Y, { steps: 5 }); await page.waitForTimeout(300);
        kq.cursorTrenMay = await cursorCanvas(page, man);
        const san = await sanTrong(page, man); kq.san = san;
        if (san) { await page.mouse.move(san.X, san.Y, { steps: 5 }); await page.waitForTimeout(300); kq.cursorTrenSan = await cursorCanvas(page, man); }
        ghiCa("K7e", duong, vp, kq.cursorTrenMay === "pointer" && kq.cursorTrenSan !== "pointer", `trên máy "${kq.cursorTrenMay}" · trên sàn "${kq.cursorTrenSan}"`);
        // K7c sàn trống
        kq.urlTruocSan = page.url(); if (san) { await page.mouse.click(san.X, san.Y); await page.waitForTimeout(800); } kq.urlSauSan = page.url();
        ghiCa("K7c", duong, vp, !!san && kq.urlSauSan === kq.urlTruocSan, `sàn (${Math.round(san?.X ?? -1)},${Math.round(san?.Y ?? -1)}) URL ${kq.urlSauSan === kq.urlTruocSan ? "không đổi" : "ĐỔI " + kq.urlSauSan}`);
        // K7d kéo 60 px bắt đầu trên máy
        kq.camTruoc = await page.evaluate(() => window.__tuTheCamera ?? null); const urlTruocKeo = page.url();
        await page.mouse.move(may.X, may.Y, { steps: 4 }); await page.mouse.down();
        for (let i = 1; i <= 6; i++) { await page.mouse.move(may.X + i * 10, may.Y, { steps: 1 }); await page.waitForTimeout(16); }
        await page.mouse.up(); await page.waitForTimeout(1_200);
        kq.camSau = await page.evaluate(() => window.__tuTheCamera ?? null); kq.urlSauKeo = page.url();
        const pathKeo = pathOf(kq.urlSauKeo) === pathOf(urlTruocKeo); const camDoi = kq.camSau !== null && JSON.stringify(kq.camSau) !== JSON.stringify(kq.camTruoc);
        ghiCa("K7d", duong, vp, pathKeo && camDoi, `pathname ${pathKeo ? "giữ" : "ĐỔI"} · camera ${camDoi ? "đổi" : "KHÔNG đổi"} (${JSON.stringify(kq.camTruoc)} → ${JSON.stringify(kq.camSau)}) · query ${kq.urlSauKeo === urlTruocKeo ? "giữ" : "đổi (?cam=)"}`);
        // K7a/b bấm TÂM KHỐI (tính lại vì camera đã đổi)
        const may2 = await mayBamDuoc(page, man); kq.may2 = may2; if (may2.id == null) throw new Error(`sau keo khong tim duoc may: ${JSON.stringify(may2)}`);
        await page.mouse.move(san ? san.X : may2.X - 60, san ? san.Y : may2.Y - 60); await page.waitForTimeout(400);
        await page.screenshot({ path: `${OUT}/${TAG}-${MA}-${man}-${vp}-truoc.png` });
        await page.mouse.move(may2.X, may2.Y, { steps: 5 }); await page.waitForTimeout(150);
        const t0 = Date.now(); await page.mouse.click(may2.X, may2.Y);
        const toi = await page.waitForURL(new RegExp(`/twin/may/${may2.id}(\\?|$)`), { timeout: 3_000 }).then(() => true).catch(() => false);
        kq.msPlaywright = Date.now() - t0; kq.urlSauBam = page.url();
        const doBam = await page.evaluate(() => window.__doBam ?? null); kq.treTrongTrang = doBam?.tClick != null && doBam?.tPush != null ? +(doBam.tPush - doBam.tClick).toFixed(2) : null;
        kq.veXong = await choManMayVeXong(page); kq.manMay = await tinhTrangManMay(page);
        await page.screenshot({ path: `${OUT}/${TAG}-${MA}-${man}-${vp}-sau.png` });
        const okA = toi && pathOf(kq.urlSauBam) === `/twin/may/${may2.id}` && kq.treTrongTrang !== null && kq.treTrongTrang <= TRE_TOI_DA_MS && kq.veXong.coCanvas && kq.veXong.onDinh && kq.manMay.dangTai === 0;
        ghiCa(MA, duong, vp, okA, `máy ${may2.id} @(${Math.round(may2.X)},${Math.round(may2.Y)}) ⇒ ${pathOf(kq.urlSauBam)} · trễ trong trang ${kq.treTrongTrang} ms (Playwright ${kq.msPlaywright} ms) · màn Máy vẽ xong ${kq.veXong.msVeXong} ms canvas ${kq.manMay.canvasTrongMan}/kit ${kq.manMay.__soCanvas} dangTai ${kq.manMay.dangTai} spin ${kq.manMay.spin} calls ${kq.manMay.calls} · "${kq.manMay.thanhTren ?? kq.manMay.h1}"`);
      } catch (e) { kq.loi = String(e).slice(0, 300); ghiCa(MA, duong, vp, false, `HỎNG ${kq.loi}`); }
      luu(`${TAG}-${MA}-${man}-${vp}`, kq); await page.close();
      // K7f nhãn ⇒ cùng đích
      const p2 = await ctx.newPage(); const kf = { duong, man, vp };
      try {
        kf.mo = await moMan(p2, duong, man);
        kf.nhan = await p2.evaluate((manTid) => {
          const canvas = document.querySelector(`[data-testid="${manTid}"] canvas`); const ds = [...document.querySelectorAll('[data-testid="nhan-may-twin3d"]')]; const loai = [];
          for (const el of ds) { const r = el.getBoundingClientRect(); if (r.width <= 0) continue; const X = r.left + r.width / 2, Y = r.top + r.height / 2; const duoi = document.elementFromPoint(X, Y); const id = Number(el.getAttribute("data-machine-id")); if (duoi !== canvas || !Number.isInteger(id)) { loai.push(`${el.textContent?.trim().slice(0, 20)}:duoi=${duoi?.getAttribute?.("data-testid") ?? duoi?.tagName}`); continue; } return { id, X, Y, chu: el.textContent?.trim(), soNhan: ds.length, loai }; }
          return { id: null, soNhan: ds.length, loai };
        }, man);
        if (kf.nhan.id == null) throw new Error(`khong co nhan bam duoc ${JSON.stringify(kf.nhan)}`);
        await p2.mouse.move(kf.nhan.X, kf.nhan.Y, { steps: 4 }); await p2.waitForTimeout(150); await p2.mouse.click(kf.nhan.X, kf.nhan.Y);
        kf.toiNhan = await p2.waitForURL(new RegExp(`/twin/may/${kf.nhan.id}(\\?|$)`), { timeout: 3_000 }).then(() => true).catch(() => false); kf.urlSauNhan = p2.url();
        await p2.goBack({ waitUntil: "domcontentloaded" }); await p2.waitForTimeout(1_500); kf.urlSauBack = p2.url();
        await p2.waitForSelector(`[data-testid="${man}"] canvas`, { timeout: 60_000 });
        await p2.waitForFunction(() => (window.__demTuongTac?.dsMay?.() ?? []).some((m) => m.trongKhung), null, { timeout: 60_000 }).catch(() => {}); await p2.waitForTimeout(2_000);
        kf.khoi = await p2.evaluate(({ manTid, id }) => { const canvas = document.querySelector(`[data-testid="${manTid}"] canvas`); const cv = canvas.getBoundingClientRect(); const t = window.__demTuongTac?.tamMay?.(id); if (!t || !t.trongKhung) return { ok: false, t }; const X = cv.left + t.x, Y = cv.top + t.y; const duoi = document.elementFromPoint(X, Y); const hit = window.__demTuongTac?.hitTai?.(t.ndcX, t.ndcY); return { ok: duoi === canvas && hit?.ten === "twin3d-lo-may", X, Y, duoi: duoi?.getAttribute?.("data-testid") ?? duoi?.tagName, hit }; }, { manTid: man, id: kf.nhan.id });
        if (kf.khoi.ok) { await p2.mouse.move(kf.khoi.X, kf.khoi.Y, { steps: 4 }); await p2.waitForTimeout(150); await p2.mouse.click(kf.khoi.X, kf.khoi.Y); kf.toiKhoi = await p2.waitForURL(new RegExp(`/twin/may/${kf.nhan.id}(\\?|$)`), { timeout: 3_000 }).then(() => true).catch(() => false); kf.urlSauKhoi = p2.url(); }
        const okF = kf.toiNhan && pathOf(kf.urlSauBack) === duong && (kf.khoi.ok ? kf.toiKhoi && pathOf(kf.urlSauKhoi) === pathOf(kf.urlSauNhan) : true);
        ghiCa("K7f", duong, vp, okF, `nhãn "${kf.nhan.chu}" (id ${kf.nhan.id}) ⇒ ${pathOf(kf.urlSauNhan)} · Back ⇒ ${pathOf(kf.urlSauBack)} · khối cùng máy ${kf.khoi.ok ? "⇒ " + pathOf(kf.urlSauKhoi ?? kf.urlSauBack) : "KHÔNG bấm được (" + JSON.stringify(kf.khoi).slice(0, 80) + ")"}`);
      } catch (e) { kf.loi = String(e).slice(0, 300); ghiCa("K7f", duong, vp, false, `HỎNG ${kf.loi}`); }
      luu(`${TAG}-K7f-${man}-${vp}`, kf); await p2.close();
    }
    // K7h đối chứng dương /factory-command (cùng kit LoBatchMay, kết cục = Sheet mở)
    if (FC) {
      const p3 = await ctx.newPage(); const kh = { vp };
      try {
        await p3.goto(`${BASE}/factory-command?do=1`, { waitUntil: "domcontentloaded" }); await p3.waitForTimeout(8_000);
        const nut3d = p3.locator("button[aria-pressed]").filter({ hasText: /3D/ }); kh.coNut3d = (await nut3d.count()) > 0; if (kh.coNut3d) await nut3d.first().click();
        kh.coCanvas = await p3.waitForSelector("canvas", { timeout: 90_000 }).then(() => true).catch(() => false);
        kh.coMay = await p3.waitForFunction(() => (window.__demTuongTac?.dsMay?.() ?? []).some((m) => m.trongKhung), null, { timeout: 60_000 }).then(() => true).catch(() => false); await p3.waitForTimeout(2_500);
        kh.coChe = await p3.evaluate(() => window.__demTuongTac?.demObject?.() ?? null);
        const may = await mayBamDuoc(p3, null); kh.may = may; if (may.id == null) throw new Error(`fc: khong tim duoc may ${JSON.stringify(may)}`);
        await p3.mouse.move(may.X - 40, may.Y - 40); await p3.waitForTimeout(150); await p3.mouse.move(may.X, may.Y, { steps: 5 }); await p3.waitForTimeout(300); kh.cursor = await cursorCanvas(p3, null);
        kh.urlTruoc = p3.url(); kh.dialogTruoc = await p3.locator('[role="dialog"]').count();
        await p3.screenshot({ path: `${OUT}/${TAG}-K7h-factory-command-${vp}-truoc.png` });
        await p3.mouse.click(may.X, may.Y); await p3.waitForTimeout(1_500);
        kh.urlSau = p3.url(); kh.dialogSau = await p3.locator('[role="dialog"]').count(); kh.dialogChu = ((await p3.locator('[role="dialog"]').first().textContent().catch(() => "")) ?? "").trim().slice(0, 100);
        await p3.screenshot({ path: `${OUT}/${TAG}-K7h-factory-command-${vp}-sau.png` });
        ghiCa("K7h", "/factory-command 3D", vp, kh.cursor === "pointer" && kh.dialogSau > kh.dialogTruoc && kh.urlSau === kh.urlTruoc, `máy ${may.id} · cursor "${kh.cursor}" · dialog ${kh.dialogTruoc}→${kh.dialogSau} "${kh.dialogChu.slice(0, 50)}" · URL ${kh.urlSau === kh.urlTruoc ? "giữ" : "ĐỔI"} · demObject ${JSON.stringify(kh.coChe)}`);
      } catch (e) { kh.loi = String(e).slice(0, 300); ghiCa("K7h", "/factory-command 3D", vp, false, `HỎNG ${kh.loi}`); }
      luu(`${TAG}-K7h-factory-command-${vp}`, kh); await p3.close();
    }
    await ctx.close();
  }
} finally { await browser.close(); }
const dem = tong.ca.reduce((a, c) => { a[c.pq] = (a[c.pq] ?? 0) + 1; return a; }, {});
tong.dem = dem; writeFileSync(`${OUT}/${TAG}-tong.json`, JSON.stringify(tong, null, 2));
console.log(`=== K7 ${TAG}: ${JSON.stringify(dem)} / ${tong.ca.length} ca ===`);
