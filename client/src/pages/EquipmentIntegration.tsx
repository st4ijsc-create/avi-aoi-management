/**
 * I1 (doc 16 §6 / §15) — EQUIPMENT INTEGRATION surface (Khối 1B).
 *
 * Read-mostly cockpit over the equipmentIntegrationRouter, organised into tabs:
 *   • "Integration status" (I1-a) — which adapter protocols are wired + the HONEST
 *       FOCAS/Euromap framework status. A framework with no connected device shows a
 *       "Framework — no device connected" badge; the Unified Equipment Model fields a
 *       snapshot WOULD carry (recipe_id, cycle_count, alarm_code, utilization_rate) are
 *       rendered with "—" when source:'none'. The honesty is stated explicitly.
 *   • "Recipe versions" (I1-b) — pick a recipe code → versions table (code, version,
 *       status badge). Actions create / release / archive / rollback (rollback confirms
 *       via AlertDialog) + record-load. All gated (machine_control/canCreate + flag).
 *   • "Load history" (I1-b) — append-only genealogy (who, code@version, machine, action,
 *       when) by machine OR by recipe code.
 *
 * SAFETY / HONESTY (mirrors the router): FOCAS/Euromap are READ-ONLY frameworks — no real
 * device is attached and no telemetry is fabricated; the UI never invents values. Recipe
 * mutations are METADATA/genealogy only — they open NO device-control path. Mutations are
 * gated behind EQ_INTEG_ENABLED; when the flag is OFF the page shows a calm preview banner
 * and surfaces the CONFLICT error gracefully (toast.info, not red). Read RBAC:
 * machine_monitoring/canView. Actions: machine_control/canCreate (hidden when absent).
 *
 * Uses the DS F1b pattern components (PageHeader / MetricCard / StatusBadge / SectionCard /
 * Heading / Text). i18n via the t("eqIntegration.*", "English default") fallback pattern.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import DashboardLayout from "@/components/DashboardLayout";
import { ViewOnlyBadge } from "@/components/PermissionGate";
import { buildBreadcrumbs } from "@/lib/breadcrumbs";
import { useLocation } from "wouter";
import {
  MetricCard,
  PageContainer,
  PageHeader,
  SectionCard,
  StatusBadge,
  Text,
} from "@/components/patterns";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Plug, RefreshCw, Info, Lock, AlertTriangle, Plus, Cpu, FlaskConical,
  History, Network, CheckCircle2, Send, Rocket, Archive, Undo2, Download,
  CircleSlash, Activity, Camera, Play, Square, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { mapTrpcError, toastTrpcError } from "@/lib/trpcErrors";
import { isFeatureDisabledError } from "@/lib/featureFlagError";

// ── Typesafe shapes inferred from the equipmentIntegrationRouter output ───────
type RouterOutputs = inferRouterOutputs<AppRouter>;
type IntegrationStatus = RouterOutputs["equipmentIntegration"]["integrationStatus"];
type FrameworkEntry = IntegrationStatus["frameworks"][number];
type FrameworkSnapshot = RouterOutputs["equipmentIntegration"]["frameworkSnapshot"];
type RecipeVersionList = RouterOutputs["equipmentIntegration"]["listRecipeVersions"];
type RecipeVersion = RecipeVersionList["versions"][number];
type LoadLogRow = RouterOutputs["equipmentIntegration"]["listLoadHistory"][number];
type MachineRow = RouterOutputs["machine"]["list"][number];

type FrameworkKind = "focas" | "euromap";

function pctOrDash(n: number | null): string {
  return n == null ? "—" : `${Math.round(n * 100)}%`;
}
function numOrDash(n: number | null): string {
  return n == null ? "—" : String(n);
}
function strOrDash(s: string | null): string {
  return s == null || s === "" ? "—" : s;
}

export default function EquipmentIntegration() {
  const { t } = useTranslation();
  // U3 (doc 26) — breadcrumb "Kỹ thuật › Section › Trang" + link về Hub.
  const [location] = useLocation();
  const crumbs = buildBreadcrumbs(location, t);
  const { hasPermission } = usePermissions();
  const canView = hasPermission("machine_monitoring", "canView");
  const canControl = hasPermission("machine_control", "canCreate");

  const [tab, setTab] = useState("status");

  // Recipe-versions tab state
  const [recipeCode, setRecipeCode] = useState("");
  const [activeCode, setActiveCode] = useState<string | null>(null);

  // Load-history tab state
  const [historyMode, setHistoryMode] = useState<"machine" | "code">("machine");
  const [historyMachineId, setHistoryMachineId] = useState<number | null>(null);
  const [historyCode, setHistoryCode] = useState("");
  const [activeHistoryCode, setActiveHistoryCode] = useState<string | null>(null);

  // Dialog / confirm state
  const [createOpen, setCreateOpen] = useState(false);
  const [loadFor, setLoadFor] = useState<RecipeVersion | null>(null);
  const [rollbackFor, setRollbackFor] = useState<RecipeVersion | null>(null);

  const utils = trpc.useUtils();

  // ── Reads (RBAC: machine_monitoring/canView) ────────────────────────────────
  const statusQ = trpc.equipmentIntegration.status.useQuery(undefined, { enabled: canView });
  const integrationQ = trpc.equipmentIntegration.integrationStatus.useQuery(undefined, { enabled: canView });
  const machinesQ = trpc.machine.list.useQuery(undefined, { enabled: canView });

  const versionsQ = trpc.equipmentIntegration.listRecipeVersions.useQuery(
    { code: activeCode ?? "" },
    { enabled: canView && !!activeCode, retry: false },
  );
  const loadHistoryQ = trpc.equipmentIntegration.listLoadHistory.useQuery(
    { machineId: historyMachineId ?? 0, limit: 200 },
    { enabled: canView && historyMode === "machine" && !!historyMachineId, retry: false },
  );
  const codeHistoryQ = trpc.equipmentIntegration.listCodeHistory.useQuery(
    { code: activeHistoryCode ?? "", limit: 200 },
    { enabled: canView && historyMode === "code" && !!activeHistoryCode, retry: false },
  );

  const integration = integrationQ.data as IntegrationStatus | undefined;
  const machines = (machinesQ.data ?? []) as MachineRow[];
  const versions = (versionsQ.data?.versions ?? []) as RecipeVersion[];
  const historyRows = (
    historyMode === "machine" ? loadHistoryQ.data : codeHistoryQ.data
  ) ?? [] as LoadLogRow[];

  const flagEnabled = statusQ.data?.enabled ?? true;

  const machineName = useMemo(() => {
    const m = new Map<number, string>();
    for (const mc of machines) m.set(mc.id, mc.name ?? mc.code ?? String(mc.id));
    return m;
  }, [machines]);

  const configuredCount = useMemo(
    () => (integration?.frameworks ?? []).filter((f) => f.configured).length,
    [integration],
  );

  const refetchAll = () => {
    void utils.equipmentIntegration.status.invalidate();
    void utils.equipmentIntegration.integrationStatus.invalidate();
    void utils.equipmentIntegration.listRecipeVersions.invalidate();
    void utils.equipmentIntegration.listLoadHistory.invalidate();
    void utils.equipmentIntegration.listCodeHistory.invalidate();
  };

  // Surface the FLAG-OFF CONFLICT gracefully (info, not a scary red error).
  const onMutationError = (e: { data?: { code?: string } | null; message: string }) => {
    if (isFeatureDisabledError(e)) {
      toast.info(t("eqIntegration.flagOffToast", "Equipment integration is disabled (preview). Set EQ_INTEG_ENABLED=true to act."));
      void utils.equipmentIntegration.status.invalidate();
    } else {
      toast.error(mapTrpcError(e));
    }
  };

  // ── Mutations (RBAC: machine_control/canCreate + EQ_INTEG_ENABLED) ───────────
  const createM = trpc.equipmentIntegration.createRecipeVersion.useMutation({
    onSuccess: () => { toast.success(t("eqIntegration.versionCreated", "Recipe version created (draft)")); setCreateOpen(false); refetchAll(); },
    onError: onMutationError,
  });
  const releaseM = trpc.equipmentIntegration.releaseRecipeVersion.useMutation({
    onSuccess: () => { toast.success(t("eqIntegration.versionReleased", "Version released")); refetchAll(); },
    onError: onMutationError,
  });
  const archiveM = trpc.equipmentIntegration.archiveRecipeVersion.useMutation({
    onSuccess: () => { toast.success(t("eqIntegration.versionArchived", "Version archived")); refetchAll(); },
    onError: onMutationError,
  });
  const rollbackM = trpc.equipmentIntegration.rollbackRecipeVersion.useMutation({
    onSuccess: () => { toast.success(t("eqIntegration.versionRolledBack", "Released contract rolled back")); setRollbackFor(null); refetchAll(); },
    onError: onMutationError,
  });
  const recordLoadM = trpc.equipmentIntegration.recordRecipeLoad.useMutation({
    onSuccess: () => { toast.success(t("eqIntegration.loadRecorded", "Recipe load recorded (genealogy)")); setLoadFor(null); refetchAll(); },
    onError: onMutationError,
  });

  const runVersionLookup = () => {
    const c = recipeCode.trim();
    if (c) setActiveCode(c);
  };
  const runHistoryCodeLookup = () => {
    const c = historyCode.trim();
    if (c) setActiveHistoryCode(c);
  };

  if (!canView) {
    return (
      <DashboardLayout>
        <div className="p-6">
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              <AlertTriangle className="mx-auto mb-2 h-6 w-6" />
              {t("eqIntegration.noPermission", "You do not have permission to view equipment integration.")}
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <PageContainer className="flex flex-col gap-4 space-y-0">
        {/* ── PageHeader (DS F1b shared pattern) ─────────────────────────────── */}
        <PageHeader
          breadcrumbs={crumbs}
          icon={<Plug className="h-6 w-6" />}
          title={t("eqIntegration.title", "Equipment Integration")}
          badge={!canControl ? <ViewOnlyBadge module="machine_control" /> : undefined}
          description={t("eqIntegration.subtitle", "Multi-vendor integration frameworks (FOCAS / Euromap, read-only) and recipe versioning genealogy — metadata only, no device commands.")}
          actions={
            <Button size="icon" variant="ghost" onClick={refetchAll} title={t("common.refresh", "Refresh")}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          }
        />

        {/* U7 (doc 26 §2.1) — "Khi nào dùng": trang LÀ GÌ / DÙNG KHI NÀO cho KTV mới. */}
        <div className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
          <span>{t("eqIntegration.whenToUse", "When to use — browse vendor integration frameworks (FOCAS/Euromap) and recipe version genealogy. Read-only metadata, no live device.")}</span>
        </div>

        {/* ── Flag-off preview banner (honest, calm) ─────────────────────────── */}
        {!flagEnabled && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <span>
              {t(
                "eqIntegration.flagOffBanner",
                "Preview mode: equipment integration is disabled (EQ_INTEG_ENABLED is off). Reads work; actions (create / release / archive / rollback version, record load) are blocked until the flag is enabled.",
              )}
            </span>
          </div>
        )}

        {/* Safety / honesty note — mirrors the router discipline */}
        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {t(
              "eqIntegration.safetyNote",
              "FOCAS/Euromap are read-only integration frameworks — no live device is attached and no telemetry is fabricated. Recipe versioning here is genealogy/metadata only; it opens no device-control path.",
            )}
          </span>
        </div>

        {/* ── KPI strip ──────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard
            icon={<Plug className="h-4 w-4" />}
            label={t("eqIntegration.kpi.adapters", "Adapters wired")}
            value={integration?.adapters.length ?? "—"}
          />
          <MetricCard
            icon={<Network className="h-4 w-4" />}
            label={t("eqIntegration.kpi.frameworks", "Frameworks")}
            value={integration?.frameworks.length ?? "—"}
          />
          <MetricCard
            icon={<CheckCircle2 className="h-4 w-4" />}
            label={t("eqIntegration.kpi.configured", "Connected devices")}
            value={integration ? configuredCount : "—"}
            tone={integration && configuredCount === 0 ? "warning" : "good"}
          />
          <MetricCard
            icon={<Activity className="h-4 w-4" />}
            label={t("eqIntegration.kpi.flag", "Flag")}
            value={flagEnabled ? t("eqIntegration.on", "On") : t("eqIntegration.off", "Off")}
            tone={flagEnabled ? "good" : "warning"}
          />
        </div>

        {/* ── Tabbed surface ─────────────────────────────────────────────────── */}
        <Tabs value={tab} onValueChange={setTab} className="gap-4">
          <TabsList className="flex-wrap">
            <TabsTrigger value="status"><Network className="mr-1 h-4 w-4" />{t("eqIntegration.tab.status", "Integration status")}</TabsTrigger>
            <TabsTrigger value="recipes"><FlaskConical className="mr-1 h-4 w-4" />{t("eqIntegration.tab.recipes", "Recipe versions")}</TabsTrigger>
            <TabsTrigger value="history"><History className="mr-1 h-4 w-4" />{t("eqIntegration.tab.history", "Load history")}</TabsTrigger>
            {/* W8-C (doc 27 V14 — W7-E's noted UI slot): acquisition worker status/start/stop. */}
            <TabsTrigger value="acquisition"><Camera className="mr-1 h-4 w-4" />{t("eqIntegration.tab.acquisition", "Acquisition workers")}</TabsTrigger>
          </TabsList>

          {/* ════════════════ TAB: Integration status (I1-a) ════════════════ */}
          <TabsContent value="status" className="flex flex-col gap-4">
            {/* Wired adapters */}
            <SectionCard
              icon={<Plug className="h-4 w-4" />}
              title={t("eqIntegration.adaptersTitle", "Wired adapter protocols")}
            >
              {integrationQ.isLoading && <Text tone="muted" variant="body-sm">{t("eqIntegration.loading", "Loading…")}</Text>}
              {integration && integration.adapters.length === 0 && (
                <Text tone="muted" variant="body-sm">{t("eqIntegration.noAdapters", "No adapter protocols registered.")}</Text>
              )}
              <div className="flex flex-wrap gap-1">
                {integration?.adapters.map((a) => (
                  <Badge key={a.kind} variant="outline" className="font-mono text-xs" title={`delegates to ${a.delegatesTo}`}>
                    {a.kind}
                  </Badge>
                ))}
              </div>
            </SectionCard>

            {/* Framework honesty note */}
            <div className="flex items-start gap-2 rounded-md border border-info/30 bg-info/10 p-3 text-sm">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" />
              <span className="text-muted-foreground">
                {t(
                  "eqIntegration.frameworkNote",
                  "The cards below are integration FRAMEWORKS. They model the read-only fields a real FOCAS/Euromap connector would map into the Unified Equipment Model, but live data requires a connected device/connector. Until then values stay \"—\" and the snapshot source is \"none\".",
                )}
              </span>
            </div>

            {/* Framework cards (FOCAS / Euromap) with honest snapshots */}
            <div className="grid gap-4 lg:grid-cols-2">
              {integration?.frameworks.map((fw) => (
                <FrameworkCard key={fw.kind} framework={fw} canView={canView} />
              ))}
            </div>
          </TabsContent>

          {/* ════════════════ TAB: Recipe versions (I1-b) ════════════════ */}
          <TabsContent value="recipes" className="flex flex-col gap-4">
            <SectionCard
              icon={<FlaskConical className="h-4 w-4" />}
              title={t("eqIntegration.pickRecipeTitle", "Recipe code")}
              action={canControl ? (
                <Button size="sm" variant="outline" className="h-8" onClick={() => setCreateOpen(true)}>
                  <Plus className="mr-1 h-4 w-4" />{t("eqIntegration.createVersion", "New version")}
                </Button>
              ) : undefined}
            >
              <div className="flex flex-wrap items-end gap-2">
                <div className="grid gap-1">
                  <Label className="text-xs text-muted-foreground">{t("eqIntegration.recipeCode", "Recipe code")}</Label>
                  <Input
                    className="w-56"
                    value={recipeCode}
                    placeholder="RCP-001"
                    onChange={(e) => setRecipeCode(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") runVersionLookup(); }}
                  />
                </div>
                <Button variant="outline" size="sm" disabled={!recipeCode.trim()} onClick={runVersionLookup}>
                  {t("eqIntegration.loadVersions", "Load versions")}
                </Button>
              </div>
            </SectionCard>

            <SectionCard
              icon={<FlaskConical className="h-4 w-4" />}
              title={activeCode
                ? t("eqIntegration.versionsTitle", "Versions of {{code}}").replace("{{code}}", activeCode)
                : t("eqIntegration.versionsTitlePlain", "Recipe versions")}
              contentClassName="p-0"
            >
              {!activeCode && (
                <div className="p-4">
                  <Text tone="muted" variant="body-sm">{t("eqIntegration.pickHint", "Enter a recipe code above to list its immutable versions and genealogy actions.")}</Text>
                </div>
              )}
              {activeCode && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("eqIntegration.col.code", "Code")}</TableHead>
                      <TableHead>{t("eqIntegration.col.name", "Name")}</TableHead>
                      <TableHead>{t("eqIntegration.col.version", "Version")}</TableHead>
                      <TableHead>{t("eqIntegration.col.status", "Status")}</TableHead>
                      <TableHead className="text-right">{t("common.actions", "Actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {versionsQ.isFetching && (
                      <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">{t("eqIntegration.loading", "Loading…")}</TableCell></TableRow>
                    )}
                    {!versionsQ.isFetching && versions.length === 0 && (
                      <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">{t("eqIntegration.versionsEmpty", "No versions for this code.")}</TableCell></TableRow>
                    )}
                    {versions.map((v) => (
                      <TableRow key={v.id}>
                        <TableCell className="font-mono text-xs">{v.code}</TableCell>
                        <TableCell className="text-xs">{v.name}</TableCell>
                        <TableCell className="font-mono text-xs">v{v.version}</TableCell>
                        <TableCell>
                          <StatusBadge status={v.designStatus} label={t(`eqIntegration.recipeStatus.${v.designStatus}`, v.designStatus)} />
                        </TableCell>
                        <TableCell className="text-right">
                          {canControl ? (
                            <div className="flex justify-end gap-1">
                              {v.designStatus === "draft" && (
                                <Button size="sm" variant="ghost" className="h-7" disabled={releaseM.isPending}
                                  title={t("eqIntegration.releaseTip", "Release this version (archives the current released one)")}
                                  onClick={() => releaseM.mutate({ recipeId: v.id })}>
                                  <Rocket className="mr-1 h-3.5 w-3.5 text-emerald-500" />{t("eqIntegration.release", "Release")}
                                </Button>
                              )}
                              {v.designStatus === "archived" && (
                                <Button size="sm" variant="ghost" className="h-7" disabled={rollbackM.isPending}
                                  title={t("eqIntegration.rollbackTip", "Roll the released contract back to this version")}
                                  onClick={() => setRollbackFor(v)}>
                                  <Undo2 className="mr-1 h-3.5 w-3.5" />{t("eqIntegration.rollback", "Rollback")}
                                </Button>
                              )}
                              {v.designStatus !== "archived" && (
                                <Button size="sm" variant="ghost" className="h-7" disabled={archiveM.isPending}
                                  title={t("eqIntegration.archiveTip", "Archive this version")}
                                  onClick={() => archiveM.mutate({ recipeId: v.id })}>
                                  <Archive className="mr-1 h-3.5 w-3.5" />{t("eqIntegration.archive", "Archive")}
                                </Button>
                              )}
                              <Button size="sm" variant="ghost" className="h-7" disabled={recordLoadM.isPending}
                                title={t("eqIntegration.loadTip", "Record that this version was loaded onto a machine (genealogy)")}
                                onClick={() => setLoadFor(v)}>
                                <Download className="mr-1 h-3.5 w-3.5" />{t("eqIntegration.recordLoad", "Record load")}
                              </Button>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">{t("eqIntegration.viewOnly", "View only")}</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </SectionCard>
          </TabsContent>

          {/* ════════════════ TAB: Load history / genealogy (I1-b) ════════════════ */}
          <TabsContent value="history" className="flex flex-col gap-4">
            <SectionCard
              icon={<History className="h-4 w-4" />}
              title={t("eqIntegration.historyPickTitle", "Genealogy source")}
            >
              <div className="flex flex-wrap items-end gap-2">
                <div className="grid gap-1">
                  <Label className="text-xs text-muted-foreground">{t("eqIntegration.historyMode", "Filter by")}</Label>
                  <Select value={historyMode} onValueChange={(v) => setHistoryMode(v as "machine" | "code")}>
                    <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="machine">{t("eqIntegration.byMachine", "Machine")}</SelectItem>
                      <SelectItem value="code">{t("eqIntegration.byCode", "Recipe code")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {historyMode === "machine" ? (
                  <div className="grid gap-1">
                    <Label className="text-xs text-muted-foreground">{t("eqIntegration.machine", "Machine")}</Label>
                    {/* U11 — Select DS; "__none__" là sentinel cho "chưa chọn máy". */}
                    <Select
                      value={historyMachineId != null ? String(historyMachineId) : "__none__"}
                      onValueChange={(v) => setHistoryMachineId(v === "__none__" ? null : Number(v))}
                    >
                      <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">{t("eqIntegration.selectMachine", "Select a machine…")}</SelectItem>
                        {machines.map((m) => (
                          <SelectItem key={m.id} value={String(m.id)}>{m.name ?? m.code} ({m.code})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <>
                    <div className="grid gap-1">
                      <Label className="text-xs text-muted-foreground">{t("eqIntegration.recipeCode", "Recipe code")}</Label>
                      <Input
                        className="w-56"
                        value={historyCode}
                        placeholder="RCP-001"
                        onChange={(e) => setHistoryCode(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") runHistoryCodeLookup(); }}
                      />
                    </div>
                    <Button variant="outline" size="sm" disabled={!historyCode.trim()} onClick={runHistoryCodeLookup}>
                      {t("eqIntegration.loadHistory", "Load history")}
                    </Button>
                  </>
                )}
              </div>
            </SectionCard>

            <SectionCard
              icon={<History className="h-4 w-4" />}
              title={t("eqIntegration.historyTitle", "Recipe genealogy (append-only)")}
              contentClassName="p-0"
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("eqIntegration.col.when", "When")}</TableHead>
                    <TableHead>{t("eqIntegration.col.action", "Action")}</TableHead>
                    <TableHead>{t("eqIntegration.col.recipe", "Code @ version")}</TableHead>
                    <TableHead>{t("eqIntegration.col.machine", "Machine")}</TableHead>
                    <TableHead>{t("eqIntegration.col.who", "Performed by")}</TableHead>
                    <TableHead>{t("eqIntegration.col.notes", "Notes")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(historyMode === "machine" ? loadHistoryQ.isFetching : codeHistoryQ.isFetching) && (
                    <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">{t("eqIntegration.loading", "Loading…")}</TableCell></TableRow>
                  )}
                  {historyMode === "machine" && !historyMachineId && (
                    <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">{t("eqIntegration.selectMachineHint", "Select a machine to view its recipe genealogy.")}</TableCell></TableRow>
                  )}
                  {historyMode === "code" && !activeHistoryCode && (
                    <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">{t("eqIntegration.selectCodeHint", "Enter a recipe code to view its genealogy across machines.")}</TableCell></TableRow>
                  )}
                  {((historyMode === "machine" && historyMachineId && !loadHistoryQ.isFetching) ||
                    (historyMode === "code" && activeHistoryCode && !codeHistoryQ.isFetching)) &&
                    historyRows.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">{t("eqIntegration.historyEmpty", "No genealogy events.")}</TableCell></TableRow>
                  )}
                  {historyRows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {row.createdAt ? new Date(row.createdAt).toLocaleString() : "—"}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={row.action} tone={ACTION_TONE[row.action] ?? "default"} label={t(`eqIntegration.action.${row.action}`, row.action)} />
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {row.recipeCode}{row.recipeVersion != null ? ` @v${row.recipeVersion}` : ""}
                      </TableCell>
                      <TableCell className="text-xs">
                        {row.machineId != null ? (machineName.get(row.machineId) ?? `#${row.machineId}`) : "—"}
                      </TableCell>
                      <TableCell className="text-xs">{row.performedBy != null ? `#${row.performedBy}` : "—"}</TableCell>
                      <TableCell className="max-w-[20rem] truncate text-xs text-muted-foreground" title={row.notes ?? undefined}>
                        {row.notes ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </SectionCard>
          </TabsContent>

          {/* ════════════ TAB: Acquisition workers (W8-C — doc 27 V14 UI slot) ════════════ */}
          <TabsContent value="acquisition" className="flex flex-col gap-4">
            <AcquisitionWorkersPanel />
          </TabsContent>
        </Tabs>
      </PageContainer>

      {/* ── Dialogs ──────────────────────────────────────────────────────────── */}
      {createOpen && (
        <CreateVersionDialog
          defaultCode={activeCode ?? recipeCode}
          machines={machines}
          pending={createM.isPending}
          onClose={() => setCreateOpen(false)}
          onSubmit={(v) => createM.mutate(v)}
        />
      )}
      {loadFor && (
        <RecordLoadDialog
          version={loadFor}
          machines={machines}
          pending={recordLoadM.isPending}
          onClose={() => setLoadFor(null)}
          onSubmit={(v) => recordLoadM.mutate(v)}
        />
      )}

      {/* ── Rollback confirm (AlertDialog) ──────────────────────────────────── */}
      <AlertDialog open={!!rollbackFor} onOpenChange={(o) => !o && setRollbackFor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("eqIntegration.rollbackConfirmTitle", "Roll back released contract?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "eqIntegration.rollbackConfirmBody",
                "This releases {{code}} v{{version}} and archives the current released version. It writes genealogy metadata only — no recipe is pushed to a device.",
              )
                .replace("{{code}}", rollbackFor?.code ?? "")
                .replace("{{version}}", String(rollbackFor?.version ?? ""))}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={rollbackM.isPending}
              onClick={() => { if (rollbackFor) rollbackM.mutate({ toRecipeId: rollbackFor.id }); }}
            >
              <Undo2 className="mr-1 h-4 w-4" />{t("eqIntegration.rollback", "Rollback")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}

// ── Action → tone for the genealogy table ─────────────────────────────────────
const ACTION_TONE: Record<string, "success" | "warning" | "info" | "default" | "error"> = {
  create: "default",
  release: "success",
  archive: "warning",
  rollback: "info",
  load: "info",
};

// ── Framework card (FOCAS / Euromap) with an honest read-only snapshot ─────────
function FrameworkCard({ framework, canView }: { framework: FrameworkEntry; canView: boolean }) {
  const { t } = useTranslation();
  const [machineCode, setMachineCode] = useState("");
  const [active, setActive] = useState<string | null>(null);

  const snapshotQ = trpc.equipmentIntegration.frameworkSnapshot.useQuery(
    { kind: framework.kind as FrameworkKind, machineCode: active ?? "" },
    { enabled: canView && !!active, retry: false },
  );
  const snap = snapshotQ.data as FrameworkSnapshot | undefined;

  const transports = "transports" in framework ? framework.transports : undefined;
  const readFunctions = "readFunctions" in framework ? framework.readFunctions : undefined;

  return (
    <SectionCard
      icon={<Cpu className="h-4 w-4" />}
      title={
        <span className="flex items-center gap-2">
          <span className="capitalize">{framework.kind}</span>
          <span className="text-xs font-normal text-muted-foreground">({framework.vendor})</span>
        </span>
      }
      action={
        framework.configured ? (
          <StatusBadge status="configured" tone="success" label={t("eqIntegration.configured", "Connected")} />
        ) : (
          <Badge variant="outline" className="border-warning/30 bg-warning/15 text-warning">
            <CircleSlash className="mr-1 h-3 w-3" />{t("eqIntegration.frameworkNoDevice", "Framework — no device connected")}
          </Badge>
        )
      }
    >
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-1">
          <Badge variant="outline" className="text-muted-foreground">{t("eqIntegration.readOnly", "read-only")}</Badge>
          {transports?.map((tr) => (
            <Badge key={tr} variant="secondary" className="font-mono text-xs">{tr}</Badge>
          ))}
          {readFunctions?.map((fn) => (
            <Badge key={fn} variant="secondary" className="font-mono text-xs">{fn}</Badge>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">{framework.caveat}</p>

        {/* Honest snapshot probe — UEM fields shown with "—" when source:'none' */}
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">{t("eqIntegration.machineCode", "Machine code")}</Label>
            <Input
              className="w-44"
              value={machineCode}
              placeholder="CNC-01"
              onChange={(e) => setMachineCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && machineCode.trim()) setActive(machineCode.trim()); }}
            />
          </div>
          <Button variant="outline" size="sm" disabled={!machineCode.trim()} onClick={() => setActive(machineCode.trim())}>
            {t("eqIntegration.readSnapshot", "Read snapshot")}
          </Button>
        </div>

        {active && snapshotQ.isFetching && <Text tone="muted" variant="body-sm">{t("eqIntegration.loading", "Loading…")}</Text>}
        {snap && !snapshotQ.isFetching && (
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <StatusBadge
                status={snap.source}
                tone={snap.source === "live" ? "success" : snap.source === "cache" ? "info" : "default"}
                label={t(`eqIntegration.source.${snap.source}`, snap.source)}
              />
              {!snap.connected && (
                <Badge variant="outline" className="text-muted-foreground">{t("eqIntegration.notConnected", "not connected")}</Badge>
              )}
              <span className="text-xs text-muted-foreground">
                {snap.at ? new Date(snap.at).toLocaleString() : t("eqIntegration.noReadout", "no readout")}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <UemField label={t("eqIntegration.uem.recipeId", "recipe_id")} value={strOrDash(snap.recipeId)} />
              <UemField label={t("eqIntegration.uem.cycleCount", "cycle_count")} value={numOrDash(snap.cycleCount)} />
              <UemField label={t("eqIntegration.uem.alarmCode", "alarm_code")} value={strOrDash(snap.alarmCode)} />
              <UemField label={t("eqIntegration.uem.utilization", "utilization_rate")} value={pctOrDash(snap.utilizationRate)} />
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

function UemField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="font-mono text-muted-foreground">{label}</span>
      <span className="font-mono font-medium">{value}</span>
    </div>
  );
}

// ── Create recipe-version dialog ───────────────────────────────────────────────
function CreateVersionDialog({
  defaultCode, machines, pending, onClose, onSubmit,
}: {
  defaultCode: string;
  machines: MachineRow[];
  pending: boolean;
  onClose: () => void;
  onSubmit: (v: { code: string; name: string; payload: Record<string, unknown>; machineId?: number; notes?: string }) => void;
}) {
  const { t } = useTranslation();
  const [code, setCode] = useState(defaultCode);
  const [name, setName] = useState("");
  const [machineId, setMachineId] = useState<number | null>(null);
  const [payloadText, setPayloadText] = useState("{}");
  const [notes, setNotes] = useState("");

  const submit = () => {
    if (!code.trim() || !name.trim()) {
      toast.error(t("eqIntegration.createRequired", "Code and name are required.")); return;
    }
    let payload: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(payloadText || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>;
      else { toast.error(t("eqIntegration.payloadObject", "Payload must be a JSON object.")); return; }
    } catch {
      toast.error(t("eqIntegration.payloadInvalid", "Payload is not valid JSON.")); return;
    }
    onSubmit({
      code: code.trim(),
      name: name.trim(),
      payload,
      machineId: machineId ?? undefined,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FlaskConical className="h-4 w-4" />{t("eqIntegration.createTitle", "New recipe version (draft)")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label>{t("eqIntegration.recipeCode", "Recipe code")}</Label>
              <Input value={code} placeholder="RCP-001" onChange={(e) => setCode(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>{t("eqIntegration.col.name", "Name")}</Label>
              <Input value={name} placeholder="Reflow profile A" onChange={(e) => setName(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1">
            <Label>{t("eqIntegration.machineOptional", "Machine (optional)")}</Label>
            {/* U11 — Select DS; "__none__" là sentinel cho "(none)". */}
            <Select value={machineId != null ? String(machineId) : "__none__"} onValueChange={(v) => setMachineId(v === "__none__" ? null : Number(v))}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t("eqIntegration.noMachine", "(none)")}</SelectItem>
                {machines.map((m) => <SelectItem key={m.id} value={String(m.id)}>{m.name ?? m.code} ({m.code})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label>{t("eqIntegration.payload", "Payload (JSON)")}</Label>
            <textarea
              className="flex min-h-[6rem] rounded-md border border-input bg-transparent px-2 py-1 font-mono text-xs"
              value={payloadText}
              onChange={(e) => setPayloadText(e.target.value)}
            />
          </div>
          <div className="grid gap-1">
            <Label>{t("eqIntegration.notes", "Notes")}</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel", "Cancel")}</Button>
          <Button onClick={submit} disabled={pending}><CheckCircle2 className="mr-1 h-4 w-4" />{t("eqIntegration.create", "Create version")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// W8-C (doc 27 V14, Đợt 7.6 follow-up) — Acquisition worker panel.
//
// UI over visionAdapter.acquisitionWorkerStatus / startAcquisitionWorker /
// stopAcquisitionWorker (W7-E built them API-only and documented THIS page as
// the panel slot). RBAC mirrors the router: machine_alerts/canView to read,
// machine_alerts/canCreate to start/stop. LIVE_ACQUISITION_ENABLED gates
// starting — the refusal reason from the server is surfaced verbatim (honest).
// ════════════════════════════════════════════════════════════════════════════

type AcqStatus = RouterOutputs["visionAdapter"]["acquisitionWorkerStatus"];
type AcqWorker = AcqStatus["workers"][number];

const ACQ_STATE_TONE: Record<string, "success" | "warning" | "error" | "default" | "info"> = {
  running: "success",
  completed: "info",
  stopped: "default",
  error: "error",
};

function AcquisitionWorkersPanel() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canViewAcq = hasPermission("machine_alerts", "canView");
  const canControlAcq = hasPermission("machine_alerts", "canCreate");
  const utils = trpc.useUtils();

  const [startOpen, setStartOpen] = useState(false);

  const statusQ = trpc.visionAdapter.acquisitionWorkerStatus.useQuery(undefined, {
    enabled: canViewAcq,
    refetchInterval: 5_000,
    retry: false,
  });
  const sourcesQ = trpc.visionAdapter.listAcquisitionSources.useQuery(undefined, {
    enabled: canViewAcq,
    retry: false,
    staleTime: 60_000,
  });

  const refresh = () => void utils.visionAdapter.acquisitionWorkerStatus.invalidate();

  const startM = trpc.visionAdapter.startAcquisitionWorker.useMutation({
    onSuccess: () => {
      toast.success(t("eqIntegration.acq.started", "Acquisition worker started"));
      setStartOpen(false);
      refresh();
    },
    // PRECONDITION_FAILED carries the server's honest refusal reason (flag off,
    // duplicate id, disabled config, source open failure) — show it verbatim.
    onError: (e) => toastTrpcError(e),
  });
  const stopM = trpc.visionAdapter.stopAcquisitionWorker.useMutation({
    onSuccess: () => {
      toast.success(t("eqIntegration.acq.stopped", "Acquisition worker stopped"));
      refresh();
    },
    onError: (e) => toastTrpcError(e),
  });

  if (!canViewAcq) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
        <Lock className="mt-0.5 h-4 w-4 shrink-0" />
        {t("eqIntegration.acq.noPermission", "Viewing acquisition workers requires the machine-alerts view permission.")}
      </div>
    );
  }

  const status = statusQ.data as AcqStatus | undefined;
  const workers = status?.workers ?? [];

  return (
    <>
      {/* Live-flag banner (honest gate — workers refuse to start when off) */}
      {status && !status.liveEnabled && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span>
            {t(
              "eqIntegration.acq.flagOff",
              "Live acquisition is disabled (LIVE_ACQUISITION_ENABLED is off). Status stays readable; starting a worker will be refused until the flag is enabled.",
            )}
          </span>
        </div>
      )}

      <SectionCard
        icon={<Camera className="h-4 w-4" />}
        title={t("eqIntegration.acq.title", "Acquisition workers")}
        description={t(
          "eqIntegration.acq.desc",
          "Grab → quality metrics → optional NTF submit through the same canonical ingest path. File/mock sources are real today; GenICam stays a stub until a camera driver is bound.",
        )}
        action={
          <div className="flex items-center gap-1">
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={refresh} title={t("common.refresh", "Refresh")}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            {canControlAcq && (
              <Button size="sm" variant="outline" className="h-8" onClick={() => setStartOpen(true)}>
                <Play className="mr-1 h-4 w-4" />
                {t("eqIntegration.acq.start", "Start worker")}
              </Button>
            )}
          </div>
        }
        contentClassName="p-0"
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("eqIntegration.acq.col.id", "Worker")}</TableHead>
              <TableHead>{t("eqIntegration.col.status", "Status")}</TableHead>
              <TableHead>{t("eqIntegration.acq.col.source", "Source")}</TableHead>
              <TableHead className="text-right">{t("eqIntegration.acq.col.frames", "Frames")}</TableHead>
              <TableHead className="text-right">{t("eqIntegration.acq.col.submitted", "Submitted")}</TableHead>
              <TableHead className="text-right">{t("eqIntegration.acq.col.errors", "Errors")}</TableHead>
              <TableHead>{t("eqIntegration.acq.col.last", "Last frame / error")}</TableHead>
              {canControlAcq && <TableHead className="text-right">{t("common.actions", "Actions")}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {statusQ.isLoading && (
              <TableRow>
                <TableCell colSpan={canControlAcq ? 8 : 7} className="py-8 text-center text-muted-foreground">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </TableCell>
              </TableRow>
            )}
            {!statusQ.isLoading && workers.length === 0 && (
              <TableRow>
                <TableCell colSpan={canControlAcq ? 8 : 7} className="py-8 text-center text-muted-foreground">
                  {t("eqIntegration.acq.empty", "No acquisition workers registered in this server session.")}
                </TableCell>
              </TableRow>
            )}
            {workers.map((w: AcqWorker) => {
              const lastEntry = w.ledger.length > 0 ? w.ledger[w.ledger.length - 1] : null;
              return (
                <TableRow key={w.id}>
                  <TableCell>
                    <span className="font-mono text-xs font-medium">{w.id}</span>
                    <p className="text-[10px] text-muted-foreground">
                      {t("eqIntegration.acq.since", "since")} {new Date(w.startedAt).toLocaleString()}
                      {w.stoppedAt ? ` → ${new Date(w.stoppedAt).toLocaleTimeString()}` : ""}
                    </p>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={w.state} tone={ACQ_STATE_TONE[w.state] ?? "default"} label={t(`eqIntegration.acq.state.${w.state}`, w.state)} />
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="font-mono text-[11px]">{w.config.source.kind}</Badge>
                    {w.config.submit && (
                      <Badge variant="outline" className="ml-1 text-[10px]" title={w.config.machineCode ?? undefined}>
                        {t("eqIntegration.acq.submits", "submits NTF")}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">{w.framesGrabbed}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{w.submitted}</TableCell>
                  <TableCell className={`text-right font-mono text-xs ${w.errors > 0 ? "text-destructive" : ""}`}>{w.errors}</TableCell>
                  <TableCell className="max-w-56">
                    {w.lastError ? (
                      <span className="block truncate text-xs text-destructive" title={w.lastError}>{w.lastError}</span>
                    ) : lastEntry ? (
                      <span className="text-xs text-muted-foreground">
                        #{lastEntry.frameId} · {new Date(lastEntry.at).toLocaleTimeString()}
                        {lastEntry.quality
                          ? lastEntry.quality.acceptable
                            ? ` · ${t("eqIntegration.acq.qualityOk", "quality OK")}`
                            : ` · ${t("eqIntegration.acq.qualityBad", "quality poor")}`
                          : ""}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  {canControlAcq && (
                    <TableCell className="text-right">
                      {w.state === "running" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-destructive hover:text-destructive/80"
                          disabled={stopM.isPending}
                          onClick={() => stopM.mutate({ id: w.id })}
                        >
                          <Square className="mr-1 h-3.5 w-3.5" />
                          {t("eqIntegration.acq.stop", "Stop")}
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </SectionCard>

      {/* Discovery card — which source kinds are genuinely usable now */}
      {sourcesQ.data && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span>{t("eqIntegration.acq.sources", "Source kinds")}:</span>
          {sourcesQ.data.sources.map((s: { kind: string; available: boolean; description?: string }) => (
            <Badge
              key={s.kind}
              variant="outline"
              className={`font-mono text-[10px] ${s.available ? "" : "text-muted-foreground line-through"}`}
              title={s.description}
            >
              {s.kind}
            </Badge>
          ))}
        </div>
      )}

      {startOpen && (
        <StartAcquisitionWorkerDialog
          pending={startM.isPending}
          onClose={() => setStartOpen(false)}
          onSubmit={(cfg) => startM.mutate(cfg)}
        />
      )}
    </>
  );
}

// ── Start-worker dialog (file / mock — the sources that are REAL today) ────────
function StartAcquisitionWorkerDialog({
  pending, onClose, onSubmit,
}: {
  pending: boolean;
  onClose: () => void;
  onSubmit: (cfg: {
    id: string;
    source: { kind: "file"; directory?: string; loop?: boolean } | { kind: "mock"; width?: number; height?: number; maxFrames?: number };
    machineCode?: string;
    intervalMs?: number;
    maxFrames?: number;
    submit?: boolean;
    assessQuality?: boolean;
  }) => void;
}) {
  const { t } = useTranslation();
  const [id, setId] = useState("");
  const [kind, setKind] = useState<"file" | "mock">("file");
  const [directory, setDirectory] = useState("");
  const [loop, setLoop] = useState(false);
  const [mockMaxFrames, setMockMaxFrames] = useState("20");
  const [intervalMs, setIntervalMs] = useState("2000");
  const [submit, setSubmit] = useState(false);
  const [machineCode, setMachineCode] = useState("");
  const [assessQuality, setAssessQuality] = useState(true);

  const doSubmit = () => {
    if (!id.trim()) {
      toast.error(t("eqIntegration.acq.idRequired", "Worker id is required.")); return;
    }
    if (kind === "file" && !directory.trim()) {
      toast.error(t("eqIntegration.acq.dirRequired", "Directory is required for a file source.")); return;
    }
    if (submit && !machineCode.trim()) {
      toast.error(t("eqIntegration.acq.machineRequired", "Submitting frames requires a machine code.")); return;
    }
    onSubmit({
      id: id.trim(),
      source: kind === "file"
        ? { kind: "file", directory: directory.trim(), loop }
        : { kind: "mock", maxFrames: Math.max(0, parseInt(mockMaxFrames) || 0) },
      machineCode: machineCode.trim() || undefined,
      intervalMs: Math.min(3_600_000, Math.max(50, parseInt(intervalMs) || 2000)),
      submit,
      assessQuality,
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-4 w-4" />
            {t("eqIntegration.acq.startTitle", "Start acquisition worker")}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <p className="text-xs text-muted-foreground">
            {t(
              "eqIntegration.acq.startHint",
              "File source replays a capture folder; mock generates synthetic frames. Submission stamps NTF ('needs inspection') — acquisition is not judgement.",
            )}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label>{t("eqIntegration.acq.col.id", "Worker")}</Label>
              <Input value={id} placeholder="replay-line1" onChange={(e) => setId(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>{t("eqIntegration.acq.kind", "Source kind")}</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as "file" | "mock")}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="file">file</SelectItem>
                  <SelectItem value="mock">mock</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {kind === "file" ? (
            <>
              <div className="grid gap-1">
                <Label>{t("eqIntegration.acq.directory", "Directory (on the server)")}</Label>
                <Input value={directory} placeholder="D:\\captures\\line1" onChange={(e) => setDirectory(e.target.value)} />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={loop} onCheckedChange={(v) => setLoop(Boolean(v))} />
                {t("eqIntegration.acq.loop", "Loop the folder (soak test)")}
              </label>
            </>
          ) : (
            <div className="grid gap-1">
              <Label>{t("eqIntegration.acq.maxFrames", "Max frames (0 = until stopped)")}</Label>
              <Input type="number" min={0} value={mockMaxFrames} onChange={(e) => setMockMaxFrames(e.target.value)} />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label>{t("eqIntegration.acq.interval", "Interval (ms)")}</Label>
              <Input type="number" min={50} value={intervalMs} onChange={(e) => setIntervalMs(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>{t("eqIntegration.machineCode", "Machine code")}</Label>
              <Input value={machineCode} placeholder="AOI-01" onChange={(e) => setMachineCode(e.target.value)} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={submit} onCheckedChange={(v) => setSubmit(Boolean(v))} />
            {t("eqIntegration.acq.submitFrames", "Submit each frame as a canonical NTF inspection (requires machine code)")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={assessQuality} onCheckedChange={(v) => setAssessQuality(Boolean(v))} />
            {t("eqIntegration.acq.assessQuality", "Run image-quality metrics per frame")}
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel", "Cancel")}</Button>
          <Button onClick={doSubmit} disabled={pending}>
            {pending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            <Play className="mr-1 h-4 w-4" />
            {t("eqIntegration.acq.start", "Start worker")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Record-load dialog ─────────────────────────────────────────────────────────
function RecordLoadDialog({
  version, machines, pending, onClose, onSubmit,
}: {
  version: RecipeVersion;
  machines: MachineRow[];
  pending: boolean;
  onClose: () => void;
  onSubmit: (v: { recipeId: number; machineId: number; deploy: boolean; notes?: string }) => void;
}) {
  const { t } = useTranslation();
  const [machineId, setMachineId] = useState<number | null>(version.machineId ?? null);
  const [deploy, setDeploy] = useState(false);
  const [notes, setNotes] = useState("");

  const submit = () => {
    if (!machineId) { toast.error(t("eqIntegration.machineRequired", "Select a machine.")); return; }
    onSubmit({ recipeId: version.id, machineId, deploy, notes: notes.trim() || undefined });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Download className="h-4 w-4" />{t("eqIntegration.recordLoadTitle", "Record recipe load")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <p className="text-xs text-muted-foreground">
            {t("eqIntegration.recordLoadHint", "Records that {{code}} v{{version}} was loaded onto a machine (genealogy). This opens no device path; a select_recipe command still routes through the gated dispatcher.")
              .replace("{{code}}", version.code)
              .replace("{{version}}", String(version.version))}
          </p>
          <div className="grid gap-1">
            <Label>{t("eqIntegration.machine", "Machine")}</Label>
            {/* U11 — Select DS; "__none__" là sentinel cho "chưa chọn máy". */}
            <Select value={machineId != null ? String(machineId) : "__none__"} onValueChange={(v) => setMachineId(v === "__none__" ? null : Number(v))}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t("eqIntegration.selectMachine", "Select a machine…")}</SelectItem>
                {machines.map((m) => <SelectItem key={m.id} value={String(m.id)}>{m.name ?? m.code} ({m.code})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={deploy} onCheckedChange={(v) => setDeploy(Boolean(v))} />
            {t("eqIntegration.alsoDeploy", "Also write a recipe_deployments ledger row")}
          </label>
          <div className="grid gap-1">
            <Label>{t("eqIntegration.notes", "Notes")}</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel", "Cancel")}</Button>
          <Button onClick={submit} disabled={pending}><Send className="mr-1 h-4 w-4" />{t("eqIntegration.recordLoad", "Record load")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
