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
      // H4 job 3 — tightened from 0.02 (2%) → 0.0005 (0.05%) → 0.00002 (0.002%). The 2% figure was
      // wide enough that a FULL PALETTE CHANGE left 11 of this suite's 28 baselines "passing
      // unchanged", and a later whole-screen restyle (H3b) was reported as "legitimately falling
      // under the suite's tolerance" — i.e. this gate could not see a redesign, so it could not see
      // a regression either.
      //
      // Every genuinely-live pixel source on these screens was found and either masked or made
      // layout-stable (see the `.hmi-clock` class on `TopBar.tsx`'s/`Nameplate.tsx`'s clocks,
      // `hmi-readout-value` on `Readout.tsx`'s value+unit ROW and `sub` line, the constant-radius
      // defect dot in `AoiSchematic.tsx`, and `sub !== undefined` reserving the STATUS tile's sub-row
      // height unconditionally so it can't shift the layout below it — every one of these was a REAL
      // reproduced flake, not a hypothetical one). A SEPARATE, bigger source of nondeterminism was
      // `ProductConfigStore`/`SimulatedEcosystem` persisting recipe/product edits to a JSON file
      // beside the built engine binary that survived across `dotnet run` restarts — see
      // `scripts/reset-engine-state.mjs`'s doc comment for the reproduced ~1% diff this caused before
      // it was wired into the `webServer` command below. With BOTH of those fixed, re-running this
      // suite twice against a fresh engine at 0.0000001 (~0 pixels) produced EXACT pixel matches on
      // all 30 baselines both times — genuine noise floor is provably zero on this machine.
      //
      // 0.00002 was calibrated against a real injected regression, not picked blind: hiding the
      // `.sheet` registration corners (index.css's `.sheet > .corner`, the shared L-shaped marks
      // EVERY panel across all 14 screens renders — see `industrial/Sheet.tsx`) is about as subtle a
      // structural regression as this UI can produce, and at 0 tolerance it reproducibly diffed
      // 68–273px per screen (68px on single-panel screens like `machines`/`inspector`, up to 273px on
      // panel-dense ones like `product-config-points`) — NEVER more than ~0.03% of a 1440×900 frame.
      // 0.0005 (648px cap) was proven too loose to catch it: all 28 baselines "passed unchanged" with
      // every corner hidden. 0.00002 (≈26px cap on 1440×900) sits below that 68px floor with margin
      // while staying ~2,500x looser than the machine's own proven noise floor — room for font/AA
      // variance on a different machine/CI runner, nowhere near enough to hide a moved/recolored/
      // reshaped panel. NOT a license for structural drift.
      maxDiffPixelRatio: 0.00002,
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
      //
      // H4 job 2/3 — `node ./scripts/reset-engine-state.mjs &&` runs FIRST, every time this
      // webServer boots. `ProductConfigStore`/`SimulatedEcosystem` persist to a JSON file beside
      // the built binary and load it as-is on the next boot instead of reseeding once it exists —
      // correct for the real kiosk app surviving a restart, but it means a `dotnet run` here reused
      // whatever an EARLIER test session's edit/push test had already mutated on disk, so "fresh
      // engine" wasn't actually fresh. See the script's own doc comment for the reproduced diff.
      command: "node ./scripts/reset-engine-state.mjs && dotnet run --project ../src/St4i.EngineApi/St4i.EngineApi.csproj --no-launch-profile",
      url: "http://localhost:5199/v1/health",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
      // WS2-T1 (docs/PRODUCTION_UI_DESIGN.md §2.2) — the engine's own default flipped from Demo to
      // Live (a fresh install/product deployment now comes up Live, connected to nothing until
      // configured). This whole suite is built on the OPPOSITE assumption (see this file's own top
      // comment: "Demo mode is its default transport, so the whole fleet is fabricated locally with
      // zero network dependency") and stays that way on purpose — Demo is what makes the suite
      // deterministic and offline. Setting ST4I_DEMO_ENABLED=true here is what makes that true again:
      // DemoModeGate reads it at startup and BOTH starts the engine directly in Demo mode (the same
      // "exhibition packaging" contract §2.5 describes for a real `.exe`) AND permits `PUT /v1/mode`
      // to switch there, so nothing downstream of this webServer needs its own mode-switch step.
      // GĐ3 closeout WI-1 — this device now advertises itself over mDNS by default whenever the UNS
      // spine is enabled (§17.8), and Demo mode still runs a real UNS spine. Left on, this webServer
      // would multicast `_st4i-machine._tcp` onto whatever LAN the dev/CI machine is attached to on
      // every `npm run test:e2e`/`npm run dev`. That default-on decision was signed off for installs,
      // not test runs — this suite has no business touching the network at all, so keep it silent.
      env: { ST4I_DEMO_ENABLED: "true", ST4I_MDNS_ADVERTISE: "0" },
    },
  ],
})
