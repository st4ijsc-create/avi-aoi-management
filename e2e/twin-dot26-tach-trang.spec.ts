import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import { duongRaBangChung, taoThuMuc } from "./duongRaBangChung";

/**
 * ════════════════════════════════════════════════════════════════════════════
 * ĐỢT 26 — ★★★ NGHIỆM THU **HAI CHIỀU** CHO QĐ-18 (§13c.2, thay QĐ-16)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * QĐ-18 tách `/twin` và `/twin-studio` thành HAI TRANG. Việc tách hỏng được
 * theo **hai chiều ngược nhau**, nên một chiều đo là chưa đo gì:
 *
 *   ┌─ CỔNG CHẶT ─ `operator1` **mất `/twin`**. = tai nạn Đợt 3 CHẶN-1.
 *   └─ CỔNG RỘNG ─ `operator1` **vào được `/twin-studio`** / thấy lối vào nó.
 *                  = đổi mô hình an toàn, không phải đổi giao diện.
 *
 * ⇒ Suite này khẳng định CẢ SÁU ô, không phải hai:
 *
 *              │ /twin      │ /twin-studio │ liên kết sửa trên /twin
 *   ───────────┼────────────┼──────────────┼────────────────────────
 *   operator1  │ VÀO ĐƯỢC   │ KHÔNG VÀO    │ KHÔNG THẤY
 *   engineer1  │ VÀO ĐƯỢC   │ VÀO + SỬA    │ THẤY
 *
 * ★★★ ĐO BẰNG VAI **KHÔNG-ADMIN** (G43). `hasPermission` trả `true` cho MỌI
 *   chuỗi khi `role === "admin"`, và server bypass `requirePermission`. Đo bằng
 *   admin cho "thấy" ở cả hai vai và **chứng minh SỐ 0**.
 *
 * ★ Quyền THẬT, đo lại trên bảng `permissions` 2026-09-09 (không kế thừa):
 *     operator1 : machine_status                    → XEM, KHÔNG SỬA
 *     engineer1 : machine_control, machine_status,
 *                 settings_factory                  → XEM + SỬA
 */

const VIEWPORT = { width: 1280, height: 720 };
/**
 * ĐỢT 51 (mục B) — đường ra bằng chứng lấy từ ENV, và KHÔNG ghi đè thư mục đã có tệp.
 * (G130 — sự cố Đợt 50: chạy lại spec ghi đè bằng chứng của đợt cũ.)
 */
/**
 * ★★★ ĐỢT 55 (C) — CÁCH CHẠY (docblock này thiếu suốt các đợt trước; G130 nói rằng "một biến
 * môi trường mà người chạy phải NHỚ đặt không phải hàng rào" — nhưng nó vẫn phải được VIẾT RA).
 *
 *     TWIN_E2E_ANH_DOT26=<thư mục của ĐỢT ĐANG CHẠY>  *     PLAYWRIGHT_BASE_URL=http://localhost:<cổng dist của đợt đang chạy>  *     npx playwright test e2e/twin-dot26-tach-trang.spec.ts --workers=1 --output <thư mục của đợt>/pw-output
 *
  KHÔNG có config riêng ⇒ PHẢI tự đặt `--output <thư mục đợt>/pw-output` (xem chú thích dưới).
 *
 * ⚠ `--output` PHẢI trỏ ra ngoài `test-results/`: Playwright **DỌN SẠCH `outputDir` mỗi lượt**
 *   (đo được Đợt 55: sentinel đặt vào thư mục ấy BIẾN MẤT sau một lượt chạy), mà `test-results/`
 *   đang giữ 5 ảnh lô C ĐÃ COMMIT. Config gốc nay đặt `outputDir: ".qa-pw-output"`.
 * ⚠ Bỏ trống `TWIN_E2E_ANH_DOT26` thì `duongRaBangChung` tự đổi đường ra sang `.qa-dot26-lai-<mốc>`
 *   và IN CẢNH BÁO — không ghi đè im lặng lên bằng chứng của đợt trước.
 */
const ANH = duongRaBangChung("TWIN_E2E_ANH_DOT26", ".qa-dot26");

