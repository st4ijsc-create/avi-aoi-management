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
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { getLoginUrl } from "@/const";
import { useIsMobile } from "@/hooks/useMobile";
import { Cpu, LogOut, PanelLeft, Key, User, Monitor, ChevronRight } from "lucide-react";
import { NotificationCenter } from "./NotificationCenter";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { CSSProperties, ReactNode, useEffect, useRef, useState } from "react";
import { useLocation, Link } from "wouter";
import { DashboardLayoutSkeleton } from './DashboardLayoutSkeleton';
import { Button } from "./ui/button";
import { navGroups, NavGroup, NavItem, hasAccessToGroup, getFilteredNavGroups } from "@/lib/navigation";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

type DashboardLayoutProps = {
  children: ReactNode;
  title?: string;
  navItems?: NavItem[];
  currentPath?: string;
};

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const SIDEBAR_GROUPS_KEY = "sidebar-groups-state";
const DEFAULT_WIDTH = 260;
const MIN_WIDTH = 200;
const MAX_WIDTH = 400;

export default function DashboardLayout({
  children,
  title = "AVI/AOI Management",
  navItems = [],
  currentPath,
}: DashboardLayoutProps) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const { loading, user } = useAuth();
  const { t } = useTranslation();

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

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
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
        } as CSSProperties
      }
    >
      <DashboardLayoutContent 
        setSidebarWidth={setSidebarWidth}
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
  setSidebarWidth: (width: number) => void;
  title: string;
  navItems: NavItem[];
  currentPath?: string;
};

