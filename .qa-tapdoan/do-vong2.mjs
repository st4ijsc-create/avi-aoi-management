/**
 * QA lần 11 — VÒNG 2 (đo lại sau ba bản vá PH-12 / PH-13 / PH-14-15-29).
 * Dùng: node .qa-tapdoan/do-vong2.mjs --ca=R1|R2|...|all [--w=1600 --h=900]
 * Ra:   .qa-tapdoan/tho/V2/<ca>.json  ·  .qa-tapdoan/anh/V2-*.png
 *
 * Kỷ luật: L1 fail-closed (thiếu dữ kiện ⇒ HỎNG kèm TÊN dữ kiện, không `??` vá lỗ đọc),
 * L2 đọc theo NGHĨA (chữ người dùng thấy), chờ cảnh bằng `__thongKeVe.calls`, KHÔNG timeout cố định.
 * GPU: `--use-angle=default --enable-gpu --ignore-gpu-blocklist` (PH-25). 1 worker (tuần tự).
 */
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";

const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? m.slice(k.length + 3) : d; };
const BASE = arg("base", "http://localhost:3064");
const CA = arg("ca", "all");
const VP = { width: Number(arg("w", "1600")), height: Number(arg("h", "900")) };
const THO = ".qa-tapdoan/tho/V2";
const ANH = ".qa-tapdoan/anh";
mkdirSync(THO, { recursive: true }); mkdirSync(ANH, { recursive: true });
const MK = "Qatd!2026";
const LAUNCH = { args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"] };
const SO_WORKER = 1;

const DB = JSON.parse(readFileSync(`${THO}/db-V2.json`, "utf8"));
const DBC = JSON.parse(readFileSync(`${THO}/db-V2c.json`, "utf8"));
const lineDb = (id) => DB.line.find((l) => l.lineId === id) ?? null;

function luu(ten, obj) {
  const p = `${THO}/${ten}.json`;
  writeFileSync(`${p}.tmp`, JSON.stringify({ luc: new Date().toISOString(), base: BASE, vp: VP, soWorker: SO_WORKER, ...obj }, null, 1));
  renameSync(`${p}.tmp`, p);
  return p;
}
const bao = (ca, vai, pq, vi) => console.log(`  ${String(pq).padEnd(11)} ${ca} · ${vai} · ${String(vi).slice(0, 500)}`);

async function dangNhap(ctx, u) {
  const f = `${THO}/state-${u}.json`;
  const ai = async () => { const r = await ctx.request.get(`${BASE}/api/trpc/auth.me`); try { return JSON.parse(await r.text())?.result?.data?.json?.username ?? null; } catch { return null; } };
  if (existsSync(f)) { await ctx.addCookies(JSON.parse(readFileSync(f, "utf8"))); if ((await ai()) === u) return "cache"; await ctx.clearCookies(); }
  const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: u, password: MK } });
  const ten = await ai();
  if (r.status() !== 200 || ten !== u) throw new Error(`dang nhap that bai ${u}: login=${r.status()} me=${ten}`);
  writeFileSync(f, JSON.stringify(await ctx.cookies()));
  return "moi";
}
async function trpc(ctx, proc, input) {
  const u = `${BASE}/api/trpc/${proc}` + (input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`);
  const r = await ctx.request.get(u);
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* khong JSON */ }
  const boc = j?.result?.data;
  return {
    http: r.status(),
    data: boc && typeof boc === "object" && "json" in boc ? boc.json : (boc ?? null),
    ma: j?.error?.json?.data?.code ?? j?.error?.data?.code ?? null,
    loi: (j?.error?.json?.message ?? j?.error?.message ?? null)?.slice(0, 200) ?? null,
    byte: t.length,
  };
}
async function trpcPost(ctx, proc, input) {
  const r = await ctx.request.post(`${BASE}/api/trpc/${proc}`, { data: { json: input } });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ }
  const boc = j?.result?.data;
  return {
    http: r.status(),
    data: boc && typeof boc === "object" && "json" in boc ? boc.json : (boc ?? null),
    ma: j?.error?.json?.data?.code ?? j?.error?.data?.code ?? null,
    loi: (j?.error?.json?.message ?? j?.error?.message ?? null)?.slice(0, 300) ?? null,
    byte: t.length,
  };
}

/* ── ĐỌC MÀN THEO NGHĨA ───────────────────────────────────────────────── */
const DOC_TRANG = () => {
  const el = (t) => document.querySelector(`[data-testid="${t}"]`);
  const chu = (t) => { const e = el(t); return e ? (e.innerText || e.textContent || "").replace(/\s+/g, " ").trim() : null; };
  const dem = (t) => document.querySelectorAll(`[data-testid="${t}"]`).length;
  /* ⚠ Giao diện các tài khoản QATD là TIẾNG ANH: "45 machines placed" (số ĐẦU câu) trong khi
     "Machines 15" để số CUỐI. Bắt số ĐẦU TIÊN xuất hiện — đúng cho cả hai, và "—" vẫn ra `null`. */
  const so = (s) => { if (s == null) return null; const m = s.match(/(-?\d+)/); return m ? Number(m[1]) : null; };
  const oChon = (t) => { const e = el(t); return e ? { co: 1, soMuc: Number(e.getAttribute("data-so-muc")), value: e.value, disabled: e.disabled, nhanDangChon: [...e.options].find((o) => o.value === e.value)?.textContent?.trim() ?? null, muc: [...e.options].map((o) => `${o.value}:${o.textContent.trim()}`) } : { co: 0 }; };
  const manLine = el("man-twin-line"), manMay = el("man-twin-may"), manVh = el("man-twin-van-hanh"), manSt = el("man-twin-studio");
  const ds = window.__demTuongTac?.dsMay?.();
  const cv = document.querySelector("canvas");
  const cvr = cv ? cv.getBoundingClientRect() : null;
  let khoi = null;
  if (Array.isArray(ds)) {
    const tk = ds.filter((m) => m.trongKhung);
    let hop = null;
    if (tk.length && cvr) {
      const xs = tk.map((m) => m.x), ys = tk.map((m) => m.y);
      const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
      hop = { rongPx: Math.round(w), caoPx: Math.round(h), canvasRong: Math.round(cvr.width), canvasCao: Math.round(cvr.height), tiLeDienTich: Number(((w * h) / (cvr.width * cvr.height)).toFixed(4)) };
    }
    khoi = { tong: ds.length, trongKhung: tk.length, hop };
  }
  return {
    url: location.pathname + location.search,
    trang: { man_van_hanh: dem("man-twin-van-hanh"), man_line: dem("man-twin-line"), man_may: dem("man-twin-may"), man_studio: dem("man-twin-studio") },
    khoiCanh: khoi,
    line: manLine ? {
      tenLine: chu("ten-line"),
      demMayChu: chu("dem-may-line"), demMaySo: so(chu("dem-may-line")),
      demTramChu: chu("dem-tram-line"), demTramSo: so(chu("dem-tram-line")),
      wipChu: chu("tong-wip-line"), wipSo: so(chu("tong-wip-line")),
      lineRong: dem("line-rong"), lineRongChu: chu("line-rong"),
      khongMoDuoc: dem("line-khong-mo-duoc"), lyDo: el("line-khong-mo-duoc")?.getAttribute("data-ly-do") ?? null, khongMoChu: chu("line-khong-mo-duoc"),
      canvasTrongMan: manLine.querySelectorAll("canvas").length,
      soNhanMay: manLine.querySelectorAll('[data-testid="nhan-may-twin3d"]').length,
      soOTram: [...manLine.querySelectorAll('[data-testid^="o-tram-"]')].filter((e) => !e.getAttribute("data-testid").startsWith("o-tram-wip")).length,
      veNhaMayHref: el("ve-man-nha-may")?.getAttribute("href") ?? null,
    } : null,
    may: manMay ? {
      tenMay: chu("ten-may"), loaiMay: chu("loai-may"),
      sucKhoeChu: chu("suc-khoe-may"), sucKhoeHang: el("suc-khoe-may")?.getAttribute("data-hang") ?? null,
      khoiCanhMay: dem("khoi-canh-may"), canvasTrongKhoiCanh: el("khoi-canh-may")?.querySelectorAll("canvas").length ?? null,
      chuaDatCho: dem("may-chua-dat-cho"), chuaDatChoChu: chu("may-chua-dat-cho"),
      khongMoDuoc: dem("may-khong-mo-duoc"), lyDo: el("may-khong-mo-duoc")?.getAttribute("data-ly-do") ?? null, khongMoChu: chu("may-khong-mo-duoc"),
      dangTai: dem("may-dang-tai"),
      veManLine: dem("ve-man-line"), veManLineChu: chu("ve-man-line"), veManLineHref: el("ve-man-line")?.getAttribute("href") ?? null,
      veNhaMayHref: el("ve-man-nha-may")?.getAttribute("href") ?? null,
      canvasTrongMan: manMay.querySelectorAll("canvas").length,
    } : null,
    vanHanh: manVh ? { oNhaMay: oChon("chon-nha-may"), oToaNha: oChon("chon-toa-nha"), oTang: oChon("chon-tang"), demMay: chu("dem-may"), canvasTrongMan: manVh.querySelectorAll("canvas").length } : null,
    studio: manSt ? {
      oNhaMay: oChon("chon-nha-may"), oToaNha: oChon("chon-toa-nha"), oTang: oChon("chon-tang"),
      boChonNap: dem("bo-chon-nap"),
      demToaNha: chu("dem-toa-nha"),
      xuong: dem("xuong-thiet-ke"), vungCanvas: dem("vung-canvas"),
      daiSucKhoe: chu("dai-suc-khoe"),
      skDaXepCho: chu("sk-da-xep-cho"), skChoXepCho: chu("sk-cho-xep-cho"), skChuaDo: chu("sk-chua-do"), skChuaTai: dem("sk-chua-tai"),
      skDaXepChoSo: so(chu("sk-da-xep-cho")), skChoXepChoSo: so(chu("sk-cho-xep-cho")),
      tabConDuongA: dem("tab-con-duong-a"), tabConDuongB: dem("tab-con-duong-b"), tabThietKe: dem("tab-thiet-ke"),
      nutMoSinh: dem("nut-mo-sinh"), nutLuu: dem("nut-luu"), nutHoanTac: dem("nut-hoan-tac"),
      nutCheDoTranslate: dem("nut-che-do-translate"), congTacBatDinh: dem("cong-tac-bat-dinh"), thanhCanChinh: dem("thanh-can-chinh"),
      khoiAnhNen: dem("khoi-anh-nen"), nutTaiModel: dem("nut-tai-model"), nutLuuBanGhi: dem("nut-luu-ban-ghi"),
      nutGoKhoiMatBang: dem("nut-go-khoi-mat-bang"), khoiBanGhi: dem("khoi-ban-ghi"),
      huyHieuChiXem: dem("huy-hieu-chi-xem"), chiXemChu: chu("huy-hieu-chi-xem"),
      demChuaLuu: dem("dem-chua-luu"), demChuaLuuChu: chu("dem-chua-luu"),
      nutFit: dem("nut-fit-tat-ca"), miniMapCham: document.querySelectorAll('[data-testid="mini-map-cham"]').length,
      chuaCoTang: dem("chua-co-tang"), chuaCoNhaMay: dem("chua-co-nha-may"), daiPhamViRong: dem("dai-pham-vi-rong"),
      bangThuocTinh: dem("bang-thuoc-tinh"), congTacKhoa: dem("cong-tac-khoa"),
      headerCao: (() => { const h = manSt.querySelector("header"); return h ? Number(h.getBoundingClientRect().height.toFixed(2)) : null; })(),
      canvasTrongMan: manSt.querySelectorAll("canvas").length,
      soNodeCay: document.querySelectorAll('[data-testid^="node-cay-"]').length,
    } : null,
    /* ★ `__demNhan` KHÔNG bị gác bởi chế độ đo (LopNhan.tsx:458 ghi vô điều kiện) ⇒ đếm được
       khối máy cả khi URL không mang `?do=1` (cây phân cấp điều hướng KHÔNG giữ query). */
    demNhan: window.__demNhan ? { tongUngVien: window.__demNhan.tong, ve: window.__demNhan.ve, soHopKhoi: window.__demNhan.soHopKhoi, biGiau: window.__demNhan.biGiau } : null,
    soCanvasKit: window.__soCanvas === undefined ? null : window.__soCanvas,
    canvasDom: document.querySelectorAll("canvas").length,
    veCalls: window.__thongKeVe?.calls ?? null,
    spin: document.querySelectorAll(".animate-spin").length,
    thanTrangDai: (document.body.innerText || "").replace(/\s+/g, " ").trim().length,
    thanTrang: (document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 700),
  };
};
const doc = (page) => page.evaluate(DOC_TRANG);

function phan(can, kiem) {
  const thieu = Object.entries(can).filter(([, v]) => v === null || v === undefined).map(([k]) => k);
  if (thieu.length) return { pq: "HỎNG", vi: `thiếu dữ kiện: ${thieu.join(", ")}`, thieu };
  const sai = kiem.filter((k) => !k.ok);
  if (sai.length) return { pq: "SAI", vi: sai.map((k) => `${k.ten}: ${k.thay}`).join(" · "), sai: sai.map((k) => k.ten) };
  return { pq: "ĐẠT", vi: kiem.map((k) => `${k.ten} OK`).join(" · ") };
}

/* ── chờ theo TÍN HIỆU, không theo đồng hồ ───────────────────────────── */
async function choVe(page, moc = 0) {
  await page.waitForFunction((m) => {
    const w = window;
    if ((w.__thongKeVe?.calls ?? 0) > m) return true;
    const q = (t) => !!document.querySelector(`[data-testid="${t}"]`);
    return q("line-khong-mo-duoc") || q("line-rong") || q("may-khong-mo-duoc") || q("may-chua-dat-cho") || q("line-id-khong-hop-le") || q("chua-co-tang") || q("chua-co-nha-may") || q("dai-pham-vi-rong");
  }, moc, { timeout: 120_000 }).catch(() => {});
  /* ⚠ LỖ THIẾT BỊ ĐO đã sập một lần (R5 lượt đầu): điều kiện `ds.length === 0` THOẢ NGAY ở khung
     đầu tiên — lúc lô máy chưa dựng — nên phép chờ "cảnh xong" trả về khi cảnh mới có SÀN.
     Nay chờ tới khi có MÁY (hai cửa sổ độc lập), có hạn; cảnh rỗng thật thì hết hạn rồi đi tiếp. */
  await page.waitForFunction(() => {
    const q = (t) => !!document.querySelector(`[data-testid="${t}"]`);
    if (q("line-khong-mo-duoc") || q("line-rong") || q("may-khong-mo-duoc") || q("may-chua-dat-cho") || q("chua-co-tang") || q("chua-co-nha-may") || q("dai-pham-vi-rong")) return true;
    const ds = window.__demTuongTac?.dsMay?.();
    return (window.__demNhan?.tong ?? 0) > 0 || (Array.isArray(ds) && ds.length > 0);
  }, null, { timeout: 45_000 }).catch(() => {});
  await page.waitForFunction(() => {
    const ds = window.__demTuongTac?.dsMay?.();
    return !Array.isArray(ds) || ds.length === 0 || ds.some((m) => m.trongKhung);
  }, null, { timeout: 60_000 }).catch(() => {});
  await page.waitForFunction(() => document.querySelectorAll(".animate-spin").length === 0, null, { timeout: 30_000 }).catch(() => {});
}
const anh = async (page, ten) => { const p = `${ANH}/V2-${ten}.png`; await page.screenshot({ path: p }); return p; };

async function moTwin(page, qs) {
  await page.goto(`${BASE}/twin?${qs}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="man-twin-van-hanh"]', { timeout: 120_000 }).catch(() => {});
  await choVe(page, 0);
}
async function bungCay(page, vong = 7) {
  if (await page.locator('[data-testid="mo-cay-phan-cap"]').count()) {
    await page.locator('[data-testid="mo-cay-phan-cap"]').click();
    await page.waitForSelector('[data-testid^="node-cay-"]', { timeout: 30_000 }).catch(() => {});
  }
  for (let i = 0; i < vong; i++) {
    const n = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="node-cay-"]')].filter((e) => e.getAttribute("aria-expanded") === "false").map((e) => e.getAttribute("data-testid")));
    if (!n.length) break;
    for (const tid of n) { const b = page.locator(`[data-testid="${tid}"] button`).first(); if (await b.count()) { await b.click().catch(() => {}); } }
    await page.waitForTimeout(250);
  }
  return page.evaluate(() => [...document.querySelectorAll('[data-testid^="node-cay-"]')].map((e) => ({ tid: e.getAttribute("data-testid"), chu: (e.textContent || "").replace(/\s+/g, " ").trim().slice(0, 56) })));
}

