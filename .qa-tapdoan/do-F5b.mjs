// ★ F5b — sửa hai lỗ của F5:
//   ① `danh-sach-may` ẢO HOÁ (chỉ ~18 hàng trong DOM, tất cả `down` vì xếp bất thường trước)
//      ⇒ CUỘN hết danh sách rồi gom màu theo TRẠNG THÁI: đủ 5 rổ, mỗi rổ một màu + hoạ tiết + CHỮ (mã hoá dư thừa).
//   ② `twinCanh.sucKhoeMay` trả `{khai:[…]}` chứ không phải mảng ⇒ tính PHÂN BỐ HẠNG bằng đúng luật
//      `hangSucKhoe()` đọc từ mã nguồn, để biết vòng viền 3D CÓ được vẽ hay không (bao nhiêu vòng, mấy màu).
//   ⚠ Màu VÒNG VIỀN 3D không đo được bằng dụng cụ được phép: không có `window.__demVien` (trong khi CÓ
//      `__demNhan`/`__demBadge`), và cấm đọc pixel canvas (G34) ⇒ ô ấy phán HỎNG kèm TÊN dữ kiện thiếu.
import { chromium } from "@playwright/test";
import { arg, BASE, layCookie, ghi, ANH, TANG_DONG } from "./lib-F.mjs";

const NGUONG_NGUY_KICH = 60, NGUONG_CANH = 80, NGUONG_THEO_DOI = 90, HAN_MS = 14 * 24 * 3600 * 1000;
function hangSucKhoe(k, bayGio) { // bản sao ĐỌC TỪ sucKhoeMay.ts:216 (thứ tự: hạn trước, điểm sau)
  if (k.diem == null && k.nguyCo == null && k.mucKhan == null) return "chua_do";
  if (!(k.mocMs != null && bayGio - k.mocMs <= HAN_MS)) return "het_han";
  if (k.mucKhan === "CRITICAL") return "nguy_kich";
  if (k.diem == null) return "chua_do";
  if (k.diem < NGUONG_NGUY_KICH) return "nguy_kich";
  if (k.diem < NGUONG_CANH) return "canh";
  if (k.diem < NGUONG_THEO_DOI) return "theo_doi";
  return "khoe";
}
const MAU_VIEN = { nguy_kich: "#dc2626", canh: "#f59e0b", theo_doi: "#eab308", het_han: "#94a3b8", khoe: null, chua_do: null };

const GOM = () => {
  const ra = {};
  for (const el of document.querySelectorAll('[data-testid^="may-hang-"]')) {
    const tt = el.getAttribute("data-trang-thai");
    const dot = el.querySelector('span[aria-hidden="true"]');
    if (!dot || !tt) continue;
    const cs = getComputedStyle(dot);
    const spans = [...el.querySelectorAll("span")].map((s) => s.textContent.trim());
    ra[tt] = ra[tt] || { mau: cs.backgroundColor, opacity: cs.opacity, hoaTiet: cs.backgroundImage !== "none", boxShadow: cs.boxShadow !== "none", chuCuoi: spans.filter(Boolean).slice(-2), so: 0 };
    ra[tt].so += 1;
  }
  return ra;
};

