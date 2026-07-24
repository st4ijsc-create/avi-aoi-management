import { expect, test, type Locator, type Page } from "@playwright/test"

import { assertNoSeriousA11yViolations } from "./support/a11y"
import { pullMachineConfig, resetEstop, setFleetRunning } from "./support/engine"
import { gotoHmi } from "./support/screens"
import { primeAppStorage, type Theme } from "./support/theme"
import { vi as viDict } from "../src/i18n/vi"

/**
 * H2 — the HMI operator panel (`/hmi/:code`, docs/HMI_DESIGN_SPEC.md). Runs LAST (numeric `11-`
 * prefix, after `00`'s pristine baselines and every functional spec that starts the fleet) — by the
 * time this file runs the shared `FleetHost` singleton (see `playwright.config.ts`'s top comment) has
 * real, non-zero cycle history from every spec before it, which is exactly the live state this screen
 * needs to prove itself against (a genuinely idle/pristine HMI wouldn't exercise the schematic
 * animation, the readout grid, or the live log at all).
 *
 * `beforeEach` unconditionally (re-)starts the fleet so every test in this file gets real live data
 * regardless of what the immediately-preceding test left behind (the E-STOP test below stops it);
 * `afterEach` restores that same running state so this file leaves the shared engine exactly as it
 * found it.
 *
 * Branch-review I-15 — `beforeEach` also PULLS AOI-01's MODEL-A config every time (idempotent — see
 * `pullMachineConfig`'s own doc comment). Before this, the AOI visual baselines were only reproducible
 * as part of the FULL ordered suite: `02-machine-detail.spec.ts` happens to click a real "Pull" on
 * AOI-01/MODEL-A, which mutates MODEL-A's local point set from the pristine seed (8 points, v3) to the
 * post-pull state (the ecosystem's deliberately-diverged copy) — a mutation this file's own baselines
 * were captured against. Running `11-hmi.spec.ts` alone (no `02` beforehand) left MODEL-A pristine, so
 * the AOI schematic's dot COUNT and POSITIONS differed from the baseline PNG's, and `.hmi-aoi-point`'s
 * per-dot masks (covering only each dot's CURRENT position) couldn't paper over dots baked into the
 * baseline at DIFFERENT positions — reproduced live as a 166px diff. This file now establishes its own
 * precondition instead of inheriting one from file order, so it holds standalone too.
 */

/** WS3-T2 — an instant guaranteed to sit past ANY real plan's `startedAt + durationSeconds` (cycle
 * durations across this fleet top out at a few seconds — see `AutomationSchematic.tsx`'s WS3-T2
 * remarks), used to freeze `Date.now()` for the schematic visual baselines below. See the visual
 * test's own comment for why this specific mechanism (not a CSS animation override) is what makes the
 * living twin's JS-driven motion/reveal deterministic. */
const FROZEN_FUTURE_TIME = new Date("2100-01-01T00:00:00Z")

