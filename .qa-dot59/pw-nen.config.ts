// ĐỢT 59 — ABLATION mục D: CẤU HÌNH NỀN (bản trước mục D: MỘT project, KHÔNG trần worker).
// Dùng để đo chiều "gỡ vá" mà KHÔNG đụng `playwright.config.ts` thật.
import { defineConfig, devices } from "@playwright/test";
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
export default defineConfig({
  testDir: "../e2e",
  testMatch: "**/*.spec.ts",
  outputDir: "../.qa-pw-output",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["line"]],
  use: { baseURL, trace: "on-first-retry", screenshot: "only-on-failure", video: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
