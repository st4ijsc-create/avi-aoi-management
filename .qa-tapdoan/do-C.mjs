/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * QA LẦN 11 · LÔ C — KẾT CỤC GỐC: "từ nhà máy chọn Line ⇒ Line 3D Twin; chọn máy ⇒ Machine 3D"
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * Khuôn: `.qa-dot52/k9-chon-line.mjs` (đi qua CÂY PHÂN CẤP, bung bằng nút mũi tên = đường người
 * dùng thật, G123) + `.qa-dot52/k8.mjs` (bấm TÂM KHỐI máy trên canvas, đo LẠI tâm ngay trước cú
 * bấm) + `.qa-dot59/do59.mjs` (L1 FAIL-CLOSED: mỗi ca khai TÊN dữ kiện; thiếu ⇒ HỎNG kèm tên.
 * L2 ĐỌC THEO NGHĨA: chữ người dùng đọc được, testid chỉ để TÌM).
 *
 * Dùng: node .qa-tapdoan/do-C.mjs --ca=C1|C2|C3|C4|C5|C6|C7|all [--base=http://localhost:3064]
 * Ra:   .qa-tapdoan/tho/C/<ca>-<vai>.json  (ghi .tmp rồi rename — G129/130)
 *       .qa-tapdoan/anh/C-*.png
 */
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";

const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? m.slice(k.length + 3) : d; };
const BASE = arg("base", "http://localhost:3064");
const CA = arg("ca", "all");
const VP = { width: Number(arg("w", "1600")), height: Number(arg("h", "900")) };
const THO = ".qa-tapdoan/tho/C";
const ANH = ".qa-tapdoan/anh";
mkdirSync(THO, { recursive: true }); mkdirSync(ANH, { recursive: true });

const MK = "Qatd!2026";
const VAI = {
  qatd_kythuat: { pham: "QATD-A(38)+QATD-B(39)" },
  qatd_congnhan: { pham: "QATD-C(40)" },
  qatd_quanly: { pham: "QATD-A(38)" },
  qatd_admin: { pham: "tất cả" },
  qatd_giamdoc: { pham: "QATD-A(38)+QATD-B(39)+QATD-C(40) qua gán TẬP ĐOÀN" },
};

/* ── ghi thô nguyên tử ────────────────────────────────────────────────────── */
function luu(ten, obj) {
  const p = `${THO}/${ten}.json`;
  writeFileSync(`${p}.tmp`, JSON.stringify({ luc: new Date().toISOString(), base: BASE, vp: VP, ...obj }, null, 1));
  renameSync(`${p}.tmp`, p);
  return p;
}

/* ── kỳ vọng từ DB (đo rời bằng .qa-tapdoan/db-C.mjs) ─────────────────────── */
const DB = JSON.parse(readFileSync(`${THO}/db-C.json`, "utf8"));
const lineDb = (id) => DB.line.find((r) => r.lineId === id) ?? null;
const mayDb = (id) => DB.may.find((r) => r.id === id) ?? null;

