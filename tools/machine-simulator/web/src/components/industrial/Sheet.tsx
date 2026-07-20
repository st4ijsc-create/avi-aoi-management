import * as React from "react"

import { cn } from "@/lib/utils"

export interface SheetProps extends Omit<React.ComponentProps<"div">, "title"> {
  /** Panel title in the active UI language, rendered in the header row (Barlow Condensed). */
  title?: React.ReactNode
  /** Uppercase gloss in the inactive language, shown beside `title` — same idiom as `<MicroLabel>`
   * but inlined here since a sheet header is a very common place to want it without a second
   * component. Ignored if `title` isn't set. */
  titleEn?: React.ReactNode
  /** Extra content in the header row's trailing slot (a status lamp, a version chip, …). */
  headerRight?: React.ReactNode
  /** Applies `hmi-graph-paper` to the panel body — for schematic/canvas panels (spec §7). */
  graphPaper?: boolean
  bodyClassName?: string
}

/**
 * Blueprint panel — hairline frame + four overhanging registration corners (spec §4). This is the
 * signature element of the whole design system: every other primitive and every restyled screen
 * frames itself in a `<Sheet>` rather than a plain bordered `<div>`.
 *
 * The four corner marks are rendered here and ONLY here — call sites never hand-write `.corner`
 * spans. Because the marks sit 6px outside the box (`top:-6px` etc.), **a `<Sheet>` must never be
 * placed inside an ancestor with `overflow: hidden`** — the corners will be clipped. Give the
 * *parent* of a `<Sheet>` grid/margin breathing room instead of putting `overflow-hidden` directly
 * on it; if a panel needs internal scrolling, put `overflow` + `hmi-scroll` on an inner wrapper
 * beneath the `<Sheet>`'s own padding, not on the `.sheet` element itself.
 */
export function Sheet({
  title,
  titleEn,
  headerRight,
  graphPaper,
  className,
  bodyClassName,
  children,
  ...props
}: SheetProps) {
  return (
    <div className={cn("sheet flex flex-col bg-surface-card", className)} {...props}>
      <span className="corner tl" aria-hidden="true" />
      <span className="corner tr" aria-hidden="true" />
      <span className="corner bl" aria-hidden="true" />
      <span className="corner br" aria-hidden="true" />
      {title !== undefined ? (
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          <div className="flex min-w-0 items-baseline gap-2">
            <h3 className="truncate font-heading text-[15px] leading-none font-semibold tracking-tight text-text-strong">
              {title}
            </h3>
            {titleEn ? (
              <span className="hmi-micro shrink-0 whitespace-nowrap">{titleEn}</span>
            ) : null}
          </div>
          {headerRight ? <div className="flex shrink-0 items-center gap-2">{headerRight}</div> : null}
        </div>
      ) : null}
      <div className={cn("p-4", graphPaper && "hmi-graph-paper", bodyClassName)}>{children}</div>
    </div>
  )
}
