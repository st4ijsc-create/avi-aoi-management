/**
 * QA lần 11 — VÒNG 3 (đo SỐNG hai bản vá H1 + H5 trên bản dựng thật).
 * Dùng: node .qa-tapdoan/do-vong3.mjs --ca=L1|L7|all
 * Ra:   .qa-tapdoan/tho/V3/<ca>.json · .qa-tapdoan/anh/V3-*.png
 *
 * Kỷ luật: thiếu dữ kiện ⇒ HỎNG kèm TÊN dữ kiện (không `??` vá lỗ đọc); tập rỗng ⇒ HỎNG.
 * GPU: --use-angle=default --enable-gpu --ignore-gpu-blocklist. 1 worker, tuần tự.
 * Chờ cảnh bằng tín hiệu (`__thongKeVe.calls`, `__demTuongTac`), KHÔNG timeout cố định.
 * DB: postgres CHỈ SELECT; mọi lượt GHI đi qua ĐƯỜNG SẢN PHẨM (UI hoặc tRPC `luuHangLoat`).
 */
import { chromium } from "@playwright/test";
import postgres from "postgres";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";

const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? m.slice(k.length + 3) : d; };
const BASE = arg("base", "http://localhost:3064");
const CA = arg("ca", "all");
const VP = { width: Number(arg("w", "1600")), height: Number(arg("h", "900")) };
const THO = ".qa-tapdoan/tho/V3";
const ANH = ".qa-tapdoan/anh";
mkdirSync(THO, { recursive: true }); mkdirSync(ANH, { recursive: true });
const MK = "Qatd!2026";
const LAUNCH = { args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"] };
const SO_WORKER = 1;

const DB = JSON.parse(readFileSync(`${THO}/db-V3.json`, "utf8"));
const urlDb = readFileSync(".env", "utf8").split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL=")).slice(13).trim();

/* ── DB: CHỈ SELECT ──────────────────────────────────────────────────── */
async function sqlMo() { return postgres(urlDb, { max: 2 }); }
async function chupHang(sql, ids) {
  if (!ids.length) return [];
  return sql`select id, "tangId", "loaiThucThe", "thucTheId", "viTriXMm", "viTriYMm", "viTriZMm",
      "rongMm", "caoMm", "sauMm", "kichThuocDaDo", "quatX", "quatY", "quatZ", "quatW",
      "tiLeX", "tiLeY", "tiLeZ", "modelId", "daKhoa", "hienThi", nguon, "updatedAt"
    from twin_dat_cho where "loaiThucThe"='machine' and "thucTheId" in ${sql(ids)} order by "thucTheId"`;
}
async function demHang(sql) {
  const a = Number((await sql`select count(*) as n from twin_dat_cho`)[0].n);
  const b = Number((await sql`select count(*) as n from twin_dat_cho dc
     join twin_tang s on s.id=dc."tangId" join twin_toa_nha b on b.id=s."toaNhaId"
     join factories f on f.id=b."factoryId" where f.code like 'QATD-%'`)[0].n);
  const k = Number((await sql`select count(*) as n from twin_dat_cho dc
     join twin_tang s on s.id=dc."tangId" join twin_toa_nha b on b.id=s."toaNhaId"
     join factories f on f.id=b."factoryId" where f.code like 'QATD-%' and dc."daKhoa"=true`)[0].n);
  return { tong: a, qatd: b, qatdDaKhoa: k };
}

function luu(ten, obj) {
  const p = `${THO}/${ten}.json`;
  writeFileSync(`${p}.tmp`, JSON.stringify({ luc: new Date().toISOString(), base: BASE, vp: VP, soWorker: SO_WORKER, ...obj }, null, 1));
  renameSync(`${p}.tmp`, p);
  return p;
}
const bao = (ca, vai, pq, vi) => console.log(`  ${String(pq).padEnd(11)} ${ca} · ${vai} · ${String(vi).slice(0, 460)}`);

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
async function trpcPost(ctx, proc, input) {
  const r = await ctx.request.post(`${BASE}/api/trpc/${proc}`, { data: { json: input } });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ }
  const boc = j?.result?.data;
  return { http: r.status(), data: boc && typeof boc === "object" && "json" in boc ? boc.json : (boc ?? null), ma: j?.error?.json?.data?.code ?? null, loi: (j?.error?.json?.message ?? null)?.slice(0, 300) ?? null };
}

/* ── ĐỌC MÀN THEO NGHĨA ───────────────────────────────────────────────── */
const DOC = () => {
  const el = (t) => document.querySelector(`[data-testid="${t}"]`);
  const chu = (t) => { const e = el(t); return e ? (e.innerText || e.textContent || "").replace(/\s+/g, " ").trim() : null; };
  const dem = (t) => document.querySelectorAll(`[data-testid="${t}"]`).length;
  const so = (s) => { if (s == null) return null; const m = s.match(/(-?\d+)/); return m ? Number(m[1]) : null; };
  const oChon = (t) => { const e = el(t); return e ? { co: 1, soMuc: Number(e.getAttribute("data-so-muc")), value: e.value, disabled: e.disabled, nhan: [...e.options].find((o) => o.value === e.value)?.textContent?.trim() ?? null, muc: [...e.options].map((o) => `${o.value}:${o.textContent.trim()}`) } : { co: 0 };
  };
  const manSt = el("man-twin-studio");
  const ds = window.__demTuongTac?.dsMay?.();
  const cv = document.querySelector('[data-testid="xuong-thiet-ke"] canvas') || document.querySelector("canvas");
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
    lang: document.documentElement.lang,
    khoiCanh: khoi,
    studio: manSt ? {
      oNhaMay: oChon("chon-nha-may"), oToaNha: oChon("chon-toa-nha"), oTang: oChon("chon-tang"),
      xuong: dem("xuong-thiet-ke"),
      skDaXepCho: chu("sk-da-xep-cho"), skDaXepChoSo: so(chu("sk-da-xep-cho")),
      skChoXepCho: chu("sk-cho-xep-cho"),
      demChuaLuu: dem("dem-chua-luu"), demChuaLuuChu: chu("dem-chua-luu"), demChuaLuuSo: so(chu("dem-chua-luu")),
      nutLuu: dem("nut-luu"), nutMoSinh: dem("nut-mo-sinh"), tabConDuongB: dem("tab-con-duong-b"),
      nutFit: dem("nut-fit-tat-ca"), bangThuocTinh: dem("bang-thuoc-tinh"), congTacKhoa: dem("cong-tac-khoa"),
      canvasTrongMan: manSt.querySelectorAll("canvas").length,
    } : null,
    hopThoai: (() => {
      const h = el("hop-thoai-chua-luu");
      if (!h) return { co: 0 };
      return {
        co: 1,
        chu: (h.innerText || "").replace(/\s+/g, " ").trim(),
        moTa: chu("hop-thoai-chua-luu-mo-ta"),
        nutLuuRoiDoi: chu("nut-luu-roi-doi"), nutBoThayDoi: chu("nut-bo-thay-doi"), nutHuyDoi: chu("nut-huy-doi"),
        demNut: { luuRoiDoi: dem("nut-luu-roi-doi"), boThayDoi: dem("nut-bo-thay-doi"), huyDoi: dem("nut-huy-doi") },
      };
    })(),
    soCanvasKit: window.__soCanvas === undefined ? null : window.__soCanvas,
    canvasDom: document.querySelectorAll("canvas").length,
    veCalls: window.__thongKeVe?.calls ?? null,
    spin: document.querySelectorAll(".animate-spin").length,
    thanTrang: (document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 500),
  };
};
const doc = (page) => page.evaluate(DOC);

function phan(can, kiem) {
  const thieu = Object.entries(can).filter(([, v]) => v === null || v === undefined).map(([k]) => k);
  if (thieu.length) return { pq: "HỎNG", vi: `thiếu dữ kiện: ${thieu.join(", ")}`, thieu };
  const sai = kiem.filter((k) => !k.ok);
  if (sai.length) return { pq: "SAI", vi: sai.map((k) => `${k.ten}: ${k.thay}`).join(" · "), sai: sai.map((k) => k.ten) };
  return { pq: "ĐẠT", vi: kiem.map((k) => `${k.ten} OK`).join(" · ") };
}

