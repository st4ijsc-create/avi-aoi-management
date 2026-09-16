/**
 * ph45-do.mjs — ĐO KẾT CỤC **PH-45 + PH-48** trên trình duyệt THẬT.
 *
 *   node .qa-tapdoan/ph45-do.mjs <nhan>      # nhan = "truoc" | "sau"
 *
 * ════════════════════════════════════════════════════════════════════════════
 * THƯỚC KHAI **TRƯỚC KHI ĐO** (luật 5 của chủ đợt: không đổi thước sau khi thấy đỏ)
 * ════════════════════════════════════════════════════════════════════════════
 *  ① PH-45 — **SỐ MÁY CÓ LỜI KHAI TRẠNG THÁI / SỐ MÁY CỦA PHẠM VI**.
 *     Tử số = `bang-kpi-noi[data-mau-so]`. Đó KHÔNG phải một con số tiện tay:
 *     sau PH-06, `mauSo = |overview.machines ∩ idMayTrongCanh|`, tức ĐÚNG ĐỊNH
 *     NGHĨA "máy vừa được cảnh nhận để vẽ, vừa có lời khai trạng thái".
 *
 *     ⚠⚠ MẪU SỐ — SỬA THIẾT BỊ ĐO, ĐỌC SỐ CŨ TRƯỚC KHI ĐỔI (luật 5).
 *     Bản đầu lấy mẫu số từ `__demTuongTac.dsMay().length`. Lượt đo "truoc" đầu
 *     tiên trả **-1 ở CẢ HAI vai**: ở `?pv=tapdoan`, Task 20 thay lô khối máy bằng
 *     SA BÀN (`LopSaBan`), nên `LoBatchMay` — nơi gắn `dsMay` — KHÔNG hề mount.
 *     Tức thiết bị đo không đo gì, chứ không phải sản phẩm sai.
 *     ⇒ Mẫu số nay lấy từ NGUỒN NGOÀI SẢN PHẨM: tổng `tongMay` của các công ty
 *       trong phạm vi vai, đọc thẳng `sinh-summary.json` (bộ sinh QATD đã ghi vào
 *       CSDL). Nó độc lập với mọi lời khai của trang — đó là điều làm phép so có
 *       nghĩa. Đối chiếu chéo: ô `dem-may` của panel trái đo được **1.108** ở lượt
 *       "truoc", khớp tổng ấy. `dsMay` vẫn được IN RA để giữ dấu vết.
 *     ĐẠT khi tử = mẫu và mẫu > 0.
 *
 *  ② PH-48 — **NHÃN `kpi-pham-vi` PHẢI NÓI VỀ ĐÚNG TẬP MẪU SỐ ĐANG ĐẾM**.
 *     Ở `?pv=tapdoan`: nhãn phải chứa TÊN MỌI công ty trong phạm vi vai và KHÔNG
 *     được chứa mắt xích toà/tầng ("Toà"/"Tầng"/"Floor"/"Building").
 *
 *  ③ ĐỐI CHỨNG ÂM — `banner-trang-thai-mot-nha-may` phải VẮNG MẶT sau vá (lời
 *     khai hạn chế đã chết). ⚠ Banner nằm TRONG dải việc hợp nhất và dải ấy MẶC
 *     ĐỊNH THU, nên phải MỞ dải ra trước khi đếm — đọc lúc thu cho 0 phần tử
 *     `banner-*` ở CẢ hai lượt, tức một ô luôn "ĐẠT" mà không đo gì.
 *
 *  ④ ĐƯỜNG ĐO ĐỘC LẬP (không qua UI) — gọi thẳng `factoryCommand.overview` bằng
 *     phiên của chính vai ấy, HAI lượt: `factoryIds:[nhà máy đầu]` và
 *     `factoryIds:[cả phạm vi]`.
 *     ⚠ MỘT lượt là KHÔNG ĐỦ, và lượt "truoc" đã chứng minh: bản chưa vá **bỏ
 *       qua** khoá `factoryIds` (Zod strip) rồi trả "mọi nhà máy trong phạm vi"
 *       ⇒ đúng 1.108 — một con số ĐÚNG ra từ một thủ tục KHÔNG hề đọc danh sách.
 *       Chỉ phép SO HAI LƯỢT mới phân biệt: chưa vá ⇒ hai lượt BẰNG nhau; đã vá
 *       ⇒ lượt một nhà máy NHỎ HƠN hẳn.
 *
 *  ⑤ NGÂN SÁCH VẼ (giữ nguyên thước Task 20): lệnh < 150 · tam giác < 500 k.
 *     Ở đây là ĐỐI CHỨNG HỒI QUY: nạp trạng thái của ba nhà máy KHÔNG được làm
 *     cảnh nặng thêm (dữ liệu trạng thái không sinh hình học).
 *
 * ⚠ `__demTuongTac`/`__demSaBan` chỉ gắn ở CHẾ ĐỘ ĐO ⇒ mọi URL mang `?do=1`.
 * ⚠ Khung hình đo trên ANGLE+GPU (Playwright mặc định SwiftShader ⇒ fps giả).
 */
