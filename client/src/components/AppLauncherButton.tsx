import { forwardRef, type ButtonHTMLAttributes } from "react";
import { LayoutGrid } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { AppDescriptor } from "@/lib/apps";

interface AppLauncherButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  activeApp?: AppDescriptor;
  onOpen?: () => void;
}

/**
 * doc 36 — top-shell App Launcher trigger: a waffle (⊞) that opens the app grid, showing
 * the current app's icon + name so users always know which app they're in.
 *
 * doc 40 — forwardRef + prop spreading so it works as a Radix `<PopoverTrigger asChild>`
 * child (the two-column launcher dropdown): Radix injects ref + a click-toggle handler +
 * aria-expanded/data-state, which a plain function component would silently drop.
 */
export const AppLauncherButton = forwardRef<HTMLButtonElement, AppLauncherButtonProps>(
  function AppLauncherButton({ activeApp, onOpen, className, onClick, ...rest }, ref) {
  const { t } = useTranslation();
  const ActiveIcon = activeApp?.icon;
  return (
    <button
      ref={ref}
      type="button"
      // Merge the Radix-injected onClick (popover toggle, present when used as an asChild
      // trigger) with the optional onOpen (used standalone / on mobile).
      onClick={(e) => { onClick?.(e); onOpen?.(); }}
      aria-label={t("nav.app.openLauncher")}
      className={cn(
        "flex h-9 items-center gap-2 rounded-lg border border-border bg-muted/40 px-2.5 text-sm transition-colors hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...rest}
    >
      <LayoutGrid className="h-4 w-4 shrink-0 text-muted-foreground" />
      {activeApp && ActiveIcon && (
        // doc 39 menu-audit M2 (P1-2): the active-app ICON always shows (so mobile users
        // still know which app they're in); only the NAME label collapses on small screens.
        <span className="flex min-w-0 items-center gap-1.5">
          <ActiveIcon className="h-4 w-4 shrink-0 text-primary" />
          <span className="hidden truncate font-medium text-foreground md:inline">{t(activeApp.labelKey)}</span>
        </span>
      )}
    </button>
  );
});

export default AppLauncherButton;
