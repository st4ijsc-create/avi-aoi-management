/**
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * QA LẦN 11 · LÔ A + B — CỬA VÀO / PHẠM VI (A) và TOÀ / TẦNG (B)
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * Chạy:  node .qa-tapdoan/do-AB.mjs [--base=http://localhost:3064] [--ca=A1,A2,...]
 * Thô:   .qa-tapdoan/tho/AB/<ca>-<vai>.json   ·   Ảnh: .qa-tapdoan/anh/AB-*.png
 *
 * ── LUẬT CỦA THƯỚC NÀY (kế thừa .qa-dot59/do59.mjs, .qa-dot52/k8.mjs) ────────────────────────
 *   L1 FAIL-CLOSED. Mỗi ca khai TÊN dữ kiện nó cần (`canDuKien`). Thiếu một cái ⇒ **HỎNG**, kèm
 *      tên dữ kiện thiếu. `??` KHÔNG được dùng để vá một lỗ ĐỌC.
 *   L2 ĐỌC THEO NGHĨA. Dữ kiện lấy từ chữ người dùng đọc được (nhãn `<option>`, ô đếm, breadcrumb,
 *      banner); `data-testid` chỉ để TÌM. Kèm theo, mọi so sánh SỐ dùng id (không đoán tên).
 *   G146 tập RỖNG ⇒ HỎNG, không ĐẠT.  G130 ghi tệp tạm rồi `rename`, không `>` đè.
 *   G139 số 0 phải kèm đối chứng dương — ca B4/B5 (0 máy) đi CẶP với B2/B3 (n>0) CÙNG thiết bị.
 *   KHÔNG dùng cửa sổ thời gian cố định làm cửa kiểm: mọi phép đọc đi qua `choOnDinh()` —
 *      chờ `__thongKeVe.calls>0`, ô đếm thôi `—`, rồi BA lượt đọc GIỐNG NHAU (ổn định), không
 *      chờ một GIÁ TRỊ KỲ VỌNG nào (chờ kỳ vọng = phép đo tự thoả).
 *
 * ── KỲ VỌNG ĐỘC LẬP ─────────────────────────────────────────────────────────────────────────
 *   `.qa-tapdoan/ky-vong-db.json` (mayTheoNhaMay · mayTheoTang · ganNguoiDung) và
 *   `.qa-tapdoan/sinh-summary.json` (congTys · toas · tangs) — tính từ DB TRƯỚC khi đo.
 */
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";

/* ═══════════════════════════════════════════════════════════════════════════════════════════ */
/* 0. Tham số, đường ra, kỳ vọng                                                               */
/* ═══════════════════════════════════════════════════════════════════════════════════════════ */
const arg = (k, d) => {
  const m = process.argv.find((a) => a.startsWith(`--${k}=`));
  return m ? m.slice(k.length + 3) : d;
};
const BASE = arg("base", "http://localhost:3064");
const GOC = arg("goc", ".qa-tapdoan");
const OUT = `${GOC}/tho/AB`;
const ANH = `${GOC}/anh`;
const CHI_CA = arg("ca", "").split(",").map((s) => s.trim()).filter(Boolean);
const VP = { width: 1600, height: 900 };
const MK = "Qatd!2026";
mkdirSync(OUT, { recursive: true });
mkdirSync(ANH, { recursive: true });

const KV = JSON.parse(readFileSync(`${GOC}/ky-vong-db.json`, "utf8"));
const SS = JSON.parse(readFileSync(`${GOC}/sinh-summary.json`, "utf8"));

/** nhà máy theo id: { id, code, tong, active } */
const NM_THEO_ID = new Map(KV.mayTheoNhaMay.map((n) => [n.id, n]));
const NM_THEO_MA = new Map(KV.mayTheoNhaMay.map((n) => [n.code, n]));
/** tang_id → { capSo, toa, nm, may } */
const TANG_THEO_ID = new Map(KV.mayTheoTang.map((t) => [t.tang_id, t]));
/** factoryId → [toà] theo thứ tự id */
const TOA_THEO_NM = new Map();
for (const t of SS.toas) {
  if (!TOA_THEO_NM.has(t.factoryId)) TOA_THEO_NM.set(t.factoryId, []);
  TOA_THEO_NM.get(t.factoryId).push(t);
}
for (const v of TOA_THEO_NM.values()) v.sort((a, b) => a.id - b.id);
/** toaNhaId → [tầng] theo capSo */
const TANG_THEO_TOA = new Map();
for (const s of SS.tangs) {
  if (!TANG_THEO_TOA.has(s.toaNhaId)) TANG_THEO_TOA.set(s.toaNhaId, []);
  TANG_THEO_TOA.get(s.toaNhaId).push(s);
}
for (const v of TANG_THEO_TOA.values()) v.sort((a, b) => a.capSo - b.capSo);

/** Vai + kỳ vọng phạm vi (id nhà máy) từ bảng §2 của BRIEF + `ganNguoiDung` của DB. */
const VAI = [
  { u: "qatd_giamdoc", nguoi: "GIÁM ĐỐC", vaoTwin: true, nmKyVong: [38, 39, 40], loB: true },
  { u: "qatd_quanly", nguoi: "QUẢN LÝ", vaoTwin: true, nmKyVong: [38], loB: false },
  { u: "qatd_kythuat", nguoi: "KỸ THUẬT", vaoTwin: true, nmKyVong: [38, 39], loB: true },
  { u: "qatd_congnhan", nguoi: "CÔNG NHÂN", vaoTwin: true, nmKyVong: [40], loB: true },
  { u: "qatd_admin", nguoi: "ADMIN (bypass)", vaoTwin: true, nmKyVong: [1, 18, 38, 39, 40], loB: false },
  { u: "qatd_khonggan", nguoi: "0 GÁN", vaoTwin: true, nmKyVong: [], loB: false },
  { u: "qatd_khongquyen", nguoi: "0 QUYỀN", vaoTwin: false, nmKyVong: null, loB: false },
];
const VAI_A3 = ["qatd_giamdoc", "qatd_quanly", "qatd_kythuat", "qatd_congnhan"];

/* ═══════════════════════════════════════════════════════════════════════════════════════════ */
/* 1. Ghi thô — G130: tệp tạm rồi rename                                                       */
/* ═══════════════════════════════════════════════════════════════════════════════════════════ */
const SO = [];
function ghiCa(ban) {
  const ten = `${ban.id}-${ban.vai}`;
  const tam = `${OUT}/.tmp-${ten}.json`;
  writeFileSync(tam, JSON.stringify({ luc: new Date().toISOString(), base: BASE, ...ban }, null, 2));
  renameSync(tam, `${OUT}/${ten}.json`);
  SO.push(ban);
  console.log(`   ${String(ban.phanQuyet).padEnd(10)} ${ten}: ${ban.ketCuc}`);
}

/**
 * Cổng FAIL-CLOSED: `can` = { tênDữKiện: giáTrị }. Bất kỳ giá trị `null`/`undefined` ⇒ HỎNG.
 * Trả `null` khi đủ dữ kiện; trả bản ghi HỎNG khi thiếu.
 */
