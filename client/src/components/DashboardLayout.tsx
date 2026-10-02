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
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { getLoginUrl } from "@/const";
import { useIsMobile, useIsTablet } from "@/hooks/useMobile";
import { Cpu, LogOut, PanelLeft, Key, User, Monitor, Search, Layers, Sparkles, LayoutGrid } from "lucide-react";
import { CascadingNav, MobileDrillNav } from "./CascadingNav";
import { BottomNav } from "./BottomNav";
import { CommandPalette } from "./CommandPalette";
import { SidebarQuickAccess } from "./SidebarQuickAccess";
import { pushRecentHref } from "@/lib/navRecent";
import { AppLauncherButton } from "./AppLauncherButton";
import { AppLauncherOverlay } from "./AppLauncherOverlay";
import { NotificationCenter } from "./NotificationCenter";
import { AIActionInboxLauncher } from "./AIActionInbox";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { ThemeToggle } from "./ThemeToggle";
import { SiteSwitcher } from "./SiteSwitcher";
import { SiteHealthDot } from "./SiteHealthDot";
// doc 63 (AUD-01/G8) — shell-level freshness surface, flag-gated (HMI_ISA101_V2).
import { FreshnessStrip } from "./FreshnessStrip";
// doc 63 (FLW-01/G1) — shell alert chip: ack+resolve andon từ mọi trang, ≤3 chạm.
import { ShellAlertChip } from "./ShellAlertChip";
// doc 64 IA-10 — trục phạm vi ISA-95 + chip bất biến trung thực.
import { AssetScopeBar, ScopeStatusChip } from "./AssetScopeBar";
import { useAssetScope } from "@/contexts/AssetScopeContext";
import { isIsa101V2 } from "@/lib/hmiFlags";
import { CSSProperties, Fragment, ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useLocation, useSearch, Link } from "wouter";
import { DashboardLayoutSkeleton } from './DashboardLayoutSkeleton';
import { Button } from "./ui/button";
import { NavGroup, NavItem, getFilteredNavGroups, getSearchNavGroups, hasAdvancedContent, isBetaRoute } from "@/lib/navigation";
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
import { useAppLauncherMode } from "@/hooks/useAppLauncherMode";
import { useActiveApp } from "@/hooks/useActiveApp";
import { scopeGroupsToApp, listApps, type AppDescriptor } from "@/lib/apps";
import { betaNoticeItem } from "./BetaBadge";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { useLicenseModules } from "@/hooks/useLicenseModules";
import { LicenseCriticalBar, LicenseCriticalChip, licenseWarningNoticeItem, useLicenseNotice } from "./LicenseEnforcementBanner";
import { permissionExpiryNoticeItem, usePermissionExpiryNotice } from "./PermissionExpiryBanner";
import { NoticeStack } from "@/components/patterns/NoticeChip";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { useSpcAlertToast } from "@/hooks/useSpcAlertToast";
// doc 81 Đợt 2 Task 2 — shell: một breadcrumb trong top bar, một chỗ đệm, biến thể full-bleed,
// rail workbench nhớ theo người dùng, Đơn giản không trống, banner → chip, một lối vào AI.
import { ShellPageContext, type ShellPageContextValue, type ShellPageVariant } from "@/lib/shellPage";
import { readSidebarOpen, writeSidebarOpen } from "@/lib/sidebarPref";
import { resolveSidebarGroups } from "@/lib/sidebarGroups";
import { ShellAiButton } from "./ShellAiButton";
import type { Breadcrumb as Crumb } from "@/lib/breadcrumbs";

/** doc 81 Đợt 2 Task 2 (M2) — viewport < 1920 px (đo: top bar 1102 px @1366 rail mở, 1552 px @1600 rail
 *  thu gọn): chip thông báo thường gộp vào "+N" để breadcrumb giữ ≥160 px. matchMedia (theo dõi đổi). */
const HEADER_NARROW_QUERY = "(max-width: 1919px)";
function useHeaderNarrow(): boolean {
  const [narrow, setNarrow] = useState<boolean>(() => {
    try { return window.matchMedia(HEADER_NARROW_QUERY).matches; } catch { return false; }
  });
  useEffect(() => {
    let mql: MediaQueryList;
    try { mql = window.matchMedia(HEADER_NARROW_QUERY); } catch { return; }
    const on = () => setNarrow(mql.matches);
    mql.addEventListener("change", on);
    on();
    return () => mql.removeEventListener("change", on);
  }, []);
  return narrow;
}

