import * as React from "react"

export type Theme = "glass" | "console" | "warmth"

/** Draw order for anything that cycles/lists the 3 themes (topbar quick-switch, Settings
 * radiogroup) — Glass first since it's the default. */
export const THEMES: readonly Theme[] = ["glass", "console", "warmth"]

const STORAGE_KEY = "st4i-sim-theme"

function isTheme(value: string | null): value is Theme {
  return value === "glass" || value === "console" || value === "warmth"
}

/** WS1 migrates the old 2-way light/dark storage value onto the 3-way theme it most resembles —
 * light (the old default) → glass (the new default), dark → console (the new dark world; `dark:`
 * utilities now target `[data-theme="console"]`, see index.css). Warmth has no old equivalent, so
 * nothing ever migrates TO it — a user only lands there by picking it explicitly post-upgrade. */
function migrateLegacyTheme(value: string | null): Theme | null {
  if (value === "light") return "glass"
  if (value === "dark") return "console"
  return null
}

function readStoredTheme(): Theme | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (isTheme(raw)) return raw
    const migrated = migrateLegacyTheme(raw)
    if (migrated) {
      // Persist the migrated value immediately — otherwise every load would silently re-derive it
      // from the stale "light"/"dark" string forever instead of actually completing the migration.
      try {
        localStorage.setItem(STORAGE_KEY, migrated)
      } catch {
        // Storage disabled — the in-memory value below still drives this session's UI.
      }
    }
    return migrated
  } catch {
    // Private-browsing/storage-disabled — fall through to the default.
    return null
  }
}

/** A persisted explicit choice (including one just migrated from the old light/dark value) wins;
 * otherwise **Glass** (docs/PRODUCTION_UI_DESIGN.md: "Theme mặc định | Glass (sáng cao cấp)").
 * Unlike the old 2-way toggle, this does NOT fall back to `prefers-color-scheme` — there's no
 * sensible 3-way mapping from a binary OS preference, and the product decision is an explicit,
 * always-Glass default rather than an inferred one. */
function initialTheme(): Theme {
  return readStoredTheme() ?? "glass"
}

interface ThemeContextValue {
  theme: Theme
  setTheme: (theme: Theme) => void
  /** Advances to the next theme in `THEMES` order, wrapping — the topbar quick-switch's single
   * click/keypress action (`ThemeQuickSwitch` in `theme/ThemePicker.tsx` uses a full 3-item menu
   * instead, so this is here mainly for keyboard shortcuts / tests, kept from the old toggle's
   * shape so any other future caller has a one-step "next theme" primitive). */
  cycleTheme: () => void
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>(initialTheme)

  // `useLayoutEffect` (not `useEffect`) — runs synchronously before the browser paints, so a
  // returning user's persisted Console/Warmth choice never flashes Glass (the bare `:root`
  // default in index.css) for one frame first.
  React.useLayoutEffect(() => {
    document.documentElement.setAttribute("data-theme", theme)
  }, [theme])

  const setTheme = React.useCallback((next: Theme) => {
    setThemeState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Storage disabled — the in-memory value above still drives this session's UI.
    }
  }, [])

  const cycleTheme = React.useCallback(() => {
    setTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length])
  }, [theme, setTheme])

  const value = React.useMemo(() => ({ theme, setTheme, cycleTheme }), [theme, setTheme, cycleTheme])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext)
  if (!ctx) throw new Error("useTheme must be used within <ThemeProvider>")
  return ctx
}
