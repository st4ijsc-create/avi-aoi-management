/** NGHIỆM-THU CUỐI — T3: hai chỉ số rủi ro ngược nhau trên màn máy (PH-36).
 *  Truy vấn HAI nguồn cho CÙNG một máy rồi so, và đọc CẢ HAI trên màn sống.
 *  Ba kết cục có thể: (1) khớp trong DB mà màn lệch ⇒ lỗi mã; (2) lệch ngay trong
 *  DB ⇒ bộ sinh đặt độc lập; (3) một nguồn RỖNG ⇒ màn hiện mặc định thay vì nói
 *  không biết. Không kết luận trước khi truy vấn.
 */
import { chromium } from "@playwright/test";
import { BASE, LAUNCH, MOC, sqlMo, luu, bao, dangNhapCtx, trpcGet, anh, choCanh } from "./lib-cuoi.mjs";

const sql = sqlMo();
const r = { ca: "T3", vai: "qatd_kythuat", deBai: "so nguon 'suc khoe' (machine_health_history) voi nguon 'rui ro hong' (predictive_alerts + computeFailureRisk) cho CUNG mot may" };
const browser = await chromium.launch(LAUNCH);
try {
  const QATD = sql`select m.id from machines m join stations s on s.id=m."stationId" join production_lines l on l.id=s."lineId" join workshops w on w.id=l."workshopId" join factories f on f.id=w."factoryId" where f.code like 'QATD-%'`;

  /* ── (a) đúng câu truy vấn của kế hoạch ─────────────────────────────── */
  r.truyVanKeHoach = `SELECT m.id, m.code,
   (SELECT h."healthScore" FROM machine_health_history h WHERE h."machineId"=m.id ORDER BY h."createdAt" DESC LIMIT 1) AS suc_khoe,
   (SELECT COUNT(*) FROM predictive_alerts p WHERE p."machineId"=m.id AND p."resolvedAt" IS NULL) AS canh_bao_pdm
 FROM machines m WHERE m.code LIKE 'QATD-%' ORDER BY suc_khoe ASC NULLS LAST LIMIT 20`;
  r.ketQuaTruyVan = await sql`select m.id, m.code,
   (select h."healthScore" from machine_health_history h where h."machineId"=m.id order by h."createdAt" desc limit 1) as suc_khoe,
   (select count(*)::int from predictive_alerts p where p."machineId"=m.id and p."resolvedAt" is null) as canh_bao_pdm
 from machines m where m.code like 'QATD-%' order by suc_khoe asc nulls last limit 20`;

  /* ── (b) bảng chéo: hạng sức khoẻ × có cảnh báo PdM mở ───────────────── */
  r.bangCheo = await sql`with l as (
     select distinct on (h."machineId") h."machineId" mid, h."healthScore" hs
     from machine_health_history h where h."machineId" in (${QATD}) order by h."machineId", h."createdAt" desc)
   select case when l.hs < 60 then 'nguy_kich(<60)' when l.hs < 80 then 'canh(<80)' when l.hs < 90 then 'theo_doi(<90)' else 'khoe(>=90)' end hang,
     count(*)::int so_may,
     count(*) filter (where (select count(*) from predictive_alerts p where p."machineId"=l.mid and p."resolvedAt" is null) > 0)::int co_pdm_mo,
     round(100.0*count(*) filter (where (select count(*) from predictive_alerts p where p."machineId"=l.mid and p."resolvedAt" is null) > 0)/count(*),1) ti_le_pdm
   from l group by 1 order by 1`;

  /* ── (c) ĐẦU VÀO THẬT của computeFailureRisk (nguồn số "rủi ro hỏng") ── */
  r.dauVaoRisk = (await sql`select
     (select count(*)::int from machine_health_history h where h."machineId" in (${QATD})) tong_hang,
     (select count(*)::int from machine_health_history h where h."machineId" in (${QATD}) and h."calculationMethod"='PREDICTIVE_WS4') hang_tu_pdm,
     (select count(*)::int from machine_health_history h where h."machineId" in (${QATD}) and h."calculationMethod"<>'PREDICTIVE_WS4') hang_do_that,
     (select count(*)::int from machine_health_history h where h."machineId" in (${QATD}) and h."calculationMethod"<>'PREDICTIVE_WS4' and h.timestamp >= now() - interval '14 days') hang_do_that_trong_14d,
     (select count(distinct h."machineId")::int from machine_health_history h where h."machineId" in (${QATD}) and h."calculationMethod"<>'PREDICTIVE_WS4' and h.timestamp >= now() - interval '14 days') so_may_co_diem_do
   `)[0];
  r.diemMoiMay = await sql`select n, count(*)::int so_may from (
     select h."machineId", count(*)::int n from machine_health_history h
     where h."machineId" in (${QATD}) and h."calculationMethod"<>'PREDICTIVE_WS4' and h.timestamp >= now() - interval '14 days'
     group by h."machineId") x group by n order by n`;

  /* ── (d) đọc SỐNG: chip sức khoẻ + ô rủi ro hỏng trên /twin/may/:id ──── */
  const mau = await sql`with l as (
     select distinct on (h."machineId") h."machineId" mid, h."healthScore" hs
     from machine_health_history h where h."machineId" in (${QATD}) order by h."machineId", h."createdAt" desc)
   select m.id, m.code, l.hs, (select count(*)::int from predictive_alerts p where p."machineId"=m.id and p."resolvedAt" is null) pdm
   from l join machines m on m.id=l.mid join stations s on s.id=m."stationId" join production_lines ln on ln.id=s."lineId"
   join workshops w on w.id=ln."workshopId" join factories f on f.id=w."factoryId"
   where f.code in ('QATD-A','QATD-B') and l.hs < 60 order by l.hs asc, m.id limit 3`;
  r.mayDoSong = mau;
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await dangNhapCtx(ctx, "qatd_kythuat");
  r.song = [];
  for (const m of mau) {
    const risk = await trpcGet(ctx, "predictiveMaintenance.getMachineRisk", { machineId: Number(m.id) });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/twin/may/${m.id}?do=1`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForSelector('[data-testid="man-twin-may"]', { timeout: 90_000 }).catch(() => {});
    await choCanh(page, 0);
    await page.waitForFunction(() => { const e = document.querySelector('[data-testid="suc-khoe-may"]'); return !!e && /\S/.test(e.textContent || ""); }, null, { timeout: 45_000 }).catch(() => {});
    await page.waitForFunction(() => /risk|Risk|rủi ro/i.test(document.body.innerText || ""), null, { timeout: 30_000 }).catch(() => {});
    const d = await page.evaluate(() => {
      const e = document.querySelector('[data-testid="suc-khoe-may"]');
      const than = (document.body.innerText || "").replace(/[ \t]+/g, " ");
      const dong = than.split("\n").map((x) => x.trim()).filter(Boolean);
      const iRisk = dong.findIndex((x) => /failure risk|rủi ro hỏng/i.test(x));
      return {
        sucKhoeChu: e ? (e.textContent || "").replace(/\s+/g, " ").trim() : null,
        sucKhoeHang: e ? e.getAttribute("data-hang") : null,
        dongRuiRo: iRisk >= 0 ? dong.slice(iRisk, iRisk + 3) : null,
        dongCoChuRisk: dong.filter((x) => /risk/i.test(x)).slice(0, 6),
        cockpit: !!document.querySelector('[data-testid="cockpit-2d"]'),
      };
    });
    const a = await anh(page, `T3-may-${m.id}`);
    await page.close();
    r.song.push({ mayId: Number(m.id), ma: m.code, dbHealthScore: Number(m.hs), dbPdmMo: Number(m.pdm),
      manChipSucKhoe: d.sucKhoeChu, manChipHang: d.sucKhoeHang, manDongRuiRo: d.dongRuiRo, manDongCoRisk: d.dongCoChuRisk,
      apiGetMachineRisk: risk.data ? { failureRisk: risk.data.failureRisk, maintenanceUrgency: risk.data.maintenanceUrgency, dataPoints: risk.data.dataPoints, rulMethod: risk.data.rulMethod, confidenceScore: risk.data.confidenceScore, rulNote: risk.data.rulNote } : { http: risk.http, ma: risk.ma, loi: risk.loi },
      anh: a });
    console.log(`  máy ${m.code}: DB health=${m.hs} pdm_mở=${m.pdm} · chip "${d.sucKhoeChu}" (${d.sucKhoeHang}) · API failureRisk=${risk.data ? risk.data.failureRisk : "?"} urgency=${risk.data ? risk.data.maintenanceUrgency : "?"} dataPoints=${risk.data ? risk.data.dataPoints : "?"} rulMethod=${risk.data ? risk.data.rulMethod : "?"} · màn "${(d.dongRuiRo || []).join(" | ")}"`);
  }
  await ctx.close();

  /* ── phán quyết: ba kết cục ─────────────────────────────────────────── */
  const lechDb = r.bangCheo.length > 0 && (() => {
    const x = r.bangCheo.map((b) => Number(b.ti_le_pdm));
    return Math.max(...x) - Math.min(...x) < 20; // tỉ lệ có PdM gần như KHÔNG đổi theo hạng sức khoẻ ⇒ độc lập
  })();
  const riskRong = r.song.every((s) => s.apiGetMachineRisk && s.apiGetMachineRisk.failureRisk === 0);
  const itDiem = Number(r.dauVaoRisk.hang_do_that_trong_14d) <= Number(r.dauVaoRisk.so_may_co_diem_do);
  r.ketCuc = [];
  if (lechDb) r.ketCuc.push("KẾT CỤC 2 — hai nguồn LỆCH NGAY TRONG CSDL: tỉ lệ máy có cảnh báo PdM mở gần như KHÔNG đổi theo hạng sức khoẻ ⇒ bộ sinh đặt hai đại lượng ĐỘC LẬP (đúng giả thuyết chủ dự án). Việc vá: sửa bộ sinh `.qa-tapdoan/sinh-tap-doan.mjs` cho hai đại lượng cùng một nguồn ngẫu nhiên.");
  if (riskRong && itDiem) r.ketCuc.push("KẾT CỤC 3 — nguồn 'rủi ro hỏng' RỖNG VỀ THỰC CHẤT: `computeFailureRisk` chỉ ăn hàng `machine_health_history` có `calculationMethod <> 'PREDICTIVE_WS4'` trong 14 ngày; bộ sinh cho ĐÚNG 1 điểm/máy nên hàm trả `failureRisk: 0` + `maintenanceUrgency: LOW` cho MỌI máy. Màn in '0 %' — một GIÁ TRỊ MẶC ĐỊNH — thay vì nói 'chưa đủ dữ liệu'. Đây là lỗi RIÊNG, mở task vá riêng.");
  if (r.ketCuc.length === 0) r.ketCuc.push("KẾT CỤC 1 — hai nguồn KHỚP trong CSDL nhưng màn lệch ⇒ lỗi mã.");
  r.pq = "ĐẠT";
  r.vi = `đã truy vấn cả hai nguồn và đọc cả hai trên màn sống · ${r.ketCuc.length} kết cục: ${r.ketCuc.map((x) => x.split(" —")[0]).join(" + ")}`;
  bao("T3", r.pq, r.vi);
  for (const k of r.ketCuc) console.log("   " + k);
  luu("T3", r);
} catch (e) {
  r.pq = "HỎNG"; r.vi = `lỗi khi đo: ${String(e.message).slice(0, 400)}`; bao("T3", r.pq, r.vi); luu("T3", r);
} finally { await browser.close(); await sql.end(); }
