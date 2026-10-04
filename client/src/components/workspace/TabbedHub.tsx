/**
 * doc 59 P0 — TabbedHub: declarative tabbed hub with URL `?tab=` sync.
 *
 * Factors out the tab-strip + `?tab=` parse + post-mount sync that DeviceHub /
 * ConnectivityHub / QualityCockpit each hand-rolled, so a hub is just a list of
 * `{ value, labelKey, icon, Content }`. Preserves OTHER query params on switch
 * (see buildTabHref) — required for master-detail workspaces (`?machine=…&tab=…`).
 *
 * Renders ONLY the tabs (no DashboardLayout): compose it inside a page shell.
 */
import { useState, useEffect, type ReactNode, type ComponentType, type CSSProperties } from "react";
import { useSearch, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { resolveActiveTab, buildTabHref } from "./hubState";

export interface TabbedHubTab {
  value: string;
  labelKey: string;
  fallback?: string;
  icon?: ReactNode;
  Content: ComponentType;
  /**
   * doc 81 Đợt 2 Task 3 — giữ tab MOUNT khi không được chọn (ẩn bằng `hidden`) để tiến trình
   * đang sống (worker, state-machine, stream) không bị huỷ khi người dùng xem tab khác.
   * Mặc định false ⇒ hành vi cũ (Radix unmount tab không chọn).
   */
  keepMounted?: boolean;
}

export interface TabbedHubProps {
  tabs: readonly TabbedHubTab[];
  /** Route base for URL sync, e.g. "/device-monitor". */
  basePath: string;
  /** Default tab when `?tab=` is absent/invalid (else the first tab). */
  defaultTab?: string;
  className?: string;
  /** Optional extra content rendered above the tab strip (e.g. a scope filter). */
  header?: ReactNode;
  /**
   * doc 81 Đợt 2 Task 3 — nội dung đặt CÙNG HÀNG với dải tab (bên phải), vd bộ lọc/hành động.
   * Khi có `listEnd` hoặc `listRowAttrs`, dải tab được bọc trong một hàng flex; không có ⇒ markup cũ.
   */
  listEnd?: ReactNode;
  /** Thuộc tính data-* cho hàng dải tab (vd `{ "data-layout-toolbar": "" }` của CockpitLayout). */
  listRowAttrs?: Record<`data-${string}`, string>;
  /** Ghi đè lớp của TabsList (mặc định "flex min-h-12 flex-wrap"). */
  listClassName?: string;
  /** Style / lớp THÊM cho hàng dải tab (chỉ áp khi hàng được bọc — có listEnd/listRowAttrs). */
  listRowStyle?: CSSProperties;
  listRowClassName?: string;
}

export function TabbedHub({
  tabs,
  basePath,
  defaultTab,
  className,
  header,
  listEnd,
  listRowAttrs,
  listClassName,
  listRowStyle,
  listRowClassName,
}: TabbedHubProps) {
  const { t } = useTranslation();
  const search = useSearch();
  const [, setLocation] = useLocation();

  const valid = tabs.map((x) => x.value);
  const fallback = defaultTab ?? tabs[0]?.value ?? "";
  const [activeTab, setActiveTab] = useState(() => resolveActiveTab(search, valid, fallback));

  const handleChange = (v: string) => {
    setActiveTab(v);
    setLocation(buildTabHref(basePath, search, v), { replace: true });
  };

  // React to `?tab=` changes AFTER mount (deep-link into a tab while already in the
  // hub). Uses the current tab as fallback so an unrelated param change (?machine=)
  // doesn't reset the tab.
  useEffect(() => {
    const next = resolveActiveTab(search, valid, activeTab);
    if (next !== activeTab) setActiveTab(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const list = (
    <TabsList className={listClassName ?? "flex min-h-12 flex-wrap"}>
      {tabs.map((tab) => (
        <TabsTrigger key={tab.value} value={tab.value} className="min-h-10 gap-1.5 text-xs">
          {tab.icon}
          {t(tab.labelKey, tab.fallback ?? tab.value)}
        </TabsTrigger>
      ))}
    </TabsList>
  );

  return (
    <Tabs value={activeTab} onValueChange={handleChange} className={className ?? "space-y-2"}>
      {header}
      {listEnd != null || listRowAttrs != null ? (
        <div {...listRowAttrs} style={listRowStyle} className={`flex min-w-0 items-center gap-2${listRowClassName ? ` ${listRowClassName}` : ""}`}>
          {list}
          {listEnd != null && <div className="ml-auto flex shrink-0 items-center gap-2">{listEnd}</div>}
        </div>
      ) : (
        list
      )}
      {tabs.map((tab) => (
        <TabsContent
          key={tab.value}
          value={tab.value}
          className="mt-2"
          forceMount={tab.keepMounted ? true : undefined}
          hidden={tab.keepMounted ? activeTab !== tab.value : undefined}
        >
          <tab.Content />
        </TabsContent>
      ))}
    </Tabs>
  );
}

export default TabbedHub;
