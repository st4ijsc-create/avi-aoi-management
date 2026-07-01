import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearch } from "wouter";
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
} from "lucide-react";

import { SPCAnalysisContent } from "./SPCAnalysis";
import { ParetoAnalysisContent } from "./ParetoAnalysis";
import { QualityGatesContent } from "./QualityGates";
import { AnnotationComparisonPageContent } from "./AnnotationComparisonPage";
import { ProductDefectHeatmap } from "@/components/ProductDefectHeatmap";

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
              value={scope.startDate}
              onChange={(e) => onChange({ ...scope, startDate: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label>{t("common.endDate")}</Label>
            <Input
              type="date"
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
    <Card className={activeCount > 0 ? "border-red-500 bg-red-50 dark:bg-red-950/20" : "border-green-500 bg-green-50 dark:bg-green-950/20"}>
      <CardHeader className="py-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            {activeCount > 0 ? (
              <ShieldAlert className="h-5 w-5 text-red-600" />
            ) : (
              <ShieldCheck className="h-5 w-5 text-green-600" />
            )}
            {t("qualityCockpit.gates.realtimeStatus")}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Radio className="h-3.5 w-3.5 text-green-500 animate-pulse" />
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
const VALID_TABS = ["spc", "pareto", "heatmap", "gates", "annotation"] as const;

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

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
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
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
