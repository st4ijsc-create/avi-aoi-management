import { defineConfig, devices } from "@playwright/test";

/**
 * Cấu hình Playwright RIÊNG cho lô V — chỉ khác bản gốc ở `outputDir`.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ G65 — PLAYWRIGHT **DỌN SẠCH `outputDir`** MỖI LƯỢT CHẠY
 * ════════════════════════════════════════════════════════════════════════════
 * `playwright.config.ts` gốc KHÔNG đặt `outputDir`, nên Playwright dùng mặc định
 * `test-results/`. Thư mục đó trong repo này KHÔNG phải rác: nó chứa 5 artefact
 * **ĐANG ĐƯỢC GIT THEO DÕI** (`.playwright-artifacts-0/`) và các ảnh nghiệm thu
 * của những lô trước. Chạy suite bằng cấu hình gốc là XOÁ chúng — im lặng,
 * không ai ra lệnh, và không lỗi nào nổ.
 *
 * Cùng họ với **G62** (`go-tai-twin.ts` tự chạy `main()` khi bị `import`): một
 * công cụ có tác dụng phụ PHÁ HUỶ ngoài ý muốn người gọi. Khác ở chỗ thủ phạm
 * lần này là **mặc định của thư viện**, không phải mã của dự án — nên không
 * phép grep nào trong `client/`/`server/`/`scripts/` tìm ra được, và cách duy
 * nhất phát hiện là `git status --porcelain -- test-results/` SAU mỗi lượt chạy.
 *
 * ⇒ Mọi lượt chạy e2e của lô V dùng tệp này:
 *     npx playwright test --config=playwright.loV.config.ts e2e/twin-lo-v-*.spec.ts
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  // ★★★ DÒNG DUY NHẤT CÓ Ý NGHĨA CỦA TỆP NÀY.
  outputDir: ".qa-loV/pw-output",
  use: {
    baseURL,
    trace: "off",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
