import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

export interface Step {
  id: string
  label: string
  /** Uppercase EN gloss under `label` (spec §3) — reads like a procedure sheet's stage caption. */
  labelEn?: string
}

interface StepIndicatorProps {
  steps: Step[]
  /** Index of the step currently active/being worked on. Every index below this is "done"; every index
   * above is "upcoming". */
  currentIndex: number
  /** M-5 (branch-review) — was hardcoded English (`"Onboarding progress"`), breaking vi/en parity.
   * The caller now passes a translated string (this component takes no `useT()` dependency of its
   * own, matching every other primitive in this file that's driven purely by props). */
  ariaLabel: string
  className?: string
}

/** Numbered step indicator for the Onboarding wizard — order carries real information here (register
 * must happen before poll, poll before claim/enroll), so numbering the steps is earning its keep rather
 * than decorating. Horizontal, connected by a rule that fills in as steps complete. Square hairline
 * chips (ground rule §1 — no `rounded-full`, unlike the earlier card-UI stepper this replaces), a
 * technical-drawing numbered sequence rather than a progress-bar wizard. */
export function StepIndicator({ steps, currentIndex, ariaLabel, className }: StepIndicatorProps) {
  return (
    <ol className={cn("flex w-full items-start", className)} aria-label={ariaLabel}>
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
                  "font-heading flex size-7 shrink-0 items-center justify-center border text-xs font-semibold tabular-nums transition-colors",
                  done && "border-navy-600 bg-navy-600 text-white",
                  // `bg-surface-card`/`text-primary-text`/`ring-navy-600/20` (not `bg-white`/
                  // `text-navy-600`/`ring-navy-100`) — those three have no dark override, so the
                  // "active" step circle stayed a literal white disc with dark-navy text/ring in dark
                  // mode instead of adapting (same class of bug as PresetCard/ModeSelector).
                  active && "border-navy-600 bg-surface-card text-primary-text ring-2 ring-navy-600/25",
                  !done && !active && "border-border bg-surface-subtle text-text-muted"
                )}
              >
                {done ? <Check className="size-3.5" aria-hidden="true" /> : i + 1}
              </div>
              <span className="flex w-24 flex-col items-center gap-0">
                <span
                  className={cn(
                    "text-center text-[11px] font-medium",
                    active ? "text-primary-text" : done ? "text-text-body" : "text-text-muted"
                  )}
                >
                  {step.label}
                </span>
                {step.labelEn ? <span className="hmi-micro text-center">{step.labelEn}</span> : null}
              </span>
            </div>
            {!isLast ? (
              <div
                aria-hidden="true"
                className={cn("mx-1 h-px flex-1 -translate-y-4.5", done ? "bg-navy-600" : "bg-border")}
              />
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}
