/**
 * DS F1 (doc 23 §4 Table B) — <ToolTile>.
 *
 * Canonical "jump to a tool / domain" tile. The F0/F1 audit found this pattern
 * hand-rolled across the role-home pages (OperatorHome / QualityHome / …): an
 * icon + label + optional blurb that navigates to a route. This is the shared,
 * token-driven version used by the homepage domain grid and MaintenanceHome.
 *
 * - Navigates via wouter <Link> (keeps SPA routing + prefetch semantics).
 * - Uniform height (`min-h`) so grids line up regardless of blurb length.
 * - Semantic tokens only (no raw palette / hex): `bg-card`, `border`, `primary`
 *   accent, `muted` hover — correct in both light and dark.
 * - Accessible: the whole tile is one link; the icon chip is decorative.
 *
 * NOTE: the four existing role-home files are intentionally NOT migrated here —
 * that consolidation is F3. This component is additive.
 */
import * as React from "react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export interface ToolTileProps {
  icon: LucideIcon;
  label: string;
  /** Optional one-line description under the label. */
  blurb?: string;
  /** Destination route (wouter). */
  href: string;
  /** Optional count badge (e.g. pending items). */
  badge?: number;
  className?: string;
}

export function ToolTile({ icon: Icon, label, blurb, href, badge, className }: ToolTileProps) {
  return (
    <Link
      href={href}
      className={cn(
        "group relative flex min-h-[112px] flex-col items-start gap-2 rounded-xl border bg-card p-4 text-left shadow-sm",
        "transition-colors hover:border-primary/50 hover:bg-muted/50",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 active:scale-[0.99]",
        className,
      )}
    >
      {badge != null && badge > 0 && (
        <span className="absolute right-2 top-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-bold text-primary-foreground">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary/20">
        <Icon className="h-5 w-5" strokeWidth={2.1} aria-hidden="true" />
      </div>
      <span className="text-base font-semibold leading-tight tracking-tight text-foreground">
        {label}
      </span>
      {blurb && <span className="text-xs leading-snug text-muted-foreground">{blurb}</span>}
    </Link>
  );
}

export default ToolTile;
