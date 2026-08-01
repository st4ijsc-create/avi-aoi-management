/**
 * F2 (doc 23 §5 E3) — small site-health dot for the header chrome.
 *
 * A glanceable connectivity signal for the multi-site ecosystem: green when all
 * known sites are healthy, amber when one is stale, red when one is down/errored.
 * Reads the SAME admin-gated `sites.list` query as the SiteSwitcher (react-query
 * dedupes the shared cache key — no extra request). Degrades gracefully: with no
 * read access or no sites it renders nothing (the header stays clean).
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { cn } from "@/lib/utils";

type Health = "ok" | "warn" | "down";

export function SiteHealthDot({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canView = hasPermission("admin_system", "canView");

  const listQ = trpc.sites.list.useQuery(undefined, {
    enabled: canView,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const health = useMemo<Health | null>(() => {
    const rows = listQ.data;
    if (!rows || rows.length === 0) return null;
    let worst: Health = "ok";
    for (const r of rows) {
      // `status` is the persisted federation status (active / error / paused / …).
      if (r.status === "error") return "down";
      if (r.status !== "active") worst = "warn";
    }
    return worst;
  }, [listQ.data]);

  if (!canView || health == null) return null;

  const label =
    health === "ok"
      ? t("nav.siteHealthOk", "All sites healthy")
      : health === "warn"
        ? t("nav.siteHealthWarn", "A site needs attention")
        : t("nav.siteHealthDown", "A site is down");

  return (
    <span
      className={cn("flex h-9 w-5 items-center justify-center", className)}
      title={label}
      aria-label={label}
      role="status"
      data-testid="site-health-dot"
    >
      <span
        className={cn(
          "h-2.5 w-2.5 rounded-full",
          health === "ok" && "bg-success",
          health === "warn" && "bg-warning",
          health === "down" && "bg-destructive",
        )}
      />
    </span>
  );
}

export default SiteHealthDot;
