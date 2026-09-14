import { defineConfig, devices } from "@playwright/test";

/**
 * Cấu hình Playwright RIÊNG cho **lô Y** (Đợt 21) — chỉ khác bản gốc ở
 * `outputDir` và `baseURL`.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ G65 — PLAYWRIGHT **DỌN SẠCH `outputDir`** MỖI LƯỢT CHẠY
 * ════════════════════════════════════════════════════════════════════════════
 * `playwright.config.ts` gốc KHÔNG đặt `outputDir` ⇒ mặc định `test-results/`.
 * Thư mục ấy trong repo này chứa **5 ảnh ĐANG ĐƯỢC GIT THEO DÕI** của lô C
 * (`C1-C4-toan-man.png`, `C1-fit-all-sau.png`, `C2-anh-xuat-that.png`,
 * `C3-minimap-sau-click.png`, `C5-hop-thoai-luu-vung.png`). Chạy suite bằng
 * cấu hình gốc là **XOÁ chúng** — im lặng, và không lỗi nào nổ.
 *
 * ⇒ Mọi lượt chạy e2e của lô Y dùng tệp này, và **sau lượt cuối** phải kiểm
 *   `git status --porcelain -- test-results/` (phải RỖNG).
 *
 * ★ G10b — đo trên `dist` ĐÃ DỰNG (`NODE_ENV=production node dist/index.js`),
 *   KHÔNG trên dev server: chỉ báo đo bundler xanh ở dev mà đỏ ở build.
 *
 * ⚠ Cổng 3140 là cổng RIÊNG của lô Y. Cổng 3000 thuộc phiên khác — **không đụng**.
 *
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:3140 \
 *     npx playwright test --config=playwright.loY.config.ts e2e/twin-lo-y-*.spec.ts
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3140";

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
  outputDir: ".qa-loY/pw-output",
  use: {
    baseURL,
    trace: "off",
    video: "off",
    screenshot: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