const CHI_XEM = { username: "operator1", password: "User@123" };
const SUA_DUOC = { username: "engineer1", password: "User@123" };
/*
 * ★★★ G76 — VAI KHÔNG-ADMIN LÀ ĐIỀU KIỆN **CẦN, KHÔNG ĐỦ**.
 * `operator1` có **0 hàng** `user_factory_assignments` (đo 2026-09-09) ⇒ cảnh
 * RỖNG. Nên "không thấy liên kết" ở D26-B có **HAI nguyên nhân khả dĩ** cho
 * cùng một quan sát: thiếu QUYỀN, hay thiếu DỮ LIỆU? `e2e_tai_loE` tách đôi
 * chúng: **1 nhà máy** (có dữ liệu) **và** có `machine_control` (có quyền).
 * Nó THẤY liên kết ⇒ thứ quyết định là QUYỀN, không phải dữ liệu.
 */
const CO_DU_LIEU = { username: "e2e_tai_loE", password: "E2eTaiLoE!2026" };

/*
 * ★★★ ĐĂNG NHẬP MỘT LẦN MỖI VAI, DÙNG LẠI PHIÊN — VÀ VÌ SAO PHẢI THẾ.
 *
 * `createAuthLimiter` (server/_core/rateLimitConfig.ts:436) chặn **30 lượt
 * đăng nhập / 15 phút / IP**. Suite này có 9 ca; chạy lại vài lượt là chạm
 * trần và server trả **429**. Đo được thật: một lượt chạy lại cho 4 ca đỏ, và
 * cả 4 đỏ ở dòng `dang nhap`, KHÔNG ở dòng khẳng định.
 *
 * ⚠ Đây đúng lớp "âm-tính-giả nằm ở THIẾT BỊ ĐO": 4 ô đỏ trông như bản vá
 *   hỏng, thật ra là hàng rào brute-force đang làm đúng việc của nó. Lối
 *   thoát SAI là nới `AUTH_RATE_LIMIT_PER_15MIN` — làm vậy là sửa hệ thống
 *   cho vừa phép đo, và làm yếu đúng thứ ta đang muốn tin.
 * ⇒ Lối thoát ĐÚNG: đăng nhập MỘT lần mỗi vai (3 lượt cho cả suite), giữ
 *   cookie trong `storageState`, và tái sử dụng.
 */
const PHIEN = new Map<string, string>();

async function dangNhap(page: Page, tk: { username: string; password: string }) {
  const daCo = PHIEN.get(tk.username);
  if (daCo) {
    await page.context().addCookies(JSON.parse(daCo));
    return;
  }
  const res = await page.request.post("/api/auth/login", { data: tk });
  expect(res.status(), `dang nhap ${tk.username}`).toBe(200);
  // ★ Khẳng định danh tính SAU khi đăng nhập: một phiên còn sót của vai trước
  //   sẽ làm cả suite đo nhầm người mà không lỗi nào nổ.
  const me = await page.request.get("/api/auth/me");
  if (me.ok()) {
    const body = await me.json().catch(() => null);
    const ten = body?.username ?? body?.user?.username;
    if (ten) expect(ten, "phien phai dung vai vua dang nhap").toBe(tk.username);
  }
  PHIEN.set(tk.username, JSON.stringify(await page.context().cookies()));
}

test.beforeAll(() => {
  // G65 — thư mục ảnh RIÊNG. `test-results/` có 5 ảnh lô C ĐÃ COMMIT; ghi vào
  // đó là sửa artefact của đợt khác mà không ai thấy trong diff.
  fs.mkdirSync(ANH, { recursive: true });
});

test.use({ viewport: VIEWPORT });

/* ════════════════════════════════════════════════════════════════════════ */
/* CHIỀU 1 — `operator1` (CHỈ XEM)                                          */
/* ════════════════════════════════════════════════════════════════════════ */

test("D26-A — operator1 VÀO ĐƯỢC /twin (chống cổng CHẶT)", async ({ page }) => {
  await dangNhap(page, CHI_XEM);
  await page.goto("/twin", { waitUntil: "domcontentloaded" });
  // Màn thật render ⇒ không bị RouteGuard chặn.
  await page.waitForSelector('[data-testid="man-twin-van-hanh"]', { timeout: 90_000 });
  await page.waitForTimeout(4_000);
  await page.screenshot({ path: `${ANH}/A1-operator1-twin.png`, fullPage: false });
  expect(page.url()).toContain("/twin");
});

