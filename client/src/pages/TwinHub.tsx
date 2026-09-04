/**
 * doc 39 Wave 4 — Digital Twin hub.  (doc 40 Wave 4b — ENG-F10 LIVE/SIM badges)
 *
 * Consolidates the six formerly-standalone twin / 3D surfaces into ONE tabbed hub at
 * /digital-twin with `?tab=` deep-links (legacy routes redirect in). Grouped Factory
 * (overview / 3D center / live map / floor editor) then Cell (cell player / RF cell).
 * Each tab renders that page's extracted `*Content` (body WITHOUT its own DashboardLayout).
 * Radix Tabs unmounts inactive TabsContent, so each 3D canvas mounts only when its tab is
 * active — no multiple simultaneous WebGL contexts.
 *
 * ENG-F10: the six tabs sat side-by-side with no cue that some render REAL live telemetry
 * while others replay a recorded SIMULATION. A newcomer could mistake the RF/cell playback
 * for a live cell. Each trigger now carries a data-provenance badge (LIVE / SIM / SƠ ĐỒ)
 * and a one-line legend under the tab strip states which tabs are real data.
 */
import { useState } from "react";
import { useSearch, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { LayoutDashboard, Boxes, Map, LayoutGrid, PlayCircle, Radio, Activity, Clapperboard, PencilRuler, Warehouse } from "lucide-react";

import { DigitalTwinDashboardContent } from "./DigitalTwinDashboard";
import { DigitalTwinCenterContent } from "./DigitalTwinCenter";
import { FactoryLiveMap3DContent } from "./FactoryLiveMap3D";
import { FactoryFloorEditorContent } from "./FactoryFloorEditor";
import { CellTwinPlayerContent } from "./CellTwinPlayer";
import { RfTestCellSimContent } from "./RfTestCellSim";
import { LayoutContent } from "./Layout";

/**
 * Data provenance of a tab:
 *  - "live" — reflects real machine/telemetry state right now.
 *  - "sim"  — replays a recorded / simulated cell (playback, not live).
 *  - "edit" — an authoring surface (layout editor), no runtime data.
 */
type TwinMode = "live" | "sim" | "edit";

export const TABS = [
  { value: "overview", labelKey: "twinHub.tabs.overview", fallback: "Tổng quan", icon: <LayoutDashboard className="h-4 w-4" />, mode: "live" as TwinMode, Content: DigitalTwinDashboardContent },
  { value: "center", labelKey: "twinHub.tabs.center", fallback: "Trung tâm 3D", icon: <Boxes className="h-4 w-4" />, mode: "live" as TwinMode, Content: DigitalTwinCenterContent },
  { value: "map", labelKey: "twinHub.tabs.map", fallback: "Bản đồ trực tiếp", icon: <Map className="h-4 w-4" />, mode: "live" as TwinMode, Content: FactoryLiveMap3DContent },
  { value: "floor", labelKey: "twinHub.tabs.floor", fallback: "Sửa mặt bằng", icon: <LayoutGrid className="h-4 w-4" />, mode: "edit" as TwinMode, Content: FactoryFloorEditorContent },
  // Task 1 Khối D — CRUD bố trí xưởng theo tên (layout.* + WorkshopLayoutEditor), khác "floor"
  // (kéo-thả vị trí máy trên mặt bằng). Cùng "edit" mode: đều là công cụ soạn, không dữ liệu runtime.
  { value: "layout", labelKey: "twinHub.tabs.layout", fallback: "Bố trí xưởng", icon: <Warehouse className="h-4 w-4" />, mode: "edit" as TwinMode, Content: LayoutContent },
  { value: "cell", labelKey: "twinHub.tabs.cell", fallback: "Bản sao cell", icon: <PlayCircle className="h-4 w-4" />, mode: "sim" as TwinMode, Content: CellTwinPlayerContent },
  { value: "rf", labelKey: "twinHub.tabs.rf", fallback: "Cell kiểm RF", icon: <Radio className="h-4 w-4" />, mode: "sim" as TwinMode, Content: RfTestCellSimContent },
] as const;

/** Small provenance pill rendered inside each TabsTrigger. Theme-aware. */
function ModeBadge({ mode }: { mode: TwinMode }) {
  const { t } = useTranslation();
  const spec: Record<TwinMode, { label: string; className: string; Icon: typeof Activity }> = {
    live: {
      label: t("twinHub.mode.live", "LIVE"),
      className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      Icon: Activity,
    },
    sim: {
      label: t("twinHub.mode.sim", "SIM"),
      className: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
      Icon: Clapperboard,
    },
    edit: {
      label: t("twinHub.mode.edit", "SƠ ĐỒ"),
      className: "border-border bg-muted text-muted-foreground",
      Icon: PencilRuler,
    },
  };
  const { label, className, Icon } = spec[mode];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-1.5 py-0 text-[0.6rem] font-semibold uppercase leading-4 tracking-wide",
        className,
      )}
    >
      <Icon className="h-2.5 w-2.5" aria-hidden="true" />
      {label}
    </span>
  );
}

export default function TwinHub() {
  const { t } = useTranslation();
  const search = useSearch();
  const [, setLocation] = useLocation();

  const valid = TABS.map((tab) => tab.value);
  const initialTab = (() => {
    const tab = new URLSearchParams(search).get("tab");
    return tab && (valid as readonly string[]).includes(tab) ? tab : "overview";
  })();
  const [activeTab, setActiveTab] = useState(initialTab);

  const handleTabChange = (v: string) => {
    setActiveTab(v);
    setLocation(`/digital-twin?tab=${v}`, { replace: true });
  };

  return (
    <DashboardLayout title={t("twinHub.title", "Bản sao số")}>
      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-3">
        <TabsList className="flex flex-wrap h-auto">
          {TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="gap-2">
              {tab.icon}
              {t(tab.labelKey, tab.fallback)}
              <ModeBadge mode={tab.mode} />
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Data-provenance legend — states plainly which tabs are real data. */}
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <ModeBadge mode="live" />
            {t("twinHub.legend.live", "Dữ liệu máy/telemetry thật, thời gian thực")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <ModeBadge mode="sim" />
            {t("twinHub.legend.sim", "Phát lại mô phỏng đã ghi — KHÔNG phải cell thật")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <ModeBadge mode="edit" />
            {t("twinHub.legend.edit", "Công cụ soạn sơ đồ mặt bằng")}
          </span>
        </p>

        {TABS.map((tab) => (
          <TabsContent key={tab.value} value={tab.value}>
            <tab.Content />
          </TabsContent>
        ))}
      </Tabs>
    </DashboardLayout>
  );
}
