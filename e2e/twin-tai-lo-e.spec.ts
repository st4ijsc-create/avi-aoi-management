import { test, expect, type Page } from "@playwright/test";
import { duongRaBangChung, taoThuMuc } from "./duongRaBangChung";

/**
 * ★★★ ĐỢT 55 (C) — ĐƯỜNG RA BẰNG CHỨNG ĐI QUA HÀNG RÀO (G130).
 *
 * Trước Đợt 55 spec này ghi thẳng vào `.qa-loE` bằng đường ghim cứng. Đó đúng lớp lỗi đã
 * làm mất bằng chứng ở Đợt 50: chạy lại để xem thử ⇒ ghi đè im lặng lên ảnh của lượt trước.
 * `duongRaBangChung` áp bất biến *"thư mục đích ĐÃ CÓ TỆP ⇒ đổi đường ra + kêu to"*.
 *
 * CÁCH CHẠY (đổi chỗ ghi mà không phải sửa mã):
 *     TWIN_E2E_ANH_LOE=<thư mục>   npx playwright test e2e/twin-tai-lo-e.spec.ts
 *     QA_GHI_DE_BANG_CHUNG=1              ⇒ ép ghi đè `.qa-loE` (lối thoát CÓ CHỦ Ý)
 */
const ANH = duongRaBangChung("TWIN_E2E_ANH_LOE", ".qa-loE");

/**
 * ============================================================================
 * LÔ E — ĐO TẢI màn Vận hành `/twin` trên nhà máy TỔNG HỢP
 * ============================================================================
 *
 * Suite này KHÔNG khẳng định gì về sản phẩm — nó **ĐO** và **IN SỐ**. Ngưỡng §4
 * được kiểm ở cuối, nhưng con số nguyên văn mới là sản phẩm của lô này.
 *
 * Chạy: server thật ở :3000 + DB đã sinh FUYU-F bằng `scripts/sinh-tai-twin.ts`.
 *   npx playwright test e2e/twin-tai-lo-e.spec.ts --reporter=line
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ G34 — `preserveDrawingBuffer=false` ⇒ TỔNG PIXEL = 0 GIỐNG HỆT CANVAS TRỐNG
 * ════════════════════════════════════════════════════════════════════════════
 * Không đọc pixel để chứng minh "có vẽ". Cửa kiểm dùng ở đây là
 * `window.__thongKeVe.calls > 0` — số đến từ `renderer.info.render` SAU khi khung
 * được vẽ (`KhungCanh.tsx:104-123`, ưu tiên -1), nên nó KHÔNG THỂ dương trên một
 * cảnh chưa vẽ. Đó là cửa kiểm frame-khác-rỗng, và mọi phép đo dưới đây chỉ chạy
 * SAU khi nó mở.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★ TÀI KHOẢN KHÔNG-ADMIN — bắt buộc
 * ════════════════════════════════════════════════════════════════════════════
 * Vai `admin` BYPASS `requirePermission`, nên đo bằng admin chứng minh SỐ 0 về
 * quyền. Tài khoản dưới đây vai `supervisor`, có đúng `analytics_oee` +
 * `machine_status` — hai quyền mà `navigation.tsx:446` đòi cho `/twin`.
 */
const TAI_KHOAN = {
  username: process.env.E2E_TAI_USER || "e2e_tai_loE",
  password: process.env.E2E_TAI_PASS || "E2eTaiLoE!2026",
};

interface ThongKe {
  calls: number;
  triangles: number;
  matContext: number;
  khoiPhuc: number;
}

interface KetQuaDo {
  nhan: string;
  taiMs: number;
  calls: number;
  triangles: number;
  soNhan: number;
  soCanvas: number;
  fpsXoay: number;
  heapMb: number;
  demMay: string;
}

const ketQua: KetQuaDo[] = [];

