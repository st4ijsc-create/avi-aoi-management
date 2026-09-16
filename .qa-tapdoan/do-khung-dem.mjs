/**
 * do-khung-dem.mjs — ĐO THẬT bố cục panel trái của `/twin` ở HAI bề rộng.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO PHẢI LÀ PLAYWRIGHT, KHÔNG PHẢI jsdom
 * ════════════════════════════════════════════════════════════════════════════
 * `boCucPanelTrai.unit.test.ts` là MÔ HÌNH SỐ HỌC chạy trên jsdom, và jsdom
 * KHÔNG có bộ dựng bố cục: `getBoundingClientRect()`/`clientHeight`/
 * `scrollHeight` trả **0** ở mọi phần tử. Nên mọi khẳng định bố cục viết bằng
 * jsdom là XANH GIẢ — nó chỉ đo lại chính những hằng số viết tay mà người viết
 * đã gõ vào. Tệp này là đường đo ĐỘC LẬP: trình duyệt thật, bản dựng thật.
 *
 * ★ Đo PANEL TRÁI (DOM thuần) nên SwiftShader/GPU không ảnh hưởng — nhưng vẫn
 *   chờ cảnh vẽ xong trước khi đọc, vì một canvas chưa tải có thể làm flex
 *   chia lại chỗ và cho một số đo của trạng thái trung gian.
 *
 * Chạy:  node .qa-tapdoan/do-khung-dem.mjs --nhan=truoc
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const arg = (k, d) => {
  const m = process.argv.find((a) => a.startsWith(`--${k}=`));
  return m ? m.slice(k.length + 3) : d;
};
const BASE = arg("base", "http://localhost:3064");
const NHAN = arg("nhan", "truoc");
const TK = { username: arg("u", "e2e_tai_loE"), password: arg("p", "E2eTaiLoE!2026") };
const RA = ".qa-tapdoan/khung-dem";
mkdirSync(RA, { recursive: true });

/**
 * ĐỌC BỐ CỤC — chạy TRONG trình duyệt.
 *
 * ★ Mọi số là `getBoundingClientRect().height` (float, đã gồm cả phần lẻ), làm
 *   tròn 2 chữ số. KHÔNG dùng `offsetHeight` (số nguyên) vì sai số làm tròn
 *   cộng dồn qua 6 hằng là đủ để lệch một HÀNG.
 * ★ "Hàng ĐỦ" = hàng nằm TRỌN trong ô cuộn (đáy hàng ≤ đáy vùng nhìn thấy +
 *   0,5 px dung sai). Một hàng hở nửa dưới KHÔNG tính — người vận hành không
 *   đọc được một dòng bị cắt, và đó chính là đại lượng mà tiêu chí "≥3 hàng
 *   tồn đọng" của Đợt 57 nói tới.
 */
