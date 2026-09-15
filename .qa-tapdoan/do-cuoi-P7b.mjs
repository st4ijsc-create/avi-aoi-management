/** P7b — phân xử P7: bảng sức khoẻ đo THEO NHÀ MÁY, `__demVien` đo VÒNG TRÊN CẢNH.
 *  Đo cả hai bằng NGUỒN CHUNG (`twinCanh.sucKhoeMay`) + ngưỡng của sản phẩm,
 *  rồi so từng bên với đúng mẫu số của nó. Không sửa mã.
 */
import { chromium } from "@playwright/test";
import { BASE, LAUNCH, MOC, sqlMo, luu, bao, phan, dangNhapCtx, trpcGet, anh, choCanh } from "./lib-cuoi.mjs";

const NGUONG = { NGUY_KICH: 60, CANH: 80, THEO_DOI: 90 };
const CO_VIEN = ["nguy_kich", "canh", "theo_doi", "het_han"];
const HAN_MS = 10 * 60 * 1000; // sẽ đo lại từ dữ liệu, xem ghiChuHan

function hang(k, bayGio, hanMs) {
  if (k.diem == null && k.nguyCo == null && k.mucKhan == null) return "chua_do";
  if (k.mocMs == null || bayGio - k.mocMs > hanMs) return "het_han";
  if (k.mucKhan === "CRITICAL") return "nguy_kich";
  if (k.diem == null) return "chua_do";
  if (k.diem < NGUONG.NGUY_KICH) return "nguy_kich";
  if (k.diem < NGUONG.CANH) return "canh";
  if (k.diem < NGUONG.THEO_DOI) return "theo_doi";
  return "khoe";
}

