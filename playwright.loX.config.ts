import { defineConfig, devices } from "@playwright/test";

/**
 * Cấu hình Playwright RIÊNG cho lô X — chỉ khác bản gốc ở `outputDir` và `baseURL`.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ G65 — PLAYWRIGHT **DỌN SẠCH `outputDir`** MỖI LƯỢT CHẠY
 * ════════════════════════════════════════════════════════════════════════════
 * `playwright.config.ts` gốc KHÔNG đặt `outputDir` ⇒ mặc định `test-results/`,
 * nơi đang có **5 tệp ĐƯỢC GIT THEO DÕI** của lô C. Chạy bằng cấu hình gốc là
 * XOÁ chúng — im lặng, không lỗi nào nổ. Lô V/W đã lập tệp riêng vì lý do này;
 * lô X lặp lại đúng khuôn và KHÔNG sửa tệp của hai lô kia (chạm vào là đổi phép
 * đo của người khác).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ G10b — PHẢI ĐO TRÊN `dist` ĐÃ DỰNG, KHÔNG PHẢI DEV SERVER
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠ CỔNG 3130, KHÔNG PHẢI 3000 — cổng 3000 do phiên khác giữ, và 3100/3110 có
 *   thể còn của lô V/W. Mỗi lô một cổng, không ai đo trên bundle của ai.
 *
 * ⇒ Chạy:
 *     PLAYWRIGHT_BASE_URL=http://127.0.0.1:3130 \
 *       npx playwright test --config=playwright.loX.config.ts e2e/twin-lo-x-mo-phong.spec.ts
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3130";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  timeout: 300_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  // ★★★ DÒNG QUAN TRỌNG NHẤT CỦA TỆP NÀY — xem G65 ở trên.
  outputDir: ".qa-loX/pw-output",
  use: {
    baseURL,
    trace: "off",
    video: "off",
    screenshot: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