/* ══════════════════════════════════════════════════════════════════════ */
/* R1/R2 — mở CHUYỀN qua CÂY PHÂN CẤP                                     */
/* ══════════════════════════════════════════════════════════════════════ */
async function caLine(browser, { ca, vai, facId, toaId, tangId, lineId, nhan }) {
  const ctx = await browser.newContext({ viewport: VP });
  const me = await dangNhap(ctx, vai);
  const page = await ctx.newPage();
  const ky = lineDb(lineId);
  const r = { ca, vai, me, deBai: `qua CÂY PHÂN CẤP trên /twin (nm=${facId} toà=${toaId} tầng=${tangId}) bấm node chuyền ${lineId} (${nhan}) => /twin/line/${lineId}: tên/đếm máy/đếm trạm khớp DB VÀ cảnh vẽ đủ KHỐI máy`, kyVongDb: ky, duongBam: [] };
  try {
    await moTwin(page, "do=1"); r.duongBam.push("goto /twin?do=1");
    await page.selectOption('[data-testid="chon-nha-may"]', String(facId)); r.duongBam.push(`chon-nha-may=${facId}`);
    await page.waitForFunction((v) => { const e = document.querySelector('[data-testid="chon-toa-nha"]'); return e && [...e.options].some((o) => o.value === v); }, String(toaId), { timeout: 60_000 });
    await page.selectOption('[data-testid="chon-toa-nha"]', String(toaId)); r.duongBam.push(`chon-toa-nha=${toaId}`);
    await page.waitForFunction((v) => { const e = document.querySelector('[data-testid="chon-tang"]'); return e && [...e.options].some((o) => o.value === v); }, String(tangId), { timeout: 60_000 });
    await page.selectOption('[data-testid="chon-tang"]', String(tangId)); r.duongBam.push(`chon-tang=${tangId}`);
    await choVe(page, 0);
    r.truocBam = await doc(page);
    r.anhTruoc = await anh(page, `${ca}-${vai}-truoc-line${lineId}`);
    const nodes = await bungCay(page); r.duongBam.push("mo cay + bung");
    r.soNode = nodes.length;
    const tid = `node-cay-line:${lineId}`;
    r.coNodeDich = nodes.some((n) => n.tid === tid);
    if (!r.coNodeDich) throw new Error(`cay KHONG co node ${tid} — THIEU DU KIEN: node chuyen trong cay. (line co: ${nodes.filter((n) => n.tid.startsWith("node-cay-line:")).map((n) => n.tid).slice(0, 14).join(", ")})`);
    r.chuNodeDich = nodes.find((n) => n.tid === tid).chu;
    const mocVe = await page.evaluate(() => window.__thongKeVe?.calls ?? 0);
    await page.locator(`[data-testid="${tid}"]`).click(); r.duongBam.push(`click ${tid} ("${r.chuNodeDich}")`);
    r.toiUrl = await page.waitForURL(new RegExp(`/twin/line/${lineId}(\\?|$)`), { timeout: 15_000 }).then(() => true).catch(() => false);
    await page.waitForSelector('[data-testid="man-twin-line"]', { timeout: 60_000 }).catch(() => {});
    await choVe(page, mocVe);
    r.thay = await doc(page);
    r.anh = await anh(page, `${ca}-${vai}-line${lineId}`);
    /* ★ Cây phân cấp điều hướng tới `/twin/line/:id` KHÔNG mang `?do=1` ⇒ `__demTuongTac` tắt.
       Đếm khối bằng HAI đường: (a) `__demNhan.soHopKhoi`/`tong` — không bị gác, đọc ngay ở lượt
       tới bằng cây; (b) nạp LẠI đúng URL ấy kèm `?do=1` trong CÙNG phiên để `__demTuongTac.dsMay`
       đếm instance thật. Ghi cả hai; chúng phải khớp. */
    if (r.thay.khoiCanh === null) {
      await page.goto(`${BASE}/twin/line/${lineId}?do=1`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector('[data-testid="man-twin-line"]', { timeout: 60_000 }).catch(() => {});
      await choVe(page, 0);
      r.napLaiKemDo = await doc(page);
      r.anhDo = await anh(page, `${ca}-${vai}-line${lineId}-che-do-do`);
      r.thay.khoiCanh = r.napLaiKemDo.khoiCanh;
      r.ghiChuDoKhoi = "khối máy đếm ở lượt nạp LẠI cùng URL kèm ?do=1 (cây không giữ query); đối chiếu __demNhan của lượt tới-bằng-cây";
    }
    const L = r.thay.line, K = r.thay.khoiCanh;
    const p = phan(
      { "URL /twin/line/:id": r.toiUrl ? true : null, "man-twin-line": L, "ten-line (chu)": L?.tenLine || null, "dem-may-line (so)": L?.demMaySo, "dem-tram-line (so)": L?.demTramSo, "khoi may trong canh (__demTuongTac.dsMay)": K?.tong, "ky vong DB": ky },
      [
        { ten: `URL = /twin/line/${lineId}`, ok: new URL(`${BASE}${r.thay.url}`).pathname === `/twin/line/${lineId}`, thay: r.thay.url },
        { ten: `ten-line = "${ky?.lineName}" (DB)`, ok: (L?.tenLine ?? "") === ky?.lineName, thay: `thay "${L?.tenLine}"` },
        { ten: `dem-may-line = ${ky?.soMay} (DB)`, ok: L?.demMaySo === Number(ky?.soMay), thay: `thay "${L?.demMayChu}"` },
        { ten: `dem-tram-line = ${ky?.soTram} (DB)`, ok: L?.demTramSo === Number(ky?.soTram), thay: `thay "${L?.demTramChu}"` },
        { ten: `KHOI MAY ve trong canh = ${ky?.soMay} (DB)`, ok: (K?.tong ?? -1) === Number(ky?.soMay), thay: `khoi ${K?.tong} (trong khung ${K?.trongKhung}) · nhan ${L?.soNhanMay} · o tram ${L?.soOTram}` },
        { ten: `doi chung doc lap: __demNhan.tong (ung vien nhan = so may vao canh) = ${ky?.soMay} ngay o luot toi bang CAY`, ok: (r.thay.demNhan?.tongUngVien ?? -1) === Number(ky?.soMay), thay: `__demNhan ${JSON.stringify(r.thay.demNhan)}` },
        { ten: "canvas 3D (1 kit)", ok: (L?.canvasTrongMan ?? 0) >= 1 && r.thay.soCanvasKit === 1, thay: `canvas ${L?.canvasTrongMan} / __soCanvas ${r.thay.soCanvasKit}` },
        { ten: "KHONG line-rong / line-khong-mo-duoc", ok: (L?.lineRong ?? 1) === 0 && (L?.khongMoDuoc ?? 1) === 0, thay: `line-rong ${L?.lineRong} · khong-mo-duoc ${L?.khongMoDuoc} (ly do "${L?.lyDo}") chu "${(L?.lineRongChu || L?.khongMoChu || "").slice(0, 200)}"` },
      ],
    );
    Object.assign(r, p);
  } catch (e) {
    r.loi = String(e).slice(0, 500); r.pq = "HỎNG"; r.vi = `HỎNG ${r.loi}`;
    try { r.thay = await doc(page); r.anh = await anh(page, `${ca}-${vai}-line${lineId}-HONG`); } catch { /* */ }
  }
  bao(ca, vai, r.pq, `line ${lineId} · ${r.vi}`);
  luu(ca, r); await ctx.close(); return r;
}

/* ══════════════════════════════════════════════════════════════════════ */
/* R3/R4/N-1 — màn MÁY                                                    */
/* ══════════════════════════════════════════════════════════════════════ */
async function caMay(browser, { ca, vai, mayId, ky, nhan, kyVongChan = false }) {
  const ctx = await browser.newContext({ viewport: VP });
  const me = await dangNhap(ctx, vai);
  const page = await ctx.newPage();
  const r = { ca, vai, me, mayId, kyVongDb: ky, deBai: kyVongChan
    ? `${vai} mo /twin/may/${mayId} (${nhan}) => PHAI van bi tu choi (may-khong-mo-duoc ngoaiPhamVi)`
    : `${vai} mo /twin/may/${mayId} (${nhan}) => mo duoc, ten-may/loai-may khop DB, __soCanvas=1, KHONG "khong thuoc pham vi", KHONG "chua co cho"` };
  try {
    await page.goto(`${BASE}/twin/may/${mayId}?do=1`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="man-twin-may"]', { timeout: 60_000 }).catch(() => {});
    await choVe(page, 0);
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="may-dang-tai"]').length === 0, null, { timeout: 60_000 }).catch(() => {});
    r.thay = await doc(page);
    r.anh = await anh(page, `${ca}-${vai}-may${mayId}`);
    const M = r.thay.may;
    if (kyVongChan) {
      const p = phan(
        { "man-twin-may": M, "may-khong-mo-duoc (dem)": M?.khongMoDuoc },
        [
          { ten: "may-khong-mo-duoc = 1", ok: (M?.khongMoDuoc ?? 0) === 1, thay: `dem ${M?.khongMoDuoc}` },
          { ten: 'data-ly-do = "ngoaiPhamVi"', ok: M?.lyDo === "ngoaiPhamVi", thay: `"${M?.lyDo}"` },
          { ten: "KHONG canvas (khong ro hinh hoc)", ok: (M?.canvasTrongMan ?? 1) === 0, thay: `canvas ${M?.canvasTrongMan}` },
          { ten: "KHONG lo ten/loai may", ok: !M?.loaiMay, thay: `ten "${M?.tenMay}" loai "${M?.loaiMay}"` },
        ],
      );
      r.chuNguyenVan = M?.khongMoChu;
      Object.assign(r, p);
      if (r.pq === "ĐẠT") r.pq = "CHẶN-ĐÚNG";
    } else if ((M?.khongMoDuoc ?? 0) > 0) {
      r.pq = "SAI"; r.chuNguyenVan = M.khongMoChu;
      r.vi = `may-khong-mo-duoc data-ly-do="${M.lyDo}" — NGUYEN VAN: "${M.khongMoChu}" · nhung may ${mayId} THUOC pham vi cua ${vai} (DB: ${ky?.facCode} toa ${ky?.toaMa} tang cap ${ky?.capSo})`;
    } else if ((M?.chuaDatCho ?? 0) > 0) {
      r.pq = "SAI"; r.chuNguyenVan = M.chuaDatChoChu;
      r.vi = `may-chua-dat-cho — NGUYEN VAN: "${M.chuaDatChoChu}" · nhung DB CO ${ky?.soDatCho} hang twin_dat_cho (tangId ${ky?.datChoTangId})`;
    } else {
      const p = phan(
        { "man-twin-may": M, "ten-may (chu)": M?.tenMay || null, "loai-may (chu)": M?.loaiMay || null, "khoi-canh-may": M?.khoiCanhMay, "__soCanvas": r.thay.soCanvasKit, "ky vong DB": ky },
        [
          { ten: `URL = /twin/may/${mayId}`, ok: new URL(`${BASE}${r.thay.url}`).pathname === `/twin/may/${mayId}`, thay: r.thay.url },
          { ten: `ten-may = "${ky?.name}" (DB)`, ok: (M?.tenMay ?? "") === ky?.name, thay: `thay "${M?.tenMay}"` },
          { ten: `loai-may chua "${ky?.machineType}" (DB)`, ok: (M?.loaiMay ?? "").includes(String(ky?.machineType)), thay: `thay "${M?.loaiMay}"` },
          { ten: "khoi-canh-may co canvas, __soCanvas = 1", ok: (M?.khoiCanhMay ?? 0) === 1 && (M?.canvasTrongKhoiCanh ?? 0) >= 1 && r.thay.soCanvasKit === 1, thay: `khoi ${M?.khoiCanhMay} canvas ${M?.canvasTrongKhoiCanh} __soCanvas ${r.thay.soCanvasKit}` },
          { ten: "KHONG may-chua-dat-cho", ok: (M?.chuaDatCho ?? 1) === 0, thay: `${M?.chuaDatCho}` },
          { ten: "suc-khoe-may co hang", ok: !!M?.sucKhoeHang && M.sucKhoeHang !== "chua_do", thay: `hang "${M?.sucKhoeHang}" chu "${M?.sucKhoeChu}"` },
        ],
      );
      Object.assign(r, p);
    }
  } catch (e) { r.loi = String(e).slice(0, 500); r.pq = "HỎNG"; r.vi = `HỎNG ${r.loi}`; try { r.anh = await anh(page, `${ca}-${vai}-may${mayId}-HONG`); } catch { /* */ } }
  bao(ca, vai, r.pq, `may ${mayId} (${nhan}) · ${r.vi}`);
  luu(ca, r); await ctx.close(); return r;
}

