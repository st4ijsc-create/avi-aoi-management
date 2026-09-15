/**
 * .qa-tapdoan/do-DE.mjs — THƯỚC ĐO LÔ D+E của QA lần 11 (3D twin, kịch bản tập đoàn).
 *
 *   D = ngăn xử lý nghiệp vụ theo vai (`/twin`, `/twin/may/:id`)
 *   E = Studio, đường BUILD (`/twin-studio`)
 *
 * ── HAI LUẬT KẾ THỪA (§3 BRIEF) ───────────────────────────────────────────────
 *   L1 FAIL-CLOSED — mỗi ca khai TÊN dữ kiện nó cần; thiếu một cái ⇒ `HONG` kèm tên.
 *      `??` KHÔNG được dùng để vá một lỗ ĐỌC.
 *   L2 ĐỌC THEO NGHĨA — dữ kiện là CHỮ người dùng đọc được; testid chỉ để TÌM.
 *      Nên mọi nút đọc ra đều mang `chu` (nhãn hiển thị), không chỉ testid.
 *
 * ── BA TRẠNG THÁI CỦA MỘT NÚT (luật ẨN-KHÔNG-DISABLE) ────────────────────────
 *   `co:0`                      → KHÔNG render  (đúng với người không có quyền)
 *   `co:1, bam:0`               → render + disabled (phải có lý do đọc được)
 *   `co:1, bam:1`               → render + bấm được
 *   Ba trạng thái này KHÔNG được gộp: một nút xám nói "chức năng này thuộc về bạn".
 *
 * ── HÀNG TẠM ─────────────────────────────────────────────────────────────────
 *   Mọi hàng ghi thật do lô này tạo mang tiền tố `QATD-DE-` và xoá được bằng
 *   `node .qa-tapdoan/db-DE.mjs andon-tam xoa` / `vung-xoa-tam` / `wo-xoa <id>`.
 *   Script bao ngoài `do-DE.sh` có `trap EXIT INT TERM` (G111).
 *
 * Dùng: node .qa-tapdoan/do-DE.mjs <ca> [--vai=qatd_…] [--base=http://localhost:3064]
 *   ca ∈ D1 D2 D3 D4 D5 E1 E2 E3 E4 E5 E6 E7
 */
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";

const arg = (k, d) => {
  const m = process.argv.find((a) => a.startsWith(`--${k}=`));
  return m ? m.slice(k.length + 3) : d;
};
const CA = process.argv[2] ?? "";
const BASE = arg("base", "http://localhost:3064");
const VAI_CLI = arg("vai", "");
const MOC = arg("moc", ""); // D3: truoc | co | sau
const GOC = "D:/SOURCES/avi-aoi-management/.qa-tapdoan";
const THO = `${GOC}/tho/DE`;
const ANH = `${GOC}/anh`;
mkdirSync(THO, { recursive: true });
mkdirSync(ANH, { recursive: true });

const MK = "Qatd!2026";
/**
 * Máy ĐO của từng vai — chọn máy NẰM TRONG phạm vi vai đó (nếu không, ca thành C4 chứ không phải D1).
 *
 * ★★★ ĐO ĐƯỢC 2026-09-15 (lượt 1 của lô này, thô `D1-qatd_kythuat` lượt đầu + lô C `C2-…-may4568`):
 *   `/twin/may/4568` (QATD-B) với vai kythuat KHÔNG mở được — `may-khong-mo-duoc`
 *   `data-ly-do="ngoaiPhamVi"` — vì `TwinMay.tsx:285` lấy CỨNG `factories[0]` (= QATD-A) và màn
 *   không đọc `?nm=`. Đó là NỢ của lô C (C1/C2), không phải của ngăn xử lý. Nên D1 của kythuat đo
 *   trên máy 4197 (QATD-A, cùng nằm trong phạm vi được gán) để phép đo nói về NGĂN XỬ LÝ; lượt
 *   thử 4568 vẫn được ghi lại trong `mayNgoaiPhamVi` làm bằng chứng.
 */
const MAY_CUA_VAI = {
  qatd_kythuat: { id: 4197, ma: "QATD-A-T1-X1-L1-M01", nm: 38, mayThuHai: 4568 },
  qatd_quanly: { id: 4197, ma: "QATD-A-T1-X1-L1-M01", nm: 38 },
  qatd_congnhan: { id: 4977, ma: "QATD-C-T1-X1-L1-M01", nm: 40 },
  qatd_giamdoc: { id: 4197, ma: "QATD-A-T1-X1-L1-M01", nm: 38 },
  qatd_admin: { id: 4197, ma: "QATD-A-T1-X1-L1-M01", nm: 38 },
};
/** Tầng 1 toà 1 của từng công ty (SQL: twin_toa_nha/twin_tang). */
const TANG1 = { 38: { toa: 53, tang: 81 }, 39: { toa: 57, tang: 109 }, 40: { toa: 61, tang: 137 } };

const ghiTho = (ten, obj) => {
  const tam = `${THO}/.tam-${ten}.json`;
  writeFileSync(tam, JSON.stringify(obj, null, 1));
  renameSync(tam, `${THO}/${ten}.json`);
  console.log(`[tho] ${THO}/${ten}.json`);
};

async function dangNhap(ctx, u) {
  const f = `${THO}/state-${u}.json`;
  const ai = async () => {
    const r = await ctx.request.get(`${BASE}/api/trpc/auth.me`);
    try {
      return JSON.parse(await r.text())?.result?.data?.json?.username ?? null;
    } catch {
      return null;
    }
  };
  if (existsSync(f)) {
    await ctx.addCookies(JSON.parse(readFileSync(f, "utf8")));
    if ((await ai()) === u) return "cache";
    await ctx.clearCookies();
  }
  const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: u, password: MK } });
  const ten = await ai();
  if (r.status() !== 200 || ten !== u) throw new Error(`dang nhap that bai ${u}: login=${r.status()} me=${ten}`);
  writeFileSync(f, JSON.stringify(await ctx.cookies()));
  return "moi";
}

const cho = (p, s, ms = 90_000) =>
  p.waitForSelector(s, { timeout: ms }).then(() => true).catch(() => false);
const ngu = (p, ms) => p.waitForTimeout(ms);

/* ══════════════════════════════════════════════════════════════════════════════
   BỘ ĐỌC TRONG TRANG — trả về CHỮ, không trả về "đã pass"
   ══════════════════════════════════════════════════════════════════════════════ */

