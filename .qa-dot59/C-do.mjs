// ĐỢT 59 — MỤC C: CÂN LẠI CHIỀU CAO PANEL TRÁI (@1600 `danh-sach-may` mất 1 hàng sau mục 13).
// Đo KẾT CỤC: số HÀNG ĐỦ (hiện trọn vẹn trong ô cuộn) của nhóm tồn đọng và của danh sách máy,
// + chiều cao thật của hai ô, + đáy panel so với viewport (không tràn).
// ★ G146 FAIL-CLOSED: thiếu ô cuộn / 0 hàng đọc được ⇒ `hong`, KHÔNG ghi 0 hàng.
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? m.slice(k.length + 3) : d; };
const BASE = arg("base", "http://localhost:3059");
const TAG = arg("tag", "truoc");
const OUT = `.qa-dot59/C-${TAG}`;
mkdirSync(OUT, { recursive: true });
const TK = { username: "e2e_tai_loE", password: "E2eTaiLoE!2026" };
async function dangNhap(ctx) {
  const f = `.qa-dot59/state-${TK.username}.json`;
  const ai = async () => { const r = await ctx.request.get(`${BASE}/api/trpc/auth.me`); try { return JSON.parse(await r.text())?.result?.data?.json?.username ?? null; } catch { return null; } };
  if (existsSync(f)) { await ctx.addCookies(JSON.parse(readFileSync(f, "utf8"))); if ((await ai()) === TK.username) return; await ctx.clearCookies(); }
  const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: TK });
  if (r.status() !== 200 || (await ai()) !== TK.username) throw new Error("dang nhap that bai");
  writeFileSync(f, JSON.stringify(await ctx.cookies()));
}
const DO = () => {
  const R = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), day: Math.round(b.bottom) }; };
  const q = (t) => document.querySelector(`[data-testid="${t}"]`);
  const hien = (el) => { if (!el || el.hidden) return false; const cs = getComputedStyle(el); if (cs.display === "none" || cs.visibility === "hidden") return false; const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
  /** Hàng "đủ" = hộp hàng nằm TRỌN trong hộp ô cuộn (mô hình tỉ lệ hiện, ngưỡng 0,999). */
  const dem = (oEl, sel) => {
    if (!hien(oEl)) return { hong: "khong thay o cuon" };
    const cb = oEl.getBoundingClientRect();
    const hang = [...oEl.querySelectorAll(sel)].map((h) => { const b = h.getBoundingClientRect(); const cao = Math.max(0, Math.min(b.bottom, cb.bottom) - Math.max(b.top, cb.top)); return { cao: Math.round(b.height), phan: b.height > 0 ? +(cao / b.height).toFixed(3) : 0 }; });
    if (hang.length === 0) return { hong: `0 hang khop ${sel}` };
    return {
      rect: R(oEl), clientH: oEl.clientHeight, scrollH: oEl.scrollHeight,
      caoHangTB: +(hang.reduce((a, h) => a + h.cao, 0) / hang.length).toFixed(1),
      tong: hang.length, du: hang.filter((h) => h.phan >= 0.999).length, nua: hang.filter((h) => h.phan >= 0.5).length,
      theoPhan: +hang.reduce((a, h) => a + h.phan, 0).toFixed(2),
    };
  };
  const panel = q("panel-trai");
  return {
    vp: { w: innerWidth, h: innerHeight },
    panelTrai: R(panel),
    tranNgang: document.documentElement.scrollWidth > innerWidth + 1,
    tranDoc: document.documentElement.scrollHeight > innerHeight + 1,
    khoiTongQuan: R(q("khoi-tong-quan")),
    daiCanhBao: R(q("dai-canh-bao")),
    tonDong: dem(q("dai-canh-bao-cuon"), '[data-ton-dong="1"]'),
    danhSach: dem(q("danh-sach-may"), '[data-testid^="may-hang-"]'),
    nhomTonDongChu: q("nhom-ton-dong")?.textContent?.trim() ?? null,
  };
};
const kq = { base: BASE, tag: TAG, luc: new Date().toISOString(), ca: {} };
const browser = await chromium.launch();
try {
  for (const vp of [{ width: 1600, height: 900 }, { width: 1280, height: 720 }]) {
    const ten = `${vp.width}x${vp.height}`;
    const ctx = await browser.newContext({ viewport: vp });
    await ctx.addInitScript(() => { try { localStorage.setItem("i18nextLng", "vi"); } catch {} });
    await dangNhap(ctx);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/twin`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="man-twin-van-hanh"] canvas', { timeout: 90_000 });
    await page.waitForTimeout(7000);
    const d = await page.evaluate(DO);
    await page.screenshot({ path: `${OUT}/${ten}.png` });
    kq.ca[ten] = d;
    const s = (o) => (o.hong ? `HỎNG(${o.hong})` : `${o.du} đủ/${o.nua} ≥½ (${o.theoPhan} hàng / ${o.tong}) · ô ${o.clientH}px · hàng ~${o.caoHangTB}px`);
    console.log(`[${ten}] tồn đọng: ${s(d.tonDong)}`);
    console.log(`[${ten}] danh-sách-máy: ${s(d.danhSach)}`);
    console.log(`[${ten}] panel đáy ${d.panelTrai?.day}/${vp.height} · tràn ngang ${d.tranNgang} · dọc ${d.tranDoc} · khối tổng quan ${d.khoiTongQuan?.h}px`);
    await ctx.close();
  }
} finally { await browser.close(); }
writeFileSync(`${OUT}/kq.json`, JSON.stringify(kq, null, 2));
const hong = Object.values(kq.ca).filter((c) => c.tonDong.hong || c.danhSach.hong).length;
console.log(`=== C-do ${TAG} xong → ${OUT}/kq.json · ca=${Object.keys(kq.ca).length} · HỎNG=${hong} ===`);
