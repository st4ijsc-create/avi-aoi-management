import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Status chip: dot + label, built on the same token set as `Badge` but
 * carrying real semantic status color. Always routes text through the
 * `-text` token variant (not the solid `ok`/`warn`/etc. hue) to hold AA
 * 4.5:1 on its tint background — see `src/index.css` for why.
 *
 * `neutral` intentionally renders with body-text color, not a colored
 * label — it's an idle/disabled indicator, never conveyed by color alone.
 */
const statusBadgeVariants = cva(
  "inline-flex h-5 w-fit shrink-0 items-center gap-1.5 rounded-full border px-2 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      status: {
        ok: "border-ok/20 bg-ok/10 text-ok-text",
        warn: "border-warn/20 bg-warn/10 text-warn-text",
        danger: "border-danger/20 bg-danger/10 text-danger-text",
        info: "border-info/20 bg-info/10 text-info-text",
        neutral: "border-border bg-surface-muted text-text-body",
      },
    },
    defaultVariants: {
      status: "neutral",
    },
  }
)

const dotVariants = cva("size-1.5 shrink-0 rounded-full", {
  variants: {
    status: {
      ok: "bg-ok",
      warn: "bg-warn",
      danger: "bg-danger",
      info: "bg-info",
      neutral: "bg-neutral",
    },
  },
  defaultVariants: {
    status: "neutral",
  },
})

function StatusBadge({
  className,
  status,
  children,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof statusBadgeVariants>) {
  return (
    <span
      data-slot="status-badge"
      className={cn(statusBadgeVariants({ status }), className)}
      {...props}
    >
      <span aria-hidden="true" className={cn(dotVariants({ status }))} />
      {children}
    </span>
  )
}

export { StatusBadge, statusBadgeVariants }
