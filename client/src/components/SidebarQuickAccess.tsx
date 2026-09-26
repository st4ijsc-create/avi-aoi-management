/**
 * doc 60 (menu-depth B) — QuickAccess block pinned at the TOP of the sidebar: Favorites
 * (★ pinned pages) + Recent (auto). Turns frequent pages into a 1-CLICK reach instead of
 * the 2-click module→page path. Reuses the same store the ⌘K palette writes (lib/navRecent),
 * RBAC-filters every entry (hasAccessToItem) so a pinned page the user lost access to never
 * shows. Reactive: re-reads on navigation + on favorite toggle (same/other tab).
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { Star, Clock } from "lucide-react";
import { getNavItemByHref, hasAccessToItem, type NavItem } from "@/lib/navigation";
import { readFavorites, readRecent, toggleFavorite, isFavorite } from "@/lib/navRecent";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { cn } from "@/lib/utils";

interface Resolved { href: string; item: NavItem }

export function SidebarQuickAccess({ onNavigate }: { onNavigate: (href: string) => void }) {
  const { t } = useTranslation();
  const [location] = useLocation();
  const { isAdmin, hasPermission } = usePermissions();
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const refresh = () => setVersion((v) => v + 1);
    window.addEventListener("nav-favorites-changed", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("nav-favorites-changed", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const userRole = isAdmin ? "admin" : undefined;

  const favorites = useMemo<Resolved[]>(() => {
    return readFavorites()
      .map((href) => ({ href, item: getNavItemByHref(href) }))
      .filter((x): x is Resolved => !!x.item && hasAccessToItem(x.href, userRole, hasPermission as never));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, location, isAdmin]);

  const recent = useMemo<Resolved[]>(() => {
    const favSet = new Set(favorites.map((f) => f.href));
    return readRecent()
      .filter((href) => href !== location && !favSet.has(href))
      .map((href) => ({ href, item: getNavItemByHref(href) }))
      // doc 63 AUD-N3 — user chốt: sidebar chỉ hiện 3 mục "Gần đây" (store vẫn giữ 5 cho ⌘K).
      .filter((x): x is Resolved => !!x.item && hasAccessToItem(x.href, userRole, hasPermission as never))
      .slice(0, 3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, location, isAdmin, favorites]);

  if (favorites.length === 0 && recent.length === 0) return null;

  const Row = ({ href, item }: Resolved) => {
    const active = location === href || location.startsWith(href + "?");
    const fav = isFavorite(href);
    return (
      <div className="group/qa flex items-center gap-1">
        <Link
          href={href}
          onClick={() => onNavigate(href)}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-sidebar-accent",
            active ? "font-medium text-primary" : "text-sidebar-foreground",
          )}
        >
          <span className={cn("shrink-0", active ? "text-primary" : "text-muted-foreground")}>{item.icon}</span>
          <span className="min-w-0 flex-1 truncate">{t(item.label)}</span>
        </Link>
        <button
          type="button"
          title={fav ? t("nav.unpin", "Bỏ ghim") : t("nav.pin", "Ghim")}
          onClick={() => { toggleFavorite(href); setVersion((v) => v + 1); }}
          className="shrink-0 rounded p-1 text-muted-foreground opacity-0 hover:text-primary focus:opacity-100 group-hover/qa:opacity-100"
        >
          <Star className={cn("h-3.5 w-3.5", fav && "fill-primary text-primary")} />
        </button>
      </div>
    );
  };

  return (
    <div className="mb-1 px-2">
      {favorites.length > 0 && (
        <>
          <div className="flex items-center gap-1 px-1 pb-0.5 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <Star className="h-3 w-3" />
            {t("nav.favorites", "Yêu thích")}
          </div>
          {favorites.map((f) => <Row key={f.href} {...f} />)}
        </>
      )}
      {recent.length > 0 && (
        <>
          <div className="flex items-center gap-1 px-1 pb-0.5 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <Clock className="h-3 w-3" />
            {t("nav.recent", "Gần đây")}
          </div>
          {recent.map((r) => <Row key={r.href} {...r} />)}
        </>
      )}
      <div className="my-1.5 border-t border-sidebar-border/50" />
    </div>
  );
}

export default SidebarQuickAccess;
