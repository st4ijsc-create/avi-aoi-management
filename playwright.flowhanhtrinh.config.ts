import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * Cổng 8.3 — "hành trình 8 bước bằng kỹ sư KHÔNG admin" trên BẢN DỰNG PRODUCTION của Flow Studio (e2e luồng; AI không tham gia, không đo model).
 *
 *   npm run build   (một lần, ra dist/)
 *   npx playwright test --config=playwright.flowhanhtrinh.config.ts
 *
 * globalSetup dựng `dist/index.js` trên CỔNG RIÊNG (FHT_PORT 3049), DB `aoi_management_test` CHỈ, gieo + dọn dữ liệu (tiền tố fse2e).
 * Không bao giờ :3000 / :8091 / dev DB / GPU. Chạy ×3: `--repeat-each=3`.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["flow-hanh-trinh-ky-su.spec.ts", "flow-form-ky-su.spec.ts", "flow-nhap-xuat-ky-su.spec.ts", "flow-chon-ky-su.spec.ts", "flow-tincay-ky-su.spec.ts", "flow-bieumau-ky-su.spec.ts"],
  timeout: 300_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  outputDir: process.env.FHT_OUT_DIR ? path.join(process.env.FHT_OUT_DIR, "pw-output") : ".qa-flowhanhtrinh/pw-output",
  globalSetup: "./e2e/flow-hanh-trinh/global-setup.ts",
  use: { trace: "off", video: "off", screenshot: "off" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