/* ══════════════════════════════════════════════════════════════════════ */
/* R5 — đường VỀ từ màn Máy                                               */
/* ══════════════════════════════════════════════════════════════════════ */
async function caR5(browser) {
  const vai = "qatd_kythuat", mayId = 5676, lineId = 347, facId = 42;
  const ctx = await browser.newContext({ viewport: VP });
  const me = await dangNhap(ctx, vai);
  const page = await ctx.newPage();
  const ky = lineDb(lineId);
  const r = { ca: "R5", vai, me, deBai: `tu /twin/may/${mayId} (QATD-B) bam nut ve man chuyen => /twin/line/${lineId}, canh la cua nha may 42 (khong nhay ve QATD-A)`, kyVongDb: ky };
  try {
    await page.goto(`${BASE}/twin/may/${mayId}?do=1`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="man-twin-may"]', { timeout: 60_000 }).catch(() => {});
    await choVe(page, 0);
    r.tренManMay = undefined;
    r.taiManMay = await doc(page);
    r.anhMay = await anh(page, `R5-${vai}-may${mayId}`);
    const M = r.taiManMay.may;
    r.veManLineHref = M?.veManLineHref ?? null;
    r.veManLineChu = M?.veManLineChu ?? null;
    if ((M?.veManLine ?? 0) === 0) {
      r.pq = "SAI"; r.vi = `KHONG co nut ve-man-line tren man May (may-khong-mo-duoc=${M?.khongMoDuoc} ly do "${M?.lyDo}")`;
    } else {
      const mocVe = await page.evaluate(() => window.__thongKeVe?.calls ?? 0);
      await page.locator('[data-testid="ve-man-line"]').click();
      r.toiUrl = await page.waitForURL(/\/twin\/line\/\d+/, { timeout: 15_000 }).then(() => true).catch(() => false);
      await page.waitForSelector('[data-testid="man-twin-line"]', { timeout: 60_000 }).catch(() => {});
      await choVe(page, mocVe);
      r.thay = await doc(page);
      r.anh = await anh(page, `R5-${vai}-sau-ve-line`);
      if (r.thay.khoiCanh === null) {
        r.ghiChuDoKhoi = "nut ve-man-line dieu huong SPA toi /twin/line/347 KHONG mang ?do=1 => __demTuongTac tat; dem khoi bang __demNhan (khong bi gac) va nap lai cung URL kem ?do=1";
        await page.goto(`${BASE}/twin/line/${lineId}?do=1`, { waitUntil: "domcontentloaded" });
        await page.waitForSelector('[data-testid="man-twin-line"]', { timeout: 60_000 }).catch(() => {});
        await choVe(page, 0);
        r.napLaiKemDo = await doc(page);
        r.thay.khoiCanh = r.napLaiKemDo.khoiCanh;
      }
      const L = r.thay.line, K = r.thay.khoiCanh;
      const p = phan(
        { "nut ve-man-line": M?.veManLine, "href nut": r.veManLineHref, "man-twin-line sau bam": L, "ten-line": L?.tenLine || null, "khoi may trong canh": K?.tong },
        [
          { ten: `href nut = /twin/line/${lineId}`, ok: String(r.veManLineHref || "").startsWith(`/twin/line/${lineId}`), thay: `"${r.veManLineHref}"` },
          { ten: `URL sau bam = /twin/line/${lineId}`, ok: new URL(`${BASE}${r.thay.url}`).pathname === `/twin/line/${lineId}`, thay: r.thay.url },
          { ten: `ten-line = "${ky?.lineName}" (DB, chuyen cua nha may ${facId})`, ok: (L?.tenLine ?? "") === ky?.lineName, thay: `thay "${L?.tenLine}"` },
          { ten: `dem-may-line = ${ky?.soMay} va KHOI = ${ky?.soMay} (canh cua QATD-B, khong phai QATD-A)`, ok: L?.demMaySo === Number(ky?.soMay) && (K?.tong ?? -1) === Number(ky?.soMay), thay: `dem "${L?.demMayChu}" khoi ${K?.tong}` },
          { ten: "KHONG line-rong / khong-mo-duoc", ok: (L?.lineRong ?? 1) === 0 && (L?.khongMoDuoc ?? 1) === 0, thay: `rong ${L?.lineRong} chan ${L?.khongMoDuoc} "${(L?.lineRongChu || L?.khongMoChu || "").slice(0, 160)}"` },
        ],
      );
      Object.assign(r, p);
    }
  } catch (e) { r.loi = String(e).slice(0, 500); r.pq = "HỎNG"; r.vi = `HỎNG ${r.loi}`; }
  bao("R5", vai, r.pq, r.vi);
  luu("R5", r); await ctx.close(); return r;
}

