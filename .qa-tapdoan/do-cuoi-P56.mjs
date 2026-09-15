/** NGHIỆM-THU CUỐI — P5 (báo sự cố) và P6 (ghi chú).
 *  node .qa-tapdoan/do-cuoi-P56.mjs --ca=P5|P5b|P6|all
 *  Mọi hàng TẠM đều đếm trước/sau và XOÁ. Quyền tạm (P5b) khôi phục về đúng giá trị cũ.
 */
import { chromium } from "@playwright/test";
import { arg, BASE, LAUNCH, MOC, sqlMo, luu, bao, phan, dangNhapCtx, anh, choCanh } from "./lib-cuoi.mjs";

const CA = arg("ca", "all");
const chay = (c) => CA === "all" || CA === c;
const DAU = `QATD-TMP-${Date.now()}`;
const KQ = {};

const DOC_NGAN = () => {
  const el = (t) => document.querySelector(`[data-testid="${t}"]`);
  const chu = (t) => { const e = el(t); return e ? (e.innerText || e.textContent || "").replace(/\s+/g, " ").trim() : null; };
  const dem = (t) => document.querySelectorAll(`[data-testid="${t}"]`).length;
  const n = el("ngan-xu-ly");
  return {
    url: location.pathname + location.search,
    coNgan: dem("ngan-xu-ly"), chuaChon: dem("ngan-chua-chon"),
    maMay: chu("ngan-ma-may"), trangThai: chu("ngan-trang-thai"),
    nutBaoSuCo: dem("nut-bao-su-co"), nutBaoSuCoTat: el("nut-bao-su-co") ? el("nut-bao-su-co").disabled === true : null,
    nutGhiChu: dem("nut-ghi-chu"), nutGhiChuTat: el("nut-ghi-chu") ? el("nut-ghi-chu").disabled === true : null,
    nutAck: dem("nut-ack"), nutAnTam: dem("nut-an-tam"), nutTaoPhieu: dem("nut-tao-phieu"),
    formBaoSuCo: dem("form-bao-su-co"), nutGuiSuCo: dem("nut-gui-su-co"), baoSuCoPhamVi: chu("bao-su-co-pham-vi"),
    formGhiChu: dem("form-ghi-chu"), nutGuiGhiChu: dem("nut-gui-ghi-chu"), ghiChuCho: chu("ghi-chu-cho"),
    ghiChuTrong: dem("ghi-chu-trong"), ghiChuKhongDong: chu("ghi-chu-khong-dong"),
    soGhiChuTrenMan: document.querySelectorAll('[data-testid^="ghi-chu-"]').length,
    khongCanhBao: dem("ngan-khong-canh-bao"),
    chuNgan: n ? (n.innerText || "").replace(/\s+/g, " ").trim().slice(0, 600) : null,
    toast: [...document.querySelectorAll("[data-sonner-toast], [role='status'], li[data-sonner-toast]")].map((e) => (e.innerText || "").replace(/\s+/g, " ").trim()).slice(0, 4),
  };
};

