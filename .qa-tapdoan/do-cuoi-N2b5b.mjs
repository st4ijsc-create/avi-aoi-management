/** NGHIỆM-THU CUỐI — N2b và N5b: phân xử hai ô của lô N.
 *  N2b — cổng PHẠM VI của andon.raise/quickReport, đo bằng tài khoản CÓ canCreate
 *        (N2 gặp cổng QUYỀN trước nên chưa chạm tới cổng phạm vi). Quyền tạm, trả lại.
 *  N5b — nút sinh là cổng ADMIN (`quyen.sinh = laAdmin`), nút TẠO TOÀ là cổng
 *        canCreate. Đo đúng hai cổng ấy với đối chứng dương đúng vai.
 */
import { chromium } from "@playwright/test";
import { arg, BASE, LAUNCH, MOC, sqlMo, luu, bao, phan, dangNhapCtx, trpcPost, anh, choCanh } from "./lib-cuoi.mjs";

const CA = arg("ca", "all");
const chay = (c) => CA === "all" || CA === c;
const CHAN = ["FORBIDDEN", "NOT_FOUND", "UNAUTHORIZED"];
const KQ = {};
const sql = sqlMo();
const demAndon = async () => Number((await sql`select count(*)::int n from andon_events`)[0].n);

const browser = await chromium.launch(LAUNCH);
try {
  /* ══ N2b — cổng PHẠM VI thật sự ═══════════════════════════════════════ */
  if (chay("N2b")) {
    const mB = MOC.mayB[0], mC = MOC.mayC[0];
    const r = { ca: "N2b", vai: "qatd_congnhan (canCreate BẬT TẠM)", deBai: `mo tam andon.canCreate cho cong nhan roi goi raise/quickReport nham may QATD-B (${mB.id}/${mB.code}) => PHAI NOT_FOUND va dem andon_events KHONG tang; doi chung DUONG: cung loi goi nham may QATD-C (${mC.code}) => THANH CONG roi xoa` };
    let uid = null, cu = null, idsMoi = [];
    try {
      const [u] = await sql`select id from users where username='qatd_congnhan'`;
      uid = Number(u.id);
      const [p0] = await sql`select "canCreate" from permissions where "userId"=${uid} and "moduleName"='andon'`;
      cu = p0.canCreate;
      r.demTruoc = await demAndon();
      await sql`update permissions set "canCreate"=true where "userId"=${uid} and "moduleName"='andon'`;
      const ctx = await browser.newContext();
      await dangNhapCtx(ctx, "qatd_congnhan");
      const raiseB = await trpcPost(ctx, "andon.raise", { state: "yellow", reason: "other", title: "QATD-TMP N2b may B", machineId: mB.id });
      const quickB = await trpcPost(ctx, "andon.quickReport", { machineId: mB.id, description: "QATD-TMP N2b may B" });
      const quickMaB = await trpcPost(ctx, "andon.quickReport", { machineCode: mB.code, description: "QATD-TMP N2b ma B" });
      const tramB = (await sql`select s.id from stations s join production_lines l on l.id=s."lineId" join workshops w on w.id=l."workshopId" join factories f on f.id=w."factoryId" where f.code='QATD-B' limit 1`)[0];
      const chuyenB = (await sql`select l.id from production_lines l join workshops w on w.id=l."workshopId" join factories f on f.id=w."factoryId" where f.code='QATD-B' limit 1`)[0];
      const raiseTramB = await trpcPost(ctx, "andon.raise", { state: "yellow", reason: "other", title: "QATD-TMP N2b tram B", stationId: Number(tramB.id) });
      const raiseChuyenB = await trpcPost(ctx, "andon.raise", { state: "yellow", reason: "other", title: "QATD-TMP N2b chuyen B", lineId: Number(chuyenB.id) });
      const demSauChan = await demAndon();
      // đối chứng DƯƠNG: cùng lời gọi, máy TRONG phạm vi ⇒ phải thành công
      const raiseC = await trpcPost(ctx, "andon.raise", { state: "yellow", reason: "other", title: "QATD-TMP N2b may C duong", machineId: mC.id });
      const demSauDuong = await demAndon();
      await ctx.close();
      idsMoi = (await sql`select id, title, "machineId" from andon_events where title like 'QATD-TMP N2b%' order by id`).map((x) => Number(x.id));
      r.thay = { raiseB: { ma: raiseB.ma, http: raiseB.http, loi: raiseB.loi }, quickB: { ma: quickB.ma, http: quickB.http, loi: quickB.loi },
        quickTheoMaB: { ma: quickMaB.ma, http: quickMaB.http, loi: quickMaB.loi },
        raiseTramB: { ma: raiseTramB.ma, http: raiseTramB.http }, raiseChuyenB: { ma: raiseChuyenB.ma, http: raiseChuyenB.http },
        raiseC_doiChungDuong: { ma: raiseC.ma, http: raiseC.http, idMoi: raiseC.data ? raiseC.data.id : null },
        demTruoc: r.demTruoc, demSauNamLoiGoiBiChan: demSauChan, demSauDoiChungDuong: demSauDuong, idsTao: idsMoi };
      Object.assign(r, phan(
        { "ma loi raise (may B)": raiseB.ma || raiseB.http, "ma loi quickReport (may B)": quickB.ma || quickB.http, "dem truoc": r.demTruoc, "dem sau 5 loi goi bi chan": demSauChan },
        [
          { ten: "raise(machineId B) => NOT_FOUND", ok: raiseB.ma === "NOT_FOUND", thay: `${raiseB.ma} http=${raiseB.http}` },
          { ten: "quickReport(machineId B) => NOT_FOUND", ok: quickB.ma === "NOT_FOUND", thay: `${quickB.ma} http=${quickB.http}` },
          { ten: "quickReport(machineCode B) => NOT_FOUND", ok: quickMaB.ma === "NOT_FOUND", thay: `${quickMaB.ma} http=${quickMaB.http}` },
          { ten: "raise(stationId B) => NOT_FOUND", ok: raiseTramB.ma === "NOT_FOUND", thay: `${raiseTramB.ma}` },
          { ten: "raise(lineId B) => NOT_FOUND", ok: raiseChuyenB.ma === "NOT_FOUND", thay: `${raiseChuyenB.ma}` },
          { ten: "5 loi goi ngoai pham vi KHONG tang mot hang nao", ok: demSauChan === r.demTruoc, thay: `${r.demTruoc}→${demSauChan}` },
          { ten: "doi chung DUONG: may QATD-C THANH CONG (cong khong vá quá tay)", ok: raiseC.http === 200 && demSauDuong === r.demTruoc + 1, thay: `http=${raiseC.http} ma=${raiseC.ma} · đếm ${r.demTruoc}→${demSauDuong}` },
        ]));
    } catch (e) { r.pq = "HỎNG"; r.vi = `lỗi khi đo: ${String(e.message).slice(0, 300)}`; }
    finally {
      const xoa = idsMoi.length ? await sql`delete from andon_events where id = any(${idsMoi})` : { count: 0 };
      const xoa2 = await sql`delete from andon_events where title like 'QATD-TMP%'`;
      if (uid != null && cu != null) await sql`update permissions set "canCreate"=${cu} where "userId"=${uid} and "moduleName"='andon'`;
      const [pS] = uid != null ? await sql`select "canCreate" from permissions where "userId"=${uid} and "moduleName"='andon'` : [{}];
      r.don = { xoaTheoId: xoa.count, xoaTheoTieuDe: xoa2.count, quyenTraVe: pS ? pS.canCreate : null, demSauDon: await demAndon() };
      r.donSach = r.demTruoc != null && r.don.demSauDon === r.demTruoc && r.don.quyenTraVe === cu;
      console.log(`  DỌN N2b: xoá ${xoa.count + xoa2.count} andon · quyền trả về ${r.don.quyenTraVe} (cũ ${cu}) · đếm ${r.demTruoc}→${r.don.demSauDon} · sạch=${r.donSach}`);
      KQ.N2b = r; bao("N2b", r.pq, r.vi); luu("N2b", r);
    }
  }

  /* ══ N5b — hai cổng khác nhau, hai đối chứng dương đúng vai ═══════════ */
  if (chay("N5b")) {
    const r = { ca: "N5b", deBai: "nut sinh = cong ADMIN (quyen.sinh = laAdmin); nut/tab TAO TOA = cong canCreate. Do 3 vai: quan ly (0 ca hai), ky thuat (co canCreate, khong admin), admin (co ca hai)" };
    const doVai = async (vai) => {
      const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
      await dangNhapCtx(ctx, vai);
      const page = await ctx.newPage();
      await page.goto(`${BASE}/twin-studio?do=1`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForSelector('[data-testid="man-twin-studio"]', { timeout: 90_000 }).catch(() => {});
      await choCanh(page, 0);
      await page.waitForFunction(() => document.querySelectorAll(".animate-spin").length === 0, null, { timeout: 30_000 }).catch(() => {});
      const d = await page.evaluate(() => {
        const dem = (t) => document.querySelectorAll(`[data-testid="${t}"]`).length;
        const nut = [...document.querySelectorAll("button")].map((b) => ({ t: b.getAttribute("data-testid"), chu: (b.innerText || "").replace(/\s+/g, " ").trim().slice(0, 40), tat: b.disabled }));
        return { nutMoSinh: dem("nut-mo-sinh"), tabConDuongB: dem("tab-con-duong-b"), dungNhaXuong: dem("dung-nha-xuong"), nutTao: dem("nut-tao"), nutLuu: dem("nut-luu"),
          nutCoChuTaoSinh: nut.filter((b) => /generate|create|add building|tạo|sinh/i.test(b.chu)).slice(0, 10), tongNut: nut.length };
      });
      const a = await anh(page, `N5b-${vai}`);
      await ctx.close();
      return { ...d, anh: a };
    };
    const ql = await doVai("qatd_quanly");
    const kt = await doVai("qatd_kythuat");
    const ad = await doVai("qatd_admin");
    r.thay = { quanly: ql, kythuat: kt, admin: ad };
    Object.assign(r, phan(
      { "quan ly do duoc": ql.tongNut, "ky thuat do duoc": kt.tongNut, "admin do duoc": ad.tongNut },
      [
        { ten: "quan ly KHONG thay nut sinh", ok: ql.nutMoSinh === 0, thay: `${ql.nutMoSinh}` },
        { ten: "quan ly KHONG thay tab/nut tao toa nha", ok: ql.tabConDuongB === 0 && ql.dungNhaXuong === 0 && ql.nutTao === 0, thay: `tab=${ql.tabConDuongB} form=${ql.dungNhaXuong} nutTao=${ql.nutTao}` },
        { ten: "quan ly KHONG thay nut nao co chu generate/create/tao/sinh", ok: ql.nutCoChuTaoSinh.length === 0, thay: JSON.stringify(ql.nutCoChuTaoSinh) },
        { ten: "ky thuat (KHONG admin) cung KHONG thay nut sinh — dung cong admin", ok: kt.nutMoSinh === 0, thay: `${kt.nutMoSinh}` },
        { ten: "doi chung DUONG cong canCreate: ky thuat THAY tab tao toa nha", ok: kt.tabConDuongB === 1, thay: `tab=${kt.tabConDuongB} form=${kt.dungNhaXuong}` },
        { ten: "doi chung DUONG cong admin: qatd_admin THAY nut sinh", ok: ad.nutMoSinh === 1, thay: `${ad.nutMoSinh}` },
      ]));
    KQ.N5b = r; bao("N5b", r.pq, r.vi); luu("N5b", r);
  }
} finally { await browser.close(); await sql.end(); }
console.log("\n=== TOM TAT ===");
for (const [k, v] of Object.entries(KQ)) console.log(` ${k}: ${v.pq}`);