const browser = await chromium.launch({ args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"] });
const kq = { ca: "F5b", base: BASE, luc: new Date().toISOString(), soWorker: 1 };
try {
  const T = TANG_DONG;
  const ck = await layCookie(browser, "qatd_kythuat");
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await ctx.addCookies(ck);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/twin?nm=${T.nm}&toa=${T.toa}&tang=${T.tang}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('[data-testid="man-twin-van-hanh"]', { state: "visible", timeout: 60000 });
  await page.waitForFunction(() => (window.__thongKeVe?.calls ?? 0) > 0, null, { timeout: 90000 });
  await page.waitForTimeout(7000);
  // CUỘN hết danh sách ảo hoá, gom mọi trạng thái gặp được
  const gom = {}; let buoc = 0;
  const cuon = await page.evaluate(() => { const el = document.querySelector('[data-testid="danh-sach-may"]'); const sc = el?.querySelector("[style*='overflow'], .overflow-y-auto, ul") ?? el; return { sh: sc?.scrollHeight ?? 0, ch: sc?.clientHeight ?? 0 }; });
  for (let y = 0; y <= 40; y += 1) {
    const g = await page.evaluate(GOM);
    for (const [k, v] of Object.entries(g)) { if (!gom[k]) gom[k] = v; else gom[k].so += v.so; }
    buoc += 1;
    const con = await page.evaluate(() => { const el = document.querySelector('[data-testid="danh-sach-may"]'); const cands = [el, ...(el?.querySelectorAll("*") ?? [])].filter((e) => e && e.scrollHeight > e.clientHeight + 4); const sc = cands[0]; if (!sc) return false; const truoc = sc.scrollTop; sc.scrollTop = truoc + sc.clientHeight * 0.8; return sc.scrollTop > truoc; });
    if (!con) break;
    await page.waitForTimeout(220);
  }
  kq.danhSach = { cuon, buocCuon: buoc, theoTrangThai: gom, soTrangThai: Object.keys(gom).length, soMauKhacNhau: [...new Set(Object.values(gom).map((v) => v.mau))].length };
  console.log(`  danh-sach-may: cuộn ${buoc} bước (scrollHeight ${cuon.sh}/clientHeight ${cuon.ch}) ⇒ ${kq.danhSach.soTrangThai} trạng thái, ${kq.danhSach.soMauKhacNhau} màu khác nhau`);
  for (const [k, v] of Object.entries(gom)) console.log(`      ${k.padEnd(12)} ${String(v.so).padStart(4)} hàng · màu ${v.mau} · opacity ${v.opacity} · hoạ tiết ${v.hoaTiet}/viền ${v.boxShadow} · chữ ${JSON.stringify(v.chuCuoi)}`);
  await page.screenshot({ path: `${ANH}/F-F5b-danh-sach-cuoi-cuon.png` }).catch(() => {});
  await ctx.close();

  // phân bố HẠNG sức khoẻ của tầng đông = đầu vào của vòng viền 3D
  const c2 = await browser.newContext(); await c2.addCookies(ck);
  for (const [nhan, tang] of [["tang-dong-88", T.tang]]) {
    const r = await c2.request.get(`${BASE}/api/trpc/twinCanh.sucKhoeMay?input=${encodeURIComponent(JSON.stringify({ json: { factoryId: T.nm, tangIds: [tang] } }))}`);
    const j = JSON.parse(await r.text());
    const khai = j?.result?.data?.json?.khai ?? [];
    const bayGio = Date.now();
    const pb = {}; for (const k of khai) { const h = hangSucKhoe(k, bayGio); pb[h] = (pb[h] || 0) + 1; }
    const coVien = Object.entries(pb).filter(([h]) => MAU_VIEN[h] != null);
    kq.sucKhoe = { nhan, soLoiKhai: khai.length, phanBoHang: pb, soVienPhaiVe: coVien.reduce((a, [, n]) => a + n, 0), mauPhaiVe: coVien.map(([h]) => `${h}=${MAU_VIEN[h]}`), mienDiem: khai.length ? [Math.min(...khai.map((k) => k.diem ?? 999)), Math.max(...khai.map((k) => k.diem ?? -1))] : null, mucKhan: [...new Set(khai.map((k) => k.mucKhan))] };
    console.log(`\n  twinCanh.sucKhoeMay(tầng ${tang}) → ${khai.length} lời khai · phân bố hạng ${JSON.stringify(pb)}`);
    console.log(`      ⇒ số VÒNG VIỀN phải vẽ: ${kq.sucKhoe.soVienPhaiVe} · màu phải xuất hiện: ${JSON.stringify(kq.sucKhoe.mauPhaiVe)} · miền điểm ${JSON.stringify(kq.sucKhoe.mienDiem)} · mucKhan ${JSON.stringify(kq.sucKhoe.mucKhan)}`);
  }
  await c2.close();
  kq.datKienThieu = ["window.__demVien (hoặc tương đương) phơi bày TẬP VÒNG VIỀN ĐÃ VẼ + màu — sản phẩm có __demNhan và __demBadge nhưng KHÔNG có bộ đếm nào cho vòng viền sức khoẻ; cấm đọc pixel canvas (G34) ⇒ không dụng cụ nào chứng minh vòng viền THẬT SỰ được vẽ đúng màu theo hạng"];
} finally { ghi("F5b", kq); await browser.close(); }
