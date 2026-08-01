/**
 * doc 39 Wave 4 — Connectivity hub · doc 41 (2026-07-11) two-tier tabs.
 *
 * Consolidates the nine formerly-standalone MQTT / UNS surfaces into ONE hub. The
 * nine surfaces were a single flat 9-tab strip (rối / hard to scan); they are now
 * grouped by PURPOSE into 4 primary tabs, each expanding a secondary sub-tab row:
 *   - Giám sát   : Overview · Devices · Topics & Messages   (live status / flow)
 *   - Chẩn đoán  : Bulletin · Replay                        (history / bulletins)
 *   - Cảnh báo   : Alert Rules · NG-Rate                    (thresholds / rules)
 *   - Cấu hình   : UNS Mapping · Profiles                   (namespace / conn profiles)
 *
 * `?tab=<subtab>` deep-links are UNCHANGED (same sub-tab values), so every legacy
 * route that redirects into the hub still lands on the right surface; the primary
 * group is derived from whichever group owns the active sub-tab.
 *
 * Per-tab RBAC preserves the stricter legacy gates the flat route guard can't:
 *   - profiles → admin only     (was requireRole admin + mqtt_monitoring)
 *   - ngrate   → mqtt_alerts     (was requirePermission mqtt_alerts)
 * everything else is covered by the hub route guard (mqtt_monitoring).
 */
import { useState, useEffect } from "react";
import { useSearch, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePermissions } from "@/_core/hooks/usePermissions";
import {
  LayoutDashboard,
  Server,
  UserCog,
  MessageSquare,
  Megaphone,
  History,
  BellRing,
  Gauge,
  Network,
  Activity,
  Stethoscope,
  Sliders,
} from "lucide-react";

import { MqttDashboardContent } from "./MqttDashboard";
import { MqttClientManagementContent } from "./MqttClientManagement";
import { MqttProfileManagementContent } from "./MqttProfileManagement";
import { MqttTopicsMessagesContent } from "./MqttTopicsMessages";
import { MqttBulletinContent } from "./MqttBulletin";
import { MQTTReplayContent } from "./MQTTReplay";
import { MqttAlertRulesContent } from "./MqttAlertRules";
import { MqttNgRateThresholdContent } from "./MqttNgRateThreshold";
import { UnsMappingDesignerContent } from "./UnsMappingDesigner";

type SubTab = {
  value: string;
  labelKey: string;
  fallback: string;
  icon: React.ReactNode;
  Content: React.ComponentType;
  show: boolean;
};

type TabGroup = {
  key: string;
  labelKey: string;
  fallback: string;
  icon: React.ReactNode;
  tabs: SubTab[];
};

