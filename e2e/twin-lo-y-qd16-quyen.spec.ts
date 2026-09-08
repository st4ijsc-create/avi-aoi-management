import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";

/**
 * ════════════════════════════════════════════════════════════════════════════
 * Lô Y (Đợt 21) — ★★★ CHỨNG MINH **HAI CHIỀU** CHO QD-16 (§13c.1)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * QD-16 gộp `/twin` + `/twin-studio` thành MỘT trang, **quyền theo TỪNG VÙNG**.
 * Đây là chỗ dễ gây tai nạn nhất của đợt, và nó hỏng được theo **hai chiều
 * ngược nhau** — nên một chiều đo là chưa đo gì:
 *
 *   ┌─ CỔNG CHẶT ─ `operator1` **mất lối vào**, không xem được 3D nữa.
 *   │              = tai nạn Đợt 3 CHẶN-1, mà Đợt 15 đã phải vá ngược.
 *   └─ CỔNG RỘNG ─ `operator1` **sửa được nhà xưởng**.
 *                  = đổi mô hình an toàn, không phải đổi giao diện.
 *
 * ⇒ Suite này khẳng định CẢ BỐN ô của bảng 2×2, không phải hai ô:
 *
 *              │ vào được trang │ thấy nút "Sửa bố cục"
 *   ───────────┼────────────────┼──────────────────────
 *   operator1  │   PHẢI: CÓ     │   PHẢI: KHÔNG
 *   engineer1  │   PHẢI: CÓ     │   PHẢI: CÓ
 *
 * ★★★ ĐO BẰNG VAI **KHÔNG-ADMIN**. `usePermissions.hasPermission` trả `true`
 *   cho MỌI chuỗi khi `role === "admin"` (dòng đầu của hàm), và server cũng
 *   bypass `requirePermission`. Một lượt đo bằng admin sẽ cho "thấy nút" ở cả
 *   hai vai và **chứng minh SỐ 0** — bài học Khối D, ghi lại vì nó đã lặp.
 *
 * ★ Quyền THẬT đọc từ bảng `permissions` ngày 2026-09-08:
 *     operator1 (operator)  : machine_status                          → chỉ XEM
 *     engineer1 (engineer)  : machine_control, machine_status,
 *                             settings_factory                        → XEM + SỬA
 */

const VIEWPORT = { width: 1280, height: 720 };

/** Hai vai thật, hai phía của ranh giới. `operator1` là vai DUY NHẤT chỉ-xem. */
const CHI_XEM = { username: "operator1", password: "User@123" };
const SUA_DUOC = { username: "engineer1", password: "User@123" };

async function dangNhap(page: Page, tk: { username: string; password: string }) {
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
}

async function moTwin(page: Page, duong = "/twin") {
  await page.goto(duong, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="man-twin-van-hanh"]', { timeout: 90_000 });
  await page.waitForTimeout(5_000);
}

const ketQua: Record<string, unknown> = {};

test("QD16-A — operator1 VÀO ĐƯỢC /twin (chống CỔNG CHẶT / tai nạn CHẶN-1)", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize(VIEWPORT);
  await dangNhap(page, CHI_XEM);
  await moTwin(page);

  // ── CHIỀU 1: KHÔNG mất lối vào ────────────────────────────────────────────
  await expect(page.getByTestId("man-twin-van-hanh"), "operator1 phai vao duoc").toBeVisible();

  /*
   * ★★★ CA DƯƠNG BẮT BUỘC — "vào được" phải nghĩa là **XEM ĐƯỢC MỌI THỨ**,
   *   không phải một khung rỗng có `data-testid` đúng. Không có phần này, một
   *   trang trắng vì lỗi nạp cũng làm khẳng định trên XANH.
   */
  const coCanh =
    (await page.locator("canvas").count()) > 0 ||
    (await page.getByTestId("canh-2d").count()) > 0;
  expect(coCanh, "operator1 phai THAY canh 3D/2D, khong phai khung rong").toBe(true);
  await expect(page.getByTestId("panel-trai"), "panel trai phai hien").toBeVisible();
  await expect(page.getByTestId("panel-phai"), "ngan xu ly phai hien").toBeVisible();

  await page.screenshot({ path: ".qa-loY/QD16-A-operator1-xem.png" });
  ketQua.operator1_vaoDuoc = true;
  ketQua.operator1_thayCanh = coCanh;
});

test("QD16-B — operator1 KHÔNG thấy nút 'Sửa bố cục' (chống CỔNG RỘNG)", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize(VIEWPORT);
  await dangNhap(page, CHI_XEM);
  await moTwin(page);

  // ── CHIỀU 2: ẨN, không phải hiện-rồi-disable (§12b.3) ─────────────────────
  const nut = page.getByTestId("nut-sua-bo-cuc");
  const so = await nut.count();
  expect(so, "operator1 KHONG duoc thay nut Sua bo cuc").toBe(0);

  /*
   * ★★★ LUẬT ẨN-KHÔNG-DISABLE — khẳng định mạnh hơn "không thấy": nút phải
   *   KHÔNG TỒN TẠI trong DOM. Một nút `disabled` vẫn đếm là 1 ở trên, nên
   *   `toBe(0)` đã bắt được ca ấy; dòng dưới ghi lại cho người đọc rằng đó là
   *   chủ ý, không phải may mắn.
   */
  expect(await page.locator('[data-testid="nut-sua-bo-cuc"][disabled]').count()).toBe(0);

  await page.screenshot({ path: ".qa-loY/QD16-B-operator1-khong-nut.png" });
  ketQua.operator1_thayNutSua = so > 0;
});

