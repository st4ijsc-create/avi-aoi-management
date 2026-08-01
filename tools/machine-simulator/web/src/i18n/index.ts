/**
 * Task 8 — a tiny i18n layer (no external i18n library): a `LanguageProvider` context, a `useT()`
 * hook resolving dot-path keys (`t("dashboard.title")`) against `vi.ts`/`en.ts`, and a `useLanguage()`
 * hook for the Settings language selector to read/drive the current language.
 *
 * Default language is Vietnamese (`vi`); the choice persists to `localStorage` and is applied
 * immediately (no reload) — every consumer re-renders because `t`'s identity changes with `language`.
 */
import * as React from "react"

import { en } from "./en"
import { vi, type Dictionary } from "./vi"

export type Language = "vi" | "en"

const dictionaries: Record<Language, Dictionary> = { vi, en }

type Vars = Record<string, string | number>
type DictEntry = string | ((vars: Vars) => string) | { [key: string]: DictEntry }

const STORAGE_KEY = "st4i-sim-language"

function readStoredLanguage(): Language | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw === "vi" || raw === "en" ? raw : null
  } catch {
    return null
  }
}

function resolve(dict: Dictionary, path: string): DictEntry | undefined {
  const parts = path.split(".")
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let node: any = dict
  for (const part of parts) {
    if (node == null || typeof node !== "object") return undefined
    node = node[part]
  }
  return node as DictEntry | undefined
}

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match))
}

export interface LanguageContextValue {
  language: Language
  setLanguage: (language: Language) => void
  /** Resolves a dot-path key (`"dashboard.kpi.machinesOnline"`) against the active dictionary,
   * falling back to Vietnamese and then the raw key itself if a key is ever missing (dev-mode warns
   * so a typo shows up immediately instead of silently rendering a blank or a raw `t()` key). */
  t: (key: string, vars?: Vars) => string
}

const LanguageContext = React.createContext<LanguageContextValue | null>(null)

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = React.useState<Language>(() => readStoredLanguage() ?? "vi")

  const setLanguage = React.useCallback((next: Language) => {
    setLanguageState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Storage disabled — in-memory only for this session.
    }
  }, [])

  React.useEffect(() => {
    document.documentElement.lang = language
  }, [language])

  const t = React.useCallback(
    (key: string, vars?: Vars): string => {
      const entry = resolve(dictionaries[language], key) ?? resolve(dictionaries.vi, key)
      if (entry === undefined) {
        if (import.meta.env.DEV) console.warn(`[i18n] missing key: "${key}"`)
        return key
      }
      if (typeof entry === "function") return entry(vars ?? {})
      if (typeof entry === "string") return interpolate(entry, vars)
      if (import.meta.env.DEV) console.warn(`[i18n] key "${key}" resolved to a namespace, not a string`)
      return key
    },
    [language]
  )

  const value = React.useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t])
  // Plain .ts file (not .tsx, matching lib/api.ts's FleetRuntimeProvider convention) — React.createElement
  // instead of JSX syntax.
  return React.createElement(LanguageContext.Provider, { value }, children)
}

function useLanguageContext(): LanguageContextValue {
  const ctx = React.useContext(LanguageContext)
  if (!ctx) throw new Error("useLanguage/useT must be used within <LanguageProvider>")
  return ctx
}

export function useLanguage(): Pick<LanguageContextValue, "language" | "setLanguage"> {
  const { language, setLanguage } = useLanguageContext()
  return { language, setLanguage }
}

export function useT(): LanguageContextValue["t"] {
  return useLanguageContext().t
}