function DashboardLayoutContent({
  children,
  setSidebarWidth,
  title,
  navItems,
  currentPath,
}: DashboardLayoutContentProps) {
  const { user, logout } = useAuth();
  const { t } = useTranslation();
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  // State for collapsible groups
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const saved = localStorage.getItem(SIDEBAR_GROUPS_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        // Fall through to default
      }
    }
    // Default: open at most one group (accordion behavior)
    const currentOrLocation = currentPath || location;
    let activeGroupId: string | null = null;
    let defaultOpenGroupId: string | null = null;

    navGroups.forEach(group => {
      const hasActiveItem = group.items.some(item => item.href === currentOrLocation);
      if (hasActiveItem && !activeGroupId) {
        activeGroupId = group.id;
      }
      if (group.defaultOpen && !defaultOpenGroupId) {
        defaultOpenGroupId = group.id;
      }
    });

    const openGroupId = activeGroupId ?? defaultOpenGroupId;
    const defaults: Record<string, boolean> = {};
    navGroups.forEach(group => {
      defaults[group.id] = openGroupId ? group.id === openGroupId : false;
    });
    return defaults;
  });

  // Save group state to localStorage
  useEffect(() => {
    localStorage.setItem(SIDEBAR_GROUPS_KEY, JSON.stringify(openGroups));
  }, [openGroups]);

  // Find active item for header display
  const allItems = navGroups.flatMap(g => g.items);
  const activeItem = allItems.find(item => item.href === (currentPath || location));

  useEffect(() => {
    if (isCollapsed) {
      setIsResizing(false);
    }
  }, [isCollapsed]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;

      const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  const toggleGroup = (groupId: string) => {
    setOpenGroups(prev => {
      const isCurrentlyOpen = !!prev[groupId];

      // If the group is currently open, allow collapsing it (result: no group open)
      if (isCurrentlyOpen) {
        return {
          ...prev,
          [groupId]: false,
        };
      }

      // When opening a group, close all others (accordion behavior)
      const next: Record<string, boolean> = {};
      Object.keys(prev).forEach(id => {
        next[id] = false;
      });
      next[groupId] = true;
      return next;
    });
  };

  // Permission-based filtering
  const { hasPermission, hasAnyCategoryPermission } = usePermissions();

  // Filter groups based on user role + granular permissions
  const visibleGroups = getFilteredNavGroups(user?.role, hasPermission, hasAnyCategoryPermission);

  return (
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar
          collapsible="icon"
          className="border-r border-sidebar-border"
          disableTransition={isResizing}
        >
          <SidebarHeader className="h-16 justify-center border-b border-sidebar-border">
            <div className="flex items-center gap-3 px-2 transition-all w-full">
              <button
                onClick={toggleSidebar}
                className="h-9 w-9 flex items-center justify-center hover:bg-sidebar-accent rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0"
                aria-label="Toggle navigation"
              >
                <PanelLeft className="h-4 w-4 text-sidebar-foreground" />
              </button>
              {!isCollapsed && (
                <Link href="/" className="flex items-center gap-2 min-w-0">
                  <div className="h-8 w-8 rounded-lg bg-primary/20 flex items-center justify-center shrink-0">
                    <Cpu className="h-4 w-4 text-primary" />
                  </div>
                  <span className="font-semibold tracking-tight truncate text-sidebar-foreground">
                    {title}
                  </span>
                </Link>
              )}
            </div>
          </SidebarHeader>

          <SidebarContent className="gap-0 py-2 overflow-y-auto">
            {isCollapsed ? (
              // Collapsed mode: show flat list with icons only
              <SidebarMenu className="px-2">
                {allItems.map(item => {
                  const isActive = (currentPath || location) === item.href;
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        isActive={isActive}
                        onClick={() => setLocation(item.href)}
                        tooltip={t(item.label)}
                        className={`h-10 transition-all font-normal ${isActive ? 'bg-sidebar-accent' : ''}`}
                      >
                        <span className={isActive ? "text-primary" : "text-sidebar-foreground"}>
                          {item.icon}
                        </span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            ) : (
              // Expanded mode: show grouped navigation
              <div className="space-y-1">
                {visibleGroups.map(group => (
                  <NavGroupComponent
                    key={group.id}
                    group={group}
                    isOpen={openGroups[group.id] ?? false}
                    onToggle={() => toggleGroup(group.id)}
                    currentPath={currentPath || location}
                    onNavigate={setLocation}
                  />
                ))}
              </div>
            )}
          </SidebarContent>

          <SidebarFooter className="p-3 border-t border-sidebar-border">
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
        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/30 transition-colors ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => {
            if (isCollapsed) return;
            setIsResizing(true);
          }}
          style={{ zIndex: 50 }}
        />
      </div>

      <SidebarInset className="bg-background">
        <div className="flex border-b border-border h-14 items-center justify-between bg-card/95 px-2 sm:px-3 backdrop-blur supports-[backdrop-filter]:backdrop-blur sticky top-0 z-40">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            {isMobile && <SidebarTrigger className="h-9 w-9 rounded-lg shrink-0" />}
            <span className="font-medium text-foreground text-sm sm:text-base truncate">
              {activeItem ? t(activeItem.label) : title}
            </span>
          </div>
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            <LanguageSwitcher />
            <NotificationCenter />
          </div>
        </div>
        <main className="flex-1 p-3 sm:p-4 md:p-6 overflow-auto">{children}</main>
      </SidebarInset>
    </>
  );
}

// Component for rendering a navigation group
interface NavGroupComponentProps {
  group: NavGroup;
  isOpen: boolean;
  onToggle: () => void;
  currentPath: string;
  onNavigate: (path: string) => void;
}

function NavGroupComponent({
  group,
  isOpen,
  onToggle,
  currentPath,
  onNavigate,
}: NavGroupComponentProps) {
  const hasActiveItem = group.items.some(item => item.href === currentPath);
  const { t } = useTranslation();

  return (
    <Collapsible open={isOpen} onOpenChange={onToggle} className="px-2">
      <CollapsibleTrigger asChild>
        <button
          className={cn(
            "flex items-center gap-2 w-full px-3 py-2 text-sm font-medium rounded-lg transition-colors",
            "hover:bg-sidebar-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            hasActiveItem ? "text-primary" : "text-sidebar-foreground"
          )}
        >
          {group.icon && (
            <span className={hasActiveItem ? "text-primary" : "text-muted-foreground"}>
              {group.icon}
            </span>
          )}
          <span className="flex-1 text-left">{t(group.label)}</span>
          <ChevronRight
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform duration-200",
              isOpen && "rotate-90"
            )}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1 space-y-0.5 pl-4">
        {group.items.map(item => {
          const isActive = currentPath === item.href;
          return (
            <button
              key={item.href}
              onClick={() => onNavigate(item.href)}
              className={cn(
                "flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg transition-colors",
                "hover:bg-sidebar-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isActive 
                  ? "bg-sidebar-accent text-primary font-medium" 
                  : "text-sidebar-foreground"
              )}
            >
              <span className={isActive ? "text-primary" : "text-muted-foreground"}>
                {item.icon}
              </span>
              <span>{t(item.label)}</span>
              {item.badge && (
                <span className="ml-auto px-1.5 py-0.5 text-xs font-medium bg-primary/10 text-primary rounded">
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </CollapsibleContent>
    </Collapsible>
  );
}
