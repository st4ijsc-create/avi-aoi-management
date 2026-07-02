import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NavGroup, groupItemsBySection, isNavItemActive } from "@/lib/navigation";
import { pushRecentHref } from "./CommandPalette";
import { cn } from "@/lib/utils";

interface MegaMenuOverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Already role/permission/license-filtered nav groups (from DashboardLayout). */
  groups: NavGroup[];
  /** Navigate to href and close the overlay. */
  onNavigate: (href: string) => void;
}

/**
 * "Duyệt nhanh" (Quick Browse) — full-screen mega-menu overlay (M4).
 *
 * Renders EVERY visible group with its Cấp-2 sections + items at once in a
 * responsive grid, so any destination is one click away. Reuses the same
 * `visibleGroups` the sidebar/palette get (never shows a hidden item) and the
 * shared `groupItemsBySection` bucketing. Clicking an item records it in Recent
 * (shared with the command palette) then navigates + closes.
 */
export function MegaMenuOverlay({
  open,
  onOpenChange,
  groups,
  onNavigate,
}: MegaMenuOverlayProps) {
  const { t } = useTranslation();
  const [location] = useLocation();

  const handleNavigate = (href: string) => {
    pushRecentHref(href);
    onNavigate(href);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[90vh] w-full max-w-[90vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-[90vw]"
      >
        <DialogHeader className="border-b border-border px-6 py-4 text-left">
          <DialogTitle>{t("nav.quickBrowse")}</DialogTitle>
        </DialogHeader>

        <div className="overflow-y-auto px-6 py-6">
          <div className="grid grid-cols-2 gap-6 md:grid-cols-3 lg:grid-cols-4">
            {groups.map(group => {
              const buckets = groupItemsBySection(group);
              return (
                <div key={group.id} className="min-w-0">
                  <div className="mb-3 flex items-center gap-2">
                    {group.icon && (
                      <span className="shrink-0 text-muted-foreground">{group.icon}</span>
                    )}
                    <h3 className="truncate text-sm font-semibold text-foreground">
                      {t(group.label)}
                    </h3>
                  </div>

                  <div className="flex flex-col gap-3">
                    {buckets.map((bucket, idx) => (
                      <div key={bucket.key ?? `flat-${idx}`} className="flex flex-col gap-1">
                        {bucket.key !== null && bucket.label && (
                          <div className="px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                            {t(bucket.label)}
                          </div>
                        )}
                        {bucket.items.map(item => {
                          const isActive = isNavItemActive(item.href, location);
                          return (
                            <button
                              key={item.href}
                              type="button"
                              onClick={() => handleNavigate(item.href)}
                              className={cn(
                                "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                                "hover:bg-accent hover:text-accent-foreground",
                                isActive
                                  ? "bg-accent font-medium text-accent-foreground"
                                  : "text-muted-foreground",
                              )}
                            >
                              <span className="shrink-0">{item.icon}</span>
                              <span className="truncate">{t(item.label)}</span>
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default MegaMenuOverlay;