/** Đọc NGĂN XỬ LÝ: danh sách nút THỰC SỰ render + ba trạng thái + chữ đọc được. */
const DOC_NGAN = () => {
  const chu = (e) => (e ? (e.innerText || e.textContent || "").replace(/\s+/g, " ").trim() : null);
  const hienThi = (e) => {
    if (!e) return false;
    const cs = getComputedStyle(e);
    return cs.display !== "none" && cs.visibility !== "hidden" && e.getClientRects().length > 0;
  };
  const o = (t) => {
    const e = document.querySelector(`[data-testid="${t}"]`);
    if (!e) return { co: 0 };
    const tat = e.hasAttribute("disabled") || e.getAttribute("aria-disabled") === "true";
    return { co: 1, chu: (chu(e) ?? "").slice(0, 160), hien: hienThi(e), tat: tat ? 1 : 0, bam: !tat && hienThi(e) ? 1 : 0 };
  };
  const ngan =
    document.querySelector('[data-testid="ngan-xu-ly"]') ??
    document.querySelector('[data-testid="panel-phai-may"]');
  const boc = document.querySelector('[data-testid="panel-phai"]') ?? document.querySelector('[data-testid="panel-phai-may"]');
  /** MỌI nút thật trong ngăn — không chỉ những nút ta đoán trước. */
  const nutTrongNgan = ngan
    ? [...ngan.querySelectorAll("button")].map((b) => ({
        tid: b.getAttribute("data-testid"),
        chu: (chu(b) ?? "").slice(0, 60),
        aria: b.getAttribute("aria-label"),
        tat: b.hasAttribute("disabled") ? 1 : 0,
        hien: hienThi(b) ? 1 : 0,
      }))
    : null;
  const nutDieuHuong = ngan
    ? [...ngan.querySelectorAll('[data-testid^="nut-dieu-huong-"]')].map((b) => ({
        tid: b.getAttribute("data-testid"),
        chu: (chu(b) ?? "").slice(0, 60),
        taiCho: b.getAttribute("data-tai-cho"),
      }))
    : null;
  return {
    url: location.pathname + location.search,
    coNgan: ngan ? 1 : 0,
    nganChu: ngan ? (chu(ngan) ?? "").slice(0, 900) : null,
    bocThu: boc ? boc.getAttribute("data-thu") : null,
    bocLyDoThu: boc ? boc.getAttribute("data-ly-do-thu") : null,
    bocAn: boc ? (boc.hasAttribute("hidden") ? 1 : 0) : null,
    // ── các nút/nhóm của §9.2 ──
    nutAck: o("nut-ack"),
    nutAnTam: o("nut-an-tam"),
    nutTaoPhieu: o("nut-tao-phieu"),
    nutGhiChu: o("nut-ghi-chu"),
    nhomCanhBao: o("nhom-canh-bao"),
    nhomTaoViec: o("nhom-tao-viec"),
    nhomMoChucNang: o("nhom-mo-chuc-nang"),
    nganChuaChon: o("ngan-chua-chon"),
    nganMaMay: o("ngan-ma-may"),
    nganTrangThai: o("ngan-trang-thai"),
    formTaoPhieu: o("form-tao-phieu"),
    chonKyThuatVien: o("chon-ky-thuat-vien"),
    // ── cảnh báo đang mở trong ngăn ──
    soCanhBaoNgan: document.querySelectorAll('[data-testid^="ngan-canh-bao-"][data-trang-thai]').length,
    canhBaoNgan: [...document.querySelectorAll('[data-testid^="ngan-canh-bao-"][data-trang-thai]')].map((e) => ({
      tid: e.getAttribute("data-testid"),
      trangThai: e.getAttribute("data-trang-thai"),
      chu: (chu(e) ?? "").slice(0, 120),
    })),
    khongCanhBao: o("ngan-khong-canh-bao"),
    nutTrongNgan,
    nutDieuHuong,
    // ── cảnh / màn ──
    soCanvas: window.__soCanvas === undefined ? null : window.__soCanvas,
    canvasDom: document.querySelectorAll("canvas").length,
    coMan: Object.fromEntries(
      ["man-twin-van-hanh", "man-twin-may", "man-twin-line", "man-twin-studio"].map((t) => [
        t,
        document.querySelectorAll(`[data-testid="${t}"]`).length,
      ]),
    ),
    biChan: /Không có quyền truy cập|Access denied/.test(document.body.innerText || "") ? 1 : 0,
    chuBiChan: (() => {
      const m = (document.body.innerText || "").match(/.{0,90}(Không có quyền truy cập|Access denied).{0,120}/);
      return m ? m[0].replace(/\s+/g, " ").trim() : null;
    })(),
    tenMay: (() => {
      const e = document.querySelector('[data-testid="ten-may"]');
      return e ? chu(e) : null;
    })(),
    /* ★ L1 FAIL-CLOSED — ba trạng thái KHÁC "ngăn rỗng": đang tải · không mở được · chưa đặt chỗ.
       Thiếu ba ô này thì một màn ĐANG TẢI đọc ra y hệt một màn 0 nút, và phán quyết sẽ SAI OAN. */
    mayDangTai: document.querySelectorAll('[data-testid="may-dang-tai"]').length,
    mayKhongMoDuoc: (() => {
      const e = document.querySelector('[data-testid="may-khong-mo-duoc"]');
      return e ? { co: 1, lyDo: e.getAttribute("data-ly-do"), chu: (chu(e) ?? "").slice(0, 300) } : { co: 0 };
    })(),
    mayChuaDatCho: document.querySelectorAll('[data-testid="may-chua-dat-cho"]').length,
  };
};

/** Đọc lớp cảnh báo NỔI trên cảnh + dải cảnh báo panel trái + bảng KPI (D3/D5). */
const DOC_CANH_BAO = () => {
  const chu = (e) => (e ? (e.innerText || e.textContent || "").replace(/\s+/g, " ").trim() : null);
  const lop = document.querySelector('[data-testid="lop-canh-bao"]');
  const dai = document.querySelector('[data-testid="dai-canh-bao"]');
  const kpi = document.querySelector('[data-testid="bang-kpi-noi"]');
  return {
    url: location.pathname + location.search,
    lopCanhBao: lop ? { co: 1, soCon: lop.children.length, chu: (chu(lop) ?? "").slice(0, 400) } : { co: 0 },
    daiCanhBao: dai ? { co: 1, chu: (chu(dai) ?? "").slice(0, 600) } : { co: 0 },
    daiTrong: document.querySelectorAll('[data-testid="dai-trong"]').length,
    daiChuaDo: document.querySelectorAll('[data-testid="dai-chua-do"]').length,
    bangKpi: kpi ? { co: 1, chu: (chu(kpi) ?? "").slice(0, 500) } : { co: 0 },
    demMay: (() => {
      const e = document.querySelector('[data-testid="dem-may"]');
      return e ? chu(e) : null;
    })(),
    /** badge/nhãn có mang mã máy đo không (đọc theo NGHĨA). */
    chuToanMan: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 1500),
  };
};

