/**
 * Nghiệm thu CHẶN-1 trên TRÌNH DUYỆT THẬT bằng tài khoản KHÔNG-admin.
 * `engineer1`/`maint1` có `machine_status` nhưng KHÔNG có `analytics_oee` ⇒
 * trước bản vá cả hai bị RouteGuard chặn khỏi `/twin`.
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
 *     QA_E2E_ANH_DOT5=<thư mục>   npx playwright test e2e/qa-dot5-chan1.spec.ts
 *     QA_GHI_DE_BANG_CHUNG=1              ⇒ ép ghi đè `.qa-tmp/shot` (lối thoát CÓ CHỦ Ý)
 */
const ANH = duongRaBangChung("QA_E2E_ANH_DOT5", ".qa-tmp/shot");

const TK = [
  { username: "engineer1", password: "QaDot5Vao!2026" },
  { username: "maint1", password: "QaDot5Vao!2026" },
];

for (const tk of TK) {
  test(`CHAN-1 — ${tk.username} (non-admin, khong co analytics_oee) VAO DUOC /twin`, async ({ page }) => {
    const res = await page.request.post("/api/auth/login", { data: tk });
    expect(res.status()).toBe(200);

    await page.goto("/twin");
    await page.waitForTimeout(5000);

    // Bằng chứng ĐÃ VÀO: khung màn Vận hành render, không phải màn "từ chối".
    const nganXuLy = await page.getByTestId("ngan-xu-ly").count();
    const khoiTongQuan = await page.getByTestId("khoi-tong-quan").count();
    const body = (await page.locator("body").textContent()) ?? "";
    const biTuChoi = /Access denied|Không có quyền|Bạn không có quyền truy cập/i.test(body);

    console.log(`${tk.username}: ngan-xu-ly=${nganXuLy} khoi-tong-quan=${khoiTongQuan} biTuChoi=${biTuChoi} url=${page.url()}`);
    await page.screenshot({ path: `${taoThuMuc(ANH)}/chan1-${tk.username}.png` });

    expect(khoiTongQuan).toBeGreaterThan(0);
    expect(biTuChoi).toBe(false);
  });
}
