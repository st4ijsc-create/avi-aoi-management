import { expect, type Page } from "@playwright/test"

import { vi as viDict } from "../../src/i18n/vi"

/**
 * Shared "navigate + wait until actually ready" helpers for each of the 7 screens — used by both
 * `00-visual-and-a11y.spec.ts` (pristine baselines) and every functional spec, so both always wait
 * on the exact same real signals (never a fixed `waitForTimeout`) before asserting/screenshotting.
 */

/** Waits for the TopBar's server-status dot to settle on "connected" — proof `GET /v1/health`
 * actually round-tripped, not just that the SPA shell mounted. Every screen inside `<Shell>` shares
 * this TopBar (`/tokens` is the one exception — it renders standalone, see `gotoTokens` below). */
async function waitForEngineConnected(page: Page): Promise<void> {
  await expect(page.getByText(viDict.shell.topBar.engineConnected)).toBeVisible({ timeout: 15_000 })
}

export async function gotoDashboard(page: Page): Promise<void> {
  await page.goto("/")
  await expect(page.getByRole("heading", { name: viDict.dashboard.title, level: 1 })).toBeVisible()
  await waitForEngineConnected(page)
  // KPI row past its skeleton — this label only renders once `useFleet()` has resolved at least once.
  await expect(page.getByText(viDict.dashboard.kpi.machinesOnline)).toBeVisible()
}

export async function gotoMachines(page: Page): Promise<void> {
  await page.goto("/machines")
  await expect(page.getByRole("heading", { name: viDict.machines.title, level: 1 })).toBeVisible()
  await waitForEngineConnected(page)
  // Past the skeleton — the table header only renders once `useFleet()` has resolved at least once.
  await expect(page.getByRole("columnheader", { name: viDict.machines.table.code })).toBeVisible()
}

export async function gotoMachineDetail(page: Page, code: string): Promise<void> {
  await page.goto(`/machines/${code}`)
  await expect(page.getByRole("heading", { name: code, level: 1 })).toBeVisible({ timeout: 15_000 })
  await waitForEngineConnected(page)
}

export async function gotoInspector(page: Page): Promise<void> {
  await page.goto("/inspector")
  await expect(page.getByRole("heading", { name: viDict.inspector.title, level: 1 })).toBeVisible()
  await waitForEngineConnected(page)
}

export async function gotoOnboarding(page: Page): Promise<void> {
  await page.goto("/onboarding")
  await expect(page.getByRole("heading", { name: viDict.onboarding.title, level: 1 })).toBeVisible()
  await waitForEngineConnected(page)
  await expect(page.getByLabel(viDict.onboarding.register.serialLabel)).toBeVisible()
}

export async function gotoSettings(page: Page): Promise<void> {
  await page.goto("/settings")
  await expect(page.getByRole("heading", { name: viDict.settings.title, level: 1 })).toBeVisible()
  await waitForEngineConnected(page)
  // Past the skeleton — the real Server URL field carries a real value once `useSettings()` resolves.
  await expect(page.locator("#settings-server-url")).toHaveValue(/\S/, { timeout: 15_000 })
}

export async function gotoScenario(page: Page): Promise<void> {
  await page.goto("/scenario")
  await expect(page.getByRole("heading", { name: viDict.scenario.title, level: 1 })).toBeVisible()
  await waitForEngineConnected(page)
  // Not `getByText` — the subtitle paragraph ("Thanh trượt + preset trình diễn — …") contains this
  // same string as a case-insensitive substring, making a plain text locator ambiguous.
  await expect(page.getByRole("heading", { name: viDict.scenario.presetsTitle, level: 2 })).toBeVisible({
    timeout: 15_000,
  })
}

/**
 * `/tokens` renders standalone (`App.tsx` routes it OUTSIDE `<Shell>`), so there's no TopBar/health
 * dot to wait on. Its dark-mode toggle is also a page-LOCAL `useState` (`_tokens.tsx`'s
 * `useThemeToggle`), not the shared `ThemeProvider` that `tests/support/theme.ts`'s
 * `primeAppStorage` primes via `localStorage`: that local hook seeds its initial state by reading
 * `document.documentElement.dataset.theme` synchronously during the page's first render, which
 * happens strictly before `ThemeProvider`'s own effect (a sibling concern in the same app, but a
 * different subtree in this route) has had a chance to SET that attribute — so on a fresh
 * navigation this page always starts light no matter what's in `localStorage`. Reaching dark mode
 * here means clicking its own "Dark mode" button instead — same end state
 * (`[data-theme="dark"]` on `<html>`), just a different, page-specific trigger. (English-only
 * strings below are intentional — this reference page isn't run through `t()`, see its own header.)
 */
export async function gotoTokens(page: Page, theme: "light" | "dark" = "light"): Promise<void> {
  await page.goto("/tokens")
  await expect(page.getByText("ST4I Design System")).toBeVisible()
  if (theme === "dark") {
    await page.getByRole("button", { name: "Dark mode" }).click()
    await expect(page.getByRole("button", { name: "Light mode" })).toBeVisible()
  }
}
