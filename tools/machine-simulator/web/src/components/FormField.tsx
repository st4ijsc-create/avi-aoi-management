import * as React from "react"

import { cn } from "@/lib/utils"

interface FormFieldProps {
  label: string
  /** Uppercase EN gloss, stacked beneath `label` (spec §3 bilingual micro-label). Optional and
   * additive — every other consumer of this shared field wrapper (ProductConfig/RecipeConfig/…)
   * passes only `label` and keeps its existing single-language behavior unchanged. */
  labelEn?: string
  htmlFor?: string
  hint?: string
  className?: string
  children: React.ReactNode
}

/** Label-above-control wrapper shared by Onboarding/Settings' plain forms — Input doesn't come with
 * its own label association, so every field in both screens goes through this instead of hand-rolling
 * the same `<label>` + hint markup at each call site.
 *
 * `<label>` wraps ONLY the primary-language `label` text — `labelEn` renders as a sibling `<span>`
 * (`aria-hidden`, spec §1's visual gloss register, not a second accessible name), not a `<label>`
 * descendant. Both matter: an un-hidden gloss concatenates into the accessible name computed for the
 * associated control (e.g. "Khóa mk_" + "MK_ KEY" → "Khóa mk_ mk_ key", H3c collision that made two
 * differently-labelled fields resolve to the same `page.getByLabel(...)` match); keeping it OUT of the
 * `<label>` element's own DOM subtree (not just `aria-hidden` inside it) additionally matters because
 * Playwright's `getByLabel` resolves an associated `<label>` by its raw DOM text, not the ARIA
 * accessible-name algorithm — `aria-hidden` alone still left the gloss counted for that lookup. */
export function FormField({ label, labelEn, htmlFor, hint, className, children }: FormFieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <span className="flex flex-col gap-0.5">
        <label htmlFor={htmlFor} className="text-xs font-medium text-text-body">
          {label}
        </label>
        {labelEn ? (
          <span className="hmi-micro" aria-hidden="true">
            {labelEn}
          </span>
        ) : null}
      </span>
      {children}
      {hint ? <span className="text-[11px] text-text-muted">{hint}</span> : null}
    </div>
  )
}
