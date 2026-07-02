import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { getLoginUrl } from "@/const";
import { useIsMobile } from "@/hooks/useMobile";
import { Cpu, LogOut, PanelLeft, Key, User, Monitor, Search, Layers, Sparkles } from "lucide-react";
import { CascadingNav, MobileDrillNav } from "./CascadingNav";
import { BottomNav } from "./BottomNav";
import { CommandPalette } from "./CommandPalette";
import { MegaMenuOverlay } from "./MegaMenuOverlay";
import { NotificationCenter } from "./NotificationCenter";
import { AIActionInboxLauncher } from "./AIActionInbox";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { ThemeToggle } from "./ThemeToggle";
import { SiteSwitcher } from "./SiteSwitcher";
import { SiteHealthDot } from "./SiteHealthDot";
import { CSSProperties, Fragment, ReactNode, useEffect, useMemo, useState } from "react";
import { useLocation, Link } from "wouter";
import { DashboardLayoutSkeleton } from './DashboardLayoutSkeleton';
import { Button } from "./ui/button";
import { NavGroup, NavItem, getFilteredNavGroups, filterNavGroupsByMode, hasAdvancedContent, isBetaRoute } from "@/lib/navigation";
import { buildBreadcrumbs } from "@/lib/breadcrumbs";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { useNavMode } from "@/hooks/useNavMode";
import { BetaBanner } from "./BetaBadge";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { useLicenseModules } from "@/hooks/useLicenseModules";
import { LicenseEnforcementBanner } from "./LicenseEnforcementBanner";
import { PermissionExpiryBanner } from "./PermissionExpiryBanner";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { useSpcAlertToast } from "@/hooks/useSpcAlertToast";

type DashboardLayoutProps = {
  children: ReactNode;
  title?: string;
  navItems?: NavItem[];
  currentPath?: string;
};

// R4: desktop nav is an inline-accordion sidebar — modules expand their categories
// straight down (only the Level-3 page menu floats). A comfortable fixed width holds
// the module + category labels; the old resizable/persisted width no longer drives it.
const RAIL_WIDTH = 264;

export default function DashboardLayout({
  children,
  title = "AVI/AOI Management",
  navItems = [],
  currentPath,
}: DashboardLayoutProps) {
  const { loading, user } = useAuth();
  const { t } = useTranslation();

  // Persist the desktop rail's expanded/collapsed state ACROSS navigations. Each page
  // renders its own DashboardLayout, so the SidebarProvider remounts on every navigation;
  // shadcn only seeds from `defaultOpen` (never reads its cookie back), which reset the
  // rail to expanded on each page change. We control `open` from localStorage instead so
  // a collapsed rail stays collapsed when you switch pages.
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => {
    try { return localStorage.getItem("sidebar_open") !== "false"; } catch { return true; }
  });

  if (loading) {
    return <DashboardLayoutSkeleton />
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-8 p-8 max-w-md w-full">
          <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center glow-primary">
            <Cpu className="h-8 w-8 text-primary" />
          </div>
          <div className="flex flex-col items-center gap-4">
            <h1 className="text-2xl font-semibold tracking-tight text-center text-foreground">
              {t('auth.loginTitle')}
            </h1>
            <p className="text-sm text-muted-foreground text-center max-w-sm">
              {t('auth.systemDescription')}
            </p>
          </div>
          <Button
            onClick={() => {
              window.location.href = "/login";
            }}
            size="lg"
            className="w-full shadow-lg hover:shadow-xl transition-all"
          >
            {t('auth.login')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider
      open={sidebarOpen}
      onOpenChange={(o) => {
        setSidebarOpen(o);
        try { localStorage.setItem("sidebar_open", String(o)); } catch { /* storage unavailable */ }
      }}
      style={
        {
          // R1: desktop nav is a fixed-width icon rail.
          "--sidebar-width": `${RAIL_WIDTH}px`,
        } as CSSProperties
      }
    >
      <DashboardLayoutContent
        title={title}
        navItems={navItems}
        currentPath={currentPath}
      >
        {children}
      </DashboardLayoutContent>
    </SidebarProvider>
  );
}

type DashboardLayoutContentProps = {
  children: ReactNode;
  title: string;
  navItems: NavItem[];
  currentPath?: string;
};