/* ── chờ theo TÍN HIỆU ───────────────────────────────────────────────── */
async function choVe(page, moc = 0) {
  await page.waitForFunction((m) => (window.__thongKeVe?.calls ?? 0) > m ||
    !!document.querySelector('[data-testid="chua-co-tang"]') || !!document.querySelector('[data-testid="dai-pham-vi-rong"]'),
    moc, { timeout: 120_000 }).catch(() => {});
  await page.waitForFunction(() => {
    const q = (t) => !!document.querySelector(`[data-testid="${t}"]`);
    if (q("chua-co-tang") || q("chua-co-nha-may") || q("dai-pham-vi-rong")) return true;
    const ds = window.__demTuongTac?.dsMay?.();
    return (window.__demNhan?.tong ?? 0) > 0 || (Array.isArray(ds) && ds.length > 0);
  }, null, { timeout: 45_000 }).catch(() => {});
  await page.waitForFunction(() => {
    const ds = window.__demTuongTac?.dsMay?.();
    return !Array.isArray(ds) || ds.length === 0 || ds.some((m) => m.trongKhung);
  }, null, { timeout: 60_000 }).catch(() => {});
  await page.waitForFunction(() => document.querySelectorAll(".animate-spin").length === 0, null, { timeout: 30_000 }).catch(() => {});
}
async function choStudioXong(page, moc) {
  await page.waitForSelector('[data-testid="xuong-thiet-ke"] canvas', { timeout: 60_000 }).catch(() => {});
  await choVe(page, moc);
  await page.waitForFunction(() => { const e = document.querySelector('[data-testid="sk-da-xep-cho"]'); return !!e && /\d/.test(e.textContent || ""); }, null, { timeout: 60_000 }).catch(() => {});
}
/**
 * Chờ KHUNG NHÌN ĐỨNG YÊN — auto-fit là một lượt đổi camera CHẬM HƠN lượt dựng khối.
 * Đọc bbox tâm khối tới khi hai lượt đọc liên tiếp trùng nhau (≤1 px), có hạn.
 * Đây KHÔNG phải timeout cố định: điều kiện dừng là TÍN HIỆU (số đo thôi đổi).
 */
async function choKhungOnDinh(page, soLanTrung = 3, tranNhip = 60) {
  return page.evaluate(async ({ soLanTrung, tranNhip }) => {
    const doHop = () => {
      const ds = window.__demTuongTac?.dsMay?.();
      const cv = document.querySelector('[data-testid="xuong-thiet-ke"] canvas') || document.querySelector("canvas");
      if (!Array.isArray(ds) || !cv) return null;
      const tk = ds.filter((m) => m.trongKhung);
      if (!tk.length) return null;
      const r = cv.getBoundingClientRect();
      const xs = tk.map((m) => m.x), ys = tk.map((m) => m.y);
      return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), cw: r.width, ch: r.height, n: tk.length };
    };
    let truoc = null, trung = 0, nhip = 0;
    while (nhip++ < tranNhip) {
      const h = doHop();
      if (h && truoc && Math.abs(h.w - truoc.w) <= 1 && Math.abs(h.h - truoc.h) <= 1 && h.n === truoc.n) trung++;
      else trung = 0;
      truoc = h;
      if (trung >= soLanTrung) return { onDinh: true, nhip, hop: h };
      await new Promise((r) => setTimeout(r, 100));
    }
    return { onDinh: false, nhip, hop: truoc };
  }, { soLanTrung, tranNhip });
}
const anh = async (page, ten) => { const p = `${ANH}/V3-${ten}.png`; await page.screenshot({ path: p }); return p; };

async function moStudio(ctx, { lang = null, tre = 0 } = {}) {
  const page = await ctx.newPage();
  if (lang) await page.addInitScript((l) => { try { localStorage.setItem("i18nextLng", l); } catch { /* */ } }, lang);
  if (tre > 0) {
    await page.route("**/api/trpc/**", async (route) => {
      if (route.request().url().includes("canhThietKe")) { await new Promise((r) => setTimeout(r, tre)); }
      await route.continue();
    });
  }
  await page.goto(`${BASE}/twin-studio?do=1`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="man-twin-studio"]', { timeout: 120_000 }).catch(() => {});
  return page;
}

/** Bấm TÂM một khối máy trên cảnh (đường người dùng thật) — trả machineId. */
async function bamMotKhoi(page) {
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
  if (diem.loi) throw new Error(`THIEU DU KIEN: tam khoi may bam duoc tren canh Studio — ${diem.loi}`);
  await page.mouse.move(diem.X - 40, diem.Y - 40);
  await page.mouse.move(diem.X, diem.Y, { steps: 4 });
  await page.mouse.click(diem.X, diem.Y);
  await page.waitForSelector('[data-testid="cong-tac-khoa"]', { timeout: 30_000 });
  return diem;
}
/** Tạo ĐÚNG MỘT thay đổi chưa lưu: bấm khối rồi lật công tắc KHOÁ (`daKhoa`). */
async function taoMotThayDoi(page) {
  const diem = await bamMotKhoi(page);
  await page.locator('[data-testid="cong-tac-khoa"]').click();
  await page.waitForSelector('[data-testid="dem-chua-luu"]', { timeout: 30_000 }).catch(() => {});
  const d = await doc(page);
  if ((d.studio?.demChuaLuu ?? 0) === 0) throw new Error("THIEU DU KIEN: khong tao duoc thay doi chua luu (dem-chua-luu = 0 sau khi lat cong-tac-khoa)");
  return { mayId: diem.id, demChuaLuu: d.studio.demChuaLuuSo, chu: d.studio.demChuaLuuChu };
}
/**
 * Đổi một ô chọn rồi CHỜ tới khi phân định: hộp thoại hiện RA, hoặc ô đã đổi thật.
 * ⚠ `<select>` là controlled (`giaTri={props.tangId}`): cổng chặn ⇒ React trả DOM value về cũ.
 */
async function doiO(page, testid, giaTri) {
  const truoc = await page.evaluate((t) => document.querySelector(`[data-testid="${t}"]`)?.value ?? null, testid);
  const moc = await page.evaluate(() => window.__thongKeVe?.calls ?? 0);
  await page.selectOption(`[data-testid="${testid}"]`, String(giaTri));
  const ketCuc = await page.waitForFunction(({ t, v }) => {
    if (document.querySelector('[data-testid="hop-thoai-chua-luu"]')) return "hop-thoai";
    if (document.querySelector(`[data-testid="${t}"]`)?.value === String(v)) return "doi-that";
    return false;
  }, { t: testid, v: giaTri }, { timeout: 30_000 }).then((h) => h.jsonValue()).catch(() => "khong-phan-dinh");
  return { truoc, moc, ketCuc };
}

