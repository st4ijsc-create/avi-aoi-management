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
import { useState, useEffect, type ReactNode, type ComponentType } from "react";
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
}

export function TabbedHub({ tabs, basePath, defaultTab, className, header }: TabbedHubProps) {
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

  return (
    <Tabs value={activeTab} onValueChange={handleChange} className={className ?? "space-y-2"}>
      {header}
      <TabsList className="flex min-h-12 flex-wrap">
        {tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value} className="min-h-10 gap-1.5 text-xs">
            {tab.icon}
            {t(tab.labelKey, tab.fallback ?? tab.value)}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent key={tab.value} value={tab.value} className="mt-2">
          <tab.Content />
        </TabsContent>
      ))}
    </Tabs>
  );
}

export default TabbedHub;
