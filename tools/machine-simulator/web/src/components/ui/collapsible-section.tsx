import * as React from "react"
import { ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"

interface CollapsibleSectionProps {
  title: string
  icon?: React.ComponentType<{ className?: string }>
  /** Whether the section starts expanded. Only read on mount — callers that want a section to
   * "auto-open because this record already has data in it" compute the boolean once from the loaded
   * record (see `PointForm.tsx`'s `hasThreeD`/image/lighting checks) and rely on the parent remounting
   * this component (via `key`) when the record changes, same pattern as the form itself. */
  defaultOpen?: boolean
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
  icon: Icon,
  defaultOpen = false,
  badge,
  children,
  className,
}: CollapsibleSectionProps) {
  const [open, setOpen] = React.useState(defaultOpen)
  const panelId = React.useId()

  return (
    <div className={cn("overflow-hidden rounded-lg border border-border", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm font-semibold text-text-strong outline-none transition-colors hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-600"
      >
        <span className="flex min-w-0 items-center gap-2">
          {Icon ? <Icon className="size-4 shrink-0 text-navy-600" aria-hidden="true" /> : null}
          <span className="truncate">{title}</span>
          {badge}
        </span>
        <ChevronDown
          className={cn("size-4 shrink-0 text-text-muted transition-transform duration-150", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div id={panelId} role="region" aria-label={title} className="flex flex-col gap-4 border-t border-border px-3 py-3.5">
          {children}
        </div>
      ) : null}
    </div>
  )
}
