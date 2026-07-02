/**
 * MaintenanceHome — "/maintenance-home" — the maintenance/technician WORKSPACE
 * front door (F1, doc 23 §4 Table B). Mirrors the QualityHome / OperatorHome
 * pattern: a role-aware "Today" briefing at the top, then a grid of the tools a
 * technician reaches for, built on the shared <ToolTile>.
 *
 * Rendered inside DashboardLayout like the other role homes. Read-open: any
 * authenticated role can view it, but it is the default landing for the
 * `maintenance` role (see roleLanding.ts). Each target route enforces its own RBAC.
 *
 * Nothing is rebuilt — it composes existing surfaces:
 *   - <TodayBriefing/>            role-aware glanceable summary (maintenance variant)
 *   - Fix Copilot   → /technician-copilot   (RCA + one-tap fix approval)
 *   - Work orders   → /work-orders          (create/close → MTTR)
 *   - Machine health→ /machine-health        (PdM risk + health trend)
 *   - Devices & OT  → /device-monitor        (live device status)
 *   - Alerts        → /alerts                (predictive/andon alert feed)
 */

import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { TodayBriefing } from "@/components/TodayBriefing";
import { FirstRunTour } from "@/components/FirstRunTour";
import { ToolTile } from "@/components/patterns";
import { trpc } from "@/lib/trpc";
import {
  Wrench,
  BrainCircuit,
  ClipboardList,
  HeartPulse,
  Cpu,
  Bell,
  type LucideIcon,
} from "lucide-react";

interface MaintTool {
  key: string;
  icon: LucideIcon;
  label: string;
  blurb: string;
  href: string;
  badge?: number;
}

export default function MaintenanceHome() {
  const { t } = useTranslation();

  // Pending action count for the copilot tile badge (best-effort; never blocks).
  const countQuery = trpc.aiInbox.count.useQuery(undefined, {
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const pendingCount = countQuery.data?.count ?? 0;

  const tools: MaintTool[] = [
    {
      key: "copilot",
      icon: BrainCircuit,
      label: t("maintenanceHome.tools.copilot", "Fix Copilot"),
      blurb: t("maintenanceHome.tools.copilotDesc", "RCA + one-tap fix approval"),
      href: "/technician-copilot",
      badge: pendingCount,
    },
    {
      key: "workOrders",
      icon: ClipboardList,
      label: t("maintenanceHome.tools.workOrders", "Work orders"),
      blurb: t("maintenanceHome.tools.workOrdersDesc", "Create, assign and close jobs"),
      href: "/work-orders",
    },
    {
      key: "machineHealth",
      icon: HeartPulse,
      label: t("maintenanceHome.tools.machineHealth", "Machine health"),
      blurb: t("maintenanceHome.tools.machineHealthDesc", "PdM risk and health trends"),
      href: "/machine-health",
    },
    {
      key: "devices",
      icon: Cpu,
      label: t("maintenanceHome.tools.devices", "Devices & OT"),
      blurb: t("maintenanceHome.tools.devicesDesc", "Live device and OT status"),
      href: "/device-monitor",
    },
    {
      key: "alerts",
      icon: Bell,
      label: t("maintenanceHome.tools.alerts", "Alerts"),
      blurb: t("maintenanceHome.tools.alertsDesc", "Predictive and andon alerts"),
      href: "/alerts",
    },
  ];

  return (
    <DashboardLayout>
      <div className="mx-auto w-full max-w-5xl space-y-6 p-2 sm:p-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">
            <Wrench className="h-7 w-7" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {t("maintenanceHome.title", "Maintenance workspace")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("maintenanceHome.subtitle", "Diagnose, plan and close — one step to the right tool")}
            </p>
          </div>
        </div>

        {/* Role-aware "Today" summary (maintenance variant, zero-click) */}
        <TodayBriefing />

        {/* Quick-access maintenance tools */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t("maintenanceHome.toolsTitle", "Tools")}
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-5">
            {tools.map((tool) => (
              <ToolTile
                key={tool.key}
                icon={tool.icon}
                label={tool.label}
                blurb={tool.blurb}
                href={tool.href}
                badge={tool.badge}
              />
            ))}
          </div>
        </section>
      </div>

      {/* First-run coach — shown once per user on their landing */}
      <FirstRunTour />
    </DashboardLayout>
  );
}