/* ══════════════════════════════════════════════════════════════════════ */
/* H1 — L1..L6 trong MỘT phiên người dùng (tuần tự, cùng một trang)        */
/* ══════════════════════════════════════════════════════════════════════ */
async function caH1(browser) {
  const vai = "qatd_kythuat";
  const sql = await sqlMo();
  const ctx = await browser.newContext({ viewport: VP });
  const kq = {};
  const chung = { vai, ghiChu: [] };
  let mayL1 = null, mayL4 = null, chupTruoc = [], tangL4 = null;
  try {
    const me = await dangNhap(ctx, vai);
    chung.me = me;
    chung.demTruoc = await demHang(sql);
    const page = await moStudio(ctx);
    page.on("dialog", async (d) => { chung.ghiChu.push(`dialog NATIVE: ${d.type()} ${d.message()}`); await d.dismiss().catch(() => {}); });
    const mangLuu = [];
    page.on("response", (r) => { if (r.url().includes("luuHangLoat")) mangLuu.push({ url: r.url().slice(-40), status: r.status() }); });
    await choStudioXong(page, 0);
    const d0 = await doc(page);
    const facId = Number(d0.studio?.oNhaMay?.value), toaId = Number(d0.studio?.oToaNha?.value), tang0 = Number(d0.studio?.oTang?.value);
    chung.mocDau = { facId, toaId, tangId: tang0, khoi: d0.khoiCanh?.tong, skDaXepCho: d0.studio?.skDaXepChoSo, demChuaLuu: d0.studio?.demChuaLuu };
    const tangCuaToa = DB.tang.filter((t) => t.toaNhaId === toaId).sort((a, b) => a.capSo - b.capSo);
    const tangKhac = tangCuaToa.find((t) => t.id !== tang0 && Number(t.soDatChoMay) > 0);
    if (!tangKhac) throw new Error("THIEU DU KIEN: tang KHAC cung toa CO may da xep cho (can de tao thay doi o L4)");
    chung.tangKhac = { id: tangKhac.id, capSo: tangKhac.capSo, datChoMay: Number(tangKhac.soDatChoMay) };

    /* ── L6: KHÔNG có thay đổi ⇒ đổi tầng phải MƯỢT, KHÔNG hỏi ───────── */
    {
      const r = { ca: "L6", vai, deBai: "KHONG co thay doi chua luu => doi tang MUOT, 0 hop thoai" };
      const o = await doiO(page, "chon-tang", tangKhac.id);
      r.ketCuc = o.ketCuc;
      await choStudioXong(page, o.moc);
      const d = await doc(page);
      r.thay = { tangId: Number(d.studio?.oTang?.value), hopThoai: d.hopThoai?.co, khoi: d.khoiCanh?.tong, skDaXepCho: d.studio?.skDaXepChoSo, soCanvas: d.soCanvasKit, demChuaLuu: d.studio?.demChuaLuu };
      r.kyVong = { tangId: tangKhac.id, hopThoai: 0, khoiTheoDb: Number(tangKhac.soDatChoMay) };
      Object.assign(r, phan(
        { "dem-chua-luu luc bat dau": chung.mocDau.demChuaLuu, "o chon-tang sau khi doi": r.thay.tangId, "so hop thoai": r.thay.hopThoai, "khoi may trong canh": r.thay.khoi },
        [
          { ten: "bat dau KHONG co thay doi chua luu", ok: chung.mocDau.demChuaLuu === 0, thay: `dem-chua-luu ${chung.mocDau.demChuaLuu}` },
          { ten: "KHONG hien hop thoai", ok: r.thay.hopThoai === 0 && o.ketCuc === "doi-that", thay: `hopThoai ${r.thay.hopThoai} · ketCuc ${o.ketCuc}` },
          { ten: `o chon-tang DA doi sang ${tangKhac.id}`, ok: r.thay.tangId === tangKhac.id, thay: `${r.thay.tangId}` },
          { ten: `canh dung lai theo tang moi: ${tangKhac.soDatChoMay} khoi (so DB)`, ok: r.thay.khoi === Number(tangKhac.soDatChoMay), thay: `${r.thay.khoi}` },
        ]));
      r.anh = await anh(page, "L6-doi-tang-muot");
      kq.L6 = r; bao("L6", vai, r.pq, r.vi); luu("L6", r);
      /* ── L11 (một phần): __soCanvas sau đổi tầng ────────────────────── */
      kq.L11 = { ca: "L11", vai, deBai: "RB-4: __soCanvas = 1 o /twin-studio SAU khi doi tang", thay: { soCanvas: d.soCanvasKit, canvasDom: d.canvasDom, canvasTrongMan: d.studio?.canvasTrongMan }, ...phan(
        { "__soCanvas": d.soCanvasKit, "canvas trong DOM": d.canvasDom },
        [{ ten: "__soCanvas = 1 sau khi doi tang", ok: d.soCanvasKit === 1, thay: `${d.soCanvasKit}` },
         { ten: "DOM co dung 1 canvas trong man Studio", ok: (d.studio?.canvasTrongMan ?? -1) === 1, thay: `${d.studio?.canvasTrongMan} (toan trang ${d.canvasDom})` }]) };
      bao("L11", vai, kq.L11.pq, kq.L11.vi); luu("L11", kq.L11);
      // quay về tầng gốc cho các ca sau
      const o2 = await doiO(page, "chon-tang", tang0);
      await choStudioXong(page, o2.moc);
    }

    /* ── L1: tạo 1 thay đổi rồi đổi TẦNG ⇒ hộp thoại ─────────────────── */
    {
      const r = { ca: "L1", vai, deBai: "1 thay doi chua luu + doi TANG => hop thoai HIEN, dem CHUA ve 0, tang CHUA doi" };
      const t = await taoMotThayDoi(page);
      mayL1 = t.mayId;
      r.cachTaoThayDoi = `bam TAM khoi may ${t.mayId} tren canh roi lat cong-tac-khoa (doi daKhoa) — KHONG ghi DB`;
      r.truoc = t;
      r.anhTruoc = await anh(page, "L1-truoc-doi-tang");
      const o = await doiO(page, "chon-tang", tangKhac.id);
      r.ketCuc = o.ketCuc;
      const d = await doc(page);
      r.thay = { hopThoai: d.hopThoai, tangId: Number(d.studio?.oTang?.value), demChuaLuu: d.studio?.demChuaLuuSo, khoi: d.khoiCanh?.tong };
      r.anh = await anh(page, "L1-hop-thoai-hien");
      Object.assign(r, phan(
        { "dem-chua-luu truoc khi doi": t.demChuaLuu, "hop-thoai-chua-luu": d.hopThoai?.co, "o chon-tang sau khi doi": r.thay.tangId, "dem-chua-luu sau khi doi": r.thay.demChuaLuu },
        [
          { ten: "hop thoai HIEN RA", ok: d.hopThoai?.co === 1, thay: `co=${d.hopThoai?.co}` },
          { ten: "du ba nut nut-luu-roi-doi / nut-bo-thay-doi / nut-huy-doi", ok: d.hopThoai?.demNut?.luuRoiDoi === 1 && d.hopThoai?.demNut?.boThayDoi === 1 && d.hopThoai?.demNut?.huyDoi === 1, thay: JSON.stringify(d.hopThoai?.demNut) },
          { ten: "dem thay doi CHUA ve 0", ok: (r.thay.demChuaLuu ?? 0) > 0, thay: `${r.thay.demChuaLuu} ("${d.studio?.demChuaLuuChu}")` },
          { ten: `tang CHUA doi (van ${tang0})`, ok: r.thay.tangId === tang0, thay: `${r.thay.tangId}` },
          { ten: "canh van la canh tang cu", ok: r.thay.khoi === chung.mocDau.khoi, thay: `${r.thay.khoi} (tang cu ${chung.mocDau.khoi})` },
        ]));
      kq.L1 = r; bao("L1", vai, r.pq, r.vi); luu("L1", r);
    }

    /* ── L2: nut-huy-doi ⇒ ở lại, thay đổi còn nguyên ────────────────── */
    {
      const r = { ca: "L2", vai, deBai: "bam nut-huy-doi => o lai tang cu, thay doi CON NGUYEN" };
      await page.locator('[data-testid="nut-huy-doi"]').click();
      await page.waitForFunction(() => !document.querySelector('[data-testid="hop-thoai-chua-luu"]'), null, { timeout: 30_000 }).catch(() => {});
      const d = await doc(page);
      r.thay = { hopThoai: d.hopThoai?.co, tangId: Number(d.studio?.oTang?.value), demChuaLuu: d.studio?.demChuaLuuSo, chu: d.studio?.demChuaLuuChu, khoi: d.khoiCanh?.tong, nutLuu: d.studio?.nutLuu };
      r.anh = await anh(page, "L2-sau-huy-doi");
      Object.assign(r, phan(
        { "hop thoai": r.thay.hopThoai, "o chon-tang": r.thay.tangId, "dem-chua-luu": r.thay.demChuaLuu },
        [
          { ten: "hop thoai DA DONG", ok: r.thay.hopThoai === 0, thay: `${r.thay.hopThoai}` },
          { ten: `o lai tang cu ${tang0}`, ok: r.thay.tangId === tang0, thay: `${r.thay.tangId}` },
          { ten: "thay doi CON NGUYEN (dem > 0)", ok: (r.thay.demChuaLuu ?? 0) > 0, thay: `${r.thay.demChuaLuu} ("${r.thay.chu}")` },
          { ten: "canh van la canh tang cu", ok: r.thay.khoi === chung.mocDau.khoi, thay: `${r.thay.khoi}` },
        ]));
      kq.L2 = r; bao("L2", vai, r.pq, r.vi); luu("L2", r);
    }

    /* ── L5: đổi TOÀ và đổi NHÀ MÁY cũng phải qua cổng ───────────────── */
    {
      const r = { ca: "L5", vai, deBai: "doi TOA va doi NHA MAY khi con thay doi chua luu => cung phai qua cong (khong chi o tang)", buoc: [] };
      const d0b = await doc(page);
      r.demTruocKhiThu = d0b.studio?.demChuaLuuSo;
      const dsToa = (d0b.studio?.oToaNha?.muc ?? []).map((m) => Number(m.split(":")[0]));
      const toaKhac = dsToa.find((id) => id !== toaId);
      const dsNm = (d0b.studio?.oNhaMay?.muc ?? []).map((m) => Number(m.split(":")[0]));
      const nmKhac = dsNm.find((id) => id !== facId);
      r.oToaMuc = d0b.studio?.oToaNha?.muc; r.oNhaMayMuc = d0b.studio?.oNhaMay?.muc;
      if (!toaKhac) throw new Error("THIEU DU KIEN: toa KHAC trong o chon-toa-nha");
      if (!nmKhac) throw new Error("THIEU DU KIEN: nha may KHAC trong o chon-nha-may (vai nay phai thay >= 2 nha may)");
      // (a) đổi TOÀ
      const oa = await doiO(page, "chon-toa-nha", toaKhac);
      const da = await doc(page);
      r.doiToa = { ketCuc: oa.ketCuc, hopThoai: da.hopThoai?.co, toaId: Number(da.studio?.oToaNha?.value), demChuaLuu: da.studio?.demChuaLuuSo, moTa: da.hopThoai?.moTa };
      r.anhToa = await anh(page, "L5a-hop-thoai-khi-doi-toa");
      r.buoc.push(`chon-toa-nha=${toaKhac} => ${oa.ketCuc}`);
      if (da.hopThoai?.co === 1) { await page.locator('[data-testid="nut-huy-doi"]').click(); await page.waitForFunction(() => !document.querySelector('[data-testid="hop-thoai-chua-luu"]'), null, { timeout: 30_000 }).catch(() => {}); }
      // (b) đổi NHÀ MÁY
      const ob = await doiO(page, "chon-nha-may", nmKhac);
      const db2 = await doc(page);
      r.doiNhaMay = { ketCuc: ob.ketCuc, hopThoai: db2.hopThoai?.co, facId: Number(db2.studio?.oNhaMay?.value), demChuaLuu: db2.studio?.demChuaLuuSo, moTa: db2.hopThoai?.moTa };
      r.anhNhaMay = await anh(page, "L5b-hop-thoai-khi-doi-nha-may");
      r.buoc.push(`chon-nha-may=${nmKhac} => ${ob.ketCuc}`);
      if (db2.hopThoai?.co === 1) { await page.locator('[data-testid="nut-huy-doi"]').click(); await page.waitForFunction(() => !document.querySelector('[data-testid="hop-thoai-chua-luu"]'), null, { timeout: 30_000 }).catch(() => {}); }
      const dc = await doc(page);
      r.sauCung = { facId: Number(dc.studio?.oNhaMay?.value), toaId: Number(dc.studio?.oToaNha?.value), tangId: Number(dc.studio?.oTang?.value), demChuaLuu: dc.studio?.demChuaLuuSo };
      Object.assign(r, phan(
        { "dem-chua-luu truoc khi thu": r.demTruocKhiThu, "hop thoai khi doi TOA": r.doiToa.hopThoai, "hop thoai khi doi NHA MAY": r.doiNhaMay.hopThoai },
        [
          { ten: "van con thay doi chua luu luc bat dau ca", ok: (r.demTruocKhiThu ?? 0) > 0, thay: `${r.demTruocKhiThu}` },
          { ten: "doi TOA => hop thoai HIEN, toa CHUA doi", ok: r.doiToa.hopThoai === 1 && r.doiToa.toaId === toaId, thay: `hopThoai ${r.doiToa.hopThoai} · toa ${r.doiToa.toaId} (cu ${toaId})` },
          { ten: "doi NHA MAY => hop thoai HIEN, nha may CHUA doi", ok: r.doiNhaMay.hopThoai === 1 && r.doiNhaMay.facId === facId, thay: `hopThoai ${r.doiNhaMay.hopThoai} · nhaMay ${r.doiNhaMay.facId} (cu ${facId})` },
          { ten: "sau hai lan huy: van dung nguyen cho, thay doi con nguyen", ok: r.sauCung.facId === facId && r.sauCung.toaId === toaId && r.sauCung.tangId === tang0 && (r.sauCung.demChuaLuu ?? 0) > 0, thay: JSON.stringify(r.sauCung) },
        ]));
      kq.L5 = r; bao("L5", vai, r.pq, r.vi); luu("L5", r);
    }

    /* ── L3: nut-bo-thay-doi ⇒ đổi tầng, thay đổi mất (người dùng chọn) ─ */
    {
      const r = { ca: "L3", vai, deBai: "bam nut-bo-thay-doi => DOI tang, thay doi mat (nguoi dung DA CHON => DAT)" };
      const o = await doiO(page, "chon-tang", tangKhac.id);
      const dTruoc = await doc(page);
      r.hopThoaiHien = dTruoc.hopThoai?.co;
      r.demTruoc = dTruoc.studio?.demChuaLuuSo;
      if (dTruoc.hopThoai?.co !== 1) throw new Error(`THIEU DU KIEN: hop thoai khong hien de bam nut-bo-thay-doi (ketCuc ${o.ketCuc})`);
      const moc = await page.evaluate(() => window.__thongKeVe?.calls ?? 0);
      await page.locator('[data-testid="nut-bo-thay-doi"]').click();
      await page.waitForFunction((v) => !document.querySelector('[data-testid="hop-thoai-chua-luu"]') && document.querySelector('[data-testid="chon-tang"]')?.value === String(v), tangKhac.id, { timeout: 30_000 }).catch(() => {});
      await choStudioXong(page, moc);
      const d = await doc(page);
      r.thay = { hopThoai: d.hopThoai?.co, tangId: Number(d.studio?.oTang?.value), demChuaLuu: d.studio?.demChuaLuu, khoi: d.khoiCanh?.tong, skDaXepCho: d.studio?.skDaXepChoSo };
      r.anh = await anh(page, "L3-sau-bo-thay-doi");
      r.hangDbMayL1 = (await chupHang(sql, [mayL1])).map((h) => ({ thucTheId: h.thucTheId, tangId: h.tangId, daKhoa: h.daKhoa, nguon: h.nguon }));
      Object.assign(r, phan(
        { "hop thoai truoc khi bam": r.hopThoaiHien, "o chon-tang sau khi bo": r.thay.tangId, "dem-chua-luu sau khi bo": r.thay.demChuaLuu, "hang DB cua may vua sua": r.hangDbMayL1.length ? r.hangDbMayL1 : null },
        [
          { ten: `DA doi sang tang ${tangKhac.id}`, ok: r.thay.tangId === tangKhac.id, thay: `${r.thay.tangId}` },
          { ten: "thay doi da bo (dem-chua-luu = 0)", ok: r.thay.demChuaLuu === 0, thay: `${r.thay.demChuaLuu}` },
          { ten: `canh dung theo tang moi: ${tangKhac.soDatChoMay} khoi (so DB)`, ok: r.thay.khoi === Number(tangKhac.soDatChoMay), thay: `${r.thay.khoi}` },
          { ten: `DOI CHUNG DB: may ${mayL1} KHONG bi ghi (daKhoa van false)`, ok: r.hangDbMayL1[0]?.daKhoa === false, thay: JSON.stringify(r.hangDbMayL1) },
        ]));
      kq.L3 = r; bao("L3", vai, r.pq, r.vi); luu("L3", r);
    }

    /* ── L4: nut-luu-roi-doi ⇒ LƯU VÀO ĐÚNG TẦNG CŨ rồi mới đổi ──────── */
    {
      const r = { ca: "L4", vai, deBai: "bam nut-luu-roi-doi => ghi vao DUNG TANG CU (tang dang sua) roi moi doi tang" };
      tangL4 = tangKhac.id; // đang đứng ở tangKhac sau L3
      const t = await taoMotThayDoi(page);
      mayL4 = t.mayId;
      r.tangDangSua = tangL4;
      r.mayDaSua = mayL4;
      r.truoc = t;
      chupTruoc = await chupHang(sql, [mayL4]);
      r.hangDbTruoc = chupTruoc.map((h) => ({ thucTheId: h.thucTheId, tangId: h.tangId, daKhoa: h.daKhoa, nguon: h.nguon, updatedAt: h.updatedAt }));
      if (!chupTruoc.length) throw new Error(`THIEU DU KIEN: hang twin_dat_cho cua may ${mayL4} truoc khi ghi`);
      if (chupTruoc[0].tangId !== tangL4) throw new Error(`THIEU DU KIEN: hang DB cua may ${mayL4} dang o tang ${chupTruoc[0].tangId}, khong phai tang dang sua ${tangL4}`);
      r.anhTruoc = await anh(page, "L4-truoc-luu-roi-doi");
      const o = await doiO(page, "chon-tang", tang0);
      const dHt = await doc(page);
      r.hopThoai = dHt.hopThoai;
      if (dHt.hopThoai?.co !== 1) throw new Error(`THIEU DU KIEN: hop thoai khong hien de bam nut-luu-roi-doi (ketCuc ${o.ketCuc})`);
      const moc = await page.evaluate(() => window.__thongKeVe?.calls ?? 0);
      mangLuu.length = 0;
      await page.locator('[data-testid="nut-luu-roi-doi"]').click();
      await page.waitForFunction((v) => !document.querySelector('[data-testid="hop-thoai-chua-luu"]') && document.querySelector('[data-testid="chon-tang"]')?.value === String(v), tang0, { timeout: 60_000 }).catch(() => {});
      await choStudioXong(page, moc);
      const d = await doc(page);
      r.mangLuu = mangLuu;
      r.thay = { hopThoai: d.hopThoai?.co, tangId: Number(d.studio?.oTang?.value), demChuaLuu: d.studio?.demChuaLuu, khoi: d.khoiCanh?.tong, soCanvas: d.soCanvasKit };
      r.anh = await anh(page, "L4-sau-luu-roi-doi");
      const sauHang = await chupHang(sql, [mayL4]);
      r.hangDbSau = sauHang.map((h) => ({ thucTheId: h.thucTheId, tangId: h.tangId, daKhoa: h.daKhoa, nguon: h.nguon, updatedAt: h.updatedAt, viTriXMm: h.viTriXMm, viTriYMm: h.viTriYMm, viTriZMm: h.viTriZMm }));
      r.demSauGhi = await demHang(sql);
      const H = sauHang[0] ?? null;
      Object.assign(r, phan(
        { "tang dang sua (tang CU)": tangL4, "may da sua": mayL4, "hang DB truoc": r.hangDbTruoc[0] ?? null, "hang DB sau": r.hangDbSau[0] ?? null, "o chon-tang sau khi luu": r.thay.tangId },
        [
          { ten: `★ hang twin_dat_cho cua may ${mayL4} van o TANG CU ${tangL4} (KHONG phai tang moi ${tang0})`, ok: H?.tangId === tangL4, thay: `tangId ${H?.tangId} (tang cu ${tangL4} · tang moi ${tang0})` },
          { ten: "hang DA bi ghi that (daKhoa lat tu false sang true)", ok: chupTruoc[0].daKhoa === false && H?.daKhoa === true, thay: `truoc ${chupTruoc[0].daKhoa} -> sau ${H?.daKhoa}` },
          { ten: "co loi goi luuHangLoat 200", ok: mangLuu.some((x) => x.status === 200), thay: JSON.stringify(mangLuu) },
          { ten: `sau khi luu MOI doi sang tang ${tang0}`, ok: r.thay.tangId === tang0, thay: `${r.thay.tangId}` },
          { ten: "dem-chua-luu ve 0 va hop thoai dong", ok: r.thay.demChuaLuu === 0 && r.thay.hopThoai === 0, thay: `dem ${r.thay.demChuaLuu} · hopThoai ${r.thay.hopThoai}` },
          { ten: "KHONG tao them hang twin_dat_cho nao (cap nhat, khong chen)", ok: r.demSauGhi.tong === chung.demTruoc.tong && r.demSauGhi.qatd === chung.demTruoc.qatd, thay: `truoc ${JSON.stringify(chung.demTruoc)} -> sau ${JSON.stringify(r.demSauGhi)}` },
          { ten: "dung MOT hang QATD bi khoa (dung hang toi vua sua)", ok: r.demSauGhi.qatdDaKhoa === chung.demTruoc.qatdDaKhoa + 1, thay: `daKhoa ${chung.demTruoc.qatdDaKhoa} -> ${r.demSauGhi.qatdDaKhoa}` },
        ]));
      kq.L4 = r; bao("L4", vai, r.pq, r.vi); luu("L4", r);
    }
    await page.close();
  } catch (e) {
    const r = { ca: "H1-KHOI", vai, loi: String(e).slice(0, 700), pq: "HỎNG", vi: `HỎNG ${String(e).slice(0, 400)}` };
    bao("H1-KHOI", vai, r.pq, r.vi); luu("H1-KHOI-LOI", r);
    for (const c of ["L1", "L2", "L3", "L4", "L5", "L6", "L11"]) if (!kq[c]) kq[c] = { ca: c, vai, pq: "HỎNG", vi: `HỎNG khoi H1 dut giua chung: ${String(e).slice(0, 200)}` };
  } finally {
    /* ── DỌN: trả `daKhoa` về giá trị GỐC qua ĐƯỜNG SẢN PHẨM (luuHangLoat) ── */
    const don = { daGhi: null, hangKhoiPhuc: null };
    try {
      if (mayL4 && chupTruoc.length) {
        const g = chupTruoc[0];
        const rs = await trpcPost(ctx, "twinCanh.luuHangLoat", { hangs: [{
          loaiThucThe: "machine", thucTheId: g.thucTheId, tangId: g.tangId,
          viTriXMm: Number(g.viTriXMm), viTriYMm: Number(g.viTriYMm), viTriZMm: Number(g.viTriZMm),
          rongMm: g.rongMm === null ? null : Number(g.rongMm), caoMm: g.caoMm === null ? null : Number(g.caoMm), sauMm: g.sauMm === null ? null : Number(g.sauMm),
          kichThuocDaDo: g.kichThuocDaDo,
          quatX: Number(g.quatX), quatY: Number(g.quatY), quatZ: Number(g.quatZ), quatW: Number(g.quatW),
          daKhoa: g.daKhoa, hienThi: g.hienThi, nguon: g.nguon,
        }] });
        don.daGhi = rs;
        const sau = await chupHang(sql, [mayL4]);
        don.hangKhoiPhuc = sau.map((h) => ({ thucTheId: h.thucTheId, tangId: h.tangId, daKhoa: h.daKhoa, nguon: h.nguon }));
        don.khopGoc = sau[0] && sau[0].tangId === g.tangId && sau[0].daKhoa === g.daKhoa && sau[0].nguon === g.nguon &&
          String(sau[0].viTriXMm) === String(g.viTriXMm) && String(sau[0].viTriYMm) === String(g.viTriYMm) && String(sau[0].viTriZMm) === String(g.viTriZMm);
      }
      don.demSauDon = await demHang(sql);
      don.demTruoc = chung.demTruoc ?? null;
      don.sach = !!(don.demSauDon && chung.demTruoc && don.demSauDon.tong === chung.demTruoc.tong && don.demSauDon.qatd === chung.demTruoc.qatd && don.demSauDon.qatdDaKhoa === chung.demTruoc.qatdDaKhoa);
    } catch (e) { don.loi = String(e).slice(0, 300); }
    chung.don = don;
    console.log(`  DỌN        ${don.sach ? "SẠCH" : "CHƯA SẠCH"} · ${JSON.stringify(don.demTruoc)} -> ${JSON.stringify(don.demSauDon)} · khopGoc=${don.khopGoc}`);
    luu("H1-CHUNG", { ...chung, mayL1, mayL4, tangL4 });
    await sql.end(); await ctx.close();
  }
  return kq;
}

