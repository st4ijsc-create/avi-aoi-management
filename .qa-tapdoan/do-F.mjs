// ★ LÔ F — QA lần 11 (kịch bản tập đoàn). MỘT MÌNH, TUẦN TỰ, 1 context/lượt.
//   node .qa-tapdoan/do-F.mjs --ca=F1|F2|F3|F4|F6|F7 [--base=http://localhost:3064]
//   Dữ liệu 1.108 máy QATD (~26× đợt trước). Tầng đông nhất: QATD-A toà T2 tầng 1 = 68 máy (tang_id 88, toa 54, nm 38).
//   ⚠ KHÔNG đọc pixel canvas (preserveDrawingBuffer=false ⇒ 0 pixel giống canvas trống, G34). Chỉ DOM + bbox + renderer.info qua __thongKeVe.
//   ⚠ __thongKeVe được GÁN OBJECT MỚI mỗi khung (KhungCanh.tsx:263) ⇒ đếm khung = đếm lần đổi định danh; `calls`/`triangles` TRỄ MỘT KHUNG.
import { chromium } from "@playwright/test";
import { arg, BASE, layCookie, ghi, ANH, TANG_DONG, p as pct } from "./lib-F.mjs";

const CA = arg("ca", "F1");
const LUOT = Number(arg("luot", "3"));
const VPS = arg("vp", "1600x900,1280x720").split(",");
const GPU = arg("gpu", "0") === "1";
const TAG = arg("tag", GPU ? `${CA}-gpu` : CA);
const SO_WORKER = 1; // G147 — MỘT tiến trình, MỘT browser, tuần tự

const MAN = {
  twin: { duong: `/twin?nm=${TANG_DONG.nm}&toa=${TANG_DONG.toa}&tang=${TANG_DONG.tang}`, tid: "man-twin-van-hanh", ghiChu: `tầng đông nhất ${TANG_DONG.nhan} = ${TANG_DONG.may} máy` },
  line: { duong: "/twin/line/217", tid: "man-twin-line", ghiChu: "QATD-A toà T1 (PH-12: chỉ nhà máy đầu + toà đầu mới vẽ đủ)" },
  may: { duong: "/twin/may/4197", tid: "man-twin-may", ghiChu: "QATD-A toà T1 line 217 (PH-12)" },
  studio: { duong: "/twin-studio", tid: "man-twin-studio", ghiChu: "studio chỉ có tầng 1 toà 1 (PH-14)" },
};

