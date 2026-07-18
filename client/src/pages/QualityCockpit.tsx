import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearch, useLocation } from "wouter";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader } from "@/components/patterns";
import { trpc } from "@/lib/trpc";
import { getSharedSocket, releaseSharedSocket } from "@/lib/socketManager";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Activity,
  BarChart3,
  MapPin,
  Shield,
  ShieldAlert,
  ShieldCheck,
  PenTool,
  Radio,
  Gauge,
  FlaskConical,
  BellRing,
  ClipboardCheck,
  Stethoscope,
} from "lucide-react";

import { SPCAnalysisContent } from "./SPCAnalysis";
import { DiagnoseTabGroup } from "./quality/DiagnoseTabGroup"; // doc 59 Cụm F
import { ParetoAnalysisContent } from "./ParetoAnalysis";
import { QualityGatesContent } from "./QualityGates";
import { AnnotationComparisonPageContent } from "./AnnotationComparisonPage";
import { ProductDefectHeatmap } from "@/components/ProductDefectHeatmap";
// Doc 35 F1/F4 (W3-B) — surface orphaned quality/MSA/SPC/calibration backends.
import { InstrumentCalibrationPanel } from "@/components/quality/InstrumentCalibrationPanel";
import { MsaGaugeRRPanel } from "@/components/quality/MsaGaugeRRPanel";
import { SpcAlertsPanel } from "@/components/quality/SpcAlertsPanel";
import { IpcAcceptancePanel } from "@/components/quality/IpcAcceptancePanel";
// Doc 27 gap A9 (W5-A): paired false-call ↔ escape tuning-tradeoff KPI.
import { FalseCallEscapePanel } from "@/components/FalseCallEscapePanel";
// Doc 27 gap V2 (W7-B): "Máy hay báo giả" — per-machine agreement/false-call
// ranking from the HARVESTED corrections ledger (complementary to the panel
// above, which reads inspection-row NTF flips only).
import { FalseCallTrendCard } from "@/components/FalseCallTrendCard";

function getDefaultDateRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);
  return {
    startDate: start.toISOString().split("T")[0],
    endDate: end.toISOString().split("T")[0],
  };
}

/** Shared scope (product / machine / time) for cockpit tabs that support it. */
interface CockpitScope {
  productModelId?: number;
  machineId?: number;
  startDate: string;
  endDate: string;
}