test.describe("HMI operator panel", () => {
  test.beforeEach(async ({ request }) => {
    await pullMachineConfig(request, "AOI-01", "MODEL-A")
    await resetEstop(request)
    await setFleetRunning(request, true)
  })
  test.afterEach(async ({ request }) => {
    // Defensive: clear a latch BEFORE trying to restart — StartLocked refuses while EstopEngaged
    // (see `FleetHost.cs`), so a test that leaves E-STOP engaged would otherwise silently leave the
    // fleet stopped for every test that runs after it.
    await resetEstop(request)
    await setFleetRunning(request, true)
  })

  test("nameplate renders machine identity, status lamp, and clock", async ({ page }) => {
    await gotoHmi(page, "SCRW-01")
    await expect(page.getByRole("heading", { name: "SCRW-01", level: 1 })).toBeVisible()
    // Scoped to the page's one `<header>` (the Nameplate) — "Automation" alone is ambiguous against
    // the schematic panel's own "FIG. 01 — AUTOMATION / SCREWDRIVE CELL" caption.
    await expect(page.locator("header").getByText(viDict.deviceClass.Automation)).toBeVisible()
    // Live HH:MM:SS clock — scoped to the header (the system log's own per-row timestamps match the
    // same `HH:MM:SS` shape, which would otherwise make this ambiguous).
    await expect(page.locator("header").getByText(/^\d{2}:\d{2}:\d{2}$/)).toBeVisible()
    // "Back to machine detail" — the obvious way back the brief asks for.
    await expect(page.getByRole("link", { name: viDict.hmi.back })).toBeVisible()
  })

  test("physical controls: Start/Pause/E-STOP present and reflect real fleet state", async ({ page }) => {
    await gotoHmi(page, "SCRW-01")
    const start = page.getByRole("button", { name: viDict.hmi.controls.start })
    const pause = page.getByRole("button", { name: viDict.hmi.controls.pause })
    const estop = page.getByRole("button", { name: viDict.hmi.controls.estop })
    await expect(start).toBeVisible()
    await expect(pause).toBeVisible()
    await expect(estop).toBeVisible()
    // Fleet is running (beforeEach) — START is the currently-inert one, PAUSE is live.
    await expect(start).toBeDisabled()
    await expect(pause).toBeEnabled()
    await expect(estop).toBeEnabled()
    // No RESET affordance while nothing is latched (spec §6: "plus RESET when latched").
    await expect(page.getByRole("button", { name: viDict.hmi.controls.reset })).toHaveCount(0)
  })

  test("system log fills with live trace rows for this machine", async ({ page }) => {
    await gotoHmi(page, "AOI-01")
    await expect(page.getByText(viDict.hmi.log.empty)).toHaveCount(0, { timeout: 15_000 })
    await expect.poll(() => page.getByRole("listitem").count(), { timeout: 15_000 }).toBeGreaterThan(0)
  })

  test("AOI schematic plots real product measurement points", async ({ page }) => {
    await gotoHmi(page, "AOI-01")
    const schematic = page.getByRole("img", { name: /FIG\. 01/ })
    await expect(schematic).toBeVisible()
    // Real `MeasurementPoint`s from the product config, plotted as circles carrying their own code
    // as an accessible `<title>` — not the engine's generic simulator point codes (see
    // `AoiSchematic.tsx`'s header comment on the positional-correspondence disclosure).
    await expect.poll(() => schematic.locator("circle title").count(), { timeout: 15_000 }).toBeGreaterThan(0)
  })

  test("E-STOP latches a real fault: stops the fleet, locks controls, freezes the schematic; RESET clears it", async ({
    page,
    request,
  }) => {
    await gotoHmi(page, "SCRW-01")
    const schematicGroup = page.locator('svg[role="img"] > g').first()
    await expect(schematicGroup).toHaveClass(/hmi-schematic-run/)

    await page.getByRole("button", { name: viDict.hmi.controls.estop }).click()

    // The whole panel visibly goes to fault.
    await expect(page.getByText(viDict.hmi.controls.estopBanner)).toBeVisible()
    // `exact: true` — "DỪNG KHẨN CẤP" (the StatusLamp label) is otherwise a substring match against
    // the estop banner's own "ĐANG DỪNG KHẨN CẤP" text (`getByText` substring-matches by default).
    await expect(page.getByText(viDict.hmi.status.estop, { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: viDict.hmi.controls.start })).toBeDisabled()
    await expect(page.getByRole("button", { name: viDict.hmi.controls.pause })).toBeDisabled()
    await expect(page.getByRole("button", { name: viDict.hmi.controls.estop })).toBeDisabled()
    // Schematic root loses its running class — idle/static, not merely paused mid-frame.
    await expect(schematicGroup).not.toHaveClass(/hmi-schematic-run/)
    // A real stop, not a cosmetic one — the engine's own fleet state agrees.
    await expect
      .poll(async () => (await (await request.get(`${process.env.ENGINE_URL ?? "http://localhost:5199"}/v1/fleet`)).json()).isRunning)
      .toBe(false)
    // The fault is logged, bilingual, at ERROR level.
    await expect(page.getByText(viDict.hmi.log.estopEngaged)).toBeVisible()

    const reset = page.getByRole("button", { name: viDict.hmi.controls.reset })
    await expect(reset).toBeVisible()
    await reset.click()

    await expect(page.getByText(viDict.hmi.controls.estopBanner)).toHaveCount(0)
    await expect(reset).toHaveCount(0)
    // RESET clears the latch but does NOT auto-restart the fleet (honest, explicit design) — START is
    // enabled again, PAUSE is not.
    await expect(page.getByRole("button", { name: viDict.hmi.controls.start })).toBeEnabled()
    await expect(page.getByRole("button", { name: viDict.hmi.controls.pause })).toBeDisabled()
    await expect(page.getByText(viDict.hmi.log.estopReset)).toBeVisible()
  })

  test("C-1: the panel resyncs from every poll, not just the first — a fleet stop from elsewhere is reflected live, no reload needed", async ({
    page,
    request,
  }) => {
    await gotoHmi(page, "SCRW-01")
    const schematicGroup = page.locator('svg[role="img"] > g').first()
    const header = page.locator("header")
    await expect(header.getByText(viDict.hmi.status.sub.run)).toBeVisible()
    await expect(schematicGroup).toHaveClass(/hmi-schematic-run/)

    // Simulate a fleet-state change from ANYWHERE ELSE — another HMI panel, another browser tab, the
    // REST API, the engine itself — by calling the stop endpoint directly through `request` (a
    // separate HTTP client from the page's own fetches), never touching THIS page's UI at all.
    await setFleetRunning(request, false)

    // The pre-fix bug: `FleetRuntimeProvider` accepted only the FIRST `/v1/fleet` snapshot, so this
    // page would keep asserting "running" (green lamp, live schematic, START disabled) indefinitely
    // — reproduced live as an idle lamp reading "Chờ lệnh" while `isRunning: true` and cycles climbed
    // server-side. Now every ~1s poll is the source of truth, so this page must resync within a few
    // poll intervals with NO navigation/reload.
    await expect(header.getByText(viDict.hmi.status.sub.idle)).toBeVisible({ timeout: 5_000 })
    await expect(schematicGroup).not.toHaveClass(/hmi-schematic-run/)
    await expect(page.getByRole("button", { name: viDict.hmi.controls.start })).toBeEnabled()
    await expect(page.getByRole("button", { name: viDict.hmi.controls.pause })).toBeDisabled()

    // And it resyncs back the other way too — started from elsewhere, this page follows without any
    // action of its own.
    await setFleetRunning(request, true)
    await expect(header.getByText(viDict.hmi.status.sub.run)).toBeVisible({ timeout: 5_000 })
    await expect(schematicGroup).toHaveClass(/hmi-schematic-run/)
    await expect(page.getByRole("button", { name: viDict.hmi.controls.start })).toBeDisabled()
    await expect(page.getByRole("button", { name: viDict.hmi.controls.pause })).toBeEnabled()
  })

  test("C-2: E-STOP latch is server-owned — survives navigating to another machine's panel AND a reload; only RESET clears it", async ({
    page,
  }) => {
    await gotoHmi(page, "SCRW-01")
    await page.getByRole("button", { name: viDict.hmi.controls.estop }).click()
    await expect(page.getByText(viDict.hmi.controls.estopBanner)).toBeVisible()

    // Navigate to a DIFFERENT machine's panel — in a real cell, a second operator station. The
    // pre-fix bug (component-local React state) silently dropped the latch here: no banner, START
    // enabled, as if the emergency never happened.
    await gotoHmi(page, "AOI-01")
    await expect(page.getByText(viDict.hmi.controls.estopBanner)).toBeVisible()
    await expect(page.getByText(viDict.hmi.status.estop, { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: viDict.hmi.controls.start })).toBeDisabled()

    // A full page reload — the pre-fix bug cleared client-only state here too.
    await page.reload()
    await expect(page.getByRole("heading", { name: "AOI-01", level: 1 })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(viDict.hmi.controls.estopBanner)).toBeVisible()
    await expect(page.getByRole("button", { name: viDict.hmi.controls.start })).toBeDisabled()

    // RESET (from THIS panel — a different one than where E-STOP was pressed) is what actually
    // clears the shared, server-owned latch.
    await page.getByRole("button", { name: viDict.hmi.controls.reset }).click()
    await expect(page.getByText(viDict.hmi.controls.estopBanner)).toHaveCount(0)
    await expect(page.getByRole("button", { name: viDict.hmi.controls.start })).toBeEnabled()

    // And the latch being gone is ALSO visible back on the original machine's panel — one shared
    // fault state, not two disagreeing ones.
    await gotoHmi(page, "SCRW-01")
    await expect(page.getByText(viDict.hmi.controls.estopBanner)).toHaveCount(0)
    await expect(page.getByRole("button", { name: viDict.hmi.controls.start })).toBeEnabled()
  })

  test("keyboard: every control is reachable and visibly focused", async ({ page }) => {
    await gotoHmi(page, "SCRW-01")
    const pause = page.getByRole("button", { name: viDict.hmi.controls.pause })
    await pause.focus()
    await expect(pause).toBeFocused()
    await page.keyboard.press("Tab")
    await expect(page.getByRole("button", { name: viDict.hmi.controls.estop })).toBeFocused()
  })

  // WS1-T1 pinned this to Glass only, same reasoning as `00-visual-and-a11y.spec.ts`'s own THEMES
  // (see that file's top doc comment). WS1-T3 (docs/plans/2026-07-24-theme-system.md, Task 3)
  // widens this to all 3 themes — the plan's explicit ask is exactly this: the HMI panel × all 3
  // machine classes (SCRW/AOI/IOT) × glass/console/warmth, since this is the one screen where
  // Console's `--glow-run` (SchematicPanel/StatusLamp/Readout) and every theme's status-color
  // invariant (§4 — no-data ≠ fault) are simultaneously live and highest-stakes to regress.
  const THEMES: Theme[] = ["glass", "console", "warmth"]

  // Branch-review C-5 — the suite's tolerance was tightened specifically so structural schematic
  // regressions would be caught, but only the AOI class ever had a baseline: C-4 (both animated
  // schematics rotating/scaling about the viewBox centre instead of their own) shipped through a
  // green suite for exactly this reason. One case per machine class now, each with its own mask list
  // built the same way the AOI one always was — narrow, stable `hmi-*` hooks on the genuinely live
  // sub-elements (see each schematic's own comments), everything else (frame, rails, dimension
  // lines, graph paper) left UNmasked so a regression like C-4's is actually caught.
  const SCHEMATIC_CASES: { slug: string; code: string; mask: (page: Page) => Locator[] }[] = [
    {
      slug: "aoi",
      code: "AOI-01",
      mask: (page) => [
        page.locator(".hmi-clock"),
        page.locator(".hmi-nameplate-lamp"),
        page.locator(".hmi-aoi-points-group"),
        page.locator(".hmi-aoi-caption"),
        page.locator(".hmi-readout-value"),
        page.getByRole("log"),
        // H5 — layout gap 3: `OutputCard`'s OK/NG/TOTAL numbers ride the shared `.hmi-readout-value`
        // mask above (built on the same `<Readout>` primitive as the readout grid), but the
        // proportional OK/NG bar is a plain coloured div, not a `<Readout>` — its own fill-boundary
        // pixel position is exactly as cycle-count-dependent as the numbers beside it and needs its
        // own stable-box mask, same reasoning as `.hmi-feeder-live`/`.hmi-iot-reading`.
        page.locator(".hmi-output-bar"),
      ],
    },
    {
      slug: "automation",
      code: "SCRW-01",
      mask: (page) => [
        page.locator(".hmi-clock"),
        page.locator(".hmi-nameplate-lamp"),
        page.locator(".hmi-feeder-live"),
        page.locator(".hmi-readout-value"),
        page.getByRole("log"),
        page.locator(".hmi-output-bar"),
        // WS3-T2 — the living twin: which of SCRW-01's 4 real fastening steps land OK/NG this cycle
        // is a live per-cycle draw (same reasoning as AOI's own `.hmi-aoi-points-group` mask below),
        // so this stable-box group mask stands in for it rather than pinning an exact colour sequence.
        page.locator(".hmi-scrw-points-group"),
      ],
    },
    {
      slug: "iot",
      code: "IOT-01",
      mask: (page) => [
        page.locator(".hmi-clock"),
        page.locator(".hmi-nameplate-lamp"),
        page.locator(".hmi-iot-reading"),
        page.locator(".hmi-readout-value"),
        page.getByRole("log"),
        page.locator(".hmi-output-bar"),
      ],
    },
  ]

  for (const { slug, code, mask } of SCHEMATIC_CASES) {
    for (const theme of THEMES) {
      test(`visual — ${slug} — ${theme}`, async ({ page }) => {
        // WS3-T2 — the living twin (`cycleTwin.ts`/`useCycleTwin.ts`) positions the head/carriage and
        // reveals per-point results as a plain SVG-attribute recomputed every `requestAnimationFrame`
        // from real wall-clock `Date.now()` vs. the live plan's own `startedAt`/`durationSeconds` —
        // NOT a CSS `animation`, so the `animation: none !important` override below (still needed for
        // the genuinely-ambient CSS loops that remain — belt ticks, IoT signal-pulse arcs) has no
        // effect on it. Freezing `Date.now()` (`page.clock.setFixedTime`, real timers/network/rAF
        // still tick normally) is what makes THIS deterministic instead: any fixed instant far past
        // the live plan's own `startedAt + durationSeconds` clamps `computeCyclePlanClock` to the same
        // "cycle complete" pose every run — every step revealed by its own real result, head/carriage
        // resting at the LAST real point — regardless of which actual cycle is in flight when the
        // test happens to run. This is a MEANINGFUL baseline (real per-point colours, real final
        // position), not a trivial idle one, and needs no new masking for the pose itself — only the
        // *which* result each point landed (a live per-cycle draw) still needs the existing stable-box
        // group masks (`.hmi-aoi-points-group`/`.hmi-scrw-points-group`) below.
        await page.clock.setFixedTime(FROZEN_FUTURE_TIME)
        await primeAppStorage(page, { theme })
        await gotoHmi(page, code)
        // H4 job 3 — Playwright's built-in `animations: "disabled"` (the config default this suite
        // relies on) freezes CSS transitions and FINITE animations reliably, but `index.css`'s
        // `.hmi-schematic-run` keyframes (gantry sweep, camera sweep, belt-tick dash, signal pulse,
        // packet travel, etc. — all `animation-iteration-count: infinite`) are a documented
        // Playwright edge case: forcing `animation-duration: 0s` on an INFINITE-iteration animation
        // doesn't reliably land every element on the same deterministic frame across runs in headless
        // Chromium, reproduced live as a ~1px sub-pixel shift bleeding into unmasked, otherwise-
        // completely-static sibling text (the "Tốc độ chu kỳ / Cycle Rate" micro-label) once the
        // suite's tolerance was tightened — not a hypothetical flake, caught 3/3 times on repeated
        // fresh runs before this fix. `animation: none` is a stronger, unambiguous override than
        // duration:0 for infinite animations (no "which frame did a 0-duration infinite loop land on"
        // ambiguity — the element just renders its unanimated base state), applied here rather than in
        // the app's own CSS so production keeps its real motion.
        await page.addStyleTag({ content: ".hmi-schematic-run * { animation: none !important; }" })
        // Belt-and-suspenders against the exact flake the comment above describes: force layout/paint
        // to settle on the style injection AND on web-font readiness before the pixel comparison,
        // rather than relying solely on `toHaveScreenshot`'s own internal stability retries (which
        // compare successive screenshots to EACH OTHER, not to the saved baseline — they can agree
        // with each other on a still-slightly-off sub-pixel snap and call that "stable").
        await page.evaluate(() => document.fonts.ready)
        // Two RAF round-trips: waits for the style-injection's layout/paint to actually land (not
        // just for the promise above to resolve) before the pixel comparison — the standard
        // Playwright idiom for "let a just-applied style mutation finish settling."
        await page.evaluate(
          () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
        )
        // H2b: the ORIGINAL mask list here (`.hmi-graph-paper`, `.hmi-readout-grid` — the whole
        // schematic body and the whole readout panel) is exactly why the live review's flaws
        // (schematic marooned in ~25% of its sheet, a dead band under the readouts, and later C-4's
        // rotating-about-the-wrong-origin bug) slipped past this baseline — masking the entire live
        // region also hides any STRUCTURAL regression inside it. Tightened to mask only the
        // sub-elements that are genuinely non-deterministic run-to-run against the shared `FleetHost`
        // singleton via stable `hmi-*` class hooks each component sets on exactly that live node.
        // Everything else (registration corners, the schematic's drawing/dimension lines/graph-paper
        // ground, the readout grid's borders/dividers/micro-labels, panel titles) stays UNmasked, so a
        // regression is actually caught by the pixel diff instead of being invisible under a mask
        // block.
        await expect(page).toHaveScreenshot(`hmi-${slug}-${theme}.png`, { mask: mask(page) })
      })

      test(`a11y (axe, wcag2a/2aa/21aa) — ${slug} — ${theme}`, async ({ page }) => {
        await primeAppStorage(page, { theme })
        await gotoHmi(page, code)
        await assertNoSeriousA11yViolations(page)
      })
    }
  }
})