/* ══════════════════════════════════════════════════════════════════════ */
/* H5 — L7 / L8 / L9                                                      */
/* ══════════════════════════════════════════════════════════════════════ */
async function caL7L8(browser) {
  const vai = "qatd_kythuat";
  const ctx = await browser.newContext({ viewport: VP });
  const kq = {};
  try {
    await dangNhap(ctx, vai);
    const page = await moStudio(ctx);
    await choStudioXong(page, 0);
    const on1 = await choKhungOnDinh(page);
    const d1 = await doc(page);
    const r7 = { ca: "L7", vai, deBai: "mo /twin-studio KHONG cham gi => bbox tam khoi / canvas phai GAN muc sau khi bam Fit (vong 2: 4,74 %)", vong2: { bbox: "182x81", canvas: "726x431", tiLe: 0.0474, sauFit: 0.1972 } };
      r7.onDinh = on1;
      r7.thay = { khoi: d1.khoiCanh?.tong, trongKhung: d1.khoiCanh?.trongKhung, hop: d1.khoiCanh?.hop, skDaXepCho: d1.studio?.skDaXepChoSo, tangId: Number(d1.studio?.oTang?.value), soCanvas: d1.soCanvasKit };
    r7.anh = await anh(page, "L7-mount-dau-khong-cham-gi");
    /* ── L8 đối chứng: bấm Fit ⇒ tỉ lệ KHÔNG đổi đáng kể ─────────────── */
    await page.locator('[data-testid="nut-fit-tat-ca"]').click();
    const on2 = await choKhungOnDinh(page);
    const d2 = await doc(page);
    const r8 = { ca: "L8", vai, deBai: "doi chung: bam nut-fit-tat-ca SAU L7 => ti le KHONG doi dang ke (auto-fit da fit san)" };
    r8.onDinh = on2;
    r8.truoc = d1.khoiCanh?.hop; r8.sau = d2.khoiCanh?.hop;
    r8.anh = await anh(page, "L8-sau-bam-fit");
    const A = d1.khoiCanh?.hop, B = d2.khoiCanh?.hop;
    r8.lech = A && B ? { rongPx: Math.abs(A.rongPx - B.rongPx), caoPx: Math.abs(A.caoPx - B.caoPx), tiLe: Number(Math.abs(A.tiLeDienTich - B.tiLeDienTich).toFixed(4)), tiLeTuongDoi: A.tiLeDienTich ? Number((Math.abs(A.tiLeDienTich - B.tiLeDienTich) / A.tiLeDienTich).toFixed(4)) : null } : null;
    Object.assign(r7, phan(
      { "khoi may trong canh": r7.thay.khoi, "bbox tam khoi (mount dau)": A, "bbox sau khi bam Fit": B },
      [
        { ten: "co khoi may trong canh", ok: (r7.thay.khoi ?? 0) > 0, thay: `${r7.thay.khoi}` },
        { ten: "moi khoi deu TRONG KHUNG", ok: r7.thay.khoi === r7.thay.trongKhung, thay: `${r7.thay.trongKhung}/${r7.thay.khoi}` },
        { ten: "ti le >= 10 % (khong con 'gan trong' 4,74 % cua vong 2)", ok: (A?.tiLeDienTich ?? 0) >= 0.10, thay: `tiLeDienTich ${A?.tiLeDienTich} (bbox ${A?.rongPx}x${A?.caoPx} tren canvas ${A?.canvasRong}x${A?.canvasCao})` },
        { ten: "ti le GAN muc sau khi bam Fit (lech tuong doi <= 10 %)", ok: B && A && A.tiLeDienTich > 0 && Math.abs(A.tiLeDienTich - B.tiLeDienTich) / B.tiLeDienTich <= 0.10, thay: `mount dau ${A?.tiLeDienTich} · sau Fit ${B?.tiLeDienTich}` },
      ]));
    Object.assign(r8, phan(
      { "bbox truoc khi bam Fit": A, "bbox sau khi bam Fit": B },
      [
        { ten: "bam Fit KHONG lam nhay ti le (lech tuong doi <= 10 %)", ok: !!(A && B && A.tiLeDienTich > 0 && r8.lech.tiLeTuongDoi <= 0.10), thay: `${A?.tiLeDienTich} -> ${B?.tiLeDienTich} (lech tuong doi ${r8.lech?.tiLeTuongDoi})` },
        { ten: "bbox truoc/sau lech <= 8 px moi chieu", ok: !!(r8.lech && r8.lech.rongPx <= 8 && r8.lech.caoPx <= 8), thay: JSON.stringify(r8.lech) },
      ]));
    kq.L7 = r7; kq.L8 = r8;
    bao("L7", vai, r7.pq, r7.vi); luu("L7", r7);
    bao("L8", vai, r8.pq, r8.vi); luu("L8", r8);
    await page.close();
  } catch (e) {
    for (const c of ["L7", "L8"]) if (!kq[c]) kq[c] = { ca: c, vai, pq: "HỎNG", vi: `HỎNG ${String(e).slice(0, 300)}` };
    bao("L7/L8", vai, "HỎNG", String(e).slice(0, 300)); luu("L7L8-LOI", { loi: String(e).slice(0, 700) });
  }
  await ctx.close(); return kq;
}

