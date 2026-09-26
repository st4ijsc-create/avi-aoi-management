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
import { Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";
import { Server, HeartPulse, Radio, Gauge } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { TabbedHub, type TabbedHubTab, isWorkspaceShellEnabled } from "@/components/workspace";

// doc64 S5-OPT-2: 4 thân tab từng import TĨNH → cả 4 page-body parse dù chỉ 1 tab render.
// Cân bằng đo được (POC ×4): tab MẶC ĐỊNH (fleet) giữ EAGER — lazy nó chỉ thêm 1 nấc
// waterfall cho chính màn direct-load (đo: 3,4s → 4,4s, phản tác dụng); 3 tab còn lại lazy
// (parse khi user thật sự mở). Suspense bên dưới giữ chrome khi đổi tab lần đầu.
import { UnifiedDeviceMonitorContent } from "./UnifiedDeviceMonitor";
const MachineHealthMonitoringContent = lazy(() =>
  import("./MachineHealthMonitoring").then((m) => ({ default: m.MachineHealthMonitoringContent })),
);
const FieldDevicesContent = lazy(() =>
  import("./FieldDevices").then((m) => ({ default: m.FieldDevicesContent })),
);
const OEEDashboardContent = lazy(() =>
  import("./OEEDashboard").then((m) => ({ default: m.OEEDashboardContent })),
);

const TABS: readonly TabbedHubTab[] = [
  { value: "fleet", labelKey: "deviceHub.tabs.fleet", fallback: "Fleet", icon: <Server className="h-4 w-4" />, Content: UnifiedDeviceMonitorContent },
  { value: "health", labelKey: "deviceHub.tabs.health", fallback: "Health", icon: <HeartPulse className="h-4 w-4" />, Content: MachineHealthMonitoringContent },
  // doc 40 DEV-10 — OEE & Downtime là tab thứ 4 (trước là /oee-dashboard riêng; nay redirect vào ?tab=oee).
  { value: "oee", labelKey: "deviceHub.tabs.oee", fallback: "OEE & Dừng máy", icon: <Gauge className="h-4 w-4" />, Content: OEEDashboardContent },
  { value: "field", labelKey: "deviceHub.tabs.field", fallback: "Field Devices", icon: <Radio className="h-4 w-4" />, Content: FieldDevicesContent },
];

// doc 59 P1 — Machine Workspace (master-detail) loads only when the flag is on.
const MachineWorkspace = lazy(() => import("./MachineWorkspace"));

export default function DeviceHub() {
  const { t } = useTranslation();
  // Flag ON ⇒ /device-monitor is the Machine Workspace (rail fleet ⇄ cockpit ⇄ AI drawer);
  // OFF ⇒ the legacy tabbed hub below (byte-identical). doc 59 guardrail: reversible.
  if (isWorkspaceShellEnabled()) {
    return (
      <Suspense
        fallback={
          <DashboardLayout>
            <div className="p-6 text-sm text-muted-foreground">{t("common.loading", "Đang tải…")}</div>
          </DashboardLayout>
        }
      >
        <MachineWorkspace />
      </Suspense>
    );
  }
  return (
    <DashboardLayout title={t("deviceHub.title", "Devices")}>
      <TabbedHub tabs={TABS} basePath="/device-monitor" defaultTab="fleet" />
    </DashboardLayout>
  );
}
