/** NGHIỆM-THU CUỐI — PHẦN 1: 8 bản vá phải thấy được trên màn sống.
 *  node .qa-tapdoan/do-cuoi-P.mjs --ca=P1|P2|P3|P4|P7|P8|all
 *  Đọc CHỮ NGƯỜI DÙNG THẤY. Thiếu dữ kiện ⇒ HỎNG kèm TÊN. Tập rỗng ⇒ HỎNG.
 */
import { chromium } from "@playwright/test";
import { arg, BASE, LAUNCH, MOC, sqlMo, luu, bao, phan, dangNhapCtx, anh, choCanh } from "./lib-cuoi.mjs";

const CA = arg("ca", "all");
const chay = (c) => CA === "all" || CA === c;
const KQ = {};

/* ── đọc màn theo NGHĨA ────────────────────────────────────────────────── */
const DOC = () => {
  const el = (t) => document.querySelector(`[data-testid="${t}"]`);
  const chu = (t) => { const e = el(t); return e ? (e.innerText || e.textContent || "").replace(/\s+/g, " ").trim() : null; };
  const dem = (t) => document.querySelectorAll(`[data-testid="${t}"]`).length;
  const R = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), phai: Math.round(b.right), day: Math.round(b.bottom) }; };
  const hien = (e) => { if (!e || e.hidden) return false; const b = e.getBoundingClientRect(); if (b.width <= 0 || b.height <= 0) return false; const cs = getComputedStyle(e); return cs.visibility !== "hidden" && Number(cs.opacity) > 0.05; };
  const giao = (a, b) => (!a || !b) ? null : Math.max(0, Math.min(a.phai, b.phai) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.day, b.day) - Math.max(a.y, b.y));

  /* P1 — danh sách máy */
  const boxDs = el("danh-sach-may");
  const ulDs = boxDs ? boxDs.querySelector("ul[data-so-may]") : null;
  const hangDs = [...document.querySelectorAll('[data-testid^="may-hang-"]')].map((e) => {
    const o = e.querySelector("span[data-ma]");
    return { tid: e.getAttribute("data-testid"), viTri: Number(e.getAttribute("data-vi-tri")), maDayDu: o ? o.getAttribute("data-ma") : null, chuHien: (o ? o.textContent : "").trim(), chuHang: (e.innerText || "").replace(/\s+/g, " ").trim() };
  });
  /* P2 — dải cảnh báo */
  const dongCb = [...document.querySelectorAll('[data-testid="dai-canh-bao"] [data-ma-may]')].map((e) => ({
    tid: e.getAttribute("data-testid"), maMay: e.getAttribute("data-ma-may"), nhaMay: e.getAttribute("data-nha-may"),
    muc: e.getAttribute("data-muc"), tonDong: e.getAttribute("data-ton-dong"), chu: (e.innerText || e.textContent || "").replace(/\s+/g, " ").trim().slice(0, 220),
  }));
  /* P4 — lớp phủ vs banner */
  const kpiEl = el("bang-kpi-noi");
  const daiEl = el("dai-hop-nhat"), daiCtEl = el("dai-hop-nhat-chi-tiet"), daiKhung = el("dai-hop-nhat-khung");
  const banner = {};
  for (const t of ["banner-ha-cap", "banner-ngoai-luot-nap", "banner-doi-soat", "banner-tang-vuot-tran", "banner-thieu-quyen-truy-van", "banner-link-bi-bo-qua", "canh-bao-estop"]) {
    const e = el(t);
    banner[t] = e ? { hien: hien(e), chu: (e.innerText || e.textContent || "").replace(/\s+/g, " ").trim(), rect: R(e), dataPhu: Object.fromEntries([...e.attributes].filter((a) => a.name.startsWith("data-")).map((a) => [a.name, a.value])) } : null;
  }
  /* P7 — bảng sức khoẻ */
  const bskEl = el("bang-suc-khoe");
  const bsk = bskEl ? {
    hien: hien(bskEl), chu: (bskEl.innerText || "").replace(/\s+/g, " ").trim(),
    hang: [...bskEl.querySelectorAll("[data-hang]")].map((e) => ({ hang: e.getAttribute("data-hang"), so: e.getAttribute("data-so"), chu: (e.innerText || "").replace(/\s+/g, " ").trim() })),
    thuocTinh: Object.fromEntries([...bskEl.attributes].filter((a) => a.name.startsWith("data-")).map((a) => [a.name, a.value])),
    rect: R(bskEl),
  } : null;
  /* H3 — khối tổng quan */
  const ktq = el("khoi-tong-quan");
  return {
    url: location.pathname + location.search, lang: document.documentElement.lang,
    manVanHanh: dem("man-twin-van-hanh"),
    tienTo: { so: dem("danh-sach-may-tien-to"), chu: chu("danh-sach-may-tien-to") },
    danhSachMay: ulDs ? { soMay: Number(ulDs.getAttribute("data-so-may")), aoHoa: ulDs.getAttribute("data-ao-hoa"), soHangVe: Number(ulDs.getAttribute("data-so-hang-ve")), rect: R(ulDs), rectBox: R(boxDs) } : null,
    hangDs, demMay: chu("dem-may"), danhSachRong: dem("danh-sach-rong"),
    daiCanhBao: el("dai-canh-bao") ? { chu: chu("dai-canh-bao").slice(0, 400), phamVi: chu("dai-pham-vi"), trong: dem("dai-trong"), chuaDo: dem("dai-chua-do"), nhomTonDong: dem("nhom-ton-dong"), nhomHomNay: dem("nhom-hom-nay"), theoNhanh: dem("dai-theo-nhanh") } : null,
    dongCb, soDongCb: dongCb.length,
    kpi: kpiEl ? { chu: (kpiEl.innerText || "").replace(/\s+/g, " ").trim(), mauSo: kpiEl.getAttribute("data-mau-so"), mauSoOee: kpiEl.getAttribute("data-mau-so-oee"), mo: kpiEl.getAttribute("data-mo"), phamViChu: chu("kpi-pham-vi"), mauSoChu: chu("kpi-mau-so"), mauSoOeeChu: chu("kpi-mau-so-oee"), rect: R(kpiEl), hien: hien(kpiEl) } : null,
    khungNeo: el("khung-neo-lop-phu") ? { chuaChoDai: Number(el("khung-neo-lop-phu").getAttribute("data-chua-cho-dai")), rect: R(el("khung-neo-lop-phu")) } : null,
    daiHopNhat: daiEl ? { chu: (daiEl.innerText || "").replace(/\s+/g, " ").trim(), rect: R(daiEl), hien: hien(daiEl) } : null,
    daiHopNhatChiTiet: daiCtEl ? { chu: (daiCtEl.innerText || "").replace(/\s+/g, " ").trim(), rect: R(daiCtEl), hien: hien(daiCtEl) } : null,
    daiHopNhatKhung: daiKhung ? { rect: R(daiKhung) } : null,
    nutMoDai: dem("nut-mo-dai-hop-nhat"),
    giaoKpiDai: giao(R(kpiEl), R(daiCtEl)), giaoKpiDaiThu: giao(R(kpiEl), R(daiEl)),
    banner,
    bangSucKhoe: bsk, demVien: window.__demVien === undefined ? null : window.__demVien,
    khoiTongQuan: ktq ? { rect: R(ktq), cao: Number(ktq.getBoundingClientRect().height.toFixed(2)), chu: (ktq.innerText || "").replace(/\s+/g, " ").trim().slice(0, 400) } : null,
    soCanvas: window.__soCanvas === undefined ? null : window.__soCanvas,
    veCalls: window.__thongKeVe ? window.__thongKeVe.calls : null,
    tamGiac: window.__thongKeVe ? window.__thongKeVe.triangles : null,
    nhanDom: document.querySelectorAll('[data-testid="nhan-may-twin3d"]').length,
    thanTrang: (document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 600),
  };
};
const doc = (p) => p.evaluate(DOC);