/** L9 — người dùng tự xoay camera TRƯỚC khi cảnh dựng xong ⇒ auto-fit KHÔNG cướp camera. */
async function caL9(browser, tiLeAutoFit) {
  const vai = "qatd_kythuat";
  const ctx = await browser.newContext({ viewport: VP });
  const r = { ca: "L9", vai, deBai: "xoay camera TRUOC khi canh dung xong => auto-fit KHONG cuop camera", tiLeAutoFitCuaL7: tiLeAutoFit, buoc: [] };
  try {
    await dangNhap(ctx, vai);
    /* Thiết bị đo: LÀM CHẬM riêng truy vấn `canhThietKe` (3,5 s) để dựng đúng thứ tự mà
       docblock mô tả — Canvas xong TRƯỚC, dữ liệu về SAU. Không sửa mã sản phẩm. */
    const page = await moStudio(ctx, { tre: 3500 });
    await page.waitForSelector('[data-testid="xuong-thiet-ke"] canvas', { timeout: 60_000 });
    // chờ cảnh đã VẼ vài khung (⇒ `refCanh.current` đã có, mốc camera đã được chụp)
    await page.waitForFunction(() => (window.__thongKeVe?.calls ?? 0) >= 2, null, { timeout: 30_000 }).catch(() => {});
    const truocKeo = await page.evaluate(() => ({ soMay: (window.__demTuongTac?.dsMay?.() ?? []).length, ve: window.__thongKeVe?.calls ?? null }));
    r.truocKeo = truocKeo;
    if (truocKeo.soMay > 0) { r.canhBao = `may DA ve truoc khi keo (${truocKeo.soMay}) — cua so 'truoc khi canh dung xong' KHONG dung duoc`; }
    const box = await page.locator('[data-testid="xuong-thiet-ke"] canvas').boundingBox();
    if (!box) throw new Error("THIEU DU KIEN: bounding box cua canvas xuong-thiet-ke");
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(cx + i * 34, cy - i * 14);
    await page.mouse.up();
    r.buoc.push(`keo chuot xoay camera ${Math.round(12 * 34)}x${-Math.round(12 * 14)} px tren canvas luc chua co may`);
    r.sauKeo = await page.evaluate(() => ({ soMay: (window.__demTuongTac?.dsMay?.() ?? []).length, ve: window.__thongKeVe?.calls ?? null }));
    await choStudioXong(page, r.sauKeo.ve ?? 0);
    const onA = await choKhungOnDinh(page);
    const dA = await doc(page);
    r.sauKhiDuLieuVe = { onDinh: onA, hop: dA.khoiCanh?.hop, khoi: dA.khoiCanh?.tong, trongKhung: dA.khoiCanh?.trongKhung };
    r.anh = await anh(page, "L9-nguoi-dung-xoay-truoc");
    // ablation: bấm Fit ⇒ khung PHẢI nhảy (chứng tỏ Fit vẫn dùng được, và khung trước đó KHÔNG phải khung fit)
    await page.locator('[data-testid="nut-fit-tat-ca"]').click();
    const onB = await choKhungOnDinh(page);
    const dB = await doc(page);
    r.sauBamFit = { onDinh: onB, hop: dB.khoiCanh?.hop };
    r.anhSauFit = await anh(page, "L9-sau-bam-fit");
    const U = dA.khoiCanh?.hop, F = dB.khoiCanh?.hop;
    r.lech = U && F ? { rongPx: Math.abs(U.rongPx - F.rongPx), caoPx: Math.abs(U.caoPx - F.caoPx), tiLeTuongDoi: F.tiLeDienTich ? Number((Math.abs(U.tiLeDienTich - F.tiLeDienTich) / F.tiLeDienTich).toFixed(4)) : null } : null;
    Object.assign(r, phan(
      { "so may luc keo chuot": truocKeo.soMay === null ? null : truocKeo.soMay, "bbox sau khi du lieu ve (camera nguoi dung)": U, "bbox sau khi bam Fit": F },
      [
        { ten: "keo chuot dien ra TRUOC khi co khoi may nao", ok: truocKeo.soMay === 0, thay: `${truocKeo.soMay} khoi luc keo` },
        { ten: "sau khi du lieu ve, khung nhin KHAC khung fit (auto-fit da NHUONG camera)", ok: !!(r.lech && (r.lech.rongPx > 8 || r.lech.caoPx > 8)), thay: `nguoi dung ${U?.rongPx}x${U?.caoPx} (ti le ${U?.tiLeDienTich}) · fit ${F?.rongPx}x${F?.caoPx} (ti le ${F?.tiLeDienTich}) · lech ${JSON.stringify(r.lech)}` },
        { ten: "nut Fit VAN dung duoc (doi chung duong): bam xong ve dung khung fit cua L7", ok: !!(F && tiLeAutoFit && Math.abs(F.tiLeDienTich - tiLeAutoFit) / tiLeAutoFit <= 0.15), thay: `sau Fit ${F?.tiLeDienTich} · L7 ${tiLeAutoFit}` },
      ]));
    await page.close();
  } catch (e) { r.loi = String(e).slice(0, 600); r.pq = "HỎNG"; r.vi = `HỎNG ${r.loi}`; }
  bao("L9", vai, r.pq, r.vi); luu("L9", r); await ctx.close(); return { L9: r };
}