export default function ConnectivityHub() {
  const { t } = useTranslation();
  const search = useSearch();
  const [, setLocation] = useLocation();
  const { hasPermission, isAdmin } = usePermissions();

  // Sub-tab VALUES are unchanged from the old flat hub → `?tab=` deep-links still work.
  const groups: TabGroup[] = [
    {
      key: "monitor",
      labelKey: "connectivity.groups.monitor",
      fallback: "Giám sát",
      icon: <Activity className="h-4 w-4" />,
      tabs: [
        { value: "overview", labelKey: "connectivity.tabs.overview", fallback: "Tổng quan", icon: <LayoutDashboard className="h-4 w-4" />, Content: MqttDashboardContent, show: true },
        { value: "clients", labelKey: "connectivity.tabs.clients", fallback: "Thiết bị", icon: <Server className="h-4 w-4" />, Content: MqttClientManagementContent, show: true },
        { value: "topics", labelKey: "connectivity.tabs.topics", fallback: "Topic & Tin nhắn", icon: <MessageSquare className="h-4 w-4" />, Content: MqttTopicsMessagesContent, show: true },
      ],
    },
    {
      key: "diagnostics",
      labelKey: "connectivity.groups.diagnostics",
      fallback: "Chẩn đoán",
      icon: <Stethoscope className="h-4 w-4" />,
      tabs: [
        { value: "bulletin", labelKey: "connectivity.tabs.bulletin", fallback: "Bản tin", icon: <Megaphone className="h-4 w-4" />, Content: MqttBulletinContent, show: true },
        { value: "replay", labelKey: "connectivity.tabs.replay", fallback: "Phát lại", icon: <History className="h-4 w-4" />, Content: MQTTReplayContent, show: true },
      ],
    },
    {
      key: "alerting",
      labelKey: "connectivity.groups.alerting",
      fallback: "Cảnh báo",
      icon: <BellRing className="h-4 w-4" />,
      tabs: [
        { value: "alerts", labelKey: "connectivity.tabs.alerts", fallback: "Luật cảnh báo", icon: <BellRing className="h-4 w-4" />, Content: MqttAlertRulesContent, show: true },
        { value: "ngrate", labelKey: "connectivity.tabs.ngrate", fallback: "Ngưỡng NG", icon: <Gauge className="h-4 w-4" />, Content: MqttNgRateThresholdContent, show: hasPermission("mqtt_alerts", "canView") },
      ],
    },
    {
      key: "config",
      labelKey: "connectivity.groups.config",
      fallback: "Cấu hình",
      icon: <Sliders className="h-4 w-4" />,
      tabs: [
        { value: "uns", labelKey: "connectivity.tabs.uns", fallback: "UNS Mapping", icon: <Network className="h-4 w-4" />, Content: UnsMappingDesignerContent, show: true },
        { value: "profiles", labelKey: "connectivity.tabs.profiles", fallback: "Hồ sơ kết nối", icon: <UserCog className="h-4 w-4" />, Content: MqttProfileManagementContent, show: isAdmin },
      ],
    },
  ];

  // Drop hidden sub-tabs, then drop groups that end up empty (e.g. non-admin: config
  // still has UNS, so it stays; a group only vanishes if ALL its sub-tabs are hidden).
  const visibleGroups = groups
    .map((g) => ({ ...g, tabs: g.tabs.filter((tab) => tab.show) }))
    .filter((g) => g.tabs.length > 0);

  const allTabs = visibleGroups.flatMap((g) => g.tabs);
  const validValues = allTabs.map((tab) => tab.value);

  const initialTab = (() => {
    const tab = new URLSearchParams(search).get("tab");
    return tab && validValues.includes(tab) ? tab : validValues[0] ?? "overview";
  })();
  const [activeTab, setActiveTab] = useState(initialTab);

  const handleTabChange = (v: string) => {
    setActiveTab(v);
    setLocation(`/connectivity?tab=${v}`, { replace: true });
  };

  const handleGroupChange = (groupKey: string) => {
    const g = visibleGroups.find((x) => x.key === groupKey);
    if (g && g.tabs[0]) handleTabChange(g.tabs[0].value);
  };

  // doc 40 fix — react to ?tab= changes AFTER mount (e.g. a sidebar deep-link to a tab
  // while already on the hub). Without this the URL/header changed but the tab didn't.
  useEffect(() => {
    const tab = new URLSearchParams(search).get("tab");
    if (tab && validValues.includes(tab) && tab !== activeTab) setActiveTab(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Guard against a tab hidden after a permission change (e.g. profiles/ngrate).
  const current = validValues.includes(activeTab) ? activeTab : validValues[0] ?? "overview";
  const currentGroup =
    visibleGroups.find((g) => g.tabs.some((tab) => tab.value === current)) ?? visibleGroups[0];

  return (
    <DashboardLayout title={t("connectivity.title", "Kết nối (MQTT / UNS)")}>
      <div className="space-y-3">
        {/* Cấp 1 — nhóm theo mục đích */}
        <Tabs value={currentGroup?.key} onValueChange={handleGroupChange}>
          <TabsList className="flex flex-wrap h-auto">
            {visibleGroups.map((g) => (
              <TabsTrigger key={g.key} value={g.key} className="gap-2">
                {g.icon}
                {t(g.labelKey, g.fallback)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {/* Cấp 2 — tab con của nhóm đang chọn + nội dung */}
        <Tabs value={current} onValueChange={handleTabChange} className="space-y-4">
          <TabsList className="flex flex-wrap h-auto bg-muted/50">
            {currentGroup?.tabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="gap-2">
                {tab.icon}
                {t(tab.labelKey, tab.fallback)}
              </TabsTrigger>
            ))}
          </TabsList>
          {currentGroup?.tabs.map((tab) => (
            <TabsContent key={tab.value} value={tab.value}>
              <tab.Content />
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