const ta = MOC.tangA;
const r = { ca: "P7b", vai: "qatd_kythuat", deBai: "phan xu P7: bang-suc-khoe co dung mau so NHA MAY khong, va __demVien co dung mau so CANH khong" };
const browser = await chromium.launch(LAUNCH);
const sql = sqlMo();
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await dangNhapCtx(ctx, "qatd_kythuat");
  const sk = await trpcGet(ctx, "twinCanh.sucKhoeMay", { factoryId: MOC.F["QATD-A"] });
  const khai = sk.data && sk.data.khai ? sk.data.khai : null;
  r.nguon = { http: sk.http, tong: sk.data ? sk.data.tong : null, tongMayTrongPhamVi: sk.data ? sk.data.tongMayTrongPhamVi : null, bayGio: sk.data ? sk.data.bayGio : null, mauKhai: khai ? khai.slice(0, 2) : null };

  const page = await ctx.newPage();
  await page.goto(`${BASE}/twin?do=1&nm=${MOC.F["QATD-A"]}&toa=${ta.toa_id}&tang=${ta.tang_id}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="man-twin-van-hanh"]', { timeout: 90_000 }).catch(() => {});
  await choCanh(page, 0);
  await page.waitForFunction(() => window.__demVien && window.__demVien.tong > 0, null, { timeout: 60_000 }).catch(() => {});
  const d = await page.evaluate(() => {
    const b = document.querySelector('[data-testid="bang-suc-khoe"]');
    const ds = window.__demTuongTac && window.__demTuongTac.dsMay ? window.__demTuongTac.dsMay() : null;
    return {
      bang: b ? [...b.querySelectorAll("[data-hang]")].map((e) => ({ hang: e.getAttribute("data-hang"), so: e.getAttribute("data-so") })) : null,
      demVien: window.__demVien === undefined ? null : window.__demVien,
      dsMayIds: Array.isArray(ds) ? ds.map((m) => m.machineId) : null,
      soKhoiCanh: Array.isArray(ds) ? ds.length : null,
    };
  });
  r.anh = await anh(page, "P7b-phan-xu");
  const dbTangMay = (await sql`select d."thucTheId" as id from twin_dat_cho d where d."tangId"=${ta.tang_id} and d."loaiThucThe"='machine'`).map((x) => Number(x.id));
  await ctx.close();

  // hạn sức khoẻ: suy ra từ dữ liệu — hạng "het_han" trên bảng = 0 nên mọi khai còn hạn
  const bayGio = sk.data ? sk.data.bayGio : Date.now();
  const tuoiMax = khai ? Math.max(...khai.filter((k) => k.mocMs != null).map((k) => bayGio - k.mocMs)) : null;
  const hanMs = Math.max(HAN_MS, (tuoiMax || 0) + 1); // không để hạn giả tạo đẩy mọi hàng sang het_han
  r.ghiChuHan = `tuổi khai lớn nhất ${tuoiMax} ms; dùng hạn ${hanMs} ms để KHÔNG tự tạo hạng het_han (bảng trên màn khai het_han = 0)`;

  const demTheoHang = (ids) => {
    const m = new Map(khai.map((k) => [k.machineId, k]));
    const o = { nguy_kich: 0, canh: 0, theo_doi: 0, het_han: 0, khoe: 0, chua_do: 0 };
    for (const id of ids) { const k = m.get(id); o[k ? hang(k, bayGio, hanMs) : "chua_do"] += 1; }
    return o;
  };
  const idsNhaMay = khai ? khai.map((k) => k.machineId) : [];
  const tinhNhaMay = khai ? demTheoHang(idsNhaMay) : null;
  const tinhCanh = khai && d.dsMayIds ? demTheoHang(d.dsMayIds) : null;
  const vienTuCanh = tinhCanh ? CO_VIEN.reduce((a, h) => a + tinhCanh[h], 0) : null;
  const bangDoc = d.bang ? Object.fromEntries(d.bang.map((x) => [x.hang, Number(x.so)])) : null;
  const tongBang = bangDoc ? Object.values(bangDoc).reduce((a, b) => a + b, 0) : null;

  r.thay = {
    bangTrenMan: bangDoc, tongBang,
    tinhLaiTheoNhaMay: tinhNhaMay, soKhaiNhaMay: khai ? khai.length : null, tongMayTrongPhamVi: sk.data ? sk.data.tongMayTrongPhamVi : null,
    demVien: d.demVien, soKhoiCanh: d.soKhoiCanh, soDatChoDb: dbTangMay.length,
    tinhLaiTheoCanh: tinhCanh, vienSuyTuCanh: vienTuCanh,
  };
  r.giaiThich = "Sản phẩm khai TƯỜNG MINH (TwinVanHanh.tsx:1338-1343) rằng bảng đếm theo NHÀ MÁY còn `__demVien` đếm VÒNG TRÊN CẢNH; hai mẫu số khác nhau nên hai số PHẢI khác nhau.";
  Object.assign(r, phan(
    { "bang tren man": bangDoc, "__demVien": d.demVien, "khai suc khoe tu server": khai ? khai.length : null, "ids khoi tren canh": d.dsMayIds ? d.dsMayIds.length : null },
    [
      { ten: "tong bang = so may CA NHA MAY (371)", ok: tongBang === 371, thay: `${tongBang}` },
      { ten: "bang KHOP phep tinh lai tu nguon sucKhoeMay theo NHA MAY", ok: JSON.stringify(bangDoc) === JSON.stringify(tinhNhaMay), thay: `bảng ${JSON.stringify(bangDoc)} vs tính lại ${JSON.stringify(tinhNhaMay)}` },
      { ten: "so khoi tren canh = so dat cho cua tang trong DB", ok: d.soKhoiCanh === dbTangMay.length, thay: `${d.soKhoiCanh} vs DB ${dbTangMay.length}` },
      { ten: "__demVien.tong = so may TREN CANH thuoc 4 hang CO VIEN", ok: d.demVien && vienTuCanh === d.demVien.tong, thay: `__demVien.tong=${d.demVien ? d.demVien.tong : null} vs tính lại ${vienTuCanh}` },
      { ten: "__demVien.theoHang KHOP phep tinh lai theo CANH", ok: d.demVien && CO_VIEN.every((h) => (d.demVien.theoHang[h] || 0) === (tinhCanh ? tinhCanh[h] : -1)), thay: `${JSON.stringify(d.demVien ? d.demVien.theoHang : null)} vs ${JSON.stringify(tinhCanh)}` },
    ]));
  bao("P7b", r.pq, r.vi); luu("P7b", r);
} finally { await browser.close(); await sql.end(); }
