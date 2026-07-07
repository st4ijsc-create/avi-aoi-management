import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Lock, Check, ArrowUpRight, LayoutGrid, ChevronRight } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AppLauncherButton } from "./AppLauncherButton";
import { listApps, isAppAllowed, scopeGroupsToApp, type AppDescriptor } from "@/lib/apps";
import { isNavItemActive, type NavGroup } from "@/lib/navigation";
import { cn } from "@/lib/utils";

interface AppLauncherDropdownProps {
  /** The currently open app (waffle label + left-column highlight). */
  activeApp?: AppDescriptor;
  /** License module codes the tenant owns (from useLicenseModules). */
  allowedModules: string[];
  /**
   * Already role/permission/license/mode-filtered nav groups (the parent's
   * `visibleGroups`). The right column scopes THIS list to the previewed app via
   * `scopeGroupsToApp`, so the pages shown honour every gate the sidebar honours.
   */
  visibleGroups: NavGroup[];
  /** Live path WITH ?search so the active page is highlighted correctly. */
  currentPath: string;
  /** Navigate DIRECTLY to a page (the 2nd click) — no landing-page detour. */
  onNavigate: (href: string) => void;
  /** Optional: click an app NAME (not a page) → open it to its landing (legacy). */
  onSelectApp: (app: AppDescriptor) => void;
  /** Click a locked (unowned sellable) app → upsell (e.g. /modules). */
  onUpgrade: (app: AppDescriptor) => void;
  /** Open the full-screen grid overlay ("All apps ⊞" / first-run / catalog). */
  onOpenAllApps: () => void;
  /**
   * Mobile → the dropdown is desktop-oriented; the waffle opens the full-screen
   * overlay directly instead of the Popover.
   */
  isMobile?: boolean;
  className?: string;
}

/**
 * doc 40 — two-column App Launcher DROPDOWN anchored to the waffle button.
 *
 * Left column = the app list (all apps, active highlighted, locked apps show a lock).
 * Right column = the PAGES of the hovered/focused app (`scopeGroupsToApp`), shown as a
 * grouped, scrollable, flat list. Clicking a page navigates DIRECTLY there — turning a
 * ~5-click cross-app jump (open full launcher → pick app → land → open sidebar → drill)
 * into 2 clicks (open dropdown → click page). Hovering an app only PREVIEWS its pages.
 *
 * The full-screen `AppLauncherOverlay` stays reachable via the "All apps" footer button
 * (and is used directly on mobile / first-run) — this dropdown is purely additive.
 */