// ─── Shared scope selector ──────────────────────────────────────────────────
// No reusable ScopeSelector existed in the repo (only referenced in doc 12), so
// the cockpit ships a small inline one. The heatmap consumes it directly; SPC /
// Pareto keep their own richer filters but inherit the time window as defaults.
function ScopeSelector({
  scope,
  onChange,
}: {
  scope: CockpitScope;
  onChange: (next: CockpitScope) => void;
}) {
  const { t } = useTranslation();
  const { data: products } = trpc.productModel.list.useQuery(undefined as any);
  const { data: machines } = trpc.machine.list.useQuery();

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
          <div className="space-y-1">
            <Label>{t("common.product")}</Label>
            <Select
              value={scope.productModelId ? String(scope.productModelId) : "all"}
              onValueChange={(v) =>
                onChange({ ...scope, productModelId: v === "all" ? undefined : Number(v) })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder={t("common.all")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("common.all")}</SelectItem>
                {products?.map((p: any) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.code} – {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>{t("common.machine")}</Label>
            <Select
              value={scope.machineId ? String(scope.machineId) : "all"}
              onValueChange={(v) =>
                onChange({ ...scope, machineId: v === "all" ? undefined : Number(v) })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder={t("common.allMachines")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("common.allMachines")}</SelectItem>
                {machines?.map((m: any) => (
                  <SelectItem key={m.id} value={String(m.id)}>
                    {m.name ?? m.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>{t("common.startDate")}</Label>
            <Input
              type="date"
              aria-label={t("common.startDate")}
              value={scope.startDate}
              onChange={(e) => onChange({ ...scope, startDate: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label>{t("common.endDate")}</Label>
            <Input
              type="date"
              aria-label={t("common.endDate")}
              value={scope.endDate}
              onChange={(e) => onChange({ ...scope, endDate: e.target.value })}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Realtime gate status strip (Gates tab) ─────────────────────────────────
// Live active-breach summary. Subscribes to the shared `spc:violation` socket
// channel — quality-gate breaches are emitted on that same channel with a
// `quality_gate:<id>` ruleId (see qualityGateEvaluator.emitGateEvent) — and
// invalidates the activeEvents query so a new breach appears without a refresh.
function RealtimeGateStatus() {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const activeEventsQuery = trpc.qualityGate.activeEvents.useQuery(undefined, {
    refetchInterval: 30000,
  });
  const [lastBreach, setLastBreach] = useState<string | null>(null);

  useEffect(() => {
    const socket = getSharedSocket();
    const handler = (alert: { ruleId?: string; ruleName?: string; message?: string }) => {
      // Only react to quality-gate breaches (SPC rule violations are handled by
      // the SPC tab / global SPC toast).
      if (!alert?.ruleId?.startsWith("quality_gate:")) return;
      setLastBreach(`${alert.ruleName ?? t("qualityCockpit.gates.breach")} — ${alert.message ?? ""}`);
      toast.error(alert.ruleName ?? t("qualityCockpit.gates.breach"), {
        description: alert.message,
      });
      void utils.qualityGate.activeEvents.invalidate();
      void utils.qualityGate.events.invalidate();
    };
    socket.on("spc:violation", handler);
    socket.emit("subscribe", {});
    return () => {
      socket.off("spc:violation", handler);
      releaseSharedSocket();
    };
  }, [utils, t]);

  const activeCount = activeEventsQuery.data?.length ?? 0;

  return (
    <Card className={activeCount > 0 ? "border-destructive/50 bg-destructive/5" : "border-success/50 bg-success/5"}>
      <CardHeader className="py-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            {activeCount > 0 ? (
              <ShieldAlert className="h-5 w-5 text-destructive" />
            ) : (
              <ShieldCheck className="h-5 w-5 text-success" />
            )}
            {t("qualityCockpit.gates.realtimeStatus")}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Radio className="h-3.5 w-3.5 text-success animate-pulse" />
            <Badge variant={activeCount > 0 ? "destructive" : "secondary"}>
              {t("qualityCockpit.gates.activeBreaches", { count: activeCount })}
            </Badge>
          </div>
        </div>
        <CardDescription>
          {lastBreach
            ? `${t("qualityCockpit.gates.lastBreach")}: ${lastBreach}`
            : t("qualityCockpit.gates.noActiveBreaches")}
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

// Valid cockpit tab ids (also the deep-link `?tab=` targets the redirects use).
const VALID_TABS = [
  "spc", "pareto", "heatmap", "gates", "annotation",
  "alerts", "calibration", "msa", "ipc",
  "diagnose", // doc 59 Cụm F — nhóm điều tra (RCA/dự đoán/nhân quả/tương quan)
] as const;

export default function QualityCockpit() {
  const { t } = useTranslation();
  const search = useSearch();
  // Honour an inbound `?tab=` (legacy /spc-analysis, /pareto-analysis,
  // /quality-gates, /annotation-* redirect here with a tab param). Falls back
  // to SPC when absent/invalid.
  const initialTab = (() => {
    const tab = new URLSearchParams(search).get("tab");
    return tab && (VALID_TABS as readonly string[]).includes(tab) ? tab : "spc";
  })();
  const [scope, setScope] = useState<CockpitScope>(() => getDefaultDateRange());
  const [activeTab, setActiveTab] = useState(initialTab);
  const [, setLocation] = useLocation();

  // doc 36 W2 — write the active tab back to the URL so cockpit views are deep-linkable
  // from the app menu (and the browser's active-route highlight matches). Replace (no
  // history spam).
  const handleTabChange = (v: string) => {
    setActiveTab(v);
    setLocation(`/quality-cockpit?tab=${v}`, { replace: true });
  };

  const heatmapScope = useMemo(
    () => ({
      productModelId: scope.productModelId,
      machineId: scope.machineId,
      startDate: scope.startDate,
      endDate: scope.endDate,
    }),
    [scope],
  );

  return (
    <DashboardLayout title={t("qualityCockpit.title")}>
      <div className="space-y-4">
        <PageHeader
          icon={<Activity className="h-6 w-6" />}
          title={t("qualityCockpit.title")}
          description={t("qualityCockpit.subtitle")}
        />

        <ScopeSelector scope={scope} onChange={setScope} />

        {/* Doc 27 A9 — false-call ↔ escape paired KPI (AOI tuning trade-off),
            driven by the shared cockpit scope. */}
        <FalseCallEscapePanel
          scope={{
            machineId: scope.machineId,
            productModelId: scope.productModelId,
            startDate: scope.startDate,
            endDate: scope.endDate,
          }}
        />

        {/* Doc 27 V2 (W7-B) — "Máy hay báo giả": harvested-corrections agreement
            card (labels banked for training + per-machine false-call ranking). */}
        <FalseCallTrendCard
          scope={{
            machineId: scope.machineId,
            startDate: scope.startDate,
            endDate: scope.endDate,
          }}
        />

        <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
          <TabsList>
            <TabsTrigger value="spc" className="gap-2">
              <Activity className="h-4 w-4" />
              {t("qualityCockpit.tabs.spc")}
            </TabsTrigger>
            <TabsTrigger value="pareto" className="gap-2">
              <BarChart3 className="h-4 w-4" />
              {t("qualityCockpit.tabs.pareto")}
            </TabsTrigger>
            <TabsTrigger value="heatmap" className="gap-2">
              <MapPin className="h-4 w-4" />
              {t("qualityCockpit.tabs.heatmap")}
            </TabsTrigger>
            <TabsTrigger value="gates" className="gap-2">
              <Shield className="h-4 w-4" />
              {t("qualityCockpit.tabs.gates")}
            </TabsTrigger>
            <TabsTrigger value="annotation" className="gap-2">
              <PenTool className="h-4 w-4" />
              {t("qualityCockpit.tabs.annotation")}
            </TabsTrigger>
            <TabsTrigger value="alerts" className="gap-2">
              <BellRing className="h-4 w-4" />
              {t("qualityCockpit.tabs.alerts")}
            </TabsTrigger>
            <TabsTrigger value="calibration" className="gap-2">
              <Gauge className="h-4 w-4" />
              {t("qualityCockpit.tabs.calibration")}
            </TabsTrigger>
            <TabsTrigger value="msa" className="gap-2">
              <FlaskConical className="h-4 w-4" />
              {t("qualityCockpit.tabs.msa")}
            </TabsTrigger>
            <TabsTrigger value="ipc" className="gap-2">
              <ClipboardCheck className="h-4 w-4" />
              {t("qualityCockpit.tabs.ipc")}
            </TabsTrigger>
            <TabsTrigger value="diagnose" className="gap-2">
              <Stethoscope className="h-4 w-4" />
              {t("qualityCockpit.tabs.diagnose", "Chẩn đoán")}
            </TabsTrigger>
          </TabsList>

          {/* SPC chart + capability (embed canonical SPC engine UI) */}
          <TabsContent value="spc">
            <SPCAnalysisContent />
          </TabsContent>

          {/* Pareto */}
          <TabsContent value="pareto">
            <ParetoAnalysisContent />
          </TabsContent>

          {/* Defect heatmap — FIXED overlay on the product image */}
          <TabsContent value="heatmap">
            <ProductDefectHeatmap scope={heatmapScope} />
          </TabsContent>

          {/* Quality gate status (realtime) + management */}
          <TabsContent value="gates" className="space-y-4">
            <RealtimeGateStatus />
            <QualityGatesContent />
          </TabsContent>

          {/* Annotation — single canvas comparison tool */}
          <TabsContent value="annotation">
            <AnnotationComparisonPageContent />
          </TabsContent>

          {/* SPC OOC alerts (mp_spc_alerts) + top defect measurement points */}
          <TabsContent value="alerts">
            <SpcAlertsPanel
              scope={{
                productModelId: scope.productModelId,
                startDate: scope.startDate,
                endDate: scope.endDate,
              }}
            />
          </TabsContent>

          {/* Instrument calibration certificates + MSA records + RAG health */}
          <TabsContent value="calibration">
            <InstrumentCalibrationPanel />
          </TabsContent>

          {/* Advanced MSA / Gauge R&R (ANOVA) calculator */}
          <TabsContent value="msa">
            <MsaGaugeRRPanel />
          </TabsContent>

          {/* IPC-A-610 per-class acceptance profile */}
          <TabsContent value="ipc">
            <IpcAcceptancePanel />
          </TabsContent>

          {/* doc 59 Cụm F — điều tra (RCA/dự đoán/nhân quả/tương quan) cạnh SPC/Pareto */}
          <TabsContent value="diagnose">
            <DiagnoseTabGroup />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
