/**
 * doc 39 Wave 4 — Device hub.
 *
 * Consolidates the three overlapping device-monitoring surfaces (fleet list, machine
 * health/OEE, field-device liveness) into ONE tabbed hub at /device-monitor with `?tab=`
 * deep-links; /machine-health and /field-devices redirect into their tab. Each tab renders
 * that page's extracted `*Content` (the body WITHOUT its own DashboardLayout), so there's a
 * single shell + one tab strip. No hub PageHeader — each tab keeps its own header.
 *
 * FieldDevices' content self-gates on its `machine_monitoring` view permission; the hub
 * route also requires it, so no tab leaks access.
 */
import { useState } from "react";
import { useSearch, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Server, HeartPulse, Radio } from "lucide-react";

import { UnifiedDeviceMonitorContent } from "./UnifiedDeviceMonitor";
import { MachineHealthMonitoringContent } from "./MachineHealthMonitoring";
import { FieldDevicesContent } from "./FieldDevices";

const TABS = [
  { value: "fleet", labelKey: "deviceHub.tabs.fleet", fallback: "Fleet", icon: <Server className="h-4 w-4" />, Content: UnifiedDeviceMonitorContent },
  { value: "health", labelKey: "deviceHub.tabs.health", fallback: "Health & OEE", icon: <HeartPulse className="h-4 w-4" />, Content: MachineHealthMonitoringContent },
  { value: "field", labelKey: "deviceHub.tabs.field", fallback: "Field Devices", icon: <Radio className="h-4 w-4" />, Content: FieldDevicesContent },
] as const;

export default function DeviceHub() {
  const { t } = useTranslation();
  const search = useSearch();
  const [, setLocation] = useLocation();

  const valid = TABS.map((tab) => tab.value);
  const initialTab = (() => {
    const tab = new URLSearchParams(search).get("tab");
    return tab && (valid as readonly string[]).includes(tab) ? tab : "fleet";
  })();
  const [activeTab, setActiveTab] = useState(initialTab);

  const handleTabChange = (v: string) => {
    setActiveTab(v);
    setLocation(`/device-monitor?tab=${v}`, { replace: true });
  };

  return (
    <DashboardLayout title={t("deviceHub.title", "Devices")}>
      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
        <TabsList className="flex flex-wrap h-auto">
          {TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="gap-2">
              {tab.icon}
              {t(tab.labelKey, tab.fallback)}
            </TabsTrigger>
          ))}
        </TabsList>
        {TABS.map((tab) => (
          <TabsContent key={tab.value} value={tab.value}>
            <tab.Content />
          </TabsContent>
        ))}
      </Tabs>
    </DashboardLayout>
  );
}
