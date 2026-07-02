/**
 * DS F0 — <PageContainer> (doc 23 §F0).
 *
 * The standard page shell that later phases (F1–F3) drop pages into so every
 * screen shares one horizontal rhythm, max-width and vertical spacing. It is the
 * child you render INSIDE the existing DashboardLayout (it does not replace the
 * chrome) — it only owns the content column.
 *
 * Defaults distilled from the de-facto page shell (`space-y-6 p-4 md:p-6`):
 *   • responsive padding  → `px-4 md:px-6` + `py-4 md:py-6`
 *   • vertical rhythm     → `space-y-6`
 *   • centered column     → `mx-auto w-full max-w-7xl`
 *
 * Full-bleed pages (maps, 3D twin, dense monitor tables) opt out with `fluid`
 * (a.k.a. `wide`), which drops the max-width so the content fills the layout.
 * `className` is appended last so callers can still override anything.
 *
 * ADDITIVE & opt-in — existing pages are untouched until F3 adopts this.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export interface PageContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Drop the centered max-width so the content spans the full layout width.
   *  Use for maps / 3D twins / wide monitor tables. */
  fluid?: boolean;
  /** Alias of `fluid` — either enables full-width. */
  wide?: boolean;
}

export function PageContainer({
  fluid = false,
  wide = false,
  className,
  ...props
}: PageContainerProps) {
  const fullWidth = fluid || wide;
  return (
    <div
      className={cn(
        "w-full space-y-6 px-4 py-4 md:px-6 md:py-6",
        fullWidth ? "" : "mx-auto max-w-7xl",
        className,
      )}
      {...props}
    />
  );
}

export default PageContainer;