function DashboardLayoutContent({
  children,
  title,
  navItems,
  currentPath,
}: DashboardLayoutContentProps) {
  const { user, logout } = useAuth();
  const { t } = useTranslation();
  const [location, setLocation] = useLocation();
  const { toggleSidebar, setOpenMobile } = useSidebar();
  const isMobile = useIsMobile();

  // Sprint 2c — global SPC violation toasts (works on every authenticated page)
  useSpcAlertToast();

  // Command palette (⌘/Ctrl+K) — M3 · Quick Browse mega-menu (⌘/Ctrl+\) — M4
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [megaOpen, setMegaOpen] = useState(false);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(o => !o);
      } else if (e.key === "\\") {
        e.preventDefault();
        setMegaOpen(o => !o);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // The current route (query string stripped) — used for the global breadcrumb row.
  const activePath = (currentPath || location).split("?")[0];

  // Global breadcrumbs (F2): one Module › Section › Page trail rendered from the
  // shell for every page. Hidden on root/landing routes where it is just noise.
  const breadcrumbs = useMemo(() => buildBreadcrumbs(activePath, t), [activePath, t]);
  const BREADCRUMB_HIDDEN_ROUTES = new Set<string>([
    "/",
    "/operator",
    "/maintenance-home",
    "/quality-home",
    "/supervisor-home",
    "/admin-home",
    "/viewer-home",
    "/command-center",
  ]);
  const showBreadcrumbs = breadcrumbs.length > 1 && !BREADCRUMB_HIDDEN_ROUTES.has(activePath);

  // Navigate helper — on mobile, also close the Sheet drawer after picking a page.
  const handleNavigate = (href: string) => {
    setLocation(href);
    if (isMobile) setOpenMobile(false);
  };

  // Permission-based filtering
  const { hasPermission, hasAnyCategoryPermission } = usePermissions();

  // License module gating - filter groups by allowed modules
  const { isNavGroupAllowed, isRouteAllowed: isLicenseRouteAllowed } = useLicenseModules();

  // doc 22 P4 — Simple vs Advanced menu mode (persisted; default per role).
  const { mode: navMode, toggleMode } = useNavMode(user?.role);

  // Filter groups based on user role + granular permissions + license modules.
  // `accessibleGroups` = everything this user COULD see; `visibleGroups` then also
  // applies the Simple/Advanced mode filter (Simple hides engineering-heavy surface).
  const accessibleGroups = getFilteredNavGroups(user?.role, hasPermission as any, hasAnyCategoryPermission as any)
    .filter(group => isNavGroupAllowed(group.id))
    .map(group => ({
      ...group,
      items: group.items.filter(item => isLicenseRouteAllowed(item.href)),
    }))
    .filter(group => group.items.length > 0);

  // Only offer the Advanced toggle when the user actually has advanced surface to reveal.
  const showModeToggle = hasAdvancedContent(accessibleGroups);
  const visibleGroups = filterNavGroupsByMode(accessibleGroups, navMode);

  return (
    <>
      <div className="relative" data-app-chrome="sidebar">
        <Sidebar
          // ICON rail: collapsing shrinks the rail to icons only. CascadingNav renders an
          // icon-only rail in the collapsed state (module icons + a hover flyout), so the
          // full-width rows no longer spill over the page content.
          collapsible="icon"
          className="border-r border-sidebar-border"
        >
          <SidebarHeader className="h-16 justify-center border-b border-sidebar-border">
            {isMobile ? (
              // Mobile sheet header: full logo + title.
              <div className="flex items-center gap-3 px-2 w-full">
                <Link href="/" className="flex items-center gap-2 min-w-0">
                  <div className="h-8 w-8 rounded-lg bg-primary/20 flex items-center justify-center shrink-0">
                    <Cpu className="h-4 w-4 text-primary" />
                  </div>
                  <span className="font-semibold tracking-tight truncate text-sidebar-foreground">
                    {title}
                  </span>
                </Link>
              </div>
            ) : (
              // Desktop sidebar header: logo + title, with the collapse toggle on the right.
              // When collapsed to the icon rail, only the logo shows (title + in-rail toggle
              // hidden — the header SidebarTrigger re-expands the rail).
              <div className="flex items-center gap-2 px-2 w-full group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:justify-center">
                <Link href="/" className="flex items-center gap-2 min-w-0">
                  <div className="h-8 w-8 rounded-lg bg-primary/20 flex items-center justify-center shrink-0">
                    <Cpu className="h-4 w-4 text-primary" />
                  </div>
                  <span className="font-semibold tracking-tight truncate text-sidebar-foreground group-data-[collapsible=icon]:hidden">
                    {title}
                  </span>
                </Link>
                <button
                  onClick={toggleSidebar}
                  className="ml-auto h-9 w-9 flex items-center justify-center hover:bg-sidebar-accent rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0 group-data-[collapsible=icon]:hidden"
                  aria-label="Toggle navigation"
                >
                  <PanelLeft className="h-4 w-4 text-sidebar-foreground" />
                </button>
              </div>
            )}
          </SidebarHeader>

          <SidebarContent className="gap-0 py-2 overflow-y-auto overflow-x-hidden">
            {isMobile && (
              // F2 — site/scope switcher at the top of the mobile Menu drawer so the
              // ecosystem scope is reachable on phones too. Degrades to a static label
              // for non-admins / single-site.
              <div className="px-3 pb-2">
                <SiteSwitcher variant="drawer" />
              </div>
            )}
            {isMobile ? (
              // Mobile (R1): tap-drill nav inside the Sheet drawer (hover unavailable).
              <MobileDrillNav
                groups={visibleGroups}
                currentPath={currentPath || location}
                onNavigate={handleNavigate}
              />
            ) : (
              // Desktop (R1): 3-level cascading Miller-column nav on a fixed icon rail.
              <CascadingNav
                groups={visibleGroups}
                currentPath={currentPath || location}
                onNavigate={handleNavigate}
              />
            )}
          </SidebarContent>

          <SidebarFooter className="p-3 border-t border-sidebar-border">
            {/* doc 22 P4 — Simple / Advanced menu toggle. Only shown when the user
                has advanced surface to reveal. Icon-only when the rail is collapsed. */}
            {showModeToggle && (
              <button
                type="button"
                onClick={toggleMode}
                aria-pressed={navMode === "advanced"}
                title={
                  navMode === "simple"
                    ? t("nav.showAdvanced", "Show advanced menu")
                    : t("nav.showSimple", "Simple menu")
                }
                className="mb-2 flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-sidebar-accent transition-colors w-full text-left group-data-[collapsible=icon]:justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {navMode === "simple" ? (
                  <Layers className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <Sparkles className="h-4 w-4 shrink-0 text-primary" />
                )}
                <span className="flex-1 min-w-0 text-sm text-sidebar-foreground group-data-[collapsible=icon]:hidden">
                  {navMode === "simple"
                    ? t("nav.showAdvanced", "Show advanced menu")
                    : t("nav.showSimple", "Simple menu")}
                </span>
                <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground group-data-[collapsible=icon]:hidden">
                  {navMode === "simple"
                    ? t("nav.modeSimple", "Simple")
                    : t("nav.modeAdvanced", "Advanced")}
                </span>
              </button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-sidebar-accent transition-colors w-full text-left group-data-[collapsible=icon]:justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Avatar className="h-9 w-9 border border-sidebar-border shrink-0">
                    <AvatarFallback className="text-xs font-medium bg-primary/10 text-primary">
                      {user?.name?.charAt(0).toUpperCase() || 'U'}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                    <p className="text-sm font-medium truncate leading-none text-sidebar-foreground">
                      {user?.name || "User"}
                    </p>
                    <p className="text-xs text-muted-foreground truncate mt-1.5">
                      {user?.email || "-"}
                    </p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem
                  onClick={() => window.location.href = "/profile"}
                  className="cursor-pointer"
                >
                  <User className="mr-2 h-4 w-4" />
                  <span>{t('auth.personalInfo')}</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => window.location.href = "/change-password"}
                  className="cursor-pointer"
                >
                  <Key className="mr-2 h-4 w-4" />
                  <span>{t('auth.changePassword')}</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => window.location.href = "/sessions"}
                  className="cursor-pointer"
                >
                  <Monitor className="mr-2 h-4 w-4" />
                  <span>{t('session.title')}</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={logout}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>{t('auth.logout')}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>
        {/* R1: resize handle removed — the desktop nav is now a fixed-width icon rail. */}
      </div>

      <SidebarInset className="bg-background">
        {/* F2 (doc 23 §5) — restructured context bar:
            [trigger] · Site/Scope switcher · WIDE global ⌘K search (center, widest) ·
            alerts (AI inbox + notifications) · site-health dot · theme/lang. Kiosk
            mode hides the whole bar via [data-app-chrome="header"]. */}
        <div data-app-chrome="header" className="flex border-b border-border h-14 items-center gap-2 sm:gap-3 bg-card/95 px-2 sm:px-3 backdrop-blur supports-backdrop-filter:backdrop-blur sticky top-0 z-40">
          {/* Left — sidebar toggle + site/scope switcher. The toggle opens the mobile
              sheet / re-opens the collapsed desktop rail. */}
          <SidebarTrigger className="h-9 w-9 rounded-lg shrink-0" />
          <div className="hidden sm:block shrink-0">
            <SiteSwitcher variant="header" />
          </div>

          {/* Center — primary/wide global search that opens the command palette (⌘K).
              This is the widest element in the bar. */}
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label={t("nav.searchPlaceholder")}
            className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 text-muted-foreground transition-colors hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Search className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-left text-sm">{t("nav.searchPlaceholder")}</span>
            <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-border bg-background px-1.5 font-mono text-[10px] text-muted-foreground">
              ⌘K
            </kbd>
          </button>

          {/* Right — alerts · site-health dot · theme/lang. */}
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            <AIActionInboxLauncher />
            <NotificationCenter />
            <SiteHealthDot />
            <ThemeToggle />
            <LanguageSwitcher />
          </div>
        </div>
        {showBreadcrumbs && (
          // F2 — slim global breadcrumb row rendered ONCE from the shell (covers all
          // pages without editing each PageHeader). Query strings are stripped.
          <div className="border-b border-border bg-card/60 px-3 py-1.5 sm:px-4">
            <Breadcrumb>
              <BreadcrumbList>
                {breadcrumbs.map((crumb, i) => {
                  const isLast = i === breadcrumbs.length - 1;
                  return (
                    <Fragment key={`${crumb.label}-${i}`}>
                      <BreadcrumbItem>
                        {isLast || crumb.href == null ? (
                          <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                        ) : (
                          <BreadcrumbLink asChild>
                            <Link href={crumb.href}>{crumb.label}</Link>
                          </BreadcrumbLink>
                        )}
                      </BreadcrumbItem>
                      {!isLast && <BreadcrumbSeparator />}
                    </Fragment>
                  );
                })}
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        )}
        <PermissionExpiryBanner />
        <LicenseEnforcementBanner />
        {/* E: pad the bottom on mobile so content clears the fixed Bottom Navigation bar. */}
        <main className={cn("flex-1 p-3 sm:p-4 md:p-6 overflow-auto", isMobile && "pb-20")}>
          {/* doc 22 P4 — one-line "Beta / needs setup" banner on framework/flag-gated
              routes so first-time users don't expect live data. Driven by the nav flag. */}
          {isBetaRoute(currentPath || location) && <BetaBanner />}
          {children}
        </main>
      </SidebarInset>
      {/* E — Material 3 Bottom Navigation (phones only). "Menu" opens the full drawer. */}
      {isMobile && (
        <BottomNav
          groups={visibleGroups}
          currentPath={currentPath || location}
          onNavigate={handleNavigate}
          onOpenMenu={() => setOpenMobile(true)}
          role={user?.role}
        />
      )}
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        groups={visibleGroups}
        onNavigate={href => {
          setLocation(href);
          setPaletteOpen(false);
        }}
      />
      <MegaMenuOverlay
        open={megaOpen}
        onOpenChange={setMegaOpen}
        groups={visibleGroups}
        onNavigate={href => {
          setLocation(href);
          setMegaOpen(false);
        }}
      />
      {/* C3a — AILocalChatBubble moved to App root (mounted once globally).
          Removed from here to avoid a duplicate bubble on pages using this layout. */}
    </>
  );
}
