import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Lock, Check, ArrowUpRight } from "lucide-react";
import { listApps, isAppAllowed, type AppDescriptor } from "@/lib/apps";
import { cn } from "@/lib/utils";

interface AppLauncherOverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** License module codes the tenant owns (from useLicenseModules). */
  allowedModules: string[];
  /** The currently open app (highlighted). */
  activeAppId?: string;
  /** Open an owned app → navigate to its landing + set active. */
  onSelectApp: (app: AppDescriptor) => void;
  /** Click a locked (unowned sellable) app → upsell (e.g. navigate to /modules). */
  onUpgrade: (app: AppDescriptor) => void;
}

/**
 * doc 36 — App Launcher grid (Phương án A). Full-screen overlay of the apps the tenant
 * owns; unowned sellable apps render locked with an "Upgrade" affordance (L1 license).
 * Core apps are always unlocked. One tile per SKU — this is the launcher's front door.
 */
export function AppLauncherOverlay({
  open,
  onOpenChange,
  allowedModules,
  activeAppId,
  onSelectApp,
  onUpgrade,
}: AppLauncherOverlayProps) {
  const { t } = useTranslation();
  const allowedSet = new Set(allowedModules);
  const apps = listApps();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] w-[min(96vw,960px)] max-w-[960px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[960px]">
        <DialogHeader className="border-b border-border px-6 py-4 text-left">
          <DialogTitle className="text-lg">{t("nav.app.launcher")}</DialogTitle>
          <p className="text-sm text-muted-foreground">{t("nav.app.launcherDesc")}</p>
        </DialogHeader>

        <div className="overflow-y-auto p-5 sm:p-6">
          <div className="grid grid-cols-2 items-stretch gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
            {apps.map((app) => {
              const Icon = app.icon;
              const unlocked = isAppAllowed(app, allowedSet);
              const isActive = app.appId === activeAppId;
              return (
                <button
                  key={app.appId}
                  type="button"
                  onClick={() => (unlocked ? onSelectApp(app) : onUpgrade(app))}
                  aria-current={isActive ? "page" : undefined}
                  title={t(app.blurbKey)}
                  className={cn(
                    "group relative flex h-full min-h-[132px] flex-col gap-3 rounded-2xl border p-4 text-left transition-all duration-150",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                    unlocked
                      ? "border-border bg-card hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md hover:shadow-primary/5"
                      : "border-dashed border-border/60 bg-muted/20 hover:border-border",
                    isActive && "border-primary/60 bg-primary/5 ring-1 ring-primary/30",
                  )}
                >
                  {/* Top row: icon + status badge */}
                  <div className="flex items-start justify-between">
                    <div
                      className={cn(
                        "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors",
                        unlocked
                          ? "bg-primary/10 text-primary group-hover:bg-primary/15"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      <Icon className="h-[22px] w-[22px]" />
                    </div>
                    {isActive ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                        <Check className="h-3 w-3" />
                        {t("nav.app.current", "Đang mở")}
                      </span>
                    ) : !unlocked ? (
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-muted-foreground">
                        <Lock className="h-3 w-3" />
                      </span>
                    ) : null}
                  </div>

                  {/* Label + blurb — min-w-0 lets line-clamp constrain long labels (no overflow). */}
                  <div className="min-w-0 flex-1">
                    <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">
                      {t(app.labelKey)}
                    </h3>
                    <p className="mt-1 line-clamp-2 text-xs leading-snug text-muted-foreground">
                      {t(app.blurbKey)}
                    </p>
                  </div>

                  {/* Footer affordance for locked apps */}
                  {!unlocked && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-primary/80 group-hover:text-primary">
                      {t("nav.app.upgrade")}
                      <ArrowUpRight className="h-3 w-3" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default AppLauncherOverlay;
