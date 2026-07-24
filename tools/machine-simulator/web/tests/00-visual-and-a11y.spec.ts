import { expect, test, type Page } from "@playwright/test"

import { assertNoSeriousA11yViolations } from "./support/a11y"
import { setFleetRunning } from "./support/engine"
import {
  gotoDashboard,
  gotoInspector,
  gotoMachineDetail,
  gotoMachineDetailConfig,
  gotoMachines,
  gotoOnboarding,
  gotoProductConfig,
  gotoProductConfigDetail,
  gotoProductConfigPoints,
  gotoRecipeConfig,
  gotoRecipeConfigDetail,
  gotoScenario,
  gotoSettings,
  gotoTokens,
} from "./support/screens"
import { primeAppStorage, type Theme } from "./support/theme"

/**
 * Visual-regression + axe a11y baselines for all 14 screens.
 *
 * WS1-T1 (docs/plans/2026-07-24-theme-system.md) pinned every screen to Glass only (the new default
 * theme): the old `["light", "dark"]` sweep no longer type-checked against the 3-theme `Theme` union,
 * and WS1-T1's own scope was the token foundation + selector, not a full 3-theme visual baseline.
 *
 * WS1-T3 widens a REPRESENTATIVE subset (`MULTI_THEME_SLUGS` below) to all 3 themes instead of
 * tripling all 14 — the plan's own Task 3 entry explicitly says "not blindly triple every baseline;
 * pick contrast-risky screens." The other 10 screens stay Glass-only: they're compositionally the
 * same `.sheet`-panel/table/form primitives already exercised by the widened set, so a Console/Warmth
 * regression in, say, `Select`'s popup radius or `Tabs`' focus ring would already be caught on
 * `machine-detail-config`'s or `product-config-detail`'s shared components via the widened screens
 * above, or via `13-machine-settings.spec.ts`'s own 3-theme axe sweep (widened in WS1-T1) covering a
 * settings-panel variant of the same primitives. Every screen/mask/assertion below is otherwise
 * unchanged.
 *
 * SHOULD run before any other spec file (numeric `00-` prefix + `workers: 1` + `fullyParallel: false`
 * in the config fix the order) — file order matters here because `FleetHost` inside the engine is a
 * process-lifetime singleton (see `playwright.config.ts`'s top comment). Every screen below is
 * captured against a stopped fleet: cycles, scenario, and settings are all still at their hardcoded
 * startup defaults on a genuinely fresh engine, since nothing before this file ever calls
 * `POST /v1/fleet/start`.
 *
 * WS3-T3 (visual-determinism-report.md) — that "nothing before this file starts the fleet" invariant
 * held in THEORY from file order alone, but proved fragile in practice: `playwright.config.ts`'s own
 * `webServer` reuses an already-running dev server outside CI (`reuseExistingServer: !process.env.CI`),
 * and `11-hmi.spec.ts`'s `afterEach` deliberately leaves the shared fleet RUNNING when the suite
 * finishes — so a second `npm run test:e2e` invocation against that same still-warm process (a
 * realistic local dev loop, not a hypothetical) started this file's very first test with cycles already
 * climbing, and every data cell/sparkline captured here silently baked in whatever cycle count/pass
 * rate happened to be live at that instant — a real, reproduced source of baseline drift across runs
 * that no per-node mask (they cover UNPREDICTABLE positions, not "the whole tile happens to say a
 * different number today") could paper over. Every test below now calls `setFleetRunning(request,
 * false)` first — `FleetHost.Stop()` is a no-op if already stopped (the common case, cycles staying at
 * their hardcoded startup default of 0), so this doesn't change what a normal file-order run captures;
 * it just stops relying on that ordering ALONE to guarantee it, the same "establish your own
 * precondition, don't inherit one from file order" discipline `11-hmi.spec.ts`'s own I-15 fix already
 * applies. No `mask:` is needed anywhere in this file as a result — see `task-10-report.md` for the
 * full reasoning, and the functional specs (`01`–`06`) for how the POPULATED/live states are covered
 * instead (DOM/role assertions, not pixel snapshots — the brief's own explicit fallback for
 * inherently-live regions).
 *
 * Viewport is taller than the functional specs' default (1440×900): the shell's outermost wrapper is
 * `h-svh overflow-hidden` with only an INNER `<main>` scrolling, so there's no page-level scroll for
 * Playwright's `fullPage` to capture — a short viewport would just clip a taller screen's content
 * (Settings' 2×2 card grid, mainly) out of the shot instead of scrolling to it.
 */