test("D26-B — ★★★ operator1 KHÔNG THẤY liên kết sang studio (ẩn-không-disable)", async ({
  page,
}) => {
  await dangNhap(page, CHI_XEM);
  await page.goto("/twin", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="man-twin-van-hanh"]', { timeout: 90_000 });
  await page.waitForTimeout(4_000);
  // ẨN, không phải disable: đếm 0 phần tử, không kiểm thuộc tính `disabled`.
  await expect(page.getByTestId("lien-ket-twin-studio")).toHaveCount(0);
  // ★ Khoá cũ `nut-sua-bo-cuc` đã ĐỔI TÊN ở Đợt 26; khẳng định nó vắng mặt
  //   với MỌI vai là vô nghĩa (nó vắng ở khắp nơi). Câu đúng nằm ở dòng trên.
  await page.screenshot({ path: `${ANH}/A2-operator1-khong-lien-ket.png` });
});

test("D26-C — ★★★ operator1 KHÔNG VÀO ĐƯỢC /twin-studio (chống cổng RỘNG)", async ({
  page,
}) => {
  await dangNhap(page, CHI_XEM);
  await page.goto("/twin-studio", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6_000);
  // G43 — đo BỀ MẶT, không đo mã HTTP: SPA trả 200 cho mọi đường. Thứ chứng
  // minh cổng đóng là màn thiết kế KHÔNG render.
  await expect(page.getByTestId("man-twin-studio")).toHaveCount(0);
  await expect(page.locator("text=/Dựng nhà xưởng|Nhập bản vẽ/i")).toHaveCount(0);
  await page.screenshot({ path: `${ANH}/A3-operator1-studio-bi-chan.png` });
});

/* ════════════════════════════════════════════════════════════════════════ */
/* CHIỀU 2 — `engineer1` (SỬA ĐƯỢC) — ĐỐI CHỨNG DƯƠNG BẮT BUỘC              */
/* ════════════════════════════════════════════════════════════════════════ */

test("D26-D — engineer1 VÀO ĐƯỢC /twin", async ({ page }) => {
  await dangNhap(page, SUA_DUOC);
  await page.goto("/twin", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="man-twin-van-hanh"]', { timeout: 90_000 });
  await page.waitForTimeout(4_000);
  await page.screenshot({ path: `${ANH}/B1-engineer1-twin.png` });
});

test("D26-E — ★★★ ĐỐI CHỨNG DƯƠNG: engineer1 THẤY liên kết sang studio", async ({ page }) => {
  await dangNhap(page, SUA_DUOC);
  await page.goto("/twin", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="man-twin-van-hanh"]', { timeout: 90_000 });
  await page.waitForTimeout(4_000);
  // Thiếu ca này, một liên kết KHÔNG BAO GIỜ render làm D26-B xanh mà đo số 0.
  await expect(page.getByTestId("lien-ket-twin-studio")).toHaveCount(1);
  await expect(page.getByTestId("lien-ket-twin-studio")).toHaveAttribute(
    "href",
    "/twin-studio",
  );
  await page.screenshot({ path: `${ANH}/B2-engineer1-co-lien-ket.png` });
});

test("D26-F — ★★★ ĐỐI CHỨNG DƯƠNG: engineer1 VÀO ĐƯỢC /twin-studio", async ({ page }) => {
  await dangNhap(page, SUA_DUOC);
  await page.goto("/twin-studio", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8_000);
  // Thiếu ca này, một `/twin-studio` HỎNG HẲN cũng làm D26-C xanh.
  await expect(page.getByTestId("man-twin-studio")).toHaveCount(1);
  await page.screenshot({ path: `${ANH}/B3-engineer1-studio.png`, fullPage: false });
});