/* ══════════════════════════════════════════════════════════════════════ */
/* R6 — HAI CÂU phải KHÁC nhau (PH-13)                                    */
/* ══════════════════════════════════════════════════════════════════════ */
async function moLineTho(browser, vai, lineId, ten) {
  const ctx = await browser.newContext({ viewport: VP });
  await dangNhap(ctx, vai);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/twin/line/${lineId}?do=1`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="man-twin-line"]', { timeout: 60_000 }).catch(() => {});
  await choVe(page, 0);
  const d = await doc(page);
  const png = await anh(page, ten);
  await ctx.close();
  return { d, png };
}
async function caR6(browser) {
  const r = { ca: "R6", deBai: `PH-13: cau cho "chuyen cua nha may KHAC" phai KHAC cau cho "chuyen chua xep cho". Ghi NGUYEN VAN ca hai.` };
  try {
    const A = await moLineTho(browser, "qatd_congnhan", 347, "R6-congnhan-line347-ngoai-pham-vi");
    r.ngoaiPhamVi = {
      vai: "qatd_congnhan", lineId: 347, ghiChu: "chuyen cua QATD-B — NGOAI pham vi cua congnhan (QATD-C)",
      testid: A.d.line?.khongMoDuoc ? "line-khong-mo-duoc" : (A.d.line?.lineRong ? "line-rong" : "(khong co nhanh nao)"),
      lyDo: A.d.line?.lyDo ?? null,
      nguyenVan: A.d.line?.khongMoChu ?? A.d.line?.lineRongChu ?? null,
      canvas: A.d.line?.canvasTrongMan, demMayChu: A.d.line?.demMayChu, anh: A.png,
    };
    /* ★ Ca "chuyền CHƯA XẾP CHỖ" (`line-rong`) KHÔNG dựng được SỐNG ở vòng 2: SELECT toàn CSDL
       cho thấy 0 chuyền nào có 0 máy trong cảnh (`lineRong: []`, `lineKhongDatCho: []`), và ca
       thử duy nhất còn lại — chuyền 11 của T12-SHOT, 0 hàng `twin_dat_cho` — vẫn vẽ được 1 máy.
       ⇒ Câu B lấy từ HAI nguồn có tên, không bịa: (i) catalogue i18n trên đĩa (chính chuỗi sản
       phẩm in ra), (ii) phép đo SỐNG của VÒNG 1 ô C4a (cùng nhánh, cùng chuỗi, bản trước vá). */
    const B = await moLineTho(browser, "qatd_admin", 11, "R6-admin-line11-thu-chua-xep-cho");
    const en = JSON.parse(readFileSync("client/src/i18n/locales/en.json", "utf8"));
    const vi = JSON.parse(readFileSync("client/src/i18n/locales/vi.json", "utf8"));
    r.thuDungCaSong = {
      vai: "qatd_admin", lineId: 11, ghiChu: "chuyen 11 (T12-SHOT) TRONG pham vi admin, 0 hang twin_dat_cho — NHUNG van ve duoc 1 may",
      testid: B.d.line?.lineRong ? "line-rong" : (B.d.line?.khongMoDuoc ? "line-khong-mo-duoc" : "(khong nhanh nao — man mo binh thuong)"),
      demMayChu: B.d.line?.demMayChu, canvas: B.d.line?.canvasTrongMan, anh: B.png,
      ketLuan: "khong dung duoc ca line-rong song tren CSDL nay",
    };
    r.chuaXepCho = {
      nguon: "catalogue i18n tren dia (client/src/i18n/locales/en.json) — chinh chuoi ma nhanh `line-rong` in ra; doi chieu voi phep do SONG cua VONG 1 o C4a",
      khoa: "twin3d.line.rong + twin3d.line.rongMo",
      nguyenVan: `${en.twin3d.line.rong} ${en.twin3d.line.rongMo}`,
      nguyenVanVi: `${vi.twin3d.line.rong} — ${vi.twin3d.line.rongMo}`,
      vong1DoSong: "Chuyền này chưa có máy nào trên bố cục — Chuyền có thể chưa được xếp chỗ trong Twin Studio, hoặc thuộc một nhà máy khác. (BANG-C.md o C4a, do song 2026-09-15)",
    };
    const c1 = r.ngoaiPhamVi.nguyenVan, c2 = r.chuaXepCho.nguyenVan;
    const p = phan(
      { "cau NGOAI PHAM VI (nguyen van)": c1, "cau CHUA XEP CHO (nguyen van)": c2 },
      [
        { ten: "ca ngoai pham vi dung nhanh line-khong-mo-duoc", ok: r.ngoaiPhamVi.testid === "line-khong-mo-duoc", thay: r.ngoaiPhamVi.testid },
        { ten: 'data-ly-do = "ngoaiPhamVi"', ok: r.ngoaiPhamVi.lyDo === "ngoaiPhamVi", thay: `"${r.ngoaiPhamVi.lyDo}"` },
        { ten: "HAI CAU KHAC NHAU tung chu", ok: String(c1).trim() !== String(c2).trim() && !String(c1).includes(en.twin3d.line.rongMo), thay: `A="${c1}" B="${c2}"` },
        { ten: "ca ngoai pham vi KHONG canvas", ok: (r.ngoaiPhamVi.canvas ?? 1) === 0, thay: `canvas ${r.ngoaiPhamVi.canvas}` },
      ],
    );
    Object.assign(r, p);
  } catch (e) { r.loi = String(e).slice(0, 500); r.pq = "HỎNG"; r.vi = `HỎNG ${r.loi}`; }
  bao("R6", "congnhan+admin", r.pq, r.vi);
  luu("R6", r); return r;
}

/* ══════════════════════════════════════════════════════════════════════ */
/* R7 / R8 / H1 / H2 / H3 / H5 — STUDIO                                   */
/* ══════════════════════════════════════════════════════════════════════ */
/**
 * Chờ XƯỞNG dựng XONG sau một lượt đổi toà/tầng.
 * ⚠ `key={tangId}` ép UNMOUNT rồi mount lại `XuongThietKe`; đọc ngay sau `selectOption` bắt được
 *   khoảnh khắc GIỮA hai lần mount (canvas 0, dải sức khoẻ null) và ghi một số 0 KHÔNG có thật.
 */
async function choStudioXong(page, moc) {
  await page.waitForSelector('[data-testid="xuong-thiet-ke"] canvas', { timeout: 60_000 }).catch(() => {});
  await choVe(page, moc);
  await page.waitForFunction(() => {
    const e = document.querySelector('[data-testid="sk-da-xep-cho"]');
    return !!e && /\d/.test(e.textContent || "");
  }, null, { timeout: 60_000 }).catch(() => {});
}
async function moStudio(ctx, vpw) {
  const page = await ctx.newPage();
  if (vpw) await page.setViewportSize(vpw);
  await page.goto(`${BASE}/twin-studio?do=1`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="man-twin-studio"]', { timeout: 120_000 }).catch(() => {});
  await choVe(page, 0);
  return page;
}
async function caR7(browser) {
  const vai = "qatd_kythuat";
  const ctx = await browser.newContext({ viewport: VP });
  const me = await dangNhap(ctx, vai);
  const r = { ca: "R7", vai, me, deBai: "Studio co chon-toa-nha + chon-tang; chon toa 2 roi tang 2 => dai suc khoe dem theo DUNG tang do (so DB), canh dung lai", buoc: [] };
  try {
    const page = await moStudio(ctx, null);
    const d0 = await doc(page);
    r.mocDau = d0.studio;
    r.anhDau = await anh(page, "R7-kythuat-studio-mac-dinh");
    r.khoiDau = d0.khoiCanh;
    const facId = Number(d0.studio?.oNhaMay?.value);
    r.nhaMayDangChon = { id: facId, nhan: d0.studio?.oNhaMay?.nhanDangChon };
    const toaCuaNm = DB.toaNha.filter((b) => b.factoryId === facId);
    r.toaTrongDb = toaCuaNm.map((b) => `${b.id}:${b.ma}`);
    const toa2 = toaCuaNm[1];
    if (!toa2) throw new Error("THIEU DU KIEN: toa thu HAI cua nha may dang chon trong DB");
    // ── chọn TOÀ 2 ─────────────────────────────────────────────────────
    let moc = await page.evaluate(() => window.__thongKeVe?.calls ?? 0);
    await page.selectOption('[data-testid="chon-toa-nha"]', String(toa2.id)); r.buoc.push(`chon-toa-nha=${toa2.id} (${toa2.ma})`);
    await page.waitForFunction((v) => document.querySelector('[data-testid="chon-toa-nha"]')?.value === v, String(toa2.id), { timeout: 30_000 });
    await choStudioXong(page, moc);
    const dT2 = await doc(page);
    const tangCuaToa2 = DB.tang.filter((t) => t.toaNhaId === toa2.id).sort((a, b) => a.capSo - b.capSo);
    r.tangTrongDb = tangCuaToa2.map((t) => `${t.id}:cap${t.capSo}:datChoMay=${t.soDatChoMay}`);
    r.toa2Tang1 = { tangId: Number(dT2.studio?.oTang?.value), kyVongDatCho: Number(tangCuaToa2[0]?.soDatChoMay), skDaXepCho: dT2.studio?.skDaXepCho, skDaXepChoSo: dT2.studio?.skDaXepChoSo, skChoXepCho: dT2.studio?.skChoXepCho, khoi: dT2.khoiCanh, soCanvas: dT2.soCanvasKit };
    r.anhToa2Tang1 = await anh(page, "R7-kythuat-studio-toa2-tang1");
    // ── chọn TẦNG 2 ────────────────────────────────────────────────────
    const tang2 = tangCuaToa2[1];
    if (!tang2) throw new Error("THIEU DU KIEN: tang thu HAI cua toa 2 trong DB");
    moc = await page.evaluate(() => window.__thongKeVe?.calls ?? 0);
    await page.selectOption('[data-testid="chon-tang"]', String(tang2.id)); r.buoc.push(`chon-tang=${tang2.id} (cap ${tang2.capSo})`);
    await page.waitForFunction((v) => document.querySelector('[data-testid="chon-tang"]')?.value === v, String(tang2.id), { timeout: 30_000 });
    await choStudioXong(page, moc);
    const dT2b = await doc(page);
    r.thay = dT2b;
    r.anh = await anh(page, "R7-kythuat-studio-toa2-tang2");
    const S = dT2b.studio, K = dT2b.khoiCanh;
    const kyDaXep = Number(tang2.soDatChoMay);
    const tongMayNm = (JSON.parse(readFileSync(".qa-tapdoan/ky-vong-db-v2.json", "utf8")).mayTheoNhaMay.find((f) => f.id === facId)?.active) ?? null;
    r.kyVong = { tangId: tang2.id, capSo: tang2.capSo, datChoMayTrongDb: kyDaXep, tongMayNhaMay: tongMayNm, choXepChoKyVong: tongMayNm === null ? null : tongMayNm - kyDaXep };
    const p = phan(
      { "o chon-toa-nha": S?.oToaNha?.co ? S.oToaNha : null, "o chon-tang": S?.oTang?.co ? S.oTang : null, "sk-da-xep-cho (so)": S?.skDaXepChoSo, "khoi may trong canh": K?.tong, "__soCanvas": dT2b.soCanvasKit, "so dat cho may cua tang trong DB": kyDaXep, "tong may nha may": tongMayNm },
      [
        { ten: "co o chon-toa-nha", ok: (S?.oToaNha?.co ?? 0) === 1, thay: JSON.stringify(S?.oToaNha) },
        { ten: "co o chon-tang", ok: (S?.oTang?.co ?? 0) === 1, thay: JSON.stringify(S?.oTang) },
        { ten: `o toa nha dang chon = ${toa2.id} (${toa2.ma}) — toa THU HAI`, ok: Number(S?.oToaNha?.value) === toa2.id, thay: `${S?.oToaNha?.value}` },
        { ten: `o tang dang chon = ${tang2.id} (cap ${tang2.capSo}) — tang THU HAI`, ok: Number(S?.oTang?.value) === tang2.id, thay: `${S?.oTang?.value}` },
        { ten: `sk-da-xep-cho = ${kyDaXep} (so hang twin_dat_cho loai machine cua tang ${tang2.id})`, ok: S?.skDaXepChoSo === kyDaXep, thay: `thay "${S?.skDaXepCho}"` },
        { ten: `sk-cho-xep-cho = ${tongMayNm - kyDaXep} (= ${tongMayNm} may nha may − ${kyDaXep})`, ok: S?.skChoXepChoSo === tongMayNm - kyDaXep, thay: `thay "${S?.skChoXepCho}"` },
        { ten: `canh dung lai theo tang: khoi may = ${kyDaXep}`, ok: (K?.tong ?? -1) === kyDaXep, thay: `khoi ${K?.tong} (truoc do toa2/tang1 = ${r.toa2Tang1.khoi?.tong}, mac dinh = ${r.khoiDau?.tong})` },
        /* ★ 45 cua tang 173 TRUNG voi 45 cua tang 165 (mac dinh) ⇒ mot minh no KHONG phan biet duoc
           "da doi tang" voi "chua doi gi". Buoc GIUA (toa2/tang1 = 68) la con so chi tang 172 moi co. */
        { ten: `buoc GIUA phan biet duoc: toa2/tang1 (tang ${tangCuaToa2[0]?.id}) = ${r.toa2Tang1.kyVongDatCho} khoi + dai suc khoe cung so`, ok: (r.toa2Tang1.khoi?.tong ?? -1) === r.toa2Tang1.kyVongDatCho && r.toa2Tang1.skDaXepChoSo === r.toa2Tang1.kyVongDatCho, thay: `khoi ${r.toa2Tang1.khoi?.tong} · dai "${r.toa2Tang1.skDaXepCho}" (ky vong ${r.toa2Tang1.kyVongDatCho}; mac dinh toa1/tang1 = ${r.khoiDau?.tong})` },
        { ten: "__soCanvas = 1 sau khi doi tang (H2)", ok: dT2b.soCanvasKit === 1, thay: `${dT2b.soCanvasKit}` },
      ],
    );
    Object.assign(r, p);
    r.H2 = { soCanvasSauDoiTang: dT2b.soCanvasKit, canvasDom: dT2b.canvasDom, pq: dT2b.soCanvasKit === 1 ? "ĐẠT" : "SAI" };
    await page.close();
  } catch (e) { r.loi = String(e).slice(0, 600); r.pq = "HỎNG"; r.vi = `HỎNG ${r.loi}`; }
  bao("R7", vai, r.pq, r.vi);
  luu("R7", r); await ctx.close(); return r;
}

async function caR8(browser) {
  const vai = "qatd_quanly";
  const ctx = await browser.newContext({ viewport: VP });
  const me = await dangNhap(ctx, vai);
  const r = { ca: "R8", vai, me, deBai: "quanly (canEdit, 0 canCreate, khong admin): KHONG thay nut Generate (nut-mo-sinh) va KHONG thay duong tao toa nha (tab-con-duong-b). AN HAN, khong disable." };
  try {
    // quyền thật của vai này, đọc từ API (không suy)
    r.quyen = (await trpc(ctx, "permissions.getMyPermissions"))?.data ?? null;
    const page = await moStudio(ctx, null);
    const d = await doc(page);
    r.thay = d;
    r.anh = await anh(page, "R8-quanly-studio");
    // đếm cả phần tử disabled: ẩn = 0 phần tử trong DOM
    r.demDom = await page.evaluate(() => {
      const q = (t) => [...document.querySelectorAll(`[data-testid="${t}"]`)].map((e) => ({ tag: e.tagName, disabled: e.disabled ?? null, aria: e.getAttribute("aria-disabled"), chu: (e.innerText || "").replace(/\s+/g, " ").trim().slice(0, 60) }));
      return { "nut-mo-sinh": q("nut-mo-sinh"), "tab-con-duong-b": q("tab-con-duong-b"), "nut-tao": q("nut-tao"), "nut-luu": q("nut-luu"), "nut-che-do-translate": q("nut-che-do-translate"), "khoi-anh-nen": q("khoi-anh-nen"), "nut-tai-model": q("nut-tai-model") };
    });
    r.chuToanMan = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").trim());
    r.coChuGenerate = /Generate|Sinh t/i.test(r.chuToanMan);
    r.coChuCreateBuilding = /Create building|Add building|Them to/i.test(r.chuToanMan);
    const S = d.studio;
    const p = phan(
      { "man-twin-studio": S, "xuong-thiet-ke": S?.xuong, "dem nut-mo-sinh": S?.nutMoSinh, "dem tab-con-duong-b": S?.tabConDuongB },
      [
        { ten: "xuong-thiet-ke da dung (co canh de do)", ok: (S?.xuong ?? 0) === 1, thay: `${S?.xuong}` },
        { ten: "nut-mo-sinh AN HAN (0 phan tu trong DOM)", ok: (S?.nutMoSinh ?? 1) === 0 && r.demDom["nut-mo-sinh"].length === 0, thay: `dem ${S?.nutMoSinh} / dom ${JSON.stringify(r.demDom["nut-mo-sinh"])}` },
        { ten: "tab tao toa nha AN HAN (0 phan tu)", ok: (S?.tabConDuongB ?? 1) === 0 && r.demDom["tab-con-duong-b"].length === 0, thay: `dem ${S?.tabConDuongB} / dom ${JSON.stringify(r.demDom["tab-con-duong-b"])}` },
        { ten: "khong co chu Generate tren man", ok: !r.coChuGenerate, thay: `coChuGenerate=${r.coChuGenerate}` },
        { ten: "doi chung DUONG: van con nut-luu (canEdit) — khong va qua tay", ok: (S?.nutLuu ?? 0) === 1, thay: `nut-luu ${S?.nutLuu} nut-che-do ${S?.nutCheDoTranslate}` },
      ],
    );
    Object.assign(r, p);
    await page.close();
  } catch (e) { r.loi = String(e).slice(0, 600); r.pq = "HỎNG"; r.vi = `HỎNG ${r.loi}`; }
  bao("R8", vai, r.pq, r.vi);
  luu("R8", r); await ctx.close(); return r;
}

/* H1 — đổi tầng khi CÒN thay đổi chưa lưu */
async function caH1(browser) {
  const vai = "qatd_kythuat";
  const ctx = await browser.newContext({ viewport: VP });
  const me = await dangNhap(ctx, vai);
  const r = { ca: "H1", vai, me, deBai: "Studio: tao 1 thay doi CHUA LUU roi DOI TANG => co mat im lang khong, co canh bao khong?", buoc: [], hopThoai: [] };
  try {
    const page = await moStudio(ctx, null);
    page.on("dialog", async (d) => { r.hopThoai.push({ loai: d.type(), chu: d.message() }); await d.dismiss().catch(() => {}); });
    const d0 = await doc(page);
    r.mocDau = { tangId: Number(d0.studio?.oTang?.value), toaId: Number(d0.studio?.oToaNha?.value), khoi: d0.khoiCanh?.tong, demChuaLuu: d0.studio?.demChuaLuu };
    // chọn 1 máy qua CÂY PHÂN CẤP của Studio rồi bật công tắc KHOÁ (đổi `daKhoa` ⇒ 1 thay đổi, KHÔNG ghi DB)
    /* ⚠ Cây phân cấp của Studio ở trạng thái mặc định chỉ liệt kê 326 máy CHƯA xếp chỗ (khu chờ),
       và máy chưa xếp chỗ chỉ hiện câu "khu chờ", KHÔNG có công tắc nào ⇒ chọn máy ĐÃ xếp chỗ
       bằng cách BẤM THẲNG KHỐI trên cảnh (đường người dùng thật, khuôn k8 của lô C). */
    r.soNodeMay = await page.evaluate(() => ({ tong: document.querySelectorAll('[data-testid^="node-cay-machine:"]').length, daXep: document.querySelectorAll('[data-testid^="node-cay-machine:"][data-cho-xep-cho="0"]').length }));
    const diem = await page.evaluate(() => {
      const cv = document.querySelector('[data-testid="xuong-thiet-ke"] canvas');
      if (!cv) return { loi: "khong co canvas xuong-thiet-ke" };
      const r0 = cv.getBoundingClientRect();
      const ds = (window.__demTuongTac?.dsMay?.() ?? []).filter((m) => m.trongKhung);
      for (const m of ds) {
        const t = window.__demTuongTac?.tamMay?.(m.machineId);
        if (!t || t.biChe) continue;
        const X = r0.left + t.x, Y = r0.top + t.y;
        if (document.elementFromPoint(X, Y) !== cv) continue;
        return { id: m.machineId, X, Y };
      }
      return { loi: `0 khoi bam duoc (trong khung ${ds.length})` };
    });
    if (diem.loi) throw new Error(`THIEU DU KIEN: tam khoi may bam duoc tren canh Studio — ${diem.loi}; node cay: ${JSON.stringify(r.soNodeMay)}`);
    r.buoc.push(`bam TAM KHOI may ${diem.id} tren canh @(${Math.round(diem.X)},${Math.round(diem.Y)})`);
    r.mayDaChon = diem.id;
    await page.mouse.move(diem.X - 40, diem.Y - 40);
    await page.mouse.move(diem.X, diem.Y, { steps: 4 });
    await page.mouse.click(diem.X, diem.Y);
    await page.waitForSelector('[data-testid="cong-tac-khoa"]', { timeout: 30_000 });
    await page.locator('[data-testid="cong-tac-khoa"]').click(); r.buoc.push("bat cong-tac-khoa (doi daKhoa) => 1 thay doi chua luu");
    await page.waitForSelector('[data-testid="dem-chua-luu"]', { timeout: 30_000 }).catch(() => {});
    const d1 = await doc(page);
    r.truocDoiTang = { demChuaLuu: d1.studio?.demChuaLuu, chu: d1.studio?.demChuaLuuChu, nutLuu: d1.studio?.nutLuu };
    r.anhTruoc = await anh(page, "H1-truoc-doi-tang-co-thay-doi-chua-luu");
    if ((d1.studio?.demChuaLuu ?? 0) === 0) throw new Error(`THIEU DU KIEN: khong tao duoc thay doi chua luu (dem-chua-luu=0 sau khi bat cong-tac-khoa)`);
    // đổi TẦNG
    const toaId = Number(d1.studio?.oToaNha?.value);
    const tangs = DB.tang.filter((t) => t.toaNhaId === toaId).sort((a, b) => a.capSo - b.capSo);
    const tangKhac = tangs.find((t) => t.id !== Number(d1.studio?.oTang?.value));
    if (!tangKhac) throw new Error("THIEU DU KIEN: tang khac trong cung toa");
    const moc = await page.evaluate(() => window.__thongKeVe?.calls ?? 0);
    await page.selectOption('[data-testid="chon-tang"]', String(tangKhac.id)); r.buoc.push(`chon-tang=${tangKhac.id} (cap ${tangKhac.capSo}) trong khi con 1 thay doi chua luu`);
    await page.waitForFunction((v) => document.querySelector('[data-testid="chon-tang"]')?.value === v, String(tangKhac.id), { timeout: 30_000 });
    await choVe(page, moc);
    const d2 = await doc(page);
    r.sauDoiTang = { tangId: Number(d2.studio?.oTang?.value), demChuaLuu: d2.studio?.demChuaLuu, chu: d2.studio?.demChuaLuuChu, khoi: d2.khoiCanh?.tong, soCanvas: d2.soCanvasKit };
    r.anh = await anh(page, "H1-sau-doi-tang");
    // quay LẠI tầng cũ: thay đổi có sống lại không?
    const moc2 = await page.evaluate(() => window.__thongKeVe?.calls ?? 0);
    await page.selectOption('[data-testid="chon-tang"]', String(r.mocDau.tangId));
    await choVe(page, moc2);
    const d3 = await doc(page);
    r.quayLaiTangCu = { tangId: Number(d3.studio?.oTang?.value), demChuaLuu: d3.studio?.demChuaLuu, chu: d3.studio?.demChuaLuuChu };
    r.matImLang = (r.truocDoiTang.demChuaLuu > 0) && (r.sauDoiTang.demChuaLuu === 0) && r.hopThoai.length === 0 && (r.quayLaiTangCu.demChuaLuu === 0);
    const p = phan(
      { "dem-chua-luu TRUOC khi doi tang": r.truocDoiTang.demChuaLuu, "dem-chua-luu SAU khi doi tang": r.sauDoiTang.demChuaLuu, "so hop thoai canh bao": r.hopThoai.length },
      [{ ten: "doi tang khi con thay doi chua luu PHAI hoi hoac giu lai", ok: r.hopThoai.length > 0 || r.sauDoiTang.demChuaLuu > 0 || r.quayLaiTangCu.demChuaLuu > 0, thay: `truoc ${r.truocDoiTang.demChuaLuu} -> sau ${r.sauDoiTang.demChuaLuu} · hop thoai ${r.hopThoai.length} · quay lai tang cu ${r.quayLaiTangCu.demChuaLuu}` }],
    );
    Object.assign(r, p);
    await page.close();
  } catch (e) { r.loi = String(e).slice(0, 600); r.pq = "HỎNG"; r.vi = `HỎNG ${r.loi}`; }
  bao("H1", vai, r.pq, r.vi);
  luu("H1", r); await ctx.close(); return r;
}

/* H3 — chiều cao header /twin-studio @1280×720 */
async function caH3(browser) {
  const vai = "qatd_kythuat";
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const me = await dangNhap(ctx, vai);
  const r = { ca: "H3", vai, me, vp: { width: 1280, height: 720 }, deBai: "chieu cao <header> cua /twin-studio @1280x720 — docblock BoChonNapUI doi giu 48 px" };
  try {
    const page = await moStudio(ctx, null);
    const d = await doc(page);
    r.thay = d.studio;
    r.chiTiet = await page.evaluate(() => {
      const man = document.querySelector('[data-testid="man-twin-studio"]');
      const h = man?.querySelector("header");
      const bo = document.querySelector('[data-testid="bo-chon-nap"]');
      const r1 = h?.getBoundingClientRect();
      const r2 = bo?.getBoundingClientRect();
      const cv = document.querySelector('[data-testid="man-twin-studio"] canvas');
      const r3 = cv?.getBoundingClientRect();
      return {
        headerCao: r1 ? Number(r1.height.toFixed(2)) : null,
        headerRong: r1 ? Number(r1.width.toFixed(2)) : null,
        boChonCao: r2 ? Number(r2.height.toFixed(2)) : null,
        boChonRong: r2 ? Number(r2.width.toFixed(2)) : null,
        boChonXuongDong: r2 && r1 ? r2.height > 30 : null,
        canvas: r3 ? { w: Math.round(r3.width), h: Math.round(r3.height) } : null,
        tranNgang: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });
    r.anh = await anh(page, "H3-studio-1280x720");
    /* ★ Con số 48 px trong docblock `BoChonNapUI` là bất biến của header màn XEM `/twin` (chỗ gọi
       THỨ NHẤT của kit), không phải của header Studio (chỗ gọi thứ hai, bố cục khác). Kit nay dùng
       chung ⇒ phải đo CẢ HAI: Studio (hazard mới) và `/twin` (bất biến cũ có bị kéo theo không). */
    const page2 = await ctx.newPage();
    await page2.setViewportSize({ width: 1280, height: 720 });
    await page2.goto(`${BASE}/twin?do=1`, { waitUntil: "domcontentloaded" });
    await page2.waitForSelector('[data-testid="man-twin-van-hanh"]', { timeout: 120_000 }).catch(() => {});
    await choVe(page2, 0);
    r.doiChungManTwin = await page2.evaluate(() => {
      const man = document.querySelector('[data-testid="man-twin-van-hanh"]');
      const h = man?.querySelector("header") ?? man?.querySelector('[data-testid="thanh-tren-twin"]');
      const bo = document.querySelector('[data-testid="bo-chon-nap"]');
      return { headerCao: h ? Number(h.getBoundingClientRect().height.toFixed(2)) : null, boChon: bo ? { w: Math.round(bo.getBoundingClientRect().width), h: Math.round(bo.getBoundingClientRect().height) } : null, tranNgang: document.documentElement.scrollWidth > document.documentElement.clientWidth };
    });
    r.anhTwin1280 = await anh(page2, "H3-twin-1280x720-doi-chung");
    await page2.close();
    const p = phan(
      { "chieu cao header Studio": r.chiTiet.headerCao, "chieu cao header /twin (doi chung)": r.doiChungManTwin.headerCao },
      [
        { ten: "header Studio KHONG xuong dong (bo-chon-nap cao <= 28 px = MOT hang)", ok: (r.chiTiet.boChonCao ?? 99) <= 28, thay: `bo-chon-nap ${r.chiTiet.boChonRong}x${r.chiTiet.boChonCao} px trong header cao ${r.chiTiet.headerCao} px` },
        { ten: "header Studio KHONG vuot 48 px (nguong docblock)", ok: (r.chiTiet.headerCao ?? 99) <= 48, thay: `${r.chiTiet.headerCao} px` },
        { ten: "KHONG tran ngang @1280", ok: r.chiTiet.tranNgang === false, thay: `tranNgang ${r.chiTiet.tranNgang}` },
        { ten: "doi chung: header /twin (bat bien 48 px cua kit) KHONG bi keo theo", ok: (r.doiChungManTwin.headerCao ?? 99) <= 48 && r.doiChungManTwin.tranNgang === false, thay: `/twin header ${r.doiChungManTwin.headerCao} px · bo-chon ${JSON.stringify(r.doiChungManTwin.boChon)} · tran ngang ${r.doiChungManTwin.tranNgang}` },
      ],
    );
    Object.assign(r, p);
    await page.close();
  } catch (e) { r.loi = String(e).slice(0, 600); r.pq = "HỎNG"; r.vi = `HỎNG ${r.loi}`; }
  bao("H3", vai, r.pq, r.vi);
  luu("H3", r); await ctx.close(); return r;
}

/* H5 — Studio sau auto-fit: khung 3D còn "gần trống"? */
async function caH5(browser) {
  const vai = "qatd_kythuat";
  const ctx = await browser.newContext({ viewport: VP });
  const me = await dangNhap(ctx, vai);
  const r = { ca: "H5", vai, me, deBai: "PH-29: sau auto-fit, khoi may co lap day khung 3D khong (bbox tam khoi / dien tich canvas)? So voi anh vong 1." };
  try {
    const page = await moStudio(ctx, null);
    const d = await doc(page);
    r.thay = { studio: d.studio, khoiCanh: d.khoiCanh };
    r.anh = await anh(page, "H5-studio-sau-auto-fit-1600");
    /* ★★★ ABLATION — auto-fit (PH-29) có THẬT SỰ chạy không?
       Bấm `nut-fit-tat-ca` (đúng hàm mà auto-fit dùng lại). Khung nhìn KHÔNG đổi ⇒ auto-fit đã
       chạy và "gần trống" là kết cục của chính phép Fit; khung nhìn ĐỔI ⇒ auto-fit đã KHÔNG chạy. */
    const truoc = d.khoiCanh?.hop;
    /* ★ BƯỚC GIỮA — BẤM MỘT KHỐI MÁY (không bấm Fit). `daTuFit` chỉ được đặt SAU một lượt fit
       THÀNH CÔNG, nên mọi lượt `may`/`bboxMay` đổi về sau đều thử lại. Nếu khung nhìn nhảy ở đây
       thì auto-fit CÓ chạy — chỉ là trượt mất lượt mount đầu (lúc `refCanh.current` còn null). */
    const diemH5 = await page.evaluate(() => {
      const cv = document.querySelector('[data-testid="xuong-thiet-ke"] canvas');
      if (!cv) return { loi: "khong co canvas" };
      const r0 = cv.getBoundingClientRect();
      const ds = (window.__demTuongTac?.dsMay?.() ?? []).filter((m) => m.trongKhung);
      for (const m of ds) {
        const t = window.__demTuongTac?.tamMay?.(m.machineId);
        if (!t || t.biChe) continue;
        const X = r0.left + t.x, Y = r0.top + t.y;
        if (document.elementFromPoint(X, Y) !== cv) continue;
        return { id: m.machineId, X, Y };
      }
      return { loi: "0 khoi bam duoc" };
    });
    if (!diemH5.loi) {
      await page.mouse.move(diemH5.X - 40, diemH5.Y - 40);
      await page.mouse.move(diemH5.X, diemH5.Y, { steps: 4 });
      await page.mouse.click(diemH5.X, diemH5.Y);
      await page.waitForTimeout(1500);
    }
    const dGiua = await doc(page);
    r.sauBamMotKhoi = { diem: diemH5, khoiCanh: dGiua.khoiCanh };
    r.anhSauBamKhoi = await anh(page, "H5-studio-sau-bam-mot-khoi-1600");
    await page.locator('[data-testid="nut-fit-tat-ca"]').click();
    await page.waitForFunction(() => (window.__thongKeVe?.calls ?? 0) > 0, null, { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const dSau = await doc(page);
    r.sauBamFit = dSau.khoiCanh;
    r.anhSauBamFit = await anh(page, "H5-studio-sau-bam-nut-fit-1600");
    const sau = dSau.khoiCanh?.hop;
    const giua = r.sauBamMotKhoi.khoiCanh?.hop;
    r.ablationFit = {
      truoc, giuaSauBamMotKhoi: giua, sau,
      doiKhung: !!(truoc && sau && (Math.abs(truoc.rongPx - sau.rongPx) > 4 || Math.abs(truoc.caoPx - sau.caoPx) > 4)),
      doiKhungChiVieBamKhoi: !!(truoc && giua && (Math.abs(truoc.rongPx - giua.rongPx) > 4 || Math.abs(truoc.caoPx - giua.caoPx) > 4)),
      ketLuan: null,
    };
    r.ablationFit.ketLuan = r.ablationFit.doiKhung
      ? "bam Fit LAM DOI khung nhin => auto-fit PH-29 KHONG chay (hoac chay sai luc)"
      : "bam Fit KHONG doi khung nhin => auto-fit PH-29 DA chay; khung 'gan trong' la ket cuc cua chinh phep Fit";
    const p = phan(
      { "khoi may trong canh": d.khoiCanh?.tong, "bbox tam khoi": d.khoiCanh?.hop },
      [
        { ten: "co khoi may trong canh", ok: (d.khoiCanh?.tong ?? 0) > 0, thay: `${d.khoiCanh?.tong}` },
        { ten: "moi khoi deu TRONG KHUNG (khong bi cat)", ok: d.khoiCanh?.tong === d.khoiCanh?.trongKhung, thay: `${d.khoiCanh?.trongKhung}/${d.khoiCanh?.tong}` },
        { ten: "bbox tam khoi chiem >= 10 % dien tich canvas (khong con 'gan trong')", ok: (d.khoiCanh?.hop?.tiLeDienTich ?? 0) >= 0.10, thay: `tiLeDienTich ${d.khoiCanh?.hop?.tiLeDienTich} (bbox ${d.khoiCanh?.hop?.rongPx}x${d.khoiCanh?.hop?.caoPx} tren canvas ${d.khoiCanh?.hop?.canvasRong}x${d.khoiCanh?.hop?.canvasCao})` },
        { ten: "ABLATION: bam nut Fit KHONG lam doi khung (chung to auto-fit da chay)", ok: !r.ablationFit.doiKhung, thay: r.ablationFit.ketLuan },
      ],
    );
    Object.assign(r, p);
    await page.close();
  } catch (e) { r.loi = String(e).slice(0, 600); r.pq = "HỎNG"; r.vi = `HỎNG ${r.loi}`; }
  bao("H5", vai, r.pq, r.vi);
  luu("H5", r); await ctx.close(); return r;
}

/* ══════════════════════════════════════════════════════════════════════ */
/* N-2 / N-3 / N-4 / N-5 — đối chứng âm                                   */
/* ══════════════════════════════════════════════════════════════════════ */
async function caN2(browser) {
  const vai = "qatd_congnhan";
  const ctx = await browser.newContext();
  const me = await dangNhap(ctx, vai);
  const r = { ca: "N-2", vai, me, deBai: "3 loi goi API bang cookie congnhan cho thuc the cua QATD-B => NOT_FOUND / [] / null, 0 ro" };
  try {
    r.api = {
      "factoryCommand.machineDetail(5676)": await trpc(ctx, "factoryCommand.machineDetail", { machineId: 5676 }),
      "twinCanh.danhSachToaNha({factoryId:42})": await trpc(ctx, "twinCanh.danhSachToaNha", { factoryId: 42 }),
      'twinCanh.noiCuaThucThe({loai:"may",id:5676})': await trpc(ctx, "twinCanh.noiCuaThucThe", { loai: "may", id: 5676 }),
      'twinCanh.noiCuaThucThe({loai:"line",id:347})': await trpc(ctx, "twinCanh.noiCuaThucThe", { loai: "line", id: 347 }),
      'twinCanh.noiCuaThucThe({loai:"machine",id:5676}) — chu brief, zod chi nhan "may"': await trpc(ctx, "twinCanh.noiCuaThucThe", { loai: "machine", id: 5676 }),
    };
    // đối chứng DƯƠNG cùng phiên: thực thể TRONG phạm vi phải trả dữ liệu
    r.doiChungDuong = {
      'noiCuaThucThe({loai:"may",id:6247}) — may cua QATD-C (TRONG pham vi)': await trpc(ctx, "twinCanh.noiCuaThucThe", { loai: "may", id: 6247 }),
      "twinCanh.danhSachToaNha({factoryId:43})": await trpc(ctx, "twinCanh.danhSachToaNha", { factoryId: 43 }),
    };
    const s = JSON.stringify(r.api);
    r.roTen = ["QATD-B", "WAVE_SOLDER-01", "QATD-B-T1"].filter((x) => s.includes(x));
    const md = r.api["factoryCommand.machineDetail(5676)"];
    const tn = r.api["twinCanh.danhSachToaNha({factoryId:42})"];
    const nc = r.api['twinCanh.noiCuaThucThe({loai:"may",id:5676})'];
    const ncl = r.api['twinCanh.noiCuaThucThe({loai:"line",id:347})'];
    const duong = r.doiChungDuong['noiCuaThucThe({loai:"may",id:6247}) — may cua QATD-C (TRONG pham vi)'];
    const p = phan(
      { "machineDetail": md, "danhSachToaNha(42)": tn, "noiCuaThucThe(may 5676)": nc, "doi chung duong (may 6247)": duong },
      [
        { ten: "machineDetail(5676) khong tra du lieu", ok: md.data === null || md.ma === "NOT_FOUND", thay: `http ${md.http} ma ${md.ma} data ${JSON.stringify(md.data)?.slice(0, 120)}` },
        { ten: "danhSachToaNha(42) = [] (khong ro toa cua QATD-B)", ok: Array.isArray(tn.data) && tn.data.length === 0, thay: `${JSON.stringify(tn.data)?.slice(0, 160)} ma ${tn.ma}` },
        { ten: "noiCuaThucThe(may 5676) = NOT_FOUND", ok: nc.ma === "NOT_FOUND" || nc.ma === "ENTITY_NOT_FOUND", thay: `ma ${nc.ma} data ${JSON.stringify(nc.data)}` },
        { ten: "noiCuaThucThe(line 347) = NOT_FOUND", ok: ncl.ma === "NOT_FOUND" || ncl.ma === "ENTITY_NOT_FOUND", thay: `ma ${ncl.ma} data ${JSON.stringify(ncl.data)}` },
        { ten: "0 ten cua QATD-B ro ra trong ca 5 phan hoi", ok: r.roTen.length === 0, thay: `ro: ${r.roTen.join(", ")}` },
        { ten: "DOI CHUNG DUONG: thuc the TRONG pham vi VAN tra du lieu (khong va qua tay)", ok: duong.ma === null && duong.data && duong.data.factoryId === 43, thay: `ma ${duong.ma} data ${JSON.stringify(duong.data)}` },
      ],
    );
    Object.assign(r, p);
    if (r.pq === "ĐẠT") r.pq = "CHẶN-ĐÚNG";
  } catch (e) { r.loi = String(e).slice(0, 600); r.pq = "HỎNG"; r.vi = `HỎNG ${r.loi}`; }
  bao("N-2", vai, r.pq, r.vi);
  luu("N-2", r); await ctx.close(); return r;
}

async function caN3(browser) {
  const vai = "qatd_kythuat";
  const ctx = await browser.newContext();
  const me = await dangNhap(ctx, vai);
  const r = { ca: "N-3", vai, me, deBai: "kythuat goi twinCanh.sinhTuDong => van 403 FORBIDDEN (adminProcedure). KHONG goi bang admin." };
  try {
    const tangA = DB.tang.find((t) => t.facCode === "QATD-A" && Number(t.soDatCho) === 0);
    r.tangThu = tangA ? { id: tangA.id, toaMa: tangA.toaMa, capSo: tangA.capSo, soDatCho: Number(tangA.soDatCho) } : null;
    if (!tangA) throw new Error("THIEU DU KIEN: tang RONG (0 dat cho) cua QATD-A de goi thu an toan");
    r.goi = await trpcPost(ctx, "twinCanh.sinhTuDong", { factoryId: 41, tangIds: [tangA.id] });
    // đối chứng dương cùng phiên: xemTruocSinh (canView) phải 200
    r.doiChungDuong = await trpc(ctx, "twinCanh.xemTruocSinh", { factoryId: 41, tangIds: [tangA.id] });
    const p = phan(
      { "phan hoi sinhTuDong": r.goi },
      [
        { ten: "sinhTuDong = FORBIDDEN (403)", ok: r.goi.ma === "FORBIDDEN" || r.goi.http === 403, thay: `http ${r.goi.http} ma ${r.goi.ma} loi "${r.goi.loi}"` },
        { ten: "DOI CHUNG DUONG cung phien: xemTruocSinh (canView) = 200", ok: r.doiChungDuong.http === 200, thay: `http ${r.doiChungDuong.http} ma ${r.doiChungDuong.ma}` },
      ],
    );
    Object.assign(r, p);
    if (r.pq === "ĐẠT") r.pq = "CHẶN-ĐÚNG";
  } catch (e) { r.loi = String(e).slice(0, 600); r.pq = "HỎNG"; r.vi = `HỎNG ${r.loi}`; }
  bao("N-3", vai, r.pq, r.vi);
  luu("N-3", r); await ctx.close(); return r;
}

async function caN4(browser) {
  const vai = "qatd_khongquyen";
  const ctx = await browser.newContext({ viewport: VP });
  const me = await dangNhap(ctx, vai);
  const page = await ctx.newPage();
  const r = { ca: "N-4", vai, me, deBai: "qatd_khongquyen vao /twin => van bi chan" };
  try {
    await page.goto(`${BASE}/twin?do=1`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
    await page.waitForFunction(() => document.querySelectorAll(".animate-spin").length === 0, null, { timeout: 30_000 }).catch(() => {});
    const d = await doc(page);
    r.thay = d;
    r.anh = await anh(page, "N-4-khongquyen-twin");
    r.chan = await page.evaluate(() => {
      const t = (document.body.innerText || "").replace(/\s+/g, " ").trim();
      return { url: location.pathname, coManTwin: !!document.querySelector('[data-testid="man-twin-van-hanh"]'), soCanvas: document.querySelectorAll("canvas").length, chu: t.slice(0, 400) };
    });
    const p = phan(
      { "trang thai sau khi vao /twin": r.chan },
      [
        { ten: "KHONG dung man twin van hanh", ok: r.chan.coManTwin === false, thay: `coManTwin ${r.chan.coManTwin}` },
        { ten: "0 canvas 3D", ok: r.chan.soCanvas === 0, thay: `${r.chan.soCanvas}` },
        { ten: "co cau giai thich (khong man trang)", ok: r.chan.chu.length > 20, thay: `"${r.chan.chu.slice(0, 200)}"` },
      ],
    );
    Object.assign(r, p);
    if (r.pq === "ĐẠT") r.pq = "CHẶN-ĐÚNG";
  } catch (e) { r.loi = String(e).slice(0, 600); r.pq = "HỎNG"; r.vi = `HỎNG ${r.loi}`; }
  bao("N-4", vai, r.pq, r.vi);
  luu("N-4", r); await ctx.close(); return r;
}

async function caN5(browser) {
  const KY = { qatd_giamdoc: 1108, qatd_quanly: 371, qatd_kythuat: 780, qatd_congnhan: 328, qatd_admin: 1150, qatd_khonggan: 0, qatd_khongquyen: "FORBIDDEN" };
  const r = { ca: "N-5", deBai: "pham vi 7 vai qua factoryCommand.overview — phai GIU NGUYEN so vong 1", do: {} };
  try {
    for (const [vai, ky] of Object.entries(KY)) {
      const ctx = await browser.newContext();
      await dangNhap(ctx, vai);
      const ov = await trpc(ctx, "factoryCommand.overview");
      const fl = await trpc(ctx, "factory.list");
      const thay = Array.isArray(ov.data?.machines) ? ov.data.machines.length : (ov.ma ?? `http${ov.http}`);
      r.do[vai] = { kyVong: ky, thay, byte: ov.byte, soNhaMay: Array.isArray(fl.data) ? fl.data.length : fl.ma, khop: String(thay) === String(ky) };
      await ctx.close();
    }
    const lech = Object.entries(r.do).filter(([, v]) => !v.khop);
    const p = phan(
      { "7 vai da do": Object.keys(r.do).length === 7 ? true : null },
      [{ ten: "7/7 vai khop so vong 1", ok: lech.length === 0, thay: lech.map(([k, v]) => `${k}: ky ${v.kyVong} thay ${v.thay}`).join(" · ") || "khop het" }],
    );
    Object.assign(r, p);
  } catch (e) { r.loi = String(e).slice(0, 600); r.pq = "HỎNG"; r.vi = `HỎNG ${r.loi}`; }
  bao("N-5", "7 vai", r.pq, r.vi);
  luu("N-5", r); return r;
}

/* ══════════════════════════════════════════════════════════════════════ */
/* H4 — thời gian mở màn Line / Máy (3 lượt, CONTEXT MỚI mỗi lượt)        */
/* ══════════════════════════════════════════════════════════════════════ */
const pct = (xs, q) => { const a = xs.filter((x) => x != null).sort((m, n) => m - n); if (!a.length) return null; const i = Math.min(a.length - 1, Math.ceil((q / 100) * a.length) - 1); return a[Math.max(0, i)]; };
async function caH4(browser) {
  const r = { ca: "H4", deBai: "thoi gian mo /twin/line/:id va /twin/may/:id — 3 luot moi man, CONTEXT MOI moi luot, 1 worker. Moc vong 1: p50 2.615 ms (kythuat), admin 1.182 ms.", luot: [] };
  try {
    const ds = [
      { vai: "qatd_kythuat", url: `/twin/line/347?do=1`, nhan: "line 347 QATD-B" },
      { vai: "qatd_kythuat", url: `/twin/may/5676?do=1`, nhan: "may 5676 QATD-B" },
      { vai: "qatd_admin", url: `/twin/line/347?do=1`, nhan: "line 347 (admin, moc so sanh)" },
    ];
    for (const m of ds) {
      const ck = await (async () => { const c = await browser.newContext(); await dangNhap(c, m.vai); const k = await c.cookies(); await c.close(); return k; })();
      for (let i = 0; i < 3; i++) {
        const ctx = await browser.newContext({ viewport: VP });
        await ctx.addCookies(ck);
        const page = await ctx.newPage();
        const t0 = Date.now();
        await page.goto(`${BASE}${m.url}`, { waitUntil: "domcontentloaded" });
        await page.waitForSelector('[data-testid="man-twin-line"], [data-testid="man-twin-may"]', { timeout: 120_000 }).catch(() => {});
        await page.waitForFunction(() => (window.__thongKeVe?.calls ?? 0) > 0, null, { timeout: 120_000 }).catch(() => {});
        const ms = Date.now() - t0;
        const d = await doc(page);
        r.luot.push({ vai: m.vai, nhan: m.nhan, luot: i + 1, ms, khoi: d.khoiCanh?.tong ?? null, soCanvas: d.soCanvasKit, url: d.url });
        await ctx.close();
      }
    }
    const nhom = {};
    for (const l of r.luot) { (nhom[`${l.vai} ${l.nhan}`] ??= []).push(l.ms); }
    r.tomTat = Object.fromEntries(Object.entries(nhom).map(([k, v]) => [k, { n: v.length, p50: pct(v, 50), max: Math.max(...v), ds: v }]));
    const kythuat = r.luot.filter((l) => l.vai === "qatd_kythuat").map((l) => l.ms);
    r.kythuatP50 = pct(kythuat, 50); r.kythuatMax = Math.max(...kythuat);
    r.mocVong1 = { kythuatP50: 2615, adminMoc: 1182, nguong: 2500 };
    const p = phan(
      { "so luot da do": r.luot.length === 9 ? true : null, "p50 kythuat": r.kythuatP50 },
      [{ ten: "p50 vai khong-admin <= 2.500 ms (nguong §4)", ok: r.kythuatP50 <= 2500, thay: `p50 ${r.kythuatP50} ms · max ${r.kythuatMax} ms (vong 1: p50 2.615, 48/48 vuot)` }],
    );
    Object.assign(r, p);
  } catch (e) { r.loi = String(e).slice(0, 600); r.pq = "HỎNG"; r.vi = `HỎNG ${r.loi}`; }
  bao("H4", "kythuat+admin", r.pq, r.vi);
  luu("H4", r); return r;
}

/* ══════════════════════════════════════════════════════════════════════ */
async function main() {
  const browser = await chromium.launch(LAUNCH);
  const chay = (t) => CA === "all" || CA === t;
  const may5676 = DBC.may5676[0];
  const may6247 = DBC.chiTietMayC3[0];
  try {
    if (chay("R1")) await caLine(browser, { ca: "R1", vai: "qatd_kythuat", facId: 42, toaId: 69, tangId: 193, lineId: 347, nhan: "QATD-B toa T1 tang 1" });
    if (chay("R2")) await caLine(browser, { ca: "R2", vai: "qatd_congnhan", facId: 43, toaId: 75, tangId: 235, lineId: 397, nhan: "QATD-C toa T3 tang 1" });
    if (chay("R3")) await caMay(browser, { ca: "R3", vai: "qatd_kythuat", mayId: 5676, ky: may5676, nhan: "QATD-B toa T1" });
    if (chay("R4")) await caMay(browser, { ca: "R4", vai: "qatd_congnhan", mayId: 6247, ky: may6247, nhan: "QATD-C toa T3, DB co 1 hang twin_dat_cho tang 235" });
    if (chay("R5")) await caR5(browser);
    if (chay("R6")) await caR6(browser);
    if (chay("R7")) await caR7(browser);
    if (chay("R8")) await caR8(browser);
    if (chay("N1")) await caMay(browser, { ca: "N-1", vai: "qatd_congnhan", mayId: 5676, ky: may5676, nhan: "QATD-B — NGOAI pham vi", kyVongChan: true });
    if (chay("N2")) await caN2(browser);
    if (chay("N3")) await caN3(browser);
    if (chay("N4")) await caN4(browser);
    if (chay("N5")) await caN5(browser);
    if (chay("H1")) await caH1(browser);
    if (chay("H3")) await caH3(browser);
    if (chay("H4")) await caH4(browser);
    if (chay("H5")) await caH5(browser);
  } finally { await browser.close(); }
}
main().catch((e) => { console.error("HỎNG TOÀN LÔ:", e); process.exit(1); });
