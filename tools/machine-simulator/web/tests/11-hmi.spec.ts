import { expect, test, type Locator, type Page } from "@playwright/test"

import { assertNoSeriousA11yViolations } from "./support/a11y"
import { LIVE_CYCLES_MS, POLL_RESYNC_MS } from "./support/deadlines"
import { pullMachineConfig, resetEstop, resetMachineSetting, setFleetRunning, setMachineSetting } from "./support/engine"
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
 * regardless of what the immediately-preceding test left behind (the HALT test below stops it);
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
 *
 * WS3-T3 (visual-determinism-report.md) — the schematic VISUAL cases below (`SCHEMATIC_CASES`) are the
 * one exception to "every test in this file wants a running fleet": they explicitly stop it right
 * before capturing (see that loop's own comment for why a frozen `Date.now()` alone — the original
 * WS3-T2 approach — wasn't enough).
 */

test.describe("HMI operator panel", () => {
  test.beforeEach(async ({ request }) => {
    await pullMachineConfig(request, "AOI-01", "MODEL-A")
    await resetEstop(request)
    await setFleetRunning(request, true)
  })
  test.afterEach(async ({ request }) => {
    // Defensive: clear a latch BEFORE trying to restart — StartLocked refuses while EstopEngaged
    // (see `FleetHost.cs`), so a test that leaves HALT engaged would otherwise silently leave the
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

  test("physical controls: Start/Pause/HALT present and reflect real fleet state", async ({ page }) => {
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
    await expect(page.getByText(viDict.hmi.log.empty)).toHaveCount(0)
    await expect.poll(() => page.getByRole("listitem").count()).toBeGreaterThan(0)
  })

  test("AOI schematic plots real product measurement points", async ({ page }) => {
    await gotoHmi(page, "AOI-01")
    const schematic = page.getByRole("img", { name: /FIG\. 01/ })
    await expect(schematic).toBeVisible()
    // Real `MeasurementPoint`s from the product config, plotted as circles carrying their own code
    // as an accessible `<title>` — not the engine's generic simulator point codes (see
    // `AoiSchematic.tsx`'s header comment on the positional-correspondence disclosure).
    await expect.poll(() => schematic.locator("circle title").count()).toBeGreaterThan(0)
  })

  // WS3-T3 (visual-determinism-report.md) — the living twin's ACTUAL live behaviour (head/carriage
  // really moving frame-to-frame off the engine's real per-cycle `CyclePlan`; a point really lighting
  // up in its own step's real OK/NG colour) is what the schematic VISUAL baselines below deliberately
  // stop capturing (they now freeze the fleet for a deterministic idle pose instead — see that loop's
  // own comment). This is the non-pixel replacement: real DOM/attribute assertions against the running
  // fleet, so the twin's motion and per-point NG lighting stay covered by something a real regression
  // there would actually fail, without a flaky pixel baseline standing in for it.
  test("living twin: the head genuinely travels across a cycle, and a point lights up NG when its real step result is NG", async ({
    page,
    request,
  }) => {
    // 🔴 This used to apply the shipped `high-defect` preset, and the comment here used to say that
    // gave "35%/point, vs. the ~5% default". **That was not what the preset did to this assertion —
    // it did nothing to it at all.** The scenario's defect/fault knobs are applied by
    // `ScenarioAwareDriver.Inject`, which wraps the driver and mutates `reading.Verdict` and
    // `reading.Measurements` AFTER the simulator has produced them. The NG dot asserted below comes
    // from `reading.Plan` (`MachineState.cs:184` stores it wholesale; `AoiSchematic.tsx` renders
    // `step.result`), and `Inject` never touches `Plan`. So the injected failure changes the machine's
    // verdict without ever changing a dot — the preset was inert here, and what the test was actually
    // waiting on the whole time was `AoiInspectorSim`'s OWN per-point NG rate at the default
    // `matchThreshold`.
    //
    // That rate is why this was the tightest deadline in the suite. `matchScore ~ N(0.93, 0.05)` and a
    // point is NG when `matchScore < matchThreshold`, so at the 0.85 default P(NG) ≈ 0.055 per point,
    // ≈ 0.36 per 8-point board, ≈ 2.8 AOI cycles (1.8 s each) expected — with a long tail. A measured
    // run caught it at **15 295 ms against a 20 000 ms bound**: 1.3x, the tightest ratio anywhere in
    // this suite, on the one wait whose duration was a random variable.
    //
    // Raising `matchThreshold` to its schema maximum (0.99) takes P(NG) to ≈ 0.885 per point, i.e.
    // effectively certain on every single cycle — and it does so through the sim's own physics, so it
    // lands in `Plan` where this assertion can see it. The wait stops being probabilistic. This
    // weakens nothing: the property under test is "a real NG step result lights ITS OWN dot NG", and
    // how often the sim produces one is the precondition, not the claim.
    //
    // Undone in a `finally` regardless of outcome — and Playwright does run this `finally` even when
    // the test hits its own timeout (verified, task-2-report.md §2).
    await setMachineSetting(request, "AOI-01", "matchThreshold", 0.99, "machine")
    try {
      // Head motion: `AutomationSchematic.tsx`'s carriage group (`.hmi-gantry-head`) is a plain SVG
      // `transform` attribute recomputed every `requestAnimationFrame` from the real cycle clock
      // (`cycleTwin.ts`) — not a CSS animation — so a real regression that froze the twin (e.g. a
      // stale `plan` never re-fetched, or `useCycleTwin` wired to the wrong `animate` gate) would leave
      // this attribute constant forever. Sampling it once, then polling for ANY change, is a direct,
      // non-pixel proof the head is actually moving.
      await gotoHmi(page, "SCRW-01")
      const head = page.locator(".hmi-gantry-head")
      const initialTransform = await head.getAttribute("transform")
      await expect.poll(() => head.getAttribute("transform")).not.toBe(initialTransform)

      // Per-point NG lighting: `AoiSchematic.tsx` gives each live step's dot an accessible `<title>`
      // of `"{code} — {ĐẠT|LỖI}"` once that step's real result is revealed — a real regression that
      // broke the plan→dot result wiring (miscoloring every dot the same tone, or never revealing a
      // result at all) would leave this NG title unreachable even at a near-certain per-point NG rate.
      await gotoHmi(page, "AOI-01")
      const ngTitles = page.locator(".hmi-aoi-points-group circle title", { hasText: viDict.hmi.progress.ngLabel })
      await expect.poll(() => ngTitles.count(), { timeout: LIVE_CYCLES_MS }).toBeGreaterThan(0)
    } finally {
      await resetMachineSetting(request, "AOI-01", "matchThreshold", "machine")
    }
  })

  test("HALT latches a real fault: stops the fleet, locks controls, freezes the schematic; RESET clears it", async ({
    page,
    request,
  }) => {
    await gotoHmi(page, "SCRW-01")
    const schematicGroup = page.locator('svg[role="img"] > g').first()
    await expect(schematicGroup).toHaveClass(/hmi-schematic-run/)

    await page.getByRole("button", { name: viDict.hmi.controls.estop }).click()

    // The whole panel visibly goes to fault.
    await expect(page.getByText(viDict.hmi.controls.estopBanner)).toBeVisible()
    // `exact: true` — the StatusLamp label ("ĐÃ NGỪNG") and the control-rail banner
    // ("NGỪNG ĐÃ KÍCH HOẠT") are deliberately distinct strings (see `vi.ts`'s own `hmi.status.estop`
    // comment) that both render at once; `exact: true` is defence-in-depth against `getByText`'s
    // default substring matching in case a future wording change makes one contain the other again.
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
    await expect(header.getByText(viDict.hmi.status.sub.idle)).toBeVisible({ timeout: POLL_RESYNC_MS })
    await expect(schematicGroup).not.toHaveClass(/hmi-schematic-run/)
    await expect(page.getByRole("button", { name: viDict.hmi.controls.start })).toBeEnabled()
    await expect(page.getByRole("button", { name: viDict.hmi.controls.pause })).toBeDisabled()

    // And it resyncs back the other way too — started from elsewhere, this page follows without any
    // action of its own.
    await setFleetRunning(request, true)
    await expect(header.getByText(viDict.hmi.status.sub.run)).toBeVisible({ timeout: POLL_RESYNC_MS })
    await expect(schematicGroup).toHaveClass(/hmi-schematic-run/)
    await expect(page.getByRole("button", { name: viDict.hmi.controls.start })).toBeDisabled()
    await expect(page.getByRole("button", { name: viDict.hmi.controls.pause })).toBeEnabled()
  })

  test("C-2: HALT latch is server-owned — survives navigating to another machine's panel AND a reload; only RESET clears it", async ({
    page,
  }) => {
    await gotoHmi(page, "SCRW-01")
    await page.getByRole("button", { name: viDict.hmi.controls.estop }).click()
    await expect(page.getByText(viDict.hmi.controls.estopBanner)).toBeVisible()

    // Navigate to a DIFFERENT machine's panel — in a real cell, a second operator station. The
    // pre-fix bug (component-local React state) silently dropped the latch here: no banner, START
    // enabled, as if the halt never happened.
    await gotoHmi(page, "AOI-01")
    await expect(page.getByText(viDict.hmi.controls.estopBanner)).toBeVisible()
    await expect(page.getByText(viDict.hmi.status.estop, { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: viDict.hmi.controls.start })).toBeDisabled()

    // A full page reload — the pre-fix bug cleared client-only state here too.
    await page.reload()
    await expect(page.getByRole("heading", { name: "AOI-01", level: 1 })).toBeVisible()
    await expect(page.getByText(viDict.hmi.controls.estopBanner)).toBeVisible()
    await expect(page.getByRole("button", { name: viDict.hmi.controls.start })).toBeDisabled()

    // RESET (from THIS panel — a different one than where HALT was pressed) is what actually
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
  //
  // WS3-T3 (visual-determinism-report.md) — neither AOI's `.hmi-aoi-points-group` nor automation's
  // `.hmi-scrw-points-group` appear below anymore: the visual loop now captures these schematics with
  // the fleet STOPPED (see that loop's own comment), which puts `plan` at `null`
  // (`MachineState.ToDetail`'s own idle gate) and every schematic's OWN documented null-plan fallback
  // (`AoiSchematic.tsx`'s `points.map`, `AutomationSchematic.tsx`'s `IDLE_POINTS`) draws neutral,
  // un-lit dots at fixed configured positions — no live per-cycle draw left to mask. Everything else
  // here (clock, nameplate lamp, caption/feeder/reading strips, readout grid, log, output bar) is left
  // masked exactly as before: those still reflect whatever cycles/verdicts happened to accumulate
  // BEFORE this test's own stop call, which is real, still-live data the engine has no way to reset to
  // zero (see `01-dashboard.spec.ts`'s own remarks on `FleetHost` having no reset-to-seed endpoint).
  const SCHEMATIC_CASES: { slug: string; code: string; mask: (page: Page) => Locator[] }[] = [
    {
      slug: "aoi",
      code: "AOI-01",
      mask: (page) => [
        page.locator(".hmi-clock"),
        page.locator(".hmi-nameplate-lamp"),
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
      test(`visual — ${slug} — ${theme}`, async ({ page, request }) => {
        // WS3-T3 (visual-determinism-report.md) — the previous approach here froze the BROWSER'S
        // `Date.now()` (`page.clock.setFixedTime`) far past any real plan's `startedAt +
        // durationSeconds`, trying to clamp the JS-driven twin (`cycleTwin.ts`) to a "cycle complete"
        // pose. That froze the MOTION math, but not the underlying DATA: the plan/board-points the
        // twin reads still came from whichever real cycle the shared engine (`FleetHost`, a
        // process-lifetime singleton) happened to have committed most recently — a live, per-run
        // draw — so which points landed OK/NG, and exactly where the head rested, still differed run
        // to run (reproduced live as a ~0.01% diff bleeding into the unmasked "Cycle Rate" micro-label
        // once an infinite CSS loop — gated on the schematic's own `.hmi-schematic-run` class while
        // running — landed on a different sub-pixel frame across runs, a documented Playwright
        // edge case for infinite animations).
        //
        // Stopping the fleet fixes the actual source, not a symptom: `MachineState.ToDetail` gates
        // `plan` to `null` whenever the fleet isn't running, which routes every schematic to its own
        // documented, fully static idle fallback (see `SCHEMATIC_CASES`'s own comment above) — the
        // SAME pose every run, with zero live motion to freeze and zero infinite CSS animation classes
        // applied (`.hmi-schematic-run`/`.hmi-driving` are both React-applied only while `animate`,
        // which requires `isRunning`). This is a fully deterministic, real STRUCTURAL baseline (real
        // frame geometry, real configured point positions/count from the linked product) — an honest
        // idle capture, not a masked-live one; the twin's actual LIVE motion/NG-lighting behaviour
        // is covered separately by this file's own non-pixel "living twin" test above (running fleet,
        // no pixel snapshot).
        await setFleetRunning(request, false)
        await primeAppStorage(page, { theme })
        await gotoHmi(page, code)
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
