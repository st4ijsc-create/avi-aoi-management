/**
 * doc 39 Wave 4 — Connectivity hub.
 *
 * Consolidates the nine formerly-standalone MQTT / UNS surfaces into ONE tabbed hub
 * with `?tab=` deep-links (the legacy routes redirect in). Each tab renders that page's
 * extracted `*Content` component (the page bodies WITHOUT their own DashboardLayout), so
 * there's a single shell + a single tab strip instead of nine top-level nav entries.
 *
 * Per-tab RBAC preserves the stricter legacy gates that the flat route guard can't:
 *   - profiles  → admin only        (was requireRole admin + mqtt_monitoring)
 *   - ngrate    → mqtt_alerts        (was requirePermission mqtt_alerts)
 * everything else is covered by the hub route guard (mqtt_monitoring).
 */
import { useState } from "react";
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

type TabDef = {
  value: string;
  labelKey: string;
  fallback: string;
  icon: React.ReactNode;
  Content: React.ComponentType;
  show: boolean;
};

export default function ConnectivityHub() {
  const { t } = useTranslation();
  const search = useSearch();
  const [, setLocation] = useLocation();
  const { hasPermission, isAdmin } = usePermissions();

  const tabs: TabDef[] = [
    { value: "overview", labelKey: "connectivity.tabs.overview", fallback: "Overview", icon: <LayoutDashboard className="h-4 w-4" />, Content: MqttDashboardContent, show: true },
    { value: "clients", labelKey: "connectivity.tabs.clients", fallback: "Devices", icon: <Server className="h-4 w-4" />, Content: MqttClientManagementContent, show: true },
    { value: "topics", labelKey: "connectivity.tabs.topics", fallback: "Topics & Messages", icon: <MessageSquare className="h-4 w-4" />, Content: MqttTopicsMessagesContent, show: true },
    { value: "bulletin", labelKey: "connectivity.tabs.bulletin", fallback: "Bulletin", icon: <Megaphone className="h-4 w-4" />, Content: MqttBulletinContent, show: true },
    { value: "replay", labelKey: "connectivity.tabs.replay", fallback: "Replay", icon: <History className="h-4 w-4" />, Content: MQTTReplayContent, show: true },
    { value: "alerts", labelKey: "connectivity.tabs.alerts", fallback: "Alert Rules", icon: <BellRing className="h-4 w-4" />, Content: MqttAlertRulesContent, show: true },
    { value: "ngrate", labelKey: "connectivity.tabs.ngrate", fallback: "NG-Rate", icon: <Gauge className="h-4 w-4" />, Content: MqttNgRateThresholdContent, show: hasPermission("mqtt_alerts", "canView") },
    { value: "uns", labelKey: "connectivity.tabs.uns", fallback: "UNS Mapping", icon: <Network className="h-4 w-4" />, Content: UnsMappingDesignerContent, show: true },
    { value: "profiles", labelKey: "connectivity.tabs.profiles", fallback: "Profiles", icon: <UserCog className="h-4 w-4" />, Content: MqttProfileManagementContent, show: isAdmin },
  ];

  const visible = tabs.filter((tab) => tab.show);
  const validValues = visible.map((tab) => tab.value);

  const initialTab = (() => {
    const tab = new URLSearchParams(search).get("tab");
    return tab && validValues.includes(tab) ? tab : validValues[0] ?? "overview";
  })();
  const [activeTab, setActiveTab] = useState(initialTab);

  const handleTabChange = (v: string) => {
    setActiveTab(v);
    setLocation(`/connectivity?tab=${v}`, { replace: true });
  };

  // Guard against a tab that was hidden after a permission change (e.g. profiles/ngrate).
  const current = validValues.includes(activeTab) ? activeTab : validValues[0] ?? "overview";

  return (
    <DashboardLayout title={t("connectivity.title", "Connectivity")}>
      <Tabs value={current} onValueChange={handleTabChange} className="space-y-4">
        <TabsList className="flex flex-wrap h-auto">
          {visible.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="gap-2">
              {tab.icon}
              {t(tab.labelKey, tab.fallback)}
            </TabsTrigger>
          ))}
        </TabsList>
        {visible.map((tab) => (
          <TabsContent key={tab.value} value={tab.value}>
            <tab.Content />
          </TabsContent>
        ))}
      </Tabs>
    </DashboardLayout>
  );
}
