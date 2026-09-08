import { expect, test, type Page } from "@playwright/test";

/**
 * Lô W — nghiệm thu THỊ GIÁC cho G67 (gỡ công cụ Scale).
 *
 * ★ G10b — chạy trên `dist` ĐÃ DỰNG (server `node dist/index.js`, NODE_ENV=production),
 *   KHÔNG trên dev server. Xem `playwright.loW.config.ts`.
 * ★ G65 — outputDir riêng `.qa-loW/`, KHÔNG đụng `test-results/` (5 tệp của lô C).
 */

const TAI_KHOAN = {
  username: process.env.E2E_TAI_USER || "e2e_tai_loE",
  password: process.env.E2E_TAI_PASS || "E2eTaiLoE!2026",
};

async function dangNhap(page: Page) {
  const res = await page.request.post("/api/auth/login", { data: TAI_KHOAN });
  expect(res.status(), "dang nhap non-admin").toBe(200);
}

test("W1 — thanh cong cu Thiet ke: CON diChuyen+xoay, KHONG con Co gian", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1600, height: 950 });
  await dangNhap(page);
  await page.goto("/twin-studio", { waitUntil: "domcontentloaded" });
  await page
    .getByTestId("tab-thiet-ke")
    .click({ timeout: 60_000 })
    .catch(() => {});
  await page.waitForTimeout(8_000);

  const nutDiChuyen = page.getByTestId("nut-che-do-translate");
  const nutXoay = page.getByTestId("nut-che-do-rotate");
  const nutScale = page.getByTestId("nut-che-do-scale");

  // ── Ca DƯƠNG: hai nút còn lại PHẢI hiện. Nếu bỏ qua phần này thì một trang
  //    trắng (chưa đăng nhập / chưa quyền) cũng cho "không thấy nút scale" và
  //    lưới sẽ XANH mà không đo gì — đúng lớp lỗi G5/G6/G7/G10.
  await expect(nutDiChuyen, "nut Di chuyen phai hien (ca duong)").toBeVisible({ timeout: 60_000 });
  await expect(nutXoay, "nut Xoay phai hien (ca duong)").toBeVisible();

  // ── Ca ÂM: nút Co giãn phải BIẾN MẤT.
  await expect(nutScale, "nut Co gian phai KHONG con").toHaveCount(0);

  const thanh = page.getByTestId("nut-che-do-translate").locator("xpath=ancestor::div[2]");
  await thanh.screenshot({ path: ".qa-loW/W1-thanh-cong-cu.png" });
  await page.screenshot({ path: ".qa-loW/W1-toan-man.png" });

  const soNut = await page.locator('[data-testid^="nut-che-do-"]').count();
  console.log(`   [W1] so nut che do gizmo = ${soNut} (ky vong 2)`);
  expect(soNut, "dung 2 che do gizmo").toBe(2);
});