import { chromium } from "playwright";
import fs from "node:fs";

const NHAN = process.argv[2] ?? "truoc";
const GOC = "http://localhost:3064";
const MK = "Qatd!2026";
const RA = `.qa-tapdoan/ph45-${NHAN}.json`;
const ANH = `.qa-tapdoan/anh/ph45-${NHAN}`;
fs.mkdirSync(ANH, { recursive: true });

const TT = JSON.parse(fs.readFileSync(".qa-tapdoan/sinh-summary.json", "utf8"));
/** Tổng máy của từng công ty, theo BỘ SINH — nguồn ngoài sản phẩm (xem ① ở trên). */
const MAY_THEO_CTY = new Map(TT.congTys.map((c) => [c.code, c.tongMay]));
const TEN_THEO_CTY = new Map(TT.congTys.map((c) => [c.code, c.ten ?? c.code]));

const VAI = [
  { ten: "qatd_giamdoc", moTa: "cap tap doan (gan TD QATD) - 3 cong ty", congTy: TT.congTys.map((c) => c.code) },
  { ten: "qatd_quanly", moTa: "chi gan QATD-A - 1 cong ty", congTy: ["QATD-A"] },
];
const tongMayCua = (v) => v.congTy.reduce((n, ma) => n + (MAY_THEO_CTY.get(ma) ?? 0), 0);

const ketQua = { nhan: NHAN, luc: new Date().toISOString(), vai: {} };

const trinh = await chromium.launch({
  args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"],
});