test.use({ viewport: { width: 1440, height: 1600 } })

// WS3-T3 — see this file's top doc comment: establishes the "stopped fleet" precondition explicitly,
// rather than relying solely on file order + an assumption about what an earlier `npm run test:e2e`
// invocation against a reused dev server left the shared engine in.
test.beforeEach(async ({ request }) => {
  await setFleetRunning(request, false)
})

const GLASS_ONLY: Theme[] = ["glass"]
const ALL_THEMES: Theme[] = ["glass", "console", "warmth"]

/** WS1-T3 — the representative, contrast-risky screen set that gets full 3-theme visual+axe
 * coverage (see this file's top doc comment for why the other 10 screens stay Glass-only):
 *  - `dashboard`/`machines`: the KPI-tile/StatusBadge/table-row-pulse-heavy screens — the highest
 *    density of the `--status-*` + `--ok/warn/danger/neutral` alias tokens anywhere in the app, so
 *    the screens most likely to break contrast or "glow" semantics on Console/Warmth.
 *  - `machine-detail`: the physical `ControlButton` (Warmth's own `--elevation` signature bullet)
 *    + `StatusLamp` (Console's `--glow-run` signature bullet) live together on one screen.
 *  - `product-config-points`: the one screen built on `BoardCanvas` — a background-image + absolutely
 *    positioned marker layout, a categorically different rendering primitive than every `.sheet`/table
 *    screen above (spec's own "instrument marks stay square" invariant lives here too).
 *  - the HMI operator panel (`11-hmi.spec.ts`'s own `SCHEMATIC_CASES`, widened separately in that
 *    file) covers all 3 machine classes (SCRW/AOI/IOT) × all 3 themes — the plan's explicit ask. */
const MULTI_THEME_SLUGS = new Set(["dashboard", "machines", "machine-detail", "product-config-points"])

interface ScreenCase {
  slug: string
  visit: (page: Page, theme: Theme) => Promise<void>
  /** Per-screen viewport override — only `tokens` needs one, see its own case below. */
  viewport?: { width: number; height: number }
}

