import * as React from "react"

import { useGloss } from "@/components/hmi/bilingual"
import { useT } from "@/i18n"
import { cn } from "@/lib/utils"

export type HmiTabId = "operation" | "settings"

interface TabRailProps {
  active: HmiTabId
  onChange: (id: HmiTabId) => void
  className?: string
}

interface TabEntry {
  id: HmiTabId
  labelKey: string
}

const TABS: TabEntry[] = [
  { id: "operation", labelKey: "hmi.tabs.operation" },
  { id: "settings", labelKey: "hmi.tabs.settings" },
]

/**
 * H6/Task 4 — the tab rail HMI_DESIGN_SPEC.md §8.1 has always reserved a row for, directly under the
 * nameplate, but never built ("spec intentionally leaves this row empty today rather than shipping a
 * one-tab rail that looks broken"). Two tabs now exist (VẬN HÀNH/OPERATION · CÀI ĐẶT/SETTINGS), so
 * this fills that row.
 *
 * A hand-rolled WAI-ARIA APG "tabs" widget (manual `role="tablist"`/`role="tab"` + roving `tabIndex`),
 * not `components/ui/tabs.tsx` (that primitive is styled for the app shell's own rounded/soft chrome —
 * `MachineDetail.tsx`'s tab strip — not the blueprint-industrial register this kiosk panel uses
 * everywhere else). Automatic activation: arrow-key focus movement selects immediately (Home/End jump
 * to the first/last tab) — the same "reach for it without looking" affordance the physical controls
 * use, appropriate for a two-tab rail an operator switches constantly.
 *
 * Deliberately renders OUTSIDE any `.hmi-scroll` region and touches no existing one — `Hmi.tsx` keeps
 * the physical control column mounted unconditionally regardless of which tab is active (spec's own
 * position-stability rule: HALT never moves/disappears, "even on the CÀI ĐẶT tab" — a reliability
 * requirement, not a safety-circuit one; HALT is a software latch, not a safety device), so this rail
 * only ever swaps the CONTENT to its left, never removes or reorders the control rail itself.
 */
export function TabRail({ active, onChange, className }: TabRailProps) {
  const t = useT()
  const gloss = useGloss()
  const refs = React.useRef<Array<HTMLButtonElement | null>>([])

  function focusAndSelect(index: number) {
    const next = TABS[index]
    if (!next) return
    onChange(next.id)
    // Move DOM focus to the newly-active tab so the roving `tabIndex` and the visible focus ring
    // both land on the same element the arrow key just navigated to.
    requestAnimationFrame(() => refs.current[index]?.focus())
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault()
        focusAndSelect((index + 1) % TABS.length)
        return
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault()
        focusAndSelect((index - 1 + TABS.length) % TABS.length)
        return
      case "Home":
        event.preventDefault()
        focusAndSelect(0)
        return
      case "End":
        event.preventDefault()
        focusAndSelect(TABS.length - 1)
        return
      default:
        return
    }
  }

  return (
    <div
      role="tablist"
      aria-label={t("hmi.tabs.railAria")}
      className={cn("flex h-8 shrink-0 items-stretch gap-1 border-b border-border bg-surface-card px-3", className)}
    >
      {TABS.map((tab, index) => {
        const selected = tab.id === active
        return (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[index] = el
            }}
            type="button"
            role="tab"
            id={`hmi-tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`hmi-tabpanel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => focusAndSelect(index)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              "relative flex items-center gap-1.5 border-x border-t border-transparent px-3 text-xs font-semibold tracking-wide uppercase outline-none transition-colors",
              "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus)]",
              selected
                ? "border-border-strong bg-surface-subtle text-text-strong after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-[var(--color-accent)]"
                : "text-text-muted hover:text-text-body"
            )}
          >
            <span className="font-heading">{t(tab.labelKey)}</span>
            <span className="hmi-micro" aria-hidden="true">
              {gloss(tab.labelKey)}
            </span>
          </button>
        )
      })}
    </div>
  )
}
