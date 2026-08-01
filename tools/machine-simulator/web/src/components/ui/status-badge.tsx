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
  "inline-flex h-5 w-fit shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] border px-2 text-[11px] font-semibold tracking-wide uppercase whitespace-nowrap",
  {
    variants: {
      status: {
        ok: "border-ok/30 bg-ok/10 text-ok-text",
        warn: "border-warn/30 bg-warn/10 text-warn-text",
        danger: "border-danger/30 bg-danger/10 text-danger-text",
        info: "border-info/30 bg-info/10 text-info-text",
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
  pulse,
  children,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof statusBadgeVariants> & { pulse?: boolean }) {
  return (
    <span
      data-slot="status-badge"
      className={cn(statusBadgeVariants({ status }), className)}
      {...props}
    >
      {/* `pulse` animates only this decorative dot (`aria-hidden`), never the badge/text — putting
          `animate-pulse` on the whole badge (an earlier version of MachineCard did, via `className`)
          cycles the TEXT through Tailwind's default 1 → 0.5 opacity keyframe too, which axe caught
          dipping a `text-ok-text`-on-`bg-ok/10` badge to ~3.28:1 (mid-pulse) against its required
          4.5:1 (Task 10 — MachineCard's active-OK status badge). A pulsing status dot next to
          stable, always-readable text is also the more common "this is live" affordance anyway. */}
      {/* WS1-T2 — `hmi-glow-run` (Console-only, `--glow-run: none` elsewhere) reserved to the one
          combination that's genuinely "this is live right now": an OK status actively pulsing. A
          static "ok" badge (a completed job's final verdict, say) never glows — only the pulsing
          ones, matching every other live-only `--glow-run` call site in this pass. */}
      <span aria-hidden="true" className={cn(dotVariants({ status }), pulse && "animate-pulse", pulse && status === "ok" && "hmi-glow-run")} />
      {children}
    </span>
  )
}

export { StatusBadge, statusBadgeVariants }