const SCREENS: ScreenCase[] = [
  {
    slug: "dashboard",
    visit: async (page, theme) => {
      await primeAppStorage(page, { theme })
      await gotoDashboard(page)
    },
  },
  {
    slug: "machines",
    visit: async (page, theme) => {
      await primeAppStorage(page, { theme })
      await gotoMachines(page)
    },
  },
  {
    slug: "machine-detail",
    visit: async (page, theme) => {
      await primeAppStorage(page, { theme })
      await gotoMachineDetail(page, "SCRW-01")
    },
  },
  {
    // Task C7 — per-machine config-sync panel: AOI-01 (AoiAvi) so the pristine, deterministic seed
    // divergence (`SimulatedEcosystem`'s doc comment: MODEL-A local v3 vs ecosystem v5) renders a real,
    // non-trivial diff (changed/removed/added points) on the very first pull — the richest, most
    // representative state for this screen's baseline. Read-only visit (no pull/push click) so this
    // stays a pristine snapshot like every other screen here, and doesn't mutate the shared
    // `SimulatedEcosystem`/`ProductConfigStore` state later specs (02-machine-detail.spec.ts's own
    // config-tab tests) rely on starting from.
    slug: "machine-detail-config",
    visit: async (page, theme) => {
      await primeAppStorage(page, { theme })
      await gotoMachineDetailConfig(page, "AOI-01")
    },
  },
  {
    slug: "inspector",
    visit: async (page, theme) => {
      await primeAppStorage(page, { theme })
      await gotoInspector(page)
    },
  },
  {
    slug: "onboarding",
    visit: async (page, theme) => {
      await primeAppStorage(page, { theme })
      await gotoOnboarding(page)
    },
  },
  {
    slug: "settings",
    visit: async (page, theme) => {
      await primeAppStorage(page, { theme })
      await gotoSettings(page)
    },
  },
  {
    slug: "scenario",
    visit: async (page, theme) => {
      await primeAppStorage(page, { theme })
      await gotoScenario(page)
    },
  },
  {
    slug: "product-config",
    visit: async (page, theme) => {
      await primeAppStorage(page, { theme })
      await gotoProductConfig(page)
    },
  },
  {
    slug: "product-config-detail",
    visit: async (page, theme) => {
      await primeAppStorage(page, { theme })
      await gotoProductConfigDetail(page, "MODEL-A")
    },
  },
  {
    // Task C5 — board image-overlay canvas + points list + full-spec form + fiducials/variants.
    slug: "product-config-points",
    visit: async (page, theme) => {
      await primeAppStorage(page, { theme })
      await gotoProductConfigPoints(page, "MODEL-A")
    },
  },
  {
    // Task C6 — recipe (System A) catalog list.
    slug: "recipe-config",
    visit: async (page, theme) => {
      await primeAppStorage(page, { theme })
      await gotoRecipeConfig(page)
    },
  },
  {
    // Task C6 — recipe editor: typed payload fields + generic key/value rows, seeded `SCREWDRIVE-M4`.
    slug: "recipe-config-detail",
    visit: async (page, theme) => {
      await primeAppStorage(page, { theme })
      await gotoRecipeConfigDetail(page, "SCREWDRIVE-M4")
    },
  },
  {
    slug: "tokens",
    // `/tokens` manages its own local light/dark toggle (unrelated to the app's 3-way `Theme`) —
    // see `gotoTokens`'s doc comment. Only ever called with "glass" today (see `THEMES` above), so
    // this always resolves to "light" — the `=== "console"` mapping is there for WS1-T3, when this
    // loop widens to all 3 themes and Console should show that page's own "dark" state.
    visit: async (page, theme) => gotoTokens(page, theme === "console" ? "dark" : "light"),
    // H4 job 3 — `/tokens` alone needs a viewport TALL ENOUGH to cover its whole ~3240px of content
    // (3300 for margin), NOT `fullPage: true`. That route is a genuinely page-scrolling document (not
    // the app shell's `h-svh overflow-hidden` + inner-`<main>`-scrolls layout the other 13 screens use
    // — see this file's own top doc comment for why THEY use a fixed 1440×1600 viewport instead), so
    // `fullPage` looked like the obvious fit — but it reproducibly captured a STALE render for
    // content below the visible fold: injecting a real regression (`ui/status-badge.tsx`'s "ok" tone
    // swapped for the decorative "info" hue, affecting swatches at y≈2321) was invisible to a
    // `fullPage: true` capture even though `getComputedStyle` AND an in-viewport screenshot of the
    // exact same page both confirmed the regressed color was genuinely painted there — Chromium's
    // full-page capture stitches from compositor tiles that can go stale for off-screen content that
    // was never scrolled into view before the capture. A tall fixed viewport (no scrolling needed,
    // nothing ever off-screen) sidesteps that entirely and reproducibly WAS caught.
    viewport: { width: 1440, height: 3300 },
  },
]

for (const screen of SCREENS) {
  test.describe(screen.slug, () => {
    const themes = MULTI_THEME_SLUGS.has(screen.slug) ? ALL_THEMES : GLASS_ONLY
    for (const theme of themes) {
      test(`visual — ${theme}`, async ({ page }) => {
        if (screen.viewport) await page.setViewportSize(screen.viewport)
        await screen.visit(page, theme)
        // `.hmi-clock` — the shared TopBar's live HH:MM:SS clock (`TopBar.tsx`'s `Clock`, same class
        // hook `Nameplate.tsx`'s own clock uses for `11-hmi.spec.ts`'s mask list) is the ONE
        // genuinely-nondeterministic node on every one of these otherwise-pristine screens: it ticks
        // every second, so a baseline captured at time T1 and compared against a run at time T2 will
        // always differ there even though nothing regressed. Masking just this node (not the whole
        // header/TopBar) is what makes the H4 job-3 tightened `maxDiffPixelRatio` hold without
        // reintroducing flakiness — everything else on the page (including the rest of the TopBar) stays
        // unmasked, so a real regression there is still caught. No-op on `/tokens` (renders standalone,
        // no TopBar/clock).
        await expect(page).toHaveScreenshot(`${screen.slug}-${theme}.png`, {
          mask: [page.locator(".hmi-clock")],
        })
      })

      test(`a11y (axe, wcag2a/2aa/21aa) — ${theme}`, async ({ page }) => {
        await screen.visit(page, theme)
        await assertNoSeriousA11yViolations(page)
      })
    }
  })
}
