import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * 50-N5 (pha 0 C0-3) — cấu hình RIÊNG: dựng Vite HARNESS (thành phần thật, KHÔNG máy chủ, KHÔNG DB) ở cổng riêng N5_PORT (mặc định 5211),
 * root = e2e/pha0. Không .env, không :3000/:3071, không dev DB. outputDir `.qa-n5/` (đã gitignore theo mẫu `.qa-*`).
 *
 *   npx playwright test --config=playwright.n5.config.ts
 */
export default defineConfig({
  testDir: "./e2e/pha0",
  testMatch: "n5-dung-may.spec.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  outputDir: path.join(".qa-n5", "pw-output"),
  globalSetup: "./e2e/pha0/n5-global-setup.ts",
  use: { trace: "off", video: "off", screenshot: "off" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
