import { defineConfig, devices } from "@playwright/test";

/**
 * Cấu hình Playwright RIÊNG cho **Đợt 22** — chỉ khác bản gốc ở `outputDir`
 * và `baseURL`.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ G65 — PLAYWRIGHT **DỌN SẠCH `outputDir`** MỖI LƯỢT CHẠY
 * ════════════════════════════════════════════════════════════════════════════
 * `playwright.config.ts` gốc KHÔNG đặt `outputDir` ⇒ mặc định `test-results/`.
 * Thư mục ấy chứa **5 ảnh ĐANG ĐƯỢC GIT THEO DÕI** của lô C. Chạy suite bằng
 * cấu hình gốc là **XOÁ chúng** — im lặng, không lỗi nào nổ.
 *
 * ⇒ Mọi lượt chạy của Đợt 22 dùng tệp này, và **sau lượt cuối** phải kiểm
 *   `git status --porcelain -- test-results/` (phải RỖNG).
 *
 * ★ G10b — đo trên `dist` ĐÃ DỰNG (`NODE_ENV=production node dist/index.js`),
 *   KHÔNG trên dev server.
 *
 * ⚠ Cổng 3141 là cổng RIÊNG của Đợt 22. Cổng 3000 thuộc phiên khác — không đụng.
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3141";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  timeout: 300_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  // ★★★ DÒNG QUAN TRỌNG NHẤT CỦA TỆP NÀY — xem G65 ở trên.
  outputDir: ".qa-dot22/pw-output",
  use: {
    baseURL,
    trace: "off",
    video: "off",
    screenshot: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