export function AppLauncherDropdown({
  activeApp,
  allowedModules,
  visibleGroups,
  currentPath,
  onNavigate,
  onSelectApp,
  onUpgrade,
  onOpenAllApps,
  isMobile,
  className,
}: AppLauncherDropdownProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // The app whose pages fill the right column. Defaults to the active app; hovering /
  // focusing a left-column app updates it WITHOUT navigating.
  const [previewAppId, setPreviewAppId] = useState<string | undefined>(activeApp?.appId);

  const allowedSet = useMemo(() => new Set(allowedModules), [allowedModules]);
  const apps = useMemo(() => listApps(), []);
  const previewApp =
    apps.find((a) => a.appId === previewAppId) ?? activeApp ?? apps[0];
  const previewUnlocked = previewApp ? isAppAllowed(previewApp, allowedSet) : false;

  // Right column = the previewed app's own pages (already gate-filtered upstream).
  const previewGroups = useMemo(
    () => (previewApp ? scopeGroupsToApp(visibleGroups, previewApp.appId) : []),
    [visibleGroups, previewApp],
  );

  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);

  // Roving focus between the two columns (radix Popover already traps focus + Esc).
  const moveWithin = (container: HTMLElement | null, from: HTMLElement, delta: number) => {
    if (!container) return;
    const btns = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button[data-nav-btn]"),
    );
    const idx = btns.indexOf(from as HTMLButtonElement);
    if (idx === -1) return;
    const next = btns[Math.min(Math.max(idx + delta, 0), btns.length - 1)];
    next?.focus();
  };
  const focusFirst = (container: HTMLElement | null) => {
    container?.querySelector<HTMLButtonElement>("button[data-nav-btn]")?.focus();
  };

  const handleLeftKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveWithin(leftRef.current, e.currentTarget, 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveWithin(leftRef.current, e.currentTarget, -1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      focusFirst(rightRef.current);
    }
  };
  const handleRightKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveWithin(rightRef.current, e.currentTarget, 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveWithin(rightRef.current, e.currentTarget, -1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      // Return to the currently previewed app row in the left column.
      leftRef.current
        ?.querySelector<HTMLButtonElement>(`button[data-app-id="${previewApp?.appId}"]`)
        ?.focus();
    }
  };

  const navigateTo = (href: string) => {
    onNavigate(href);
    setOpen(false);
  };
  const selectApp = (app: AppDescriptor) => {
    if (isAppAllowed(app, allowedSet)) onSelectApp(app);
    else onUpgrade(app);
    setOpen(false);
  };

  // The waffle trigger. On mobile it opens the full-screen overlay directly (no Popover);
  // on desktop it toggles this Popover (radix handles the click via asChild).
  const trigger = (
    <AppLauncherButton
      activeApp={activeApp}
      onOpen={isMobile ? onOpenAllApps : () => {}}
      className={className}
    />
  );

  if (isMobile) return trigger;

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setPreviewAppId(activeApp?.appId); // reset preview to the active app on open
      }}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        className="w-[560px] max-w-[calc(100vw-1rem)] overflow-hidden p-0"
      >
        <div className="flex max-h-[min(72vh,560px)]">
          {/* ── Left column — the app list ─────────────────────────────────── */}
          <div
            ref={leftRef}
            role="menu"
            aria-label={t("nav.app.launcher")}
            className="w-[212px] shrink-0 overflow-y-auto border-r border-border bg-muted/20 p-1.5"
          >
            {apps.map((app) => {
              const Icon = app.icon;
              const unlocked = isAppAllowed(app, allowedSet);
              const isActive = app.appId === activeApp?.appId;
              const isPreview = app.appId === previewApp?.appId;
              return (
                <button
                  key={app.appId}
                  type="button"
                  role="menuitem"
                  data-nav-btn
                  data-app-id={app.appId}
                  onMouseEnter={() => setPreviewAppId(app.appId)}
                  onFocus={() => setPreviewAppId(app.appId)}
                  onClick={() => selectApp(app)}
                  onKeyDown={handleLeftKeyDown}
                  aria-current={isActive ? "true" : undefined}
                  title={t(app.blurbKey)}
                  className={cn(
                    "group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isPreview ? "bg-accent" : "hover:bg-accent/60",
                    isActive ? "text-foreground" : "text-foreground/90",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
                      unlocked
                        ? "bg-primary/10 text-primary"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {t(app.labelKey)}
                  </span>
                  {isActive ? (
                    <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                  ) : !unlocked ? (
                    <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight
                      className={cn(
                        "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-opacity",
                        isPreview ? "opacity-100" : "opacity-0 group-hover:opacity-60",
                      )}
                    />
                  )}
                </button>
              );
            })}

            {/* Footer — the full-screen grid ("All apps ⊞") + first-run/catalog. */}
            <div className="mt-1.5 border-t border-border pt-1.5">
              <button
                type="button"
                onClick={() => {
                  onOpenAllApps();
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted">
                  <LayoutGrid className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">
                  {t("nav.app.allApps", "All apps")}
                </span>
              </button>
            </div>
          </div>

          {/* ── Right column — the previewed app's pages ───────────────────── */}
          <div ref={rightRef} className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              {previewApp && (
                <>
                  <previewApp.icon className="h-4 w-4 shrink-0 text-primary" />
                  <button
                    type="button"
                    onClick={() => previewApp && selectApp(previewApp)}
                    className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-foreground hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    title={t("nav.app.openApp", "Open app")}
                  >
                    {t(previewApp.labelKey)}
                  </button>
                </>
              )}
            </div>

            <div className="min-h-[220px] flex-1 overflow-y-auto p-1.5">
              {!previewUnlocked ? (
                // Locked app → upsell (its pages are license-hidden from visibleGroups).
                <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                    <Lock className="h-5 w-5" />
                  </span>
                  <p className="text-sm text-muted-foreground">
                    {previewApp ? t(previewApp.blurbKey) : null}
                  </p>
                  <button
                    type="button"
                    onClick={() => previewApp && selectApp(previewApp)}
                    className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t("nav.app.upgrade")}
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : previewGroups.length === 0 ? (
                <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
                  {t("nav.app.noPages", "No pages available in this app")}
                </div>
              ) : (
                previewGroups.map((group) => (
                  <div key={group.id} className="mb-1.5 last:mb-0">
                    <div className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
                      {t(group.label)}
                    </div>
                    <div className="space-y-0.5">
                      {group.items.map((item) => {
                        const active = isNavItemActive(item.href, currentPath);
                        return (
                          <button
                            key={item.href}
                            type="button"
                            data-nav-btn
                            onClick={() => navigateTo(item.href)}
                            onKeyDown={handleRightKeyDown}
                            aria-current={active ? "page" : undefined}
                            title={item.hint ? t(item.hint) : undefined}
                            className={cn(
                              "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
                              "hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                              active
                                ? "bg-accent font-medium text-primary"
                                : "text-foreground/90",
                            )}
                          >
                            <span
                              className={cn(
                                "shrink-0",
                                active ? "text-primary" : "text-muted-foreground",
                              )}
                            >
                              {item.icon}
                            </span>
                            <span className="min-w-0 flex-1 truncate">{t(item.label)}</span>
                            {item.badge != null && (
                              <span className="ml-auto shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                                {item.badge}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default AppLauncherDropdown;