for (const v of VAI) {
  const ctx = await trinh.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const loi = [];
  page.on("pageerror", (e) => loi.push(String(e).slice(0, 200)));

  await page.request.post(`${GOC}/api/auth/login`, { data: { username: v.ten, password: MK } });
  await page.goto(`${GOC}/twin?pv=tapdoan&do=1`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("man-twin-van-hanh").waitFor({ timeout: 90_000 }).catch(() => {});
  // Đợi CẢ hình học (`__demSaBan`) LẪN trạng thái (`data-mau-so` khác rỗng) — hai
  // nguồn, hai nhịp; đo sớm một nhịp sẽ đọc được một nửa rồi gọi đó là kết cục.
  await page
    .waitForFunction(
      () => {
        const toa = window.__demSaBan?.bieuTuong?.()?.length ?? 0;
        const ms = document.querySelector("[data-testid='bang-kpi-noi']")?.getAttribute("data-mau-so");
        return toa > 0 && ms !== null && ms !== "" && ms !== "0";
      },
      undefined,
      { timeout: 120_000, polling: 1000 },
    )
    .catch(() => {});
  await page.waitForTimeout(4000);

  await page.screenshot({ path: `${ANH}/${v.ten}-canvas.png` });

  // ③ Mở dải việc hợp nhất TRƯỚC khi đếm banner (mặc định nó THU).
  await page.getByTestId("nut-mo-dai-hop-nhat").click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1000);

  const do1 = await page.evaluate(() => {
    const q = (id) => document.querySelector(`[data-testid='${id}']`);
    const kpi = q("bang-kpi-noi");
    const banner = [...document.querySelectorAll("[data-testid^='banner-']")].map((e) => ({
      id: e.getAttribute("data-testid"),
      chu: (e.textContent ?? "").trim().slice(0, 160),
    }));
    return {
      soToaSaBan: window.__demSaBan?.bieuTuong?.()?.length ?? -1,
      dsMay: window.__demTuongTac?.dsMay?.()?.length ?? -1,
      mauSo: kpi?.getAttribute("data-mau-so") ?? null,
      mauSoOee: kpi?.getAttribute("data-mau-so-oee") ?? null,
      nhanKpi: q("kpi-pham-vi")?.textContent?.trim() ?? null,
      kpiMauSoChu: q("kpi-mau-so")?.textContent?.trim() ?? null,
      kpiDangChay: q("kpi-dangChay")?.textContent?.trim() ?? null,
      demMay: q("dem-may")?.textContent?.trim() ?? null,
      breadcrumb: q("breadcrumb-twin")?.textContent?.trim() ?? null,
      soViec: q("dai-hop-nhat")?.getAttribute("data-so-viec") ?? null,
      calls: window.__thongKeVe?.calls ?? null,
      triangles: window.__thongKeVe?.triangles ?? null,
      banner,
      coBannerMotNhaMay: banner.some((b) => b.id === "banner-trang-thai-mot-nha-may"),
    };
  });

  // ④ Đường đo ĐỘC LẬP — hai lượt, phân biệt "đọc danh sách" với "bỏ qua danh sách".
  let api = null;
  try {
    const ids = await page.evaluate(async () => {
      const r = await fetch("/api/trpc/factory.list?input=" + encodeURIComponent(JSON.stringify({ json: {} })));
      const j = await r.json();
      const d = j?.result?.data?.json ?? j?.result?.data ?? [];
      return (Array.isArray(d) ? d : (d.items ?? [])).map((f) => f.id);
    });
    api = await page.evaluate(async (ds) => {
      const goi = async (x) => {
        const inp = encodeURIComponent(JSON.stringify({ json: { factoryIds: x } }));
        const r = await fetch("/api/trpc/factoryCommand.overview?input=" + inp);
        const j = await r.json();
        const d = j?.result?.data?.json ?? j?.result?.data ?? null;
        return { soMay: d?.machines?.length ?? null, loi: j?.error?.json?.message ?? j?.error?.message ?? null };
      };
      const mot = await goi(ds.slice(0, 1));
      const tatCa = await goi(ds);
      return { ids: ds, mot, tatCa, docDanhSach: mot.soMay !== null && tatCa.soMay !== null && mot.soMay < tatCa.soMay };
    }, ids);
  } catch (e) {
    api = { loi: String(e).slice(0, 200) };
  }

  const mauSoKyVong = tongMayCua(v);
  const nhan = do1.nhanKpi ?? "";
  const tenTrongPhamVi = v.congTy.map((ma) => TEN_THEO_CTY.get(ma) ?? ma);
  const dat1 = mauSoKyVong > 0 && String(do1.mauSo) === String(mauSoKyVong);
  const dat2 = tenTrongPhamVi.every((t) => nhan.includes(t)) && !/To[àa]|T[ầa]ng|Floor|Building/i.test(nhan);

  ketQua.vai[v.ten] = { ...do1, mauSoKyVong, tenTrongPhamVi, api, loi, dat_PH45: dat1, dat_PH48: dat2 };
  console.log(
    `[${NHAN}] ${v.ten.padEnd(14)} mauSo=${do1.mauSo}/${mauSoKyVong} (dsMay=${do1.dsMay} toaSaBan=${do1.soToaSaBan} dem-may=${do1.demMay}) ` +
      `PH45=${dat1 ? "ĐẠT" : "CHƯA"} PH48=${dat2 ? "ĐẠT" : "CHƯA"} ` +
      `api[1|N]=${api?.mot?.soMay}|${api?.tatCa?.soMay} docDanhSach=${api?.docDanhSach} ` +
      `soViec=${do1.soViec} banner=${do1.banner.length} bannerCu=${do1.coBannerMotNhaMay} ` +
      `calls=${do1.calls} tri=${do1.triangles} nhan="${nhan}"`,
  );
  await ctx.close();
}

await trinh.close();
fs.writeFileSync(RA, JSON.stringify(ketQua, null, 1));
console.log(`→ ${RA}`);
