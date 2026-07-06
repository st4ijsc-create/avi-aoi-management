import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Lock } from "lucide-react";
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
 * Core apps are always unlocked. This is the launcher's front door — one tile per SKU.
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
      <DialogContent className="flex max-h-[90vh] w-full max-w-[880px] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-6 py-4 text-left">
          <DialogTitle>{t("nav.app.launcher")}</DialogTitle>
          <p className="text-sm text-muted-foreground">{t("nav.app.launcherDesc")}</p>
        </DialogHeader>

        <div className="overflow-y-auto px-6 py-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
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
                  className={cn(
                    "group relative flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-all",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    unlocked
                      ? "border-border hover:border-primary/50 hover:bg-accent"
                      : "border-dashed border-border/60 opacity-70 hover:opacity-100",
                    isActive && "border-primary bg-accent ring-1 ring-primary/30",
                  )}
                >
                  <div
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-lg",
                      unlocked ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                    )}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-semibold text-foreground">
                        {t(app.labelKey)}
                      </span>
                      {!unlocked && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                      {t(app.blurbKey)}
                    </p>
                  </div>
                  {!unlocked && (
                    <span className="mt-1 rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {t("nav.app.upgrade")}
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
