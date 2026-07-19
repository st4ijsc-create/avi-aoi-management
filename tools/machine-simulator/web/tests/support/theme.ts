import type { Page } from "@playwright/test"

export type Theme = "light" | "dark"

/**
 * Pins the shell's theme + language in `localStorage` via `addInitScript` — injected before ANY of
 * the page's own scripts run on every subsequent navigation in this test, so `ThemeProvider`'s
 * `useState(initialTheme)` (`src/theme/ThemeToggle.tsx`) and `LanguageProvider`'s equivalent
 * (`src/i18n/index.ts`) read the target values on their very first render. No visible toggle click,
 * no flash-of-wrong-theme, no dependency on OS `prefers-color-scheme` (the app only falls back to
 * that when no stored choice exists — this always provides one).
 *
 * Does NOT apply to `/tokens` (`src/routes/_tokens.tsx`): that page manages its own LOCAL theme
 * state, seeded by reading `document.documentElement.dataset.theme` synchronously during its first
 * render — which happens before `ThemeProvider`'s effect has had a chance to set that attribute, so
 * it always starts light regardless of this helper. `tests/support/screens.ts`'s `gotoTokens` clicks
 * that page's own "Dark mode" button instead — see its comment for the full reasoning.
 */
export async function primeAppStorage(page: Page, options: { theme: Theme; language?: "vi" | "en" }): Promise<void> {
  const { theme, language = "vi" } = options
  await page.addInitScript(
    ([themeValue, languageValue]) => {
      window.localStorage.setItem("st4i-sim-theme", themeValue)
      window.localStorage.setItem("st4i-sim-language", languageValue)
    },
    [theme, language]
  )
}