async function moChonMay(browser, vai, mayId, nm, toa, tang) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await dangNhapCtx(ctx, vai);
  const page = await ctx.newPage();
  const url = `${BASE}/twin?do=1&nm=${nm}&toa=${toa}&tang=${tang}&chon=machine:${mayId}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector('[data-testid="man-twin-van-hanh"]', { timeout: 90_000 }).catch(() => {});
  await choCanh(page, 0);
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="ngan-ma-may"]').length > 0, null, { timeout: 45_000 }).catch(() => {});
  return { ctx, page, url };
}

const sql = sqlMo();
const demAndon = async () => Number((await sql`select count(*)::int n from andon_events`)[0].n);
const demGhiChu = async () => Number((await sql`select count(*)::int n from andon_notes`)[0].n);

const browser = await chromium.launch(LAUNCH);
try {
  /* vị trí máy để deep-link */
  const viTri = async (mayId) => (await sql`select t.id tang_id, b.id toa_id, f.id nm, f.code fcode, m.code may
    from twin_dat_cho d join twin_tang t on t.id=d."tangId" join twin_toa_nha b on b.id=t."toaNhaId"
    join factories f on f.id=b."factoryId" join machines m on m.id=d."thucTheId"
    where d."loaiThucThe"='machine' and d."thucTheId"=${mayId} limit 1`)[0];

  /* ══ P5 — trạng thái NHƯ ĐANG CÓ ════════════════════════════════════ */
  if (chay("P5")) {
    const mayC = MOC.mayC[0];
    const v = await viTri(mayC.id);
    const r = { ca: "P5", deBai: "cong nhan chon may => thay nut bao su co; giam doc (andon chi xem) => KHONG thay", mayDo: { ...mayC, viTri: v } };
    const q = await sql`select u.username, p."canView", p."canCreate", p."canEdit" from permissions p join users u on u.id=p."userId"
      where u.username in ('qatd_congnhan','qatd_giamdoc') and p."moduleName"='andon' order by u.username`;
    r.quyenAndonTrongDb = q.map((x) => `${x.username}: V=${x.canView ? 1 : 0} C=${x.canCreate ? 1 : 0} E=${x.canEdit ? 1 : 0}`);
    const A = await moChonMay(browser, "qatd_congnhan", mayC.id, v.nm, v.toa_id, v.tang_id);
    const dA = await A.page.evaluate(DOC_NGAN); r.anhCongNhan = await anh(A.page, "P5-congnhan-chon-may"); await A.ctx.close();
    const B = await moChonMay(browser, "qatd_giamdoc", mayC.id, v.nm, v.toa_id, v.tang_id);
    const dB = await B.page.evaluate(DOC_NGAN); r.anhGiamDoc = await anh(B.page, "P5-giamdoc-chon-may"); await B.ctx.close();
    r.thay = { congnhan: dA, giamdoc: dB };
    Object.assign(r, phan(
      { "ngan-ma-may (cong nhan)": dA.maMay, "ngan-ma-may (giam doc)": dB.maMay },
      [
        { ten: "cong nhan THAY nut bao su co", ok: dA.nutBaoSuCo === 1, thay: `${dA.nutBaoSuCo} nút (quyền andon.canCreate của qatd_congnhan trong DB = ${r.quyenAndonTrongDb.join(" | ")})` },
        { ten: "giam doc KHONG thay nut bao su co", ok: dB.nutBaoSuCo === 0, thay: `${dB.nutBaoSuCo} nút` },
        { ten: "giam doc KHONG thay nut ghi chu (chi xem)", ok: dB.nutGhiChu === 0, thay: `${dB.nutGhiChu} nút` },
      ]));
    KQ.P5 = r; bao("P5", r.pq, r.vi); luu("P5", r);
  }

  /* ══ P5b — MỞ CỔNG TẠM rồi đo cả hai chiều + ghi thật + dọn ═════════ */
  if (chay("P5b")) {
    const mayC = MOC.mayC[0];
    const v = await viTri(mayC.id);
    const r = { ca: "P5b", deBai: "ablation cong quyen: bat andon.canCreate cho qatd_congnhan => nut bao su co HIEN, bam gui => hang MOI trong andon_events dung may QATD-C; roi xoa hang + tra quyen ve cu", mayDo: { ...mayC, viTri: v } };
    let uid = null, cuCanCreate = null, andonMoi = [];
    try {
      const [u] = await sql`select id from users where username='qatd_congnhan'`;
      uid = Number(u.id);
      const [p0] = await sql`select "canCreate" from permissions where "userId"=${uid} and "moduleName"='andon'`;
      cuCanCreate = p0.canCreate;
      r.demTruoc = { andon: await demAndon(), quyenCanCreateCu: cuCanCreate };
      await sql`update permissions set "canCreate"=true where "userId"=${uid} and "moduleName"='andon'`;
      r.daMoCong = Number((await sql`select count(*)::int n from permissions where "userId"=${uid} and "moduleName"='andon' and "canCreate"=true`)[0].n);

      const A = await moChonMay(browser, "qatd_congnhan", mayC.id, v.nm, v.toa_id, v.tang_id);
      const d1 = await A.page.evaluate(DOC_NGAN);
      r.anhTruocBam = await anh(A.page, "P5b-nut-hien");
      let d2 = null, d3 = null;
      if (d1.nutBaoSuCo === 1 && d1.nutBaoSuCoTat === false) {
        await A.page.locator('[data-testid="nut-bao-su-co"]').click();
        await A.page.waitForSelector('[data-testid="form-bao-su-co"]', { timeout: 15_000 }).catch(() => {});
        await A.page.locator('[data-testid="o-mo-ta-su-co"]').fill(`${DAU} do nghiem thu P5b`).catch(() => {});
        d2 = await A.page.evaluate(DOC_NGAN);
        r.anhForm = await anh(A.page, "P5b-form-mo");
        const truocGui = await demAndon();
        await A.page.locator('[data-testid="nut-gui-su-co"]').click();
        await A.page.waitForFunction(() => !document.querySelector('[data-testid="form-bao-su-co"]'), null, { timeout: 45_000 }).catch(() => {});
        // chờ hàng thật xuất hiện trong DB (tín hiệu, không phải hạn cố định)
        for (let i = 0; i < 60; i += 1) { if ((await demAndon()) > truocGui) break; await new Promise((s) => setTimeout(s, 500)); }
        d3 = await A.page.evaluate(DOC_NGAN);
        r.anhSauGui = await anh(A.page, "P5b-sau-gui");
        r.demSauGui = await demAndon();
        andonMoi = await sql`select a.id, a.status, a.state, a.reason, a.title, a.message, a."machineId", a."raisedBy", a."raisedBySystem", a."raisedAt", m.code may, f.code fcode
          from andon_events a left join machines m on m.id=a."machineId" left join stations s on s.id=m."stationId"
          left join production_lines l on l.id=s."lineId" left join workshops w on w.id=l."workshopId" left join factories f on f.id=w."factoryId"
          where a."raisedBy"=${uid} order by a.id desc limit 5`;
      }
      await A.ctx.close();
      r.thay = { truocBam: d1, sauMoForm: d2, sauGui: d3, hangMoi: andonMoi };
      Object.assign(r, phan(
        { "nut-bao-su-co khi co canCreate": d1.nutBaoSuCo, "so hang moi": andonMoi.length === 0 ? null : andonMoi.length },
        [
          { ten: "mo cong => nut bao su co HIEN va BAM DUOC", ok: d1.nutBaoSuCo === 1 && d1.nutBaoSuCoTat === false, thay: `hiện ${d1.nutBaoSuCo} · disabled=${d1.nutBaoSuCoTat}` },
          { ten: "form khai DUNG may dich", ok: !!d2 && !!d2.baoSuCoPhamVi && d2.baoSuCoPhamVi.includes(mayC.code), thay: `"${d2 ? d2.baoSuCoPhamVi : null}"` },
          { ten: "gui => DUNG MOT hang moi trong andon_events", ok: andonMoi.length === 1 && r.demSauGui === r.demTruoc.andon + 1, thay: `${andonMoi.length} hàng của người này · đếm ${r.demTruoc.andon}→${r.demSauGui}` },
          { ten: "hang moi gan dung MAY cua QATD-C", ok: andonMoi.length === 1 && Number(andonMoi[0].machineId) === mayC.id && andonMoi[0].fcode === "QATD-C", thay: andonMoi.length ? `machineId=${andonMoi[0].machineId} (${andonMoi[0].may}) nhà máy ${andonMoi[0].fcode}` : "—" },
          { ten: "hang moi la NGUOI bao (raisedBySystem=false)", ok: andonMoi.length === 1 && andonMoi[0].raisedBySystem === false, thay: andonMoi.length ? `${andonMoi[0].raisedBySystem}` : "—" },
        ]));
    } catch (e) { r.pq = "HỎNG"; r.vi = `lỗi khi đo: ${String(e.message).slice(0, 300)}`; }
    finally {
      const ids = andonMoi.map((x) => Number(x.id));
      const xoa = ids.length ? await sql`delete from andon_events where id = any(${ids})` : { count: 0 };
      if (uid != null && cuCanCreate != null) await sql`update permissions set "canCreate"=${cuCanCreate} where "userId"=${uid} and "moduleName"='andon'`;
      const [pSau] = uid != null ? await sql`select "canCreate" from permissions where "userId"=${uid} and "moduleName"='andon'` : [{}];
      r.don = { xoaAndon: xoa.count, idsDaXoa: ids, quyenTraVe: pSau ? pSau.canCreate : null, demAndonSauDon: await demAndon() };
      r.donSach = r.demTruoc && r.don.demAndonSauDon === r.demTruoc.andon && r.don.quyenTraVe === cuCanCreate;
      console.log(`  DỌN P5b: xoá ${xoa.count} andon · quyền canCreate trả về ${r.don.quyenTraVe} (cũ ${cuCanCreate}) · đếm andon ${r.demTruoc ? r.demTruoc.andon : "?"}→${r.don.demAndonSauDon} · sạch=${r.donSach}`);
      KQ.P5b = r; bao("P5b", r.pq, r.vi); luu("P5b", r);
    }
  }

  /* ══ P6 — ghi chú: hàng mới trong andon_notes, andon_events KHÔNG đổi ═ */
  if (chay("P6")) {
    const a = MOC.andonA[0];
    const v = await viTri(a.machineId);
    const r = { ca: "P6", vai: "qatd_kythuat", deBai: `ky thuat mo canh bao cua may ${a.may} (andon ${a.id}) va ghi MOT ghi chu => hang moi trong andon_notes VA hang andon_events KHONG doi (status/message/resolvedAt)`, andonDo: a, viTri: v };
    let ghiMoi = [];
    try {
      if (!v) throw new Error(`THIEU DU KIEN: may ${a.machineId} (${a.may}) KHONG co hang twin_dat_cho nen khong deep-link chon duoc`);
      const truocEvt = (await sql`select id, status, message, "resolvedAt", "acknowledgedAt", state, reason, title from andon_events where "machineId"=${a.machineId} order by id`);
      r.demTruoc = { ghiChu: await demGhiChu(), andon: await demAndon(), evtCuaMay: truocEvt };
      const A = await moChonMay(browser, "qatd_kythuat", a.machineId, v.nm, v.toa_id, v.tang_id);
      const d1 = await A.page.evaluate(DOC_NGAN);
      r.anhTruoc = await anh(A.page, "P6-truoc-ghi-chu");
      let d2 = null, d3 = null;
      if (d1.nutGhiChu === 1 && d1.nutGhiChuTat === false) {
        await A.page.locator('[data-testid="nut-ghi-chu"]').click();
        await A.page.waitForSelector('[data-testid="form-ghi-chu"]', { timeout: 15_000 }).catch(() => {});
        d2 = await A.page.evaluate(DOC_NGAN);
        await A.page.locator('[data-testid="o-ghi-chu"]').fill(`${DAU} da kiem cam bien vao, chua thay loi`);
        r.anhForm = await anh(A.page, "P6-form-ghi-chu");
        const truocGhi = await demGhiChu();
        await A.page.locator('[data-testid="nut-gui-ghi-chu"]').click();
        for (let i = 0; i < 60; i += 1) { if ((await demGhiChu()) > truocGhi) break; await new Promise((s) => setTimeout(s, 500)); }
        await A.page.waitForFunction(() => document.querySelectorAll('[data-testid^="ghi-chu-"]').length > 0, null, { timeout: 20_000 }).catch(() => {});
        d3 = await A.page.evaluate(DOC_NGAN);
        r.anhSau = await anh(A.page, "P6-sau-ghi-chu");
        ghiMoi = await sql`select g.id, g."andonId", g.note, g."createdBy", g."createdAt", u.username
          from andon_notes g left join users u on u.id=g."createdBy" where g.note like ${DAU + "%"} order by g.id desc`;
      }
      await A.ctx.close();
      const sauEvt = await sql`select id, status, message, "resolvedAt", "acknowledgedAt", state, reason, title from andon_events where "machineId"=${a.machineId} order by id`;
      r.thay = { truocMo: d1, sauMoForm: d2, sauGui: d3, ghiChuMoi: ghiMoi, evtTruoc: r.demTruoc.evtCuaMay, evtSau: sauEvt, demGhiChuSau: await demGhiChu(), demAndonSau: await demAndon() };
      const khongDoi = JSON.stringify(r.demTruoc.evtCuaMay) === JSON.stringify(sauEvt);
      const gc = ghiMoi[0];
      Object.assign(r, phan(
        { "nut-ghi-chu": d1.nutGhiChu, "form-ghi-chu": d2 ? d2.formGhiChu : null, "so ghi chu moi": ghiMoi.length === 0 ? null : ghiMoi.length },
        [
          { ten: "ky thuat THAY nut ghi chu va bam duoc", ok: d1.nutGhiChu === 1 && d1.nutGhiChuTat === false, thay: `hiện ${d1.nutGhiChu} · disabled=${d1.nutGhiChuTat}` },
          { ten: "form neu DICH la mot canh bao cu the", ok: !!d2 && !!d2.ghiChuCho && d2.ghiChuCho.length > 5, thay: `"${d2 ? d2.ghiChuCho : null}"` },
          { ten: "DUNG MOT hang moi trong andon_notes", ok: ghiMoi.length === 1 && r.thay.demGhiChuSau === r.demTruoc.ghiChu + 1, thay: `${ghiMoi.length} hàng · đếm ${r.demTruoc.ghiChu}→${r.thay.demGhiChuSau}` },
          { ten: "hang ghi chu gan dung tac gia qatd_kythuat", ok: !!gc && gc.username === "qatd_kythuat", thay: gc ? `${gc.username} (id ${gc.createdBy}) andonId=${gc.andonId}` : "—" },
          { ten: "andon_events CUA MAY KHONG doi mot cot nao", ok: khongDoi, thay: khongDoi ? "ok" : `trước ${JSON.stringify(r.demTruoc.evtCuaMay)} · sau ${JSON.stringify(sauEvt)}` },
          { ten: "tong andon_events KHONG tang", ok: r.thay.demAndonSau === r.demTruoc.andon, thay: `${r.demTruoc.andon}→${r.thay.demAndonSau}` },
          { ten: "man hien cau 'ghi chu KHONG dong canh bao'", ok: !!d2 && !!d2.ghiChuKhongDong, thay: `"${d2 ? d2.ghiChuKhongDong : null}"` },
          { ten: "ghi chu HIEN LAI tren man sau khi luu", ok: !!d3 && d3.soGhiChuTrenMan > 0, thay: `${d3 ? d3.soGhiChuTrenMan : null} dòng` },
        ]));
    } catch (e) { r.pq = "HỎNG"; r.vi = `lỗi khi đo: ${String(e.message).slice(0, 300)}`; }
    finally {
      const xoa = await sql`delete from andon_notes where note like ${DAU + "%"}`;
      r.don = { xoaGhiChu: xoa.count, demGhiChuSauDon: await demGhiChu(), demAndonSauDon: await demAndon() };
      r.donSach = r.demTruoc && r.don.demGhiChuSauDon === r.demTruoc.ghiChu && r.don.demAndonSauDon === r.demTruoc.andon;
      console.log(`  DỌN P6: xoá ${xoa.count} ghi chú · đếm ghi chú ${r.demTruoc ? r.demTruoc.ghiChu : "?"}→${r.don.demGhiChuSauDon} · andon ${r.demTruoc ? r.demTruoc.andon : "?"}→${r.don.demAndonSauDon} · sạch=${r.donSach}`);
      KQ.P6 = r; bao("P6", r.pq, r.vi); luu("P6", r);
    }
  }
} finally { await browser.close(); await sql.end(); }
console.log("\n=== TOM TAT ===");
for (const [k, v] of Object.entries(KQ)) console.log(` ${k}: ${v.pq}`);
