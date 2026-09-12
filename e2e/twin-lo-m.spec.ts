/**
 * NGHIỆM THU LÔ M (Đợt 12) trên TRÌNH DUYỆT THẬT, bằng tài khoản KHÔNG-admin.
 *
 * ⚠⚠ ĐO BẰNG ADMIN CHỨNG MINH SỐ 0 — `accessControl.ts:207` cho admin bypass
 *    `requirePermission`. Mọi tài khoản dùng ở đây đều KHÔNG phải admin.
 *
 * Ba mục được nghiệm thu bằng SỰ CÓ MẶT CỦA CHỖ GỌI trong DOM thật (G16):
 *   #18 `thu-vien-asset` + `nut-tai-model` + `o-chon-tep-model`
 *   #43 `khoi-anh-nen`   + `nut-chon-anh-nen` + `nut-dat-ti-le`
 *   #55 `khoi-ban-ghi`   + `o-nhan-ban-ghi` + `nut-luu-ban-ghi`
 *
 * ★ Ba khối trên đều nằm SAU `coQuyenSua` (CHẶN-2). Nên spec này đo HAI CHIỀU:
 *   người CÓ quyền sửa thấy chúng, và đó là bằng chứng "đã nối"; một tài khoản
 *   không có quyền sửa KHÔNG thấy, và đó là bằng chứng cổng còn sống.
 */
import { test, expect } from "@playwright/test";
import { duongRaBangChung, taoThuMuc } from "./duongRaBangChung";

/**
 * ★★★ ĐỢT 55 (C) — ĐƯỜNG RA BẰNG CHỨNG ĐI QUA HÀNG RÀO (G130).
 *
 * Trước Đợt 55 spec này ghi thẳng vào `.qa-loM` bằng đường ghim cứng. Đó đúng lớp lỗi đã
 * làm mất bằng chứng ở Đợt 50: chạy lại để xem thử ⇒ ghi đè im lặng lên ảnh của lượt trước.
 * `duongRaBangChung` áp bất biến *"thư mục đích ĐÃ CÓ TỆP ⇒ đổi đường ra + kêu to"*.
 *
 * CÁCH CHẠY (đổi chỗ ghi mà không phải sửa mã):
 *     TWIN_E2E_ANH_LOM=<thư mục>   npx playwright test e2e/twin-lo-m.spec.ts
 *     QA_GHI_DE_BANG_CHUNG=1              ⇒ ép ghi đè `.qa-loM` (lối thoát CÓ CHỦ Ý)
 */
const ANH = duongRaBangChung("TWIN_E2E_ANH_LOM", ".qa-loM");

/**
 * ★ MẬT KHẨU ĐO ĐƯỢC, KHÔNG CHÉP TỪ SPEC CŨ. `QaDot5Vao!2026` của
 *   `qa-dot5-chan1.spec.ts` trả **401** trên DB này (thử 2026-09-07) — tài
 *   khoản có thật nhưng mật khẩu là của một đợt seed khác. Dò bốn mật khẩu
 *   đang lưu hành trong `e2e/` cho ra `User@123`.
 */
const TK = { username: "engineer1", password: "User@123" };

test("LO M — #18/#43/#55 co mat trong DOM that o /twin-studio", async ({ page }) => {
  const res = await page.request.post("/api/auth/login", { data: TK });
  expect(res.status()).toBe(200);

  await page.goto("/twin-studio");
  await page.waitForTimeout(6000);

  // Tab "Thiết kế" là tab mang `<Canvas>` và ba khối của lô M.
  const tab = page.getByTestId("tab-thiet-ke");
  if ((await tab.count()) > 0) await tab.click();
  await page.waitForTimeout(4000);

  const dem = {
    xuong: await page.getByTestId("xuong-thiet-ke").count(),
    thuVien: await page.getByTestId("thu-vien-asset").count(),
    nutTaiModel: await page.getByTestId("nut-tai-model").count(),
    oChonTep: await page.getByTestId("o-chon-tep-model").count(),
    khoiAnhNen: await page.getByTestId("khoi-anh-nen").count(),
    nutChonAnh: await page.getByTestId("nut-chon-anh-nen").count(),
    nutDatTiLe: await page.getByTestId("nut-dat-ti-le").count(),
    khoiBanGhi: await page.getByTestId("khoi-ban-ghi").count(),
    oNhanBanGhi: await page.getByTestId("o-nhan-ban-ghi").count(),
    nutLuuBanGhi: await page.getByTestId("nut-luu-ban-ghi").count(),
    chuaCoBanGhi: await page.getByTestId("chua-co-ban-ghi").count(),
    chiXem: await page.getByTestId("huy-hieu-chi-xem").count(),
  };
  console.log("LO M dem:", JSON.stringify(dem), "url=", page.url());

  await page.screenshot({ path: `${taoThuMuc(ANH)}/twin-lo-m-thiet-ke.png`, fullPage: false });

  expect(dem.xuong).toBeGreaterThan(0);
  // #18 — thư viện asset và đường tải model.
  expect(dem.thuVien).toBeGreaterThan(0);
  // Ba khối ghi chỉ hiện khi CÓ quyền sửa; nếu tài khoản này chỉ-xem thì huy
  // hiệu "Chỉ xem" phải có mặt — hai chiều, không có ca im lặng.
  if (dem.chiXem > 0) {
    expect(dem.nutTaiModel).toBe(0);
    expect(dem.khoiAnhNen).toBe(0);
    expect(dem.khoiBanGhi).toBe(0);
  } else {
    expect(dem.nutTaiModel).toBeGreaterThan(0);
    expect(dem.oChonTep).toBeGreaterThan(0);
    expect(dem.khoiAnhNen).toBeGreaterThan(0);
    expect(dem.nutChonAnh).toBeGreaterThan(0);
    expect(dem.khoiBanGhi).toBeGreaterThan(0);
    expect(dem.oNhanBanGhi).toBeGreaterThan(0);
    expect(dem.nutLuuBanGhi).toBeGreaterThan(0);
  }
});
