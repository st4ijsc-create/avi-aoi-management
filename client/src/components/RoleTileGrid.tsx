/**
 * doc 60 (role-home) — the shared tile-grid section repeated verbatim in 5 role homes
 * (Supervisor/Viewer/Maintenance/Quality/Admin). Extracting it (approach a, per critic)
 * removes the duplicated `<section><h2/><grid>{tiles.map(ToolTile)}</grid></section>`
 * markup WITHOUT touching each home's own route/guard/widgets — the safe consolidation
 * (a hard RoleAwareHome merge would fight 3 different route guards + lose the kiosk-operator
 * / KPI-admin / NG-ack-quality specials). OperatorHome keeps its bespoke kiosk tiles.
 */
import { type LucideIcon } from "lucide-react";
import { ToolTile } from "@/components/patterns";
import { cn } from "@/lib/utils";

export interface RoleTile {
  icon: LucideIcon;
  label: string;
  description?: string;
  /** Destination route. */
  to: string;
  badge?: number;
  beta?: boolean;
  note?: string;
}

export interface RoleTileGridProps {
  title: string;
  tiles: RoleTile[];
  className?: string;
  /** Override the grid columns to preserve each home's original layout. */
  gridClassName?: string;
}

export function RoleTileGrid({ title, tiles, className, gridClassName }: RoleTileGridProps) {
  return (
    <section className={cn("space-y-3", className)}>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      <div className={gridClassName ?? "grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4"}>
        {tiles.map((tile) => (
          <ToolTile
            key={tile.to}
            icon={tile.icon}
            label={tile.label}
            blurb={tile.description}
            href={tile.to}
            badge={tile.badge}
            beta={tile.beta}
            note={tile.note}
          />
        ))}
      </div>
    </section>
  );
}

export default RoleTileGrid;