async function moTwin(browser, vai, duong, vp) {
  const ctx = await browser.newContext({ viewport: vp || { width: 1600, height: 900 } });
  await dangNhapCtx(ctx, vai);
  const page = await ctx.newPage();
  const loi = [];
  page.on("console", (m) => { if (m.type() === "error") loi.push(m.text().slice(0, 160)); });
  await page.goto(`${BASE}${duong}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector('[data-testid="man-twin-van-hanh"]', { timeout: 90_000 }).catch(() => {});
  await choCanh(page, 0);
  return { ctx, page, loi };
}

const browser = await chromium.launch(LAUNCH);
try {

  /* ══ P1 — tiền tố in MỘT LẦN, đuôi mỗi hàng KHÁC NHAU, @1280×720 ══════ */
  if (chay("P1")) {
    const r = { ca: "P1", vai: "qatd_congnhan", vp: "1280x720", deBai: "danh-sach-may in tien to MOT LAN (danh-sach-may-tien-to) va 5 hang bat ky doc KHAC NHAU o phan duoi" };
    const { ctx, page } = await moTwin(browser, "qatd_congnhan", "/twin?do=1", { width: 1280, height: 720 });
    try {
      await page.waitForFunction(() => document.querySelectorAll('[data-testid^="may-hang-"]').length > 0, null, { timeout: 60_000 }).catch(() => {});
      const d = await doc(page);
      r.anh = await anh(page, "P1-congnhan-1280");
      const hang5 = d.hangDs.slice(0, 5);
      const duoi = hang5.map((h) => h.chuHien);
      const duoiRieng = new Set(duoi).size;
      r.thay = { soTienTo: d.tienTo.so, chuTienTo: d.tienTo.chu, soMayTrongDs: d.danhSachMay ? d.danhSachMay.soMay : null, soHangVe: d.danhSachMay ? d.danhSachMay.soHangVe : null, hang5, duoiRieng, demMay: d.demMay, tongHangDom: d.hangDs.length };
      Object.assign(r, phan(
        { "so khoi tien to": d.tienTo.so, "chu tien to": d.tienTo.chu, "so hang ve": d.danhSachMay ? d.danhSachMay.soHangVe : null, "5 hang doc duoc": hang5.length === 5 ? 5 : null },
        [
          { ten: "tien to in DUNG MOT LAN", ok: d.tienTo.so === 1, thay: `${d.tienTo.so} khối` },
          { ten: "chu tien to KHONG rong", ok: !!d.tienTo.chu && /\S/.test(d.tienTo.chu), thay: JSON.stringify(d.tienTo.chu) },
          { ten: "5 hang dau doc KHAC NHAU o phan duoi", ok: duoiRieng === 5, thay: `${duoiRieng}/5 riêng: ${JSON.stringify(duoi)}` },
          { ten: "moi hang van giu MA DAY DU o data-ma", ok: hang5.every((h) => h.maDayDu && h.maDayDu.length > h.chuHien.length), thay: hang5.map((h) => `${h.maDayDu}→${h.chuHien}`).join(" | ") },
        ]));
      KQ.P1 = r;
    } finally { await ctx.close(); }
    bao("P1", r.pq, r.vi); luu("P1", r);
  }

  /* ══ P2 — dải cảnh báo mang MÃ MÁY + TÊN NHÀ MÁY ═══════════════════════ */
  if (chay("P2")) {
    const r = { ca: "P2", vai: "qatd_giamdoc", deBai: "moi dong canh bao mang MA MAY + TEN NHA MAY; giam doc 3 cong ty => phan ra duoc theo cong ty" };
    const { ctx, page } = await moTwin(browser, "qatd_giamdoc", "/twin?do=1");
    try {
      await page.waitForFunction(() => !!document.querySelector('[data-testid="dai-canh-bao"]'), null, { timeout: 60_000 }).catch(() => {});
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="dai-canh-bao"] [data-ma-may]').length > 0 || !!document.querySelector('[data-testid="dai-trong"]'), null, { timeout: 45_000 }).catch(() => {});
      const d = await doc(page);
      r.anh = await anh(page, "P2-giamdoc-dai-canh-bao");
      const dong = d.dongCb;
      const coMa = dong.filter((x) => x.maMay && x.maMay.trim());
      const coNm = dong.filter((x) => x.nhaMay && x.nhaMay.trim());
      const nmRieng = [...new Set(dong.map((x) => x.nhaMay).filter(Boolean))];
      r.thay = { soDong: dong.length, coMa: coMa.length, coNhaMay: coNm.length, nhaMayRieng: nmRieng, mau: dong.slice(0, 8), daiChu: d.daiCanhBao ? d.daiCanhBao.chu.slice(0, 300) : null, daiTrong: d.daiCanhBao ? d.daiCanhBao.trong : null };
      r.chuTrenMan = dong.slice(0, 8).map((x) => x.chu);
      if (dong.length === 0) Object.assign(r, { pq: "HỎNG", vi: `tập RỖNG: 0 dòng cảnh báo trên dải (dai-trong=${d.daiCanhBao ? d.daiCanhBao.trong : "?"}) — không có gì để đo` });
      else Object.assign(r, phan(
        { "so dong canh bao": dong.length },
        [
          { ten: "MOI dong mang ma may (data-ma-may)", ok: coMa.length === dong.length, thay: `${coMa.length}/${dong.length}` },
          { ten: "MOI dong mang ten nha may (data-nha-may)", ok: coNm.length === dong.length, thay: `${coNm.length}/${dong.length}` },
          { ten: "ma may HIEN trong chu nguoi dung doc", ok: dong.every((x) => x.maMay && x.chu.includes(x.maMay)), thay: dong.filter((x) => !x.chu.includes(x.maMay || " ")).slice(0, 3).map((x) => `${x.maMay} không có trong "${x.chu.slice(0, 80)}"`).join(" ; ") || "ok" },
          { ten: "ten nha may HIEN trong chu nguoi dung doc", ok: dong.every((x) => x.nhaMay && x.chu.includes(x.nhaMay)), thay: dong.filter((x) => !x.chu.includes(x.nhaMay || " ")).slice(0, 3).map((x) => `${x.nhaMay} không có trong "${x.chu.slice(0, 80)}"`).join(" ; ") || "ok" },
          { ten: "phan ra duoc theo cong ty (>=1 gia tri nha may rieng)", ok: nmRieng.length >= 1, thay: JSON.stringify(nmRieng) },
        ]));
      KQ.P2 = r;
    } finally { await ctx.close(); }
    bao("P2", r.pq, r.vi); luu("P2", r);
  }

  /* ══ P3 — PH-06: tầng KHÔNG có máy ⇒ mẫu số 0, nhãn phạm vi khớp ═══════ */
  if (chay("P3")) {
    const t = MOC.tangRongA, ta = MOC.tangA;
    const r = { ca: "P3", vai: "qatd_kythuat", deBai: `tang RONG (${t.fcode} ${t.toa_ma} cap${t.cap}, tang_id=${t.tang_id}, DB=0 may) => kpi-mau-so PHAI = 0`, kyVongDb: { tangRong: t, tangCoMay: ta } };
    const { ctx, page } = await moTwin(browser, "qatd_kythuat", `/twin?do=1&nm=${MOC.F["QATD-A"]}&toa=${ta.toa_id}&tang=${ta.tang_id}`);
    try {
      await page.waitForFunction(() => { const e = document.querySelector('[data-testid="bang-kpi-noi"]'); return !!e && e.getAttribute("data-mau-so") !== null && e.getAttribute("data-mau-so") !== "0"; }, null, { timeout: 60_000 }).catch(() => {});
      const dCo = await doc(page);
      r.anhCoMay = await anh(page, "P3-tang-co-may");
      r.tangCoMay = { mauSo: dCo.kpi ? dCo.kpi.mauSo : null, mauSoChu: dCo.kpi ? dCo.kpi.mauSoChu : null, phamVi: dCo.kpi ? dCo.kpi.phamViChu : null, mauSoOee: dCo.kpi ? dCo.kpi.mauSoOee : null, dbMay: ta.so_may };
      await page.goto(`${BASE}/twin?do=1&nm=${MOC.F["QATD-A"]}&toa=${t.toa_id}&tang=${t.tang_id}`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector('[data-testid="man-twin-van-hanh"]', { timeout: 60_000 }).catch(() => {});
      await choCanh(page, 0);
      await page.waitForFunction(() => { const e = document.querySelector('[data-testid="bang-kpi-noi"]'); return !!e && e.getAttribute("data-mau-so") !== null; }, null, { timeout: 60_000 }).catch(() => {});
      const d = await doc(page);
      r.anh = await anh(page, "P3-tang-rong");
      r.thay = { mauSo: d.kpi ? d.kpi.mauSo : null, mauSoChu: d.kpi ? d.kpi.mauSoChu : null, mauSoOee: d.kpi ? d.kpi.mauSoOee : null, phamVi: d.kpi ? d.kpi.phamViChu : null, kpiChu: d.kpi ? d.kpi.chu.slice(0, 260) : null, demMay: d.demMay, danhSachRong: d.danhSachRong, soMayDs: d.danhSachMay ? d.danhSachMay.soMay : null };
      Object.assign(r, phan(
        { "kpi-mau-so (data)": d.kpi ? d.kpi.mauSo : null, "kpi-mau-so (chu)": d.kpi ? d.kpi.mauSoChu : null, "kpi-pham-vi (chu)": d.kpi ? d.kpi.phamViChu : null },
        [
          { ten: "mau so = 0 tren tang RONG", ok: Number(d.kpi.mauSo) === 0, thay: `data-mau-so=${d.kpi.mauSo} · chữ "${d.kpi.mauSoChu}"` },
          { ten: "mau so KHONG phai so ca nha may (371)", ok: Number(d.kpi.mauSo) !== 371, thay: `${d.kpi.mauSo}` },
          { ten: `doi chung duong: tang CO may cho mau so = ${ta.so_may}`, ok: Number(r.tangCoMay.mauSo) === ta.so_may, thay: `${r.tangCoMay.mauSo} (DB ${ta.so_may})` },
          { ten: "nhan pham vi NEU dung tang dang xem", ok: !!d.kpi.phamViChu && /\d|tầng|floor/i.test(d.kpi.phamViChu), thay: JSON.stringify(d.kpi.phamViChu) },
        ]));
      KQ.P3 = r;
    } finally { await ctx.close(); }
    bao("P3", r.pq, r.vi); luu("P3", r);
  }

  /* ══ P4 — bảng KPI KHÔNG che banner ở ?pv=tapdoan ══════════════════════ */
  if (chay("P4")) {
    const r = { ca: "P4", vai: "qatd_giamdoc", deBai: "?pv=tapdoan: doc NGUYEN VAN banner, do boundingBox bang-kpi-noi vs banner => giao nhau PHAI = 0; doc data-chua-cho-dai" };
    const { ctx, page } = await moTwin(browser, "qatd_giamdoc", "/twin?do=1&pv=tapdoan");
    try {
      const d0 = await doc(page);
      r.anhThu = await anh(page, "P4-tapdoan-dai-thu");
      r.daiLucThu = { chu: d0.daiHopNhat ? d0.daiHopNhat.chu : null, nutMoDai: d0.nutMoDai };
      let moDuoc = false;
      if (d0.nutMoDai > 0) {
        await page.locator('[data-testid="nut-mo-dai-hop-nhat"]').click().catch(() => {});
        moDuoc = await page.waitForSelector('[data-testid="dai-hop-nhat-chi-tiet"]', { timeout: 15_000 }).then(() => true).catch(() => false);
      }
      const d = await doc(page);
      r.anh = await anh(page, "P4-tapdoan-banner-mo");
      const bn = Object.entries(d.banner).filter(([, v]) => v && v.hien);
      const giaoTungBanner = bn.map(([k, v]) => {
        const a = d.kpi ? d.kpi.rect : null, b = v.rect;
        const g = (!a || !b) ? null : Math.max(0, Math.min(a.phai, b.phai) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.day, b.day) - Math.max(a.y, b.y));
        return { banner: k, px2: g, rect: b, chu: v.chu };
      });
      r.nguyenVanBanner = bn.map(([k, v]) => `[${k}] ${v.chu}`);
      r.thay = { moDuoc, chuaChoDai: d.khungNeo ? d.khungNeo.chuaChoDai : null, kpiRect: d.kpi ? d.kpi.rect : null, daiRect: d.daiHopNhat ? d.daiHopNhat.rect : null, daiChiTietRect: d.daiHopNhatChiTiet ? d.daiHopNhatChiTiet.rect : null, giaoKpiDaiChiTiet: d.giaoKpiDai, giaoKpiDaiThu: d.giaoKpiDaiThu, giaoTungBanner, soBannerHien: bn.length, daiChiTietChu: d.daiHopNhatChiTiet ? d.daiHopNhatChiTiet.chu.slice(0, 600) : null };
      const tongGiao = giaoTungBanner.reduce((a, x) => a + (x.px2 || 0), 0);
      Object.assign(r, phan(
        { "bang-kpi-noi rect": d.kpi ? d.kpi.rect : null, "data-chua-cho-dai": d.khungNeo ? d.khungNeo.chuaChoDai : null, "so banner HIEN": bn.length === 0 ? null : bn.length },
        [
          { ten: "giao KPI x TUNG banner = 0 px2", ok: tongGiao === 0, thay: `tổng ${tongGiao} px² · ${JSON.stringify(giaoTungBanner.map((x) => [x.banner, x.px2]))}` },
          { ten: "giao KPI x dai-hop-nhat-chi-tiet = 0 px2", ok: (d.giaoKpiDai || 0) === 0, thay: `${d.giaoKpiDai}` },
          { ten: "giao KPI x dai-hop-nhat (thu) = 0 px2", ok: (d.giaoKpiDaiThu || 0) === 0, thay: `${d.giaoKpiDaiThu}` },
          { ten: "data-chua-cho-dai > 0 (co chua cho that)", ok: Number(d.khungNeo.chuaChoDai) > 0, thay: `${d.khungNeo.chuaChoDai}` },
          { ten: "KPI bat dau DUOI muc chua cho", ok: !!d.kpi.rect && !!d.khungNeo.rect && d.kpi.rect.y >= d.khungNeo.rect.y - 1, thay: `kpi.y=${d.kpi.rect.y} khungNeo.y=${d.khungNeo.rect.y}` },
        ]));
      KQ.P4 = r;
    } finally { await ctx.close(); }
    bao("P4", r.pq, r.vi); luu("P4", r);
  }

  /* ══ P7 — bảng xếp hạng sức khoẻ + __demVien.theoHang ═════════════════ */
  if (chay("P7")) {
    const ta = MOC.tangA;
    const r = { ca: "P7", vai: "qatd_kythuat", deBai: `bang-suc-khoe hien ra tren /twin (${ta.fcode} ${ta.toa_ma} cap${ta.cap}) va so theo hang KHOP __demVien.theoHang` };
    const { ctx, page } = await moTwin(browser, "qatd_kythuat", `/twin?do=1&nm=${MOC.F["QATD-A"]}&toa=${ta.toa_id}&tang=${ta.tang_id}`);
    try {
      await page.waitForFunction(() => window.__demVien !== undefined, null, { timeout: 60_000 }).catch(() => {});
      await page.waitForFunction(() => !!document.querySelector('[data-testid="bang-suc-khoe"]'), null, { timeout: 60_000 }).catch(() => {});
      await page.waitForFunction(() => (window.__demVien && window.__demVien.tong > 0), null, { timeout: 60_000 }).catch(() => {});
      const d = await doc(page);
      r.anh = await anh(page, "P7-bang-suc-khoe");
      const bsk = d.bangSucKhoe, dv = d.demVien;
      const hangBang = Object.fromEntries((bsk && bsk.hang ? bsk.hang : []).map((h) => [h.hang, Number(h.so)]));
      const lech = dv && dv.theoHang ? Object.entries(dv.theoHang).filter(([k, v]) => (hangBang[k] || 0) !== Number(v)) : null;
      r.thay = { bangHien: bsk ? bsk.hien : null, bangChu: bsk ? bsk.chu : null, hangBang, demVien: dv, lech, thuocTinhBang: bsk ? bsk.thuocTinh : null };
      Object.assign(r, phan(
        { "bang-suc-khoe": bsk ? 1 : null, "__demVien": dv, "__demVien.theoHang": dv ? dv.theoHang : null },
        [
          { ten: "bang-suc-khoe HIEN RA", ok: bsk.hien === true, thay: `hien=${bsk.hien}` },
          { ten: "bang co it nhat 1 hang doc duoc", ok: (bsk.hang || []).length > 0, thay: `${(bsk.hang || []).length} hàng · "${(bsk.chu || "").slice(0, 160)}"` },
          { ten: "__demVien.tong > 0 (tap KHONG rong)", ok: (dv.tong || 0) > 0, thay: `tổng ${dv.tong}` },
          { ten: "so theo hang tren bang KHOP __demVien.theoHang", ok: Array.isArray(lech) && lech.length === 0, thay: `lệch ${JSON.stringify(lech)} · bảng ${JSON.stringify(hangBang)} · đếm ${JSON.stringify(dv.theoHang)}` },
        ]));
      KQ.P7 = r;
    } finally { await ctx.close(); }
    bao("P7", r.pq, r.vi); luu("P7", r);
  }

  /* ══ P8 — banner cắt tầng ═════════════════════════════════════════════ */
  if (chay("P8")) {
    const sql = sqlMo();
    const maxT = await sql`select b.ma, count(*)::int n from twin_tang t join twin_toa_nha b on b.id=t."toaNhaId" group by b.ma order by n desc limit 3`;
    const tongTangHe = Number((await sql`select count(*)::int n from twin_tang`)[0].n);
    await sql.end();
    const r = { ca: "P8", vai: "qatd_giamdoc", deBai: "nha may co 84 tang => banner-tang-vuot-tran hien va neu du 3 so (can/tran/thieu)",
      dienKien: { maxTangMoiToa: maxT.map((x) => `${x.ma}=${x.n}`), tongTangToanHe: tongTangHe, ghiChu: "dsTang cua /twin = tang cua MOT TOA (twinCanh.chiTietToaNha), khong phai cua ca nha may" } };
    const t = MOC.tangDong;
    const { ctx, page } = await moTwin(browser, "qatd_giamdoc", `/twin?do=1&nm=${MOC.F["QATD-A"]}&toa=${t.toa_id}&tang=${t.tang_id}`);
    try {
      const d = await doc(page);
      r.anh = await anh(page, "P8-banner-tang");
      const b = d.banner["banner-tang-vuot-tran"];
      r.thay = { coPhanTu: !!b, hien: b ? b.hien : false, chu: b ? b.chu : null, dataPhu: b ? b.dataPhu : null, soTangCuaToaDangXem: MOC.soTangTheoToa[t.toa_ma] };
      const tongTang = b ? Number(b.dataPhu["data-tong-tang"]) : NaN;
      const tranTang = b ? Number(b.dataPhu["data-tran-tang"]) : NaN;
      const biCat = b ? Number(b.dataPhu["data-tang-bi-cat"]) : NaN;
      if (!b) Object.assign(r, { pq: "HỎNG", vi: "thiếu dữ kiện: phần tử banner-tang-vuot-tran KHÔNG có trong DOM (không đọc được ba con số)" });
      else if (biCat === 0) Object.assign(r, { pq: "N/A", vi: `KHÔNG dựng được ca: toà nhiều tầng nhất chỉ có ${Math.max(...maxT.map((x) => x.n))} tầng, trần một lượt nạp = ${tranTang} ⇒ data-tang-bi-cat=0, banner ĐÚNG khi ẩn. Ba con số ĐỌC ĐƯỢC trên DOM: cần ${tongTang} / trần ${tranTang} / thiếu ${biCat}. Điều kiện đo lại: MỘT TOÀ có > ${tranTang} tầng (bộ sinh nay 7 tầng/toà × 12 toà = ${tongTangHe} tầng toàn hệ, nhưng /twin chỉ hỏi tầng của MỘT toà).` });
      else Object.assign(r, phan(
        { "data-tong-tang": tongTang, "data-tran-tang": tranTang, "data-tang-bi-cat": biCat, "chu banner": b.chu },
        [
          { ten: "banner HIEN", ok: b.hien === true, thay: `${b.hien}` },
          { ten: "chu neu du BA con so", ok: [tongTang, tranTang, biCat].every((n) => Number.isFinite(n) && b.chu.includes(String(n))), thay: `"${b.chu}"` },
        ]));
      KQ.P8 = r;
    } finally { await ctx.close(); }
    bao("P8", r.pq, r.vi); luu("P8", r);
  }

} finally { await browser.close(); }
console.log("\n=== TOM TAT P ===");
for (const [k, v] of Object.entries(KQ)) console.log(` ${k}: ${v.pq}`);