function thieu(can) {
  const t = Object.entries(can).filter(([, v]) => v === null || v === undefined).map(([k]) => k);
  return t.length > 0 ? t : null;
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════ */
/* 2. Đăng nhập + đọc trang                                                                     */
/* ═══════════════════════════════════════════════════════════════════════════════════════════ */
async function trpc(ctx, proc, input) {
  const u = `${BASE}/api/trpc/${proc}` + (input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`);
  const r = await ctx.request.get(u);
  const t = await r.text();
  let j = null;
  try { j = JSON.parse(t); } catch { /* không phải JSON */ }
  return {
    status: r.status(),
    data: j?.result?.data?.json ?? j?.result?.data ?? null,
    err: j?.error?.json?.data?.code ?? j?.error?.data?.code ?? (r.ok() ? null : `HTTP${r.status()}`),
  };
}
async function dangNhap(ctx, u) {
  const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: u, password: MK } });
  const me = await trpc(ctx, "auth.me");
  return { login: r.status(), ten: me.data?.username ?? null, role: me.data?.role ?? null };
}

/** Đọc TOÀN BỘ dữ kiện của màn /twin trong MỘT lượt evaluate. */
const docMan = (page) => page.evaluate(() => {
  const q = (t) => document.querySelector(`[data-testid="${t}"]`);
  const txt = (t) => { const e = q(t); return e ? (e.textContent ?? "").trim() : null; };
  const oChon = (t) => {
    const e = q(t);
    if (!e) return null;
    return {
      soMuc: e.getAttribute("data-so-muc"),
      giaTri: e.value === "" ? null : e.value,
      disabled: e.disabled,
      title: e.getAttribute("title"),
      muc: Array.from(e.options).map((o) => ({ gt: o.value, chu: (o.textContent ?? "").trim() })),
    };
  };
  const man = q("man-twin-van-hanh");
  const banner = {};
  for (const el of document.querySelectorAll('[data-testid^="banner-"],[data-testid="canh-bao-estop"]')) {
    const id = el.getAttribute("data-testid");
    if (id.endsWith("-an") || id.endsWith("-hanh-dong")) continue;
    banner[id] = (el.textContent ?? "").trim().slice(0, 320);
  }
  const dai = q("dai-hop-nhat");
  let dsMay = null;
  try {
    const f = window.__demTuongTac && window.__demTuongTac.dsMay;
    if (typeof f === "function") {
      const ds = f();
      dsMay = { so: ds.length, trongKhung: ds.filter((m) => m.trongKhung).length };
    }
  } catch (e) { dsMay = { loi: String(e) }; }
  const dsm = q("danh-sach-may");
  const ul = dsm ? dsm.querySelector("ul") : null;
  return {
    /* ★ NGÔN NGỮ PHẢI ĐƯỢC GHI: tài khoản QA mặc định **en**, nên mọi phép lọc chữ theo
       từ tiếng Việt sẽ mù. Đây là dữ kiện, không phải chú thích. */
    lang: document.documentElement.getAttribute("lang"),
    url: location.href,
    duong: location.pathname + location.search,
    coMan: !!man,
    h1: Array.from(document.querySelectorAll("h1")).map((h) => (h.textContent ?? "").trim()).slice(0, 3),
    h3: Array.from(document.querySelectorAll("h3")).map((h) => (h.textContent ?? "").trim()).slice(0, 3),
    coBoChonNap: !!q("bo-chon-nap"),
    chonNhaMay: oChon("chon-nha-may"),
    chonToaNha: oChon("chon-toa-nha"),
    chonTang: oChon("chon-tang"),
    demMay: txt("dem-may"),
    demTuoi: txt("dem-tuoi"),
    demCu: txt("dem-cu"),
    demKhongRo: txt("dem-khong-ro"),
    demNgung: txt("dem-ngung"),
    lyDoSoTrong: txt("ly-do-so-trong"),
    /* ★ Bảng KPI NỔI trên cảnh: nó tự khai PHẠM VI (`kpi-pham-vi`) và MẪU SỐ (`kpi-mau-so`).
       Trên một tầng TRỐNG, hai ô này là bằng chứng mạnh nhất cho câu hỏi "màn có khai số máy
       của tầng khác không" — mạnh hơn `dem-may`, vì ở đây phạm vi được VIẾT RA ngay cạnh số. */
    bangKpiNoi: q("bang-kpi-noi") ? {
      phamVi: txt("kpi-pham-vi"), mauSo: txt("kpi-mau-so"), mauSoOee: txt("kpi-mau-so-oee"),
      o: Array.from(document.querySelectorAll('[data-testid^="kpi-"]'))
        .filter((e) => !["kpi-pham-vi", "kpi-mau-so", "kpi-mau-so-oee"].includes(e.getAttribute("data-testid")))
        .map((e) => ({ id: e.getAttribute("data-testid"), chu: (e.textContent ?? "").trim().slice(0, 60) })),
    } : null,
    breadcrumb: txt("breadcrumb-twin"),
    breadcrumbCap: Array.from(document.querySelectorAll('[data-testid^="breadcrumb-"]'))
      .map((e) => ({ id: e.getAttribute("data-testid"), chu: (e.textContent ?? "").trim() })),
    danhSachMay: dsm ? { soMay: ul ? ul.getAttribute("data-so-may") : null, soHangVe: ul ? ul.getAttribute("data-so-hang-ve") : null, rong: txt("danh-sach-rong") } : null,
    banner,
    daiHopNhat: dai ? { soViec: dai.getAttribute("data-so-viec"), mo: dai.getAttribute("data-mo"), chu: (dai.textContent ?? "").trim().slice(0, 160) } : null,
    soCanvas: window.__soCanvas ?? null,
    canvasDom: document.querySelectorAll("canvas").length,
    canvasTrongMan: man ? man.querySelectorAll("canvas").length : null,
    thongKeVe: window.__thongKeVe ? { calls: window.__thongKeVe.calls, triangles: window.__thongKeVe.triangles, matContext: window.__thongKeVe.matContext } : null,
    dsMay,
    spin: man ? man.querySelectorAll(".animate-spin,.animate-pulse").length : null,
    manChu: man ? (man.innerText ?? "").trim().replace(/\s*\n\s*/g, " | ").slice(0, 900) : null,
    bodyChu: (document.body.innerText ?? "").trim().replace(/\s*\n\s*/g, " | ").slice(0, 700),
  };
});

/** Bung dải hợp nhất để đọc được các banner bị gộp (DaiHopNhat chỉ render chi tiết khi `mo`). */
async function moDai(page) {
  const nut = await page.$('[data-testid="nut-mo-dai-hop-nhat"]');
  if (!nut) return false;
  const mo = await page.$eval('[data-testid="dai-hop-nhat"]', (e) => e.getAttribute("data-mo")).catch(() => null);
  if (mo === "1") return true;
  await nut.click();
  await page.waitForSelector('[data-testid="dai-hop-nhat-chi-tiet"]', { timeout: 10_000 }).catch(() => {});
  return true;
}

/**
 * Cửa kiểm DUY NHẤT: màn hiện → khung đầu đã vẽ → ô đếm thôi `—` → BA lượt đọc GIỐNG NHAU.
 * KHÔNG chờ một giá trị kỳ vọng nào.
 */
async function choOnDinh(page, { choMan = true } = {}) {
  const t0 = Date.now();
  const r = { coMan: false, coKhungDau: false, hetDauGach: false, onDinh: false, soLuotOnDinh: 0, ms: 0 };
  if (choMan) {
    r.coMan = await page.waitForSelector('[data-testid="man-twin-van-hanh"]', { timeout: 60_000, state: "visible" })
      .then(() => true).catch(() => false);
    if (!r.coMan) { r.ms = Date.now() - t0; return r; }
  }
  r.coKhungDau = await page.waitForFunction(() => (window.__thongKeVe?.calls ?? 0) > 0, null, { timeout: 90_000 })
    .then(() => true).catch(() => false);
  r.hetDauGach = await page.waitForFunction(() => {
    const e = document.querySelector('[data-testid="dem-may"]');
    return !!e && (e.textContent ?? "").trim() !== "—";
  }, null, { timeout: 90_000 }).then(() => true).catch(() => false);
  let truoc = null;
  let dem = 0;
  for (let i = 0; i < 26 && dem < 3; i += 1) {
    const cur = await page.evaluate(() => {
      const d = document.querySelector('[data-testid="dem-may"]');
      let so = null;
      try { so = window.__demTuongTac?.dsMay ? window.__demTuongTac.dsMay().length : null; } catch { so = null; }
      const tg = document.querySelector('[data-testid="chon-tang"]');
      const toa = document.querySelector('[data-testid="chon-toa-nha"]');
      const nm = document.querySelector('[data-testid="chon-nha-may"]');
      return [(d?.textContent ?? "").trim(), so, tg ? tg.value : null, toa ? toa.value : null, nm ? nm.value : null];
    });
    const k = JSON.stringify(cur);
    if (k === truoc) dem += 1; else { dem = 1; truoc = k; }
    if (dem < 3) await page.waitForTimeout(700);
  }
  r.onDinh = dem >= 3;
  r.soLuotOnDinh = dem;
  r.ms = Date.now() - t0;
  return r;
}

const themDo = (d) => (d.includes("?") ? `${d}&do=1` : `${d}?do=1`);
async function mo(page, duong) {
  const t0 = Date.now();
  await page.goto(`${BASE}${themDo(duong)}`, { waitUntil: "domcontentloaded" });
  return { duongMo: themDo(duong), msGoto: Date.now() - t0 };
}
const anhCa = async (page, ten) => {
  const p = `${ANH}/AB-${ten}.png`;
  await page.screenshot({ path: p });
  return p;
};
const soCua = (s) => { const n = Number(String(s ?? "").replace(/[^\d-]/g, "")); return Number.isFinite(n) && String(s ?? "").trim() !== "" ? n : null; };

/** `dem-may` khớp đại lượng nào? Trả tên đại lượng (chuỗi) hoặc "khôngKhớpGìCả". */
function demMayKhopGi(demMay, kvTang, kvNmTong, kvNmActive) {
  const n = soCua(demMay);
  if (n === null) return "khôngĐọcĐược";
  if (n === kvTang) return "tầng";
  if (n === kvNmTong) return "nhàMáy(tổng)";
  if (n === kvNmActive) return "nhàMáy(active)";
  return "khôngKhớpGìCả";
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════ */
/* 3. Các ca                                                                                    */
/* ═══════════════════════════════════════════════════════════════════════════════════════════ */
const chay = (ma) => CHI_CA.length === 0 || CHI_CA.includes(ma);

async function main() {
  const browser = await chromium.launch();
  console.log(`▶ Lô A+B · base=${BASE} · vp=${VP.width}x${VP.height} · worker=1 (tuần tự) · ${new Date().toISOString()}`);

  for (const v of VAI) {
    const ctx = await browser.newContext({ viewport: VP, baseURL: BASE });
    const page = await ctx.newPage();
    const loi = [];
    page.on("pageerror", (e) => loi.push(String(e).slice(0, 200)));
    let dn = null;
    try {
      dn = await dangNhap(ctx, v.u);
      console.log(`\n── ${v.u} (${v.nguoi}) · login=${dn.login} me=${dn.ten}/${dn.role}`);
      if (dn.ten !== v.u) {
        for (const ma of ["A1", "A2"]) {
          ghiCa({
            id: ma, vai: v.u, moTa: `${ma} — không đăng nhập được`,
            deBai: "đăng nhập rồi mở /twin", duKienDoc: { login: dn.login, authMe: dn.ten },
            ketCuc: `đăng nhập THẤT BẠI (login=${dn.login}, auth.me=${dn.ten})`,
            phanQuyet: "HỎNG", thieuDuKien: ["auth.me.username"],
            viSao: "Không có phiên thì không phép đo nào của ca này có nghĩa (L1 fail-closed).",
          });
        }
        await ctx.close();
        continue;
      }

      /* ── API kỳ vọng độc lập (đường sản phẩm, để đối chiếu UI) ─────────────────────── */
      const fl = await trpc(ctx, "factory.list");
      const apiNm = Array.isArray(fl.data) ? fl.data.map((f) => ({ id: f.id, ma: f.code, ten: f.name })) : null;

      /* ═════════════════════ A1 — cửa vào /twin ═════════════════════ */
      let m1 = null;
      if (chay("A1")) {
        const g = await mo(page, "/twin");
        const cho = await choOnDinh(page, { choMan: v.vaoTwin });
        if (!v.vaoTwin) await page.waitForTimeout(2500);
        m1 = await docMan(page);
        const anh = (v.u === "qatd_giamdoc" || v.u === "qatd_khongquyen" || v.u === "qatd_khonggan")
          ? await anhCa(page, `A1-${v.u}`) : null;
        const can = { "man-twin-van-hanh có/không": m1.coMan, "URL cuối": m1.duong, "chữ trên body": m1.bodyChu };
        const th = thieu(can);
        const chuChan = /Không có quyền truy cập|No access|Access denied/i.test(m1.bodyChu ?? "");
        let pq, ketCuc, viSao;
        if (th) { pq = "HỎNG"; ketCuc = `thiếu dữ kiện: ${th.join(", ")}`; viSao = "L1 fail-closed."; }
        else if (v.vaoTwin) {
          pq = m1.coMan ? "ĐẠT" : "SAI";
          ketCuc = `coMan=${m1.coMan} · url=${m1.duong} · canvas(trongMan)=${m1.canvasTrongMan} · __soCanvas=${m1.soCanvas} · khungĐầu=${cho.coKhungDau}`;
          viSao = m1.coMan
            ? "Vai này phải vào được /twin theo bảng §2 và màn Vận hành đã hiện."
            : `Vai này phải vào được nhưng không thấy man-twin-van-hanh; body nói: "${(m1.bodyChu ?? "").slice(0, 160)}"`;
        } else {
          pq = !m1.coMan && chuChan ? "CHẶN-ĐÚNG" : "SAI";
          ketCuc = `coMan=${m1.coMan} · url=${m1.duong} · h1=${JSON.stringify(m1.h1)} · chữ="${(m1.bodyChu ?? "").slice(0, 200)}"`;
          viSao = pq === "CHẶN-ĐÚNG"
            ? "0 quyền ⇒ RouteGuard giữ NGUYÊN URL và nói thẳng 'Không có quyền truy cập' (không chuyển hướng, không màn trắng)."
            : "Vai 0 quyền lẽ ra bị chặn nhưng phép đo không thấy biểu hiện chặn.";
        }
        ghiCa({
          id: "A1", vai: v.u, moTa: `A1 · ${v.nguoi} · mở /twin`,
          deBai: `Mở ${g.duongMo}. Vai có quyền ⇒ thấy man-twin-van-hanh; qatd_khongquyen ⇒ bị chặn ĐÚNG (ghi biểu hiện + URL cuối).`,
          duKienDoc: {
            "URL cuối": m1.duong, "man-twin-van-hanh": m1.coMan, "h1": m1.h1, "h3": m1.h3,
            "canvas trong màn": m1.canvasTrongMan, "__soCanvas": m1.soCanvas, "__thongKeVe": m1.thongKeVe,
            "cửa chờ": cho, "chữ trên màn": m1.manChu, "chữ trên body": m1.bodyChu,
            "lỗi trang": loi.slice(0, 3), "factory.list (API)": apiNm ? apiNm.length : fl.err,
          },
          ketCuc, phanQuyet: pq, viSao, anh,
        });
      }

      /* ═════════════════════ A2 — ô chọn nhà máy = phạm vi ═════════════════════ */
      if (chay("A2")) {
        if (m1 === null) { await mo(page, "/twin"); await choOnDinh(page, { choMan: v.vaoTwin }); m1 = await docMan(page); }
        const anh = v.u === "qatd_khonggan" ? await anhCa(page, `A2-${v.u}`) : null;
        if (!v.vaoTwin) {
          ghiCa({
            id: "A2", vai: v.u, moTa: "A2 · 0 QUYỀN · ô chọn nhà máy",
            deBai: "Đọc ô chọn nhà máy trên /twin", duKienDoc: { "man-twin-van-hanh": m1.coMan, "bo-chon-nap": m1.coBoChonNap, "URL": m1.duong },
            ketCuc: "màn bị chặn ở A1 ⇒ không có ô chọn để đọc",
            phanQuyet: "N/A", viSao: "Ca A2 chỉ có nghĩa khi vào được màn; vai này CHẶN-ĐÚNG ở A1.", anh,
          });
        } else if (v.nmKyVong.length === 0) {
          /* khonggan — kỳ vọng 0 nhà máy + LÝ DO RỖNG đọc được */
          const chu = m1.manChu;
          const can = { "chữ trên màn": chu, "factory.list (API)": apiNm };
          const th = thieu(can);
          const coLyDo = /chưa được gán|chưa gán|no_factory|phạm vi|chưa có nhà máy|not assigned|Chưa có quyền/i.test(chu ?? "");
          const soApi = apiNm ? apiNm.length : null;
          let pq, ketCuc;
          if (th) { pq = "HỎNG"; ketCuc = `thiếu dữ kiện: ${th.join(", ")}`; }
          else if (soApi !== 0) { pq = "SAI"; ketCuc = `factory.list trả ${soApi} nhà máy cho tài khoản 0 gán`; }
          else if (!coLyDo) { pq = "SAI"; ketCuc = `0 nhà máy nhưng KHÔNG có câu lý do đọc được; chữ trên màn="${(chu ?? "").slice(0, 200)}"`; }
          else { pq = "ĐẠT"; ketCuc = `0 nhà máy · bo-chon-nap=${m1.coBoChonNap} · lý do rỗng đọc được: "${(chu ?? "").slice(0, 180)}"`; }
          ghiCa({
            id: "A2", vai: v.u, moTa: "A2 · 0 GÁN · ô chọn nhà máy + lý do rỗng",
            deBai: "Kỳ vọng 0 nhà máy VÀ có câu lý do rỗng đọc được (không phải màn trống im lặng).",
            duKienDoc: {
              "bo-chon-nap có/không": m1.coBoChonNap, "chon-nha-may": m1.chonNhaMay,
              "factory.list (API)": apiNm, "chữ trên màn": chu, "h3": m1.h3, "ly-do-so-trong": m1.lyDoSoTrong,
              "dem-may": m1.demMay, "spinner trong màn": m1.spin,
            },
            ketCuc, phanQuyet: pq, anh,
            viSao: pq === "ĐẠT"
              ? "Rỗng vì CHƯA ĐƯỢC GÁN khác rỗng vì yên ổn — màn nói đúng câu thứ nhất."
              : "Tập rỗng không kèm lý do đọc được là lời khai sai về thế giới (NT-3).",
          });
        } else {
          const can = { "chon-nha-may": m1.chonNhaMay, "factory.list (API)": apiNm };
          const th = thieu(can);
          if (th) {
            ghiCa({
              id: "A2", vai: v.u, moTa: `A2 · ${v.nguoi} · ô chọn nhà máy`,
              deBai: "Liệt kê CHỮ các nhà máy người dùng thấy, so với gán + mayTheoNhaMay",
              duKienDoc: { "chon-nha-may": m1.chonNhaMay, "factory.list (API)": apiNm, "chữ trên màn": m1.manChu },
              ketCuc: `thiếu dữ kiện: ${th.join(", ")}`, phanQuyet: "HỎNG", thieuDuKien: th,
              viSao: "L1 fail-closed — không suy ra phạm vi từ một ô không đọc được.",
            });
          } else {
            const idUi = m1.chonNhaMay.muc.map((o) => Number(o.gt)).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
            const kv = [...v.nmKyVong].sort((a, b) => a - b);
            const khop = JSON.stringify(idUi) === JSON.stringify(kv);
            const idApi = apiNm.map((f) => f.id).sort((a, b) => a - b);
            const khopApi = JSON.stringify(idUi) === JSON.stringify(idApi);
            const rong = idUi.length === 0;
            const pq = rong ? "HỎNG" : khop && khopApi ? "ĐẠT" : "SAI";
            ghiCa({
              id: "A2", vai: v.u, moTa: `A2 · ${v.nguoi} · ô chọn nhà máy`,
              deBai: `Kỳ vọng ${kv.length} nhà máy (id ${kv.join(",")}) theo ganNguoiDung + mayTheoNhaMay.`,
              duKienDoc: {
                "số mục (data-so-muc)": m1.chonNhaMay.soMuc,
                "CHỮ người dùng thấy": m1.chonNhaMay.muc.map((o) => o.chu),
                "id các mục": idUi, "đang chọn": m1.chonNhaMay.giaTri, "title ô": m1.chonNhaMay.title,
                "factory.list (API)": apiNm,
                "kỳ vọng id": kv,
                "máy theo nhà máy (DB)": kv.map((id) => ({ id, ma: NM_THEO_ID.get(id)?.code ?? "?", may: NM_THEO_ID.get(id)?.tong ?? null })),
              },
              ketCuc: `UI ${idUi.length} nhà máy [${m1.chonNhaMay.muc.map((o) => o.chu).join(" · ")}] · id ${idUi.join(",")} · API ${idApi.join(",")} · kỳ vọng ${kv.join(",")}`,
              phanQuyet: pq,
              viSao: pq === "ĐẠT"
                ? "Tập nhà máy trong ô chọn = tập được gán, và UI khớp API (một nguồn sự thật)."
                : rong ? "Tập rỗng ⇒ HỎNG chứ không ĐẠT (G146)." : "Ô chọn liệt kê tập KHÁC tập được gán.",
            });
          }
        }
      }

      /* ═════════════════════ A3 — dem-may với nhà máy/tầng mặc định ═════════════════════ */
      if (chay("A3") && VAI_A3.includes(v.u)) {
        await mo(page, "/twin");
        const cho = await choOnDinh(page);
        await moDai(page);
        const m = await docMan(page);
        const anh = await anhCa(page, `A3-${v.u}`);
        const nmId = soCua(m.chonNhaMay?.giaTri);
        const tangId = soCua(m.chonTang?.giaTri);
        const can = {
          "dem-may": m.demMay, "chon-nha-may.giaTri": m.chonNhaMay?.giaTri, "chon-tang.giaTri": m.chonTang?.giaTri,
          "window.__demTuongTac.dsMay()": m.dsMay && m.dsMay.so !== undefined ? m.dsMay.so : null,
          "mayTheoTang[tangId] (DB)": tangId !== null && TANG_THEO_ID.has(tangId) ? TANG_THEO_ID.get(tangId).may : null,
          "mayTheoNhaMay[nmId] (DB)": nmId !== null && NM_THEO_ID.has(nmId) ? NM_THEO_ID.get(nmId).tong : null,
        };
        const th = thieu(can);
        if (th) {
          ghiCa({
            id: "A3", vai: v.u, moTa: `A3 · ${v.nguoi} · dem-may ở nhà máy/tầng mặc định`,
            deBai: "Đọc dem-may sau khi cảnh dựng, so với số máy DB của ĐÚNG tầng đang chọn.",
            duKienDoc: { ...can, "cửa chờ": cho, "đọc được": m }, ketCuc: `thiếu dữ kiện: ${th.join(", ")}`,
            phanQuyet: "HỎNG", thieuDuKien: th, viSao: "L1 fail-closed.", anh,
          });
        } else {
          const tg = TANG_THEO_ID.get(tangId);
          const nm = NM_THEO_ID.get(nmId);
          const khop = demMayKhopGi(m.demMay, tg.may, nm.tong, nm.active);
          const canhKhopTang = m.dsMay.so === tg.may;
          const pq = khop === "khôngKhớpGìCả" || khop === "khôngĐọcĐược" ? "SAI" : "ĐẠT";
          ghiCa({
            id: "A3", vai: v.u, moTa: `A3 · ${v.nguoi} · dem-may ở nhà máy/tầng mặc định`,
            deBai: "Đọc dem-may + 4 ô đếm tuổi sau khi cảnh dựng; so với số máy DB của ĐÚNG tầng đang chọn và của cả nhà máy; ghi rõ nó khớp cái gì.",
            duKienDoc: {
              "dem-may": m.demMay, "dem-tuoi": m.demTuoi, "dem-cu": m.demCu, "dem-khong-ro": m.demKhongRo, "dem-ngung": m.demNgung,
              "nhà máy đang chọn": { id: nmId, chu: m.chonNhaMay.muc.find((o) => o.gt === m.chonNhaMay.giaTri)?.chu ?? null, ma: nm.code },
              "toà đang chọn": { id: m.chonToaNha?.giaTri, chu: m.chonToaNha?.muc.find((o) => o.gt === m.chonToaNha.giaTri)?.chu ?? null },
              "tầng đang chọn": { id: tangId, chu: m.chonTang.muc.find((o) => o.gt === m.chonTang.giaTri)?.chu ?? null, capSo: tg.capSo, toa: tg.toa },
              "breadcrumb": m.breadcrumb,
              "máy DB của tầng này": tg.may, "máy DB của cả nhà máy": { tong: nm.tong, active: nm.active },
              "máy VẼ trên cảnh (dsMay)": m.dsMay,
              "danh-sach-may data-so-may": m.danhSachMay?.soMay,
              "banner": m.banner, "dải hợp nhất": m.daiHopNhat,
              "__thongKeVe": m.thongKeVe, "__soCanvas": m.soCanvas, "cửa chờ": cho,
            },
            ketCuc: `dem-may=${m.demMay} KHỚP **${khop}** (tầng ${tangId} có ${tg.may} máy · nhà máy ${nm.code} có ${nm.tong}); cảnh 3D vẽ ${m.dsMay.so} máy (khớp tầng=${canhKhopTang}); danh-sach-may=${m.danhSachMay?.soMay}`,
            phanQuyet: pq,
            viSao: khop === "tầng"
              ? "Ô đếm là số của TẦNG đang chọn và khớp DB."
              : khop.startsWith("nhàMáy")
                ? `Ô "Máy" ở panel trái là số của CẢ NHÀ MÁY (=${m.demMay}), không phải của tầng đang chọn (${tg.may}); số của tầng chỉ đọc được từ cảnh 3D (dsMay=${m.dsMay.so}). Nguồn: TwinVanHanh.tsx:2924 ← :910 ← :821 (may = canhQ.data.may) ← server/db/twinCanh.ts:951 traCayPhanCapNhaMay trả MỌI máy của nhà máy.`
                : `dem-may=${m.demMay} không khớp tầng (${tg.may}) cũng không khớp nhà máy (${nm.tong}/${nm.active}).`,
            anh,
          });
        }
      }

      /* ═════════════════════ LÔ B ═════════════════════ */
      if (v.loB) {
        /* Nhà máy mặc định của vai + toà/tầng kỳ vọng từ DB */
        await mo(page, "/twin");
        const choB = await choOnDinh(page);
        const m0 = await docMan(page);
        const nmId = soCua(m0.chonNhaMay?.giaTri);
        const toaDb = nmId !== null ? (TOA_THEO_NM.get(nmId) ?? []) : [];
        const toa1 = toaDb[0] ?? null;
        const tangToa1 = toa1 ? (TANG_THEO_TOA.get(toa1.id) ?? []) : [];

        /* ── B1: 4 toà/nhà máy, 7 tầng/toà ───────────────────────────────────── */
        if (chay("B1")) {
          const can = {
            "chon-toa-nha": m0.chonToaNha, "chon-tang": m0.chonTang, "chon-nha-may.giaTri": m0.chonNhaMay?.giaTri,
            "toà DB của nhà máy này": toaDb.length > 0 ? toaDb.length : null,
          };
          const th = thieu(can);
          if (th) {
            ghiCa({
              id: "B1", vai: v.u, moTa: `B1 · ${v.nguoi} · đếm toà và tầng trong bộ chọn`,
              deBai: "Đếm số toà trong ô chọn toà và số tầng trong ô chọn tầng; kỳ vọng 4 toà/nhà máy, 7 tầng/toà.",
              duKienDoc: { ...can, "đọc được": m0 }, ketCuc: `thiếu dữ kiện: ${th.join(", ")}`,
              phanQuyet: "HỎNG", thieuDuKien: th, viSao: "L1 fail-closed.",
            });
          } else {
            const soToa = m0.chonToaNha.muc.length;
            const soTang = m0.chonTang.muc.length;
            const idToaUi = m0.chonToaNha.muc.map((o) => Number(o.gt)).sort((a, b) => a - b);
            const idToaDb = toaDb.map((t) => t.id).sort((a, b) => a - b);
            const idTangUi = m0.chonTang.muc.map((o) => Number(o.gt)).sort((a, b) => a - b);
            const idTangDb = tangToa1.map((t) => t.id).sort((a, b) => a - b);
            const ok = soToa === 4 && soTang === 7
              && JSON.stringify(idToaUi) === JSON.stringify(idToaDb)
              && JSON.stringify(idTangUi) === JSON.stringify(idTangDb);
            ghiCa({
              id: "B1", vai: v.u, moTa: `B1 · ${v.nguoi} · đếm toà và tầng trong bộ chọn`,
              deBai: "Đếm số toà trong ô chọn toà và số tầng trong ô chọn tầng; kỳ vọng 4 toà/nhà máy, 7 tầng/toà (BRIEF §3.1 B1). Ghi chú: `bang-tang` chỉ tồn tại ở màn Studio (DungNhaXuong.tsx:280) nên tầng đọc từ `chon-tang`.",
              duKienDoc: {
                "nhà máy đang chọn": { id: nmId, ma: NM_THEO_ID.get(nmId)?.code ?? null },
                "số toà trong ô chọn": soToa, "data-so-muc(toà)": m0.chonToaNha.soMuc,
                "CHỮ các toà": m0.chonToaNha.muc.map((o) => o.chu), "id các toà (UI)": idToaUi, "id các toà (DB)": idToaDb,
                "số tầng trong ô chọn": soTang, "data-so-muc(tầng)": m0.chonTang.soMuc,
                "CHỮ các tầng": m0.chonTang.muc.map((o) => o.chu), "id các tầng (UI)": idTangUi, "id các tầng (DB toà đầu)": idTangDb,
                "bang-tang trên /twin": "KHÔNG có (thuộc màn Studio)", "cửa chờ": choB,
              },
              ketCuc: `${soToa} toà [${m0.chonToaNha.muc.map((o) => o.chu).join(" · ")}] · ${soTang} tầng [${m0.chonTang.muc.map((o) => o.chu).join(" · ")}]`,
              phanQuyet: ok ? "ĐẠT" : "SAI",
              viSao: ok
                ? "Bộ chọn liệt kê ĐÚNG 4 toà của nhà máy và 7 tầng của toà đang chọn, id khớp DB."
                : `Kỳ vọng 4 toà/7 tầng và id khớp DB; đọc được ${soToa}/${soTang}.`,
            });
          }
        }

        /* ── B2/B3: tầng cấp 1 rồi cấp 2 của toà 1 ────────────────────────────── */
        for (const [ma, cap] of [["B2", 1], ["B3", 2]]) {
          if (!chay(ma)) continue;
          const tgDb = tangToa1.find((t) => t.capSo === cap) ?? null;
          if (!toa1 || !tgDb) {
            ghiCa({
              id: ma, vai: v.u, moTa: `${ma} · ${v.nguoi} · tầng cấp ${cap} của toà 1`,
              deBai: `Chọn tầng cấp ${cap} của toà 1 rồi so dem-may với mayTheoTang`,
              duKienDoc: { "toà 1 (DB)": toa1, "tầng cấp N (DB)": tgDb, "nhà máy": nmId },
              ketCuc: "không dựng được kỳ vọng DB cho toà/tầng này", phanQuyet: "HỎNG",
              thieuDuKien: [toa1 ? `tangs[toaNhaId=${toa1.id}, capSo=${cap}]` : `toas[factoryId=${nmId}]`],
              viSao: "L1 fail-closed.",
            });
            continue;
          }
          await page.selectOption('[data-testid="chon-toa-nha"]', String(toa1.id));
          await choOnDinh(page);
          await page.selectOption('[data-testid="chon-tang"]', String(tgDb.id));
          const cho = await choOnDinh(page);
          await moDai(page);
          const m = await docMan(page);
          const anh = await anhCa(page, `${ma}-${v.u}-tang${cap}`);
          const kvTang = TANG_THEO_ID.get(tgDb.id)?.may ?? null;
          const nm = NM_THEO_ID.get(nmId) ?? null;
          const can = {
            "dem-may": m.demMay, "chon-tang.giaTri": m.chonTang?.giaTri,
            "window.__demTuongTac.dsMay()": m.dsMay && m.dsMay.so !== undefined ? m.dsMay.so : null,
            "mayTheoTang[tangId] (DB)": kvTang, "mayTheoNhaMay (DB)": nm ? nm.tong : null,
          };
          const th = thieu(can);
          if (th) {
            ghiCa({
              id: ma, vai: v.u, moTa: `${ma} · ${v.nguoi} · tầng cấp ${cap} của toà 1 (${toa1.ma})`,
              deBai: `Chọn tầng cấp ${cap} (tang_id=${tgDb.id}) của toà ${toa1.ma} ⇒ dem-may khớp mayTheoTang.`,
              duKienDoc: { ...can, "cửa chờ": cho, "đọc được": m }, ketCuc: `thiếu dữ kiện: ${th.join(", ")}`,
              phanQuyet: "HỎNG", thieuDuKien: th, viSao: "L1 fail-closed.", anh,
            });
            continue;
          }
          const dungTang = soCua(m.chonTang.giaTri) === tgDb.id;
          const khop = demMayKhopGi(m.demMay, kvTang, nm.tong, nm.active);
          const canhKhop = m.dsMay.so === kvTang;
          const pq = !dungTang ? "SAI" : khop === "tầng" ? "ĐẠT" : "SAI";
          ghiCa({
            id: ma, vai: v.u, moTa: `${ma} · ${v.nguoi} · tầng cấp ${cap} của toà 1 (${toa1.ma})`,
            deBai: `Chọn tầng cấp ${cap} (tang_id=${tgDb.id}, toà ${toa1.ma}) qua ô chọn thật ⇒ dem-may khớp mayTheoTang của ĐÚNG tang_id đó (${kvTang} máy).`,
            duKienDoc: {
              "tầng đã chọn (UI)": m.chonTang.giaTri, "tang_id kỳ vọng": tgDb.id, "CHỮ tầng": m.chonTang.muc.find((o) => o.gt === m.chonTang.giaTri)?.chu ?? null,
              "toà đã chọn (UI)": m.chonToaNha?.giaTri, "toà kỳ vọng": toa1.id, "CHỮ toà": m.chonToaNha?.muc.find((o) => o.gt === m.chonToaNha.giaTri)?.chu ?? null,
              "URL sau khi chọn": m.duong,
              "dem-may": m.demMay, "dem-tuoi": m.demTuoi, "dem-cu": m.demCu, "dem-khong-ro": m.demKhongRo, "dem-ngung": m.demNgung,
              "máy DB của tầng": kvTang, "máy DB của nhà máy": { tong: nm.tong, active: nm.active },
              "máy VẼ trên cảnh (dsMay)": m.dsMay, "cảnh khớp tầng": canhKhop,
              "dem-may khớp": khop,
              "danh-sach-may data-so-may": m.danhSachMay?.soMay, "breadcrumb": m.breadcrumb,
              "banner": m.banner, "dải hợp nhất": m.daiHopNhat, "__thongKeVe": m.thongKeVe, "cửa chờ": cho,
            },
            ketCuc: `tầng ${tgDb.id} (cấp ${cap}) · DB ${kvTang} máy · dem-may=${m.demMay} (khớp ${khop}) · cảnh vẽ ${m.dsMay.so} máy (khớp tầng=${canhKhop})`,
            phanQuyet: pq,
            viSao: pq === "ĐẠT"
              ? `dem-may = ${kvTang} = số máy DB của tang_id ${tgDb.id}.`
              : !dungTang
                ? `Ô chọn tầng không nhận lựa chọn: đang ở ${m.chonTang.giaTri}, yêu cầu ${tgDb.id}.`
                : `dem-may là số của CẢ NHÀ MÁY (${m.demMay} = ${nm.code} ${nm.tong} máy), KHÔNG phải của tầng (${kvTang}). Cảnh 3D thì vẽ đúng ${m.dsMay.so} máy của tầng ⇒ lỗi ở CHỖ ĐẾM, không ở dữ liệu. Nguồn: TwinVanHanh.tsx:2924 (dem-may = mayVanHanh.length) ← :910 ← :821 (canhQ.data.may) ← server/db/twinCanh.ts:951.`,
            anh,
          });
        }

        /* ── B4/B5: tầng cấp 3 và cấp 7 (không xưởng) ⇒ 0 máy + rỗng TRUNG THỰC ── */
        for (const [ma, cap] of [["B4", 3], ["B5", 7]]) {
          if (!chay(ma)) continue;
          const tgDb = tangToa1.find((t) => t.capSo === cap) ?? null;
          if (!toa1 || !tgDb) {
            ghiCa({
              id: ma, vai: v.u, moTa: `${ma} · ${v.nguoi} · tầng cấp ${cap} (không xưởng)`,
              deBai: `Chọn tầng cấp ${cap} ⇒ 0 máy + trạng thái rỗng trung thực`,
              duKienDoc: { "toà 1 (DB)": toa1, "tầng cấp N (DB)": tgDb },
              ketCuc: "không dựng được kỳ vọng DB", phanQuyet: "HỎNG",
              thieuDuKien: [`tangs[toaNhaId=${toa1 ? toa1.id : "?"}, capSo=${cap}]`], viSao: "L1 fail-closed.",
            });
            continue;
          }
          await page.selectOption('[data-testid="chon-toa-nha"]', String(toa1.id));
          await choOnDinh(page);
          await page.selectOption('[data-testid="chon-tang"]', String(tgDb.id));
          const cho = await choOnDinh(page);
          await moDai(page);
          const m = await docMan(page);
          const anh = await anhCa(page, `${ma}-${v.u}-tang${cap}-trong`);
          const kvTang = TANG_THEO_ID.get(tgDb.id)?.may ?? null;
          const nm = NM_THEO_ID.get(nmId) ?? null;
          const can = {
            "dem-may": m.demMay, "chon-tang.giaTri": m.chonTang?.giaTri,
            "window.__demTuongTac.dsMay()": m.dsMay && m.dsMay.so !== undefined ? m.dsMay.so : null,
            "mayTheoTang[tangId] (DB)": kvTang, "số spinner trong màn": m.spin,
            "canvas trong màn": m.canvasTrongMan, "__thongKeVe": m.thongKeVe, "chữ trên màn": m.manChu,
          };
          const th = thieu(can);
          if (th) {
            ghiCa({
              id: ma, vai: v.u, moTa: `${ma} · ${v.nguoi} · tầng cấp ${cap} của toà ${toa1.ma} (0 xưởng)`,
              deBai: `Chọn tầng cấp ${cap} ⇒ 0 máy VÀ trạng thái rỗng TRUNG THỰC (có chữ giải thích, không spinner treo, không khai số máy của tầng khác).`,
              duKienDoc: { ...can, "cửa chờ": cho, "đọc được": m }, ketCuc: `thiếu dữ kiện: ${th.join(", ")}`,
              phanQuyet: "HỎNG", thieuDuKien: th, viSao: "L1 fail-closed.", anh,
            });
            continue;
          }
          /*
           * ★★★ THIẾT BỊ ĐO — BẢN VÁ LẦN 1 (2026-09-15, giữa đợt).
           * Bản đầu lọc banner bằng TỪ TIẾNG VIỆT (`/máy|chỗ|tầng|xưởng/`). Đo thật thì
           * `document.documentElement.lang = "en"` cho mọi tài khoản QA, và câu giải thích
           * THẬT là *"371 machines are outside this load (other buildings were not queried)
           * — whether they are placed is not known yet"* ⇒ bộ lọc trả [] và ca phán **SAI
           * OAN** (đúng lớp lỗi "thước đọc sai BỀ MẶT" của QA lần 10).
           * ⇒ Nay: MỌI banner CÓ CHỮ là một câu giải thích đọc được, bất kể ngôn ngữ; ghi
           *   nguyên văn để người đọc tự thẩm, và nêu riêng `banner-ngoai-luot-nap`.
           */
          const chuGiaiThich = Object.entries(m.banner)
            .filter(([, c]) => String(c ?? "").trim().length > 0)
            .map(([k, c]) => `${k}: ${c}`);
          const dungTang = soCua(m.chonTang.giaTri) === tgDb.id;
          const canh0 = m.dsMay.so === 0;
          const dbLa0 = kvTang === 0;
          const khongTreo = m.spin === 0 && m.canvasTrongMan >= 1 && (m.thongKeVe?.calls ?? 0) > 0 && m.demMay !== "—";
          const coChu = chuGiaiThich.length > 0 || (m.danhSachMay?.rong ?? null) !== null;
          const demMay0 = soCua(m.demMay) === 0;
          const khop = demMayKhopGi(m.demMay, kvTang, nm.tong, nm.active);
          const pq = !dungTang ? "SAI"
            : !dbLa0 ? "HỎNG"
              : !canh0 ? "SAI"
                : !khongTreo ? "SAI"
                  : !coChu ? "SAI"
                    : demMay0 ? "ĐẠT" : "SAI";
          ghiCa({
            id: ma, vai: v.u, moTa: `${ma} · ${v.nguoi} · tầng cấp ${cap} của toà ${toa1.ma} (0 xưởng)`,
            deBai: `Chọn tầng cấp ${cap} (tang_id=${tgDb.id}) ⇒ kỳ vọng 0 máy VÀ trạng thái rỗng TRUNG THỰC: có chữ giải thích, KHÔNG spinner treo, KHÔNG khai số máy của tầng khác.`,
            duKienDoc: {
              "tầng đã chọn (UI)": m.chonTang.giaTri, "tang_id kỳ vọng": tgDb.id, "CHỮ tầng": m.chonTang.muc.find((o) => o.gt === m.chonTang.giaTri)?.chu ?? null,
              "máy DB của tầng này": kvTang, "máy VẼ trên cảnh (dsMay)": m.dsMay,
              "dem-may": m.demMay, "dem-may khớp": khop, "máy DB của nhà máy": { tong: nm.tong, active: nm.active },
              "spinner/pulse trong màn": m.spin, "canvas trong màn": m.canvasTrongMan, "__thongKeVe": m.thongKeVe,
              "ngôn ngữ trang (html lang)": m.lang,
              "bảng KPI nổi (phạm vi tự khai + mẫu số)": m.bangKpiNoi,
              "chữ giải thích rỗng (banner)": chuGiaiThich,
              "banner-ngoai-luot-nap (nguyên văn)": m.banner["banner-ngoai-luot-nap"] ?? null,
              "danh-sach-rong": m.danhSachMay?.rong,
              "danh-sach-may data-so-may": m.danhSachMay?.soMay,
              "dải hợp nhất": m.daiHopNhat, "breadcrumb": m.breadcrumb, "chữ trên màn": m.manChu, "cửa chờ": cho,
            },
            ketCuc: `tầng ${tgDb.id} (cấp ${cap}) DB ${kvTang} máy · cảnh vẽ ${m.dsMay.so} máy · dem-may=${m.demMay} · spinner=${m.spin} · canvas=${m.canvasTrongMan} · giảiThích=${chuGiaiThich.length > 0 ? "CÓ" : "KHÔNG"}`,
            phanQuyet: pq,
            viSao: pq === "ĐẠT"
              ? "Tầng trống: cảnh 0 máy, ô đếm 0, không spinner, và có câu chữ nói máy đang ở đâu."
              : !canh0 ? `Cảnh vẫn vẽ ${m.dsMay.so} máy trên một tầng DB có ${kvTang} máy.`
                : !khongTreo ? `Rỗng nhưng còn dấu hiệu TREO: spinner=${m.spin}, canvas=${m.canvasTrongMan}, calls=${m.thongKeVe?.calls}.`
                  : !coChu ? "Rỗng mà KHÔNG có chữ nào giải thích ⇒ người dùng không phân biệt được 'tầng chưa xếp máy' với 'lỗi tải'."
                    : `Cảnh ĐÚNG 0 máy và có chữ giải thích (${chuGiaiThich.length} câu), NHƯNG ô "Máy" vẫn khai ${m.demMay} — số máy của CẢ NHÀ MÁY ${nm.code}, tức khai số máy của tầng khác. Cùng gốc rễ với B2/B3.`,
            anh,
          });
        }

        /* ── B6: đổi sang toà 2, 3, 4 ─────────────────────────────────────────── */
        if (chay("B6")) {
          const buoc = [];
          for (let i = 1; i < Math.min(4, toaDb.length); i += 1) {
            const t = toaDb[i];
            const tgs = TANG_THEO_TOA.get(t.id) ?? [];
            const tg1 = tgs.find((s) => s.capSo === 1) ?? null;
            await page.selectOption('[data-testid="chon-toa-nha"]', String(t.id));
            const cho = await choOnDinh(page);
            await moDai(page);
            const m = await docMan(page);
            if (i === 3) await anhCa(page, `B6-${v.u}-toa4`);
            const kvTang = tg1 ? (TANG_THEO_ID.get(tg1.id)?.may ?? null) : null;
            buoc.push({
              toaSo: i + 1, toaId: t.id, toaMa: t.ma,
              "toà UI đang chọn": m.chonToaNha?.giaTri, "CHỮ toà": m.chonToaNha?.muc.find((o) => o.gt === m.chonToaNha.giaTri)?.chu ?? null,
              "tầng UI đang chọn": m.chonTang?.giaTri, "tầng kỳ vọng (cấp 1 của toà)": tg1 ? tg1.id : null,
              "máy DB của tầng ấy": kvTang, "dem-may": m.demMay,
              "máy VẼ trên cảnh (dsMay)": m.dsMay, "URL": m.duong,
              "dem-may khớp": demMayKhopGi(m.demMay, kvTang, NM_THEO_ID.get(nmId)?.tong ?? null, NM_THEO_ID.get(nmId)?.active ?? null),
              "cửa chờ": cho,
            });
          }
          const can = { "số bước đổi toà": buoc.length > 0 ? buoc.length : null };
          const thieuB = buoc.filter((b) => b["máy DB của tầng ấy"] === null || b["máy VẼ trên cảnh (dsMay)"]?.so === undefined).map((b) => `toà ${b.toaMa}`);
          const th = thieu(can);
          if (th || thieuB.length > 0) {
            ghiCa({
              id: "B6", vai: v.u, moTa: `B6 · ${v.nguoi} · đổi sang toà 2,3,4`,
              deBai: "Đổi sang toà 2, 3, 4 ⇒ dem-may đổi đúng theo mayTheoTang của từng toà.",
              duKienDoc: { "các bước": buoc }, ketCuc: `thiếu dữ kiện: ${[...(th ?? []), ...thieuB].join(", ")}`,
              phanQuyet: "HỎNG", thieuDuKien: [...(th ?? []), ...thieuB], viSao: "L1 fail-closed.",
            });
          } else {
            const doiDuocToa = buoc.every((b) => soCua(b["toà UI đang chọn"]) === b.toaId);
            const canhDoiDung = buoc.every((b) => b["máy VẼ trên cảnh (dsMay)"].so === b["máy DB của tầng ấy"]);
            const demMayDoiDung = buoc.every((b) => soCua(b["dem-may"]) === b["máy DB của tầng ấy"]);
            const demMayKhacNhau = new Set(buoc.map((b) => b["dem-may"])).size > 1;
            const canhKhacNhau = new Set(buoc.map((b) => b["máy VẼ trên cảnh (dsMay)"].so)).size > 1;
            const pq = !doiDuocToa ? "SAI" : demMayDoiDung ? "ĐẠT" : "SAI";
            ghiCa({
              id: "B6", vai: v.u, moTa: `B6 · ${v.nguoi} · đổi sang toà 2,3,4`,
              deBai: "Đổi sang toà 2, 3, 4 qua ô chọn thật ⇒ dem-may đổi ĐÚNG theo mayTheoTang của từng toà (chứng minh bộ chọn toà hoạt động).",
              duKienDoc: {
                "nhà máy": { id: nmId, ma: NM_THEO_ID.get(nmId)?.code ?? null },
                "các bước": buoc,
                "ô chọn toà nhận lệnh": doiDuocToa,
                "cảnh 3D đổi đúng theo tầng của từng toà": canhDoiDung,
                "dem-may đổi đúng theo tầng": demMayDoiDung,
                "dem-may có đổi giữa các toà": demMayKhacNhau,
                "cảnh có đổi giữa các toà": canhKhacNhau,
              },
              ketCuc: buoc.map((b) => `toà${b.toaSo}(${b.toaMa}) DB ${b["máy DB của tầng ấy"]} → dem-may=${b["dem-may"]} · cảnh=${b["máy VẼ trên cảnh (dsMay)"].so}`).join(" ; "),
              phanQuyet: pq,
              viSao: pq === "ĐẠT"
                ? "Bộ chọn toà hoạt động và dem-may theo đúng tầng của toà mới."
                : !doiDuocToa
                  ? "Ô chọn toà không nhận lựa chọn."
                  : `Bộ chọn toà HOẠT ĐỘNG (cảnh 3D đổi đúng ${canhDoiDung ? "ở cả 3 toà" : "một phần"}: ${buoc.map((b) => b["máy VẼ trên cảnh (dsMay)"].so).join("/")} khớp DB ${buoc.map((b) => b["máy DB của tầng ấy"]).join("/")}), nhưng dem-may KHÔNG đổi (${buoc.map((b) => b["dem-may"]).join("/")}) vì nó là số của cả nhà máy — cùng gốc rễ với B2/B3.`,
            });
          }
        }

        /* ── B7: giamdoc + ?pv=tapdoan ⇒ đủ 3 công ty ─────────────────────────── */
        if (chay("B7") && v.u === "qatd_giamdoc") {
          await mo(page, "/twin?pv=tapdoan");
          const cho = await choOnDinh(page);
          await moDai(page);
          const m = await docMan(page);
          const anh = await anhCa(page, "B7-qatd_giamdoc-tapdoan");
          const nmIdB7 = soCua(m.chonNhaMay?.giaTri);
          const nmB7 = nmIdB7 !== null ? NM_THEO_ID.get(nmIdB7) : null;
          const tangIdB7 = soCua(m.chonTang?.giaTri);
          const tgB7 = tangIdB7 !== null ? TANG_THEO_ID.get(tangIdB7) : null;
          const can = {
            "dem-may": m.demMay, "breadcrumb": m.breadcrumb, "chon-nha-may": m.chonNhaMay,
            "window.__demTuongTac.dsMay()": m.dsMay && m.dsMay.so !== undefined ? m.dsMay.so : null,
            "URL": m.duong, "banner (đã bung dải)": m.banner,
          };
          const th = thieu(can);
          if (th) {
            ghiCa({
              id: "B7", vai: v.u, moTa: "B7 · GIÁM ĐỐC · /twin?pv=tapdoan",
              deBai: "Mở /twin?pv=tapdoan ⇒ phải thấy/đếm được đủ 3 công ty (§15 mục 26).",
              duKienDoc: { ...can, "đọc được": m }, ketCuc: `thiếu dữ kiện: ${th.join(", ")}`,
              phanQuyet: "HỎNG", thieuDuKien: th, viSao: "L1 fail-closed.", anh,
            });
          } else {
            const soNmTrongO = m.chonNhaMay.muc.length;
            const dem = soCua(m.demMay);
            const soCongTyCoDuLieu = nmB7 && dem === nmB7.tong ? 1 : dem === KV.mayTheoNhaMay.filter((n) => n.corporateCode === "QATD").reduce((a, b) => a + b.tong, 0) ? 3 : null;
            const haCap = m.banner["banner-ha-cap"] ?? null;
            const bcTapDoan = /Tập đoàn|Corporate|集团/i.test(m.breadcrumb ?? "");
            const pq = soCongTyCoDuLieu === 3 ? "ĐẠT" : "SAI";
            ghiCa({
              id: "B7", vai: v.u, moTa: "B7 · GIÁM ĐỐC · /twin?pv=tapdoan",
              deBai: "Mở /twin?pv=tapdoan ⇒ phải thấy/đếm được đủ 3 công ty (§15 mục 26). Đọc nhãn phạm vi + dem-may + ảnh.",
              duKienDoc: {
                "URL": m.duong,
                "số nhà máy trong ô chọn (chọn được)": soNmTrongO, "CHỮ các nhà máy": m.chonNhaMay.muc.map((o) => o.chu),
                "nhà máy ĐANG hiện dữ liệu": { id: nmIdB7, ma: nmB7?.code ?? null, máyDB: nmB7?.tong ?? null },
                "tầng đang chọn": { id: tangIdB7, capSo: tgB7?.capSo ?? null, máyDB: tgB7?.may ?? null },
                "dem-may": m.demMay, "máy VẼ trên cảnh (dsMay)": m.dsMay,
                "tổng máy 3 công ty QATD (DB)": KV.mayTheoNhaMay.filter((n) => n.corporateCode === "QATD").reduce((a, b) => a + b.tong, 0),
                "breadcrumb": m.breadcrumb, "breadcrumb nói 'Tập đoàn'": bcTapDoan,
                "banner-ha-cap": haCap, "mọi banner": m.banner, "dải hợp nhất": m.daiHopNhat,
                "số công ty có dữ liệu trên màn": soCongTyCoDuLieu, "cửa chờ": cho,
              },
              ketCuc: `ô chọn có ${soNmTrongO} nhà máy nhưng màn chỉ mang dữ liệu của ${soCongTyCoDuLieu ?? "?"} công ty (dem-may=${m.demMay} = ${nmB7?.code ?? "?"} ${nmB7?.tong ?? "?"} máy; cảnh vẽ ${m.dsMay.so} máy của tầng ${tangIdB7}); banner-ha-cap=${haCap ? "CÓ" : "KHÔNG"}`,
              phanQuyet: pq,
              viSao: pq === "ĐẠT"
                ? "Phạm vi Tập đoàn mang dữ liệu đủ 3 công ty."
                : `Chỉ MỘT khối nhà máy có dữ liệu: dem-may=${m.demMay} = đúng tổng của ${nmB7?.code} (${nmB7?.tong}), không phải 1.108 của 3 công ty. Đây là hạ cấp CÓ KHAI (banner-ha-cap: "${(haCap ?? "").slice(0, 150)}") do phamViThuc() ở boChonNap.ts:241 hạ tapDoan→nhaMay vì canhThietKe nhận ĐÚNG MỘT factoryId (twinCanhRouter.ts:1003-1010). Nghĩa là §15 mục 26 vẫn CHƯA ĐẠT, nhưng màn KHÔNG nói dối.`,
              anh,
            });
          }
        }

        /* ── B8: kythuat + ?nm=39 (QATD-B, không phải nhà máy đầu) ────────────── */
        if (chay("B8") && v.u === "qatd_kythuat") {
          await mo(page, "/twin?nm=39");
          const cho = await choOnDinh(page);
          await moDai(page);
          const m = await docMan(page);
          const anh = await anhCa(page, "B8-qatd_kythuat-nm39");
          const nmIdB8 = soCua(m.chonNhaMay?.giaTri);
          const tangIdB8 = soCua(m.chonTang?.giaTri);
          const tgB8 = tangIdB8 !== null ? TANG_THEO_ID.get(tangIdB8) : null;
          const nm39 = NM_THEO_ID.get(39) ?? null;
          const can = {
            "chon-nha-may.giaTri": m.chonNhaMay?.giaTri, "chon-tang.giaTri": m.chonTang?.giaTri,
            "dem-may": m.demMay, "window.__demTuongTac.dsMay()": m.dsMay && m.dsMay.so !== undefined ? m.dsMay.so : null,
            "mayTheoTang[tangId] (DB)": tgB8 ? tgB8.may : null, "mayTheoNhaMay[39] (DB)": nm39 ? nm39.tong : null,
          };
          const th = thieu(can);
          if (th) {
            ghiCa({
              id: "B8", vai: v.u, moTa: "B8 · KỸ THUẬT · /twin?nm=39 (QATD-B)",
              deBai: "Mở /twin?nm=39 ⇒ cảnh dựng cho ĐÚNG QATD-B (dò nghi vấn 'lấy cứng nhà máy đầu').",
              duKienDoc: { ...can, "đọc được": m }, ketCuc: `thiếu dữ kiện: ${th.join(", ")}`,
              phanQuyet: "HỎNG", thieuDuKien: th, viSao: "L1 fail-closed.", anh,
            });
          } else {
            const dungNm = nmIdB8 === 39;
            const tangThuocB = tgB8 ? tgB8.nm === "QATD-B" : false;
            const canhKhopTang = m.dsMay.so === (tgB8 ? tgB8.may : -1);
            const khop = demMayKhopGi(m.demMay, tgB8 ? tgB8.may : null, nm39.tong, nm39.active);
            const pq = !dungNm ? "SAI" : !tangThuocB || !canhKhopTang ? "SAI" : khop === "tầng" || khop.startsWith("nhàMáy") ? "ĐẠT" : "SAI";
            ghiCa({
              id: "B8", vai: v.u, moTa: "B8 · KỸ THUẬT · /twin?nm=39 (QATD-B)",
              deBai: "Mở /twin?nm=39 (QATD-B, KHÔNG phải nhà máy đầu trong danh sách) ⇒ cảnh dựng cho đúng QATD-B, dem-may khớp phạm vi của QATD-B.",
              duKienDoc: {
                "URL": m.duong,
                "nhà máy UI đang chọn": { id: nmIdB8, chu: m.chonNhaMay.muc.find((o) => o.gt === m.chonNhaMay.giaTri)?.chu ?? null },
                "thứ tự ô chọn": m.chonNhaMay.muc.map((o) => `${o.gt}:${o.chu}`),
                "nhà máy ĐẦU trong danh sách": m.chonNhaMay.muc[0] ?? null,
                "toà đang chọn": { id: m.chonToaNha?.giaTri, chu: m.chonToaNha?.muc.find((o) => o.gt === m.chonToaNha.giaTri)?.chu ?? null },
                "tầng đang chọn": { id: tangIdB8, capSo: tgB8?.capSo ?? null, toa: tgB8?.toa ?? null, nm: tgB8?.nm ?? null, máyDB: tgB8?.may ?? null },
                "dem-may": m.demMay, "dem-may khớp": khop,
                "máy DB QATD-B": { tong: nm39.tong, active: nm39.active },
                "máy VẼ trên cảnh (dsMay)": m.dsMay, "cảnh khớp tầng của QATD-B": canhKhopTang,
                "breadcrumb": m.breadcrumb, "banner": m.banner, "__thongKeVe": m.thongKeVe, "cửa chờ": cho,
              },
              ketCuc: `nhà máy=${nmIdB8} (${m.chonNhaMay.muc.find((o) => o.gt === m.chonNhaMay.giaTri)?.chu}) · nhà máy ĐẦU trong ô là ${m.chonNhaMay.muc[0]?.gt} ⇒ KHÔNG lấy cứng [0]=${nmIdB8 !== Number(m.chonNhaMay.muc[0]?.gt)} · tầng ${tangIdB8} thuộc ${tgB8?.nm} DB ${tgB8?.may} máy · cảnh vẽ ${m.dsMay.so} · dem-may=${m.demMay} (khớp ${khop})`,
              phanQuyet: pq,
              viSao: pq === "ĐẠT"
                ? `?nm=39 mở đúng QATD-B (không rơi về nhà máy đầu ${m.chonNhaMay.muc[0]?.gt}); cảnh vẽ ${m.dsMay.so} = số máy DB của tầng ${tangIdB8}, dem-may khớp ${khop} của QATD-B.`
                : !dungNm ? `?nm=39 KHÔNG mở QATD-B — đang ở nhà máy ${nmIdB8} (nghi vấn lấy cứng nhà máy đầu được XÁC NHẬN).`
                  : `Cảnh không khớp tầng của QATD-B: cảnh ${m.dsMay.so}, DB ${tgB8?.may}.`,
              anh,
            });
          }
        }
      } else if (chay("B1") || chay("B7") || chay("B8")) {
        /* vai ngoài lô B — không ghi N/A tràn lan, chỉ ghi khi BRIEF có nêu */
      }
    } catch (e) {
      console.error(`   ✗ ${v.u}: ${String(e).slice(0, 300)}`);
      ghiCa({
        id: "LOI", vai: v.u, moTa: `Ngoại lệ khi đo vai ${v.u}`,
        deBai: "chạy trọn lô A+B cho vai này", duKienDoc: { "ngoại lệ": String(e).slice(0, 600), "lỗi trang": loi.slice(0, 5), "đăng nhập": dn },
        ketCuc: "harness ném ngoại lệ giữa lô", phanQuyet: "HỎNG", thieuDuKien: ["hoàn tất lô cho vai này"],
        viSao: "Ca dừng giữa đường không được tính ĐẠT.",
      });
    }
    await ctx.close();
  }

  await browser.close();

  /* ── Tổng ─────────────────────────────────────────────────────────────────── */
  const dem = { "ĐẠT": 0, "SAI": 0, "HỎNG": 0, "CHẶN-ĐÚNG": 0, "N/A": 0 };
  let khongPhanQuyet = 0;
  for (const c of SO) {
    if (c.phanQuyet in dem) dem[c.phanQuyet] += 1; else khongPhanQuyet += 1;
  }
  const tam = `${OUT}/.tmp-TONG.json`;
  writeFileSync(tam, JSON.stringify({ luc: new Date().toISOString(), base: BASE, soCa: SO.length, dem, khongPhanQuyet, ca: SO.map((c) => ({ id: c.id, vai: c.vai, pq: c.phanQuyet })) }, null, 2));
  renameSync(tam, `${OUT}/TONG.json`);
  console.log(`\n═══ ${SO.length} ca · ĐẠT ${dem["ĐẠT"]} · SAI ${dem["SAI"]} · HỎNG ${dem["HỎNG"]} · CHẶN-ĐÚNG ${dem["CHẶN-ĐÚNG"]} · N/A ${dem["N/A"]} · ô không có phán quyết: ${khongPhanQuyet}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
