/**
 * doc 39 Wave 4 — Device hub. Consolidates the overlapping device-monitoring surfaces
 * (fleet list, machine health/OEE, field-device liveness) into ONE tabbed hub at
 * /device-monitor with `?tab=` deep-links; /machine-health, /oee-dashboard, /field-devices
 * redirect into their tab. Each tab renders that page's extracted `*Content` (body WITHOUT
 * its own DashboardLayout).
 *
 * doc 59 P0 — the hand-rolled tab-strip + `?tab=` sync is now the shared `TabbedHub`
 * primitive (URL sync preserves other params, e.g. a future `?machine=`). Behaviour is
 * identical; each tab body self-gates its own permission so no tab leaks access.
 */
import { useTranslation } from "react-i18next";
import { Server, HeartPulse, Radio, Gauge } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { TabbedHub, type TabbedHubTab } from "@/components/workspace";

import { UnifiedDeviceMonitorContent } from "./UnifiedDeviceMonitor";
import { MachineHealthMonitoringContent } from "./MachineHealthMonitoring";
import { FieldDevicesContent } from "./FieldDevices";
import { OEEDashboardContent } from "./OEEDashboard";

const TABS: readonly TabbedHubTab[] = [
  { value: "fleet", labelKey: "deviceHub.tabs.fleet", fallback: "Fleet", icon: <Server className="h-4 w-4" />, Content: UnifiedDeviceMonitorContent },
  { value: "health", labelKey: "deviceHub.tabs.health", fallback: "Health", icon: <HeartPulse className="h-4 w-4" />, Content: MachineHealthMonitoringContent },
  // doc 40 DEV-10 — OEE & Downtime là tab thứ 4 (trước là /oee-dashboard riêng; nay redirect vào ?tab=oee).
  { value: "oee", labelKey: "deviceHub.tabs.oee", fallback: "OEE & Downtime", icon: <Gauge className="h-4 w-4" />, Content: OEEDashboardContent },
  { value: "field", labelKey: "deviceHub.tabs.field", fallback: "Field Devices", icon: <Radio className="h-4 w-4" />, Content: FieldDevicesContent },
];

export default function DeviceHub() {
  const { t } = useTranslation();
  return (
    <DashboardLayout title={t("deviceHub.title", "Devices")}>
      <TabbedHub tabs={TABS} basePath="/device-monitor" defaultTab="fleet" />
    </DashboardLayout>
  );
}
