import type { Page } from "@playwright/test"

/** WS1 — 3-theme system (docs/PRODUCTION_UI_DESIGN.md). Every spec below pins `"glass"` (the
 * default) for now — WS1-T1's own scope is the token foundation + selector, not a full 3-theme
 * visual baseline; WS1-T3 rebuilds baselines properly across all 3 themes for a representative
 * screen set (see that task's plan entry). Keeping the union type here (not narrowing it to just
 * `"glass"`) is deliberate — it's what every call site type-checks against, so T3 only has to widen
 * the *values* each spec iterates, not touch this type or any call site's shape.
 *
 * WS-HMI-1 Task 4 — widened to a 4th value, `"isa101"`, mirroring `src/theme/ThemeToggle.tsx`'s own
 * `Theme` union. Existing `const THEMES: Theme[] = ["glass", "console", "warmth"]` literals elsewhere
 * in this suite (`00-visual-and-a11y.spec.ts`, `11-hmi.spec.ts`, `12`/`13`/`14`) still type-check
 * unchanged — a plain array typed `Theme[]` is not required to be exhaustive — so this widening does
 * not by itself add isa101 to any of their existing baseline loops. */
export type Theme = "glass" | "console" | "warmth" | "isa101"

/**
 * Pins the shell's theme + language in `localStorage` via `addInitScript` — injected before ANY of
 * the page's own scripts run on every subsequent navigation in this test, so `ThemeProvider`'s
 * `useState(initialTheme)` (`src/theme/ThemeToggle.tsx`) and `LanguageProvider`'s equivalent
 * (`src/i18n/index.ts`) read the target values on their very first render. No visible toggle click,
 * no flash-of-wrong-theme.
 *
 * Does NOT apply to `/tokens` (`src/routes/_tokens.tsx`): that page manages its own LOCAL
 * light/dark state, seeded by reading `document.documentElement.dataset.theme` synchronously during
 * its first render — which happens before `ThemeProvider`'s effect has had a chance to set that
 * attribute, so it always starts light regardless of this helper. `tests/support/screens.ts`'s
 * `gotoTokens` clicks that page's own "Dark mode" button instead — see its comment for the full
 * reasoning.
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
