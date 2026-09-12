import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E config — smoke suite (Sprint S1 Q1).
 * Base URL configurable qua PLAYWRIGHT_BASE_URL (mặc định http://localhost:3000).
 * Khi chạy CI, đặt PLAYWRIGHT_BASE_URL trỏ tới server đã build/khởi động.
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  /**
   * ★★★ ĐỢT 55 (C) — `outputDir` PHẢI NÓI RA, vì mặc định của Playwright là `test-results/`
   * và **Playwright DỌN SẠCH `outputDir` mỗi lượt chạy** (đúng G65 mà 5 config riêng của
   * các lô V/W/X/Y và Đợt 22/23 đã ghi). Cấu hình GỐC này lại là cái duy nhất chưa đặt.
   *
   * ĐO ĐƯỢC, không suy đoán (Đợt 55): đặt một tệp `sentinel.txt` vào một thư mục rồi chạy
   * `npx playwright test <spec> --output=<thư mục ấy>` ⇒ **sentinel BIẾN MẤT**. Nghĩa là
   * `npm run test:e2e` ở HEAD sẽ **xoá 5 ảnh lô C ĐÃ COMMIT trong `test-results/`** — đúng
   * lớp lỗi G130 đã làm mất 103 tệp ở Đợt 50, chỉ khác là lần này nó nằm trong config.
   * Lý do nó chưa nổ: `test:e2e` toàn bộ **chưa ai chạy** (sổ nợ Đợt 55, mục D).
   */
  outputDir: ".qa-pw-output",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