async function dangNhap(page: Page) {
  const res = await page.request.post("/api/auth/login", { data: TAI_KHOAN });
  expect(res.ok(), `dang nhap that bai: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = await res.json();
  // Cầu chì: nếu ai đó đổi tài khoản này thành admin thì phép đo quyền chết câm.
  expect(body.user.role, "PHAI la vai KHONG-admin").not.toBe("admin");
}

/**
 * Mở `/twin` và chờ khung ĐẦU TIÊN được vẽ thật.
 * Trả về thời gian từ lúc `goto` tới lúc `calls > 0` — "thời gian tải" của lô này.
 */
async function moTwin(page: Page, duong = "/twin"): Promise<number> {
  const t0 = Date.now();
  await page.goto(duong, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("man-twin-van-hanh")).toBeVisible({ timeout: 60_000 });
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __thongKeVe?: ThongKe };
      return (w.__thongKeVe?.calls ?? 0) > 0;
    },
    undefined,
    { timeout: 90_000 },
  );
  return Date.now() - t0;
}

/** Đo FPS bằng `requestAnimationFrame` TRONG KHI kéo chuột xoay camera. */
async function doFpsXoay(page: Page): Promise<number> {
  const box = await page.getByTestId("khoi-canh-3d").boundingBox();
  if (!box) return -1;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // Bật bộ đếm khung TRƯỚC khi kéo — `frameloop="demand"` nghĩa là không kéo thì
  // không có khung nào, và số đo sẽ là 0 mà không có gì sai.
  await page.evaluate(() => {
    const w = window as unknown as { __demKhung?: number; __dungDem?: () => void };
    w.__demKhung = 0;
    let chay = true;
    const tick = () => {
      if (!chay) return;
      w.__demKhung = (w.__demKhung ?? 0) + 1;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    w.__dungDem = () => {
      chay = false;
    };
  });

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  const t0 = Date.now();
  for (let i = 0; i < 40; i++) {
    await page.mouse.move(cx + Math.cos(i / 6) * 180, cy + Math.sin(i / 6) * 90);
    await page.waitForTimeout(25);
  }
  const dt = Date.now() - t0;
  await page.mouse.up();

  const khung = await page.evaluate(() => {
    const w = window as unknown as { __demKhung?: number; __dungDem?: () => void };
    w.__dungDem?.();
    return w.__demKhung ?? 0;
  });
  return Number(((khung * 1000) / dt).toFixed(1));
}

async function doTatCa(page: Page, nhan: string, duong = "/twin"): Promise<KetQuaDo> {
  const taiMs = await moTwin(page, duong);
  // Để cảnh ổn định (LOD, nhãn, dữ liệu realtime) trước khi chốt số.
  await page.waitForTimeout(2_500);

  const fpsXoay = await doFpsXoay(page);

  const so = await page.evaluate(() => {
    const w = window as unknown as {
      __thongKeVe?: ThongKe;
      __soCanvas?: number;
      performance: Performance & { memory?: { usedJSHeapSize: number } };
    };
    // Nhãn CSS2D/HTML của drei nằm trong DOM, đếm được trực tiếp.
    const nhanEls = document.querySelectorAll(
      "[data-testid^='nhan-'], .twin-nhan, [data-nhan-twin]",
    ).length;
    return {
      calls: w.__thongKeVe?.calls ?? -1,
      triangles: w.__thongKeVe?.triangles ?? -1,
      soCanvas: w.__soCanvas ?? -1,
      soNhan: nhanEls,
      heapMb: w.performance.memory
        ? Number((w.performance.memory.usedJSHeapSize / 1048576).toFixed(1))
        : -1,
    };
  });

  const demMay = await page
    .getByTestId("dem-may")
    .textContent()
    .catch(() => null);

  const kq: KetQuaDo = {
    nhan,
    taiMs,
    calls: so.calls,
    triangles: so.triangles,
    soNhan: so.soNhan,
    soCanvas: so.soCanvas,
    fpsXoay,
    heapMb: so.heapMb,
    demMay: (demMay ?? "?").trim(),
  };
  ketQua.push(kq);
  console.log(
    `\n[DO] ${nhan}\n` +
      `     thoi gian tai (toi khung dau)  = ${kq.taiMs} ms\n` +
      `     renderer.info.render.calls      = ${kq.calls}   (nguong §4: <= 150)\n` +
      `     renderer.info.render.triangles  = ${kq.triangles}   (nguong §4: <= 500000)\n` +
      `     FPS khi xoay                    = ${kq.fpsXoay}   (nguong §4: >= 30)\n` +
      `     so nhan DOM                     = ${kq.soNhan}   (nguong §4: <= 30)\n` +
      `     window.__soCanvas               = ${kq.soCanvas}   (RB-4: == 1)\n` +
      `     JS heap                         = ${kq.heapMb} MB\n` +
      `     dem-may tren man                = ${kq.demMay}`,
  );
  return kq;
}

test.describe.configure({ mode: "serial" });

test.describe("Lo E — do tai /twin", () => {
  test.beforeEach(async ({ page }) => {
    await dangNhap(page);
  });

  test("do tai nha may dau tien (factories[0])", async ({ page }) => {
    test.setTimeout(240_000);
    const kq = await doTatCa(page, "nha may mac dinh (factories[0])");

    // ★ G34 — cua kiem frame-khac-rong. Khong co dong nay thi moi so duoi la rac.
    expect(kq.calls, "khung chua duoc ve — moi so do vo nghia").toBeGreaterThan(0);
    expect(kq.soCanvas, "RB-4: dung MOT canvas").toBe(1);

    await page.screenshot({ path: `${taoThuMuc(ANH)}/loE-1nhamay.png`, fullPage: false });
  });

  /**
   * ★ Yêu cầu bổ sung của chủ sở hữu: đo TĂNG DẦN để thấy ĐƯỜNG CONG, không chỉ
   * một điểm. "Xem cùng lúc N toà" KHÔNG phải tiêu chí bắt buộc đạt — nó là phép
   * đo tìm NGƯỠNG GÃY, để đợt sau biết đặt chặn của ô chọn toà ở đâu.
   *
   * ⚠⚠ Đo được TRƯỚC khi viết test này (`TwinVanHanh.tsx:277-284`): màn chỉ nạp
   * `tangs[0]` của `toaNha[0]` của MỘT nhà máy. Nghĩa là **không có đường nào
   * trong UI hiện hơn một toà/một tầng cùng lúc** — nên "đường cong theo số toà"
   * KHÔNG đo được qua UI. Cái đo được là đường cong theo SỐ MÁY TRÊN MỘT TẦNG,
   * và đó chính là biến tải thật của cảnh 3D.
   */
  test("duong cong tai: pham vi tap doan (4 nha may)", async ({ page }) => {
    test.setTimeout(240_000);
    const kq = await doTatCa(page, "pham vi tap doan (pv=tapdoan, 4 nha may)", "/twin?pv=tapdoan");
    expect(kq.calls).toBeGreaterThan(0);
    await page.screenshot({ path: `${taoThuMuc(ANH)}/loE-tapdoan.png`, fullPage: false });
  });

  test.afterAll(() => {
    console.log("\n===== BANG TONG HOP LO E =====");
    console.log(
      ["nhan", "taiMs", "calls", "triangles", "fpsXoay", "soNhan", "heapMb", "demMay"].join(" | "),
    );
    for (const k of ketQua) {
      console.log(
        [k.nhan, k.taiMs, k.calls, k.triangles, k.fpsXoay, k.soNhan, k.heapMb, k.demMay].join(" | "),
      );
    }
  });
});