/** Đọc màn STUDIO: ô chọn nhà máy, đếm toà, bộ chọn toà/tầng, các khối tab Thiết kế. */
const DOC_STUDIO = () => {
  const chu = (e) => (e ? (e.innerText || e.textContent || "").replace(/\s+/g, " ").trim() : null);
  const hienThi = (e) => {
    if (!e) return false;
    const cs = getComputedStyle(e);
    return cs.display !== "none" && cs.visibility !== "hidden" && e.getClientRects().length > 0;
  };
  const o = (t) => {
    const e = document.querySelector(`[data-testid="${t}"]`);
    if (!e) return { co: 0 };
    const tat = e.hasAttribute("disabled") || e.getAttribute("aria-disabled") === "true";
    return { co: 1, chu: (chu(e) ?? "").slice(0, 200), hien: hienThi(e), tat: tat ? 1 : 0 };
  };
  /** MỌI bộ chọn (select/combobox) đang hiện — E3 cần biết có ô chọn TOÀ/TẦNG hay không. */
  const boChon = [...document.querySelectorAll('select, [role="combobox"]')]
    .filter((e) => hienThi(e))
    .map((e) => ({
      tid: e.getAttribute("data-testid"),
      the: e.tagName.toLowerCase(),
      chu: (chu(e) ?? "").slice(0, 80),
      aria: e.getAttribute("aria-label"),
    }));
  /** Nhãn nào trên màn nói về TOÀ / TẦNG (đọc theo nghĩa, cả 3 ngôn ngữ nhãn VI). */
  const toanMan = (document.body.innerText || "").replace(/\s+/g, " ");
  return {
    url: location.pathname + location.search,
    coManStudio: document.querySelectorAll('[data-testid="man-twin-studio"]').length,
    biChan: /Không có quyền truy cập|Access denied/.test(document.body.innerText || "") ? 1 : 0,
    chuBiChan: (() => {
      const m = toanMan.match(/.{0,90}(Không có quyền truy cập|Access denied).{0,140}/);
      return m ? m[0].trim() : null;
    })(),
    chonNhaMay: o("chon-nha-may"),
    demToaNha: o("dem-toa-nha"),
    tabThietKe: o("tab-thiet-ke"),
    tabConDuongA: o("tab-con-duong-a"),
    tabConDuongB: o("tab-con-duong-b"),
    chuaCoTang: o("chua-co-tang"),
    chuaCoNhaMay: o("chua-co-nha-may"),
    daiPhamViRong: o("dai-pham-vi-rong"),
    // ── tab Thiết kế (E4) ──
    xuongThietKe: o("xuong-thiet-ke"),
    vungCanvas: o("vung-canvas"),
    khuChoXepCho: o("khu-cho-xep-cho"),
    thuVienAsset: o("thu-vien-asset"),
    miniMap: o("mini-map"),
    bangThuocTinh: o("bang-thuoc-tinh"),
    cayPhanCap: o("cay-phan-cap-twin"),
    // ── công cụ GHI (E6: ẩn-không-disable) ──
    nutCheDoTranslate: o("nut-che-do-translate"),
    nutCheDoRotate: o("nut-che-do-rotate"),
    congTacBatDinh: o("cong-tac-bat-dinh"),
    congTacLuoi: o("cong-tac-luoi"),
    nutHoanTac: o("nut-hoan-tac"),
    nutLamLai: o("nut-lam-lai"),
    nutMoSinh: o("nut-mo-sinh"),
    nutLuu: o("nut-luu"),
    huyHieuChiXem: o("huy-hieu-chi-xem"),
    khoiVungAnToan: o("khoi-vung-an-toan"),
    veVung: o("ve-vung"),
    veVungBatDau: o("ve-vung-bat-dau"),
    veVungTrong: o("ve-vung-trong"),
    veVungDanhSach: o("ve-vung-danh-sach"),
    soVungMuc: document.querySelectorAll('[data-testid="ve-vung-muc"]').length,
    dsVung: [...document.querySelectorAll('[data-testid="ve-vung-muc"]')].map((e) => ({
      khoa: e.getAttribute("data-khoa"),
      chu: (chu(e) ?? "").slice(0, 80),
    })),
    soCanvas: window.__soCanvas === undefined ? null : window.__soCanvas,
    canvasDom: document.querySelectorAll("canvas").length,
    boChon,
    coChuToa: /Toà nhà|Toa nha|Building/i.test(toanMan) ? 1 : 0,
    coChuTang: /Tầng|Floor/i.test(toanMan) ? 1 : 0,
    nhanTangHienTai: (() => {
      const m = toanMan.match(/Tầng\s*[^·\n]{0,24}/);
      return m ? m[0].trim() : null;
    })(),
    // dải đầu màn (có thể mang tên tầng đang thiết kế)
    dauMan: toanMan.slice(0, 600),
  };
};

/* ══════════════════════════════════════════════════════════════════════════════
   tRPC qua cookie của một vai (đường API — ĐỘC LẬP với DOM)
   ══════════════════════════════════════════════════════════════════════════════ */
