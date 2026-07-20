import * as React from "react"
import { Palette, Search, Wrench } from "lucide-react"
import { useLocation } from "wouter"

import { useT } from "@/i18n"
import { cn } from "@/lib/utils"
import { Dialog, DialogContent, DialogPortal, DialogOverlay } from "@/components/ui/dialog"
import { NAV_ITEMS, type NavItem } from "@/shell/Sidebar"

// `/recipes` (Task C6) is reachable here and via `ConfigModeToggle` (rendered in both
// `ProductConfig.tsx`'s and `RecipeConfig.tsx`'s own headers) rather than as a `Sidebar.tsx`
// `NAV_ITEMS` entry — same "real route, kept off the sidebar rail" treatment `/tokens` already gets
// below, so this doesn't grow the sidebar for a second config-authoring domain living in the same
// workspace as Product Config.
const EXTRA_ITEMS: NavItem[] = [
  { labelKey: "shell.commandPalette.designTokens", path: "/tokens", icon: Palette },
  { labelKey: "shell.commandPalette.recipeConfig", path: "/recipes", icon: Wrench },
]

const ALL_ITEMS: NavItem[] = [...NAV_ITEMS, ...EXTRA_ITEMS]

const LISTBOX_ID = "command-palette-listbox"

function optionId(path: string): string {
  return `command-palette-option${path === "/" ? "-root" : path.replace(/\//g, "-")}`
}

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const t = useT()
  const [, navigate] = useLocation()
  const [query, setQuery] = React.useState("")
  const [activeIndex, setActiveIndex] = React.useState(0)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const results = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length === 0) return ALL_ITEMS
    return ALL_ITEMS.filter((item) => t(item.labelKey).toLowerCase().includes(q))
    // `t` changes identity with the active language, so this recomputes on a language switch too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, t])

  // Reset transient state every time the palette opens, and land focus in the search box.
  React.useEffect(() => {
    if (!open) return
    setQuery("")
    setActiveIndex(0)
    const id = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [open])

  React.useEffect(() => {
    setActiveIndex(0)
  }, [query])

  const go = React.useCallback(
    (path: string) => {
      navigate(path)
      onOpenChange(false)
    },
    [navigate, onOpenChange]
  )

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, results.length - 1))
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (event.key === "Enter") {
      event.preventDefault()
      const target = results[activeIndex]
      if (target) go(target.path)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogContent
          showCloseButton={false}
          className="top-[18%] max-w-md translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-md"
          aria-label={t("shell.commandPalette.dialogAria")}
        >
          <div className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
            <Search className="size-4 shrink-0 text-text-muted" aria-hidden="true" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("shell.commandPalette.searchPlaceholder")}
              aria-label={t("shell.commandPalette.searchAria")}
              role="combobox"
              aria-expanded="true"
              aria-controls={LISTBOX_ID}
              aria-autocomplete="list"
              aria-activedescendant={results[activeIndex] ? optionId(results[activeIndex].path) : undefined}
              className="h-6 w-full bg-transparent text-sm text-text-strong outline-none placeholder:text-text-muted"
            />
            <kbd className="rounded border border-border bg-surface-subtle px-1.5 py-0.5 text-[10px] text-text-muted">
              Esc
            </kbd>
          </div>

          {/* Options are plain <li role="option"> (not nested <button>s) — keyboard users never move
              real DOM focus off the input; the highlighted option is announced via
              aria-activedescendant instead, the standard "listbox popup" combobox pattern. A nested
              <button> inside role="option" is two interactive elements in one (axe: nested-interactive). */}
          <ul id={LISTBOX_ID} role="listbox" aria-label={t("shell.commandPalette.listboxAria")} className="max-h-72 overflow-y-auto p-1.5">
            {results.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-text-muted">
                {t("shell.commandPalette.noResults", { query })}
              </li>
            ) : (
              results.map((item, index) => {
                const Icon = item.icon
                const active = index === activeIndex
                return (
                  <li
                    key={item.path}
                    id={optionId(item.path)}
                    role="option"
                    aria-selected={active}
                    onClick={() => go(item.path)}
                    onMouseEnter={() => setActiveIndex(index)}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                      active ? "bg-navy-600 text-white" : "text-text-body hover:bg-surface-subtle"
                    )}
                  >
                    <Icon className={cn("size-4 shrink-0", active ? "text-white" : "text-navy-500")} aria-hidden="true" />
                    {t(item.labelKey)}
                  </li>
                )
              })
            )}
          </ul>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  )
}
