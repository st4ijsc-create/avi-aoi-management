import * as React from "react"
import { ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"

interface CollapsibleSectionProps {
  title: string
  /** Uppercase gloss in the inactive language, stacked beneath `title` (spec §3 bilingual
   * micro-label) — same idiom `<Sheet titleEn>` uses for its own header. Optional; a section title
   * still renders fine without it. */
  titleEn?: string
  icon?: React.ComponentType<{ className?: string }>
  /** Whether the section starts expanded. Only read on mount — callers that want a section to
   * "auto-open because this record already has data in it" compute the boolean once from the loaded
   * record (see `PointForm.tsx`'s `hasThreeD`/image/lighting checks) and rely on the parent remounting
   * this component (via `key`) when the record changes, same pattern as the form itself. */
  defaultOpen?: boolean
  /** SM-3 (.superpowers/sdd/2026-07-29-dotA-single-machine-sellable-blueprint/task-3-brief.md) —
   * optional, additive escape hatch for a LONG-LIVED instance (no `key` remount) whose "worth surfacing
   * without a click" condition can become true well AFTER mount, where `defaultOpen` alone can't help
   * (it's only read once). Forces the section open the instant this flips to `true` — including every
   * transition INTO `true`, not just the first — but never forces it closed: an operator's own manual
   * collapse afterward (while this is still `true`) is respected, same as `defaultOpen`'s own
   * "an operator's manual toggle always wins from then on" contract. Omitted (default `undefined`,
   * every pre-existing caller) never fires the effect below — byte-identical to before this prop
   * existed. See `EcosystemStatusWidget` (`EcosystemConnect.tsx`) for the motivating caller: a
   * connection that starts failing well after this widget first mounted must still surface without
   * requiring the operator to have already had it open. */
  forceOpenWhen?: boolean
  badge?: React.ReactNode
  children: React.ReactNode
  className?: string
}

/**
 * Generic disclosure section — Task C5's point-detail form has ~6 field groups (basic/limits/
 * position/3D-solder-xray/image/lighting) that would be an overwhelming wall of inputs rendered
 * flat, so the FULL-depth spec (docs/plans/2026-07-20-config-sync.md's Global Constraints) stays
 * manageable by grouping into named, collapsible regions instead. A plain button+conditional-render
 * pair (not an animated height transition) — content mounts/unmounts on toggle, which sidesteps
 * framer-motion's "animate to auto height" measurement dance entirely and is trivially correct for
 * `prefers-reduced-motion` (there's no motion to reduce). `aria-expanded` + `aria-controls` +
 * `role="region"` is the standard accessible disclosure pattern (axe AA).
 */
export function CollapsibleSection({
  title,
  titleEn,
  icon: Icon,
  defaultOpen = false,
  forceOpenWhen,
  badge,
  children,
  className,
}: CollapsibleSectionProps) {
  const [open, setOpen] = React.useState(defaultOpen)
  const panelId = React.useId()

  // SM-3 — see forceOpenWhen's own doc comment above. Deliberately keyed on the VALUE (not e.g. a
  // one-shot ref) so every fresh transition into `true` re-forces it open, not just the first.
  React.useEffect(() => {
    if (forceOpenWhen) setOpen(true)
  }, [forceOpenWhen])

  return (
    <div className={cn("overflow-hidden rounded-[var(--radius-card)] border border-border-strong shadow-[var(--elevation)]", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left outline-none transition-colors hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]"
      >
        <span className="flex min-w-0 items-baseline gap-2">
          {Icon ? <Icon className="size-4 shrink-0 self-center text-primary-text" aria-hidden="true" /> : null}
          <span className="flex min-w-0 flex-col gap-0">
            <span className="truncate text-sm font-semibold text-text-strong">{title}</span>
            {titleEn ? (
              <span className="hmi-micro truncate" aria-hidden="true">
                {titleEn}
              </span>
            ) : null}
          </span>
          {badge}
        </span>
        <ChevronDown
          className={cn("size-4 shrink-0 self-center text-text-muted transition-transform duration-150", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div id={panelId} role="region" aria-label={title} className="flex flex-col gap-4 border-t border-border-strong px-3 py-3.5">
          {children}
        </div>
      ) : null}
    </div>
  )
}
