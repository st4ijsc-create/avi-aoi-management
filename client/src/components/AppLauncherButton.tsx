import { LayoutGrid } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { AppDescriptor } from "@/lib/apps";

interface AppLauncherButtonProps {
  activeApp?: AppDescriptor;
  onOpen: () => void;
  className?: string;
}

/**
 * doc 36 — top-shell App Launcher trigger: a waffle (⊞) that opens the app grid, showing
 * the current app's icon + name so users always know which app they're in.
 */
export function AppLauncherButton({ activeApp, onOpen, className }: AppLauncherButtonProps) {
  const { t } = useTranslation();
  const ActiveIcon = activeApp?.icon;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t("nav.app.openLauncher")}
      className={cn(
        "flex h-9 items-center gap-2 rounded-lg border border-border bg-muted/40 px-2.5 text-sm transition-colors hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <LayoutGrid className="h-4 w-4 shrink-0 text-muted-foreground" />
      {activeApp && ActiveIcon && (
        <span className="hidden min-w-0 items-center gap-1.5 md:flex">
          <ActiveIcon className="h-4 w-4 shrink-0 text-primary" />
          <span className="truncate font-medium text-foreground">{t(activeApp.labelKey)}</span>
        </span>
      )}
    </button>
  );
}

export default AppLauncherButton;
