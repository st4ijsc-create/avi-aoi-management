import * as React from "react"

import { useLanguage } from "@/i18n"
import { cn } from "@/lib/utils"

export interface MicroLabelProps extends Omit<React.ComponentProps<"span">, "children"> {
  /** Vietnamese text. */
  vi: React.ReactNode
  /** English text. */
  en: React.ReactNode
  /** Render as a block (own line) instead of inline — the gloss stacks beneath the primary label
   * instead of sitting beside it. Defaults to inline. */
  stacked?: boolean
}

/**
 * The bilingual micro-label workhorse (spec §3/§5): primary text in the ACTIVE UI language, plus a
 * small uppercase gloss in the OTHER language. This is the industrial register the whole design
 * system leans on for field captions, unit labels, panel subtitles — never decorative, always a
 * real secondary-language VISUAL register.
 *
 * The gloss is `aria-hidden` — it is a typographic register (spec §1: "a small UPPERCASE gloss …
 * This is the industrial register, not decoration"), not a second accessible name. When this span
 * sits inside a `<label>`, a `role="columnheader"`, or anything else whose accessible name is
 * computed from its text content, an un-hidden gloss concatenates into that name (e.g. a "Khóa mk_"
 * field's name becoming "Khóa mk_ mk_ key"), which both doubles what a screen reader announces for
 * every single field and can make two visually-distinct controls collide under the same computed
 * name. Hiding it keeps the accessible name equal to the primary-language label only, in every
 * context this primitive is used (labels, table headers, plain captions alike).
 */
export function MicroLabel({ vi, en, stacked, className, ...props }: MicroLabelProps) {
  const { language } = useLanguage()
  const primary = language === "vi" ? vi : en
  const gloss = language === "vi" ? en : vi

  return (
    <span
      className={cn("inline-flex min-w-0 items-baseline gap-1.5", stacked && "flex-col items-start gap-0", className)}
      {...props}
    >
      <span className="truncate text-[13px] leading-tight font-medium text-text-body">{primary}</span>
      <span className="hmi-micro truncate" aria-hidden="true">
        {gloss}
      </span>
    </span>
  )
}
