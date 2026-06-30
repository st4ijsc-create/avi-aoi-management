/**
 * DS F1b — <PageHeader> (doc 16 §12.2).
 *
 * Canonical page header extracted verbatim from the de-facto pattern repeated
 * across FleetOrchestration / SafetyWorkforce / DigitalTwinCenter:
 *   [icon chip] · title (+ optional badge slot) + description · [actions slot]
 *
 * Visual output is byte-identical to those hand-rolled headers, so it is a
 * drop-in. Accessible: the title renders as an <h1> by default; the icon chip
 * is decorative (aria-hidden) so screen readers read the title, not the glyph.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

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
  as: Heading = "h1",
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("flex flex-wrap items-center gap-3", className)}>
      {icon != null && (
        <div
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
        >
          {icon}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <Heading className="text-2xl font-bold tracking-tight">{title}</Heading>
        {badge}
        {description != null && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions != null && (
        <div className="flex items-center gap-2 flex-wrap">{actions}</div>
      )}
    </div>
  );
}

export default PageHeader;
