import * as React from "react"
import { Select as SelectPrimitive } from "@base-ui/react/select"
import { Flame, Sparkles, SquareTerminal } from "lucide-react"

import { useGloss } from "@/components/hmi/bilingual"
import { SelectItem, SelectPopup, SelectPortal, SelectPositioner } from "@/components/ui/select"
import { useT } from "@/i18n"
import { cn } from "@/lib/utils"
import { THEMES, useTheme, type Theme } from "@/theme/ThemeToggle"

const THEME_ICON: Record<Theme, React.ComponentType<{ className?: string }>> = {
  glass: Sparkles,
  console: SquareTerminal,
  warmth: Flame,
}

/** Bilingual copy for one theme — `name` is a proper noun (identical in both dictionaries, like
 * "ST4I" itself), `description` is the active-language short register, `descriptionGloss` the
 * other-language uppercase micro-gloss (spec §3 bilingual idiom). Shared by both pickers below. */
function useThemeCopy(): (id: Theme) => { name: string; description: string; descriptionGloss: string } {
  const t = useT()
  const gloss = useGloss()
  return React.useCallback(
    (id: Theme) => ({
      name: t(`theme.${id}.name`),
      description: t(`theme.${id}.description`),
      descriptionGloss: gloss(`theme.${id}.description`),
    }),
    [t, gloss]
  )
}

/**
 * A miniature, GENUINELY token-driven preview of `theme` — not a hand-maintained duplicate
 * palette. Stamping `data-theme` on this nested `<div>` scopes every custom property inside it to
 * that theme's real values (index.css's theme blocks are plain `[data-theme="…"]` attribute
 * selectors for exactly this reason — see that file's top doc comment), so this swatch shows
 * accent/status colors and the theme's own radius exactly as they'll actually render, even while
 * a DIFFERENT theme is active for the rest of the page. Purely decorative (`aria-hidden`) — the
 * radio button around it already carries the real name/state.
 */
function ThemePreviewSwatch({ theme }: { theme: Theme }) {
  return (
    <div
      data-theme={theme}
      aria-hidden="true"
      className="flex h-14 w-full shrink-0 items-stretch gap-1.5 border p-1.5"
      style={{ background: "var(--color-bg)", borderColor: "var(--border)", borderRadius: "var(--radius)" }}
    >
      <div
        className="flex flex-1 flex-col justify-between border p-1.5"
        style={{ background: "var(--color-surface)", borderColor: "var(--border)", borderRadius: "calc(var(--radius) * 0.6)" }}
      >
        <span className="block h-1.5 w-7" style={{ background: "var(--color-accent)", borderRadius: "var(--radius-pill)" }} />
        <span className="flex items-center gap-1">
          <span className="block size-1.5 rounded-full" style={{ background: "var(--status-run)" }} />
          <span className="block size-1.5 rounded-full" style={{ background: "var(--status-warn)" }} />
          <span className="block size-1.5 rounded-full" style={{ background: "var(--status-fault)" }} />
        </span>
      </div>
    </div>
  )
}

/**
 * Topbar quick-switch — replaces the old 2-state icon toggle (`ThemeToggle`, pre-WS1). A real
 * `Select` menu (base-ui, same primitive Settings' own language picker already uses — arrow
 * keys/type-ahead/Esc all free) instead of a bare cycle button: 3 states don't fit a single
 * icon-flip idiom the way light/dark did, and a menu lets an operator SEE all 3 options instead of
 * clicking through them blind. Built directly on `SelectPrimitive` (not the shared
 * `ui/select.tsx` `<SelectTrigger>`) so the trigger can stay the same icon-only footprint the old
 * toggle button had, with no trailing chevron glyph competing for that small a target.
 */
export function ThemeQuickSwitch() {
  const { theme, setTheme } = useTheme()
  const t = useT()
  const copy = useThemeCopy()
  const Icon = THEME_ICON[theme]

  return (
    <SelectPrimitive.Root value={theme} onValueChange={(value) => value && setTheme(value)}>
      <SelectPrimitive.Trigger
        aria-label={t("theme.pickerAriaLabel", { current: copy(theme).name })}
        className="flex size-8 shrink-0 items-center justify-center border border-border-strong bg-transparent text-text-muted transition-colors outline-none hover:bg-surface-muted hover:text-text-strong focus-visible:border-[var(--focus)] focus-visible:ring-2 focus-visible:ring-[var(--focus)]/40 data-popup-open:border-[var(--focus)]"
      >
        <Icon className="size-3.5" aria-hidden="true" />
      </SelectPrimitive.Trigger>
      <SelectPortal>
        <SelectPositioner>
          <SelectPopup className="min-w-52">
            {THEMES.map((id) => {
              const c = copy(id)
              const ItemIcon = THEME_ICON[id]
              return (
                <SelectItem key={id} value={id}>
                  <ItemIcon className="size-3.5 shrink-0 text-text-muted" aria-hidden="true" />
                  <span className="flex flex-col gap-0.5 py-0.5">
                    <span className="font-medium">{c.name}</span>
                    <span className="hmi-micro" aria-hidden="true">
                      {c.descriptionGloss}
                    </span>
                  </span>
                </SelectItem>
              )
            })}
          </SelectPopup>
        </SelectPositioner>
      </SelectPortal>
    </SelectPrimitive.Root>
  )
}

/**
 * Settings screen's theme picker — a real `role="radiogroup"` of plain buttons (same idiom
 * `Settings.tsx`'s own `ModeSelector` already established: a `<button role="radio">`, not a
 * `<label>`-wrapped input, so the bilingual description/gloss stacked inside it never risks
 * concatenating into the control's accessible name the way an un-hidden gloss INSIDE a real
 * `<label>` would — see `FormField`'s doc comment for the concrete collision this pattern avoids).
 * Each option shows a live `ThemePreviewSwatch` above its name — applies instantly via `setTheme`,
 * no Save button (matches `ModeSelector`'s "applies immediately" contract for the same reason: a
 * theme choice isn't a form field to submit, it's a live UI state).
 */
export function ThemeRadioGroup() {
  const { theme, setTheme } = useTheme()
  const t = useT()
  const copy = useThemeCopy()

  return (
    <div role="radiogroup" aria-label={t("settings.theme.radioGroupAria")} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {THEMES.map((id) => {
        const selected = theme === id
        const c = copy(id)
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setTheme(id)}
            className={cn(
              "flex flex-col items-stretch gap-2.5 border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]/50",
              selected ? "border-[var(--color-accent)] bg-surface-muted" : "border-border-strong hover:bg-surface-subtle"
            )}
          >
            <ThemePreviewSwatch theme={id} />
            <span className="flex flex-col gap-0.5">
              <span
                className={cn(
                  "font-heading text-sm font-semibold tracking-wide uppercase",
                  selected ? "text-primary-text" : "text-text-strong"
                )}
              >
                {c.name}
              </span>
              <span className="text-[11px] text-text-muted">{c.description}</span>
              <span className="hmi-micro" aria-hidden="true">
                {c.descriptionGloss}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
