/**
 * doc 39 Wave 4 — Digital Twin hub.
 *
 * Consolidates the six formerly-standalone twin / 3D surfaces into ONE tabbed hub at
 * /digital-twin with `?tab=` deep-links (legacy routes redirect in). Grouped Factory
 * (overview / 3D center / live map / floor editor) then Cell (cell player / RF cell).
 * Each tab renders that page's extracted `*Content` (body WITHOUT its own DashboardLayout).
 * Radix Tabs unmounts inactive TabsContent, so each 3D canvas mounts only when its tab is
 * active — no multiple simultaneous WebGL contexts.
 */
import { useState } from "react";
import { useSearch, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LayoutDashboard, Boxes, Map, LayoutGrid, PlayCircle, Radio } from "lucide-react";

import { DigitalTwinDashboardContent } from "./DigitalTwinDashboard";
import { DigitalTwinCenterContent } from "./DigitalTwinCenter";
import { FactoryLiveMap3DContent } from "./FactoryLiveMap3D";
import { FactoryFloorEditorContent } from "./FactoryFloorEditor";
import { CellTwinPlayerContent } from "./CellTwinPlayer";
import { RfTestCellSimContent } from "./RfTestCellSim";

const TABS = [
  { value: "overview", labelKey: "twinHub.tabs.overview", fallback: "Overview", icon: <LayoutDashboard className="h-4 w-4" />, Content: DigitalTwinDashboardContent },
  { value: "center", labelKey: "twinHub.tabs.center", fallback: "3D Center", icon: <Boxes className="h-4 w-4" />, Content: DigitalTwinCenterContent },
  { value: "map", labelKey: "twinHub.tabs.map", fallback: "Live Map", icon: <Map className="h-4 w-4" />, Content: FactoryLiveMap3DContent },
  { value: "floor", labelKey: "twinHub.tabs.floor", fallback: "Floor Editor", icon: <LayoutGrid className="h-4 w-4" />, Content: FactoryFloorEditorContent },
  { value: "cell", labelKey: "twinHub.tabs.cell", fallback: "Cell Twin", icon: <PlayCircle className="h-4 w-4" />, Content: CellTwinPlayerContent },
  { value: "rf", labelKey: "twinHub.tabs.rf", fallback: "RF Test Cell", icon: <Radio className="h-4 w-4" />, Content: RfTestCellSimContent },
] as const;

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
    <DashboardLayout title={t("twinHub.title", "Digital Twin")}>
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