/* ══════════════════════════════════════════════════════════════════════ */
/* L10 — hồi quy V-05: quanly (0 canCreate) KHÔNG thấy nút sinh / tạo toà  */
/* ══════════════════════════════════════════════════════════════════════ */
async function caL10(browser) {
  const vai = "qatd_quanly";
  const ctx = await browser.newContext({ viewport: VP });
  const r = { ca: "L10", vai, deBai: "hoi quy V-05: quanly (canEdit, 0 canCreate) vao /twin-studio KHONG thay nut-mo-sinh va tab tao toa nha" };
  try {
    await dangNhap(ctx, vai);
    const page = await moStudio(ctx);
    await choStudioXong(page, 0);
    const d = await doc(page);
    r.thay = d.studio;
    r.demDom = await page.evaluate(() => {
      const q = (t) => [...document.querySelectorAll(`[data-testid="${t}"]`)].map((e) => ({ tag: e.tagName, disabled: e.disabled ?? null, aria: e.getAttribute("aria-disabled") }));
      return { "nut-mo-sinh": q("nut-mo-sinh"), "tab-con-duong-b": q("tab-con-duong-b"), "nut-luu": q("nut-luu") };
    });
    r.chuToanMan = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").trim());
    r.coChuGenerate = /Generate|Sinh t/i.test(r.chuToanMan);
    r.anh = await anh(page, "L10-quanly-studio");
    Object.assign(r, phan(
      { "xuong-thiet-ke": d.studio?.xuong, "dem nut-mo-sinh": d.studio?.nutMoSinh, "dem tab-con-duong-b": d.studio?.tabConDuongB },
      [
        { ten: "xuong-thiet-ke da dung", ok: (d.studio?.xuong ?? 0) === 1, thay: `${d.studio?.xuong}` },
        { ten: "nut-mo-sinh AN HAN (0 phan tu)", ok: d.studio?.nutMoSinh === 0 && r.demDom["nut-mo-sinh"].length === 0, thay: `${d.studio?.nutMoSinh} / ${JSON.stringify(r.demDom["nut-mo-sinh"])}` },
        { ten: "tab tao toa nha AN HAN (0 phan tu)", ok: d.studio?.tabConDuongB === 0 && r.demDom["tab-con-duong-b"].length === 0, thay: `${d.studio?.tabConDuongB}` },
        { ten: "khong co chu Generate tren man", ok: !r.coChuGenerate, thay: `${r.coChuGenerate}` },
        { ten: "doi chung DUONG: van con nut-luu (canEdit) — khong va qua tay", ok: (d.studio?.nutLuu ?? 0) === 1, thay: `nut-luu ${d.studio?.nutLuu}` },
      ]));
    await page.close();
  } catch (e) { r.loi = String(e).slice(0, 600); r.pq = "HỎNG"; r.vi = `HỎNG ${r.loi}`; }
  bao("L10", vai, r.pq, r.vi); luu("L10", r); await ctx.close(); return { L10: r };
}

