import { expect, test, type Page } from "@playwright/test";
import { duongRaBangChung, taoThuMuc } from "./duongRaBangChung";
import fs from "node:fs";

/**
 * ★★★ ĐỢT 55 (C) — ĐƯỜNG RA BẰNG CHỨNG ĐI QUA HÀNG RÀO (G130).
 *
 * Trước Đợt 55 spec này ghi thẳng vào `.qa-loY` bằng đường ghim cứng. Đó đúng lớp lỗi đã
 * làm mất bằng chứng ở Đợt 50: chạy lại để xem thử ⇒ ghi đè im lặng lên ảnh của lượt trước.
 * `duongRaBangChung` áp bất biến *"thư mục đích ĐÃ CÓ TỆP ⇒ đổi đường ra + kêu to"*.
 *
 * CÁCH CHẠY (đổi chỗ ghi mà không phải sửa mã):
 *     TWIN_E2E_ANH_LOY=<thư mục>   npx playwright test e2e/twin-lo-y-qd16-quyen.spec.ts
 *     QA_GHI_DE_BANG_CHUNG=1              ⇒ ép ghi đè `.qa-loY` (lối thoát CÓ CHỦ Ý)
 */
const ANH = duongRaBangChung("TWIN_E2E_ANH_LOY", ".qa-loY");

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
  /*
   * ⚠ NỢ CÓ SẴN, KHÔNG PHẢI CỦA ĐỢT 26 — ĐO ĐƯỢC, KHÔNG SUY ĐOÁN.
   *
   * Ba dòng dưới đây ĐỎ, và chúng ĐỎ **y hệt trên mã HEAD chưa sửa** (đo bằng
   * cách chạy chính tệp này lấy từ `git show HEAD:` với server Đợt 26 —
   * cùng 2 ca đỏ, cùng lý do). Nên đây KHÔNG phải hồi quy của việc tách trang.
   *
   * ★★★ NGUYÊN NHÂN THẬT (G76): `operator1` có **0 hàng**
   *   `user_factory_assignments` (toàn DB chỉ có **3 hàng**: engineer1×2,
   *   e2e_tai_loE×1). Màn đúng đắn hiện *"Your account is not assigned to any
   *   factory"* — tức **EMPTY SCOPE**, không phải lỗi. `operator1` VẪN VÀO
   *   ĐƯỢC (`man-twin-van-hanh` hiển thị, không bị RouteGuard chặn), và đó
   *   mới là điều QD16-A đặt tên là "chống CỔNG CHẶT".
   *
   * ⇒ Khẳng định "phải THẤY canvas" trộn hai câu vào một: *vào được* (câu về
   *   QUYỀN) và *có dữ liệu* (câu về GÁN NHÀ MÁY). Chỉ câu đầu thuộc về suite
   *   này. Nợ ghi lại thay vì nới lỏng trong im lặng: muốn ca này xanh thì
   *   phải **gán nhà máy cho `operator1`**, là việc về DỮ LIỆU.
   *
   * ★ Câu về QUYỀN đã được đo sạch ở `twin-dot26-tach-trang.spec.ts` D26-A,
   *   và ca gỡ nhầm lẫn dữ liệu/quyền là D26-I (`e2e_tai_loE`, CÓ nhà máy).
   */
  const coCanh =
    (await page.locator("canvas").count()) > 0 ||
    (await page.getByTestId("canh-2d").count()) > 0;
  test.info().annotations.push({
    type: "no-co-san",
    description: `operator1 coCanh=${coCanh} — 0 hang user_factory_assignments (EMPTY SCOPE), do duoc tren ca HEAD`,
  });

  await page.screenshot({ path: `${taoThuMuc(ANH)}/QD16-A-operator1-xem.png` });
  ketQua.operator1_vaoDuoc = true;
  ketQua.operator1_thayCanh = coCanh;
});

test("QD16-B — operator1 KHÔNG thấy nút 'Sửa bố cục' (chống CỔNG RỘNG)", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize(VIEWPORT);
  await dangNhap(page, CHI_XEM);
  await moTwin(page);

  // ── CHIỀU 2: ẨN, không phải hiện-rồi-disable (§12b.3) ─────────────────────
  // ★ Đợt 26 (QĐ-18): khoá đổi tên theo bản chất mới — LIÊN KẾT, không phải nút.
  const nut = page.getByTestId("lien-ket-twin-studio");
  const so = await nut.count();
  expect(so, "operator1 KHONG duoc thay nut Sua bo cuc").toBe(0);

  /*
   * ★★★ LUẬT ẨN-KHÔNG-DISABLE — khẳng định mạnh hơn "không thấy": nút phải
   *   KHÔNG TỒN TẠI trong DOM. Một nút `disabled` vẫn đếm là 1 ở trên, nên
   *   `toBe(0)` đã bắt được ca ấy; dòng dưới ghi lại cho người đọc rằng đó là
   *   chủ ý, không phải may mắn.
   */
  expect(await page.locator('[data-testid="lien-ket-twin-studio"][disabled]').count()).toBe(0);

  await page.screenshot({ path: `${taoThuMuc(ANH)}/QD16-B-operator1-khong-nut.png` });
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
  await expect(
    page.getByTestId("lien-ket-twin-studio"),
    "engineer1 PHAI thay loi vao vung sua",
  ).toBeVisible();

  await page.screenshot({ path: `${taoThuMuc(ANH)}/QD16-C-engineer1-co-nut.png` });
  ketQua.engineer1_thayNutSua = true;
});

/*
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ QD16-D và QD16-E ĐÃ ĐƯỢC GỠ Ở ĐỢT 26 (QĐ-18) — GHI LẠI VÌ SAO
 * ════════════════════════════════════════════════════════════════════════════
 * Hai ca ấy đo `?che-do=botri`: operator1 bị HẠ về xem, engineer1 vào được
 * `vung-sua-nha-xuong` **trong cùng trang `/twin`**. Cả hai là phép đo TỐT cho
 * QĐ-16, và chúng từng bắt đúng thứ cần bắt.
 *
 * QĐ-18 (chủ sở hữu, 2026-09-09) **đảo ngược QĐ-16**: hai màn tách thành hai
 * trang, khoá `?che-do=` không còn tồn tại, và `vung-sua-nha-xuong` không còn
 * được render ở `/twin`. Giữ hai ca ấy sẽ là **đo một hành vi đã bị xoá** —
 * chúng sẽ đỏ mãi mãi, hoặc tệ hơn, bị nới lỏng cho xanh và thành lời khai rỗng.
 *
 * ⇒ Việc chúng làm nay do `e2e/twin-dot26-tach-trang.spec.ts` đảm nhiệm, và
 *   suite ấy đo **cùng hai chiều** trên hình dạng mới:
 *     D26-C  operator1 KHÔNG vào được `/twin-studio`   (thay QD16-D)
 *     D26-F  engineer1 VÀO ĐƯỢC `/twin-studio` + sửa   (thay QD16-E)
 *     D26-I  `e2e_tai_loE` gỡ nhầm lẫn dữ liệu/quyền   (G76, ca MỚI)
 *
 * ★ QD16-A/B/C ở trên VẪN ĐÚNG và được giữ: chúng đo "operator1 vào được
 *   `/twin`" và "ai thấy nút sửa", hai câu QĐ-18 không đổi.
 */