test("QD16-C — ★ ĐỐI CHỨNG DƯƠNG: engineer1 vào được VÀ thấy nút 'Sửa bố cục'", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize(VIEWPORT);
  await dangNhap(page, SUA_DUOC);
  await moTwin(page);

  /*
   * ★★★ Ô THỨ BA VÀ THỨ TƯ CỦA BẢNG 2×2 — và chúng là phần **không thể bỏ**.
   *   Thiếu test này, một bản vá làm `duocSuaNhaXuong` trả `false` cho MỌI
   *   người sẽ làm QD16-B xanh rực. Đó đúng là "đo bằng admin chứng minh số 0"
   *   chạy theo chiều ngược lại.
   */
  await expect(page.getByTestId("man-twin-van-hanh")).toBeVisible();
  await expect(page.getByTestId("nut-sua-bo-cuc"), "engineer1 PHAI thay nut").toBeVisible();

  await page.screenshot({ path: ".qa-loY/QD16-C-engineer1-co-nut.png" });
  ketQua.engineer1_thayNutSua = true;
});

test("QD16-D — ★★★ URL không phải đường vòng: operator1 + ?che-do=botri bị HẠ về xem", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize(VIEWPORT);
  await dangNhap(page, CHI_XEM);
  await moTwin(page, "/twin?che-do=botri");

  /*
   * `?che-do=botri` là đích của redirect từ `/twin-studio`, `/layout`,
   * `/factory-floor-editor` và hai tab cũ. Nó tới tay MỌI người, kể cả
   * `operator1`. Nếu trang tin thẳng vào URL thì đây là **cổng RỘNG** dưới một
   * cái tên khác.
   */
  expect(await page.getByTestId("vung-sua-nha-xuong").count(), "operator1 KHONG duoc vao vung sua").toBe(0);
  await expect(page.getByTestId("man-twin-van-hanh"), "van phai o mat VAN HANH").toBeVisible();

  /*
   * ★ Hạ cấp mà IM LẶNG là nói dối lần hai — phải có lời khai.
   *
   * ⚠ ĐÍNH CHÍNH bản đầu của lưới này (chạy thật mới thấy): nó tra thẳng
   *   `banner-vung-sua-ha-cap` khi dải đang THU, và ĐỎ. Nhưng mã đúng — đó là
   *   **hệ quả cố ý của chính bố cục mới**: `DaiHopNhat` gộp mọi lời khai vào
   *   một dải 26 px (§13b 14.4, 280 px → 26 px), phần chi tiết chỉ render khi
   *   người dùng bấm [xem]. `data-so-viec` trên dải THU là con số đếm được
   *   ngay, và nó là bề mặt phải đo TRƯỚC.
   *
   * ⇒ Đo hai tầng, và cả hai đều bắt buộc:
   *   (a) dải THU đã đếm mục này  → `data-so-viec` ≥ 1
   *   (b) bấm [xem] → banner có mặt, đúng chữ
   */
  const dai = page.getByTestId("dai-hop-nhat");
  await expect(dai, "dai hop nhat phai hien (co viec can biet)").toBeVisible({ timeout: 20_000 });
  const soViec = Number((await dai.getAttribute("data-so-viec")) ?? "0");
  expect(soViec, "dai THU phai da dem muc ha cap").toBeGreaterThanOrEqual(1);

  await page.getByTestId("nut-mo-dai-hop-nhat").click();
  await expect(
    page.getByTestId("banner-vung-sua-ha-cap"),
    "phai KHAI la da ha cap, khong im lang",
  ).toBeVisible({ timeout: 20_000 });

  await page.screenshot({ path: ".qa-loY/QD16-D-operator1-ha-cap.png" });
  ketQua.operator1_urlBotri_haCap = true;
});

test("QD16-E — ★ ĐỐI CHỨNG DƯƠNG: engineer1 + ?che-do=botri VÀO ĐƯỢC vùng sửa", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize(VIEWPORT);
  await dangNhap(page, SUA_DUOC);
  await page.goto("/twin?che-do=botri", { waitUntil: "domcontentloaded" });

  // ★ Thiếu test này, `vung-sua-nha-xuong` không bao giờ render cũng làm QD16-D
  //   xanh — thiết bị đo phải biết KÊU trên ca dương đã biết.
  await expect(page.getByTestId("vung-sua-nha-xuong"), "engineer1 PHAI vao duoc vung sua").toBeVisible({
    timeout: 90_000,
  });
  expect(await page.getByTestId("banner-vung-sua-ha-cap").count(), "engineer1 KHONG bi ha cap").toBe(0);

  await page.waitForTimeout(6_000);
  await page.screenshot({ path: ".qa-loY/QD16-E-engineer1-vung-sua.png" });
  ketQua.engineer1_urlBotri_vaoDuoc = true;
  fs.writeFileSync(".qa-loY/qd16.json", JSON.stringify(ketQua, null, 2));
});