/** Viewport hẹp hơn `px` (theo `innerWidth`, cập nhật khi resize) — cùng cách đọc với `useIsTablet`. */
function useViewportBelow(px: number): boolean {
  const [below, setBelow] = useState<boolean>(() => typeof window !== "undefined" && window.innerWidth < px);
  useEffect(() => {
    const on = () => setBelow(window.innerWidth < px);
    window.addEventListener("resize", on);
    on();
    return () => window.removeEventListener("resize", on);
  }, [px]);
  return below;
}

type DashboardLayoutProps = {
  children: ReactNode;
  title?: string;
  navItems?: NavItem[];
  currentPath?: string;
  /**
   * doc 39 Wave 1b — when true, THIS instance is the single persistent shell hoisted
   * above the router (rendered by App under the APP_SHELL_PERSISTENT flag). It renders
   * the full chrome ONCE and marks the subtree via InShellContext so every page's own
   * <DashboardLayout> collapses to a passthrough (no remount of the sidebar on nav).
   */
  asShell?: boolean;
};

/**
 * doc 39 Wave 1b — true inside the persistent app-shell. When a page renders its own
 * <DashboardLayout> while this is true, that layout becomes a passthrough (renders just
 * its children) so the chrome isn't duplicated/remounted. Default false = legacy behavior
 * (every page owns its layout), so nothing changes until the shell is hoisted.
 */
export const InShellContext = createContext<boolean>(false);

// R4: desktop nav is an inline-accordion sidebar — modules expand their categories
// straight down (only the Level-3 page menu floats). A comfortable fixed width holds
// the module + category labels; the old resizable/persisted width no longer drives it.
const RAIL_WIDTH = 264;

export default function DashboardLayout({
  children,
  title = "SYNAPSE",
  navItems = [],
  currentPath,
  asShell = false,
}: DashboardLayoutProps) {
  const { loading, user } = useAuth();
  const { t } = useTranslation();

  // doc 39 Wave 1b — passthrough: if we're already inside the persistent shell and this
  // is NOT that shell (i.e. a page rendered its own <DashboardLayout>), render only the
  // page content. The hoisted shell owns the chrome + the loading/auth guards below.
  const inShell = useContext(InShellContext);
  if (inShell && !asShell) {
    return <>{children}</>;
  }

  // Persist the desktop rail's expanded/collapsed state ACROSS navigations. Each page
  // renders its own DashboardLayout, so the SidebarProvider remounts on every navigation;
  // shadcn only seeds from `defaultOpen` (never reads its cookie back), which reset the
  // rail to expanded on each page change. We control `open` from localStorage instead so
  // a collapsed rail stays collapsed when you switch pages.
  const [desktopOpen, setDesktopOpen] = useState<boolean>(() => readSidebarOpen({ workbench: false, userId: user?.id }));

  // doc 81 Đợt 2 Task 2 — biến thể trang do TRANG khai (`useShellPageVariant`). "workbench" và
  // "full-bleed" = màn soạn thảo: rail mặc định THU GỌN; lựa chọn mở rộng nhớ theo NGƯỜI DÙNG ở khoá
  // riêng (không đè `sidebar_open` của màn thường). "full-bleed" thêm: <main> không đệm.
  const [pageVariant, setPageVariant] = useState<ShellPageVariant>("default");
  const registerVariant = useCallback((v: ShellPageVariant) => {
    setPageVariant(v);
    return () => setPageVariant("default");
  }, []);
  const shellPage = useMemo<ShellPageContextValue>(() => ({ inShellMain: true, registerVariant }), [registerVariant]);
  const workbench = pageVariant !== "default";
  const [workbenchOpen, setWorkbenchOpen] = useState<boolean>(() => readSidebarOpen({ workbench: true, userId: user?.id }));
  useEffect(() => {
    setWorkbenchOpen(readSidebarOpen({ workbench: true, userId: user?.id }));
  }, [user?.id]);

  // B10 (doc 46 FE-W1) — on the tablet band (768–1023px) the full 264px rail would
  // overflow the viewport and clip page content, so the rail auto-collapses to the icon
  // rail there. Tablet collapse is ephemeral state (default collapsed) that never clobbers
  // the persisted DESKTOP preference — resizing back to ≥1024px restores what you last set.
  const isTablet = useIsTablet();
  const [tabletOpen, setTabletOpen] = useState<boolean>(false);
  const sidebarOpen = isTablet ? tabletOpen : workbench ? workbenchOpen : desktopOpen;
  const handleSidebarOpenChange = (o: boolean) => {
    if (isTablet) {
      setTabletOpen(o);
    } else if (workbench) {
      setWorkbenchOpen(o);
      writeSidebarOpen(o, { workbench: true, userId: user?.id });
    } else {
      setDesktopOpen(o);
      writeSidebarOpen(o, { workbench: false, userId: user?.id });
    }
  };

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

  const shell = (
    <SidebarProvider
      open={sidebarOpen}
      onOpenChange={handleSidebarOpenChange}
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
        pageVariant={pageVariant}
        shellPage={shellPage}
      >
        {children}
      </DashboardLayoutContent>
    </SidebarProvider>
  );

  // doc 39 Wave 1b — when this is the hoisted shell, mark the whole subtree so every
  // page's own <DashboardLayout> becomes a passthrough (see the guard at the top).
  return asShell ? (
    <InShellContext.Provider value={true}>{shell}</InShellContext.Provider>
  ) : (
    shell
  );
}

