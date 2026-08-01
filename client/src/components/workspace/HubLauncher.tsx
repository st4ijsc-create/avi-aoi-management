/**
 * doc 59 (Cụm E/H/I) — HubLauncher: reusable master-detail "hub" (rail categories ⇄
 * main ToolTile launcher) with PER-TILE RBAC. Factors the DataManagementHub (Cụm D)
 * shape into one primitive so Product / AI-Studio / Maintenance hubs are just a catalog.
 *
 * Additive + safe: tiles are deep-links to the existing pages (no embed, no redirect,
 * routes untouched). A tile is hidden when the user lacks its `requiredPermission`
 * (usePermissions → admin sees all); a category with zero visible tiles is dropped —
 * so gating the hub nav entry at the LOWEST bar never shows an empty page.
 */
import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { type LucideIcon } from "lucide-react";
import { WorkspaceShell } from "./WorkspaceShell";
import { ToolTile } from "@/components/patterns";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { cn } from "@/lib/utils";

export interface HubTool {
  icon: LucideIcon;
  label: string;
  blurb?: string;
  href: string;
  /** Module name; tile hidden unless the user has canView (admin always passes). */
  requiredPermission?: string;
  /**
   * Role gate for routes guarded by requireRole (not a module permission) — e.g.
   * "admin" for /system-config. Without this, an admin-role-only tile with no
   * requiredPermission would show to everyone and dead-end at the route guard.
   */
  requiredRole?: string;
  /** Short access note under the blurb (e.g. "Chỉ xem" / "Admin"). */
  note?: string;
  beta?: boolean;
}

export interface HubCategory {
  key: string;
  label: string;
  icon: ReactNode;
  tools: HubTool[];
}

export interface HubLauncherProps {
  categories: readonly HubCategory[];
  categoriesLabel?: string;
}

export function HubLauncher({ categories, categoriesLabel }: HubLauncherProps) {
  const { t } = useTranslation();
  const { hasPermission, isAdmin } = usePermissions();

  const visible = useMemo(
    () =>
      categories
        .map((c) => ({
          ...c,
          tools: c.tools.filter(
            (tool) =>
              // module-permission gate (admin passes via hasPermission)
              (!tool.requiredPermission || hasPermission(tool.requiredPermission, "canView")) &&
              // role gate — a requireRole:'admin' route hides its tile for non-admins
              (!tool.requiredRole || tool.requiredRole !== "admin" || isAdmin),
          ),
        }))
        .filter((c) => c.tools.length > 0),
    [categories, hasPermission, isAdmin],
  );

  const [active, setActive] = useState(visible[0]?.key ?? "");
  const cat = visible.find((c) => c.key === active) ?? visible[0];

  if (!cat) {
    return <div className="p-6 text-sm text-muted-foreground">{t("hub.noAccess", "Bạn chưa có quyền với mục nào ở đây.")}</div>;
  }

  return (
    <WorkspaceShell
      railDefaultSize={22}
      rail={
        <nav className="p-2">
          <p className="px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {categoriesLabel ?? t("hub.categories", "Danh mục")}
          </p>
          <ul className="space-y-0.5">
            {visible.map((c) => (
              <li key={c.key}>
                <button
                  type="button"
                  onClick={() => setActive(c.key)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent/60",
                    cat.key === c.key && "bg-accent font-medium",
                  )}
                >
                  {c.icon}
                  <span className="min-w-0 flex-1 truncate">{c.label}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{c.tools.length}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      }
      main={
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            {cat.icon}
            <h2 className="text-base font-semibold">{cat.label}</h2>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {cat.tools.map((tool) => (
              <ToolTile key={tool.href} icon={tool.icon} label={tool.label} blurb={tool.blurb} href={tool.href} note={tool.note} beta={tool.beta} />
            ))}
          </div>
        </div>
      }
    />
  );
}

export default HubLauncher;
