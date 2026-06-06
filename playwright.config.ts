import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E config — smoke suite (Sprint S1 Q1).
 * Base URL configurable qua PLAYWRIGHT_BASE_URL (mặc định http://localhost:3000).
 * Khi chạy CI, đặt PLAYWRIGHT_BASE_URL trỏ tới server đã build/khởi động.
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
