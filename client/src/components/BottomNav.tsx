import { Menu } from "lucide-react";
import { ReactNode, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { NavGroup, NavItem, isNavItemActive } from "@/lib/navigation";
import { landingPathForRole } from "@/lib/roleLanding";
import { cn } from "@/lib/utils";

/**
 * E — Material 3 Bottom Navigation bar for phones (compact window class).
 *
 * Shows up to 4 top-level modules + a "Menu" action that opens the full drawer
 * (MobileDrillNav inside the Sidebar Sheet). Each destination navigates to its
 * module's default landing (first visible item). MD3 anatomy: icon inside a pill
 * active indicator, label below; active = secondary-container fill + accent.
 *
 * F2 (doc 23 §5) — the 4 destinations are chosen by ROLE-LANDING priority (the
 * module that owns the role's front door leads), not raw navGroups order, so each
 * role gets its most-useful surfaces on the bar. Falls back to array order.
 *
 * `groups` is already role/permission/license-filtered. Rendered only on mobile;
 * the page adds bottom padding so content isn't hidden behind the fixed bar.
 */
interface BottomNavProps {
  groups: NavGroup[];
  currentPath: string;
  onNavigate: (href: string) => void;
  onOpenMenu: () => void;
  /** Authenticated user's role — drives which 4 destinations lead the bar. */
  role?: string | null;
  /**
   * doc 36 W4 follow-up — App-Launcher mode: when provided, the bar shows the ACTIVE
   * APP's top items (not global group landings), and "Menu" opens the launcher (switch app).
   */
  items?: NavItem[];
}

interface BarDestination {
  key: string;
  icon: ReactNode;
  label: string;
  href?: string;
  isActive: boolean;
}

const MAX_DESTINATIONS = 4;

/**
 * Order the (already-visible) groups by role-landing priority: the group that
 * owns the role's landing route comes first, followed by a sensible per-role
 * priority list, then any remaining groups in their original order. Every group
 * appears exactly once.
 */
function orderGroupsForRole(groups: NavGroup[], role?: string | null): NavGroup[] {
  const byId = new Map(groups.map(g => [g.id, g] as const));
  const ordered: NavGroup[] = [];
  const taken = new Set<string>();
  const take = (id: string) => {
    const g = byId.get(id);
    if (g && !taken.has(id)) {
      ordered.push(g);
      taken.add(id);
    }
  };

  // 1. The module that owns the role's landing route leads.
  const landing = landingPathForRole(role);
  const landingGroup = groups.find(g => g.items.some(i => isNavItemActive(i.href, landing)));
  if (landingGroup) take(landingGroup.id);

  // 2. Per-role priority of the next-most-useful modules.
  const PRIORITY_BY_ROLE: Record<string, string[]> = {
    operator: ["overview", "production", "quality", "me"],
    maintenance: ["devices", "overview", "engineering", "me"],
    quality_inspector: ["quality", "production", "overview", "me"],
    supervisor: ["overview", "production", "analytics", "quality"],
    manager: ["overview", "analytics", "production", "quality"],
    admin: ["overview", "production", "devices", "admin"],
    it_admin: ["overview", "admin", "devices", "ai"],
    engineer: ["overview", "devices", "engineering", "production"],
    viewer: ["overview", "production", "quality", "me"],
    user: ["overview", "production", "quality", "me"],
  };
  for (const id of PRIORITY_BY_ROLE[role ?? ""] ?? ["overview", "production", "quality", "me"]) {
    take(id);
  }

  // 3. Anything left, in original (navGroups) order.
  for (const g of groups) take(g.id);

  return ordered;
}

export function BottomNav({ groups, currentPath, onNavigate, onOpenMenu, role, items }: BottomNavProps) {
  const { t } = useTranslation();
  const destinations = useMemo<BarDestination[]>(() => {
    // App-Launcher mode: the active app's top items are the destinations.
    if (items && items.length > 0) {
      return items.slice(0, MAX_DESTINATIONS).map((item) => ({
        key: item.href,
        icon: item.icon,
        label: t(item.label),
        href: item.href,
        isActive: isNavItemActive(item.href, currentPath),
      }));
    }
    // Legacy mode: 4 group landings by role priority.
    return orderGroupsForRole(groups, role)
      .slice(0, MAX_DESTINATIONS)
      .map((group) => ({
        key: group.id,
        icon: group.icon,
        label: t(group.label),
        href: group.items[0]?.href,
        isActive: group.items.some((item) => isNavItemActive(item.href, currentPath)),
      }));
  }, [items, groups, role, currentPath, t]);

  return (
    <nav
      data-app-chrome="bottom-nav"
      aria-label={t("nav.quickBrowse")}
      className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-backdrop-filter:backdrop-blur md:hidden"
    >
      {destinations.map(dest => (
        <button
          key={dest.key}
          type="button"
          onClick={() => dest.href && onNavigate(dest.href)}
          aria-label={dest.label}
          aria-current={dest.isActive ? "page" : undefined}
          className={cn(
            "flex flex-1 flex-col items-center justify-center gap-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            dest.isActive ? "text-primary" : "text-muted-foreground",
          )}
        >
          <span
            className={cn(
              "flex h-8 w-16 items-center justify-center rounded-full transition-colors",
              dest.isActive ? "bg-sidebar-accent text-primary" : "text-muted-foreground",
            )}
          >
            {dest.icon}
          </span>
          <span className="line-clamp-1 max-w-full px-1 text-[11px] leading-none">
            {dest.label}
          </span>
        </button>
      ))}
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label={t("nav.menu")}
        className="flex flex-1 flex-col items-center justify-center gap-1 text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex h-8 w-16 items-center justify-center rounded-full">
          <Menu className="h-5 w-5" />
        </span>
        <span className="text-[11px] leading-none">{t("nav.menu")}</span>
      </button>
    </nav>
  );
}
