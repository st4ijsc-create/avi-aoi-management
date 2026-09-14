import { defineConfig, devices } from "@playwright/test";

/**
 * Cấu hình Playwright RIÊNG cho lô W — chỉ khác bản gốc ở `outputDir` và `baseURL`.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ G65 — PLAYWRIGHT **DỌN SẠCH `outputDir`** MỖI LƯỢT CHẠY
 * ════════════════════════════════════════════════════════════════════════════
 * `playwright.config.ts` gốc KHÔNG đặt `outputDir` ⇒ mặc định `test-results/`,
 * nơi đang có **5 tệp ĐƯỢC GIT THEO DÕI** của lô C. Chạy bằng cấu hình gốc là
 * XOÁ chúng — im lặng, không lỗi nào nổ. Lô V đã lập tệp riêng vì lý do này;
 * lô W lặp lại đúng khuôn, KHÔNG sửa tệp của lô V (chạm vào là đổi phép đo của
 * người khác).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ G10b — PHẢI ĐO TRÊN `dist` ĐÃ DỰNG, KHÔNG PHẢI DEV SERVER
 * ════════════════════════════════════════════════════════════════════════════
 * Cả việc 1 (React dev runtime rò vào bản dựng) lẫn chỉ báo của nó là hiện
 * tượng THỜI-ĐIỂM-BUNDLE: dev server luôn "xanh" vì nó vốn dĩ là dev. Vì vậy
 * `baseURL` trỏ tới server chạy `node dist/index.js` với `NODE_ENV=production`.
 *
 * ⚠ CỔNG 3100, KHÔNG PHẢI 3000 — cổng 3000 đang do phiên khác giữ (PID 28480).
 *
 * ⇒ Chạy:
 *     PLAYWRIGHT_BASE_URL=http://127.0.0.1:3100 \
 *       npx playwright test --config=playwright.loW.config.ts e2e/twin-lo-v-tuong-tac.spec.ts -g "V2"
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3100";

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
  outputDir: ".qa-loW/pw-output",
  use: {
    baseURL,
    trace: "off",
    video: "off",
    screenshot: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
