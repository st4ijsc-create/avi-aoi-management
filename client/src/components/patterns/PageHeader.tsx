/**
 * DS F1b — <PageHeader> (doc 16 §12.2).
 *
 * Canonical page header extracted verbatim from the de-facto pattern repeated
 * across FleetOrchestration / SafetyWorkforce / DigitalTwinCenter:
 *   [icon chip] · title (+ optional badge slot) + description · [actions slot]
 *
 * F0 (doc 23): the title now uses the DS type scale (<Heading> → .ds-h1) instead
 * of the ad-hoc `text-2xl font-bold`.
 *
 * Doc 81 Đợt 2 Task 2 — prop `breadcrumbs` ĐÃ BỎ: breadcrumb duy nhất nằm trong top bar
 * của shell (DashboardLayout), dựng từ cùng `buildBreadcrumbs(route)` mà các trang từng
 * truyền vào đây ⇒ 11 màn Engineering (và 5 trang khác) từng có HAI breadcrumb.
 *
 * Accessible: the title renders as an <h1> by default; the icon chip is
 * decorative (aria-hidden) so screen readers read the title, not the glyph.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { Heading } from "./Heading";

export interface PageHeaderProps {
  /** Lucide icon element, e.g. <Truck className="h-6 w-6 text-primary" />.
   *  Sizing is applied by the chip; pass the icon without size if you like. */
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Right-aligned actions (buttons, selects, refresh, …). */
  actions?: React.ReactNode;
  /** Rendered directly under the title — e.g. a <ViewOnlyBadge />. */
  badge?: React.ReactNode;
  /** Heading level for the title (a11y / document outline). Default h1. */
  as?: "h1" | "h2";
  className?: string;
}

export function PageHeader({
  icon,
  title,
  description,
  actions,
  badge,
  as = "h1",
  className,
}: PageHeaderProps) {
  const headingLevel = as === "h2" ? 2 : 1;
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-center gap-3">
        {icon != null && (
          <div
            aria-hidden="true"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
          >
            {icon}
          </div>
        )}
        {/* doc65 V2: floor 16rem — cụm actions dài không được ép title/description
            bẹp thành cột 1-từ/dòng; thiếu chỗ thì actions wrap xuống dòng (flex-wrap cha). */}
        <div className="flex-1 min-w-[min(16rem,100%)]">
          <Heading level={headingLevel} as={as}>
            {title}
          </Heading>
          {badge}
          {description != null && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {actions != null && (
          <div className="flex items-center gap-2 flex-wrap">{actions}</div>
        )}
      </div>
    </div>
  );
}

export default PageHeader;
