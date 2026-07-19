import * as React from "react"
import { Moon, Sun } from "lucide-react"

import { useT } from "@/i18n"
import { Button } from "@/components/ui/button"

export type Theme = "light" | "dark"

const STORAGE_KEY = "st4i-sim-theme"

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches
}

function readStoredTheme(): Theme | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw === "light" || raw === "dark" ? raw : null
  } catch {
    // Private-browsing/storage-disabled — fall through to OS preference.
    return null
  }
}

/** OS preference first, falling back to a persisted explicit choice, falling back to light —
 * matches the brief's "respects OS default first" (an explicit toggle from here on always wins,
 * persisted, until the browser storage is cleared). */
function initialTheme(): Theme {
  const stored = readStoredTheme()
  if (stored) return stored
  return systemPrefersDark() ? "dark" : "light"
}

interface ThemeContextValue {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>(initialTheme)
  const explicitRef = React.useRef(readStoredTheme() !== null)

  React.useEffect(() => {
    const root = document.documentElement
    if (theme === "dark") root.setAttribute("data-theme", "dark")
    else root.removeAttribute("data-theme")
  }, [theme])

  // Track the OS setting live only until the user makes an explicit choice from this app — once
  // they've toggled, that choice is sticky (persisted) and no longer overridden by an OS-level flip.
  React.useEffect(() => {
    if (explicitRef.current) return
    const mql = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = (e: MediaQueryListEvent) => setThemeState(e.matches ? "dark" : "light")
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  const setTheme = React.useCallback((next: Theme) => {
    explicitRef.current = true
    setThemeState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Storage disabled — the in-memory value above still drives this session's UI.
    }
  }, [])

  const toggleTheme = React.useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark")
  }, [theme, setTheme])

  const value = React.useMemo(() => ({ theme, setTheme, toggleTheme }), [theme, setTheme, toggleTheme])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext)
  if (!ctx) throw new Error("useTheme must be used within <ThemeProvider>")
  return ctx
}

/** Icon-only toggle for the TopBar — same visual language as the `/tokens` reference showcase's own
 * toggle, wired to the shared, persisted `ThemeProvider` instead of page-local state. */
export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  const t = useT()
  const isDark = theme === "dark"

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-pressed={isDark}
      aria-label={isDark ? t("theme.toggleToLight") : t("theme.toggleToDark")}
      onClick={toggleTheme}
    >
      {isDark ? <Sun className="size-3.5" aria-hidden="true" /> : <Moon className="size-3.5" aria-hidden="true" />}
    </Button>
  )
}
