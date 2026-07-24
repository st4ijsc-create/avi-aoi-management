import { Boxes, Wrench } from "lucide-react"
import { Link } from "wouter"

import { useT } from "@/i18n"
import { cn } from "@/lib/utils"

export type ConfigWorkspaceMode = "products" | "recipes"

interface ConfigModeToggleProps {
  current: ConfigWorkspaceMode
  className?: string
}

const SEGMENT_CLASS =
  "flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-transparent px-2.5 py-1.5 text-[11px] font-semibold tracking-wide uppercase transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]/50"

/**
 * Task C6 — segmented switch between the two config-sync authoring domains sharing this workspace:
 * System B (AOI/AVI product points, `/products`, Task C4/C5) and System A (automation/IoT recipes,
 * `/recipes`, Task C6). Real navigation between two routes (not a same-page tab panel) — styled as a
 * compact pill rather than `Sidebar.tsx`'s own nav-link look so it reads as "a view switch within one
 * workspace", not a second, competing nav rail.
 *
 * Deliberately NOT added to `Sidebar.tsx`'s `NAV_ITEMS` — the brief calls for reaching `/recipes` from
 * "the same nav area" as Product Config without adding a whole new top-level sidebar entry. This
 * toggle (rendered in both `ProductConfig.tsx`'s and `RecipeConfig.tsx`'s headers) plus a
 * `CommandPalette` entry (`shell/CommandPalette.tsx`'s `EXTRA_ITEMS`, the same pattern already used
 * for `/tokens`) covers discoverability instead of sidebar clutter.
 */
export function ConfigModeToggle({ current, className }: ConfigModeToggleProps) {
  const t = useT()
  return (
    <nav
      aria-label={t("configModeToggle.ariaLabel")}
      className={cn("inline-flex w-fit items-center rounded-[var(--radius)] border border-border-strong bg-surface-muted p-0.5", className)}
    >
      <Link
        href="/products"
        aria-current={current === "products" ? "page" : undefined}
        className={cn(
          SEGMENT_CLASS,
          current === "products"
            ? "border-navy-800 bg-navy-700 text-white dark:border-navy-300 dark:bg-[var(--color-accent)] dark:text-navy-900"
            : "text-text-body hover:border-border-strong hover:bg-surface-card"
        )}
      >
        <Boxes className="size-3.5" aria-hidden="true" />
        {t("configModeToggle.products")}
      </Link>
      <Link
        href="/recipes"
        aria-current={current === "recipes" ? "page" : undefined}
        className={cn(
          SEGMENT_CLASS,
          current === "recipes"
            ? "border-navy-800 bg-navy-700 text-white dark:border-navy-300 dark:bg-[var(--color-accent)] dark:text-navy-900"
            : "text-text-body hover:border-border-strong hover:bg-surface-card"
        )}
      >
        <Wrench className="size-3.5" aria-hidden="true" />
        {t("configModeToggle.recipes")}
      </Link>
    </nav>
  )
}
