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
import { useState, useEffect } from "react";
import { useSearch, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Server, HeartPulse, Radio, Gauge } from "lucide-react";

import { UnifiedDeviceMonitorContent } from "./UnifiedDeviceMonitor";
import { MachineHealthMonitoringContent } from "./MachineHealthMonitoring";
import { FieldDevicesContent } from "./FieldDevices";
import { OEEDashboardContent } from "./OEEDashboard";

const TABS = [
  { value: "fleet", labelKey: "deviceHub.tabs.fleet", fallback: "Fleet", icon: <Server className="h-4 w-4" />, Content: UnifiedDeviceMonitorContent },
  { value: "health", labelKey: "deviceHub.tabs.health", fallback: "Health", icon: <HeartPulse className="h-4 w-4" />, Content: MachineHealthMonitoringContent },
  // doc 40 DEV-10 — OEE & Downtime gộp thành tab thứ 4 (trước là trang /oee-dashboard
  // đứng riêng; nay redirect vào ?tab=oee). Chỉ số hiệu suất thiết bị nằm cạnh sức khỏe máy.
  { value: "oee", labelKey: "deviceHub.tabs.oee", fallback: "OEE & Downtime", icon: <Gauge className="h-4 w-4" />, Content: OEEDashboardContent },
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

  // doc 40 DEV-05 — react to ?tab= changes AFTER mount (deep-link vào một tab khi đã
  // ở trong hub). Không có nhánh này thì URL/header đổi nhưng tab không đổi.
  useEffect(() => {
    const tab = new URLSearchParams(search).get("tab");
    if (tab && (valid as readonly string[]).includes(tab) && tab !== activeTab) setActiveTab(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  return (
    <DashboardLayout title={t("deviceHub.title", "Devices")}>
      {/* doc 40 §13.3 content-first — strip tab gọn (h-9), khoảng cách nhỏ để nội
          dung chính (bảng fleet / health / field) chiếm tối đa chiều cao. */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-2">
        <TabsList className="flex h-9 flex-wrap">
          {TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="h-7 gap-1.5 text-xs">
              {tab.icon}
              {t(tab.labelKey, tab.fallback)}
            </TabsTrigger>
          ))}
        </TabsList>
        {TABS.map((tab) => (
          <TabsContent key={tab.value} value={tab.value} className="mt-2">
            <tab.Content />
          </TabsContent>
        ))}
      </Tabs>
    </DashboardLayout>
  );
}
