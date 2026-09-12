// ĐỢT 52 · K8 — KẾT CỤC GỐC, ĐÚNG ĐƯỜNG NGƯỜI DÙNG (G123), NGHIỆM THU CUỐI.
//   Kế thừa .qa-dot48/k7.mjs (KHÔNG sửa bản của đợt cũ — G130) và mở rộng theo brief Đợt 52:
//     K8a /twin · K8b /twin/line/2 : `page.mouse.click` TÂM KHỐI của ≥5 MÁY KHÁC NHAU mỗi màn/vp,
//         **kể cả máy mà tâm bị nhãn máy KHÁC phủ**; đo trễ TRONG TRANG (click→pushState);
//         chụp SAU khi màn Máy VẼ XONG (`may-dang-tai`=0 và `__thongKeVe.calls>0`).
//     K8c sàn trống ⇒ URL không đổi · K8d kéo 60 px ⇒ camera đổi, pathname giữ
//     K8e cursor pointer trên máy / khác trên sàn · K8f bấm NHÃN ⇒ đúng máy của nhãn
//     K8g demObject 1/1/1 · K8h đối chứng dương /factory-command
//     K8i bấm SAU KÉO 60 px và SAU ĐỔI TẦNG/TOÀ (trạng thái Đợt 47–49 hay lộ lỗi)
//   Ghi thô: .qa-dot54/k8/*.json + PNG.  node .qa-dot54/k8.mjs --base=http://localhost:3054 [--vp=...] [--tag=k8] [--fc=1] [--so=5]
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? m.slice(k.length + 3) : d; };
const BASE = arg("base", "http://localhost:3054");
const VPS = arg("vp", "1280x720,1600x900").split(",");
const TAG = arg("tag", "k8");
const FC = arg("fc", "1") === "1";
const SO_MAY = Number(arg("so", "5"));
const OUT = ".qa-dot54/k8"; mkdirSync(OUT, { recursive: true });
const TK = { username: "e2e_tai_loE", password: "E2eTaiLoE!2026" };
const MAN = [["/twin", "man-twin-van-hanh", "K8a"], ["/twin/line/2", "man-twin-line", "K8b"]];
const TRE_TOI_DA_MS = 500;

