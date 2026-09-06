/**
 * Nghiệm thu CHẶN-1 trên TRÌNH DUYỆT THẬT bằng tài khoản KHÔNG-admin.
 * `engineer1`/`maint1` có `machine_status` nhưng KHÔNG có `analytics_oee` ⇒
 * trước bản vá cả hai bị RouteGuard chặn khỏi `/twin`.
 */
import { test, expect } from "@playwright/test";

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
    await page.screenshot({ path: `.qa-tmp/shot/chan1-${tk.username}.png` });

    expect(khoiTongQuan).toBeGreaterThan(0);
    expect(biTuChoi).toBe(false);
  });
}
