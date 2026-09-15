/** H3b — đếm ĐÚNG số hàng của nhóm TỒN ĐỌNG và của danh sách máy ở hai bề rộng.
 *  `nhom-ton-dong` là thẻ TIÊU ĐỀ, hàng nằm ở `<ul>` ANH EM và mang `data-ton-dong`
 *  — H3 đếm trong lòng tiêu đề nên ra 0. Ca này đếm theo thuộc tính hàng, và kiểm
 *  luôn CSDL xem có cảnh báo nào quá 24 h để nhóm ấy tồn tại hay không.
 */
import { chromium } from "@playwright/test";
import { BASE, LAUNCH, MOC, sqlMo, luu, bao, phan, layCookie, anh, choCanh } from "./lib-cuoi.mjs";

const sql = sqlMo();
const td = MOC.tangDong;
const DUONG = `/twin?do=1&nm=${MOC.F["QATD-A"]}&toa=${td.toa_id}&tang=${td.tang_id}`;
const r = { ca: "H3b", vai: "qatd_kythuat", duong: DUONG, deBai: "dem DUNG so hang nhom ton dong (data-ton-dong) va so hang danh-sach-may THAY DUOC o 1280x720 va 1600x900" };
const browser = await chromium.launch(LAUNCH);
try {
  r.csdl = (await sql`select count(*)::int tong,
      count(*) filter (where a."resolvedAt" is null)::int dang_mo,
      count(*) filter (where a."resolvedAt" is null and a."raisedAt" < now() - interval '24 hours')::int qua_24h,
      min(a."raisedAt") som_nhat, max(a."raisedAt") muon_nhat
    from andon_events a`)[0];
  const ck = await layCookie(browser, "qatd_kythuat");
  r.do = {};
  for (const [w, h] of [[1280, 720], [1600, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    await ctx.addCookies(ck);
    const page = await ctx.newPage();
    await page.goto(`${BASE}${DUONG}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForSelector('[data-testid="man-twin-van-hanh"]', { timeout: 90_000 }).catch(() => {});
    await choCanh(page, 0);
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="dai-canh-bao"] [data-ma-may]').length > 0 || !!document.querySelector('[data-testid="dai-trong"]'), null, { timeout: 45_000 }).catch(() => {});
    await page.waitForFunction(() => document.querySelectorAll('[data-testid^="may-hang-"]').length > 0, null, { timeout: 45_000 }).catch(() => {});
    const d = await page.evaluate(() => {
      const el = (t) => document.querySelector(`[data-testid="${t}"]`);
      const H = (e) => (e ? Number(e.getBoundingClientRect().height.toFixed(2)) : null);
      const cuon = el("dai-canh-bao-cuon");
      const hang = [...document.querySelectorAll('[data-testid="dai-canh-bao"] [data-ma-may]')];
      const trongKhung = (e, khung) => { if (!khung) return null; const a = e.getBoundingClientRect(), b = khung.getBoundingClientRect(); return a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5; };
      const tonDong = hang.filter((e) => { const v = e.getAttribute("data-ton-dong"); return v === "1" || v === "true"; });
      const homNay = hang.filter((e) => { const v = e.getAttribute("data-ton-dong"); return !(v === "1" || v === "true"); });
      const ul = el("danh-sach-may") ? el("danh-sach-may").querySelector("ul[data-so-may]") : null;
      const hangMay = [...document.querySelectorAll('[data-testid^="may-hang-"]')];
      const tienTo = el("danh-sach-may-tien-to");
      return {
        vp: { w: innerWidth, h: innerHeight },
        coTieuDeTonDong: !!el("nhom-ton-dong"), chuTieuDeTonDong: el("nhom-ton-dong") ? el("nhom-ton-dong").textContent.trim() : null,
        coTieuDeHomNay: !!el("nhom-hom-nay"), chuTieuDeHomNay: el("nhom-hom-nay") ? el("nhom-hom-nay").textContent.trim() : null,
        soHangTong: hang.length, soHangTonDong: tonDong.length, soHangHomNay: homNay.length,
        tonDongThayDuoc: tonDong.filter((e) => trongKhung(e, cuon)).length,
        homNayThayDuoc: homNay.filter((e) => trongKhung(e, cuon)).length,
        caoHangCanhBao: hang.length ? Number(hang[0].getBoundingClientRect().height.toFixed(2)) : null,
        caoDaiCuon: H(cuon), caoDaiCanhBao: H(el("dai-canh-bao")),
        caoKhoiTongQuan: H(el("khoi-tong-quan")), caoHangTongQuan: H(el("hang-tong-quan")), caoBangSucKhoe: H(el("bang-suc-khoe")),
        caoPanelTrai: H(el("panel-trai")), caoDanhSachMay: H(el("danh-sach-may")), caoUl: H(ul), caoTienTo: H(tienTo),
        soHangMayVe: hangMay.length, soHangMayThayDuoc: hangMay.filter((e) => trongKhung(e, ul)).length,
        caoHangMay: hangMay.length ? Number(hangMay[0].getBoundingClientRect().height.toFixed(2)) : null,
        soMayTongDs: ul ? Number(ul.getAttribute("data-so-may")) : null,
      };
    });
    r.do[`${w}x${h}`] = d;
    r[`anh${w}`] = await anh(page, `H3b-${w}x${h}`);
    console.log(`  @${w}x${h}: khoi-tong-quan ${d.caoKhoiTongQuan} px · dải ${d.caoDaiCanhBao} (cuộn ${d.caoDaiCuon}) · tồn đọng ${d.soHangTonDong} hàng (${d.tonDongThayDuoc} thấy được) · hôm nay ${d.soHangHomNay} (${d.homNayThayDuoc} thấy được) · danh-sách-máy ${d.soHangMayThayDuoc}/${d.soHangMayVe} hàng · tiền tố ${d.caoTienTo} px`);
    await ctx.close();
  }
  const a = r.do["1280x720"], b = r.do["1600x900"];
  r.moHinh = { hangTrongLuoi: 41, uocChuaDo: 69, duDoan: { tonDong1280: "3 → 2", danhSachMay1600: "9 → 8" } };
  r.thay = {
    cao1280: a.caoKhoiTongQuan, cao1600: b.caoKhoiTongQuan,
    tonDong1280: a.soHangTonDong, tonDongThayDuoc1280: a.tonDongThayDuoc,
    tonDong1600: b.soHangTonDong, tonDongThayDuoc1600: b.tonDongThayDuoc,
    danhSachMayThayDuoc1280: a.soHangMayThayDuoc, danhSachMayThayDuoc1600: b.soHangMayThayDuoc,
    csdlAndonQua24h: Number(r.csdl.qua_24h), csdlAndonDangMo: Number(r.csdl.dang_mo),
  };
  Object.assign(r, phan(
    { "cao @1280": a.caoKhoiTongQuan, "cao @1600": b.caoKhoiTongQuan, "so hang canh bao @1280": a.soHangTong, "so hang may @1600": b.soHangMayVe },
    [
      { ten: "doc duoc chieu cao THAT o ca hai be rong", ok: a.caoKhoiTongQuan > 0 && b.caoKhoiTongQuan > 0, thay: `${a.caoKhoiTongQuan} / ${b.caoKhoiTongQuan}` },
      { ten: "chieu cao KHAC hang 41 (hang da lac thuc te)", ok: Math.abs(a.caoKhoiTongQuan - 41) > 1 && Math.abs(b.caoKhoiTongQuan - 41) > 1, thay: `${a.caoKhoiTongQuan} / ${b.caoKhoiTongQuan} vs hằng 41` },
      { ten: "dem duoc so hang danh-sach-may THAY DUOC o ca hai be rong", ok: a.soHangMayThayDuoc > 0 && b.soHangMayThayDuoc > 0, thay: `@1280 ${a.soHangMayThayDuoc} · @1600 ${b.soHangMayThayDuoc}` },
      { ten: "nhom TON DONG co ton tai de dem (CSDL co andon qua 24h)", ok: Number(r.csdl.qua_24h) > 0, thay: `CSDL: ${r.csdl.qua_24h} andon mở quá 24 h / ${r.csdl.dang_mo} đang mở · sớm nhất ${r.csdl.som_nhat} · dải khai tiêu đề tồn đọng = ${a.coTieuDeTonDong}` },
    ]));
  bao("H3b", r.pq, r.vi); luu("H3b", r);
} catch (e) { r.pq = "HỎNG"; r.vi = `lỗi khi đo: ${String(e.message).slice(0, 300)}`; bao("H3b", r.pq, r.vi); luu("H3b", r); }
finally { await browser.close(); await sql.end(); }
