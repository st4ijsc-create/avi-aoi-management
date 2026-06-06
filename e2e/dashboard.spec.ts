import { test, expect } from "@playwright/test";

/**
 * Smoke: app khởi động được và shell render (root route).
 * Chưa đăng nhập nên có thể redirect về /login — chấp nhận cả 2 trạng thái,
 * miễn là trang render không lỗi và có nội dung HTML.
 */
test.describe("App shell smoke", () => {
  test("root route render không lỗi", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status() ?? 200).toBeLessThan(500);

    // Body có nội dung (SPA mount thành công).
    await expect(page.locator("body")).toBeVisible();
    const html = await page.content();
    expect(html.length).toBeGreaterThan(100);
  });

  test("trang dashboard có thể truy cập (redirect login hoặc render)", async ({ page }) => {
    const response = await page.goto("/dashboard");
    expect(response?.status() ?? 200).toBeLessThan(500);
    await expect(page.locator("body")).toBeVisible();
  });
});
