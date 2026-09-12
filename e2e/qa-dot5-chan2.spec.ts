/**
 * Nghiệm thu CHẶN-2 bằng tài khoản BỊ 403 — TUYỆT ĐỐI KHÔNG dùng admin.
 * `maint1` có machine_status/canView (vào được /twin sau bản vá CHẶN-1) nhưng
 * KHÔNG có `andon` ⇒ `andon.active` trả FORBIDDEN.
 */
import { test, expect } from "@playwright/test";
import { duongRaBangChung, taoThuMuc } from "./duongRaBangChung";

/**
 * ★★★ ĐỢT 55 (C) — ĐƯỜNG RA BẰNG CHỨNG ĐI QUA HÀNG RÀO (G130).
 *
 * Trước Đợt 55 spec này ghi thẳng vào `.qa-tmp/shot` bằng đường ghim cứng. Đó đúng lớp lỗi đã
 * làm mất bằng chứng ở Đợt 50: chạy lại để xem thử ⇒ ghi đè im lặng lên ảnh của lượt trước.
 * `duongRaBangChung` áp bất biến *"thư mục đích ĐÃ CÓ TỆP ⇒ đổi đường ra + kêu to"*.
 *
 * CÁCH CHẠY (đổi chỗ ghi mà không phải sửa mã):
 *     QA_E2E_ANH_DOT5=<thư mục>   npx playwright test e2e/qa-dot5-chan2.spec.ts
 *     QA_GHI_DE_BANG_CHUNG=1              ⇒ ép ghi đè `.qa-tmp/shot` (lối thoát CÓ CHỦ Ý)
 */
const ANH = duongRaBangChung("QA_E2E_ANH_DOT5", ".qa-tmp/shot");

const TK = { username: "maint1", password: "QaDot5Vao!2026" };

test("CHAN-2 — tai khoan bi 403 thay '—' va banner, KHONG thay '0'", async ({ page }) => {
  const res = await page.request.post("/api/auth/login", { data: TK });
  expect(res.status()).toBe(200);

  await page.goto("/twin");
  await page.waitForTimeout(6000);

  // Ảnh toàn màn để TỰ ĐỌC.
  await page.screenshot({ path: `${taoThuMuc(ANH)}/chan2-maint1.png`, fullPage: false });

  const demCanhBao = await page.getByTestId("khoi-canh-bao").textContent().catch(() => null);
  const demTongQuan = await page.getByTestId("khoi-tong-quan").textContent().catch(() => null);
  const banner = await page.getByTestId("banner-thieu-quyen-truy-van").count();
  const bannerText = banner > 0 ? await page.getByTestId("banner-thieu-quyen-truy-van").textContent() : null;
  const bannerAttr = banner > 0
    ? await page.getByTestId("banner-thieu-quyen-truy-van").getAttribute("data-truy-van") : null;

  console.log("KHOI_TONG_QUAN:", JSON.stringify(demTongQuan));
  console.log("KHOI_CANH_BAO:", JSON.stringify(demCanhBao));
  console.log("BANNER_COUNT:", banner);
  console.log("BANNER_TEXT:", JSON.stringify(bannerText));
  console.log("BANNER_QUERIES:", bannerAttr);
});
