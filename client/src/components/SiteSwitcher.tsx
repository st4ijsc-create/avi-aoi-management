/**
 * F2 (doc 23 §5 P0 gap) — Site / Scope switcher for the app chrome.
 *
 * Carries the multi-site ecosystem scope in the header (and the mobile Menu
 * drawer). Shows "All sites" or "All sites ▸ <site>" and lets an admin pick a
 * single site to scope the view label. It POPULATES <SiteContext> from the
 * admin-gated `sites.list` query when the role can read it, and PERSISTS the
 * choice (SiteContext writes localStorage).
 *
 * Graceful degradation (federation/sites are admin-gated):
 *   • No read access to the sites list, OR ≤1 known site → render a STATIC,
 *     non-interactive "All sites" label (no dropdown, no crash). The query is
 *     only enabled when the role can view it, so non-admins never fire it.
 *
 * SCOPE-ONLY: selecting a site sets the context scope + label; it does NOT (yet)
 * rewire page data-queries to filter by site — that is future work.
 */
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Building2, Check, ChevronsUpDown, Globe } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { useSite } from "@/contexts/SiteContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface SiteSwitcherProps {
  /** `header` → compact chrome control; `drawer` → full-width for the mobile Menu. */
  variant?: "header" | "drawer";
  className?: string;
}

export function SiteSwitcher({ variant = "header", className }: SiteSwitcherProps) {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const { sites, activeSiteId, setActiveSiteId, setSites } = useSite();

  // Sites registry is admin-gated (adminProcedure). Only fire the query when the
  // role can actually read it — non-admins skip it entirely and degrade to the
  // static label below.
  const canView = hasPermission("admin_system", "canView");
  const listQ = trpc.sites.list.useQuery(undefined, {
    enabled: canView,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  // Populate SiteContext once the list resolves (ids coerced to string — the
  // sites table uses a numeric id, the context is string-keyed).
  const fetched = useMemo(
    () =>
      (listQ.data ?? []).map(s => ({
        id: String(s.id),
        name: s.name || s.code || String(s.id),
      })),
    [listQ.data],
  );
  useEffect(() => {
    if (canView && listQ.data) setSites(fetched);
  }, [canView, listQ.data, fetched, setSites]);

  const allSitesLabel = t("nav.allSites", "All sites");
  const activeSite = sites.find(s => s.id === activeSiteId) ?? null;

  const isFullWidth = variant === "drawer";

  // Degrade: no access, or nothing meaningful to switch between (≤1 site) →
  // a static, non-interactive scope label. Keeps ecosystem context visible.
  if (!canView || sites.length <= 1) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 text-sm text-muted-foreground",
          isFullWidth ? "h-10 w-full" : "h-9",
          className,
        )}
        title={allSitesLabel}
        data-testid="site-switcher-static"
      >
        <Globe className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{allSitesLabel}</span>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("nav.siteScope", "Site scope")}
          className={cn(
            "flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 text-sm text-foreground transition-colors hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            isFullWidth ? "h-10 w-full" : "h-9 max-w-[16rem]",
            className,
          )}
          data-testid="site-switcher"
        >
          {activeSite ? (
            <Building2 className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          ) : (
            <Globe className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
          <span className="min-w-0 flex-1 truncate text-left">
            {activeSite ? (
              <>
                <span className="text-muted-foreground">{allSitesLabel}</span>
                <span className="mx-1 text-muted-foreground">›</span>
                <span className="font-medium">{activeSite.name}</span>
              </>
            ) : (
              allSitesLabel
            )}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>{t("nav.siteScope", "Site scope")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="cursor-pointer gap-2"
          onClick={() => setActiveSiteId(null)}
        >
          <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="flex-1 truncate">{allSitesLabel}</span>
          {activeSiteId == null && <Check className="h-4 w-4 shrink-0 text-primary" />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {sites.map(site => (
          <DropdownMenuItem
            key={site.id}
            className="cursor-pointer gap-2"
            onClick={() => setActiveSiteId(site.id)}
          >
            <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="flex-1 truncate">{site.name}</span>
            {activeSiteId === site.id && <Check className="h-4 w-4 shrink-0 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default SiteSwitcher;