/* ══════════════════════════════════════════════════════════════════════ */
/* L12 — 5 khoá i18n mới hiện đúng ở en / vi / zh                          */
/* ══════════════════════════════════════════════════════════════════════ */
const DAU_VIET = /[ăâđêôơưÁÀẢÃẠáàảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵĐ]/;
async function caL12(browser) {
  const vai = "qatd_kythuat";
  const r = { ca: "L12", vai, deBai: "5 khoa twin3d.studioUi.* moi (chuaLuuTieuDe/chuaLuuMoTa/luuRoiDoi/boThayDoi/huyDoiTang) hien DUNG o en, va o vi/zh khong lo khoa tho / khong lo dau tieng Viet", theoNgonNgu: {} };
  const kyVong = {
    en: { tieuDe: "Unsaved changes", luuRoiDoi: "Save and switch", boThayDoi: "Discard changes", huyDoi: "Stay on this floor", moTaChua: "will be LOST" },
    vi: { tieuDe: "Còn thay đổi chưa lưu", luuRoiDoi: "Lưu rồi chuyển", boThayDoi: "Bỏ thay đổi", huyDoi: "Ở lại tầng này", moTaChua: "sẽ MẤT" },
    zh: { tieuDe: "有未保存的更改", luuRoiDoi: "保存并切换", boThayDoi: "放弃更改", huyDoi: "留在本楼层", moTaChua: "丢失" },
  };
  try {
    for (const lang of ["en", "vi", "zh"]) {
      const ctx = await browser.newContext({ viewport: VP, locale: lang === "zh" ? "zh-CN" : lang === "vi" ? "vi-VN" : "en-US" });
      await dangNhap(ctx, vai);
      const page = await moStudio(ctx, { lang });
      await choStudioXong(page, 0);
      const t = await taoMotThayDoi(page);
      const tangHienTai = await page.evaluate(() => Number(document.querySelector('[data-testid="chon-tang"]')?.value));
      const muc = await page.evaluate(() => [...document.querySelectorAll('[data-testid="chon-tang"] option')].map((o) => Number(o.value)));
      const tangKhac = muc.find((m) => m !== tangHienTai);
      if (!tangKhac) throw new Error(`THIEU DU KIEN: tang khac trong o chon-tang (lang ${lang})`);
      await doiO(page, "chon-tang", tangKhac);
      const d = await doc(page);
      const H = d.hopThoai;
      const chuGop = [H?.chu, H?.moTa, H?.nutLuuRoiDoi, H?.nutBoThayDoi, H?.nutHuyDoi].filter(Boolean).join(" | ");
      r.theoNgonNgu[lang] = {
        htmlLang: d.lang, hopThoaiCo: H?.co, demChuaLuu: t.demChuaLuu, badgeChu: t.chu,
        tieuDeVaMoTa: H?.chu ?? null, moTa: H?.moTa ?? null,
        nutLuuRoiDoi: H?.nutLuuRoiDoi ?? null, nutBoThayDoi: H?.nutBoThayDoi ?? null, nutHuyDoi: H?.nutHuyDoi ?? null,
        coKhoaTho: /twin3d\.studioUi\./.test(chuGop), coDauViet: DAU_VIET.test(chuGop),
        coNoiSuyChuaThay: /\{\{\s*n\s*\}\}/.test(chuGop), coSo1: /\b1\b/.test(H?.moTa ?? ""),
      };
      r[`anh_${lang}`] = await anh(page, `L12-hop-thoai-${lang}`);
      // huỷ ⇒ KHÔNG ghi gì
      if (H?.co === 1) { await page.locator('[data-testid="nut-huy-doi"]').click(); await page.waitForFunction(() => !document.querySelector('[data-testid="hop-thoai-chua-luu"]'), null, { timeout: 30_000 }).catch(() => {}); }
      await page.close(); await ctx.close();
    }
    const E = r.theoNgonNgu.en, V = r.theoNgonNgu.vi, Z = r.theoNgonNgu.zh;
    Object.assign(r, phan(
      { "hop thoai en": E?.hopThoaiCo, "hop thoai vi": V?.hopThoaiCo, "hop thoai zh": Z?.hopThoaiCo, "chu nut en": E?.nutLuuRoiDoi, "chu nut vi": V?.nutLuuRoiDoi, "chu nut zh": Z?.nutLuuRoiDoi },
      [
        { ten: "en: 5 khoa hien dung chu tieng Anh", ok: (E?.tieuDeVaMoTa ?? "").includes(kyVong.en.tieuDe) && E?.nutLuuRoiDoi === kyVong.en.luuRoiDoi && E?.nutBoThayDoi === kyVong.en.boThayDoi && E?.nutHuyDoi === kyVong.en.huyDoi && (E?.moTa ?? "").includes(kyVong.en.moTaChua), thay: `"${E?.tieuDeVaMoTa}" | nut "${E?.nutLuuRoiDoi}" "${E?.nutBoThayDoi}" "${E?.nutHuyDoi}"` },
        { ten: "en: KHONG lo khoa tho, KHONG lo dau tieng Viet", ok: E?.coKhoaTho === false && E?.coDauViet === false, thay: `khoaTho ${E?.coKhoaTho} · dauViet ${E?.coDauViet}` },
        { ten: "en: noi suy {{n}} da thay bang so", ok: E?.coNoiSuyChuaThay === false && E?.coSo1 === true, thay: `"${E?.moTa}"` },
        { ten: "vi: hien dung chu tieng Viet", ok: (V?.tieuDeVaMoTa ?? "").includes(kyVong.vi.tieuDe) && V?.nutLuuRoiDoi === kyVong.vi.luuRoiDoi && V?.nutBoThayDoi === kyVong.vi.boThayDoi && V?.nutHuyDoi === kyVong.vi.huyDoi, thay: `"${V?.tieuDeVaMoTa}" | nut "${V?.nutLuuRoiDoi}" "${V?.nutBoThayDoi}" "${V?.nutHuyDoi}"` },
        { ten: "vi: KHONG lo khoa tho", ok: V?.coKhoaTho === false, thay: `${V?.coKhoaTho}` },
        { ten: "zh: hien dung chu tieng Trung", ok: (Z?.tieuDeVaMoTa ?? "").includes(kyVong.zh.tieuDe) && Z?.nutLuuRoiDoi === kyVong.zh.luuRoiDoi && Z?.nutBoThayDoi === kyVong.zh.boThayDoi && Z?.nutHuyDoi === kyVong.zh.huyDoi, thay: `"${Z?.tieuDeVaMoTa}" | nut "${Z?.nutLuuRoiDoi}" "${Z?.nutBoThayDoi}" "${Z?.nutHuyDoi}"` },
        { ten: "zh: KHONG lo khoa tho, KHONG lo dau tieng Viet (fallbackLng='vi' khong bi lo)", ok: Z?.coKhoaTho === false && Z?.coDauViet === false, thay: `khoaTho ${Z?.coKhoaTho} · dauViet ${Z?.coDauViet}` },
        { ten: "zh: noi suy {{n}} da thay bang so", ok: Z?.coNoiSuyChuaThay === false && Z?.coSo1 === true, thay: `"${Z?.moTa}"` },
      ]));
  } catch (e) { r.loi = String(e).slice(0, 600); r.pq = "HỎNG"; r.vi = `HỎNG ${r.loi}`; }
  bao("L12", vai, r.pq, r.vi); luu("L12", r); return { L12: r };
}