async function trpcGet(ctx, proc, input) {
  const u = `${BASE}/api/trpc/${proc}` + (input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`);
  const r = await ctx.request.get(u);
  const t = await r.text();
  let j = null;
  try { j = JSON.parse(t); } catch { /* không JSON */ }
  return {
    status: r.status(),
    data: j?.result?.data?.json ?? j?.result?.data ?? null,
    ma: j?.error?.json?.data?.code ?? j?.error?.data?.code ?? null,
    loi: j?.error?.json?.message ?? j?.error?.message ?? null,
    tho: t.slice(0, 300),
  };
}
async function trpcPost(ctx, proc, input) {
  const r = await ctx.request.post(`${BASE}/api/trpc/${proc}`, { data: { json: input } });
  const t = await r.text();
  let j = null;
  try { j = JSON.parse(t); } catch { /* không JSON */ }
  return {
    status: r.status(),
    data: j?.result?.data?.json ?? j?.result?.data ?? null,
    ma: j?.error?.json?.data?.code ?? j?.error?.data?.code ?? null,
    loi: j?.error?.json?.message ?? j?.error?.message ?? null,
    tho: t.slice(0, 400),
  };
}

/* ══════════════════════════════════════════════════════════════════════════════
   CÁC CA
   ══════════════════════════════════════════════════════════════════════════════ */

async function moTrinhDuyet(u, vw = 1600, vh = 900) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, baseURL: BASE });
  const cach = await dangNhap(ctx, u);
  return { browser, ctx, cach };
}

/** D1 — DANH SÁCH nút thực sự render trong ngăn xử lý, một bản ghi mỗi vai. */
async function caD1(u) {
  const may = MAY_CUA_VAI[u];
  if (!may) throw new Error(`D1: chua khai may do cho vai ${u}`);
  const { browser, ctx, cach } = await moTrinhDuyet(u);
  const F = { ca: "D1", vai: u, cach, base: BASE, luc: new Date().toISOString(), may };
  try {
    const page = await ctx.newPage();
    /* (a) /twin — ngăn xử lý ở màn nhà máy (máy chọn qua URL `?chon=`). */
    await page.goto(`${BASE}/twin?nm=${may.nm}`, { waitUntil: "domcontentloaded" });
    await Promise.race([
      cho(page, '[data-testid="man-twin-van-hanh"] canvas', 60_000),
      cho(page, "text=/Không có quyền truy cập|Access denied/", 60_000),
    ]);
    await ngu(page, 6000);
    F.twin = await page.evaluate(DOC_NGAN);
    await page.screenshot({ path: `${ANH}/DE-D1-${u.replace("qatd_", "")}-twin.png` }).catch(() => {});

    /* (b) /twin/may/:id — mặt GHI duy nhất của cấp máy (§15.3.3).
       ★ CHỜ TỚI KHI NGĂN CÓ NỘI DUNG (hoặc màn khai lý do), KHÔNG chờ một cửa sổ CỐ ĐỊNH:
         cửa sổ cố định trên dữ liệu 1.108 máy làm một màn ĐANG TẢI đọc ra "0 nút" (G-Đợt 30). */
    await page.goto(`${BASE}/twin/may/${may.id}`, { waitUntil: "domcontentloaded" });
    await Promise.race([
      cho(page, '[data-testid="man-twin-may"]', 60_000),
      cho(page, "text=/Không có quyền truy cập|Access denied/", 60_000),
    ]);
    await Promise.race([
      cho(page, '[data-testid="ngan-ma-may"]', 60_000),
      cho(page, '[data-testid="may-khong-mo-duoc"]', 60_000),
    ]);
    await ngu(page, 7000);
    F.may3d = await page.evaluate(DOC_NGAN);

    /* (b2) kythuat — lượt thử máy của nhà máy THỨ HAI được gán (bằng chứng cho nợ C1). */
    if (may.mayThuHai) {
      await page.goto(`${BASE}/twin/may/${may.mayThuHai}`, { waitUntil: "domcontentloaded" });
      await Promise.race([
        cho(page, '[data-testid="ngan-ma-may"]', 60_000),
        cho(page, '[data-testid="may-khong-mo-duoc"]', 60_000),
      ]);
      await ngu(page, 5000);
      F.mayNgoaiPhamVi = { id: may.mayThuHai, doc: await page.evaluate(DOC_NGAN) };
      await page.screenshot({ path: `${ANH}/DE-D1-${u.replace("qatd_", "")}-may${may.mayThuHai}.png` }).catch(() => {});
      await page.goto(`${BASE}/twin/may/${may.id}`, { waitUntil: "domcontentloaded" });
      await Promise.race([
        cho(page, '[data-testid="ngan-ma-may"]', 60_000),
        cho(page, '[data-testid="may-khong-mo-duoc"]', 60_000),
      ]);
      await ngu(page, 6000);
      F.may3d = await page.evaluate(DOC_NGAN);
    }

    /* (c) Mở form tạo phiếu (KHÔNG lưu) để đo ô "Gán kỹ thuật viên". */
    if (F.may3d.nutTaoPhieu.co === 1 && F.may3d.nutTaoPhieu.bam === 1) {
      await page.click('[data-testid="nut-tao-phieu"]').catch(() => {});
      await cho(page, '[data-testid="form-tao-phieu"]', 15_000);
      await ngu(page, 1500);
      F.formMo = await page.evaluate(DOC_NGAN);
      F.formGhiChu = "mở form để ĐỌC ô gán KTV; KHÔNG bấm Lưu ⇒ 0 hàng ghi";
    } else {
      F.formMo = null;
      F.formGhiChu = "nut-tao-phieu không render hoặc không bấm được ⇒ không có form để đo";
    }
    await page.screenshot({ path: `${ANH}/DE-D1-${u.replace("qatd_", "")}.png`, fullPage: false }).catch(() => {});
  } finally {
    await ctx.close();
    await browser.close();
  }
  ghiTho(`D1-${u}`, F);
  return F;
}

/**
 * D2 — kythuat tạo MỘT phiếu bảo trì THẬT cho máy 4568 (QATD-B).
 *
 * Ba đường, ghi cả ba (brief: "nếu UI không cho, thử API … và ghi kết quả"):
 *   (1) UI trên máy 4568   — kỳ vọng BỊ CHẶN bởi `ngoaiPhamVi` (nợ C1 `TwinMay.tsx:285`)
 *   (2) UI trên máy 4197   — CA DƯƠNG cùng thiết bị: đường ghi UI có sống không (G139)
 *   (3) API `maintenance.createWorkOrder` cho máy 4568 bằng CHÍNH cookie kythuat
 * Mọi phiếu tạo ra mang tiêu đề `QATD-DE-PHIEU-…` và bị xoá theo ID ở cuối.
 */
async function caD2(u = "qatd_kythuat") {
  const MAY_UI = 4197; // QATD-A — trong factories[0], UI mở được
  const MAY_BRIEF = 4568; // QATD-B — brief đòi máy này
  const T_UI = `QATD-DE-PHIEU-UI-${Date.now() % 1000000}`;
  const T_API = `QATD-DE-PHIEU-API-${Date.now() % 1000000}`;
  const { browser, ctx, cach } = await moTrinhDuyet(u);
  const F = { ca: "D2", vai: u, cach, base: BASE, luc: new Date().toISOString(), mayBrief: MAY_BRIEF, mayUi: MAY_UI, tieuDeUi: T_UI, tieuDeApi: T_API };
  try {
    const page = await ctx.newPage();

    /* (1) UI trên máy 4568 — brief đòi đúng máy này. */
    await page.goto(`${BASE}/twin/may/${MAY_BRIEF}`, { waitUntil: "domcontentloaded" });
    await Promise.race([
      cho(page, '[data-testid="ngan-ma-may"]', 60_000),
      cho(page, '[data-testid="may-khong-mo-duoc"]', 60_000),
    ]);
    await ngu(page, 6000);
    F.ui4568 = await page.evaluate(DOC_NGAN);
    await page.screenshot({ path: `${ANH}/DE-D2-may4568-chan.png` }).catch(() => {});

    /* (2) UI trên máy 4197 — ca dương của đường ghi UI. */
    await page.goto(`${BASE}/twin/may/${MAY_UI}`, { waitUntil: "domcontentloaded" });
    await Promise.race([
      cho(page, '[data-testid="ngan-ma-may"]', 60_000),
      cho(page, '[data-testid="may-khong-mo-duoc"]', 60_000),
    ]);
    await ngu(page, 7000);
    F.ui4197Truoc = await page.evaluate(DOC_NGAN);
    if (F.ui4197Truoc.nutTaoPhieu.co === 1 && F.ui4197Truoc.nutTaoPhieu.bam === 1) {
      await page.click('[data-testid="nut-tao-phieu"]');
      await cho(page, '[data-testid="form-tao-phieu"]', 20_000);
      await page.fill('[data-testid="o-tieu-de-phieu"]', T_UI);
      await ngu(page, 800);
      F.formTruocLuu = await page.evaluate(DOC_NGAN);
      await page.screenshot({ path: `${ANH}/DE-D2-form.png` }).catch(() => {});
      await page.click('[data-testid="nut-luu-phieu"]');
      await ngu(page, 5000);
      F.chuSauLuu = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 900));
      F.ui4197Sau = await page.evaluate(DOC_NGAN);
      await page.screenshot({ path: `${ANH}/DE-D2-sau-luu.png` }).catch(() => {});
      F.duongUi = "đã bấm Lưu trên form-tao-phieu (máy 4197)";
    } else {
      F.duongUi = `KHÔNG bấm được nut-tao-phieu trên 4197: ${JSON.stringify(F.ui4197Truoc.nutTaoPhieu)}`;
    }

    /* (3) API cho máy 4568 bằng cookie kythuat — đường mà brief dặn khi UI không cho. */
    F.api4568 = await trpcPost(ctx, "maintenance.createWorkOrder", {
      machineId: MAY_BRIEF, title: T_API, priority: 3, type: "CORRECTIVE", status: "OPEN",
    });
  } finally {
    await ctx.close();
    await browser.close();
  }
  ghiTho("D2-qatd_kythuat", F);
  return F;
}

/** D3 — ablation N-5: andon raised dựng tay ⇒ badge nổi ⇒ ack ⇒ xoá ⇒ badge mất. */
async function caD3(u = "qatd_congnhan", moc) {
  if (!["truoc", "co", "sau"].includes(moc)) throw new Error("D3 can --moc=truoc|co|sau");
  const may = MAY_CUA_VAI[u];
  const t1 = TANG1[may.nm];
  const { browser, ctx, cach } = await moTrinhDuyet(u);
  const F = { ca: "D3", moc, vai: u, cach, base: BASE, luc: new Date().toISOString(), may, tang: t1 };
  try {
    const page = await ctx.newPage();
    /* (a) /twin tầng của máy đó — badge/dải cảnh báo. */
    await page.goto(`${BASE}/twin?nm=${may.nm}&toa=${t1.toa}&tang=${t1.tang}`, { waitUntil: "domcontentloaded" });
    await cho(page, '[data-testid="man-twin-van-hanh"] canvas', 60_000);
    await ngu(page, 8000);
    F.twin = await page.evaluate(DOC_CANH_BAO);
    await page.screenshot({ path: `${ANH}/DE-D3-${moc}-twin.png` }).catch(() => {});

    /* (b) /twin/may/:id — ngăn xử lý của chính máy đó. */
    await page.goto(`${BASE}/twin/may/${may.id}`, { waitUntil: "domcontentloaded" });
    await cho(page, '[data-testid="man-twin-may"]', 60_000);
    await Promise.race([
      cho(page, '[data-testid="ngan-ma-may"]', 60_000),
      cho(page, '[data-testid="may-khong-mo-duoc"]', 60_000),
    ]);
    await ngu(page, 7000);
    F.may3d = await page.evaluate(DOC_NGAN);
    await page.screenshot({ path: `${ANH}/DE-D3-${moc}-may.png` }).catch(() => {});

    /* (c) chỉ ở mốc "co": BẤM ACK. */
    if (moc === "co" && F.may3d.nutAck.co === 1 && F.may3d.nutAck.bam === 1) {
      await page.click('[data-testid="nut-ack"]');
      await ngu(page, 4000);
      F.sauAckChuMan = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 700));
      F.sauAck = await page.evaluate(DOC_NGAN);
      await page.screenshot({ path: `${ANH}/DE-D3-co-sau-ack.png` }).catch(() => {});
      F.daBamAck = 1;
    } else {
      F.daBamAck = 0;
      F.lyDoKhongAck = moc !== "co" ? "mốc này không bấm ack" : `nut-ack co=${F.may3d.nutAck.co} bam=${F.may3d.nutAck.bam}`;
    }
  } finally {
    await ctx.close();
    await browser.close();
  }
  ghiTho(`D3-${moc}-${u}`, F);
  return F;
}

/** D4 — nhóm "Mở chức năng": đích thật của từng vai. */
async function caD4(u) {
  const may = MAY_CUA_VAI[u];
  const { browser, ctx, cach } = await moTrinhDuyet(u);
  const F = { ca: "D4", vai: u, cach, base: BASE, luc: new Date().toISOString(), may };
  try {
    const page = await ctx.newPage();
    await page.goto(`${BASE}/twin/may/${may.id}`, { waitUntil: "domcontentloaded" });
    await cho(page, '[data-testid="man-twin-may"]', 60_000);
    await Promise.race([
      cho(page, '[data-testid="ngan-ma-may"]', 60_000),
      cho(page, '[data-testid="may-khong-mo-duoc"]', 60_000),
    ]);
    await ngu(page, 7000);
    F.may3d = await page.evaluate(DOC_NGAN);
    /* ĐÍCH THẬT: các nút này là <button> (setLocation), KHÔNG có href ⇒ đo bằng
       cách BẤM một nút và đọc URL sau khi bấm. Bấm nút ĐẦU TIÊN (cockpit) để
       chứng minh cơ chế điều hướng sống trên cùng thiết bị đo (G139 ca dương). */
    const ds = F.may3d.nutDieuHuong ?? [];
    F.bamThu = [];
    for (const n of ds) {
      await page.goto(`${BASE}/twin/may/${may.id}`, { waitUntil: "domcontentloaded" });
      await cho(page, '[data-testid="man-twin-may"]', 60_000);
      await ngu(page, 5000);
      const co = await page.$(`[data-testid="${n.tid}"]`);
      if (!co) { F.bamThu.push({ tid: n.tid, urlSau: null, ghi: "nút biến mất khi nạp lại" }); continue; }
      await co.click().catch(() => {});
      await ngu(page, 2500);
      const url = await page.evaluate(() => location.pathname + location.search);
      F.bamThu.push({ tid: n.tid, chu: n.chu, urlSau: url });
    }
    await page.screenshot({ path: `${ANH}/DE-D4-${u.replace("qatd_", "")}.png` }).catch(() => {});
  } finally {
    await ctx.close();
    await browser.close();
  }
  ghiTho(`D4-${u}`, F);
  return F;
}

/** D5 — giamdoc: KPI + dải cảnh báo đọc được, 0 nút GHI trong ngăn xử lý. */
async function caD5(u = "qatd_giamdoc") {
  const may = MAY_CUA_VAI[u];
  const t1 = TANG1[may.nm];
  const { browser, ctx, cach } = await moTrinhDuyet(u);
  const F = { ca: "D5", vai: u, cach, base: BASE, luc: new Date().toISOString(), may, tang: t1 };
  try {
    const page = await ctx.newPage();
    await page.goto(`${BASE}/twin?nm=${may.nm}&toa=${t1.toa}&tang=${t1.tang}`, { waitUntil: "domcontentloaded" });
    await cho(page, '[data-testid="man-twin-van-hanh"] canvas', 60_000);
    await ngu(page, 9000);
    F.twinCanhBao = await page.evaluate(DOC_CANH_BAO);
    F.twinNgan = await page.evaluate(DOC_NGAN);
    await page.screenshot({ path: `${ANH}/DE-D5-giamdoc-twin.png` }).catch(() => {});
    await page.goto(`${BASE}/twin/may/${may.id}`, { waitUntil: "domcontentloaded" });
    await cho(page, '[data-testid="man-twin-may"]', 60_000);
    await Promise.race([
      cho(page, '[data-testid="ngan-ma-may"]', 60_000),
      cho(page, '[data-testid="may-khong-mo-duoc"]', 60_000),
    ]);
    await ngu(page, 7000);
    F.mayNgan = await page.evaluate(DOC_NGAN);
    await page.screenshot({ path: `${ANH}/DE-D5-giamdoc-may.png` }).catch(() => {});
  } finally {
    await ctx.close();
    await browser.close();
  }
  ghiTho("D5-qatd_giamdoc", F);
  return F;
}

/** E1 — vào /twin-studio: ĐẠT hay CHẶN, và biểu hiện đọc được của lượt chặn. */
async function caE1(u) {
  const { browser, ctx, cach } = await moTrinhDuyet(u);
  const F = { ca: "E1", vai: u, cach, base: BASE, luc: new Date().toISOString() };
  try {
    const page = await ctx.newPage();
    await page.goto(`${BASE}/twin-studio`, { waitUntil: "domcontentloaded" });
    await Promise.race([
      cho(page, '[data-testid="man-twin-studio"]', 60_000),
      cho(page, "text=/Không có quyền truy cập|Access denied/", 60_000),
    ]);
    await ngu(page, 7000);
    F.studio = await page.evaluate(DOC_STUDIO);
    F.urlCuoi = await page.evaluate(() => location.pathname + location.search);
    await page.screenshot({ path: `${ANH}/DE-E1-${u.replace("qatd_", "")}.png` }).catch(() => {});
  } finally {
    await ctx.close();
    await browser.close();
  }
  ghiTho(`E1-${u}`, F);
  return F;
}

/** E2 + E3 — ô chọn nhà máy trong studio; bộ chọn TOÀ/TẦNG có tồn tại không. */
async function caE2E3(u) {
  const { browser, ctx, cach } = await moTrinhDuyet(u);
  const F = { ca: "E2E3", vai: u, cach, base: BASE, luc: new Date().toISOString() };
  try {
    const page = await ctx.newPage();
    await page.goto(`${BASE}/twin-studio`, { waitUntil: "domcontentloaded" });
    const vao = await cho(page, '[data-testid="man-twin-studio"]', 60_000);
    F.vaoDuoc = vao ? 1 : 0;
    if (!vao) { F.ghi = "không vào được studio ⇒ E2/E3 N/A cho vai này"; return F; }
    await ngu(page, 9000);
    F.studio = await page.evaluate(DOC_STUDIO);
    /* (a) E2 — MỞ ô chọn nhà máy và đọc danh sách lựa chọn THẬT (chữ hiển thị). */
    await page.click('[data-testid="chon-nha-may"]').catch(() => {});
    await ngu(page, 1200);
    F.luaChonNhaMay = await page.evaluate(() =>
      [...document.querySelectorAll('[role="option"]')].map((e) => (e.innerText || "").trim()),
    );
    await page.keyboard.press("Escape").catch(() => {});
    await ngu(page, 600);
    /* (b) E3 — có ô nào chọn TOÀ / TẦNG không? Đọc MỌI combobox đang hiện. */
    F.boChonSauKhiDong = (await page.evaluate(DOC_STUDIO)).boChon;
    /* (c) E3 — cây phân cấp trong tab Thiết kế có nhánh TẦNG nào? */
    await page.click('[data-testid="tab-thiet-ke"]').catch(() => {});
    await ngu(page, 9000);
    F.thietKe = await page.evaluate(DOC_STUDIO);
    F.cayChu = await page.evaluate(() => {
      const e = document.querySelector('[data-testid="cay-phan-cap-twin"]');
      return e ? (e.innerText || "").replace(/\s+/g, " ").slice(0, 900) : null;
    });
    /* (d) E3 — mã máy đang vẽ trên cảnh: chúng thuộc TẦNG nào? (đọc từ cây/nhãn) */
    F.maMayTrenCanh = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="cay-phan-cap-twin"]');
      if (!el) return null;
      const chu = (el.innerText || "");
      const ma = chu.match(/QATD-[A-C]-T\d-X\d-L\d-M\d+/g);
      return ma ? { so: ma.length, mau: ma.slice(0, 12) } : { so: 0, mau: [] };
    });
    await page.screenshot({ path: `${ANH}/DE-E3-${u.replace("qatd_", "")}-studio.png` }).catch(() => {});
  } finally {
    await ctx.close();
    await browser.close();
  }
  ghiTho(`E2E3-${u}`, F);
  return F;
}

/** E4 — tab Thiết kế: 1 canvas + 4 khối; dựng nhà xưởng XEM TRƯỚC (không bấm Tạo). */
async function caE4(u = "qatd_kythuat") {
  const { browser, ctx, cach } = await moTrinhDuyet(u);
  const F = { ca: "E4", vai: u, cach, base: BASE, luc: new Date().toISOString() };
  try {
    const page = await ctx.newPage();
    await page.goto(`${BASE}/twin-studio`, { waitUntil: "domcontentloaded" });
    await cho(page, '[data-testid="man-twin-studio"]', 60_000);
    await ngu(page, 6000);
    await page.click('[data-testid="tab-thiet-ke"]').catch(() => {});
    await cho(page, '[data-testid="xuong-thiet-ke"]', 60_000);
    await ngu(page, 10_000);
    F.thietKe = await page.evaluate(DOC_STUDIO);
    F.veKhung = await page.evaluate(() => ({
      soCanvas: window.__soCanvas === undefined ? null : window.__soCanvas,
      canvasDom: document.querySelectorAll("canvas").length,
      thongKeVe: window.__thongKeVe ?? null,
    }));
    await page.screenshot({ path: `${ANH}/DE-E4-tab-thiet-ke.png` }).catch(() => {});

    /* ── dựng nhà xưởng: chỉ tới bước XEM TRƯỚC, KHÔNG bấm `nut-tao` ── */
    await page.click('[data-testid="tab-con-duong-b"]').catch(() => {});
    await cho(page, '[data-testid="dung-nha-xuong"]', 30_000);
    await ngu(page, 2000);
    F.dungB1 = await page.evaluate(() => {
      const o = (t) => (document.querySelector(`[data-testid="${t}"]`) ? 1 : 0);
      return { buocToaNha: o("buoc-toa-nha"), buocTang: o("buoc-tang"), buocXemTruoc: o("buoc-xem-truoc") };
    });
    /* ★ `buocHopLe` bước 1 đòi ĐỦ mã + tên + 3 kích thước (`thieuTen` là lỗi chặn) — lượt đo
       đầu bỏ `o-ten` nên nút "Bước sau" DISABLED và thước đọc ra "không tới được xem trước".
       Đọc `danh-sach-loi` ở mỗi bước để lý do luôn nói ra được, không đoán. */
    for (const [tid, gt] of [["o-ma", "QATDDEXT"], ["o-ten", "QATD-DE-XEMTRUOC"], ["o-dai", "60"], ["o-rong", "40"], ["o-cao", "12"]]) {
      const el = await page.$(`[data-testid="${tid}"]`);
      if (el) { await el.fill(gt).catch(() => {}); }
    }
    await ngu(page, 900);
    F.buoc1 = await page.evaluate(() => {
      const chu = (t) => { const e = document.querySelector(`[data-testid="${t}"]`); return e ? (e.innerText || "").replace(/\s+/g, " ").trim() : null; };
      const b = document.querySelector('[data-testid="nut-buoc-sau"]');
      return { loi: chu("danh-sach-loi"), buocSauTat: b ? (b.hasAttribute("disabled") ? 1 : 0) : null };
    });
    await page.click('[data-testid="nut-buoc-sau"]').catch(() => {});
    await ngu(page, 1800);
    F.buoc2 = await page.evaluate(() => {
      const chu = (t) => { const e = document.querySelector(`[data-testid="${t}"]`); return e ? (e.innerText || "").replace(/\s+/g, " ").trim() : null; };
      const b = document.querySelector('[data-testid="nut-buoc-sau"]');
      return {
        buocTang: document.querySelectorAll('[data-testid="buoc-tang"]').length,
        bangTang: (chu("bang-tang") ?? "").slice(0, 200),
        loi: chu("danh-sach-loi"),
        buocSauTat: b ? (b.hasAttribute("disabled") ? 1 : 0) : null,
      };
    });
    await page.click('[data-testid="nut-buoc-sau"]').catch(() => {});
    await ngu(page, 2200);
    F.xemTruoc = await page.evaluate(() => {
      const chu = (t) => { const e = document.querySelector(`[data-testid="${t}"]`); return e ? (e.innerText || e.textContent || "").trim() : null; };
      return {
        buocXemTruoc: document.querySelectorAll('[data-testid="buoc-xem-truoc"]').length,
        soTang: chu("so-tang-xem-truoc"),
        soTuong: chu("so-tuong-xem-truoc"),
        tomTat: chu("tom-tat-xem-truoc"),
        coNutTao: document.querySelectorAll('[data-testid="nut-tao"]').length,
        danhSachLoi: chu("danh-sach-loi"),
      };
    });
    F.khongBamTao = "KHÔNG bấm nut-tao ⇒ 0 hàng twin_toa_nha/twin_tang mới";
    await page.screenshot({ path: `${ANH}/DE-E4-xem-truoc.png` }).catch(() => {});
  } finally {
    await ctx.close();
    await browser.close();
  }
  ghiTho("E4-qatd_kythuat", F);
  return F;
}

/** E5 — vẽ MỘT vùng an toàn, lưu, thấy trong danh sách, rồi XOÁ qua UI. */
async function caE5(u = "qatd_kythuat") {
  const TEN = `QATD-DE-VUNG-${Date.now() % 100000}`;
  const { browser, ctx, cach } = await moTrinhDuyet(u);
  const F = { ca: "E5", vai: u, cach, base: BASE, luc: new Date().toISOString(), tenVung: TEN };
  try {
    const page = await ctx.newPage();
    await page.goto(`${BASE}/twin-studio`, { waitUntil: "domcontentloaded" });
    await cho(page, '[data-testid="man-twin-studio"]', 60_000);
    await ngu(page, 5000);
    await page.click('[data-testid="tab-thiet-ke"]').catch(() => {});
    await cho(page, '[data-testid="xuong-thiet-ke"]', 60_000);
    await ngu(page, 9000);
    F.truoc = await page.evaluate(DOC_STUDIO);
    if (F.truoc.veVungBatDau.co !== 1) {
      F.ghi = "không có nút 've-vung-bat-dau' ⇒ không có đường vẽ vùng";
      await page.screenshot({ path: `${ANH}/DE-E5-khong-co-nut.png` }).catch(() => {});
      return F;
    }
    await page.click('[data-testid="ve-vung-bat-dau"]');
    await ngu(page, 800);
    const svg = await page.$('[data-testid="ve-vung-svg"]');
    if (!svg) { F.ghi = "không thấy ve-vung-svg"; return F; }
    const box = await svg.boundingBox();
    F.hopSvg = box;
    const diem = [[0.25, 0.25], [0.5, 0.25], [0.5, 0.45], [0.25, 0.45]];
    for (const [fx, fy] of diem) {
      await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
      await ngu(page, 350);
    }
    F.dangVe = await page.evaluate(() => {
      const chu = (t) => { const e = document.querySelector(`[data-testid="${t}"]`); return e ? (e.innerText || "").trim() : null; };
      return { demDinh: chu("ve-vung-dem-dinh"), coXong: document.querySelectorAll('[data-testid="ve-vung-xong"]').length };
    });
    await page.click('[data-testid="ve-vung-xong"]');
    await cho(page, '[data-testid="ve-vung-hop-thoai"]', 15_000);
    await page.fill('[data-testid="ve-vung-o-ten"]', TEN);
    await ngu(page, 500);
    await page.screenshot({ path: `${ANH}/DE-E5-hop-thoai.png` }).catch(() => {});
    await page.click('[data-testid="ve-vung-luu"]');
    await ngu(page, 4000);
    F.sauLuu = await page.evaluate(DOC_STUDIO);
    F.chuSauLuu = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 500));
    await page.screenshot({ path: `${ANH}/DE-E5-sau-luu.png` }).catch(() => {});
    F.thayTrongDanhSach = (F.sauLuu.dsVung ?? []).some((v) => (v.chu ?? "").includes(TEN)) ? 1 : 0;
    /* XOÁ qua UI — đúng mục đang mang tên của ta, không xoá mục người khác. */
    const muc = await page.$(`[data-testid="ve-vung-muc"]:has-text("${TEN}")`);
    if (muc) {
      const nut = await muc.$('[data-testid="ve-vung-xoa"]');
      if (nut) { await nut.click(); await ngu(page, 4000); F.daBamXoa = 1; }
      else F.daBamXoa = 0;
    } else F.daBamXoa = 0;
    F.sauXoa = await page.evaluate(DOC_STUDIO);
    F.conTrongDanhSach = (F.sauXoa.dsVung ?? []).some((v) => (v.chu ?? "").includes(TEN)) ? 1 : 0;
    await page.screenshot({ path: `${ANH}/DE-E5-sau-xoa.png` }).catch(() => {});
  } finally {
    await ctx.close();
    await browser.close();
  }
  ghiTho("E5-qatd_kythuat", F);
  return F;
}

/** E6 — quanly trong studio: gizmo có, nút dựng/sinh? (ẩn-không-disable). */
async function caE6(u = "qatd_quanly") {
  const { browser, ctx, cach } = await moTrinhDuyet(u);
  const F = { ca: "E6", vai: u, cach, base: BASE, luc: new Date().toISOString() };
  try {
    const page = await ctx.newPage();
    await page.goto(`${BASE}/twin-studio`, { waitUntil: "domcontentloaded" });
    const vao = await cho(page, '[data-testid="man-twin-studio"]', 60_000);
    F.vaoDuoc = vao ? 1 : 0;
    if (!vao) { F.ghi = "không vào được studio"; return F; }
    await ngu(page, 5000);
    await page.click('[data-testid="tab-thiet-ke"]').catch(() => {});
    await cho(page, '[data-testid="xuong-thiet-ke"]', 60_000);
    await ngu(page, 9000);
    F.thietKe = await page.evaluate(DOC_STUDIO);
    /* MỌI nút trong thanh công cụ trên cùng — để thấy nút nào DISABLED thay vì ẩn. */
    F.nutThanhCongCu = await page.evaluate(() => {
      const x = document.querySelector('[data-testid="xuong-thiet-ke"]');
      if (!x) return null;
      const thanh = x.firstElementChild;
      return thanh
        ? [...thanh.querySelectorAll("button, [role=switch]")].map((b) => ({
            tid: b.getAttribute("data-testid"),
            chu: (b.innerText || "").replace(/\s+/g, " ").trim().slice(0, 40),
            aria: b.getAttribute("aria-label"),
            tat: b.hasAttribute("disabled") ? 1 : 0,
          }))
        : null;
    });
    /* Nút DỰNG (tab con đường B) + nút SINH — hai đường "tạo" của màn này. */
    F.duongTao = await page.evaluate(() => ({
      tabConDuongB: document.querySelectorAll('[data-testid="tab-con-duong-b"]').length,
      tabConDuongA: document.querySelectorAll('[data-testid="tab-con-duong-a"]').length,
      nutMoSinh: document.querySelectorAll('[data-testid="nut-mo-sinh"]').length,
      nutMoSinhTat: (() => { const e = document.querySelector('[data-testid="nut-mo-sinh"]'); return e ? (e.hasAttribute("disabled") ? 1 : 0) : null; })(),
    }));
    /* Tab "Thêm toà nhà" có form TẠO không? (dựng nhà xưởng = đường ghi canCreate) */
    await page.click('[data-testid="tab-con-duong-b"]').catch(() => {});
    await ngu(page, 3000);
    F.tabDung = await page.evaluate(() => ({
      dungNhaXuong: document.querySelectorAll('[data-testid="dung-nha-xuong"]').length,
      nutTao: document.querySelectorAll('[data-testid="nut-tao"]').length,
      buocToaNha: document.querySelectorAll('[data-testid="buoc-toa-nha"]').length,
      chu: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 500),
    }));
    /* ★ `nut-tao` chỉ render ở BƯỚC 3 — muốn biết nút TẠO có bị ẩn theo quyền hay không thì
       phải đi tới bước 3. ĐI TỚI rồi ĐỌC, TUYỆT ĐỐI KHÔNG BẤM (bấm là ghi twin_toa_nha thật). */
    for (const [tid, gt] of [["o-ma", "QLDEXT"], ["o-ten", "QATD-DE-DO-QUYEN"], ["o-dai", "50"], ["o-rong", "30"], ["o-cao", "10"]]) {
      const el = await page.$(`[data-testid="${tid}"]`);
      if (el) { await el.fill(gt).catch(() => {}); }
    }
    await ngu(page, 900);
    await page.click('[data-testid="nut-buoc-sau"]').catch(() => {});
    await ngu(page, 1600);
    await page.click('[data-testid="nut-buoc-sau"]').catch(() => {});
    await ngu(page, 2000);
    F.tabDungBuoc3 = await page.evaluate(() => {
      const e = document.querySelector('[data-testid="nut-tao"]');
      return {
        buocXemTruoc: document.querySelectorAll('[data-testid="buoc-xem-truoc"]').length,
        nutTao: e ? 1 : 0,
        nutTaoChu: e ? (e.innerText || "").trim() : null,
        nutTaoTat: e ? (e.hasAttribute("disabled") ? 1 : 0) : null,
      };
    });
    F.khongBamTao = "KHÔNG bấm nut-tao ⇒ 0 hàng twin_toa_nha mới";
    await page.screenshot({ path: `${ANH}/DE-E6-quanly.png` }).catch(() => {});
  } finally {
    await ctx.close();
    await browser.close();
  }
  ghiTho("E6-qatd_quanly", F);
  return F;
}

/**
 * E7 — CHẶN-ĐÚNG: kythuat gọi `twinCanh.sinhTuDong` ⇒ kỳ vọng FORBIDDEN/UNAUTHORIZED.
 *
 * ★ AN TOÀN: `tangIds:[83]` = QATD-A toà 1 TẦNG 3 — tầng KHÔNG có xưởng, DB đo 0 máy.
 *   Nếu (ngoài kỳ vọng) cổng cho qua thì tập ghi rỗng ⇒ 0 hàng bố cục bị đè.
 * ★ CA DƯƠNG cùng thiết bị (G139): `twinCanh.xemTruocSinh` cùng input, cùng cookie —
 *   thủ tục ĐỌC đứng trên `quyenThietKe("canView")` ⇒ phải 200. Nếu nó cũng 403 thì
 *   phép đo đang đo "cookie chết", không đo cổng quyền.
 * ★ KHÔNG gọi bằng admin (nó ghi đè toàn bộ bố cục).
 */
async function caE7(u = "qatd_kythuat") {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: BASE });
  const F = { ca: "E7", vai: u, base: BASE, luc: new Date().toISOString() };
  try {
    F.cach = await dangNhap(ctx, u);
    const input = { factoryId: 38, tangIds: [83] };
    F.input = input;
    F.ghiAnToan = "tangIds=[83] (QATD-A toà 1 tầng 3, 0 xưởng/0 máy) ⇒ kể cả nếu qua cổng thì tập ghi rỗng";
    F.caDuongXemTruoc = await trpcGet(ctx, "twinCanh.xemTruocSinh", input);
    F.sinhTuDong = await trpcPost(ctx, "twinCanh.sinhTuDong", input);
    /* Đối chứng: cùng cookie gọi một thủ tục ĐỌC cơ bản (cookie còn sống?). */
    F.coookieSong = await trpcGet(ctx, "auth.me");
  } finally {
    await ctx.close();
    await browser.close();
  }
  ghiTho("E7-qatd_kythuat", F);
  return F;
}

/* ══════════════════════════════════════════════════════════════════════════════ */
const VAI_D1 = ["qatd_kythuat", "qatd_quanly", "qatd_congnhan", "qatd_giamdoc", "qatd_admin"];
const VAI_E1 = ["qatd_kythuat", "qatd_quanly", "qatd_congnhan", "qatd_giamdoc", "qatd_admin"];
try {
  if (CA === "D1") { for (const u of (VAI_CLI ? [VAI_CLI] : VAI_D1)) { await caD1(u); } }
  else if (CA === "D2") await caD2();
  else if (CA === "D3") await caD3("qatd_congnhan", MOC);
  else if (CA === "D4") { for (const u of (VAI_CLI ? [VAI_CLI] : ["qatd_quanly", "qatd_congnhan"])) { await caD4(u); } }
  else if (CA === "D5") await caD5();
  else if (CA === "E1") { for (const u of (VAI_CLI ? [VAI_CLI] : VAI_E1)) { await caE1(u); } }
  else if (CA === "E2E3") { for (const u of (VAI_CLI ? [VAI_CLI] : ["qatd_kythuat", "qatd_quanly"])) { await caE2E3(u); } }
  else if (CA === "E4") await caE4();
  else if (CA === "E5") await caE5();
  else if (CA === "E6") await caE6();
  else if (CA === "E7") await caE7();
  else { console.error("ca? D1 D2 D3 D4 D5 E1 E2E3 E4 E5 E6 E7"); process.exit(2); }
} catch (e) {
  console.error(`[do-DE ${CA}] LOI: ${e.message}`);
  ghiTho(`LOI-${CA}${VAI_CLI ? "-" + VAI_CLI : ""}${MOC ? "-" + MOC : ""}`, { ca: CA, vai: VAI_CLI, moc: MOC, loi: e.message, stack: String(e.stack).slice(0, 1200) });
  process.exit(1);
}
