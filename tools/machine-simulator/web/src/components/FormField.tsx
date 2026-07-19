import * as React from "react"

import { cn } from "@/lib/utils"

interface FormFieldProps {
  label: string
  htmlFor?: string
  hint?: string
  className?: string
  children: React.ReactNode
}

/** Label-above-control wrapper shared by Onboarding/Settings' plain forms — Input doesn't come with
 * its own label association, so every field in both screens goes through this instead of hand-rolling
 * the same `<label>` + hint markup at each call site. */
export function FormField({ label, htmlFor, hint, className, children }: FormFieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-text-body">
        {label}
      </label>
      {children}
      {hint ? <span className="text-[11px] text-text-muted">{hint}</span> : null}
    </div>
  )
}
