import { expect, test, type Page } from "@playwright/test"

import { assertNoSeriousA11yViolations } from "./support/a11y"
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
 * WS1-T1 (docs/plans/2026-07-24-theme-system.md) — pinned to Glass only (the new default theme)
 * here: the old `["light", "dark"]` sweep no longer type-checks against the 3-theme `Theme` union,
 * and WS1-T1's own scope is the token foundation + selector, not a full 3-theme visual baseline.
 * WS1-T3 rebuilds this properly across a representative screen set × all 3 themes — see that task's
 * plan entry. Every screen/mask/assertion below is unchanged; only the theme AXIS narrowed from 2
 * values to 1.
 *
 * MUST run before any other spec file — file order matters here because `FleetHost` inside the
 * engine is a process-lifetime singleton (see `playwright.config.ts`'s top comment). Every screen
 * below is captured PRISTINE: the fleet has never been started in this engine process, so cycles,
 * scenario, and settings are all still at their hardcoded startup defaults. That's not "probably
 * stable" — masking live counters would only get you that — it's PROVABLY deterministic: cycles
 * literally cannot change without an explicit `POST /v1/fleet/start`, which nothing before this file
 * runs (numeric `00-` prefix + `workers: 1` + `fullyParallel: false` in the config fixes the order).
 * No `mask:` is needed anywhere in this file as a result — see `task-10-report.md` for the full
 * reasoning, and the functional specs (`01`–`06`) for how the POPULATED/live states are covered
 * instead (DOM/role assertions, not pixel snapshots — the brief's own explicit fallback for
 * inherently-live regions).
 *
 * Viewport is taller than the functional specs' default (1440×900): the shell's outermost wrapper is
 * `h-svh overflow-hidden` with only an INNER `<main>` scrolling, so there's no page-level scroll for
 * Playwright's `fullPage` to capture — a short viewport would just clip a taller screen's content
 * (Settings' 2×2 card grid, mainly) out of the shot instead of scrolling to it.
 */
test.use({ viewport: { width: 1440, height: 1600 } })

const THEMES: Theme[] = ["glass"]

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
    for (const theme of THEMES) {
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
