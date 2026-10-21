import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * Đợt 9 — cấu hình RIÊNG cho e2e Flow Studio (chạy thử một node · so sánh lượt · form OT · bật luồng OT qua step-up).
 *
 *   npx playwright test --config=playwright.flowstudio.config.ts
 *
 * globalSetup (e2e/flow-studio/global-setup.ts) tự dựng instance TỪ MÃ NGUỒN trên CỔNG RIÊNG (FS_SERVER_PORT 3047 /
 * FS_VITE_PORT 5207), DB `aoi_management_test` CHỈ, gieo + dọn dữ liệu của chính nó (tiền tố fse2e) và ghi báo cáo vào outputDir.
 * Không bao giờ :3000, không dev DB, không GPU/llama. outputDir `.qa-flowstudio/` (đã gitignore theo mẫu `.qa-*`).
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "flow-studio-dot9.spec.ts",
  timeout: 300_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  outputDir: process.env.FS_OUT_DIR ? path.join(process.env.FS_OUT_DIR, "pw-output") : ".qa-flowstudio/pw-output",
  globalSetup: "./e2e/flow-studio/global-setup.ts",
  use: { trace: "off", video: "off", screenshot: "off" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
