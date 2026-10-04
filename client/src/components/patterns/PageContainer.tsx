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
 *   • FULL-WIDTH column   → content fills the layout (no centered max-width cap)
 *
 * doc 41 — full-width is now the DEFAULT: dashboards/tables were being capped at
 * `max-w-7xl` and centered, leaving large empty gutters on wide monitors. Pages that
 * genuinely want a narrow reading column (long forms, single-column text) opt IN with
 * `narrow`. `fluid`/`wide` are kept as no-ops for back-compat (already full-width).
 * `className` is appended last so callers can still override anything.
 *
 * Doc 81 Đợt 2 Task 2 — KHÔNG đệm kép: bên trong `<main>` của shell (DashboardLayout), main là chỗ
 * đệm duy nhất, nên PageContainer bỏ padding riêng (trước đây 24 + 24 px trước tiêu đề). Ngoài shell
 * (storybook, test, trang tự dựng) giữ padding cũ.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { useInShellMain } from "@/lib/shellPage";

export interface PageContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  /** @deprecated full-width is now the default — kept for back-compat (no-op). */
  fluid?: boolean;
  /** @deprecated alias of `fluid` (no-op). */
  wide?: boolean;
  /** Opt IN to a centered, capped reading column (`mx-auto max-w-7xl`) — for long
   *  forms / single-column text pages that read better narrow. */
  narrow?: boolean;
}

export function PageContainer({
  fluid = false,
  wide = false,
  narrow = false,
  className,
  ...props
}: PageContainerProps) {
  // Full-width by default; `narrow` opts into the centered column. `fluid`/`wide`
  // stay full-width (they always did), so they can never force a narrow column.
  const centered = narrow && !fluid && !wide;
  const inShellMain = useInShellMain();
  return (
    <div
      data-page-container=""
      className={cn(
        "w-full space-y-6",
        inShellMain ? "" : "px-4 py-4 md:px-6 md:py-6",
        centered ? "mx-auto max-w-7xl" : "",
        className,
      )}
      {...props}
    />
  );
}

export default PageContainer;