async function trpcGet(ctx, proc, input) {
  const u = `${BASE}/api/trpc/${proc}` + (input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`);
  const r = await ctx.request.get(u); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { status: r.status(), data: j?.result?.data?.json ?? j?.result?.data ?? null, ct: r.headers()["content-type"] ?? "" };
}
async function dangNhap(ctx) {
  const f = `.qa-dot54/state-${TK.username}.json`;
  const ai = async () => { const r = await trpcGet(ctx, "auth.me"); return { ten: r.data?.username ?? null, status: r.status, ct: r.ct }; };
  if (existsSync(f)) { await ctx.addCookies(JSON.parse(readFileSync(f, "utf8"))); const a = await ai(); if (a.ten === TK.username) return { cache: true, ...a }; await ctx.clearCookies(); }
  const res = await ctx.request.post(`${BASE}/api/auth/login`, { data: TK }); const a = await ai();
  if (res.status() !== 200 || a.ten !== TK.username) throw new Error(`dang nhap that bai login=${res.status()} me=${JSON.stringify(a)}`);
  writeFileSync(f, JSON.stringify(await ctx.cookies())); return { cache: false, login: res.status(), ...a };
}
const GHI_DO_BAM = () => {
  window.__doBam = { tClick: null, tPush: null };
  document.addEventListener("click", () => { window.__doBam.tClick = performance.now(); window.__doBam.tPush = null; }, true);
  const goc = history.pushState.bind(history);
  history.pushState = function (...a) { window.__doBam.tPush = performance.now(); return goc(...a); };
};
async function moMan(page, duong, man) {
  const t0 = Date.now();
  await page.goto(`${BASE}${duong}${duong.includes("?") ? "&" : "?"}do=1`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(man ? `[data-testid="${man}"] canvas` : "canvas", { timeout: 90_000 });
  const msCanvas = Date.now() - t0;
  const coMay = await page.waitForFunction(() => (window.__demTuongTac?.dsMay?.() ?? []).some((m) => m.trongKhung), null, { timeout: 60_000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(2_500);
  return { msCanvas, msSanSang: Date.now() - t0, coMayTrongKhung: coMay };
}
async function choCanhSanSang(page, man) {
  await page.waitForSelector(`[data-testid="${man}"] canvas`, { timeout: 60_000 });
  await page.waitForFunction(() => (window.__demTuongTac?.dsMay?.() ?? []).some((m) => m.trongKhung), null, { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(1_800);
}
/** Danh sách MỌI máy bấm được trong khung + cờ "tâm bị NHÃN máy KHÁC phủ". */
const dsBamDuoc = (page, man) => page.evaluate((manTid) => {
  const canvas = manTid ? document.querySelector(`[data-testid="${manTid}"] canvas`) : document.querySelector("canvas");
  const cv = canvas.getBoundingClientRect();
  const hopNhan = window.__demTuongTac?.hopNhanDaVe?.() ?? [];
  const ds = (window.__demTuongTac?.dsMay?.() ?? []).filter((m) => m.trongKhung);
  const ra = []; const loai = [];
  for (const m of ds) {
    const X = cv.left + m.x, Y = cv.top + m.y;
    const duoi = document.elementFromPoint(X, Y);
    if (duoi !== canvas) { loai.push(`${m.machineId}:duoi=${duoi?.getAttribute?.("data-testid") ?? duoi?.tagName ?? "null"}`); continue; }
    const t = window.__demTuongTac?.tamMay?.(m.machineId); if (!t) { loai.push(`${m.machineId}:khongTam`); continue; }
    const hit = window.__demTuongTac?.hitTai?.(t.ndcX, t.ndcY);
    if (!hit || hit.ten !== "twin3d-lo-may") { loai.push(`${m.machineId}:hit=${hit?.ten ?? "null"}`); continue; }
    const nhanKhac = hopNhan.filter((v) => v.machineId !== m.machineId && m.x >= v.hop.trai && m.x <= v.hop.phai && m.y >= v.hop.tren && m.y <= v.hop.duoi).map((v) => v.machineId);
    ra.push({ id: m.machineId, X, Y, biNhanKhacPhu: nhanKhac, biChe: t.biChe ?? null });
  }
  return { soTrongKhung: ds.length, soBamDuoc: ra.length, soNhanVe: hopNhan.length, ds: ra, loai: loai.slice(0, 8), cv: [cv.left, cv.top, cv.width, cv.height] };
}, man);
const sanTrong = (page, man) => page.evaluate((manTid) => {
  const canvas = manTid ? document.querySelector(`[data-testid="${manTid}"] canvas`) : document.querySelector("canvas");
  const cv = canvas.getBoundingClientRect();
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
  return { coMan: !!man, canvasDom: document.querySelectorAll("canvas").length, canvasTrongMan: man ? man.querySelectorAll("canvas").length : 0, __soCanvas: window.__soCanvas ?? null, dangTai: document.querySelectorAll('[data-testid="may-dang-tai"]').length, spin: man ? man.querySelectorAll(".animate-spin, .animate-pulse").length : -1, calls: window.__thongKeVe?.calls ?? null, thanhTren: document.querySelector('[data-testid="thanh-tren-may"]')?.textContent?.trim().slice(0, 120) ?? null, h1: document.querySelector('[data-testid="man-twin-may"] h1, [data-testid="man-twin-may"] h2')?.textContent?.trim().slice(0, 80) ?? null };
});
async function choManMayVeXong(page) {
  const t0 = Date.now();
  const coCanvas = await page.waitForSelector('[data-testid="man-twin-may"] canvas', { timeout: 60_000 }).then(() => true).catch(() => false);
  const on = await page.waitForFunction(() => { const man = document.querySelector('[data-testid="man-twin-may"]'); return !!man && man.querySelectorAll("canvas").length >= 1 && document.querySelectorAll('[data-testid="may-dang-tai"]').length === 0 && (window.__thongKeVe?.calls ?? 0) > 0; }, null, { timeout: 60_000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(2_200);
  return { coCanvas, onDinh: on, msVeXong: Date.now() - t0 };
}
/** Đo LẠI tâm ngay trước cú bấm (Đợt 49: dùng toạ độ khung cũ ⇒ âm tính giả). */
const tamHienTai = (page, man, id) => page.evaluate(({ manTid, mid }) => {
  const canvas = document.querySelector(`[data-testid="${manTid}"] canvas`); if (!canvas) return null;
  const cv = canvas.getBoundingClientRect();
  const t = window.__demTuongTac?.tamMay?.(mid); if (!t || !t.trongKhung) return null;
  const X = cv.left + t.x, Y = cv.top + t.y;
  if (document.elementFromPoint(X, Y) !== canvas) return null;
  const hit = window.__demTuongTac?.hitTai?.(t.ndcX, t.ndcY);
  const hopNhan = window.__demTuongTac?.hopNhanDaVe?.() ?? [];
  const nhanKhac = hopNhan.filter((v) => v.machineId !== mid && t.x >= v.hop.trai && t.x <= v.hop.phai && t.y >= v.hop.tren && t.y <= v.hop.duoi).map((v) => v.machineId);
  return { X, Y, hit: hit ? `${hit.ten}#${hit.machineId}` : null, hitMay: hit?.machineId ?? null, biNhanKhacPhu: nhanKhac, biChe: t.biChe ?? null };
}, { manTid: man, mid: id });
const pathOf = (u) => { try { return new URL(u).pathname; } catch { return String(u); } };
const PQ = (ok) => (ok ? "ĐẠT" : "SAI");
const luu = (ten, obj) => writeFileSync(`${OUT}/${ten}.json`, JSON.stringify({ luc: new Date().toISOString(), base: BASE, ...obj }, null, 2));