/** Đo TRONG TRANG: cảnh (canvas + renderer.info), nhãn/badge/chip + bbox, lớp phủ, cắt chữ, tràn ngang. */
const DO_CANH = (manTid) => {
  const R = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), phai: Math.round(b.right), day: Math.round(b.bottom) }; };
  const zHL = (el) => { let e = el; while (e && e !== document.body) { const cs = getComputedStyle(e); if (cs.position !== "static" && cs.zIndex !== "auto") return Number(cs.zIndex); e = e.parentElement; } return 0; };
  const hien = (el) => { if (!el || el.hidden) return false; const b = el.getBoundingClientRect(); if (b.width <= 0 || b.height <= 0) return false; const cs = getComputedStyle(el); return cs.visibility !== "hidden" && Number(cs.opacity) > 0.05; };
  const giao = (a, b) => Math.max(0, Math.min(a.phai, b.phai) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.day, b.day) - Math.max(a.y, b.y));
  const q = (t) => document.querySelector(`[data-testid="${t}"]`);
  const man = q(manTid);
  const canvasEl = man?.querySelector("canvas") ?? document.querySelector("canvas");
  const canvas = R(canvasEl);
  const mucCo = (el, extra) => { const cs = getComputedStyle(el); const r = R(el); return Object.assign({ t: el.getAttribute("data-testid"), chu: (el.textContent ?? "").trim().slice(0, 48), rect: r, z: zHL(el), fontPx: parseFloat(cs.fontSize), color: cs.color, trongCanvas: !!canvas && r.x >= canvas.x - 0.5 && r.phai <= canvas.phai + 0.5 && r.y >= canvas.y - 0.5 && r.day <= canvas.day + 0.5 }, extra || {}); };
  const nhan = [...document.querySelectorAll('[data-testid="nhan-may-twin3d"]')].filter(hien).map((el) => mucCo(el, { mayId: el.getAttribute("data-machine-id") }));
  const badge = [...document.querySelectorAll('[data-testid^="badge-canh-bao-"]')].filter(hien).map((el) => mucCo(el, { muc: el.getAttribute("data-muc"), ngoaiKhung: el.getAttribute("data-ngoai-khung") }));
  const chip = [...document.querySelectorAll('[data-testid="chip-nhan-bi-an"], [data-testid="chip-canh-bao-bi-an"], [data-testid="chip-su-co-ngoai-khung"]')].filter(hien).map((el) => mucCo(el, { soAn: el.getAttribute("data-so-an"), theoCS: el.getAttribute("data-theo-chinh-sach") }));
  const lop = {};
  for (const t of ["lop-nhan-twin3d", "lop-canh-bao"]) {
    const el = q(t);
    if (!el) { lop[t] = null; continue; }
    const r = R(el);
    lop[t] = { rect: r, lech: canvas ? { x: r.x - canvas.x, y: r.y - canvas.y, w: r.w - canvas.w, h: r.h - canvas.h } : null };
  }
  const cap = [];
  for (const n of nhan) for (const b of badge) { const d = giao(n.rect, b.rect); if (d > 0) cap.push({ nhan: n.chu, nhanId: n.mayId, badge: b.t, px2: d, badgeTren: b.z >= n.z }); }
  const capNhanNhan = [];
  for (let i = 0; i < nhan.length; i += 1) for (let j = i + 1; j < nhan.length; j += 1) { const d = giao(nhan[i].rect, nhan[j].rect); if (d > 0) capNhanNhan.push({ a: nhan[i].chu, b: nhan[j].chu, px2: d }); }
  const cat = [];
  const VUNG = { "danh-sach-may": q("danh-sach-may"), "breadcrumb-twin": q("breadcrumb-twin"), "bang-kpi-noi": q("bang-kpi-noi"), "kpi-pham-vi": q("kpi-pham-vi"), "dai-hop-nhat": q("dai-hop-nhat"), "dai-canh-bao": q("dai-canh-bao"), "thanh-tren-line": q("thanh-tren-line"), "thanh-tren-may": q("thanh-tren-may"), "vien-tin-cay-may": q("vien-tin-cay-may"), "dai-suc-khoe": q("dai-suc-khoe") };
  for (const [ten, goc] of Object.entries(VUNG)) {
    if (!goc) continue;
    for (const el of [goc, ...goc.querySelectorAll("*")]) {
      if (!(el instanceof HTMLElement) || el.tagName === "CANVAS" || el.tagName === "SELECT") continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      if (!(cs.overflowX === "hidden" || cs.overflowX === "clip")) continue;
      if (!(cs.textOverflow === "ellipsis" || cs.whiteSpace === "nowrap")) continue;
      if (el.clientWidth === 0 || el.scrollWidth <= el.clientWidth + 1) continue;
      cat.push({ vung: ten, t: el.getAttribute("data-testid"), tag: el.tagName.toLowerCase(), chu: (el.textContent ?? "").trim().slice(0, 60), sw: el.scrollWidth, cw: el.clientWidth, title: el.getAttribute("title"), titleCha: el.closest("[title]")?.getAttribute("title") ?? null, aria: el.getAttribute("aria-label") });
    }
  }
  const sel = [...document.querySelectorAll("select")].filter(hien).map((s) => { const cs = getComputedStyle(s); const c = document.createElement("canvas").getContext("2d"); c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`; const txt = s.options[s.selectedIndex]?.text ?? ""; const w = c.measureText(txt).width; const cho = s.clientWidth - (parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + 18); return { t: s.getAttribute("data-testid"), chu: txt, chuPx: Math.round(w), choPx: Math.round(cho), biCat: w > cho }; });
  const hang = [...document.querySelectorAll('[data-testid^="may-hang-"]')].filter(hien).slice(0, 80).map((el) => { const sw = el.querySelector("span[class*='bg-'], div[class*='bg-'], svg"); return { t: el.getAttribute("data-testid"), tt: el.getAttribute("data-trang-thai"), chu: (el.textContent ?? "").trim().slice(0, 40), mau: sw ? getComputedStyle(sw).backgroundColor : null, mauChu: sw ? getComputedStyle(sw).color : null, cls: (sw?.className?.toString() ?? "").slice(0, 70) }; });
  const sk = q("suc-khoe-may");
  return {
    url: location.href, lang: document.documentElement.lang,
    soCanvas: window.__soCanvas ?? null, canvasDom: document.querySelectorAll("canvas").length, canvas,
    calls: window.__thongKeVe?.calls ?? null, triangles: window.__thongKeVe?.triangles ?? null, matContext: window.__thongKeVe?.matContext ?? null,
    soNhanDom: nhan.length, soBadgeDom: badge.length, soChip: chip.length,
    nhan, badge, chip, lop,
    capNhanBadge: cap, soCap: cap.length, tongPx2: cap.reduce((a, c) => a + c.px2, 0),
    capNhanNhan, soCapNhanNhan: capNhanNhan.length, tongPx2NhanNhan: capNhanNhan.reduce((a, c) => a + c.px2, 0),
    nhanNgoaiCanvas: nhan.filter((n) => !n.trongCanvas).map((n) => ({ chu: n.chu, rect: n.rect })),
    badgeNgoaiCanvas: badge.filter((b) => !b.trongCanvas).map((b) => ({ t: b.t, rect: b.rect })),
    chipNgoaiCanvas: chip.filter((c) => !c.trongCanvas).map((c) => ({ t: c.t, rect: c.rect })),
    cat, sel, hang,
    demNhan: window.__demNhan ?? null, demBadge: window.__demBadge ?? null,
    tran: { docW: document.documentElement.scrollWidth, innerW: innerWidth, bodyW: document.body.scrollWidth, docH: document.documentElement.scrollHeight, innerH: innerHeight, tranNgang: document.documentElement.scrollWidth > innerWidth || document.body.scrollWidth > innerWidth },
    demMay: q("dem-may")?.textContent?.trim() ?? null,
    breadcrumb: q("breadcrumb-twin")?.innerText?.replace(/\s*\n+\s*/g, " › ") ?? null,
    kpi: q("bang-kpi-noi")?.innerText?.replace(/\s*\n+\s*/g, " | ").slice(0, 300) ?? null,
    sucKhoeMay: sk ? { hang: sk.getAttribute("data-hang"), chu: sk.textContent.trim().slice(0, 60), color: getComputedStyle(sk).color } : null,
    soHopKhoi: window.__demNhan?.soHopKhoi ?? null,
  };
};

const DEM_KHUNG = (ms) => new Promise((res) => { let n = 0; let a = window.__thongKeVe; const id = setInterval(() => { const b = window.__thongKeVe; if (b !== a) { n += 1; a = b; } }, 10); setTimeout(() => { clearInterval(id); res({ ms, khung: n, coBoDem: a !== undefined }); }, ms); });

async function moMan(browser, ck, vp, man, opt) {
  const { lang = null } = opt || {};
  const [W, H] = vp.split("x").map(Number);
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.addCookies(ck);
  if (lang) await ctx.addInitScript((l) => { try { localStorage.setItem("i18nextLng", l); } catch (e) { /* noop */ } }, lang);
  await ctx.addInitScript(() => { window.__lt = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push({ t: Math.round(e.startTime), d: Math.round(e.duration) }); }).observe({ type: "longtask", buffered: true }); } catch (e) { /* noop */ } });
  const page = await ctx.newPage();
  const loi = []; const req400 = [];
  page.on("console", (m) => { if (m.type() === "error") loi.push(m.text().slice(0, 160)); });
  page.on("response", (r) => { if (r.status() >= 400) req400.push(`${r.status()} ${r.url().replace(BASE, "").slice(0, 120)}`); });
  const t0 = Date.now();
  const r = { duong: man.duong, tid: man.tid, vp, lang };
  try { await page.goto(`${BASE}${man.duong}`, { waitUntil: "domcontentloaded", timeout: 60000 }); r.msGoto = Date.now() - t0; } catch (e) { r.gotoLoi = String(e.message).split("\n")[0].slice(0, 140); r.msGoto = Date.now() - t0; }
  try { await page.waitForSelector(`[data-testid="${man.tid}"]`, { state: "visible", timeout: 60000 }); r.msToiMan = Date.now() - t0; } catch (e) { r.msToiMan = null; }
  try { await page.waitForFunction(() => (window.__thongKeVe?.calls ?? 0) > 0, null, { timeout: 90000 }); r.msKhungDau = Date.now() - t0; } catch (e) { r.msKhungDau = null; }
  if (await page.locator('[data-testid="may-dang-tai"]').count() > 0) {
    try { await page.waitForFunction(() => document.querySelectorAll('[data-testid="may-dang-tai"]').length === 0, null, { timeout: 60000 }); r.msDangTaiHet = Date.now() - t0; } catch (e) { r.msDangTaiHet = null; }
  } else r.msDangTaiHet = "khong-co-o";
  r.loiConsole = loi.slice(0, 6); r.soLoiConsole = loi.length; r.req400 = req400.slice(0, 6);
  return { ctx, page, r, t0 };
}

const browser = await chromium.launch(GPU ? { args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"] } : {});
const kq = { ca: TAG, gpu: GPU, base: BASE, luc: new Date().toISOString(), soWorker: SO_WORKER, tangDong: TANG_DONG, ghiChuNen: "nền .qa-tapdoan/nhip.sh làm tươi heartbeat mỗi 45 s (1 tiến trình node, ~1.108 hàng UPDATE mỗi chu kỳ) — ĐANG CHẠY trong mọi phép đo dưới đây; không tắt được vì thiếu nó mọi máy chuyển xám sau 5 phút (PH-04)" };
try {
  const tk = arg("tk", "qatd_kythuat");
  kq.taiKhoan = tk;
  const ck = await layCookie(browser, tk);
  { const c0 = await browser.newContext(); const p0 = await c0.newPage(); kq.gl = await p0.evaluate(() => { const cv = document.createElement('canvas'); const g = cv.getContext('webgl2') || cv.getContext('webgl'); const d = g?.getExtension('WEBGL_debug_renderer_info'); return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : (g ? g.getParameter(g.RENDERER) : null); }); await c0.close(); console.log(`  GL = ${kq.gl}`); }

  if (CA === "F1") {
    kq.luot = [];
    for (const vp of VPS) for (let i = 1; i <= LUOT; i += 1) for (const [ten, man] of Object.entries(MAN)) {
      const { ctx, page, r } = await moMan(browser, ck, vp, man);
      r.man = ten; r.luot = i;
      try {
        const nav = await page.evaluate(() => { const n = performance.getEntriesByType("navigation")[0]; return n ? { dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), ttfb: Math.round(n.responseStart) } : null; });
        Object.assign(r, nav || {});
        const lt = await page.evaluate(() => window.__lt ?? []);
        r.ltSo = lt.length; r.ltTongMs = lt.reduce((s, x) => s + x.d, 0); r.ltMaxMs = lt.reduce((s, x) => Math.max(s, x.d), 0);
        const tkk = await page.evaluate(() => ({ soCanvas: window.__soCanvas ?? null, calls: window.__thongKeVe?.calls ?? null, tri: window.__thongKeVe?.triangles ?? null, soNhan: document.querySelectorAll('[data-testid="nhan-may-twin3d"]').length, soHopKhoi: window.__demNhan?.soHopKhoi ?? null }));
        Object.assign(r, tkk);
      } catch (e) { r.loi = String(e.message).slice(0, 160); }
      kq.luot.push(r);
      console.log(`  [${vp} lượt ${i}] ${ten.padEnd(7)} goto ${r.msGoto} · MÀN ${r.msToiMan ?? "KHÔNG"} ms · khung đầu ${r.msKhungDau ?? "KHÔNG"} ms · dangTai ${r.msDangTaiHet} · dcl ${r.dcl} ttfb ${r.ttfb} · lt ${r.ltSo}/${r.ltTongMs}/${r.ltMaxMs} · canvas ${r.soCanvas} calls ${r.calls} tri ${r.tri} nhãn ${r.soNhan} khối ${r.soHopKhoi} · errCon ${r.soLoiConsole}`);
      await ctx.close();
    }
    kq.tomTat = {};
    for (const vp of VPS) for (const ten of Object.keys(MAN)) {
      const ds = kq.luot.filter((x) => x.vp === vp && x.man === ten);
      for (const moc of ["msToiMan", "msKhungDau"]) {
        const xs = ds.map((x) => x[moc]);
        const co = xs.filter((x) => x != null);
        kq.tomTat[`${ten}-${vp}-${moc}`] = { so: xs, p50: pct(xs, 50), p90: pct(xs, 90), max: co.length ? Math.max(...co) : null, thieu: xs.length - co.length };
      }
    }
    kq.vuot2500 = kq.luot.filter((x) => x.msToiMan == null || x.msToiMan > 2500).map((x) => ({ man: x.man, vp: x.vp, luot: x.luot, msToiMan: x.msToiMan }));
    console.log(`\n=== F1: ${kq.luot.length} lượt · lượt msToiMan > 2500 ms hoặc KHÔNG tới: ${kq.vuot2500.length} ===`);
    for (const [k, v] of Object.entries(kq.tomTat)) console.log(`   ${k.padEnd(40)} p50 ${v.p50} · p90 ${v.p90} · max ${v.max} · [${v.so.join(", ")}]`);
  }

  if (CA === "F2") {
    kq.canh = [];
    const CANH = [
      { ten: "twin-tang-dong", man: MAN.twin, ghi: "tầng 68 máy" },
      { ten: "twin-pv-tapdoan", man: { duong: "/twin?pv=tapdoan", tid: "man-twin-van-hanh" }, ghi: "phạm vi tập đoàn (PH-10: bị hạ xuống 1 nhà máy)" },
      { ten: "line-217", man: MAN.line, ghi: "line 217" },
      { ten: "may-4197", man: MAN.may, ghi: "máy 4197" },
      { ten: "studio", man: MAN.studio, ghi: "studio" },
    ];
    for (const vp of VPS) for (const c of CANH) {
      const { ctx, page, r } = await moMan(browser, ck, vp, c.man);
      r.ten = c.ten; r.ghi = c.ghi;
      await page.waitForTimeout(7000);
      try { Object.assign(r, await page.evaluate(DO_CANH, c.man.tid)); } catch (e) { r.loi = String(e.message).slice(0, 160); }
      await page.waitForTimeout(1500);
      try { Object.assign(r, await page.evaluate(() => ({ calls2: window.__thongKeVe?.calls ?? null, tri2: window.__thongKeVe?.triangles ?? null }))); } catch (e) { /* noop */ }
      kq.canh.push(r);
      console.log(`  [${vp}] ${c.ten.padEnd(18)} __soCanvas ${r.soCanvas} (DOM ${r.canvasDom}) · draw ${r.calls}/${r.calls2} · tam giác ${r.triangles}/${r.tri2} · nhãn DOM ${r.soNhanDom} (badge ${r.soBadgeDom}) · khối ${r.soHopKhoi} · demMay ${r.demMay}`);
      await page.screenshot({ path: `${ANH}/F-${TAG}-${c.ten}-${vp}.png` }).catch(() => {});
      await ctx.close();
    }
  }

  if (CA === "F3") {
    kq.fps = [];
    for (const vp of VPS.slice(0, 1)) {
      const { ctx, page, r } = await moMan(browser, ck, vp, MAN.twin);
      await page.waitForTimeout(6000);
      const sel = `[data-testid="${MAN.twin.tid}"] canvas`;
      const box = await page.locator(sel).boundingBox();
      const imA = await page.evaluate(DEM_KHUNG, 4000);
      const X = box.x + box.width / 2; const Y = box.y + box.height / 2;
      const demKeo = page.evaluate(DEM_KHUNG, 4000);
      const tKeo0 = Date.now();
      await page.mouse.move(X, Y, { steps: 2 });
      await page.mouse.down();
      for (let i = 1; i <= 40; i += 1) { await page.mouse.move(X + Math.round(Math.sin(i / 6) * 140), Y + Math.round(i * 1.4), { steps: 1 }); await page.waitForTimeout(16); }
      await page.mouse.up();
      const msKeo = Date.now() - tKeo0;
      const keo = await demKeo;
      const imB = await page.evaluate(DEM_KHUNG, 4000);
      r.vp = vp; r.imTruoc = imA; r.keo = keo; r.imSau = imB; r.msKeo = msKeo;
      r.fpsKeo = +(keo.khung / (keo.ms / 1000)).toFixed(1);
      r.fpsTrongLucKeo = +(keo.khung / (msKeo / 1000)).toFixed(1);
      r.fpsIm = +(imA.khung / (imA.ms / 1000)).toFixed(1);
      Object.assign(r, await page.evaluate(DO_CANH, MAN.twin.tid));
      kq.fps.push(r);
      console.log(`  [${vp}] IM 4 s ${imA.khung} khung (${r.fpsIm} FPS) · KÉO 40 bước (${msKeo} ms) trong cửa sổ 4 s: ${keo.khung} khung ⇒ ${r.fpsKeo} FPS/4s · ${r.fpsTrongLucKeo} FPS trong lúc kéo · IM lại ${imB.khung} khung`);
      await page.screenshot({ path: `${ANH}/F-${TAG}-sau-keo-${vp}.png` }).catch(() => {});
      await ctx.close();
    }
  }

  if (CA === "F4") {
    kq.dep = [];
    const CANH = [{ ten: "twin-tang-dong", man: MAN.twin }, { ten: "line-217", man: MAN.line }, { ten: "may-4197", man: MAN.may }, { ten: "studio", man: MAN.studio }];
    for (const vp of VPS) for (const c of CANH) {
      const { ctx, page, r } = await moMan(browser, ck, vp, c.man);
      r.ten = c.ten;
      await page.waitForTimeout(7000);
      try { Object.assign(r, await page.evaluate(DO_CANH, c.man.tid)); } catch (e) { r.loi = String(e.message).slice(0, 160); }
      kq.dep.push(r);
      const L = Object.entries(r.lop || {}).map(([k, v]) => `${k}=${v ? JSON.stringify(v.lech) : "—"}`).join(" ");
      console.log(`  [${vp}] ${c.ten.padEnd(16)} ${L} · nhãn ngoài ${r.nhanNgoaiCanvas?.length} badge ngoài ${r.badgeNgoaiCanvas?.length} chip ngoài ${r.chipNgoaiCanvas?.length} · cặp badge×nhãn ${r.soCap} (${r.tongPx2} px²) · cặp nhãn×nhãn ${r.soCapNhanNhan} (${r.tongPx2NhanNhan} px²) · cắt chữ ${r.cat?.length} · select cắt ${r.sel?.filter((s) => s.biCat).length} · tràn ngang ${r.tran?.tranNgang} (doc ${r.tran?.docW}/${r.tran?.innerW})`);
      if ((r.cat || []).length) for (const x of r.cat.slice(0, 10)) console.log(`        cắt: ${x.vung}/${x.t ?? x.tag} "${x.chu}" sw ${x.sw} > cw ${x.cw}${x.title || x.titleCha ? " (có title)" : " (KHÔNG title)"}`);
      await page.screenshot({ path: `${ANH}/F-${TAG}-${c.ten}-${vp}.png` }).catch(() => {});
      await ctx.close();
    }
  }

  if (CA === "F7") {
    kq.idle = [];
    const { ctx, page, r } = await moMan(browser, ck, "1600x900", MAN.twin);
    await page.waitForTimeout(8000);
    const i40 = await page.evaluate(DEM_KHUNG, 40000);
    const sel = `[data-testid="${MAN.twin.tid}"] canvas`;
    const box = await page.locator(sel).boundingBox();
    const dem = page.evaluate(DEM_KHUNG, 4000);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 2 });
    await page.mouse.down();
    for (let i = 1; i <= 10; i += 1) { await page.mouse.move(box.x + box.width / 2 + i * 9, box.y + box.height / 2 + i * 3, { steps: 1 }); await page.waitForTimeout(16); }
    await page.mouse.up();
    const sau = await dem;
    r.idle40s = i40; r.chamSau = sau;
    Object.assign(r, await page.evaluate(DO_CANH, MAN.twin.tid));
    kq.idle.push(r);
    console.log(`  IDLE 40 s: ${i40.khung} khung (bộ đếm ${i40.coBoDem}) · ĐỐI CHỨNG DƯƠNG chạm 4 s: ${sau.khung} khung`);
    await page.screenshot({ path: `${ANH}/F-${TAG}-sau-idle40s.png` }).catch(() => {});
    await ctx.close();
  }

  if (CA === "F6") {
    kq.i18n = [];
    for (const lang of ["en", "zh", "vi"]) {
      const { ctx, page, r } = await moMan(browser, ck, "1600x900", MAN.twin, { lang });
      await page.waitForTimeout(7000);
      r.langYeuCau = lang;
      try {
        Object.assign(r, await page.evaluate(DO_CANH, MAN.twin.tid));
        r.chu = await page.evaluate(() => {
          const lay = (t) => document.querySelector(`[data-testid="${t}"]`)?.innerText?.replace(/\s*\n+\s*/g, " | ").trim() ?? null;
          const man = document.querySelector('[data-testid="man-twin-van-hanh"]');
          const het = man ? man.innerText.replace(/\s*\n+\s*/g, " | ") : "";
          const DAU = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđĂÂÊÔƠƯĐÀÁẢÃẠÈÉẺẼẸÌÍÒÓÔÙÚ]/g;
          return {
            i18nLang: window.localStorage.getItem("i18nextLng"), htmlLang: document.documentElement.lang,
            breadcrumb: lay("breadcrumb-twin"), kpi: lay("bang-kpi-noi"), chipAn: lay("chip-nhan-bi-an"), demMay: lay("dem-may"),
            daiCanhBao: (lay("dai-canh-bao") || "").slice(0, 200), boChon: [...document.querySelectorAll("select")].map((s) => `${s.getAttribute("data-testid")}=${s.options[s.selectedIndex]?.text}`),
            nhan3d: [...document.querySelectorAll('[data-testid="nhan-may-twin3d"]')].map((e) => e.textContent.trim()).slice(0, 8),
            hetMan: het.slice(0, 4000),
            khoaTho: (het.match(/\b(twin3d|common|nav|machine|factory)\.[A-Za-z0-9_.]{2,}/g) || []).slice(0, 20),
            soDau: (het.match(DAU) || []).length,
            tuCoDau: [...new Set((het.match(/[0-9A-Za-zÀ-ỹ]*[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđĂÂÊÔƠƯĐ][0-9A-Za-zÀ-ỹ]*/g) || []))].slice(0, 40),
          };
        });
      } catch (e) { r.loi = String(e.message).slice(0, 160); }
      kq.i18n.push(r);
      console.log(`  lang=${lang} → html "${r.chu?.htmlLang}" ls "${r.chu?.i18nLang}" · số dấu Việt ${r.chu?.soDau} · khoá thô ${r.chu?.khoaTho?.length} ${JSON.stringify(r.chu?.khoaTho?.slice(0, 5) ?? [])}`);
      console.log(`      từ có dấu: ${JSON.stringify((r.chu?.tuCoDau || []).slice(0, 16))}`);
      console.log(`      breadcrumb "${r.chu?.breadcrumb}" · kpi "${(r.chu?.kpi || "").slice(0, 140)}"`);
      await page.screenshot({ path: `${ANH}/F-${TAG}-twin-${lang}.png` }).catch(() => {});
      await ctx.close();
    }
  }
} finally {
  ghi(TAG, kq);
  await browser.close();
}
