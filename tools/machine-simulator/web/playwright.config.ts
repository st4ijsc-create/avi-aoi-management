import { defineConfig, devices } from "@playwright/test"

/**
 * Task 10 — E2E + visual-regression + axe a11y suite for the 7 screens (Dashboard, Inspector,
 * Machine Detail, Onboarding, Settings, Scenario, `/tokens`).
 *
 * `webServer` boots BOTH halves of the dev split (Task 3/9) so `npm run test:e2e` is a single
 * command with no manual setup: Vite on :5173 (the page under test) proxying nothing itself, and
 * `St4i.EngineApi` on :5199 (the real engine — Demo mode is its default transport, so the whole
 * fleet is fabricated locally with zero network dependency). `reuseExistingServer` (true outside
 * CI) means a dev server you already have running is reused rather than fighting over the port.
 *
 * `workers: 1` / `fullyParallel: false` is deliberate, not a leftover default: `FleetHost` inside
 * the engine is a SINGLETON — cycles/scenario/settings are shared, mutable, process-lifetime state,
 * same as a real machine fleet. Running specs one-at-a-time, in the fixed order the numeric file
 * prefixes below impose, is what makes the suite deterministic against that shared backend:
 * `00-visual-and-a11y.spec.ts` captures every screen's PRISTINE baseline (fleet never started —
 * provably zero live counters, not just "probably stable") before any later spec ever calls
 * `POST /v1/fleet/start`. See `tests/support/screens.ts` for the shared per-screen "wait until
 * ready" helpers both the visual/a11y pass and the functional specs use.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 45_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      // Freezes CSS transitions/animations and finite Web Animations (Framer Motion's enter
      // transitions included) to their end state before the pixel comparison — the default, kept
      // explicit here because it's load-bearing for baseline stability.
      animations: "disabled",
      // A hair of tolerance for sub-pixel font/AA rendering jitter between runs on the same
      // machine — not a license for structural drift (0.02 = up to 2% of pixels may differ).
      maxDiffPixelRatio: 0.02,
    },
  },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  outputDir: "test-results",
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npm run dev -- --port 5173 --strictPort",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // Relative to this config file's directory (web/) — resolves to
      // tools/machine-simulator/src/St4i.EngineApi/St4i.EngineApi.csproj. `--no-launch-profile`
      // is defensive (no Properties/launchSettings.json exists in that project today) so a future
      // one added for `dotnet run` convenience in normal dev use can't silently repoint the port
      // this suite depends on.
      command: "dotnet run --project ../src/St4i.EngineApi/St4i.EngineApi.csproj --no-launch-profile",
      url: "http://localhost:5199/v1/health",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
})
