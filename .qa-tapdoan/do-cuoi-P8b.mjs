/** P8b — DỰNG CA rồi đo: một toà 84 tầng ⇒ `banner-tang-vuot-tran` phải hiện và nêu đủ 3 số.
 *  Hàng TẠM có tiền tố `QATD-TMP-P8`; đếm trước/sau và XOÁ hết ở cuối (kể cả khi lỗi).
 *  Không sửa mã sản phẩm.
 */
import { chromium } from "@playwright/test";
import { BASE, LAUNCH, MOC, sqlMo, luu, bao, phan, dangNhapCtx, anh, choCanh } from "./lib-cuoi.mjs";

const MA_TAM = "QATD-TMP-P8";
const SO_TANG = 84;
const r = { ca: "P8b", vai: "qatd_kythuat", deBai: `dung mot TOA ${SO_TANG} tang (hang tam ${MA_TAM}) => banner-tang-vuot-tran PHAI hien va neu du 3 so (can/tran/thieu)` };
const sql = sqlMo();
let browser = null, toaId = null;
const dem = async () => ({
  toaNha: Number((await sql`select count(*)::int n from twin_toa_nha`)[0].n),
  tang: Number((await sql`select count(*)::int n from twin_tang`)[0].n),
  toaTam: Number((await sql`select count(*)::int n from twin_toa_nha where ma like ${MA_TAM + "%"}`)[0].n),
});
try {
  r.demTruoc = await dem();
  const [toa] = await sql`insert into twin_toa_nha ("factoryId", ma, ten, "rongMm", "sauMm", "caoMm", nguon)
    values (${MOC.F["QATD-A"]}, ${MA_TAM}, ${"Toà tạm P8 (" + SO_TANG + " tầng)"}, 110000, 80000, 500000, 'sinh') returning id`;
  toaId = Number(toa.id);
  const hang = Array.from({ length: SO_TANG }, (_, i) => ({ toaNhaId: toaId, capSo: i + 1, ten: `Tầng ${i + 1}`, caoDoMm: i * 6000, caoThongThuyMm: 6000, daiMm: 110000, rongMm: 80000 }));
  await sql`insert into twin_tang ${sql(hang, "toaNhaId", "capSo", "ten", "caoDoMm", "caoThongThuyMm", "daiMm", "rongMm")}`;
  r.daTao = { toaId, soTang: Number((await sql`select count(*)::int n from twin_tang where "toaNhaId"=${toaId}`)[0].n) };
  r.demSauTao = await dem();

  browser = await chromium.launch(LAUNCH);
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await dangNhapCtx(ctx, "qatd_kythuat");
  const page = await ctx.newPage();
  await page.goto(`${BASE}/twin?do=1&nm=${MOC.F["QATD-A"]}&toa=${toaId}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector('[data-testid="man-twin-van-hanh"]', { timeout: 90_000 }).catch(() => {});
  await choCanh(page, 0);
  await page.waitForFunction(() => !!document.querySelector('[data-testid="banner-tang-vuot-tran"]'), null, { timeout: 45_000 }).catch(() => {});
  // dải hợp nhất có thể đang thu — mở chi tiết để đọc nguyên văn
  const coNut = await page.locator('[data-testid="nut-mo-dai-hop-nhat"]').count();
  if (coNut > 0) { await page.locator('[data-testid="nut-mo-dai-hop-nhat"]').click().catch(() => {}); await page.waitForSelector('[data-testid="dai-hop-nhat-chi-tiet"]', { timeout: 15_000 }).catch(() => {}); }
  const d = await page.evaluate(() => {
    const e = document.querySelector('[data-testid="banner-tang-vuot-tran"]');
    const dai = document.querySelector('[data-testid="dai-hop-nhat"]');
    const ct = document.querySelector('[data-testid="dai-hop-nhat-chi-tiet"]');
    const hien = (el) => { if (!el || el.hidden) return false; const b = el.getBoundingClientRect(); if (b.width <= 0 || b.height <= 0) return false; const cs = getComputedStyle(el); return cs.visibility !== "hidden" && Number(cs.opacity) > 0.05; };
    return {
      co: !!e, hien: hien(e),
      chu: e ? (e.innerText || e.textContent || "").replace(/\s+/g, " ").trim() : null,
      dataPhu: e ? Object.fromEntries([...e.attributes].filter((a) => a.name.startsWith("data-")).map((a) => [a.name, a.value])) : null,
      daiChu: dai ? (dai.innerText || "").replace(/\s+/g, " ").trim() : null,
      chiTietChu: ct ? (ct.innerText || "").replace(/\s+/g, " ").trim().slice(0, 700) : null,
      soOTang: (() => { const s = document.querySelector('[data-testid="chon-tang"]'); return s ? s.options.length : null; })(),
    };
  });
  r.anh = await anh(page, "P8b-toa-84-tang");
  await ctx.close();
  r.thay = d;
  const tong = d.dataPhu ? Number(d.dataPhu["data-tong-tang"]) : NaN;
  const tran = d.dataPhu ? Number(d.dataPhu["data-tran-tang"]) : NaN;
  const cat = d.dataPhu ? Number(d.dataPhu["data-tang-bi-cat"]) : NaN;
  r.nguyenVan = d.chu;
  Object.assign(r, phan(
    { "phan tu banner-tang-vuot-tran": d.co ? 1 : null, "chu banner": d.chu, "data-tong-tang": Number.isFinite(tong) ? tong : null, "data-tran-tang": Number.isFinite(tran) ? tran : null, "data-tang-bi-cat": Number.isFinite(cat) ? cat : null },
    [
      { ten: "banner HIEN RA", ok: d.hien === true, thay: `hien=${d.hien}` },
      { ten: `can = ${SO_TANG} tang`, ok: tong === SO_TANG, thay: `${tong}` },
      { ten: "tran = 50", ok: tran === 50, thay: `${tran}` },
      { ten: `thieu = ${SO_TANG - 50}`, ok: cat === SO_TANG - 50, thay: `${cat}` },
      { ten: "chu nguoi dung doc neu DU BA con so", ok: [tong, tran, cat].every((n) => Number.isFinite(n) && d.chu.includes(String(n))), thay: `"${d.chu}"` },
    ]));
  bao("P8b", r.pq, r.vi);
} catch (e) {
  r.pq = "HỎNG"; r.vi = `lỗi khi dựng/đo: ${String(e.message).slice(0, 300)}`;
  bao("P8b", r.pq, r.vi);
} finally {
  if (browser) await browser.close();
  // ── DỌN: xoá mọi hàng tạm, rồi đếm lại ────────────────────────────────
  try {
    const xTang = toaId ? await sql`delete from twin_tang where "toaNhaId"=${toaId}` : { count: 0 };
    const xToa = await sql`delete from twin_toa_nha where ma like ${MA_TAM + "%"}`;
    r.don = { xoaTang: xTang.count, xoaToaNha: xToa.count };
    r.demSauDon = await dem();
    r.donSach = r.demSauDon.toaNha === r.demTruoc.toaNha && r.demSauDon.tang === r.demTruoc.tang && r.demSauDon.toaTam === 0;
    console.log(`  DỌN: xoá ${xTang.count} tầng + ${xToa.count} toà · trước ${JSON.stringify(r.demTruoc)} · sau ${JSON.stringify(r.demSauDon)} · sạch=${r.donSach}`);
  } catch (e) { r.donLoi = String(e.message).slice(0, 300); console.log("  DỌN LỖI: " + r.donLoi); }
  luu("P8b", r);
  await sql.end();
}
