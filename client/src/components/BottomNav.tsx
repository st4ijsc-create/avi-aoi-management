import { Menu } from "lucide-react";
import { useTranslation } from "react-i18next";
import { NavGroup } from "@/lib/navigation";
import { cn } from "@/lib/utils";

/**
 * E — Material 3 Bottom Navigation bar for phones (compact window class).
 *
 * Shows up to 4 top-level modules + a "Menu" action that opens the full drawer
 * (MobileDrillNav inside the Sidebar Sheet). Each destination navigates to its
 * module's default landing (first visible item). MD3 anatomy: icon inside a pill
 * active indicator, label below; active = secondary-container fill + accent.
 *
 * `groups` is already role/permission/license-filtered. Rendered only on mobile;
 * the page adds bottom padding so content isn't hidden behind the fixed bar.
 */
interface BottomNavProps {
  groups: NavGroup[];
  currentPath: string;
  onNavigate: (href: string) => void;
  onOpenMenu: () => void;
}

const MAX_DESTINATIONS = 4;

export function BottomNav({ groups, currentPath, onNavigate, onOpenMenu }: BottomNavProps) {
  const { t } = useTranslation();
  const destinations = groups.slice(0, MAX_DESTINATIONS);

  return (
    <nav
      data-app-chrome="bottom-nav"
      aria-label={t("nav.quickBrowse")}
      className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-backdrop-filter:backdrop-blur md:hidden"
    >
      {destinations.map(group => {
        const href = group.items[0]?.href;
        const isActive = group.items.some(item => item.href === currentPath);
        return (
          <button
            key={group.id}
            type="button"
            onClick={() => href && onNavigate(href)}
            aria-label={t(group.label)}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isActive ? "text-primary" : "text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "flex h-8 w-16 items-center justify-center rounded-full transition-colors",
                isActive ? "bg-sidebar-accent text-primary" : "text-muted-foreground",
              )}
            >
              {group.icon}
            </span>
            <span className="line-clamp-1 max-w-full px-1 text-[11px] leading-none">
              {t(group.label)}
            </span>
          </button>
        );
      })}
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