/* ══════════════════════════════════════════════════════════════════════ */
async function main() {
  const t0 = Date.now();
  const browser = await chromium.launch(LAUNCH);
  let kq = {};
  const chay = (c) => CA === "all" || CA === c || CA.split(",").includes(c);
  try {
    if (chay("H1") || ["L1", "L2", "L3", "L4", "L5", "L6", "L11"].some(chay)) Object.assign(kq, await caH1(browser));
    if (chay("H5") || chay("L7") || chay("L8")) Object.assign(kq, await caL7L8(browser));
    if (chay("H5") || chay("L9")) Object.assign(kq, await caL9(browser, kq.L7?.thay?.hop?.tiLeDienTich ?? null));
    if (chay("L10")) Object.assign(kq, await caL10(browser));
    if (chay("L12")) Object.assign(kq, await caL12(browser));
  } finally { await browser.close(); }
  const thuTu = ["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8", "L9", "L10", "L11", "L12"];
  const tom = {};
  for (const c of thuTu) if (kq[c]) tom[c] = kq[c].pq ?? "(khong co phan quyet)";
  luu("_TOM-TAT", { tom, giay: Math.round((Date.now() - t0) / 1000) });
  console.log("\n═══ TÓM TẮT ═══");
  for (const c of thuTu) if (kq[c]) console.log(`  ${String(kq[c].pq ?? "(khong co phan quyet)").padEnd(12)} ${c}`);
  console.log(`  (${Math.round((Date.now() - t0) / 1000)} s)`);
}
main().catch((e) => { console.error("LỖI CHUNG:", e); process.exit(1); });