const DOC = () => {
  const q = (t) => document.querySelector(`[data-testid="${t}"]`);
  const h = (e) => (e ? Math.round(e.getBoundingClientRect().height * 100) / 100 : null);
  const panel = q("panel-trai");
  const dai = q("dai-canh-bao");
  const cuon = q("dai-canh-bao-cuon");
  const dsm = q("danh-sach-may");

  /** Số hàng nằm TRỌN trong ô cuộn (không tính hàng bị cắt). */
  const hangDu = (oCuon, cacHang) => {
    if (!oCuon || !cacHang.length) return null;
    const r = oCuon.getBoundingClientRect();
    return cacHang.filter((e) => {
      const b = e.getBoundingClientRect();
      return b.top >= r.top - 0.5 && b.bottom <= r.bottom + 0.5;
    }).length;
  };

  const hangCanhBao = [...document.querySelectorAll('[data-testid^="canh-bao-"]')].map(
    (b) => b.closest("li") ?? b,
  );
  const hangTonDong = hangCanhBao.filter(
    (li) => li.querySelector('[data-ton-dong="1"]') !== null,
  );
  // Ô cuộn của danh sách máy: phần tử cuộn được gần nhất bên trong `danh-sach-may`.
  const cuonMay =
    dsm === null
      ? null
      : [...dsm.querySelectorAll("*")].find(
          (e) => e.scrollHeight > e.clientHeight + 1 && getComputedStyle(e).overflowY !== "visible",
        ) ??
        [...dsm.querySelectorAll("*")].find((e) => {
          const s = getComputedStyle(e);
          return s.overflowY === "auto" || s.overflowY === "scroll";
        }) ??
        null;
  const hangMay = [...document.querySelectorAll('[data-testid^="may-hang-"]')];

  // Khung CỐ ĐỊNH của dải = mọi con của `dai-canh-bao` TRỪ ô cuộn.
  const khungDai =
    dai === null
      ? null
      : [...dai.children].filter((e) => e !== cuon).reduce((s, e) => s + e.getBoundingClientRect().height, 0);
  const khungDanhSach =
    dsm === null || cuonMay === null ? null : h(dsm) - cuonMay.getBoundingClientRect().height;

  return {
    vp: { w: window.innerWidth, h: window.innerHeight },
    url: location.pathname + location.search,
    // ── hằng mô hình
    panel: h(panel),
    caoNgoaiPanel: panel ? Math.round((window.innerHeight - panel.getBoundingClientRect().height) * 100) / 100 : null,
    khoiTongQuan: h(q("khoi-tong-quan")),
    bangSucKhoe: h(q("bang-suc-khoe")),
    daiChuyenCheDo: h(q("khoi-cay-phan-cap")),
    // ── dải cảnh báo
    daiBoc: dai?.parentElement ? h(dai.parentElement) : null,
    dai: h(dai),
    daiCuonNhinThay: cuon ? Math.round(cuon.clientHeight * 100) / 100 : null,
    daiCuonNoiDung: cuon ? Math.round(cuon.scrollHeight * 100) / 100 : null,
    khungDaiCanhBao: khungDai === null ? null : Math.round(khungDai * 100) / 100,
    daiPhamVi: h(q("dai-pham-vi")),
    tieuDeNhomTonDong: h(q("nhom-ton-dong")),
    tieuDeNhomHomNay: h(q("nhom-hom-nay")),
    soHangCanhBao: hangCanhBao.length,
    soHangTonDong: hangTonDong.length,
    caoHangTonDong: hangTonDong.length ? h(hangTonDong[0]) : null,
    caoHangCanhBao: hangCanhBao.length ? h(hangCanhBao[0]) : null,
    hangTonDongDu: hangDu(cuon, hangTonDong),
    hangCanhBaoDu: hangDu(cuon, hangCanhBao),
    // ── danh sách máy
    danhSachMay: h(dsm),
    khungDanhSach: khungDanhSach === null ? null : Math.round(khungDanhSach * 100) / 100,
    dongTienTo: h(q("danh-sach-may-tien-to")),
    soHangMay: hangMay.length,
    caoHangMay: hangMay.length ? h(hangMay[0]) : null,
    hangMayDu: hangDu(cuonMay, hangMay),
    // ── chứng cứ phụ
    tieuDeDai: q("dai-tieu-de")
      ? {
          chu: q("dai-tieu-de").textContent.trim(),
          soHien: q("dai-tieu-de").getAttribute("data-so-hien"),
          soTong: q("dai-tieu-de").getAttribute("data-so-tong"),
        }
      : null,
    lopThe: {
      daiBoc: dai?.parentElement?.getAttribute("class") ?? null,
      danhSach: dsm?.getAttribute("class") ?? null,
    },
  };
};

const browser = await chromium.launch({ args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"] });
const kq = { nhan: NHAN, luc: new Date().toISOString(), base: BASE, tk: TK.username, do: {} };
try {
  for (const [ten, vp] of [
    ["1280x720", { width: 1280, height: 720 }],
    ["1600x900", { width: 1600, height: 900 }],
  ]) {
    const ctx = await browser.newContext({ viewport: vp });
    const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: TK });
    if (r.status() !== 200) throw new Error(`đăng nhập thất bại: ${r.status()} ${(await r.text()).slice(0, 200)}`);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/twin`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForSelector('[data-testid="panel-trai"]', { timeout: 90_000 });
    // Chờ cảnh 3D vẽ xong: panel co lại lúc canvas chưa tải sẽ cho số của trạng thái trung gian.
    await page
      .waitForFunction(() => (window.__thongKeVe?.calls ?? 0) > 0, null, { timeout: 90_000 })
      .catch(() => {});
    await page
      .waitForFunction(() => document.querySelectorAll(".animate-spin").length === 0, null, { timeout: 30_000 })
      .catch(() => {});
    await page
      .waitForFunction(() => document.querySelectorAll('[data-testid^="canh-bao-"]').length > 0, null, { timeout: 45_000 })
      .catch(() => {});
    await page.waitForTimeout(1500);

    kq.do[ten] = await page.evaluate(DOC);
    const p = `${RA}/${NHAN}-${ten}.png`;
    await page.screenshot({ path: p });
    kq.do[ten].anh = p;
    const pPanel = `${RA}/${NHAN}-${ten}-panel.png`;
    await page.locator('[data-testid="panel-trai"]').screenshot({ path: pPanel }).catch(() => {});
    kq.do[ten].anhPanel = pPanel;
    console.log(`── ${ten} ──`);
    console.log(JSON.stringify(kq.do[ten], null, 1));
    await ctx.close();
  }
  writeFileSync(`${RA}/${NHAN}.json`, JSON.stringify(kq, null, 1));
  console.log(`\nĐÃ GHI ${RA}/${NHAN}.json`);
} finally {
  await browser.close();
}