const tong = { tag: TAG, base: BASE, luc: new Date().toISOString(), ca: [] };
const ghiCa = (ma, man, vp, pq, so) => { tong.ca.push({ ma, man, vp, pq, so }); console.log(`   ${String(pq).padEnd(5)} ${ma} ${man} @${vp}: ${so}`); };

/** Bấm tâm khối một máy, chờ màn Máy vẽ xong, chụp, rồi Back về cảnh. */
async function bamMotMay(page, duong, man, vp, MA, m, idx) {
  const t = await tamHienTai(page, man, m.id);
  if (!t) return { may: m.id, boQua: "tam khong bam duoc o khung hien tai" };
  await page.mouse.move(t.X - 50, t.Y - 50); await page.waitForTimeout(150);
  await page.mouse.move(t.X, t.Y, { steps: 5 }); await page.waitForTimeout(150);
  const t0 = Date.now();
  await page.mouse.click(t.X, t.Y);
  const toi = await page.waitForURL(new RegExp(`/twin/may/${m.id}(\\?|$)`), { timeout: 4_000 }).then(() => true).catch(() => false);
  const msPlaywright = Date.now() - t0;
  const url = page.url();
  const doBam = await page.evaluate(() => window.__doBam ?? null);
  const tre = doBam?.tClick != null && doBam?.tPush != null ? +(doBam.tPush - doBam.tClick).toFixed(2) : null;
  const veXong = await choManMayVeXong(page);
  const manMay = await tinhTrangManMay(page);
  const png = `${OUT}/${TAG}-${MA}-${vp}-may${idx}-${m.id}-sau.png`;
  await page.screenshot({ path: png });
  const ok = toi && pathOf(url) === `/twin/may/${m.id}` && tre !== null && tre <= TRE_TOI_DA_MS && veXong.coCanvas && veXong.onDinh && manMay.dangTai === 0 && manMay.canvasTrongMan >= 1;
  const kq = { may: m.id, biNhanKhacPhu: t.biNhanKhacPhu, biChe: t.biChe, X: Math.round(t.X), Y: Math.round(t.Y), hit: t.hit, url, dich: (url.match(/\/twin\/may\/(\d+)/) ?? [])[1] ?? null, treTrongTrang: tre, msPlaywright, veXong, manMay, png, ok };
  // Back về cảnh
  if (url.includes("/twin/may/")) { await page.goBack({ waitUntil: "domcontentloaded" }); await choCanhSanSang(page, man); }
  return kq;
}