test("D26-G — ★ LIÊN KẾT THẬT SỰ ĐI: bấm nút trên /twin ⇒ tới /twin-studio", async ({
  page,
}) => {
  await dangNhap(page, SUA_DUOC);
  await page.goto("/twin", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="man-twin-van-hanh"]', { timeout: 90_000 });
  await page.waitForTimeout(4_000);
  await page.getByTestId("lien-ket-twin-studio").click();
  await page.waitForTimeout(8_000);
  expect(page.url()).toContain("/twin-studio");
  await expect(page.getByTestId("man-twin-studio")).toHaveCount(1);
  await page.screenshot({ path: `${ANH}/B4-bam-lien-ket-sang-studio.png` });
});

/* ════════════════════════════════════════════════════════════════════════ */
/* G40 — URL CŨ KHÔNG ĐƯỢC THÀNH LỖI CÂM                                    */
/* ════════════════════════════════════════════════════════════════════════ */

test("D26-H — ★★★ G40: `/layout` (ý định SỬA) tới /twin-studio, không tới màn chỉ-đọc", async ({
  page,
}) => {
  await dangNhap(page, SUA_DUOC);
  await page.goto("/layout", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8_000);
  expect(page.url(), "URL cu cua nguoi muon SUA phai toi trang SUA").toContain("/twin-studio");
  await page.screenshot({ path: `${ANH}/C1-layout-redirect.png` });
});

test("D26-I — ★★★ G76: `e2e_tai_loE` (CÓ dữ liệu + CÓ quyền) THẤY liên kết", async ({
  page,
}) => {
  /*
   * Đây là ca gỡ NHẦM LẪN NGUYÊN NHÂN cho D26-B, không phải một ca lặp:
   * nó chứng minh liên kết vắng ở `operator1` vì QUYỀN, chứ không vì cảnh rỗng.
   */
  await dangNhap(page, CO_DU_LIEU);
  await page.goto("/twin", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="man-twin-van-hanh"]', { timeout: 90_000 });
  await page.waitForTimeout(5_000);
  await expect(page.getByTestId("lien-ket-twin-studio")).toHaveCount(1);
  await page.screenshot({ path: `${ANH}/D1-e2e_tai_loE-co-du-lieu-co-lien-ket.png` });
});

/* ════════════════════════════════════════════════════════════════════════ */
/* RB-4 — MỘT `<Canvas>` WebGL SỐNG TẠI MỘT THỜI ĐIỂM, QUA RANH GIỚI TRANG  */
/* ════════════════════════════════════════════════════════════════════════ */

test("D26-J — ★★★ RB-4 vẫn giữ SAU khi tách: điều hướng KHÔNG đẻ context thứ hai", async ({
  page,
}) => {
  /*
   * Đợt 21 giữ RB-4 bằng một `? :` trong cây React (hai vùng loại trừ nhau).
   * Đợt 26 tách hai trang, nên câu hỏi đổi: **wouter có unmount trang cũ
   * trước khi mount trang mới không?** Nếu không, hai `<Canvas>` cùng sống và
   * trình duyệt giết context cũ TRONG IM LẶNG — không lỗi nào nổ, chỉ cảnh 3D
   * đen thui ở lần quay lại.
   *
   * ⇒ Đo bằng cách ĐI QUA ranh giới thật, không suy luận từ mã.
   */
  await dangNhap(page, SUA_DUOC);
  await page.goto("/twin", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="man-twin-van-hanh"]', { timeout: 90_000 });
  await page.waitForTimeout(6_000);
  expect(await page.locator("canvas").count(), "/twin phai co dung 1 canvas").toBe(1);

  await page.getByTestId("lien-ket-twin-studio").click();
  await page.waitForSelector('[data-testid="man-twin-studio"]', { timeout: 90_000 });
  await page.waitForTimeout(8_000);

  // ★ Sau điều hướng: canvas của `/twin` PHẢI đã bị unmount.
  expect(
    await page.locator("canvas").count(),
    "sau dieu huong phai con dung 1 canvas — 2 la vi pham RB-4",
  ).toBe(1);
  // `KhungCanh` tự đếm; nó là mô hình đo THỨ HAI, độc lập với `locator`.
  expect(await page.evaluate(() => (window as unknown as { __soCanvas?: number }).__soCanvas)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: `${ANH}/E1-rb4-sau-dieu-huong.png` });
});