type DashboardLayoutContentProps = {
  children: ReactNode;
  title: string;
  navItems: NavItem[];
  currentPath?: string;
  pageVariant: ShellPageVariant;
  shellPage: ShellPageContextValue;
};

/**
 * doc 81 Đợt 2 Task 2 — breadcrumb DUY NHẤT của app, nằm trong top bar (trước đây là một hàng riêng
 * ~33 px dưới top bar, cộng thêm hàng thứ hai trong PageHeader của 16 trang). Một dòng, không xuống
 * dòng; nhãn dài bị cắt (title giữ đủ chữ).
 */
function ShellBreadcrumb({ crumbs, inHeader }: { crumbs: Crumb[]; inHeader: boolean }) {
  return (
    <Breadcrumb className={cn("min-w-0", inHeader && "overflow-hidden")}>
      <BreadcrumbList className={cn(inHeader && "flex-nowrap gap-1 sm:gap-1.5")}>
        {crumbs.map((crumb, i) => {
          const isLast = i === crumbs.length - 1;
          // Trong top bar hẹp (< 100rem bề rộng TOP BAR, container query `topbar`): mục giữa (section, chữ thuần — không phải link) ẩn để nhường chỗ
          // cho mục cha có link (module) và trang hiện tại; trang hiện tại co ít nhất.
          const middleText = inHeader && !isLast && i > 0 && crumb.href == null;
          return (
            <Fragment key={`${crumb.label}-${i}`}>
              <BreadcrumbItem
                className={cn(
                  inHeader && "min-w-0",
                  inHeader && (isLast ? "shrink-[0.3]" : "max-w-[9rem] shrink"),
                  middleText && "hidden @min-[100rem]/topbar:inline-flex",
                )}
              >
                {isLast || crumb.href == null ? (
                  <BreadcrumbPage className={cn(inHeader && "block truncate leading-10")} title={crumb.label}>{crumb.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link href={crumb.href} className={cn(inHeader && "block truncate leading-10")} title={crumb.label}>{crumb.label}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {!isLast && <BreadcrumbSeparator className={cn(middleText && "hidden @min-[100rem]/topbar:list-item")} />}
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

function DashboardLayoutContent({
  children,
  title,
  navItems,
  currentPath,
  pageVariant,
  shellPage,
}: DashboardLayoutContentProps) {
  const { user, logout } = useAuth();
  const { t } = useTranslation();
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const { toggleSidebar, setOpenMobile } = useSidebar();
  const isMobile = useIsMobile();

  // doc 36 follow-up — the nav needs the LIVE path WITH ?search so `?tab=` deep-links
  // highlight correctly (wouter's useLocation drops the query). Pages rarely pass a
  // currentPath with a query, so fall back to location+search.
  const navActivePath =
    currentPath ?? `${location}${search ? `?${search}` : ""}`;

  // Sprint 2c — global SPC violation toasts (works on every authenticated page)
  useSpcAlertToast();

  // doc 81 Đợt 2 Task 2 — thông báo shell: điều kiện cũ ở hook của từng banner (một đường).
  // R-2-i: license nghiêm trọng KHÔNG vào NoticeStack (không bao giờ gộp/cắt) — chip đỏ đặc / thanh.
  const permNotice = usePermissionExpiryNotice();
  const licNotice = useLicenseNotice();
  const headerNarrow = useHeaderNarrow();
  // Dưới xl (1280 px: điện thoại, tablet, và 1024–1279 với rail mở ⇒ top bar chỉ 760 px — đo fix 1 ở
  // 375/414/800/1024) top bar không đủ chỗ cho chip đỏ đặc ⇒ mọi trạng thái nghiêm trọng thành THANH.
  const compactLicense = useViewportBelow(1280);
  const licCritical = !compactLicense && (licNotice.mode === "readonly" || licNotice.mode === "serverDown");

  // Command palette (⌘/Ctrl+K) — the single omni-search across all apps.
  // (doc 39 menu-audit M2: the hidden ⌘\ Mega Menu was removed — it was undiscoverable,
  //  duplicated the sidebar + palette, and had a ?tab= active-state bug.)
  const [paletteOpen, setPaletteOpen] = useState(false);

  // doc 36 — App Launcher (Phương án A) is the DEFAULT menu; users can switch to the
  // classic 9-group sidebar via the user menu (persisted, reactive).
  const { launcherOn, toggleLauncher } = useAppLauncherMode();
  const activeApp = useActiveApp(currentPath);
  const [launcherOpen, setLauncherOpen] = useState(false);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // ★ 2026-08-31 · PDCA vòng 1 (T11) — NHƯỜNG bề mặt đã nhận phím: một trang "editor surface"
      // (vd /ai-coding-workspace: Ctrl+K = sửa-đoạn-chọn kiểu Cursor) preventDefault ở pha capture;
      // toggle palette đè lên nó là hai handler tranh một phím — đo thật: dialog mở, focus nuốt
      // selection (86→0) trước khi handler trang kịp đọc. Lớp CHÍNH của bản vá là capture+
      // stopPropagation ở trang (sự kiện thường không tới được đây); dòng này là lớp ĐỘC LẬP thứ
      // hai cho mọi thứ tự listener khác — hai lớp phải cùng chặn, không che nhau.
      if (e.defaultPrevented) return;
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(o => !o);
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
  // doc 81 Đợt 2 Task 2 — breadcrumb nằm trong top bar từ 768 px; điện thoại: một hàng dưới top bar.
  const crumbInHeader = showBreadcrumbs && !isMobile;

  // Navigate helper — on mobile, also close the Sheet drawer after picking a page.
  const handleNavigate = (href: string) => {
    pushRecentHref(href); // doc 60 B — feed the sidebar QuickAccess "Recent" list
    setLocation(href);
    if (isMobile) setOpenMobile(false);
  };

  // Permission-based filtering
  const { hasPermission, hasAnyCategoryPermission } = usePermissions();

  // License module gating - filter groups by allowed modules
  const { isNavGroupAllowed, isRouteAllowed: isLicenseRouteAllowed, allowedModules } = useLicenseModules();

  // doc 22 P4 — Simple vs Advanced menu mode (persisted; default per role).
  const { mode: navMode, toggleMode } = useNavMode(user?.role);
  // doc 64 IA-10 S3 — trục có selection? (cho hàng chip standalone khi breadcrumb ẩn).
  const { axis: assetAxis } = useAssetScope();
  const hasAssetAxis =
    assetAxis.factoryId !== undefined || assetAxis.lineId !== undefined || assetAxis.machineId !== undefined;

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

  // doc 36 W1 — in launcher mode the SIDEBAR shows only the active app's items (items follow
  // their owning module's app, reorganising across the old groups). Search (⌘K) still spans
  // ALL accessible apps. When the flag is OFF, everything behaves exactly as before.
  // doc 81 Đợt 2 Task 2 — chế độ Đơn giản KHÔNG được để thanh bên trống (supervisor ở app Kỹ thuật):
  // rỗng ⇒ hiện danh sách đầy đủ của cùng phạm vi (đã lọc vai/quyền/giấy phép) + ghi chú.
  const { visible: visibleGroups, sidebar: sidebarGroups, simpleFallback } = resolveSidebarGroups({
    accessible: accessibleGroups,
    mode: navMode,
    launcherOn,
    appId: activeApp.appId,
  });
  // doc 63 (AUD-05 / IA-09) — ⌘K searches the UNCOLLAPSED accessible set (incl. the 28
  // rows folded into hubs), so a page hidden from the rail is still findable by name.
  // Same license/nav-group filtering as the sidebar, minus the hub-collapse step.
  const searchAccessibleGroups = getSearchNavGroups(user?.role, hasPermission as any, hasAnyCategoryPermission as any)
    .filter(group => isNavGroupAllowed(group.id))
    .map(group => ({
      ...group,
      items: group.items.filter(item => isLicenseRouteAllowed(item.href)),
    }))
    .filter(group => group.items.length > 0);
  const searchGroups = searchAccessibleGroups;

  // doc 40 Lan — RBAC cho App Launcher: một app "truy cập được" khi là core, HOẶC còn ≥1
  // item hiển thị sau khi lọc role/permission/license (accessibleGroups). Tile không truy
  // cập được sẽ hiện khoá (không phải upsell license).
  const accessibleAppIds = useMemo(() => {
    const ids = new Set<string>();
    for (const app of listApps()) {
      if (app.kind === "core" || scopeGroupsToApp(accessibleGroups, app.appId).length > 0) {
        ids.add(app.appId);
      }
    }
    return ids;
  }, [accessibleGroups]);
  const canAccessApp = (app: AppDescriptor) => accessibleAppIds.has(app.appId);

  const openApp = (href: string) => {
    setLocation(href);
    setLauncherOpen(false);
    if (isMobile) setOpenMobile(false);
  };

  // In launcher mode the sidebar header names the current APP (not the product).
  const headerTitle = launcherOn ? t(activeApp.labelKey) : title;

  return (
    <>
      {/* doc 39 Wave 6 (a11y) — skip-to-content link: first focusable element, visually
          hidden until focused, jumps keyboard users past the nav straight to the page. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t("nav.skipToContent", "Skip to content")}
      </a>
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
                <Link href="/" className="flex min-h-10 items-center gap-2 min-w-0">
                  <div className="h-8 w-8 rounded-lg bg-primary/20 flex items-center justify-center shrink-0">
                    <Cpu className="h-4 w-4 text-primary" />
                  </div>
                  <span className="font-semibold tracking-tight truncate text-sidebar-foreground">
                    {headerTitle}
                  </span>
                </Link>
              </div>
            ) : (
              // Desktop sidebar header: logo + title, with the collapse toggle on the right.
              // When collapsed to the icon rail, only the logo shows (title + in-rail toggle
              // hidden — the header SidebarTrigger re-expands the rail).
              <div className="flex items-center gap-2 px-2 w-full group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:justify-center">
                <Link href="/" className="flex min-h-10 items-center gap-2 min-w-0">
                  <div className="h-8 w-8 rounded-lg bg-primary/20 flex items-center justify-center shrink-0">
                    <Cpu className="h-4 w-4 text-primary" />
                  </div>
                  <span className="font-semibold tracking-tight truncate text-sidebar-foreground group-data-[collapsible=icon]:hidden">
                    {headerTitle}
                  </span>
                </Link>
                <button
                  onClick={toggleSidebar}
                  className="ml-auto h-10 w-10 flex items-center justify-center hover:bg-sidebar-accent rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0 group-data-[collapsible=icon]:hidden"
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
                {/* doc 81 Đợt 2 Task 2 (fix 1, đo 375/414 px) — top bar điện thoại không đủ chỗ: giao
                    diện sáng/tối + ngôn ngữ dời vào ngăn menu (trước đây bị đẩy ra ngoài mép phải). */}
                <div className="mt-2 flex items-center gap-2" data-shell-mobile-prefs="">
                  <ThemeToggle />
                  <LanguageSwitcher />
                </div>
              </div>
            )}
            {/* doc 60 B — Favorites + Recent pinned above the nav (1-click to frequent pages). */}
            {/* doc 67 W4 [P1] — landmark <nav> có aria-label: Quick-access + nav chính là 2
                vùng điều hướng riêng, SR phân biệt được (cả 2 component gốc chỉ render div). */}
            <nav aria-label={t("nav.quickLinksLabel", "Liên kết nhanh")}>
              <SidebarQuickAccess onNavigate={handleNavigate} />
            </nav>
            {simpleFallback && (
              <p
                data-nav-simple-fallback=""
                className="px-3 pb-1 pt-1 text-[11px] leading-snug text-muted-foreground group-data-[collapsible=icon]:hidden"
              >
                {t("shell.nav.simpleFallback", "Menu đơn giản không có mục ở đây — đang hiện menu đầy đủ.")}
              </p>
            )}
            <nav aria-label={t("nav.primaryNavLabel", "Điều hướng chính")}>
              {isMobile ? (
                // Mobile (R1): tap-drill nav inside the Sheet drawer (hover unavailable).
                <MobileDrillNav
                  groups={sidebarGroups}
                  currentPath={navActivePath}
                  onNavigate={handleNavigate}
                />
              ) : (
                // Desktop (R1): 3-level cascading Miller-column nav on a fixed icon rail.
                <CascadingNav
                  groups={sidebarGroups}
                  currentPath={navActivePath}
                  onNavigate={handleNavigate}
                />
              )}
            </nav>
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
                className="mb-2 flex min-h-10 items-center gap-3 rounded-lg px-2 py-2 hover:bg-sidebar-accent transition-colors w-full text-left group-data-[collapsible=icon]:justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                  onClick={() => handleNavigate("/profile")}
                  className="cursor-pointer"
                >
                  <User className="mr-2 h-4 w-4" />
                  <span>{t('auth.personalInfo')}</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleNavigate("/change-password")}
                  className="cursor-pointer"
                >
                  <Key className="mr-2 h-4 w-4" />
                  <span>{t('auth.changePassword')}</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleNavigate("/sessions")}
                  className="cursor-pointer"
                >
                  <Monitor className="mr-2 h-4 w-4" />
                  <span>{t('session.title')}</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {/* doc 36 — switch between the App Launcher (default) and the classic
                    9-group sidebar. Persisted; existing users can fall back if needed. */}
                <DropdownMenuItem onClick={toggleLauncher} className="cursor-pointer">
                  {launcherOn ? (
                    <PanelLeft className="mr-2 h-4 w-4" />
                  ) : (
                    <LayoutGrid className="mr-2 h-4 w-4" />
                  )}
                  <span>
                    {launcherOn
                      ? t("nav.app.classicMenu", "Menu cổ điển")
                      : t("nav.app.launcherMenu", "Menu ứng dụng")}
                  </span>
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

      {/* doc 67 W4 [P1] — landmark: shadcn SidebarInset render <main>, tạo landmark <main>
          THỨ HAI bọc cả topbar lẫn main#main-content (main lồng main — sai WAI-ARIA). Thay
          bằng <div> cùng class (variant mặc định nên các rule peer-data-[variant=inset]
          không áp) để main#main-content bên dưới là <main> DUY NHẤT của shell.
          min-w-0 [P0]: cột nội dung là flex-item của SidebarProvider — phải co được, không
          để topbar chật đẩy scrollWidth vượt viewport 1280 (đo thực tế 1423/1341). */}
      <div data-slot="sidebar-inset" className="relative flex w-full min-w-0 flex-1 flex-col bg-background">
        {/* F2 (doc 23 §5) — restructured context bar:
            [trigger] · Site/Scope switcher · WIDE global ⌘K search (center, widest) ·
            alerts (AI inbox + notifications) · site-health dot · theme/lang. Kiosk
            mode hides the whole bar via [data-app-chrome="header"]. */}
        {/* doc 67 W4 [P1] — <header> landmark thay div (vùng chrome đầu trang); giữ nguyên
            data-app-chrome="header" nên CSS kiosk-mode không đổi. min-w-0 để hàng co thật. */}
        <header data-app-chrome="header" className="@container/topbar flex border-b border-border h-14 min-w-0 items-center gap-1 sm:gap-2 lg:gap-3 bg-card/95 px-2 sm:px-3 backdrop-blur supports-backdrop-filter:backdrop-blur sticky top-0 z-40">
          {/* Left — sidebar toggle + site/scope switcher. The toggle opens the mobile
              sheet / re-opens the collapsed desktop rail. */}
          <SidebarTrigger className="h-10 w-10 rounded-lg shrink-0" />
          {/* doc 40 — App Launcher trigger (top-shell): waffle opens a two-column DROPDOWN
              (app list + that app's pages) so a cross-app jump is 2 clicks with no landing
              detour. Mobile falls back to the full-screen overlay. "All apps ⊞" inside the
              dropdown still opens the overlay (first-run / full catalog). */}
          {/* Điện thoại: BottomNav "Menu" đã mở App Launcher ⇒ không lặp nút lưới trong top bar. */}
          {launcherOn && !isMobile && (
            // doc 40 fix — the waffle opens the full-screen app grid (app-SWITCHER).
            // The reverted two-column dropdown was replacing the LEFT sidebar's role;
            // the left menu is the primary within-app nav (see CascadingNav inline expand).
            <AppLauncherButton
              activeApp={activeApp}
              onOpen={() => setLauncherOpen(true)}
              className="shrink-0"
            />
          )}
          <div className="hidden sm:block shrink-0">
            <SiteSwitcher variant="header" />
          </div>

          {/* doc 81 Đợt 2 Task 2 — breadcrumb DUY NHẤT + chip thông báo shell nằm TRONG top bar
              (trước đây: hàng breadcrumb riêng + dải banner quyền/license/Beta đẩy tiêu đề trang
              xuống 205–259 px). Cụm này co giãn (flex-1); breadcrumb tự cắt chữ. */}
          <div
            data-shell-context=""
            data-shell-crumb={crumbInHeader ? "" : undefined}
            className={cn("flex min-w-0 flex-1 items-center", crumbInHeader && !licCritical && "xl:min-w-40")}
          >
            {/* M2: breadcrumb giữ ≥160 px từ lg (chip thường gộp "+N" trước); chỉ khi có chip license
                nghiêm trọng (R-2-i, không bao giờ cắt) thì breadcrumb nhường trước. */}
            {crumbInHeader && <ShellBreadcrumb crumbs={breadcrumbs} inHeader />}
          </div>
          {/* Chip thông báo + chip license nghiêm trọng + chip phạm vi: nhóm KHÔNG co (không bị đè
              hay cắt); breadcrumb bên trái là phần co trước. */}
          <div className="flex shrink-0 items-center gap-1" data-shell-notices="">
            <NoticeStack
              className="shrink-0"
              maxVisible={headerNarrow ? 0 : 3}
              items={[
                permissionExpiryNoticeItem(permNotice, t),
                licenseWarningNoticeItem(licNotice, t),
                // doc 22 P4 — "Beta / needs setup" trên route có cờ beta, nay là chip + popover.
                isBetaRoute(currentPath || location) && betaNoticeItem(t),
              ]}
            />
            {!compactLicense && <LicenseCriticalChip notice={licNotice} />}
            {/* doc 64 IA-10 S0.4/S3 — bất biến trung thực: chip phạm vi khi có breadcrumb, hoặc khi
                route ẩn breadcrumb mà trục có selection (điều kiện cũ của hai hàng gộp lại). */}
            {isIsa101V2() && (showBreadcrumbs || hasAssetAxis) && <ScopeStatusChip className="shrink-0" />}
          </div>

          {/* Global search that opens the command palette (⌘K) — the breadcrumb now owns the
              flexible middle of the bar, so search is an icon until the TOP BAR itself is ≥100rem
              (container query `topbar`; đo fix 1: ở 1600 px viewport top bar chỉ 1552 px). */}
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label={t("nav.searchPlaceholder")}
            className="flex h-10 w-10 shrink-0 items-center gap-2 overflow-hidden rounded-lg border border-border bg-muted/40 px-3 text-muted-foreground transition-colors hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring @min-[100rem]/topbar:w-56"
          >
            <Search className="h-4 w-4 shrink-0" />
            <span className="hidden min-w-0 flex-1 truncate text-left text-sm @min-[100rem]/topbar:inline">{t("nav.searchPlaceholder")}</span>
            <kbd className="hidden @min-[100rem]/topbar:inline-flex items-center gap-0.5 rounded border border-border bg-background px-1.5 font-mono text-[10px] text-muted-foreground">
              ⌘K
            </kbd>
          </button>

          {/* Right — alerts · site-health dot · theme/lang. */}
          {/* doc 67 W4 [P0] — bỏ shrink-0, thêm min-w-0: cụm phải co được khi 1280px chật;
              phần co dồn vào AssetScopeBar (min-w-0, selector tự truncate), các nút icon
              giữ kích thước cố định của chúng. */}
          <div className="flex min-w-0 items-center gap-1 sm:gap-2">
            {/* doc 64 IA-10 S0.3 — trục phạm vi ISA-95 (Xưởng›Chuyền›Máy), bền qua điều hướng. */}
            {isIsa101V2() && <AssetScopeBar className="hidden min-w-0 xl:flex" />}
            <AIActionInboxLauncher />
            <NotificationCenter />
            {/* doc 63 (FLW-01/G1) — shell alert chip: đếm andon mở, chạm→drawer Ack/Resolve.
                Ẩn khi 0 (ISA-101 im lặng). */}
            {isIsa101V2() && <ShellAlertChip />}
            {/* doc 63 (AUD-01/G8) — flag-gated shell FreshnessStrip: socket-truth connection
                state, never claims live when the socket is down. Byte-identical when off. */}
            {/* doc 81 Đợt 2 Task 2 (fix 1, đo 800 px): top bar 800/1024 px tràn 2–15 px ⇒ dải tươi mới từ xl. */}
            {isIsa101V2() && <FreshnessStrip className="hidden shrink-0 xl:inline-flex" />}
            <SiteHealthDot />
            {/* doc 81 Đợt 2 Task 2 — MỘT lối vào AI: chat (sheet phải) hoặc dock Copilot ở màn lập trình. */}
            <ShellAiButton />
            {!isMobile && <ThemeToggle />}
            {!isMobile && <LanguageSwitcher />}
          </div>
        </header>
        {/* R-2-i — license bị khoá / chưa có license: THANH đỏ ≤32 px ngay dưới top bar (ngoại lệ
            có chủ đích của "0 banner"; chỉ hiện khi license ở trạng thái nghiêm trọng). */}
        {/* < lg: chỉ-đọc / server offline cũng thành thanh (chip đỏ đặc không vừa top bar 375–1023 px). */}
        <LicenseCriticalBar notice={licNotice} includeChipStates={compactLicense} />
        {/* Mobile (<768): top bar quá hẹp ⇒ breadcrumb (vẫn MỘT cái) là một hàng mảnh dưới top bar. */}
        {showBreadcrumbs && isMobile && (
          <div className="flex min-w-0 items-center border-b border-border bg-card/60 px-3 py-1">
            <ShellBreadcrumb crumbs={breadcrumbs} inHeader={false} />
          </div>
        )}
        {/* E: pad the bottom on mobile so content clears the fixed Bottom Navigation bar. */}
        {/* doc 81 Đợt 2 Task 2 — MỘT chỗ đệm: <main> đệm 12/16 px (PageContainer bên trong không đệm
            nữa — trước đây 24 + 24 px). Không còn nút chat nổi trong shell (lối vào AI ở top bar) ⇒ bỏ
            pb-24 chừa chỗ cho nó. Trang workbench khai "full-bleed" ⇒ không đệm. */}
        <main
          id="main-content"
          tabIndex={-1}
          data-shell-variant={pageVariant}
          className={cn(
            "flex-1 overflow-auto focus:outline-none",
            pageVariant === "full-bleed" ? "p-0" : "px-3 pt-3 pb-6 sm:px-4 sm:pt-4 md:px-6 md:pt-4",
            isMobile && "pb-20",
          )}
        >
          <ShellPageContext.Provider value={shellPage}>{children}</ShellPageContext.Provider>
        </main>
      </div>
      {/* E — Material 3 Bottom Navigation (phones only). "Menu" opens the full drawer. */}
      {isMobile && (
        <BottomNav
          groups={visibleGroups}
          currentPath={navActivePath}
          onNavigate={handleNavigate}
          // doc 36 W4 — on mobile the "Menu" action opens the App Launcher (switch app)
          // when the launcher is enabled; otherwise the legacy full drawer.
          onOpenMenu={launcherOn ? () => setLauncherOpen(true) : () => setOpenMobile(true)}
          role={user?.role}
          // doc 36 W4 follow-up — in launcher mode the bar shows the ACTIVE APP's top items.
          items={launcherOn ? sidebarGroups.flatMap(g => g.items) : undefined}
        />
      )}
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        groups={searchGroups}
        onNavigate={href => {
          setLocation(href);
          setPaletteOpen(false);
        }}
      />
      {/* doc 36 — App Launcher grid overlay (Phương án A). Opened from the top-shell waffle. */}
      {launcherOn && (
        <AppLauncherOverlay
          open={launcherOpen}
          onOpenChange={setLauncherOpen}
          allowedModules={allowedModules}
          activeAppId={activeApp.appId}
          onSelectApp={app => openApp(app.landingHref)}
          onUpgrade={() => openApp("/modules")}
          canAccessApp={canAccessApp}
        />
      )}
      {/* C3a — AILocalChatBubble moved to App root (mounted once globally).
          Removed from here to avoid a duplicate bubble on pages using this layout. */}
    </>
  );
}
