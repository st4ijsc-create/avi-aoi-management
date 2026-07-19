import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

export interface Step {
  id: string
  label: string
}

interface StepIndicatorProps {
  steps: Step[]
  /** Index of the step currently active/being worked on. Every index below this is "done"; every index
   * above is "upcoming". */
  currentIndex: number
  className?: string
}

/** Numbered step indicator for the Onboarding wizard — order carries real information here (register
 * must happen before poll, poll before claim/enroll), so numbering the steps is earning its keep rather
 * than decorating. Horizontal, connected by a rule that fills in as steps complete. */
export function StepIndicator({ steps, currentIndex, className }: StepIndicatorProps) {
  return (
    <ol className={cn("flex w-full items-start", className)} aria-label="Onboarding progress">
      {steps.map((step, i) => {
        const done = i < currentIndex
        const active = i === currentIndex
        const isLast = i === steps.length - 1
        return (
          <li key={step.id} className={cn("flex items-center", !isLast && "flex-1")}>
            <div className="flex flex-col items-center gap-1.5">
              <div
                aria-current={active ? "step" : undefined}
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors",
                  done && "border-navy-600 bg-navy-600 text-white",
                  // `bg-surface-card`/`text-primary-text`/`ring-navy-600/20` (not `bg-white`/
                  // `text-navy-600`/`ring-navy-100`) — those three have no dark override, so the
                  // "active" step circle stayed a literal white disc with dark-navy text/ring in dark
                  // mode instead of adapting (same class of bug as PresetCard/ModeSelector).
                  active && "border-navy-600 bg-surface-card text-primary-text ring-4 ring-navy-600/20",
                  !done && !active && "border-border bg-surface-subtle text-text-muted"
                )}
              >
                {done ? <Check className="size-3.5" aria-hidden="true" /> : i + 1}
              </div>
              <span
                className={cn(
                  "w-20 text-center text-[11px] font-medium",
                  active ? "text-primary-text" : done ? "text-text-body" : "text-text-muted"
                )}
              >
                {step.label}
              </span>
            </div>
            {!isLast ? (
              <div
                aria-hidden="true"
                className={cn("mx-1 h-px flex-1 -translate-y-3", done ? "bg-navy-600" : "bg-border")}
              />
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}
