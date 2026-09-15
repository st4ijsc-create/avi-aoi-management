/** Thăm dò đường đa chọn + căn chỉnh trong Studio (không phán quyết, chỉ in trạng thái). */
import { chromium } from "@playwright/test";
import { BASE, LAUNCH, MOC, dangNhapCtx, choCanh, anh } from "./lib-cuoi.mjs";

const tang = MOC.tangT2[0];
const browser = await chromium.launch(LAUNCH);
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
await dangNhapCtx(ctx, "qatd_kythuat");
const page = await ctx.newPage();
page.on("dialog", async (d) => { await d.dismiss().catch(() => {}); });
await page.goto(`${BASE}/twin-studio?do=1`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForSelector('[data-testid="man-twin-studio"]', { timeout: 120_000 }).catch(() => {});
await page.waitForSelector('[data-testid="xuong-thiet-ke"] canvas', { timeout: 60_000 }).catch(() => {});
await choCanh(page, 0);
await page.selectOption('[data-testid="chon-toa-nha"]', String(tang.toa_id)).catch(() => {});
await page.waitForFunction((t) => { const s = document.querySelector('[data-testid="chon-tang"]'); return !!s && [...s.options].some((o) => o.value === String(t)); }, tang.tang_id, { timeout: 45_000 }).catch(() => {});
await page.selectOption('[data-testid="chon-tang"]', String(tang.tang_id)).catch(() => {});
await choCanh(page, 0);
await page.waitForFunction((n) => { const ds = window.__demTuongTac && window.__demTuongTac.dsMay ? window.__demTuongTac.dsMay() : null; return Array.isArray(ds) && ds.length === n; }, tang.n, { timeout: 60_000 }).catch(() => {});

const st = async (nhan) => {
  const d = await page.evaluate(() => {
    const dem = (t) => document.querySelectorAll(`[data-testid="${t}"]`).length;
    const ds = window.__demTuongTac && window.__demTuongTac.dsMay ? window.__demTuongTac.dsMay() : null;
    const mau = Array.isArray(ds) && ds.length ? Object.keys(ds[0]) : null;
    const nodes = [...document.querySelectorAll('[data-testid^="node-cay-"]')].map((e) => e.getAttribute("data-testid"));
    return { soKhoi: Array.isArray(ds) ? ds.length : null, truongCuaKhoi: mau, mauKhoi: Array.isArray(ds) && ds.length ? ds[0] : null,
      bangThuocTinh: dem("bang-thuoc-tinh"), congTacKhoa: dem("cong-tac-khoa"), thuocTinhChiDoc: dem("thuoc-tinh-chi-doc"),
      thanhCanChinh: dem("thanh-can-chinh"), nutCanhTrai: dem("nut-canh-trai"),
      nutCanhTraiTat: (() => { const b = document.querySelector('[data-testid="nut-canh-trai"]'); return b ? b.disabled : null; })(),
      demChuaLuu: dem("dem-chua-luu"), demChuaLuuChu: (() => { const e = document.querySelector('[data-testid="dem-chua-luu"]'); return e ? e.textContent.trim() : null; })(),
      soNodeCay: nodes.length, nodeMay: nodes.filter((x) => x.includes("machine:")).slice(0, 6), nodeKhac: nodes.filter((x) => !x.includes("machine:")).slice(0, 6),
      coLocCay: dem("loc-cay") };
  });
  console.log(`\n── ${nhan} ──`);
  console.log(JSON.stringify(d, null, 1).slice(0, 1600));
  return d;
};

const d0 = await st("sau khi nap tang");

/* B1: bấm một khối trên cảnh (đường T1 đã chạy được) */
const bam = async (tru) => page.evaluate((tru) => {
  const cv = document.querySelector('[data-testid="xuong-thiet-ke"] canvas');
  if (!cv) return { loi: "khong canvas" };
  const r0 = cv.getBoundingClientRect();
  const ds = (window.__demTuongTac && window.__demTuongTac.dsMay ? window.__demTuongTac.dsMay() : []).filter((m) => m.trongKhung);
  for (const m of ds) {
    if (tru.includes(m.machineId)) continue;
    const t = window.__demTuongTac.tamMay ? window.__demTuongTac.tamMay(m.machineId) : null;
    if (!t || t.biChe) continue;
    const X = r0.left + t.x, Y = r0.top + t.y;
    if (document.elementFromPoint(X, Y) !== cv) continue;
    return { id: m.machineId, X, Y };
  }
  return { loi: `0 khoi bam duoc (trong khung ${ds.length})` };
}, tru);

const p1 = await bam([]);
console.log("\nbam khoi 1:", JSON.stringify(p1));
if (p1.id) { await page.mouse.move(p1.X - 40, p1.Y - 40); await page.mouse.move(p1.X, p1.Y, { steps: 4 }); await page.mouse.click(p1.X, p1.Y); }
await page.waitForSelector('[data-testid="cong-tac-khoa"]', { timeout: 20_000 }).catch(() => console.log("  (khong thay cong-tac-khoa sau bam 1)"));
await st("sau bam khoi 1 tren canh");

/* B2: cây — xem node máy nào có sẵn, và thử shift+click 2 node */
const cay = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll('[data-testid^="node-cay-machine:"]')].map((e) => ({ t: e.getAttribute("data-testid"), chu: (e.innerText || "").replace(/\s+/g, " ").trim().slice(0, 40) }));
  return { so: nodes.length, mau: nodes.slice(0, 8) };
});
console.log("\nnode may trong cay:", JSON.stringify(cay));

if (cay.so >= 3) {
  const ids = cay.mau.slice(0, 3).map((x) => x.t);
  await page.locator(`[data-testid="${ids[0]}"]`).click();
  await page.locator(`[data-testid="${ids[1]}"]`).click({ modifiers: ["Shift"] });
  await page.locator(`[data-testid="${ids[2]}"]`).click({ modifiers: ["Shift"] });
  const d = await st("sau shift+click 3 node cay");
  if (d.nutCanhTrai === 1 && d.nutCanhTraiTat === false) {
    await page.locator('[data-testid="nut-canh-trai"]').click();
    await page.waitForSelector('[data-testid="dem-chua-luu"]', { timeout: 20_000 }).catch(() => {});
    await st("sau nut-canh-trai");
  } else console.log("  nut-canh-trai KHONG bam duoc");
  /* B3: sau khi da can, bam MOT khoi khac tren canh */
  const idsSo = ids.map((x) => Number(x.split(":")[1]));
  const p2 = await bam(idsSo);
  console.log("\nbam khoi 2 (tru 3 node da chon):", JSON.stringify(p2));
  if (p2.id) { await page.mouse.move(p2.X - 40, p2.Y - 40); await page.mouse.move(p2.X, p2.Y, { steps: 4 }); await page.mouse.click(p2.X, p2.Y); }
  await page.waitForSelector('[data-testid="cong-tac-khoa"]', { timeout: 20_000 }).catch(() => console.log("  (KHONG thay cong-tac-khoa sau bam 2)"));
  await st("sau bam khoi 2");
  await anh(page, "probe-T2-sau-can");
}
await ctx.close(); await browser.close();