const browser = await chromium.launch();
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
        // K8g cơ chế
        kq.coChe = await page.evaluate(() => window.__demTuongTac?.demObject?.() ?? null);
        const c = kq.coChe;
        const okG = !!c && c.coHandler >= 1 && c.coHandler === c.soObject && c.trongScene === c.soObject && c.ten.includes("twin3d-lo-may-su-kien");
        ghiCa("K8g", duong, vp, PQ(okG), `demObject ${JSON.stringify(c)}`);
        // census
        const cen = await dsBamDuoc(page, man); kq.census = cen;
        if (cen.ds.length === 0) throw new Error(`0 may bam duoc: ${JSON.stringify(cen).slice(0, 200)}`);
        // K8e cursor
        await page.mouse.move(cen.ds[0].X - 40, cen.ds[0].Y - 40); await page.waitForTimeout(150);
        await page.mouse.move(cen.ds[0].X, cen.ds[0].Y, { steps: 5 }); await page.waitForTimeout(300);
        kq.cursorTrenMay = await cursorCanvas(page, man);
        const san = await sanTrong(page, man); kq.san = san;
        if (san) { await page.mouse.move(san.X, san.Y, { steps: 5 }); await page.waitForTimeout(300); kq.cursorTrenSan = await cursorCanvas(page, man); }
        ghiCa("K8e", duong, vp, PQ(kq.cursorTrenMay === "pointer" && kq.cursorTrenSan !== "pointer"), `trên máy "${kq.cursorTrenMay}" · trên sàn "${kq.cursorTrenSan}"`);
        // K8c sàn trống
        const urlT = page.url(); if (san) { await page.mouse.click(san.X, san.Y); await page.waitForTimeout(900); }
        kq.urlSauSan = page.url();
        ghiCa("K8c", duong, vp, PQ(!!san && kq.urlSauSan === urlT), `sàn (${Math.round(san?.X ?? -1)},${Math.round(san?.Y ?? -1)}) URL ${kq.urlSauSan === urlT ? "không đổi" : "ĐỔI → " + kq.urlSauSan}`);
        // chọn ≥5 máy: ưu tiên máy BỊ NHÃN MÁY KHÁC PHỦ, rồi trải đều phần còn lại
        const biPhu = cen.ds.filter((m) => m.biNhanKhacPhu.length > 0);
        const conLai = cen.ds.filter((m) => m.biNhanKhacPhu.length === 0);
        const buoc = Math.max(1, Math.floor(conLai.length / Math.max(1, SO_MAY - Math.min(biPhu.length, 2))));
        const chon = [...biPhu.slice(0, 2)];
        for (let i = 0; i < conLai.length && chon.length < SO_MAY; i += buoc) chon.push(conLai[i]);
        for (const m of conLai) { if (chon.length >= SO_MAY) break; if (!chon.some((x) => x.id === m.id)) chon.push(m); }
        kq.chon = chon.map((m) => ({ id: m.id, biNhanKhacPhu: m.biNhanKhacPhu }));
        kq.soBiPhuTrongKhung = biPhu.length;
        kq.bam = [];
        for (let i = 0; i < chon.length; i++) {
          const r = await bamMotMay(page, duong, man, vp, MA, chon[i], i + 1);
          kq.bam.push(r);
          const nhan = (r.biNhanKhacPhu?.length ?? 0) > 0 ? ` [tâm bị NHÃN máy ${r.biNhanKhacPhu.join("|")} phủ]` : "";
          if (r.boQua) ghiCa(`${MA}.${i + 1}`, duong, vp, "HỎNG", `máy ${r.may}: ${r.boQua}`);
          else ghiCa(`${MA}.${i + 1}`, duong, vp, PQ(r.ok), `máy ${r.may}${nhan} @(${r.X},${r.Y}) ⇒ ${pathOf(r.url)} · trễ trong trang ${r.treTrongTrang} ms (PW ${r.msPlaywright} ms) · vẽ xong ${r.veXong.msVeXong} ms canvas ${r.manMay.canvasTrongMan}/kit ${r.manMay.__soCanvas} dangTai ${r.manMay.dangTai} calls ${r.manMay.calls} · "${(r.manMay.thanhTren ?? r.manMay.h1 ?? "").slice(0, 40)}"`);
        }
        // K8d kéo 60 px
        const cen2 = await dsBamDuoc(page, man);
        const m0 = cen2.ds[0];
        kq.camTruoc = await page.evaluate(() => window.__tuTheCamera ?? null);
        const urlTruocKeo = page.url();
        await page.mouse.move(m0.X, m0.Y, { steps: 4 }); await page.mouse.down();
        for (let i = 1; i <= 6; i++) { await page.mouse.move(m0.X + i * 10, m0.Y, { steps: 1 }); await page.waitForTimeout(16); }
        await page.mouse.up(); await page.waitForTimeout(1_400);
        kq.camSau = await page.evaluate(() => window.__tuTheCamera ?? null); kq.urlSauKeo = page.url();
        const pathKeo = pathOf(kq.urlSauKeo) === pathOf(urlTruocKeo);
        const camDoi = kq.camSau !== null && JSON.stringify(kq.camSau) !== JSON.stringify(kq.camTruoc);
        ghiCa("K8d", duong, vp, PQ(pathKeo && camDoi), `pathname ${pathKeo ? "giữ" : "ĐỔI"} · camera ${camDoi ? "đổi" : "KHÔNG đổi"} (${JSON.stringify(kq.camTruoc)} → ${JSON.stringify(kq.camSau)})`);
        // K8i-1 bấm SAU KÉO
        const cen3 = await dsBamDuoc(page, man);
        if (cen3.ds.length) {
          const r = await bamMotMay(page, duong, man, vp, MA, cen3.ds[0], "i1");
          kq.bamSauKeo = r;
          ghiCa("K8i-keo", duong, vp, r.boQua ? "HỎNG" : PQ(r.ok), `sau kéo 60px: máy ${r.may} ⇒ ${r.boQua ?? pathOf(r.url)} · trễ ${r.treTrongTrang} ms`);
        } else ghiCa("K8i-keo", duong, vp, "HỎNG", `sau kéo: 0 máy bấm được (${JSON.stringify(cen3.loai).slice(0, 120)})`);
      } catch (e) { kq.loi = String(e).slice(0, 400); ghiCa(MA, duong, vp, "HỎNG", `HỎNG ${kq.loi}`); }
      luu(`${TAG}-${MA}-${man}-${vp}`, kq); await page.close();

      // K8f bấm NHÃN ⇒ đúng máy của nhãn
      const p2 = await ctx.newPage(); const kf = { duong, man, vp };
      try {
        kf.mo = await moMan(p2, duong, man);
        kf.nhan = await p2.evaluate((manTid) => {
          const canvas = document.querySelector(`[data-testid="${manTid}"] canvas`);
          const ds = [...document.querySelectorAll('[data-testid="nhan-may-twin3d"]')]; const loai = [];
          for (const el of ds) { const r = el.getBoundingClientRect(); if (r.width <= 0) continue; const X = r.left + r.width / 2, Y = r.top + r.height / 2; const duoi = document.elementFromPoint(X, Y); const id = Number(el.getAttribute("data-machine-id")); if (duoi !== canvas || !Number.isInteger(id)) { loai.push(`${el.textContent?.trim().slice(0, 16)}:duoi=${duoi?.getAttribute?.("data-testid") ?? duoi?.tagName}`); continue; } return { id, X, Y, chu: el.textContent?.trim(), soNhan: ds.length, loai }; }
          return { id: null, soNhan: ds.length, loai };
        }, man);
        if (kf.nhan.id == null) throw new Error(`khong co nhan bam duoc ${JSON.stringify(kf.nhan).slice(0, 200)}`);
        await p2.mouse.move(kf.nhan.X, kf.nhan.Y, { steps: 4 }); await p2.waitForTimeout(150); await p2.mouse.click(kf.nhan.X, kf.nhan.Y);
        kf.toiNhan = await p2.waitForURL(new RegExp(`/twin/may/${kf.nhan.id}(\\?|$)`), { timeout: 4_000 }).then(() => true).catch(() => false);
        kf.urlSauNhan = p2.url();
        await p2.goBack({ waitUntil: "domcontentloaded" }); await p2.waitForTimeout(1_500); kf.urlSauBack = p2.url();
        ghiCa("K8f", duong, vp, PQ(kf.toiNhan && pathOf(kf.urlSauNhan) === `/twin/may/${kf.nhan.id}` && pathOf(kf.urlSauBack) === duong), `nhãn "${kf.nhan.chu}" (id ${kf.nhan.id}) ⇒ ${pathOf(kf.urlSauNhan)} · Back ⇒ ${pathOf(kf.urlSauBack)}`);
      } catch (e) { kf.loi = String(e).slice(0, 300); ghiCa("K8f", duong, vp, "HỎNG", `HỎNG ${kf.loi}`); }
      luu(`${TAG}-K8f-${man}-${vp}`, kf); await p2.close();
    }

    // K8i-2 ĐỔI TẦNG rồi bấm — chỉ /twin có bộ chọn nạp
    const p4 = await ctx.newPage(); await p4.addInitScript(GHI_DO_BAM);
    const kt = { vp, duong: "/twin" };
    try {
      kt.mo = await moMan(p4, "/twin", "man-twin-van-hanh");
      kt.oChon = await p4.evaluate(() => {
        const o = (id) => { const el = document.querySelector(`[data-testid="${id}"]`); return el ? { soMuc: Number(el.getAttribute("data-so-muc")), value: el.value, opts: [...el.options].map((x) => ({ v: x.value, n: x.textContent?.trim().slice(0, 24) })) } : null; };
        return { nhaMay: o("chon-nha-may"), toaNha: o("chon-toa-nha"), tang: o("chon-tang") };
      });
      const tang = kt.oChon.tang;
      const khac = tang?.opts?.find((x) => x.v && x.v !== tang.value);
      if (!khac) throw new Error(`khong co tang khac de doi: ${JSON.stringify(kt.oChon).slice(0, 300)}`);
      kt.doiSang = khac;
      await p4.selectOption('[data-testid="chon-tang"]', khac.v);
      await p4.waitForTimeout(3_500);
      await p4.waitForFunction(() => (window.__demTuongTac?.dsMay?.() ?? []).some((m) => m.trongKhung), null, { timeout: 60_000 }).catch(() => {});
      await p4.waitForTimeout(1_500);
      const cen = await dsBamDuoc(p4, "man-twin-van-hanh"); kt.census = cen;
      if (!cen.ds.length) throw new Error(`sau doi tang: 0 may bam duoc ${JSON.stringify(cen.loai).slice(0, 160)}`);
      const r = await bamMotMay(p4, "/twin", "man-twin-van-hanh", vp, "K8i", cen.ds[0], "i2");
      kt.bam = r;
      ghiCa("K8i-tang", "/twin", vp, r.boQua ? "HỎNG" : PQ(r.ok), `đổi tầng "${tang.value}"→"${khac.v}" (${khac.n}) · ${cen.soBamDuoc}/${cen.soTrongKhung} máy bấm được · bấm máy ${r.may} ⇒ ${r.boQua ?? pathOf(r.url)} · trễ ${r.treTrongTrang} ms`);
    } catch (e) { kt.loi = String(e).slice(0, 400); ghiCa("K8i-tang", "/twin", vp, "HỎNG", `HỎNG ${kt.loi}`); }
    luu(`${TAG}-K8i-tang-${vp}`, kt); await p4.close();

    // K8h đối chứng dương /factory-command
    if (FC) {
      const p3 = await ctx.newPage(); const kh = { vp };
      try {
        await p3.goto(`${BASE}/factory-command?do=1`, { waitUntil: "domcontentloaded" }); await p3.waitForTimeout(8_000);
        const nut3d = p3.locator("button[aria-pressed]").filter({ hasText: /3D/ }); kh.coNut3d = (await nut3d.count()) > 0; if (kh.coNut3d) await nut3d.first().click();
        kh.coCanvas = await p3.waitForSelector("canvas", { timeout: 90_000 }).then(() => true).catch(() => false);
        await p3.waitForFunction(() => (window.__demTuongTac?.dsMay?.() ?? []).some((m) => m.trongKhung), null, { timeout: 60_000 }).catch(() => {});
        await p3.waitForTimeout(2_500);
        kh.coChe = await p3.evaluate(() => window.__demTuongTac?.demObject?.() ?? null);
        const cen = await dsBamDuoc(p3, null); kh.census = { soTrongKhung: cen.soTrongKhung, soBamDuoc: cen.soBamDuoc, loai: cen.loai };
        if (!cen.ds.length) throw new Error(`fc: 0 may bam duoc ${JSON.stringify(cen.loai).slice(0, 160)}`);
        const m = cen.ds[0];
        await p3.mouse.move(m.X - 40, m.Y - 40); await p3.waitForTimeout(150); await p3.mouse.move(m.X, m.Y, { steps: 5 }); await p3.waitForTimeout(300);
        kh.cursor = await cursorCanvas(p3, null);
        kh.urlTruoc = p3.url(); kh.dialogTruoc = await p3.locator('[role="dialog"]').count();
        await p3.mouse.click(m.X, m.Y); await p3.waitForTimeout(1_800);
        kh.urlSau = p3.url(); kh.dialogSau = await p3.locator('[role="dialog"]').count();
        kh.dialogChu = ((await p3.locator('[role="dialog"]').first().textContent().catch(() => "")) ?? "").trim().slice(0, 100);
        await p3.screenshot({ path: `${OUT}/${TAG}-K8h-factory-command-${vp}-sau.png` });
        ghiCa("K8h", "/factory-command 3D", vp, PQ(kh.cursor === "pointer" && kh.dialogSau > kh.dialogTruoc && kh.urlSau === kh.urlTruoc), `máy ${m.id} · cursor "${kh.cursor}" · dialog ${kh.dialogTruoc}→${kh.dialogSau} "${kh.dialogChu.slice(0, 40)}" · URL ${kh.urlSau === kh.urlTruoc ? "giữ" : "ĐỔI"} · demObject ${JSON.stringify(kh.coChe)}`);
      } catch (e) { kh.loi = String(e).slice(0, 300); ghiCa("K8h", "/factory-command 3D", vp, "HỎNG", `HỎNG ${kh.loi}`); }
      luu(`${TAG}-K8h-factory-command-${vp}`, kh); await p3.close();
    }
    await ctx.close();
  }
} finally { await browser.close(); }
const dem = tong.ca.reduce((a, x) => { a[x.pq] = (a[x.pq] ?? 0) + 1; return a; }, {});
tong.dem = dem;
writeFileSync(`${OUT}/${TAG}-tong.json`, JSON.stringify(tong, null, 2));
console.log(`=== K8 ${TAG}: ${JSON.stringify(dem)} / ${tong.ca.length} ca ===`);
