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
import { BetaBadge } from "@/components/BetaBadge";

export interface ToolTileProps {
  icon: LucideIcon;
  label: string;
  /** Optional one-line description under the label. */
  blurb?: string;
  /** Destination route (wouter). */
  href: string;
  /** Optional count badge (e.g. pending items). */
  badge?: number;
  /**
   * U7 (doc 26 §2.1) — flag a preview/framework surface so a new technician is
   * warned BEFORE clicking (renders the shared "Thử nghiệm" chip).
   */
  beta?: boolean;
  /**
   * U7 — short access note under the blurb (e.g. "Chỉ xem" / "Cần quyền điều khiển")
   * so the tile advertises its permission level up front. Pair with `noteIcon`.
   */
  note?: string;
  /** Optional icon for the access note (Lock / Eye …). */
  noteIcon?: LucideIcon;
  className?: string;
}

export function ToolTile({ icon: Icon, label, blurb, href, badge, beta, note, noteIcon: NoteIcon, className }: ToolTileProps) {
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
      {/* U7 — chip hàng dưới: báo trước Beta / mức quyền (đẩy xuống đáy tile cho thẳng hàng). */}
      {(beta || note) && (
        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
          {beta && <BetaBadge />}
          {note && (
            <span className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0 text-[10px] font-medium leading-4 text-muted-foreground">
              {NoteIcon && <NoteIcon className="h-3 w-3" aria-hidden="true" />}
              {note}
            </span>
          )}
        </div>
      )}
    </Link>
  );
}

export default ToolTile;
