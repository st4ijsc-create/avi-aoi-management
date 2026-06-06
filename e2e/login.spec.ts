import { test, expect } from "@playwright/test";

/**
 * Smoke: trang đăng nhập render và có form nhập liệu.
 */
test.describe("Login page smoke", () => {
  test("trang /login hiển thị và có input + nút submit", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveURL(/\/login/);

    // Có ít nhất một ô nhập (username/email) và một ô password.
    const inputs = page.locator("input");
    await expect(inputs.first()).toBeVisible();

    const passwordField = page.locator('input[type="password"]');
    await expect(passwordField).toBeVisible();

    // Có nút submit dạng button.
    await expect(page.locator('button[type="submit"], button').first()).toBeVisible();
  });
});
