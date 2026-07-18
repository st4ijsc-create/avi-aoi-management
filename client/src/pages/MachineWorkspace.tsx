/**
 * doc 59 P1 (Cụm A) — Machine/Asset Workspace: the flagship consolidation. A persistent
 * master-detail that fixes the #1 audit finding (the unified cockpit existed but was
 * drill-only, list-less): LEFT rail = live fleet list ⇄ MAIN = the per-machine cockpit
 * (MachineCockpitBody) locked to `?machine=:id` ⇄ RIGHT drawer = AI copilot for that
 * machine. Rendered at /device-monitor when VITE_WORKSPACE_SHELL_ENABLED is on (DeviceHub
 * falls back to the legacy tabbed hub when off). Deep-links to /machine/:id still work.
 */
import { useState } from "react";
import { useSearch, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { WorkspaceShell, ContextDrawer } from "@/components/workspace";
import { EmptyState } from "@/components/patterns";
import { Button } from "@/components/ui/button";
import { Sparkles, MousePointerClick } from "lucide-react";
import { MachineRail } from "./machineWorkspace/MachineRail";
import { MachineCockpitBody } from "./MachineCockpit";
import MachineAISummary from "@/components/MachineAISummary";

export default function MachineWorkspace() {
  const { t } = useTranslation();
  const search = useSearch();
  const [, setLocation] = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const selectedId = (() => {
    const v = Number(new URLSearchParams(search).get("machine"));
    return Number.isFinite(v) && v > 0 ? v : null;
  })();

  const select = (id: number) => {
    const params = new URLSearchParams(search);
    params.set("machine", String(id));
    setLocation(`/device-monitor?${params.toString()}`);
  };

  return (
    <DashboardLayout title={t("machineWorkspace.title", "Không gian thiết bị")}>
      <WorkspaceShell
        rail={<MachineRail selectedId={selectedId} onSelect={select} />}
        drawer={
          selectedId != null ? (
            <ContextDrawer
              open={drawerOpen}
              onOpenChange={setDrawerOpen}
              title={t("machineWorkspace.aiTitle", "Trợ lý AI thiết bị")}
            >
              <MachineAISummary machineId={selectedId} />
            </ContextDrawer>
          ) : null
        }
        main={
          selectedId == null ? (
            <div className="grid h-full place-items-center">
              <EmptyState
                icon={MousePointerClick}
                title={t("machineWorkspace.selectTitle", "Chọn một thiết bị")}
                description={t(
                  "machineWorkspace.selectHint",
                  "Chọn thiết bị ở danh sách bên trái để mở cockpit: trạng thái · Kết quả process/SPC · cấu hình · lịch sử.",
                )}
              />
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex justify-end">
                <Button size="sm" variant="outline" onClick={() => setDrawerOpen(true)}>
                  <Sparkles className="mr-1 h-4 w-4" /> {t("machineWorkspace.ai", "Trợ lý AI")}
                </Button>
              </div>
              <MachineCockpitBody machineId={selectedId} embedded />
            </div>
          )
        }
      />
    </DashboardLayout>
  );
}
