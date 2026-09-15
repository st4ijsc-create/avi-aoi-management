/** NGHIỆM-THU CUỐI — PHẦN 2: đối chứng âm N1..N6 phải GIỮ NGUYÊN.
 *  node .qa-tapdoan/do-cuoi-N.mjs --ca=N1|N2|N3|N4|N5|N6|all
 *  Mọi ca ghi đều đếm andon_events / andon_notes trước và sau.
 */
import { chromium } from "@playwright/test";
import { arg, BASE, LAUNCH, MOC, sqlMo, luu, bao, phan, dangNhapCtx, trpcPost, trpcGet, anh, choCanh } from "./lib-cuoi.mjs";

const CA = arg("ca", "all");
const chay = (c) => CA === "all" || CA === c;
const KQ = {};
const CHAN = ["FORBIDDEN", "NOT_FOUND", "UNAUTHORIZED"];

const sql = sqlMo();
const demAndon = async () => Number((await sql`select count(*)::int n from andon_events`)[0].n);
const demGhiChu = async () => Number((await sql`select count(*)::int n from andon_notes`)[0].n);

const browser = await chromium.launch(LAUNCH);
try {
  /* ══ N1 — công nhân mở máy của QATD-B trên màn ════════════════════════ */
  if (chay("N1")) {
    const m = MOC.mayB[0];
    const r = { ca: "N1", vai: "qatd_congnhan", deBai: `cong nhan (gan QATD-C) mo /twin/may/${m.id} (${m.code}, QATD-B) => PHAI van bi tu choi` };
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    await dangNhapCtx(ctx, "qatd_congnhan");
    const page = await ctx.newPage();
    await page.goto(`${BASE}/twin/may/${m.id}?do=1`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForSelector('[data-testid="man-twin-may"]', { timeout: 60_000 }).catch(() => {});
    await page.waitForFunction(() => !!document.querySelector('[data-testid="may-khong-mo-duoc"]') || !!document.querySelector('[data-testid="ten-may"]'), null, { timeout: 45_000 }).catch(() => {});
    const d = await page.evaluate(() => {
      const el = (t) => document.querySelector(`[data-testid="${t}"]`);
      const chu = (t) => { const e = el(t); return e ? (e.innerText || e.textContent || "").replace(/\s+/g, " ").trim() : null; };
      return { tuChoi: !!el("may-khong-mo-duoc"), lyDo: el("may-khong-mo-duoc") ? el("may-khong-mo-duoc").getAttribute("data-ly-do") : null,
        chuTuChoi: chu("may-khong-mo-duoc"), tenMay: chu("ten-may"), loaiMay: chu("loai-may"), sucKhoe: chu("suc-khoe-may"),
        than: (document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 300) };
    });
    r.anh = await anh(page, "N1-congnhan-may-QATD-B");
    await ctx.close();
    // đối chứng DƯƠNG: cùng vai mở máy QATD-C phải MỞ ĐƯỢC
    const mC = MOC.mayC[0];
    const ctx2 = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    await dangNhapCtx(ctx2, "qatd_congnhan");
    const p2 = await ctx2.newPage();
    await p2.goto(`${BASE}/twin/may/${mC.id}?do=1`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await p2.waitForSelector('[data-testid="man-twin-may"]', { timeout: 60_000 }).catch(() => {});
    await p2.waitForFunction(() => !!document.querySelector('[data-testid="may-khong-mo-duoc"]') || !!document.querySelector('[data-testid="ten-may"]'), null, { timeout: 45_000 }).catch(() => {});
    const dP = await p2.evaluate(() => { const el = (t) => document.querySelector(`[data-testid="${t}"]`); return { tuChoi: !!el("may-khong-mo-duoc"), tenMay: el("ten-may") ? el("ten-may").textContent.trim() : null }; });
    r.anhDoiChungDuong = await anh(p2, "N1-congnhan-may-QATD-C-duong");
    await ctx2.close();
    r.thay = { ngoaiPhamVi: d, trongPhamVi: dP };
    Object.assign(r, phan(
      { "man may (QATD-B)": d.than ? 1 : null },
      [
        { ten: "QATD-B: man TU CHOI (may-khong-mo-duoc)", ok: d.tuChoi === true, thay: `tuChoi=${d.tuChoi} lyDo=${d.lyDo} · "${(d.chuTuChoi || "").slice(0, 120)}"` },
        { ten: "QATD-B: KHONG lo ten may cua tenant khac", ok: !d.tenMay || !d.tenMay.includes("QATD-B"), thay: `ten-may=${JSON.stringify(d.tenMay)}` },
        { ten: "doi chung DUONG: cung vai mo may QATD-C thi MO DUOC", ok: dP.tuChoi === false && !!dP.tenMay, thay: `tuChoi=${dP.tuChoi} ten=${JSON.stringify(dP.tenMay)}` },
      ]));
    KQ.N1 = r; bao("N1", r.pq, r.vi); luu("N1", r);
  }

  /* ══ N2 — andon.raise / quickReport nhắm máy QATD-B ═══════════════════ */
  if (chay("N2")) {
    const m = MOC.mayB[0], mC = MOC.mayC[0];
    const r = { ca: "N2", vai: "qatd_congnhan", deBai: `cookie cong nhan goi andon.raise + andon.quickReport nham may QATD-B (${m.id}/${m.code}) => NOT_FOUND va dem andon_events KHONG tang` };
    const ctx = await browser.newContext();
    await dangNhapCtx(ctx, "qatd_congnhan");
    r.demTruoc = await demAndon();
    const raise = await trpcPost(ctx, "andon.raise", { state: "yellow", reason: "other", title: "QATD-TMP N2 xuyen tenant", machineId: m.id });
    const quick = await trpcPost(ctx, "andon.quickReport", { machineId: m.id, description: "QATD-TMP N2 xuyen tenant" });
    const quickMa = await trpcPost(ctx, "andon.quickReport", { machineCode: m.code, description: "QATD-TMP N2 xuyen tenant theo MA" });
    // trục trạm/chuyền của tenant khác
    const tram = (await sql`select s.id from stations s join production_lines l on l.id=s."lineId" join workshops w on w.id=l."workshopId" join factories f on f.id=w."factoryId" where f.code='QATD-B' limit 1`)[0];
    const raiseTram = await trpcPost(ctx, "andon.raise", { state: "yellow", reason: "other", title: "QATD-TMP N2 tram B", stationId: Number(tram.id) });
    r.demSau = await demAndon();
    const dauVet = await sql`select id, title, "machineId" from andon_events where title like 'QATD-TMP%' order by id desc limit 5`;
    await ctx.close();
    r.thay = { raise, quick, quickTheoMa: quickMa, raiseTheoTram: raiseTram, demTruoc: r.demTruoc, demSau: r.demSau, dauVetConLai: dauVet };
    Object.assign(r, phan(
      { "ma loi raise": raise.ma || raise.http, "ma loi quickReport": quick.ma || quick.http, "dem andon truoc": r.demTruoc, "dem andon sau": r.demSau },
      [
        { ten: "andon.raise (machineId B) => NOT_FOUND", ok: raise.ma === "NOT_FOUND", thay: `${raise.ma} http=${raise.http} "${raise.loi}"` },
        { ten: "andon.quickReport (machineId B) => NOT_FOUND", ok: quick.ma === "NOT_FOUND", thay: `${quick.ma} http=${quick.http} "${quick.loi}"` },
        { ten: "andon.quickReport (machineCode B) => bi chan", ok: CHAN.includes(quickMa.ma), thay: `${quickMa.ma} http=${quickMa.http} "${quickMa.loi}"` },
        { ten: "andon.raise (stationId B) => bi chan", ok: CHAN.includes(raiseTram.ma), thay: `${raiseTram.ma} http=${raiseTram.http} "${raiseTram.loi}"` },
        { ten: "dem andon_events KHONG tang", ok: r.demSau === r.demTruoc, thay: `${r.demTruoc}→${r.demSau}` },
        { ten: "KHONG con dau vet hang QATD-TMP nao", ok: dauVet.length === 0, thay: `${dauVet.length} hàng: ${JSON.stringify(dauVet)}` },
      ]));
    KQ.N2 = r; bao("N2", r.pq, r.vi); luu("N2", r);
  }

  /* ══ N3 — andon.ghiChu / danhSachGhiChu ngoài phạm vi ═════════════════ */
  if (chay("N3")) {
    const aNgoai = MOC.andonC[0], aTrong = MOC.andonA[0];
    const r = { ca: "N3", vai: "qatd_kythuat", deBai: `ky thuat (A+B) goi andon.ghiChu + danhSachGhiChu tren canh bao ${aNgoai.id} cua QATD-C => bi chan; dem andon_notes KHONG tang` };
    const ctx = await browser.newContext();
    await dangNhapCtx(ctx, "qatd_kythuat");
    r.demTruoc = await demGhiChu();
    const ghi = await trpcPost(ctx, "andon.ghiChu", { id: aNgoai.id, note: "QATD-TMP N3 xuyen tenant" });
    const ds = await trpcGet(ctx, "andon.danhSachGhiChu", { id: aNgoai.id, limit: 10 });
    const ghiKhongCo = await trpcPost(ctx, "andon.ghiChu", { id: 2_000_000_000, note: "QATD-TMP N3 khong co" });
    const dsTrong = await trpcGet(ctx, "andon.danhSachGhiChu", { id: aTrong.id, limit: 10 });
    r.demSau = await demGhiChu();
    const dauVet = await sql`select id, "andonId", note from andon_notes where note like 'QATD-TMP%' order by id desc limit 5`;
    await ctx.close();
    r.thay = { ghiChuNgoai: ghi, danhSachNgoai: ds, ghiChuIdKhongTonTai: ghiKhongCo, danhSachTrongPhamVi: dsTrong, demTruoc: r.demTruoc, demSau: r.demSau, dauVetConLai: dauVet };
    Object.assign(r, phan(
      { "ma loi ghiChu ngoai": ghi.ma || ghi.http, "ma loi danhSachGhiChu ngoai": ds.ma || ds.http, "dem ghi chu truoc": r.demTruoc, "dem ghi chu sau": r.demSau },
      [
        { ten: "andon.ghiChu (canh bao QATD-C) => bi chan", ok: CHAN.includes(ghi.ma), thay: `${ghi.ma} http=${ghi.http} "${ghi.loi}"` },
        { ten: "andon.danhSachGhiChu (canh bao QATD-C) => bi chan, KHONG tra noi dung", ok: CHAN.includes(ds.ma) && ds.data === null, thay: `${ds.ma} http=${ds.http} data=${JSON.stringify(ds.data)}` },
        { ten: "andon.ghiChu (id khong ton tai) => bi chan", ok: CHAN.includes(ghiKhongCo.ma), thay: `${ghiKhongCo.ma} "${ghiKhongCo.loi}"` },
        { ten: "doi chung DUONG: danhSachGhiChu canh bao QATD-A => 200", ok: dsTrong.http === 200 && Array.isArray(dsTrong.data), thay: `http=${dsTrong.http} data=${Array.isArray(dsTrong.data) ? dsTrong.data.length + " dòng" : JSON.stringify(dsTrong.data)}` },
        { ten: "dem andon_notes KHONG tang", ok: r.demSau === r.demTruoc, thay: `${r.demTruoc}→${r.demSau}` },
        { ten: "KHONG con dau vet ghi chu QATD-TMP", ok: dauVet.length === 0, thay: `${dauVet.length} hàng` },
      ]));
    KQ.N3 = r; bao("N3", r.pq, r.vi); luu("N3", r);
  }

  /* ══ N4 — qatd_khongquyen gọi factory.list ════════════════════════════ */
  if (chay("N4")) {
    const r = { ca: "N4", vai: "qatd_khongquyen", deBai: "qatd_khongquyen (0 quyen, co gan QATD-A) goi factory.list => PHAI bi chan (truoc day tra 1 nha may)" };
    const ctx = await browser.newContext();
    await dangNhapCtx(ctx, "qatd_khongquyen");
    const g = await trpcGet(ctx, "factory.list", undefined);
    await ctx.close();
    const ctx2 = await browser.newContext();
    await dangNhapCtx(ctx2, "qatd_kythuat");
    const gD = await trpcGet(ctx2, "factory.list", undefined);
    await ctx2.close();
    r.thay = { khongQuyen: { http: g.http, ma: g.ma, loi: g.loi, soNhaMay: Array.isArray(g.data) ? g.data.length : null, data: Array.isArray(g.data) ? g.data.map((x) => x.code) : g.data },
      doiChungDuongKyThuat: { http: gD.http, ma: gD.ma, soNhaMay: Array.isArray(gD.data) ? gD.data.length : null, ma_ds: Array.isArray(gD.data) ? gD.data.map((x) => x.code) : null } };
    Object.assign(r, phan(
      { "http khong quyen": g.http, "ma loi khong quyen": g.ma || `http${g.http}` },
      [
        { ten: "factory.list BI CHAN cho vai 0 quyen", ok: CHAN.includes(g.ma), thay: `${g.ma} http=${g.http} "${g.loi}"` },
        { ten: "KHONG tra ve nha may nao", ok: !Array.isArray(g.data) || g.data.length === 0, thay: `${Array.isArray(g.data) ? g.data.length + " nhà máy: " + JSON.stringify(g.data.map((x) => x.code)) : "không phải mảng"}` },
        { ten: "doi chung DUONG: ky thuat van doc duoc dung 2 nha may A+B", ok: Array.isArray(gD.data) && gD.data.length === 2 && gD.data.every((x) => ["QATD-A", "QATD-B"].includes(x.code)), thay: `${Array.isArray(gD.data) ? JSON.stringify(gD.data.map((x) => x.code)) : gD.ma}` },
      ]));
    KQ.N4 = r; bao("N4", r.pq, r.vi); luu("N4", r);
  }

  /* ══ N5 — quản lý vào /twin-studio: không nút sinh, không nút tạo toà ══ */
  if (chay("N5")) {
    const r = { ca: "N5", vai: "qatd_quanly", deBai: "qatd_quanly (0 quyen tao) vao /twin-studio => KHONG thay nut sinh va nut tao toa nha" };
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    await dangNhapCtx(ctx, "qatd_quanly");
    const page = await ctx.newPage();
    await page.goto(`${BASE}/twin-studio?do=1`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForSelector('[data-testid="man-twin-studio"]', { timeout: 90_000 }).catch(() => {});
    await choCanh(page, 0);
    await page.waitForFunction(() => document.querySelectorAll(".animate-spin").length === 0, null, { timeout: 30_000 }).catch(() => {});
    const d = await page.evaluate(() => {
      const dem = (t) => document.querySelectorAll(`[data-testid="${t}"]`).length;
      const than = (document.body.innerText || "").replace(/\s+/g, " ").trim();
      const nut = [...document.querySelectorAll("button")].map((b) => ({ t: b.getAttribute("data-testid"), chu: (b.innerText || "").replace(/\s+/g, " ").trim().slice(0, 40), tat: b.disabled }));
      return {
        manStudio: dem("man-twin-studio"), nutMoSinh: dem("nut-mo-sinh"), hopThoaiSinh: dem("hop-thoai-sinh"),
        nutLuu: dem("nut-luu"), congTacKhoa: dem("cong-tac-khoa"), thuocTinhChiDoc: dem("thuoc-tinh-chi-doc"),
        moTaStudio: (() => { const e = document.querySelector('[data-testid="mo-ta-studio"]'); return e ? (e.innerText || "").replace(/\s+/g, " ").trim() : null; })(),
        nutCoChuTao: nut.filter((b) => /tạo|thêm|new|add|create|sinh|generate/i.test(b.chu)).slice(0, 12),
        tongNut: nut.length, than: than.slice(0, 500),
      };
    });
    r.anh = await anh(page, "N5-quanly-studio");
    await ctx.close();
    // đối chứng dương: kỹ thuật (settings_factory đủ quyền) PHẢI thấy nút sinh
    const ctx2 = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    await dangNhapCtx(ctx2, "qatd_kythuat");
    const p2 = await ctx2.newPage();
    await p2.goto(`${BASE}/twin-studio?do=1`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await p2.waitForSelector('[data-testid="man-twin-studio"]', { timeout: 90_000 }).catch(() => {});
    await choCanh(p2, 0);
    const dK = await p2.evaluate(() => ({ nutMoSinh: document.querySelectorAll('[data-testid="nut-mo-sinh"]').length, nutLuu: document.querySelectorAll('[data-testid="nut-luu"]').length }));
    r.anhDoiChungDuong = await anh(p2, "N5-kythuat-studio-duong");
    await ctx2.close();
    r.thay = { quanly: d, doiChungDuongKyThuat: dK };
    Object.assign(r, phan(
      { "man-twin-studio (quan ly)": d.manStudio },
      [
        { ten: "quan ly KHONG thay nut sinh (nut-mo-sinh)", ok: d.nutMoSinh === 0, thay: `${d.nutMoSinh}` },
        { ten: "quan ly KHONG thay nut nao co chu tao/them/sinh", ok: d.nutCoChuTao.length === 0, thay: JSON.stringify(d.nutCoChuTao) },
        { ten: "doi chung DUONG: ky thuat THAY nut sinh", ok: dK.nutMoSinh === 1, thay: `${dK.nutMoSinh}` },
      ]));
    KQ.N5 = r; bao("N5", r.pq, r.vi); luu("N5", r);
  }

  /* ══ N6 — kỹ thuật gọi twinCanh.sinhTuDong ⇒ 403 ══════════════════════ */
  if (chay("N6")) {
    const r = { ca: "N6", vai: "qatd_kythuat", deBai: "qatd_kythuat goi twinCanh.sinhTuDong => van 403 (adminProcedure)" };
    const ctx = await browser.newContext();
    await dangNhapCtx(ctx, "qatd_kythuat");
    const truocDatCho = Number((await sql`select count(*)::int n from twin_dat_cho`)[0].n);
    const g1 = await trpcPost(ctx, "twinCanh.sinhTuDong", { factoryId: MOC.F["QATD-A"], tangIds: [MOC.tangA.tang_id] });
    const g2 = await trpcPost(ctx, "twinCanh.sinhTuDong", {});
    await ctx.close();
    const ctxQ = await browser.newContext();
    await dangNhapCtx(ctxQ, "qatd_quanly");
    const g3 = await trpcPost(ctxQ, "twinCanh.sinhTuDong", { factoryId: MOC.F["QATD-A"], tangIds: [MOC.tangA.tang_id] });
    await ctxQ.close();
    const sauDatCho = Number((await sql`select count(*)::int n from twin_dat_cho`)[0].n);
    r.thay = { kythuat: { http: g1.http, ma: g1.ma, loi: g1.loi }, kythuatRong: { http: g2.http, ma: g2.ma, loi: g2.loi }, quanly: { http: g3.http, ma: g3.ma, loi: g3.loi }, datChoTruoc: truocDatCho, datChoSau: sauDatCho };
    Object.assign(r, phan(
      { "http": g1.http, "ma loi": g1.ma || `http${g1.http}` },
      [
        { ten: "ky thuat goi sinhTuDong => FORBIDDEN (403)", ok: g1.ma === "FORBIDDEN" || g1.http === 403, thay: `${g1.ma} http=${g1.http} "${g1.loi}"` },
        { ten: "quan ly goi sinhTuDong => bi chan", ok: CHAN.includes(g3.ma) || g3.http === 403, thay: `${g3.ma} http=${g3.http}` },
        { ten: "so hang twin_dat_cho KHONG doi", ok: truocDatCho === sauDatCho, thay: `${truocDatCho}→${sauDatCho}` },
      ]));
    KQ.N6 = r; bao("N6", r.pq, r.vi); luu("N6", r);
  }
} finally { await browser.close(); await sql.end(); }
console.log("\n=== TOM TAT N ===");
for (const [k, v] of Object.entries(KQ)) console.log(` ${k}: ${v.pq}`);
