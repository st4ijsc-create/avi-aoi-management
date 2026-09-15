/** P2b — dải cảnh báo của giám đốc CÓ phân rã được theo công ty không?
 *  Đo BA tầng cho cùng một vai: (1) API `andon.active` trả andon của mấy công ty,
 *  (2) con số trên đầu dải, (3) danh tính công ty trên TỪNG dòng đã render (cuộn hết).
 */
import { chromium } from "@playwright/test";
import { BASE, LAUNCH, sqlMo, luu, bao, phan, dangNhapCtx, trpcGet, anh, choCanh } from "./lib-cuoi.mjs";

const sql = sqlMo();
const r = { ca: "P2b", vai: "qatd_giamdoc", deBai: "giam doc 3 cong ty: API andon.active tra andon cua may cong ty? dai hien bao nhieu dong va cua may cong ty?" };
const browser = await chromium.launch(LAUNCH);
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await dangNhapCtx(ctx, "qatd_giamdoc");
  const api = await trpcGet(ctx, "andon.active", undefined);
  const ids = Array.isArray(api.data) ? api.data.map((x) => Number(x.machineId)).filter(Boolean) : [];
  r.api = { http: api.http, ma: api.ma, soDong: Array.isArray(api.data) ? api.data.length : null };
  r.apiTheoNhaMay = ids.length
    ? await sql`select f.code, f.name, count(*)::int n from machines m join stations s on s.id=m."stationId"
        join production_lines l on l.id=s."lineId" join workshops w on w.id=l."workshopId" join factories f on f.id=w."factoryId"
        where m.id = any(${ids}) group by f.code, f.name order by f.code`
    : [];

  const page = await ctx.newPage();
  await page.goto(`${BASE}/twin?do=1`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector('[data-testid="man-twin-van-hanh"]', { timeout: 90_000 }).catch(() => {});
  await choCanh(page, 0);
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="dai-canh-bao"] [data-ma-may]').length > 0, null, { timeout: 45_000 }).catch(() => {});
  // cuộn hết ô cuộn của dải để mọi dòng ảo hoá được render
  const d = await page.evaluate(async () => {
    const cuon = document.querySelector('[data-testid="dai-canh-bao-cuon"]') || document.querySelector('[data-testid="dai-canh-bao"]');
    const thay = new Map();
    const gom = () => { for (const e of document.querySelectorAll('[data-testid="dai-canh-bao"] [data-ma-may]')) thay.set(e.getAttribute("data-ma-may"), { nhaMay: e.getAttribute("data-nha-may"), muc: e.getAttribute("data-muc"), chu: (e.innerText || "").replace(/\s+/g, " ").trim().slice(0, 140) }); };
    gom();
    if (cuon) { for (let i = 0; i < 40; i += 1) { cuon.scrollTop = cuon.scrollHeight; await new Promise((s) => setTimeout(s, 60)); gom(); if (cuon.scrollTop + cuon.clientHeight >= cuon.scrollHeight - 2 && i > 4) break; } }
    const el = (t) => document.querySelector(`[data-testid="${t}"]`);
    const chu = (t) => { const e = el(t); return e ? (e.innerText || "").replace(/\s+/g, " ").trim() : null; };
    return { dong: [...thay.entries()].map(([ma, v]) => ({ ma, ...v })), daiChu: chu("dai-canh-bao").slice(0, 200), phamVi: chu("dai-pham-vi"), tonDong: !!el("nhom-ton-dong"), homNay: !!el("nhom-hom-nay") };
  });
  r.anh = await anh(page, "P2b-dai-cuon-het");
  await ctx.close();
  const nm = {};
  for (const x of d.dong) nm[x.nhaMay || "(không có)"] = (nm[x.nhaMay || "(không có)"] || 0) + 1;
  r.thay = { soDongDaRender: d.dong.length, theoNhaMayTrenDai: nm, daiChu: d.daiChu, phamVi: d.phamVi, apiTheoNhaMay: r.apiTheoNhaMay.map((x) => `${x.code} (${x.name}) = ${x.n}`), apiSoDong: r.api.soDong };
  const soCtyApi = r.apiTheoNhaMay.length, soCtyDai = Object.keys(nm).length;
  Object.assign(r, phan(
    { "so dong API andon.active": r.api.soDong, "so dong da render tren dai": d.dong.length === 0 ? null : d.dong.length },
    [
      { ten: "MOI dong tren dai mang ten cong ty (dieu kien de PHAN RA)", ok: d.dong.every((x) => x.nhaMay && x.nhaMay.trim()), thay: `${d.dong.filter((x) => x.nhaMay).length}/${d.dong.length}` },
      { ten: "API tra andon cua CA BA cong ty (du lieu co de phan ra)", ok: soCtyApi === 3, thay: `${soCtyApi} công ty: ${JSON.stringify(r.thay.apiTheoNhaMay)}` },
      { ten: "dai HIEN dong cua nhieu hon MOT cong ty", ok: soCtyDai > 1, thay: `${soCtyDai} công ty trên dải: ${JSON.stringify(nm)}` },
    ]));
  bao("P2b", r.pq, r.vi); luu("P2b", r);
} catch (e) { r.pq = "HỎNG"; r.vi = `lỗi khi đo: ${String(e.message).slice(0, 300)}`; bao("P2b", r.pq, r.vi); luu("P2b", r); }
finally { await browser.close(); await sql.end(); }