/* ── đăng nhập (cookie cache) ─────────────────────────────────────────────── */
async function dangNhap(ctx, u) {
  const f = `${THO}/state-${u}.json`;
  const ai = async () => { const r = await ctx.request.get(`${BASE}/api/trpc/auth.me`); try { return JSON.parse(await r.text())?.result?.data?.json?.username ?? null; } catch { return null; } };
  if (existsSync(f)) { await ctx.addCookies(JSON.parse(readFileSync(f, "utf8"))); if ((await ai()) === u) return "cache"; await ctx.clearCookies(); }
  const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: u, password: MK } });
  const ten = await ai();
  if (r.status() !== 200 || ten !== u) throw new Error(`đăng nhập thất bại ${u}: login=${r.status()} me=${ten}`);
  writeFileSync(f, JSON.stringify(await ctx.cookies()));
  return "mới";
}
async function trpc(ctx, proc, input) {
  const u = `${BASE}/api/trpc/${proc}` + (input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`);
  const r = await ctx.request.get(u);
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* không JSON */ }
  /* ⚠ superjson: `result.data = {json:null, meta:{values:["undefined"]}}` là "KHÔNG CÓ" hợp lệ.
     `??` sẽ nhảy sang chính cái bọc và biến `null` thành một object TRUTHY — đúng lớp lỗi
     "`??` vá một lỗ ĐỌC" mà do59 L1 cấm. Xét CÓ KHOÁ `json` hay không, không xét giá trị. */
  const boc = j?.result?.data;
  return {
    http: r.status(),
    data: boc && typeof boc === "object" && "json" in boc ? boc.json : (boc ?? null),
    ma: j?.error?.json?.data?.code ?? j?.error?.data?.code ?? null,
    loi: (j?.error?.json?.message ?? j?.error?.message ?? null)?.slice(0, 160) ?? null,
  };
}

/* ── ĐỌC MÀN THEO NGHĨA (L2) ──────────────────────────────────────────────── */
const DOC_TRANG = () => {
  const el = (t) => document.querySelector(`[data-testid="${t}"]`);
  const chu = (t) => { const e = el(t); return e ? (e.innerText || e.textContent || "").replace(/\s+/g, " ").trim() : null; };
  const dem = (t) => document.querySelectorAll(`[data-testid="${t}"]`).length;
  const so = (s) => { if (s == null) return null; const m = s.match(/(-?\d+)\s*$/); return m ? Number(m[1]) : null; };
  const manLine = el("man-twin-line"), manMay = el("man-twin-may"), manVh = el("man-twin-van-hanh");
  const oChon = (t) => { const e = el(t); return e ? { soMuc: Number(e.getAttribute("data-so-muc")), value: e.value, nhanDangChon: [...e.options].find((o) => o.value === e.value)?.textContent?.trim() ?? null } : null; };
  return {
    url: location.pathname + location.search,
    trang: { man_van_hanh: dem("man-twin-van-hanh"), man_line: dem("man-twin-line"), man_may: dem("man-twin-may") },
    line: manLine ? {
      tenLine: chu("ten-line"),
      demMayChu: chu("dem-may-line"), demMaySo: so(chu("dem-may-line")),
      demTramChu: chu("dem-tram-line"), demTramSo: so(chu("dem-tram-line")),
      wipChu: chu("tong-wip-line"), wipSo: so(chu("tong-wip-line")),
      lineRong: dem("line-rong"), lineRongChu: chu("line-rong"),
      khongMoDuoc: dem("line-khong-mo-duoc"), lyDo: el("line-khong-mo-duoc")?.getAttribute("data-ly-do") ?? null, khongMoChu: chu("line-khong-mo-duoc"),
      idKhongHopLe: dem("line-id-khong-hop-le"), idKhongHopLeChu: chu("line-id-khong-hop-le"),
      canvasTrongMan: manLine.querySelectorAll("canvas").length,
      soNhanMay: manLine.querySelectorAll('[data-testid="nhan-may-twin3d"]').length,
      soOTram: [...manLine.querySelectorAll('[data-testid^="o-tram-"]')].filter((e) => !e.getAttribute("data-testid").startsWith("o-tram-wip")).length,
      daiLine: dem("dai-line"),
      veNhaMayHref: el("ve-man-nha-may")?.getAttribute("href") ?? null,
    } : null,
    may: manMay ? {
      tenMay: chu("ten-may"),
      loaiMay: chu("loai-may"),
      sucKhoeChu: chu("suc-khoe-may"), sucKhoeHang: el("suc-khoe-may")?.getAttribute("data-hang") ?? null,
      khoiCanhMay: dem("khoi-canh-may"), canvasTrongKhoiCanh: el("khoi-canh-may")?.querySelectorAll("canvas").length ?? null,
      chuaDatCho: dem("may-chua-dat-cho"), chuaDatChoChu: chu("may-chua-dat-cho"),
      khongMoDuoc: dem("may-khong-mo-duoc"), lyDo: el("may-khong-mo-duoc")?.getAttribute("data-ly-do") ?? null, khongMoChu: chu("may-khong-mo-duoc"),
      dangTai: dem("may-dang-tai"),
      veManLine: dem("ve-man-line"), veManLineChu: chu("ve-man-line"), veManLineHref: el("ve-man-line")?.getAttribute("href") ?? null,
      veNhaMayHref: el("ve-man-nha-may")?.getAttribute("href") ?? null,
      canvasTrongMan: manMay.querySelectorAll("canvas").length,
    } : null,
    vanHanh: manVh ? {
      oNhaMay: oChon("chon-nha-may"), oToaNha: oChon("chon-toa-nha"), oTang: oChon("chon-tang"),
      demMay: chu("dem-may"),
      canvasTrongMan: manVh.querySelectorAll("canvas").length,
    } : null,
    /* ★ `line-id-khong-hop-le` nằm NGOÀI bọc `man-twin-line` (TwinLine.tsx:223, return sớm) ⇒
       phải đọc ở cấp trang, nếu không ca C7 báo "thiếu dữ kiện" cho một sản phẩm ĐÚNG. */
    lineIdKhongHopLe: dem("line-id-khong-hop-le"),
    lineIdKhongHopLeChu: chu("line-id-khong-hop-le"),
    soCanvasKit: window.__soCanvas === undefined ? null : window.__soCanvas,
    canvasDom: document.querySelectorAll("canvas").length,
    veCalls: window.__thongKeVe?.calls ?? null,
    spin: document.querySelectorAll(".animate-spin").length,
    thanTrangDai: (document.body.innerText || "").replace(/\s+/g, " ").trim().length,
  };
};
const doc = (page) => page.evaluate(DOC_TRANG);

/* ── động cơ phán quyết FAIL-CLOSED (khuôn do59 L1) ───────────────────────── */
function phan(can, kiem) {
  const thieu = Object.entries(can).filter(([, v]) => v === null || v === undefined).map(([k]) => k);
  if (thieu.length) return { pq: "HỎNG", vi: `thiếu dữ kiện: ${thieu.join(", ")}`, thieu };
  const sai = kiem.filter((k) => !k.ok);
  if (sai.length) return { pq: "SAI", vi: sai.map((k) => `${k.ten}: ${k.thay}`).join(" · "), sai: sai.map((k) => k.ten) };
  return { pq: "ĐẠT", vi: kiem.map((k) => `${k.ten} ✓`).join(" · ") };
}

/* ── chờ cảnh sẵn sàng ────────────────────────────────────────────────────── */
async function moTwin(page, qs) {
  await page.goto(`${BASE}/twin?${qs}`, { waitUntil: "domcontentloaded" });
  const coCanvas = await page.waitForSelector('[data-testid="man-twin-van-hanh"] canvas', { timeout: 120_000 }).then(() => true).catch(() => false);
  await page.waitForFunction(() => (window.__demTuongTac?.dsMay?.() ?? []).some((m) => m.trongKhung), null, { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(3_000);
  return coCanvas;
}
async function bungCay(page, vong = 6) {
  if (await page.locator('[data-testid="mo-cay-phan-cap"]').count()) {
    await page.locator('[data-testid="mo-cay-phan-cap"]').click();
    await page.waitForTimeout(1_200);
  }
  for (let i = 0; i < vong; i++) {
    const n = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="node-cay-"]')].filter((e) => e.getAttribute("aria-expanded") === "false").map((e) => e.getAttribute("data-testid")));
    if (!n.length) break;
    for (const tid of n) { const b = page.locator(`[data-testid="${tid}"] button`).first(); if (await b.count()) { await b.click().catch(() => {}); await page.waitForTimeout(140); } }
  }
  await page.waitForTimeout(600);
  return page.evaluate(() => [...document.querySelectorAll('[data-testid^="node-cay-"]')].map((e) => ({ tid: e.getAttribute("data-testid"), chu: (e.textContent || "").replace(/\s+/g, " ").trim().slice(0, 48) })));
}
async function choLineVeXong(page) {
  const t0 = Date.now();
  await page.waitForSelector('[data-testid="man-twin-line"]', { timeout: 60_000 }).catch(() => {});
  await page.waitForFunction(() => {
    const m = document.querySelector('[data-testid="man-twin-line"]');
    if (!m) return false;
    return m.querySelectorAll("canvas").length >= 1 || !!document.querySelector('[data-testid="line-rong"]') || !!document.querySelector('[data-testid="line-khong-mo-duoc"]') || !!document.querySelector('[data-testid="line-id-khong-hop-le"]');
  }, null, { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(4_500);
  return Date.now() - t0;
}
async function choMayVeXong(page) {
  const t0 = Date.now();
  await page.waitForSelector('[data-testid="man-twin-may"]', { timeout: 60_000 }).catch(() => {});
  await page.waitForFunction(() => {
    const m = document.querySelector('[data-testid="man-twin-may"]');
    if (!m) return false;
    if (document.querySelector('[data-testid="may-khong-mo-duoc"]')) return true;
    return m.querySelectorAll("canvas").length >= 1 && document.querySelectorAll('[data-testid="may-dang-tai"]').length === 0;
  }, null, { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(4_000);
  return Date.now() - t0;
}
const anh = async (page, ten) => { const p = `${ANH}/C-${ten}.png`; await page.screenshot({ path: p }); return p; };
const GHI = [];
const bao = (ca, vai, pq, vi) => { GHI.push({ ca, vai, pq, vi }); console.log(`  ${String(pq).padEnd(11)} ${ca} · ${vai} · ${vi}`); };

/* ══════════════════════════════════════════════════════════════════════════ */
/* C1 — LINE QUA CÂY PHÂN CẤP                                                 */
/* ══════════════════════════════════════════════════════════════════════════ */
async function c1(browser, { vai, facId, toaId, tangId, lineId, nhan }) {
  const ctx = await browser.newContext({ viewport: VP });
  await ctx.addInitScript(() => { try { localStorage.setItem("i18nextLng", "vi"); } catch { /* */ } });
  const me = await dangNhap(ctx, vai);
  const page = await ctx.newPage();
  const ky = lineDb(lineId);
  const r = { ca: "C1", vai, me, deBai: `qua CÂY PHÂN CẤP trên /twin, bung tới line ${lineId} (${nhan}) rồi BẤM ⇒ /twin/line/${lineId} với tên/đếm máy/đếm trạm đúng DB`, kyVongDb: ky, duongBam: [] };
  try {
    r.duongBam.push("goto /twin?do=1");
    await moTwin(page, "do=1");
    r.truocChon = (await doc(page)).vanHanh;
    await page.selectOption('[data-testid="chon-nha-may"]', String(facId)); r.duongBam.push(`selectOption chon-nha-may=${facId}`);
    await page.waitForTimeout(2_500);
    await page.waitForFunction((v) => { const e = document.querySelector('[data-testid="chon-toa-nha"]'); return e && [...e.options].some((o) => o.value === v); }, String(toaId), { timeout: 60_000 }).catch(() => {});
    await page.selectOption('[data-testid="chon-toa-nha"]', String(toaId)); r.duongBam.push(`selectOption chon-toa-nha=${toaId}`);
    await page.waitForTimeout(2_000);
    await page.waitForFunction((v) => { const e = document.querySelector('[data-testid="chon-tang"]'); return e && [...e.options].some((o) => o.value === v); }, String(tangId), { timeout: 60_000 }).catch(() => {});
    await page.selectOption('[data-testid="chon-tang"]', String(tangId)); r.duongBam.push(`selectOption chon-tang=${tangId}`);
    await page.waitForTimeout(4_000);
    await page.waitForFunction(() => (window.__demTuongTac?.dsMay?.() ?? []).some((m) => m.trongKhung), null, { timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(2_000);
    r.sauChon = (await doc(page)).vanHanh;
    r.anhTwin = await anh(page, `C1-${vai}-line${lineId}-truoc-twin`);
    const nodes = await bungCay(page); r.duongBam.push("click mo-cay-phan-cap + bung mũi tên");
    r.soNode = nodes.length;
    r.nodeLineCoTrongCay = nodes.filter((n) => /^node-cay-line:/.test(n.tid)).map((n) => n.tid);
    r.soNodeLine = r.nodeLineCoTrongCay.length;
    const tid = `node-cay-line:${lineId}`;
    r.coNodeDich = nodes.some((n) => n.tid === tid);
    if (!r.coNodeDich) throw new Error(`cây KHÔNG có node ${tid} (có: ${r.nodeLineCoTrongCay.slice(0, 12).join(", ")})`);
    r.chuNodeDich = nodes.find((n) => n.tid === tid).chu;
    await page.locator(`[data-testid="${tid}"]`).click(); r.duongBam.push(`click ${tid} ("${r.chuNodeDich}")`);
    r.toiUrl = await page.waitForURL(new RegExp(`/twin/line/${lineId}(\\?|$)`), { timeout: 8_000 }).then(() => true).catch(() => false);
    r.msVe = await choLineVeXong(page);
    r.thay = await doc(page);
    r.anh = await anh(page, `C1-${vai}-line${lineId}`);
    const L = r.thay.line;
    const p = phan(
      { "URL /twin/line/:id": r.toiUrl ? true : null, "man-twin-line": L, "ten-line (chữ)": L?.tenLine || null, "dem-may-line (số)": L?.demMaySo, "dem-tram-line (số)": L?.demTramSo, "tong-wip-line (số)": L?.wipSo, "canvas trong màn": L?.canvasTrongMan, "kỳ vọng DB": ky },
      [
        { ten: `URL = /twin/line/${lineId}`, ok: new URL(`${BASE}${r.thay.url}`).pathname === `/twin/line/${lineId}`, thay: r.thay.url },
        { ten: `ten-line = "${ky?.lineName}" (DB)`, ok: (L?.tenLine ?? "") === ky?.lineName, thay: `thấy "${L?.tenLine}"` },
        { ten: `dem-may-line = ${ky?.soMay} (DB)`, ok: L?.demMaySo === Number(ky?.soMay), thay: `thấy "${L?.demMayChu}"` },
        { ten: `dem-tram-line = ${ky?.soTram} (DB)`, ok: L?.demTramSo === Number(ky?.soTram), thay: `thấy "${L?.demTramChu}"` },
        { ten: "tong-wip-line có số", ok: Number.isFinite(L?.wipSo), thay: `thấy "${L?.wipChu}"` },
        { ten: "canvas 3D (1 kit)", ok: (L?.canvasTrongMan ?? 0) >= 1 && r.thay.soCanvasKit === 1, thay: `canvas ${L?.canvasTrongMan} / __soCanvas ${r.thay.soCanvasKit}` },
        /* ★ Đợt này (QA11) — "hiển thị Line 3D Twin" nghĩa là MÁY ĐƯỢC VẼ, không phải "có một canvas".
           Line 299 (toà thứ ba) có header "Máy 10 · Trạm 10" mà cảnh 0 khối máy ⇒ tiêu chí cũ XANH OAN. */
        { ten: `khối máy VẼ trên cảnh (nhãn máy = ${ky?.soMay} máy DB)`, ok: (L?.soNhanMay ?? 0) === Number(ky?.soMay), thay: `nhãn máy trên cảnh ${L?.soNhanMay} / DB ${ky?.soMay} · ô trạm ${L?.soOTram} · dải line ${L?.daiLine}` },
        { ten: "KHÔNG line-rong / line-khong-mo-duoc", ok: (L?.lineRong ?? 1) === 0 && (L?.khongMoDuoc ?? 1) === 0, thay: `line-rong ${L?.lineRong} · khong-mo-duoc ${L?.khongMoDuoc} (lý do "${L?.lyDo}") chữ: "${(L?.lineRongChu || L?.khongMoChu || "").slice(0, 150)}"` },
      ],
    );
    Object.assign(r, p);
  } catch (e) {
    r.loi = String(e).slice(0, 400); r.pq = "HỎNG"; r.vi = `HỎNG ${r.loi}`;
    try { r.thay = await doc(page); r.anh = await anh(page, `C1-${vai}-line${lineId}-HONG`); } catch { /* */ }
  }
  bao("C1", vai, r.pq, `line ${lineId} (${nhan}) · ${r.vi}`);
  luu(`C1-${vai}-line${lineId}`, r);
  await ctx.close(); return r;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* C2 — MACHINE 3D (mở trực tiếp)                                             */
/* ══════════════════════════════════════════════════════════════════════════ */
async function c2(browser, { vai, mayId, nhan }) {
  const ctx = await browser.newContext({ viewport: VP });
  await ctx.addInitScript(() => { try { localStorage.setItem("i18nextLng", "vi"); } catch { /* */ } });
  const me = await dangNhap(ctx, vai);
  const page = await ctx.newPage();
  const ky = mayDb(mayId);
  const r = { ca: "C2", vai, me, deBai: `mở /twin/may/${mayId} (${nhan}) ⇒ man-twin-may, ten-may/loai-may đúng DB, khoi-canh-may có canvas + __soCanvas=1, KHÔNG may-chua-dat-cho, suc-khoe-may có hạng`, kyVongDb: ky };
  try {
    await page.goto(`${BASE}/twin/may/${mayId}?do=1`, { waitUntil: "domcontentloaded" });
    r.msVe = await choMayVeXong(page);
    r.thay = await doc(page);
    r.anh = await anh(page, `C2-${vai}-may${mayId}`);
    const M = r.thay.may;
    if ((M?.khongMoDuoc ?? 0) > 0) {
      r.pq = "SAI";
      r.mayKhongMoDuoc = { lyDo: M.lyDo, chu: M.khongMoChu };
      r.vi = `may-khong-mo-duoc data-ly-do="${M.lyDo}" — chữ NGUYÊN VĂN: "${M.khongMoChu}" · nhưng máy ${mayId} THUỘC phạm vi ${VAI[vai].pham} (DB: nhà máy ${ky?.facCode}, toà ${ky?.toaMa}, tầng cấp ${ky?.capSo})`;
    } else if ((M?.chuaDatCho ?? 0) > 0) {
      /* ★ Brief lô C khai tường minh "KHÔNG có `may-chua-dat-cho`" ⇒ nhánh này là KẾT CỤC SAI,
         không phải "thiếu dữ kiện": `loai-may`/`suc-khoe-may` vắng vì chúng nằm TRONG khối cảnh. */
      r.pq = "SAI";
      r.mayChuaDatCho = { chu: M.chuaDatChoChu, soDatChoTrongDb: ky?.soDatCho };
      r.vi = `may-chua-dat-cho — chữ NGUYÊN VĂN: "${M.chuaDatChoChu}" · nhưng DB CÓ ${ky?.soDatCho} hàng twin_dat_cho cho máy ${mayId} (nhà máy ${ky?.facCode}, toà ${ky?.toaMa}) · kéo theo MẤT loai-may + suc-khoe-may + canvas (khoi-canh-may ${M.khoiCanhMay} canvas ${M.canvasTrongKhoiCanh}, __soCanvas ${r.thay.soCanvasKit})`;
    } else {
      const p = phan(
        { "man-twin-may": M, "ten-may (chữ)": M?.tenMay || null, "loai-may (chữ)": M?.loaiMay || null, "khoi-canh-may": M?.khoiCanhMay, "canvas trong khối cảnh": M?.canvasTrongKhoiCanh, "__soCanvas": r.thay.soCanvasKit, "suc-khoe-may hạng": M?.sucKhoeHang || null, "kỳ vọng DB": ky },
        [
          { ten: `URL = /twin/may/${mayId}`, ok: new URL(`${BASE}${r.thay.url}`).pathname === `/twin/may/${mayId}`, thay: r.thay.url },
          { ten: `ten-may = "${ky?.name}" (DB)`, ok: (M?.tenMay ?? "") === ky?.name, thay: `thấy "${M?.tenMay}"` },
          { ten: `loai-may chứa "${ky?.machineType}" (DB)`, ok: (M?.loaiMay ?? "").includes(String(ky?.machineType)), thay: `thấy "${M?.loaiMay}"` },
          { ten: "khoi-canh-may có canvas, __soCanvas=1", ok: (M?.khoiCanhMay ?? 0) === 1 && (M?.canvasTrongKhoiCanh ?? 0) >= 1 && r.thay.soCanvasKit === 1, thay: `khối ${M?.khoiCanhMay} canvas ${M?.canvasTrongKhoiCanh} __soCanvas ${r.thay.soCanvasKit}` },
          { ten: "KHÔNG may-chua-dat-cho", ok: (M?.chuaDatCho ?? 1) === 0, thay: `may-chua-dat-cho ${M?.chuaDatCho} "${(M?.chuaDatChoChu || "").slice(0, 120)}"` },
          { ten: "suc-khoe-may có hạng", ok: !!M?.sucKhoeHang && M.sucKhoeHang !== "chua_do", thay: `hạng "${M?.sucKhoeHang}" chữ "${M?.sucKhoeChu}"` },
        ],
      );
      Object.assign(r, p);
    }
  } catch (e) { r.loi = String(e).slice(0, 400); r.pq = "HỎNG"; r.vi = `HỎNG ${r.loi}`; try { r.anh = await anh(page, `C2-${vai}-may${mayId}-HONG`); } catch { /* */ } }
  bao("C2", vai, r.pq, `máy ${mayId} (${nhan}) · ${r.vi}`);
  luu(`C2-${vai}-may${mayId}`, r);
  await ctx.close(); return r;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* C3 — BẤM THẲNG TÂM KHỐI MÁY TRÊN CANVAS (khuôn k8)                         */
/* ══════════════════════════════════════════════════════════════════════════ */
const dsBamDuoc = (page) => page.evaluate(() => {
  const canvas = document.querySelector('[data-testid="man-twin-van-hanh"] canvas');
  if (!canvas) return { loi: "không có canvas màn /twin" };
  const cv = canvas.getBoundingClientRect();
  const hopNhan = window.__demTuongTac?.hopNhanDaVe?.() ?? [];
  const ds = (window.__demTuongTac?.dsMay?.() ?? []).filter((m) => m.trongKhung);
  const ra = []; const loai = [];
  for (const m of ds) {
    const X = cv.left + m.x, Y = cv.top + m.y;
    if (document.elementFromPoint(X, Y) !== canvas) { loai.push(`${m.machineId}:bị phủ`); continue; }
    const t = window.__demTuongTac?.tamMay?.(m.machineId); if (!t) { loai.push(`${m.machineId}:khôngTâm`); continue; }
    const hit = window.__demTuongTac?.hitTai?.(t.ndcX, t.ndcY);
    if (!hit || hit.ten !== "twin3d-lo-may") { loai.push(`${m.machineId}:hit=${hit?.ten ?? "null"}`); continue; }
    const nhanKhac = hopNhan.filter((v) => v.machineId !== m.machineId && m.x >= v.hop.trai && m.x <= v.hop.phai && m.y >= v.hop.tren && m.y <= v.hop.duoi).map((v) => v.machineId);
    ra.push({ id: m.machineId, X, Y, biNhanKhacPhu: nhanKhac });
  }
  return { soTrongKhung: ds.length, soBamDuoc: ra.length, soNhanVe: hopNhan.length, ds: ra, loai: loai.slice(0, 10) };
});
const tamHienTai = (page, id) => page.evaluate((mid) => {
  const canvas = document.querySelector('[data-testid="man-twin-van-hanh"] canvas'); if (!canvas) return null;
  const cv = canvas.getBoundingClientRect();
  const t = window.__demTuongTac?.tamMay?.(mid); if (!t || !t.trongKhung) return null;
  const X = cv.left + t.x, Y = cv.top + t.y;
  if (document.elementFromPoint(X, Y) !== canvas) return null;
  const hit = window.__demTuongTac?.hitTai?.(t.ndcX, t.ndcY);
  return { X, Y, hitMay: hit?.machineId ?? null, hitTen: hit?.ten ?? null };
}, id);

async function c3(browser, { vai, facId, toaId, tangId, so = 5 }) {
  const ctx = await browser.newContext({ viewport: VP });
  await ctx.addInitScript(() => { try { localStorage.setItem("i18nextLng", "vi"); } catch { /* */ } });
  const me = await dangNhap(ctx, vai);
  const page = await ctx.newPage();
  const r = { ca: "C3", vai, me, deBai: `trên /twin (nm=${facId} toa=${toaId} tang=${tangId}) bấm TÂM KHỐI ≥${so} máy khác nhau ⇒ URL = /twin/may/<đúng id máy đó>`, bam: [] };
  try {
    await moTwin(page, `nm=${facId}&toa=${toaId}&tang=${tangId}&do=1`);
    r.oChon = (await doc(page)).vanHanh;
    const cen = await dsBamDuoc(page);
    r.census = { soTrongKhung: cen.soTrongKhung, soBamDuoc: cen.soBamDuoc, soNhanVe: cen.soNhanVe, loai: cen.loai };
    if (!cen.ds || cen.ds.length === 0) throw new Error(`0 máy bấm được — THIẾU DỮ KIỆN: tâm khối máy (__demTuongTac.tamMay). ${JSON.stringify(cen).slice(0, 220)}`);
    const buoc = Math.max(1, Math.floor(cen.ds.length / so));
    const chon = []; for (let i = 0; i < cen.ds.length && chon.length < so; i += buoc) chon.push(cen.ds[i]);
    for (const m of cen.ds) { if (chon.length >= so) break; if (!chon.some((x) => x.id === m.id)) chon.push(m); }
    r.chon = chon.map((m) => m.id);
    for (let i = 0; i < chon.length; i++) {
      const t = await tamHienTai(page, chon[i].id);
      if (!t) { r.bam.push({ may: chon[i].id, boQua: "tâm không bấm được ở khung hiện tại" }); continue; }
      await page.mouse.move(t.X - 45, t.Y - 45); await page.waitForTimeout(140);
      await page.mouse.move(t.X, t.Y, { steps: 5 }); await page.waitForTimeout(200);
      await page.mouse.click(t.X, t.Y);
      const toi = await page.waitForURL(new RegExp(`/twin/may/${chon[i].id}(\\?|$)`), { timeout: 6_000 }).then(() => true).catch(() => false);
      const url = page.url(); const dich = (url.match(/\/twin\/may\/(\d+)/) ?? [])[1] ?? null;
      let pngB = null;
      if (i === 0 && url.includes("/twin/may/")) { await choMayVeXong(page); pngB = await anh(page, `C3-${vai}-sau-bam-khoi-may${chon[i].id}`); }
      r.bam.push({ may: chon[i].id, X: Math.round(t.X), Y: Math.round(t.Y), hitMay: t.hitMay, url: new URL(url).pathname, dich: dich ? Number(dich) : null, dung: toi && Number(dich) === chon[i].id, png: pngB });
      if (url.includes("/twin/may/")) {
        await page.goBack({ waitUntil: "domcontentloaded" });
        await page.waitForSelector('[data-testid="man-twin-van-hanh"] canvas', { timeout: 60_000 }).catch(() => {});
        await page.waitForFunction(() => (window.__demTuongTac?.dsMay?.() ?? []).some((m) => m.trongKhung), null, { timeout: 40_000 }).catch(() => {});
        await page.waitForTimeout(2_500);
      }
    }
    const dung = r.bam.filter((b) => b.dung).length;
    r.dung = dung; r.tong = r.bam.length;
    const p = phan(
      { "tâm khối máy (__demTuongTac.tamMay)": r.bam.length ? true : null, "số cú bấm ≥ 5": r.bam.length >= so ? r.bam.length : null },
      [{ ten: `${so}/${so} cú bấm tới đúng máy`, ok: dung === r.bam.length && r.bam.length >= so, thay: `đúng ${dung}/${r.bam.length}: ` + r.bam.map((b) => `${b.may}→${b.dich ?? b.boQua ?? "?"}`).join(", ") }],
    );
    Object.assign(r, p);
  } catch (e) { r.loi = String(e).slice(0, 400); r.pq = "HỎNG"; r.vi = `HỎNG ${r.loi}`; try { r.anh = await anh(page, `C3-${vai}-HONG`); } catch { /* */ } }
  bao("C3", vai, r.pq, r.vi);
  luu(`C3-${vai}`, r);
  await ctx.close(); return r;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* C4 — NGOÀI PHẠM VI (CHẶN-ĐÚNG) — hai tầng: UI và API                       */
/* ══════════════════════════════════════════════════════════════════════════ */
async function c4(browser, { vai, lineId, mayId, facNgoai, tangNgoai, vaiDoiChung }) {
  const ctx = await browser.newContext({ viewport: VP });
  await ctx.addInitScript(() => { try { localStorage.setItem("i18nextLng", "vi"); } catch { /* */ } });
  const me = await dangNhap(ctx, vai);
  const page = await ctx.newPage();
  const r = { ca: "C4", vai, me, deBai: `${vai} (phạm vi ${VAI[vai].pham}) mở /twin/line/${lineId} và /twin/may/${mayId} (nhà máy id ${facNgoai}) ⇒ line-khong-mo-duoc / may-khong-mo-duoc, API NOT_FOUND (không FORBIDDEN)` };
  try {
    await page.goto(`${BASE}/twin/line/${lineId}?do=1`, { waitUntil: "domcontentloaded" });
    await choLineVeXong(page);
    r.uiLine = (await doc(page)).line;
    r.anhLine = await anh(page, `C4-${vai}-line${lineId}-chan`);
    await page.goto(`${BASE}/twin/may/${mayId}?do=1`, { waitUntil: "domcontentloaded" });
    await choMayVeXong(page);
    r.uiMay = (await doc(page)).may;
    r.anh = await anh(page, `C4-${vai}-may${mayId}-chan`);
    r.api = {
      "factoryCommand.machineDetail": await trpc(ctx, "factoryCommand.machineDetail", { machineId: mayId }),
      "machine.getById": await trpc(ctx, "machine.getById", { id: mayId }),
      "twinCanh.danhSachToaNha(facNgoai)": await trpc(ctx, "twinCanh.danhSachToaNha", { factoryId: facNgoai }),
      "twinCanh.canhThietKe(facNgoai)": await trpc(ctx, "twinCanh.canhThietKe", { factoryId: facNgoai, tangIds: [tangNgoai] }),
      "factoryCommand.overview(facNgoai)": await trpc(ctx, "factoryCommand.overview", { factoryId: facNgoai }),
      "factory.getById(facNgoai)": await trpc(ctx, "factory.getById", { id: facNgoai }),
    };
    const ll = await trpc(ctx, "line.list");
    r.lineListSo = Array.isArray(ll.data) ? ll.data.length : ll.ma;
    r.lineListCoLineNgoai = Array.isArray(ll.data) ? ll.data.some((x) => x.id === lineId) : null;
    const ctx2 = await browser.newContext(); await dangNhap(ctx2, vaiDoiChung);
    r.doiChungDuong = {
      vai: vaiDoiChung,
      "factoryCommand.machineDetail": await trpc(ctx2, "factoryCommand.machineDetail", { machineId: mayId }),
      "twinCanh.danhSachToaNha(facNgoai)": await trpc(ctx2, "twinCanh.danhSachToaNha", { factoryId: facNgoai }),
    };
    r.doiChungDuongTomTat = {
      machineDetail_http: r.doiChungDuong["factoryCommand.machineDetail"].http,
      machineDetail_ma: r.doiChungDuong["factoryCommand.machineDetail"].ma,
      coDuLieu: r.doiChungDuong["factoryCommand.machineDetail"].data !== null,
      soToaNha: Array.isArray(r.doiChungDuong["twinCanh.danhSachToaNha(facNgoai)"].data) ? r.doiChungDuong["twinCanh.danhSachToaNha(facNgoai)"].data.length : null,
    };
    await ctx2.close();
    const md = r.api["factoryCommand.machineDetail"];
    /* ★ BA TẦNG, BA PHÁN QUYẾT RỜI — gộp một ô thì một tầng đỏ nuốt mất hai tầng xanh
       và người đọc không biết chỗ nào phải vá. */
    const pLine = phan(
      { "đếm line-khong-mo-duoc": r.uiLine ? r.uiLine.khongMoDuoc : null, "đếm line-rong": r.uiLine ? r.uiLine.lineRong : null },
      [{ ten: "UI line ngoài phạm vi NÓI RA bằng line-khong-mo-duoc", ok: (r.uiLine?.khongMoDuoc ?? 0) === 1, thay: `khong-mo-duoc ${r.uiLine?.khongMoDuoc} lý do "${r.uiLine?.lyDo}" · line-rong ${r.uiLine?.lineRong} · chữ NGUYÊN VĂN "${(r.uiLine?.khongMoChu || r.uiLine?.lineRongChu || "").slice(0, 170)}"` }],
    );
    const pMay = phan(
      { "đếm may-khong-mo-duoc": r.uiMay ? r.uiMay.khongMoDuoc : null, "data-ly-do": r.uiMay?.lyDo ?? (r.uiMay?.khongMoDuoc === 0 ? "KHÔNG-CÓ-NHÁNH" : null) },
      [{ ten: "UI máy ngoài phạm vi ⇒ may-khong-mo-duoc / ngoaiPhamVi", ok: (r.uiMay?.khongMoDuoc ?? 0) === 1 && r.uiMay?.lyDo === "ngoaiPhamVi", thay: `khong-mo-duoc ${r.uiMay?.khongMoDuoc} lý do "${r.uiMay?.lyDo}" · chữ "${(r.uiMay?.khongMoChu || "").slice(0, 150)}"` }],
    );
    const pApi = phan(
      { "mã lỗi machineDetail": md.ma ?? (md.data === null ? "DATA_NULL" : "OK"), "đối chứng dương": r.doiChungDuongTomTat.coDuLieu ? true : null },
      [
        { ten: "machineDetail = NOT_FOUND (không FORBIDDEN)", ok: md.ma === "NOT_FOUND", thay: `http ${md.http} mã ${md.ma} "${md.loi}"` },
        { ten: "machine.getById không rò (null)", ok: r.api["machine.getById"].data === null || r.api["machine.getById"].data === undefined, thay: `data ${String(JSON.stringify(r.api["machine.getById"].data)).slice(0, 80)} mã ${r.api["machine.getById"].ma}` },
        { ten: "danhSachToaNha nhà máy ngoài = rỗng, KHÔNG FORBIDDEN", ok: Array.isArray(r.api["twinCanh.danhSachToaNha(facNgoai)"].data) && r.api["twinCanh.danhSachToaNha(facNgoai)"].data.length === 0, thay: `mã ${r.api["twinCanh.danhSachToaNha(facNgoai)"].ma} data ${String(JSON.stringify(r.api["twinCanh.danhSachToaNha(facNgoai)"].data)).slice(0, 60)}` },
        { ten: "overview nhà máy ngoài KHÔNG rò máy", ok: (r.api["factoryCommand.overview(facNgoai)"].data?.machines?.length ?? 0) === 0, thay: `máy ${r.api["factoryCommand.overview(facNgoai)"].data?.machines?.length ?? "—"} mã ${r.api["factoryCommand.overview(facNgoai)"].ma}` },
        { ten: "factory.getById nhà máy ngoài = không tồn tại", ok: r.api["factory.getById(facNgoai)"].data === null || r.api["factory.getById(facNgoai)"].data === undefined, thay: `data ${String(JSON.stringify(r.api["factory.getById(facNgoai)"].data)).slice(0, 80)} mã ${r.api["factory.getById(facNgoai)"].ma}` },
        { ten: "line.list KHÔNG chứa line ngoài phạm vi", ok: r.lineListCoLineNgoai === false, thay: `line.list ${r.lineListSo} hàng, có line ${lineId}: ${r.lineListCoLineNgoai}` },
        { ten: `đối chứng DƯƠNG ${vaiDoiChung} nhận dữ liệu thật`, ok: r.doiChungDuongTomTat.coDuLieu === true && (r.doiChungDuongTomTat.soToaNha ?? 0) > 0, thay: JSON.stringify(r.doiChungDuongTomTat) },
      ],
    );
    r.phanRieng = { C4a_uiLine: pLine, C4b_uiMay: pMay, C4c_api: pApi };
    bao("C4a", vai, pLine.pq === "ĐẠT" ? "CHẶN-ĐÚNG" : pLine.pq, `UI line ${lineId} ngoài phạm vi · ${pLine.vi}`);
    bao("C4b", vai, pMay.pq === "ĐẠT" ? "CHẶN-ĐÚNG" : pMay.pq, `UI máy ${mayId} ngoài phạm vi · ${pMay.vi}`);
    bao("C4c", vai, pApi.pq === "ĐẠT" ? "CHẶN-ĐÚNG" : pApi.pq, `API ngoài phạm vi · ${pApi.vi}`);
    r.pq = [pLine, pMay, pApi].every((x) => x.pq === "ĐẠT") ? "CHẶN-ĐÚNG" : "SAI";
    r.vi = `C4a ${pLine.pq} · C4b ${pMay.pq} · C4c ${pApi.pq}`;
    luu(`C4-${vai}`, r); await ctx.close(); return r;
  } catch (e) { r.loi = String(e).slice(0, 400); r.pq = "HỎNG"; r.vi = `HỎNG ${r.loi}`; bao("C4", vai, r.pq, r.vi); }
  luu(`C4-${vai}`, r);
  await ctx.close(); return r;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* C5 — BREADCRUMB: cảnh → /twin/may/:id → ve-man-line → ve-man-nha-may        */
/* ══════════════════════════════════════════════════════════════════════════ */
async function c5(browser, { vai, facId, toaId, tangId, nhan }) {
  const ctx = await browser.newContext({ viewport: VP });
  await ctx.addInitScript(() => { try { localStorage.setItem("i18nextLng", "vi"); } catch { /* */ } });
  const me = await dangNhap(ctx, vai);
  const page = await ctx.newPage();
  const r = { ca: "C5", vai, me, deBai: `đi /twin (nm=${facId} toa=${toaId} tang=${tangId}, ${nhan}) → bấm khối máy → /twin/may/:id → ve-man-line → ve-man-nha-may ⇒ phải về ĐÚNG line của máy và ĐÚNG nhà máy ${facId}`, buoc: [] };
  try {
    await moTwin(page, `nm=${facId}&toa=${toaId}&tang=${tangId}&do=1`);
    const vh0 = (await doc(page)).vanHanh;
    r.twinBanDau = { nhaMayDangChon: vh0?.oNhaMay, toaDangChon: vh0?.oToaNha, tangDangChon: vh0?.oTang, demMay: vh0?.demMay };
    const cen = await dsBamDuoc(page);
    r.census = { soTrongKhung: cen.soTrongKhung, soBamDuoc: cen.soBamDuoc, loai: cen.loai };
    if (!cen.ds?.length) throw new Error(`0 máy bấm được — THIẾU DỮ KIỆN: tâm khối máy. ${JSON.stringify(r.census).slice(0, 200)}`);
    const m0 = cen.ds[0];
    const t = await tamHienTai(page, m0.id);
    if (!t) throw new Error("THIẾU DỮ KIỆN: tâm khối máy lúc bấm");
    await page.mouse.move(t.X, t.Y, { steps: 5 }); await page.waitForTimeout(200);
    await page.mouse.click(t.X, t.Y);
    await page.waitForURL(/\/twin\/may\/\d+/, { timeout: 8_000 }).catch(() => {});
    await choMayVeXong(page);
    r.buoc.push(`bấm khối máy ${m0.id} trên cảnh`);
    const d1 = await doc(page); r.manMay = d1.may; r.urlMay = d1.url;
    r.mayId = Number((d1.url.match(/\/twin\/may\/(\d+)/) ?? [])[1] ?? NaN);
    r.anhMay = await anh(page, `C5-${vai}-nm${facId}-toa${toaId}-may${r.mayId}`);
    r.coVeManLine = (d1.may?.veManLine ?? 0) > 0;
    /* ★★★ "THẤY VÀ BẤM ĐƯỢC TRÊN CẢNH rồi màn đích TỪ CHỐI" (lớp G149) là một KẾT CỤC ĐO ĐƯỢC,
       không phải phép đo hỏng ⇒ SAI, kèm chữ nguyên văn + số máy đã vẽ trên cảnh. */
    if ((d1.may?.khongMoDuoc ?? 0) > 0) {
      r.pq = "SAI";
      r.vi = `bấm được khối máy ${r.mayId} trên cảnh /twin (${r.census.soBamDuoc}/${r.census.soTrongKhung} máy bấm được, ô chọn nhà máy "${r.twinBanDau.nhaMayDangChon?.nhanDangChon}" = ${facId}) NHƯNG màn đích /twin/may/${r.mayId} TỪ CHỐI: may-khong-mo-duoc ly-do="${d1.may.lyDo}" — chữ NGUYÊN VĂN "${d1.may.khongMoChu}" · ten-may rơi về dự phòng "${d1.may.tenMay}" · KHÔNG có ve-man-line ⇒ breadcrumb đứt, không đo tiếp được C5 · (href ve-man-nha-may VẪN đúng: "${d1.may.veNhaMayHref}" ⇒ id nhà máy đúng CÓ SẴN trong trang)`;
      luu(`C5-${vai}-nm${facId}-toa${toaId}`, r);
      bao("C5", vai, r.pq, `${nhan} · ${r.vi}`);
      await ctx.close(); return r;
    }
    if (!r.coVeManLine) throw new Error(`THIẾU DỮ KIỆN: nút "ve-man-line" KHÔNG có trên breadcrumb (màn máy ${r.mayId}); ten-may="${d1.may?.tenMay}" khong-mo-duoc=${d1.may?.khongMoDuoc} lý do="${d1.may?.lyDo}"`);
    r.hrefVeManLine = d1.may.veManLineHref; r.chuVeManLine = d1.may.veManLineChu;
    await page.locator('[data-testid="ve-man-line"]').click(); r.buoc.push(`click ve-man-line ("${r.chuVeManLine}")`);
    await page.waitForURL(/\/twin\/line\/\d+/, { timeout: 8_000 }).catch(() => {});
    await choLineVeXong(page);
    const d2 = await doc(page); r.manLine = d2.line; r.urlLine = d2.url;
    r.lineId = Number((d2.url.match(/\/twin\/line\/(\d+)/) ?? [])[1] ?? NaN);
    r.anhLine = await anh(page, `C5-${vai}-nm${facId}-toa${toaId}-line${r.lineId}`);
    await page.locator('[data-testid="ve-man-nha-may"]').click(); r.buoc.push("click ve-man-nha-may");
    await page.waitForURL(/\/twin(\?|$)/, { timeout: 8_000 }).catch(() => {});
    await page.waitForSelector('[data-testid="man-twin-van-hanh"]', { timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(6_000);
    const d3 = await doc(page); r.manNhaMay = d3.vanHanh; r.urlNhaMay = d3.url;
    r.anh = await anh(page, `C5-${vai}-nm${facId}-toa${toaId}-ve-man-nha-may`);
    const q = await trpc(ctx, "factoryCommand.machineDetail", { machineId: r.mayId });
    r.mayDetailApi = { http: q.http, ma: q.ma, ten: q.data?.machine?.name ?? q.data?.name ?? null };
    const p = phan(
      { "id máy từ URL": Number.isFinite(r.mayId) ? r.mayId : null, "URL màn line": r.urlLine || null, "id line": Number.isFinite(r.lineId) ? r.lineId : null, "URL sau ve-man-nha-may": r.urlNhaMay || null, "ô chọn nhà máy sau khi về": r.manNhaMay?.oNhaMay ?? null },
      [
        { ten: "ve-man-line tới /twin/line/:id", ok: /^\/twin\/line\/\d+$/.test(new URL(`${BASE}${r.urlLine}`).pathname), thay: r.urlLine },
        { ten: "ve-man-nha-may về /twin", ok: new URL(`${BASE}${r.urlNhaMay}`).pathname === "/twin", thay: r.urlNhaMay },
        { ten: `nhà máy sau khi về = ${facId} (đang xem)`, ok: Number(r.manNhaMay?.oNhaMay?.value) === facId, thay: `ô chọn nhà máy = ${r.manNhaMay?.oNhaMay?.value} ("${r.manNhaMay?.oNhaMay?.nhanDangChon}")` },
        { ten: `toà = ${toaId}, tầng = ${tangId}`, ok: Number(r.manNhaMay?.oToaNha?.value) === toaId && Number(r.manNhaMay?.oTang?.value) === tangId, thay: `toà ${r.manNhaMay?.oToaNha?.value} tầng ${r.manNhaMay?.oTang?.value}` },
      ],
    );
    Object.assign(r, p);
  } catch (e) { r.loi = String(e).slice(0, 500); r.pq = "HỎNG"; r.vi = `HỎNG ${r.loi}`; try { r.anh = await anh(page, `C5-${vai}-nm${facId}-toa${toaId}-HONG`); } catch { /* */ } }
  bao("C5", vai, r.pq, `${nhan} · ${r.vi}`);
  luu(`C5-${vai}-nm${facId}-toa${toaId}`, r);
  await ctx.close(); return r;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* C6 — LINE RỖNG (0 máy)                                                     */
/* ══════════════════════════════════════════════════════════════════════════ */
async function c6() {
  const r = {
    ca: "C6", vai: "—",
    deBai: "tìm line 0 máy; nếu có thì mở ⇒ `line-rong` trung thực; nếu không có ⇒ N/A kèm câu truy vấn chứng minh",
    truyVan: 'select count(*) from production_lines l join workshops w on w.id=l."workshopId" where l."isActive"=true and 0=(select count(*) from machines m join stations st on st.id=m."stationId" where st."lineId"=l.id and st."isActive"=true and m."isActive"=true)',
    ketQuaTruyVan: { soLineIsActiveToanHe: 102, soLine0May: 0 },
    lineItMayNhat: "line 11 (T12-SHOT) 1 trạm/1 máy; toàn bộ 98 line QATD đều ≥ 8 máy",
    lineRongTrongQATD: DB.lineRong,
  };
  r.pq = "N/A";
  r.vi = "0/102 line isActive có 0 máy (câu truy vấn ở khoá `truyVan`) ⇒ không dựng được ca này mà không GHI vào DB; đợt đo chỉ SELECT";
  bao("C6", "—", r.pq, r.vi);
  luu("C6-line-rong", r);
  return r;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* C7 — ID XẤU                                                                */
/* ══════════════════════════════════════════════════════════════════════════ */
async function c7(browser, { vai }) {
  const ctx = await browser.newContext({ viewport: VP });
  await ctx.addInitScript(() => { try { localStorage.setItem("i18nextLng", "vi"); } catch { /* */ } });
  const me = await dangNhap(ctx, vai);
  const page = await ctx.newPage();
  const loiJs = []; page.on("pageerror", (e) => loiJs.push(String(e).slice(0, 160)));
  const r = { ca: "C7", vai, me, deBai: "/twin/line/abc ⇒ line-id-khong-hop-le · /twin/may/999999 ⇒ may-khong-mo-duoc; không crash, không màn trắng" };
  try {
    await page.goto(`${BASE}/twin/line/abc?do=1`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(7_000);
    r.line = await doc(page);
    r.anhLine = await anh(page, `C7-${vai}-line-abc`);
    await page.goto(`${BASE}/twin/may/999999?do=1`, { waitUntil: "domcontentloaded" });
    await choMayVeXong(page);
    r.may = await doc(page);
    r.anh = await anh(page, `C7-${vai}-may-999999`);
    r.loiJs = loiJs;
    const p = phan(
      { "màn line id xấu (đếm line-id-khong-hop-le)": r.line.lineIdKhongHopLe, "màn máy id không tồn tại": r.may.may, "chữ trên trang (độ dài)": r.line.thanTrangDai },
      [
        { ten: "line-id-khong-hop-le", ok: r.line.lineIdKhongHopLe === 1, thay: `idKhongHopLe ${r.line.lineIdKhongHopLe} chữ "${(r.line.lineIdKhongHopLeChu || "").slice(0, 140)}"` },
        { ten: "may-khong-mo-duoc cho máy 999999", ok: (r.may.may?.khongMoDuoc ?? 0) === 1, thay: `khongMoDuoc ${r.may.may?.khongMoDuoc} lý do "${r.may.may?.lyDo}" chữ "${(r.may.may?.khongMoChu || "").slice(0, 140)}"` },
        { ten: "không màn trắng (có chữ đọc được)", ok: r.line.thanTrangDai > 40 && r.may.thanTrangDai > 40, thay: `chữ line ${r.line.thanTrangDai} / máy ${r.may.thanTrangDai} ký tự` },
        { ten: "0 lỗi JS không bắt được", ok: loiJs.length === 0, thay: `lỗi JS: ${JSON.stringify(loiJs).slice(0, 200)}` },
      ],
    );
    if (p.pq === "ĐẠT") { r.pq = "CHẶN-ĐÚNG"; r.vi = p.vi; } else Object.assign(r, p);
  } catch (e) { r.loi = String(e).slice(0, 400); r.pq = "HỎNG"; r.vi = `HỎNG ${r.loi}`; }
  bao("C7", vai, r.pq, r.vi);
  luu(`C7-${vai}`, r);
  await ctx.close(); return r;
}

/* ══════════════════════════════════════════════════════════════════════════ */
const browser = await chromium.launch();
try {
  const lam = (x) => CA === "all" || CA === x;
  if (lam("C1")) {
    await c1(browser, { vai: "qatd_kythuat", facId: 39, toaId: 57, tangId: 109, lineId: 249, nhan: "QATD-B toà T1 tầng 1 — nhà máy THỨ HAI của vai" });
    await c1(browser, { vai: "qatd_kythuat", facId: 38, toaId: 53, tangId: 81, lineId: 217, nhan: "QATD-A toà T1 tầng 1 — nhà máy ĐẦU của vai (đối chứng dương)" });
    await c1(browser, { vai: "qatd_congnhan", facId: 40, toaId: 61, tangId: 137, lineId: 284, nhan: "QATD-C toà T1 tầng 1 — nhà máy duy nhất, toà ĐẦU" });
    await c1(browser, { vai: "qatd_congnhan", facId: 40, toaId: 63, tangId: 151, lineId: 299, nhan: "QATD-C toà T3 tầng 1 — toà THỨ BA (tách tầng lỗi toaNha[0])" });
  }
  if (lam("C2")) {
    await c2(browser, { vai: "qatd_kythuat", mayId: 4568, nhan: "QATD-B, WAVE_SOLDER, running" });
    await c2(browser, { vai: "qatd_congnhan", mayId: 4977, nhan: "QATD-C, FEEDER, running" });
    await c2(browser, { vai: "qatd_kythuat", mayId: 4197, nhan: "QATD-A, ICT, stopped — đối chứng dương nhà máy ĐẦU" });
    await c2(browser, { vai: "qatd_congnhan", mayId: 5139, nhan: "QATD-C toà T3, SPI, running — ĐÚNG nhà máy nhưng toà THỨ BA (tách tầng lỗi toaNha[0])" });
  }
  if (lam("C3")) await c3(browser, { vai: "qatd_congnhan", facId: 40, toaId: 61, tangId: 137, so: 5 });
  if (lam("C4")) await c4(browser, { vai: "qatd_congnhan", lineId: 249, mayId: 4568, facNgoai: 39, tangNgoai: 109, vaiDoiChung: "qatd_kythuat" });
  if (lam("C5")) {
    await c5(browser, { vai: "qatd_kythuat", facId: 39, toaId: 57, tangId: 109, nhan: "QATD-B toà T1 — nhà máy THỨ HAI" });
    await c5(browser, { vai: "qatd_congnhan", facId: 40, toaId: 61, tangId: 137, nhan: "QATD-C toà T1 — đối chứng dương" });
    await c5(browser, { vai: "qatd_congnhan", facId: 40, toaId: 63, tangId: 151, nhan: "QATD-C toà T3 — toà THỨ BA" });
  }
  if (lam("C6")) await c6();
  if (lam("C7")) await c7(browser, { vai: "qatd_kythuat" });
  if (lam("AB")) {
    /* ══════════════════════════════════════════════════════════════════════
       ABLATION — biến độc lập là VỊ TRÍ TRONG `factory.list`, KHÔNG phải quyền.
       `factory.list` sắp theo `factories.name` (server/db/hierarchy.ts:340).
       CÙNG MỘT MÁY 4977 (QATD-C):
         · qatd_congnhan  — chỉ QATD-C  ⇒ factories[0] = "Công ty C"  ⇒ dự đoán ĐẠT
         · qatd_giamdoc   — A+B+C       ⇒ factories[0] = "Công ty A"  ⇒ dự đoán SAI
         · qatd_admin     — tất cả      ⇒ factories[0] = "Công ty A"  ⇒ dự đoán SAI
       Giám đốc/admin có quyền RỘNG HƠN công nhân ⇒ nếu họ SAI còn công nhân ĐẠT
       thì nguyên nhân KHÔNG thể là quyền/phạm vi; chỉ còn vị trí phần tử [0].
       (Chỉ ĐỌC — không đổi một hàng DB nào.)
       ══════════════════════════════════════════════════════════════════════ */
    const ab = { ca: "AB", deBai: "cùng máy 4977 / line 284 (QATD-C), đổi VAI để đổi phần tử factory.list[0]", factoryList: {} };
    for (const u of ["qatd_congnhan", "qatd_giamdoc", "qatd_admin", "qatd_kythuat"]) {
      const c = await browser.newContext(); await dangNhap(c, u);
      const fl = await trpc(c, "factory.list");
      ab.factoryList[u] = Array.isArray(fl.data) ? fl.data.map((f) => ({ id: f.id, code: f.code, name: f.name })) : fl.ma;
      ab.factoryList[u + "__phanTu0"] = Array.isArray(fl.data) ? `${fl.data[0]?.id} ${fl.data[0]?.code} "${fl.data[0]?.name}"` : null;
      await c.close();
    }
    console.log("  ── factory.list[0] theo vai:");
    for (const u of ["qatd_congnhan", "qatd_giamdoc", "qatd_admin", "qatd_kythuat"]) console.log(`     ${u.padEnd(15)} → ${ab.factoryList[u + "__phanTu0"]}`);
    luu("AB-factory-list", ab);
    await c2(browser, { vai: "qatd_giamdoc", mayId: 4977, nhan: "ABLATION — CÙNG máy công nhân mở ĐƯỢC, nhưng giám đốc có factories[0]=Công ty A" });
    await c2(browser, { vai: "qatd_admin", mayId: 4977, nhan: "ABLATION — admin bypass toàn quyền, factories[0]=Công ty A" });
    await c1(browser, { vai: "qatd_giamdoc", facId: 40, toaId: 61, tangId: 137, lineId: 284, nhan: "ABLATION — CÙNG line công nhân mở ĐƯỢC" });
  }
} finally { await browser.close(); }
const dem = GHI.reduce((a, x) => { a[x.pq] = (a[x.pq] ?? 0) + 1; return a; }, {});
luu(`TONG-${CA}`, { dem, so: GHI.length, ghi: GHI });
console.log(`\n=== LÔ C (${CA}): ${JSON.stringify(dem)} / ${GHI.length} ca ===`);
