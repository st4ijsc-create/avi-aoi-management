import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * 50-N5 / C0-2 (pha 0) — e2e ỨNG DỤNG ĐẦY ĐỦ trên instance RIÊNG (dùng lại globalSetup của flow-studio: server từ mã nguồn + Vite dev, DB
 * `aoi_management_test` CHỈ, một người dùng fixture `fse2e*`, teardown đếm về 0). Cổng riêng: server 3051 / Vite 5212 (đổi bằng FS_SERVER_PORT /
 * FS_VITE_PORT). Không .env, không :3000 / :3071, không dev DB, không OT / GPU. outputDir `.qa-n5-route/` (gitignore theo mẫu `.qa-*`).
 *
 *   npx playwright test --config=playwright.pha0route.config.ts
 */
process.env.FS_SERVER_PORT ||= "3051";
process.env.FS_VITE_PORT ||= "5212";
process.env.FS_OUT_DIR ||= path.resolve(".qa-n5-route");

export default defineConfig({
  testDir: "./e2e/pha0",
  testMatch: "n5-tuyen-an-ai.spec.ts",
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  outputDir: path.join(process.env.FS_OUT_DIR, "pw-output"),
  globalSetup: "./e2e/flow-studio/global-setup.ts",
  use: { trace: "off", video: "off", screenshot: "off" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
