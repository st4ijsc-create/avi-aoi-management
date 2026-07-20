import { expect, test, type Page } from "@playwright/test"

import { assertNoSeriousA11yViolations } from "./support/a11y"
import {
  gotoDashboard,
  gotoInspector,
  gotoMachineDetail,
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
 * Visual-regression + axe a11y baselines for all 7 screens, light + dark.
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

const THEMES: Theme[] = ["light", "dark"]

interface ScreenCase {
  slug: string
  visit: (page: Page, theme: Theme) => Promise<void>
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
    // `/tokens` manages its own local theme toggle — see `gotoTokens`'s doc comment.
    visit: async (page, theme) => gotoTokens(page, theme),
  },
]

for (const screen of SCREENS) {
  test.describe(screen.slug, () => {
    for (const theme of THEMES) {
      test(`visual — ${theme}`, async ({ page }) => {
        await screen.visit(page, theme)
        await expect(page).toHaveScreenshot(`${screen.slug}-${theme}.png`)
      })

      test(`a11y (axe, wcag2a/2aa/21aa) — ${theme}`, async ({ page }) => {
        await screen.visit(page, theme)
        await assertNoSeriousA11yViolations(page)
      })
    }
  })
}
