/**
 * E1 (doc 16 §10 / §12) — EQUIPMENT STANDARDS & GOVERNANCE surface (Khối 5).
 *
 * Read-mostly governance cockpit over the equipmentStandardsRouter, organised into tabs:
 *   • "Hierarchy" (E1-a)  — versioned Device Type tree (Equipment→Robot→CollaborativeRobot,
 *       Inspection/TestCell/ProcessAutomation + leaf classes). Select a node → resolveType
 *       shows the fully-merged attributes / commands / PackML states / extension. A
 *       "register device type" dialog (gated).
 *   • "Alarm taxonomy" (E1-b) — ISA-18.2 alarm mappings table (vendor, nativeCode→standardCode,
 *       severity, recommended action) + a vendor/native lookup (mapAlarm) and an upsert dialog.
 *   • "Change requests" (E1-c) — Equipment Standards Board board: status / conformance / stage
 *       badges + backward-incompatible warning. Submit-CR dialog + review/publish actions (gated;
 *       publish surfaces the backward-compat / conformance gate result via toast).
 *   • "Compliance" (E1-e + E1-d) — complianceMetrics detail (KPIs + unmapped types + failing
 *       types) and a "run conformance" action (E1-d) with a pass/fail bar chart + violations.
 *
 * SAFETY / NO-OP (mirrors the router): every write here is GOVERNANCE METADATA only (versioning,
 * taxonomy, change-requests) — it opens NO device-control path. Mutations are gated behind
 * EQ_GOVERN_ENABLED. When the flag is OFF the page shows an honest "preview" banner and surfaces
 * the CONFLICT error gracefully (toast.info, not red). Read RBAC: machine_monitoring/canView.
 * Actions: machine_control/canCreate (hidden when absent).
 *
 * Uses the DS F1b pattern components (PageHeader / MetricCard / StatusBadge / SectionCard /
 * Heading / Text). i18n via the t("eqStandards.*", "English default") fallback pattern.
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
  Heading,
  Text,
  chartTooltipStyle,
  chartGridProps,
  chartAxisTick,
} from "@/components/patterns";
// doc 63 AUD-08 — alarm badge 4-hue riêng (critical≠high) khi HMI_ISA101_V2 bật.
import { AlarmPriorityBadge } from "@/components/patterns/isaStateBadges";
import { isIsa101V2 } from "@/lib/hmiFlags";
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
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ResponsiveContainer, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Cell,
} from "recharts";
import {
  ShieldCheck, RefreshCw, Info, Lock, AlertTriangle, Plus, Search, Link2,
  Network, Bell, GitPullRequest, ClipboardCheck, ChevronRight, ChevronDown,
  Boxes, Cpu, Tags, Wrench, CheckCircle2, XCircle, Send, Eye, Rocket, Layers, Activity,
} from "lucide-react";
import { toast } from "sonner";
import { mapTrpcError } from "@/lib/trpcErrors";
import { isFeatureDisabledError } from "@/lib/featureFlagError";

// ── Typesafe shapes inferred from the equipmentStandardsRouter output ─────────
type RouterOutputs = inferRouterOutputs<AppRouter>;
type HierarchyTree = RouterOutputs["equipmentStandards"]["hierarchyTree"];
type TreeNode = HierarchyTree["tree"][number];
type ResolvedType = RouterOutputs["equipmentStandards"]["resolveType"];
type AlarmList = RouterOutputs["equipmentStandards"]["listAlarmMappings"];
type AlarmMapping = AlarmList["mappings"][number];
type MappedAlarm = RouterOutputs["equipmentStandards"]["mapAlarm"];
type ChangeRequest = RouterOutputs["equipmentStandards"]["listChangeRequests"][number];
type Conformance = RouterOutputs["equipmentStandards"]["runConformance"];
type Compliance = RouterOutputs["equipmentStandards"]["complianceMetrics"];
type AlarmKpis = RouterOutputs["equipmentStandards"]["alarmKpis"];
type MasterAlarmRow = RouterOutputs["equipmentStandards"]["listMasterAlarms"][number];

const CONSEQUENCES = ["none", "minor", "major", "severe"] as const;
type Consequence = (typeof CONSEQUENCES)[number];

const PRIORITY_TONE: Record<string, "error" | "warning" | "info" | "success" | "default"> = {
  critical: "error", high: "error", medium: "warning", low: "info",
};

// doc 63 AUD-08 — tone system chỉ có 5 tông nên critical/high từng CÙNG màu đỏ.
// Khi HMI_ISA101_V2 bật, badge priority/severity chuyển sang AlarmPriorityBadge
// (4 hue riêng qua token --alarm-*: đỏ25/cam55/amber85/vàng-nhạt95) — hết nhầm P1 vs P2.
function PriorityBadge({ value, label }: { value: string; label: string }) {
  if (isIsa101V2()) return <AlarmPriorityBadge state={value} label={label} />;
  return <StatusBadge status={value} tone={PRIORITY_TONE[value] ?? "default"} label={label} />;
}

const SEVERITIES = ["critical", "high", "medium", "low", "diagnostic"] as const;
type Severity = (typeof SEVERITIES)[number];

const SEVERITY_TONE: Record<Severity, "error" | "warning" | "info" | "success" | "default"> = {
  critical: "error",
  high: "error",
  medium: "warning",
  low: "info",
  diagnostic: "default",
};

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export default function EquipmentStandards() {
  const { t } = useTranslation();
  // U3 (doc 26) — breadcrumb "Kỹ thuật › Section › Trang" + link về Hub.
  const [location] = useLocation();
  const crumbs = buildBreadcrumbs(location, t);
  const { hasPermission } = usePermissions();
  const canView = hasPermission("machine_monitoring", "canView");
  const canControl = hasPermission("machine_control", "canCreate");
  // U4 (doc 26 §2.4) — hiện-nhưng-khoá: lý do khi thiếu quyền điều khiển máy.
  const permReason = !canControl
    ? t("common.gate.needPerm", "Requires {{perm}} permission", { perm: "machine_control" })
    : undefined;

  const [tab, setTab] = useState("hierarchy");
  const [selectedTypeKey, setSelectedTypeKey] = useState<string | null>(null);
  const [vendorFilter, setVendorFilter] = useState<string>("");
  const [crStatusFilter, setCrStatusFilter] = useState<string>("");

  // Lookup state
  const [lookupVendor, setLookupVendor] = useState("");
  const [lookupCode, setLookupCode] = useState("");
  const [lookup, setLookup] = useState<{ vendor: string; nativeCode: string } | null>(null);

  // Dialog state
  const [registerOpen, setRegisterOpen] = useState(false);
  const [upsertAlarmOpen, setUpsertAlarmOpen] = useState(false);
  const [submitCrOpen, setSubmitCrOpen] = useState(false);
  const [runConfReq, setRunConfReq] = useState(false);
  // W5-21 — alarm performance state
  const [kpiWindow, setKpiWindow] = useState(7);
  const [masterAlarmOpen, setMasterAlarmOpen] = useState(false);
  const [editMaster, setEditMaster] = useState<MasterAlarmRow | null>(null);

  const utils = trpc.useUtils();

  // ── Reads (RBAC: machine_monitoring/canView) ────────────────────────────────
  const statusQ = trpc.equipmentStandards.status.useQuery(undefined, { enabled: canView });
  const treeQ = trpc.equipmentStandards.hierarchyTree.useQuery(undefined, { enabled: canView });
  const resolveQ = trpc.equipmentStandards.resolveType.useQuery(
    { typeKey: selectedTypeKey ?? "" },
    { enabled: canView && !!selectedTypeKey, retry: false },
  );
  const alarmsQ = trpc.equipmentStandards.listAlarmMappings.useQuery(
    vendorFilter ? { vendor: vendorFilter } : undefined,
    { enabled: canView },
  );
  const mapAlarmQ = trpc.equipmentStandards.mapAlarm.useQuery(
    { vendor: lookup?.vendor ?? "", nativeCode: lookup?.nativeCode ?? "" },
    { enabled: canView && !!lookup, retry: false },
  );
  const crsQ = trpc.equipmentStandards.listChangeRequests.useQuery(
    crStatusFilter ? { status: crStatusFilter, limit: 200 } : { limit: 200 },
    { enabled: canView },
  );
  const complianceQ = trpc.equipmentStandards.complianceMetrics.useQuery(undefined, { enabled: canView });
  const conformanceQ = trpc.equipmentStandards.runConformance.useQuery(undefined, {
    enabled: canView && runConfReq,
    retry: false,
  });
  const kpisQ = trpc.equipmentStandards.alarmKpis.useQuery(
    { windowDays: kpiWindow, operatorCount: 1 },
    { enabled: canView },
  );
  const mastersQ = trpc.equipmentStandards.listMasterAlarms.useQuery(undefined, { enabled: canView });

  const tree = (treeQ.data?.tree ?? []) as TreeNode[];
  const resolved = resolveQ.data as ResolvedType | undefined;
  const alarms = (alarmsQ.data?.mappings ?? []) as AlarmMapping[];
  const vendors = (alarmsQ.data?.vendors ?? []) as string[];
  const mapped = mapAlarmQ.data as MappedAlarm | undefined;
  const crs = (crsQ.data ?? []) as ChangeRequest[];
  const compliance = complianceQ.data as Compliance | undefined;
  const conformance = conformanceQ.data as Conformance | undefined;
  const kpis = kpisQ.data as AlarmKpis | undefined;
  const masters = (mastersQ.data ?? []) as MasterAlarmRow[];

  const flagEnabled = statusQ.data?.enabled ?? true;

  const refetchAll = () => {
    void utils.equipmentStandards.status.invalidate();
    void utils.equipmentStandards.hierarchyTree.invalidate();
    void utils.equipmentStandards.resolveType.invalidate();
    void utils.equipmentStandards.listAlarmMappings.invalidate();
    void utils.equipmentStandards.listChangeRequests.invalidate();
    void utils.equipmentStandards.complianceMetrics.invalidate();
    void utils.equipmentStandards.runConformance.invalidate();
    void utils.equipmentStandards.alarmKpis.invalidate();
    void utils.equipmentStandards.listMasterAlarms.invalidate();
  };

  // Surface the FLAG-OFF CONFLICT gracefully (info, not a scary red error).
  const onMutationError = (e: { data?: { code?: string } | null; message: string }) => {
    if (isFeatureDisabledError(e)) {
      toast.info(t("eqStandards.flagOffToast", "Equipment governance is disabled (preview). Set EQ_GOVERN_ENABLED=true to act."));
      void utils.equipmentStandards.status.invalidate();
    } else {
      toast.error(mapTrpcError(e));
    }
  };

  // ── Mutations (RBAC: machine_control/canCreate + EQ_GOVERN_ENABLED) ──────────
  const registerM = trpc.equipmentStandards.registerDeviceType.useMutation({
    onSuccess: () => { toast.success(t("eqStandards.typeRegistered", "Device type registered (draft)")); setRegisterOpen(false); refetchAll(); },
    onError: onMutationError,
  });
  const upsertAlarmM = trpc.equipmentStandards.upsertAlarmMapping.useMutation({
    onSuccess: () => { toast.success(t("eqStandards.alarmSaved", "Alarm mapping saved")); setUpsertAlarmOpen(false); refetchAll(); },
    onError: onMutationError,
  });
  const submitCrM = trpc.equipmentStandards.submitChangeRequest.useMutation({
    onSuccess: () => { toast.success(t("eqStandards.crSubmitted", "Change request submitted")); setSubmitCrOpen(false); refetchAll(); },
    onError: onMutationError,
  });
  const reviewCrM = trpc.equipmentStandards.reviewChangeRequest.useMutation({
    onSuccess: () => { toast.success(t("eqStandards.crReviewed", "Change request updated")); refetchAll(); },
    onError: onMutationError,
  });
  const publishCrM = trpc.equipmentStandards.publishChangeRequest.useMutation({
    onSuccess: (r) => {
      const dec = r && "decision" in r ? r.decision : undefined;
      toast.success(
        t("eqStandards.crPublished", "Change request published")
        + (dec ? ` — v${dec.newVersion} (${dec.effectiveBump}${dec.breaking ? ", breaking" : ""})` : ""),
      );
      refetchAll();
    },
    onError: onMutationError,
  });
  // W5-21 — master alarm mutations
  const upsertMasterM = trpc.equipmentStandards.upsertMasterAlarm.useMutation({
    onSuccess: () => { toast.success(t("eqStandards.masterSaved", "Master alarm saved")); setMasterAlarmOpen(false); setEditMaster(null); refetchAll(); },
    onError: onMutationError,
  });
  const shelveMasterM = trpc.equipmentStandards.shelveMasterAlarm.useMutation({
    onSuccess: () => { toast.success(t("eqStandards.masterShelved", "Shelving updated")); refetchAll(); },
    onError: onMutationError,
  });
  const deleteMasterM = trpc.equipmentStandards.deleteMasterAlarm.useMutation({
    onSuccess: () => { toast.success(t("eqStandards.masterDeleted", "Master alarm deleted")); refetchAll(); },
    onError: onMutationError,
  });

  // ── Derived KPIs (from complianceMetrics) ────────────────────────────────────
  const conformanceChart = useMemo(() => {
    if (!compliance) return [];
    return [
      { name: t("eqStandards.pass", "Pass"), value: compliance.conformancePassCount, kind: "pass" as const },
      {
        name: t("eqStandards.fail", "Fail"),
        value: Math.max(0, compliance.conformanceTypeCount - compliance.conformancePassCount),
        kind: "fail" as const,
      },
    ];
  }, [compliance, t]);

  if (!canView) {
    return (
      <DashboardLayout>
        <div className="p-6">
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              <AlertTriangle className="mx-auto mb-2 h-6 w-6" />
              {t("eqStandards.noPermission", "You do not have permission to view equipment standards.")}
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
          icon={<ShieldCheck className="h-6 w-6" />}
          title={t("eqStandards.title", "Equipment Standards & Governance")}
          badge={!canControl ? <ViewOnlyBadge module="machine_control" /> : undefined}
          description={t("eqStandards.subtitle", "Versioned device-type hierarchy, ISA-18.2 alarm taxonomy and the Equipment Standards Board — governance metadata only, no device commands.")}
          actions={
            <Button size="icon" variant="ghost" onClick={refetchAll} title={t("common.refresh", "Refresh")}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          }
        />

        {/* U7 (doc 26 §2.1) — "Khi nào dùng": trang LÀ GÌ / DÙNG KHI NÀO cho KTV mới. */}
        <div className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
          <span>{t("eqStandards.whenToUse", "When to use — govern device-type standards, the ISA-18.2 alarm taxonomy and the review board. Governance metadata only, no device commands.")}</span>
        </div>

        {/* ── Flag-off preview banner (honest) ───────────────────────────────── */}
        {!flagEnabled && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <span>
              {t(
                "eqStandards.flagOffBanner",
                "Preview mode: equipment governance is disabled (EQ_GOVERN_ENABLED is off). Reads work; actions (register type / map alarm / submit / review / publish) are blocked until the flag is enabled.",
              )}
            </span>
          </div>
        )}

        {/* Safety note — mirrors the router's NO-OP discipline */}
        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {t(
              "eqStandards.safetyNote",
              "This page writes governance metadata only (device-type versions, alarm taxonomy, change requests). It opens no device-control path.",
            )}
          </span>
        </div>

        {/* ── KPI strip (complianceMetrics) ──────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <MetricCard
            icon={<Cpu className="h-4 w-4" />}
            label={t("eqStandards.kpi.mapped", "Machines mapped")}
            value={compliance ? pct(compliance.mappedRate) : "—"}
            delta={compliance ? `${compliance.machinesMappedToPublished}/${compliance.machineCount}` : undefined}
            tone={compliance && compliance.mappedRate < 1 ? "warning" : "good"}
          />
          <MetricCard
            icon={<ClipboardCheck className="h-4 w-4" />}
            label={t("eqStandards.kpi.conformance", "Conformance pass")}
            value={compliance ? pct(compliance.conformancePassRate) : "—"}
            delta={compliance ? `${compliance.conformancePassCount}/${compliance.conformanceTypeCount}` : undefined}
            tone={compliance && compliance.conformancePassRate < 1 ? "danger" : "good"}
          />
          <MetricCard
            icon={<GitPullRequest className="h-4 w-4" />}
            label={t("eqStandards.kpi.pendingCrs", "Pending CRs")}
            value={compliance?.crPendingCount ?? "—"}
            tone={compliance && compliance.crPendingCount > 0 ? "warning" : "default"}
          />
          <MetricCard
            icon={<Bell className="h-4 w-4" />}
            label={t("eqStandards.kpi.vendorCoverage", "Alarm vendors")}
            value={compliance?.alarmVendorCoverage ?? "—"}
          />
          <MetricCard
            icon={<Boxes className="h-4 w-4" />}
            label={t("eqStandards.kpi.types", "Device types")}
            value={treeQ.data?.typeCount ?? "—"}
          />
        </div>

        {/* Failing-types alert */}
        {compliance && compliance.failingTypes.length > 0 && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div>
              <div className="font-medium text-destructive">{t("eqStandards.failingTypesTitle", "Types failing conformance")}</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {compliance.failingTypes.map((k) => (
                  <Badge key={k} variant="outline" className="border-destructive/30 bg-destructive/15 text-destructive font-mono text-xs">{k}</Badge>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Tabbed surface ─────────────────────────────────────────────────── */}
        <Tabs value={tab} onValueChange={setTab} className="gap-4">
          <TabsList className="flex-wrap">
            <TabsTrigger value="hierarchy"><Network className="mr-1 h-4 w-4" />{t("eqStandards.tab.hierarchy", "Hierarchy")}</TabsTrigger>
            <TabsTrigger value="alarms"><Bell className="mr-1 h-4 w-4" />{t("eqStandards.tab.alarms", "Alarm taxonomy")}</TabsTrigger>
            <TabsTrigger value="alarmPerf"><Activity className="mr-1 h-4 w-4" />{t("eqStandards.tab.alarmPerf", "Alarm performance")}</TabsTrigger>
            <TabsTrigger value="crs"><GitPullRequest className="mr-1 h-4 w-4" />{t("eqStandards.tab.crs", "Change requests")}</TabsTrigger>
            <TabsTrigger value="compliance"><ClipboardCheck className="mr-1 h-4 w-4" />{t("eqStandards.tab.compliance", "Compliance")}</TabsTrigger>
          </TabsList>

          {/* ════════════════ TAB: Hierarchy (E1-a) ════════════════ */}
          <TabsContent value="hierarchy" className="flex flex-col gap-4 lg:flex-row lg:items-start">
            <SectionCard
              icon={<Network className="h-4 w-4" />}
              title={t("eqStandards.hierarchyTitle", "Device type hierarchy")}
              className="lg:w-1/2"
              action={
                <Button size="sm" variant="outline" className="h-8" disabled={!canControl} title={permReason} onClick={() => setRegisterOpen(true)}>
                  <Plus className="mr-1 h-4 w-4" />{t("eqStandards.registerType", "Register type")}
                </Button>
              }
            >
              {treeQ.isLoading && <Text tone="muted" variant="body-sm">{t("eqStandards.loading", "Loading…")}</Text>}
              {!treeQ.isLoading && tree.length === 0 && (
                <Text tone="muted" variant="body-sm">{t("eqStandards.treeEmpty", "No device types.")}</Text>
              )}
              <div className="space-y-0.5">
                {tree.map((node) => (
                  <TreeRow
                    key={node.typeKey}
                    node={node}
                    depth={0}
                    selected={selectedTypeKey}
                    onSelect={setSelectedTypeKey}
                  />
                ))}
              </div>
            </SectionCard>

            {/* Resolved detail */}
            <SectionCard
              icon={<Layers className="h-4 w-4" />}
              title={selectedTypeKey
                ? t("eqStandards.resolvedTitle", "Resolved: {{key}}").replace("{{key}}", selectedTypeKey)
                : t("eqStandards.resolvedTitlePlain", "Resolved device type")}
              className="lg:w-1/2"
            >
              {!selectedTypeKey && (
                <Text tone="muted" variant="body-sm">{t("eqStandards.selectHint", "Select a device type in the tree to view its fully-merged attributes, commands and PackML states.")}</Text>
              )}
              {selectedTypeKey && resolveQ.isFetching && <Text tone="muted" variant="body-sm">{t("eqStandards.loading", "Loading…")}</Text>}
              {selectedTypeKey && !resolveQ.isFetching && resolveQ.error && (
                <Text tone="muted" variant="body-sm">{t("eqStandards.notFound", "Type not found:")} <span className="font-mono">{selectedTypeKey}</span></Text>
              )}
              {resolved && !resolveQ.isFetching && <ResolvedDetail resolved={resolved} />}
            </SectionCard>
          </TabsContent>

          {/* ════════════════ TAB: Alarm taxonomy (E1-b) ════════════════ */}
          <TabsContent value="alarms" className="flex flex-col gap-4">
            {/* Lookup panel */}
            <SectionCard icon={<Search className="h-4 w-4" />} title={t("eqStandards.lookupTitle", "Normalize an alarm")}>
              <div className="flex flex-wrap items-end gap-2">
                <div className="grid gap-1">
                  <Label className="text-xs text-muted-foreground">{t("eqStandards.vendor", "Vendor")}</Label>
                  <Input className="w-44" value={lookupVendor} placeholder="fanuc" onChange={(e) => setLookupVendor(e.target.value)} />
                </div>
                <div className="grid gap-1">
                  <Label className="text-xs text-muted-foreground">{t("eqStandards.nativeCode", "Native code")}</Label>
                  <Input className="w-44" value={lookupCode} placeholder="SRVO-050" onChange={(e) => setLookupCode(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && lookupVendor.trim() && lookupCode.trim()) setLookup({ vendor: lookupVendor.trim(), nativeCode: lookupCode.trim() }); }} />
                </div>
                <Button variant="outline" size="sm" disabled={!lookupVendor.trim() || !lookupCode.trim()}
                  onClick={() => setLookup({ vendor: lookupVendor.trim(), nativeCode: lookupCode.trim() })}>
                  <Search className="mr-1 h-4 w-4" />{t("eqStandards.lookup", "Look up")}
                </Button>
              </div>
              {lookup && mapAlarmQ.isFetching && <p className="mt-3 text-sm text-muted-foreground">{t("eqStandards.loading", "Loading…")}</p>}
              {mapped && lookup && !mapAlarmQ.isFetching && (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 p-3 text-sm">
                  <span className="font-mono">{lookup.vendor} / {lookup.nativeCode}</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  <span className="font-mono font-medium">{mapped.standardCode}</span>
                  <PriorityBadge value={mapped.severity} label={t(`eqStandards.severity.${mapped.severity}`, mapped.severity)} />
                  {!mapped.mapped && <Badge variant="outline" className="text-muted-foreground">{t("eqStandards.unmappedDefault", "fail-safe default")}</Badge>}
                  {mapped.recommendedAction && <span className="text-xs text-muted-foreground">— {mapped.recommendedAction}</span>}
                </div>
              )}
            </SectionCard>

            {/* Mapping table */}
            <SectionCard
              icon={<Bell className="h-4 w-4" />}
              title={t("eqStandards.alarmTableTitle", "Alarm mappings")}
              contentClassName="p-0"
              action={
                <div className="flex items-center gap-2">
                  {/* U11 — Select DS thay <select> gõ tay; "__all__" là sentinel cho "tất cả". */}
                  <Select value={vendorFilter || "__all__"} onValueChange={(v) => setVendorFilter(v === "__all__" ? "" : v)}>
                    <SelectTrigger size="sm" className="w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">{t("eqStandards.allVendors", "All vendors")}</SelectItem>
                      {vendors.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button size="sm" variant="outline" className="h-8" disabled={!canControl} title={permReason} onClick={() => setUpsertAlarmOpen(true)}>
                    <Plus className="mr-1 h-4 w-4" />{t("eqStandards.mapAlarm", "Map alarm")}
                  </Button>
                </div>
              }
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("eqStandards.col.vendor", "Vendor")}</TableHead>
                    <TableHead>{t("eqStandards.col.native", "Native code")}</TableHead>
                    <TableHead>{t("eqStandards.col.standard", "Standard code")}</TableHead>
                    <TableHead>{t("eqStandards.col.severity", "Severity")}</TableHead>
                    <TableHead>{t("eqStandards.col.action", "Recommended action")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {alarmsQ.isLoading && (
                    <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">{t("eqStandards.loading", "Loading…")}</TableCell></TableRow>
                  )}
                  {!alarmsQ.isLoading && alarms.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">{t("eqStandards.alarmsEmpty", "No alarm mappings.")}</TableCell></TableRow>
                  )}
                  {alarms.map((a) => (
                    <TableRow key={`${a.vendor}::${a.nativeCode}`}>
                      <TableCell className="text-xs">{a.vendor}</TableCell>
                      <TableCell className="font-mono text-xs">{a.nativeCode}</TableCell>
                      <TableCell className="font-mono text-xs font-medium">{a.standardCode}</TableCell>
                      <TableCell>
                        <PriorityBadge value={a.severity} label={t(`eqStandards.severity.${a.severity}`, a.severity)} />
                      </TableCell>
                      <TableCell className="max-w-[22rem] truncate text-xs text-muted-foreground" title={a.recommendedAction ?? undefined}>
                        {a.recommendedAction ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </SectionCard>
          </TabsContent>

          {/* ════════════════ TAB: Alarm performance (W5-21, EEMUA-191) ════════════════ */}
          <TabsContent value="alarmPerf" className="flex flex-col gap-4">
            {/* KPI strip */}
            <SectionCard
              icon={<Activity className="h-4 w-4" />}
              title={t("eqStandards.alarmPerfTitle", "Alarm performance (EEMUA-191)")}
              action={
                <Select value={String(kpiWindow)} onValueChange={(v) => setKpiWindow(Number(v))}>
                  <SelectTrigger size="sm" className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[1, 7, 30].map((d) => (
                      <SelectItem key={d} value={String(d)}>{t("eqStandards.lastNDays", "Last {{n}} days").replace("{{n}}", String(d))}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              }
            >
              {kpisQ.isLoading && <Text tone="muted" variant="body-sm">{t("eqStandards.loading", "Loading…")}</Text>}
              {kpisQ.error && !kpisQ.isLoading && (
                <Text tone="muted" variant="body-sm">{t("eqStandards.kpiError", "Could not load alarm KPIs.")}</Text>
              )}
              {kpis && !kpisQ.isLoading && (
                <>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                    <MetricCard icon={<Bell className="h-4 w-4" />} label={t("eqStandards.kpi.total", "Total alarms")} value={kpis.totalAlarms} />
                    <MetricCard icon={<Activity className="h-4 w-4" />} label={t("eqStandards.kpi.perOpHour", "Alarms/op/hour")}
                      value={kpis.alarmsPerOperatorHour.toFixed(1)}
                      tone={kpis.alarmsPerOperatorHour > 12 ? "danger" : kpis.alarmsPerOperatorHour > 6 ? "warning" : "good"} />
                    <MetricCard icon={<AlertTriangle className="h-4 w-4" />} label={t("eqStandards.kpi.flood", "Flood windows")}
                      value={kpis.floodWindowCount} tone={kpis.floodWindowCount > 0 ? "danger" : "good"} />
                    <MetricCard icon={<RefreshCw className="h-4 w-4" />} label={t("eqStandards.kpi.chattering", "Chattering")}
                      value={kpis.chattering.length} tone={kpis.chattering.length > 0 ? "warning" : "good"} />
                    <MetricCard icon={<Lock className="h-4 w-4" />} label={t("eqStandards.kpi.standing", "Standing/stale")}
                      value={kpis.standingCount} tone={kpis.standingCount > 0 ? "warning" : "good"} />
                    <MetricCard icon={<Cpu className="h-4 w-4" />} label={t("eqStandards.kpi.peakWindow", "Peak/10min")} value={kpis.peakWindowCount} />
                  </div>
                  {/* Bad actors */}
                  <div className="mt-4">
                    <Heading level={6} className="mb-2">{t("eqStandards.badActors", "Top bad actors")}</Heading>
                    {kpis.badActors.length === 0 ? (
                      <Text tone="muted" variant="body-sm">{t("eqStandards.noAlarms", "No alarms in this window.")}</Text>
                    ) : (
                      <div className="space-y-1">
                        {kpis.badActors.map((b) => (
                          <div key={b.key} className="flex items-center gap-2 text-sm">
                            <span className="w-40 shrink-0 truncate font-mono text-xs" title={b.key}>{b.key}</span>
                            <div className="h-2 flex-1 overflow-hidden rounded bg-muted">
                              <div className="h-full bg-primary" style={{ width: `${Math.round(b.share * 100)}%` }} />
                            </div>
                            <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">{b.count} ({pct(b.share)})</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </SectionCard>

            {/* Master alarm DB (rationalization) */}
            <SectionCard
              icon={<ClipboardCheck className="h-4 w-4" />}
              title={t("eqStandards.masterTitle", "Master alarm database (rationalization)")}
              contentClassName="p-0"
              action={
                <Button size="sm" variant="outline" className="h-8" disabled={!canControl} title={permReason} onClick={() => { setEditMaster(null); setMasterAlarmOpen(true); }}>
                  <Plus className="mr-1 h-4 w-4" />{t("eqStandards.addMaster", "Add master alarm")}
                </Button>
              }
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("eqStandards.col.alarmKey", "Alarm key")}</TableHead>
                    <TableHead>{t("eqStandards.col.priority", "Priority")}</TableHead>
                    <TableHead>{t("eqStandards.col.consequence", "Consequence")}</TableHead>
                    <TableHead>{t("eqStandards.col.ttr", "Time-to-respond")}</TableHead>
                    <TableHead>{t("eqStandards.col.setpoint", "Setpoint / deadband")}</TableHead>
                    <TableHead>{t("eqStandards.col.shelve", "Shelved / suppressed")}</TableHead>
                    <TableHead className="text-right">{t("common.actions", "Actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mastersQ.isLoading && (
                    <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">{t("eqStandards.loading", "Loading…")}</TableCell></TableRow>
                  )}
                  {!mastersQ.isLoading && masters.length === 0 && (
                    <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">{t("eqStandards.masterEmpty", "No master alarms rationalized yet.")}</TableCell></TableRow>
                  )}
                  {masters.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-mono text-xs font-medium">
                        {m.alarmKey}{m.assetType ? <span className="ml-1 text-muted-foreground">/{m.assetType}</span> : null}
                      </TableCell>
                      <TableCell>
                        <PriorityBadge value={m.priority} label={t(`eqStandards.priority.${m.priority}`, m.priority)} />
                      </TableCell>
                      <TableCell className="text-xs">{t(`eqStandards.consequenceVal.${m.consequence}`, m.consequence)}</TableCell>
                      <TableCell className="text-xs">{m.timeToRespond != null ? `${m.timeToRespond} ${t("eqStandards.min", "min")}` : "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{m.setpoint ?? "—"}{m.deadband ? ` / ±${m.deadband}` : ""}</TableCell>
                      <TableCell>
                        {m.isSuppressed ? (
                          <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive text-xs">{t("eqStandards.suppressed", "Suppressed")}</Badge>
                        ) : m.isShelvedNow ? (
                          <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-600 text-xs">{t("eqStandards.shelved", "Shelved")}</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {canControl ? (
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="ghost" className="h-7" onClick={() => { setEditMaster(m); setMasterAlarmOpen(true); }}>
                              <Eye className="mr-1 h-3.5 w-3.5" />{t("eqStandards.edit", "Edit")}
                            </Button>
                            {m.isShelvedNow ? (
                              <Button size="sm" variant="ghost" className="h-7" disabled={shelveMasterM.isPending}
                                onClick={() => shelveMasterM.mutate({ id: m.id, shelvedUntil: null })}>
                                {t("eqStandards.unshelve", "Un-shelve")}
                              </Button>
                            ) : (
                              <Button size="sm" variant="ghost" className="h-7" disabled={shelveMasterM.isPending}
                                title={t("eqStandards.shelve8hTip", "Shelve for 8 hours")}
                                onClick={() => shelveMasterM.mutate({ id: m.id, shelvedUntil: new Date(Date.now() + 8 * 3600_000).toISOString() })}>
                                {t("eqStandards.shelve8h", "Shelve 8h")}
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" className="h-7" disabled={deleteMasterM.isPending}
                              onClick={() => deleteMasterM.mutate({ id: m.id })}>
                              <XCircle className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">{t("eqStandards.viewOnly", "View only")}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </SectionCard>
          </TabsContent>

          {/* ════════════════ TAB: Change requests (E1-c) ════════════════ */}
          <TabsContent value="crs" className="flex flex-col gap-4">
            <SectionCard
              icon={<GitPullRequest className="h-4 w-4" />}
              title={t("eqStandards.crsTitle", "Equipment Standards Board")}
              contentClassName="p-0"
              action={
                <div className="flex items-center gap-2">
                  {/* U11 — Select DS; "__all__" là sentinel cho "tất cả trạng thái". */}
                  <Select value={crStatusFilter || "__all__"} onValueChange={(v) => setCrStatusFilter(v === "__all__" ? "" : v)}>
                    <SelectTrigger size="sm" className="w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">{t("eqStandards.allStatuses", "All statuses")}</SelectItem>
                      {["pending", "in_review", "approved", "rejected", "published"].map((s) => (
                        <SelectItem key={s} value={s}>{t(`eqStandards.crStatus.${s}`, s)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {canControl && (
                    <Button size="sm" variant="outline" className="h-8" onClick={() => setSubmitCrOpen(true)}>
                      <Plus className="mr-1 h-4 w-4" />{t("eqStandards.submitCr", "Submit CR")}
                    </Button>
                  )}
                </div>
              }
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("eqStandards.col.crKey", "CR key")}</TableHead>
                    <TableHead>{t("eqStandards.col.target", "Target type")}</TableHead>
                    <TableHead>{t("eqStandards.col.kind", "Kind")}</TableHead>
                    <TableHead>{t("eqStandards.col.status", "Status")}</TableHead>
                    <TableHead>{t("eqStandards.col.conformance", "Conformance")}</TableHead>
                    <TableHead>{t("eqStandards.col.stage", "Stage")}</TableHead>
                    <TableHead className="text-right">{t("common.actions", "Actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {crsQ.isLoading && (
                    <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">{t("eqStandards.loading", "Loading…")}</TableCell></TableRow>
                  )}
                  {!crsQ.isLoading && crs.length === 0 && (
                    <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">{t("eqStandards.crsEmpty", "No change requests.")}</TableCell></TableRow>
                  )}
                  {crs.map((cr) => {
                    const breaking = String(cr.backwardIncompatible) === "true";
                    return (
                      <TableRow key={cr.id}>
                        <TableCell className="font-mono text-xs">{cr.crKey}</TableCell>
                        <TableCell className="font-mono text-xs">{cr.targetTypeKey}</TableCell>
                        <TableCell><Badge variant="outline">{t(`eqStandards.crKind.${cr.kind}`, cr.kind)}</Badge></TableCell>
                        <TableCell>
                          <StatusBadge status={cr.status} label={t(`eqStandards.crStatus.${cr.status}`, cr.status)} />
                        </TableCell>
                        <TableCell className="flex items-center gap-1">
                          <StatusBadge status={cr.conformanceStatus} label={t(`eqStandards.conf.${cr.conformanceStatus}`, cr.conformanceStatus)} />
                          {breaking && (
                            <span title={t("eqStandards.breakingTip", "Backward-incompatible — requires a major version bump")}>
                              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                            </span>
                          )}
                        </TableCell>
                        <TableCell><Badge variant="outline" className="text-muted-foreground">{cr.stage}</Badge></TableCell>
                        <TableCell className="text-right">
                          {canControl ? (
                            <div className="flex justify-end gap-1">
                              {(cr.status === "pending" || cr.status === "in_review") && (
                                <>
                                  {cr.status === "pending" && (
                                    <Button size="sm" variant="ghost" className="h-7" disabled={reviewCrM.isPending}
                                      title={t("eqStandards.startReviewTip", "Move to in-review")}
                                      onClick={() => reviewCrM.mutate({ crId: cr.id, to: "in_review" })}>
                                      <Eye className="mr-1 h-3.5 w-3.5" />{t("eqStandards.review", "Review")}
                                    </Button>
                                  )}
                                  <Button size="sm" variant="ghost" className="h-7" disabled={reviewCrM.isPending}
                                    title={t("eqStandards.approveTip", "Approve — the server computes the conformance gate from the proposed schema")}
                                    onClick={() => reviewCrM.mutate({ crId: cr.id, to: "approved" })}>
                                    <CheckCircle2 className="mr-1 h-3.5 w-3.5 text-emerald-500" />{t("eqStandards.approve", "Approve")}
                                  </Button>
                                  <Button size="sm" variant="ghost" className="h-7" disabled={reviewCrM.isPending}
                                    title={t("eqStandards.rejectTip", "Reject")}
                                    onClick={() => reviewCrM.mutate({ crId: cr.id, to: "rejected" })}>
                                    <XCircle className="mr-1 h-3.5 w-3.5 text-destructive" />{t("eqStandards.reject", "Reject")}
                                  </Button>
                                </>
                              )}
                              {cr.status === "approved" && (
                                <Button size="sm" variant="ghost" className="h-7" disabled={publishCrM.isPending}
                                  title={t("eqStandards.publishTip", "Publish — gated by conformance + backward-compat")}
                                  onClick={() => publishCrM.mutate({ crId: cr.id, stage: "staging" })}>
                                  <Rocket className="mr-1 h-3.5 w-3.5" />{t("eqStandards.publish", "Publish")}
                                </Button>
                              )}
                              {(cr.status === "rejected" || cr.status === "published") && (
                                <span className="text-xs text-muted-foreground">{t("eqStandards.terminal", "—")}</span>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">{t("eqStandards.viewOnly", "View only")}</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </SectionCard>
          </TabsContent>

          {/* ════════════════ TAB: Compliance (E1-e + E1-d) ════════════════ */}
          <TabsContent value="compliance" className="flex flex-col gap-4">
            <SectionCard
              icon={<ClipboardCheck className="h-4 w-4" />}
              title={t("eqStandards.complianceTitle", "Compliance overview")}
            >
              <div className="grid gap-4 md:grid-cols-2">
                {/* Conformance pass/fail chart (natural pass vs fail series) */}
                <div>
                  <Heading level={6} className="mb-2">{t("eqStandards.conformanceChart", "Conformance by device type")}</Heading>
                  {conformanceChart.length > 0 ? (
                    <div className="h-48">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={conformanceChart}>
                          <CartesianGrid {...chartGridProps} />
                          <XAxis dataKey="name" tick={chartAxisTick} />
                          <YAxis allowDecimals={false} tick={chartAxisTick} />
                          <Tooltip contentStyle={chartTooltipStyle} cursor={{ fill: "var(--muted)" }} />
                          <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                            {conformanceChart.map((entry) => (
                              <Cell key={entry.kind} fill={entry.kind === "pass" ? "var(--success)" : "var(--destructive)"} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <Text tone="muted" variant="body-sm">{t("eqStandards.loading", "Loading…")}</Text>
                  )}
                </div>

                {/* Unmapped machine types */}
                <div>
                  <Heading level={6} className="mb-2">{t("eqStandards.unmappedTitle", "Unmapped machine types")}</Heading>
                  {compliance && compliance.unmappedMachineTypes.length === 0 && (
                    <div className="flex items-center gap-2 text-sm text-emerald-600">
                      <CheckCircle2 className="h-4 w-4" />{t("eqStandards.allMapped", "Every machine type maps to a published device type.")}
                    </div>
                  )}
                  {compliance && compliance.unmappedMachineTypes.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {compliance.unmappedMachineTypes.map((m) => (
                        <Badge key={m} variant="outline" className="border-warning/30 bg-warning/15 text-warning font-mono text-xs">{m}</Badge>
                      ))}
                    </div>
                  )}
                  {!compliance && <Text tone="muted" variant="body-sm">{t("eqStandards.loading", "Loading…")}</Text>}
                </div>
              </div>
            </SectionCard>

            {/* Run conformance */}
            <SectionCard
              icon={<Wrench className="h-4 w-4" />}
              title={t("eqStandards.runConfTitle", "Conformance test")}
              action={
                <Button size="sm" variant="outline" className="h-8" disabled={conformanceQ.isFetching}
                  onClick={() => { setRunConfReq(true); void utils.equipmentStandards.runConformance.invalidate(); }}>
                  <RefreshCw className={`mr-1 h-4 w-4 ${conformanceQ.isFetching ? "animate-spin" : ""}`} />{t("eqStandards.runConf", "Run conformance")}
                </Button>
              }
            >
              {!runConfReq && (
                <Text tone="muted" variant="body-sm">{t("eqStandards.runConfHint", "Run the standard rule set across the seeded device types and capability profiles.")}</Text>
              )}
              {runConfReq && conformanceQ.isFetching && <Text tone="muted" variant="body-sm">{t("eqStandards.loading", "Loading…")}</Text>}
              {conformance && !conformanceQ.isFetching && <ConformanceResult result={conformance} />}
            </SectionCard>
          </TabsContent>
        </Tabs>
      </PageContainer>

      {/* ── Dialogs ──────────────────────────────────────────────────────────── */}
      {registerOpen && (
        <RegisterTypeDialog
          parentOptions={tree}
          pending={registerM.isPending}
          onClose={() => setRegisterOpen(false)}
          onSubmit={(v) => registerM.mutate(v)}
        />
      )}
      {upsertAlarmOpen && (
        <UpsertAlarmDialog
          pending={upsertAlarmM.isPending}
          onClose={() => setUpsertAlarmOpen(false)}
          onSubmit={(v) => upsertAlarmM.mutate(v)}
        />
      )}
      {submitCrOpen && (
        <SubmitCrDialog
          parentOptions={tree}
          canView={canView}
          pending={submitCrM.isPending}
          onClose={() => setSubmitCrOpen(false)}
          onSubmit={(v) => submitCrM.mutate(v)}
        />
      )}
      {masterAlarmOpen && (
        <MasterAlarmDialog
          initial={editMaster}
          pending={upsertMasterM.isPending}
          onClose={() => { setMasterAlarmOpen(false); setEditMaster(null); }}
          onSubmit={(v) => upsertMasterM.mutate(v)}
        />
      )}
    </DashboardLayout>
  );
}

// ── Tree row (recursive, expandable) ──────────────────────────────────────────
function TreeRow({
  node, depth, selected, onSelect,
}: {
  node: TreeNode;
  depth: number;
  selected: string | null;
  onSelect: (k: string) => void;
}) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children.length > 0;
  const isSel = selected === node.typeKey;
  return (
    <>
      <div
        className={`flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-sm hover:bg-muted/60 ${isSel ? "bg-primary/10" : ""}`}
        style={{ paddingLeft: `${depth * 1.1 + 0.5}rem` }}
        onClick={() => onSelect(node.typeKey)}
      >
        {hasChildren ? (
          <button
            type="button"
            className="shrink-0 text-muted-foreground"
            onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
          >
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <span className="inline-block w-3.5 shrink-0" />
        )}
        <Boxes className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className={`truncate ${isSel ? "font-medium" : ""}`}>{node.label ?? node.typeKey}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          <span className="font-mono text-[10px] text-muted-foreground">v{node.version}</span>
          <StatusBadge status={node.status} className="px-1 py-0 text-[10px]" />
        </span>
      </div>
      {hasChildren && open && node.children.map((c) => (
        <TreeRow key={c.typeKey} node={c} depth={depth + 1} selected={selected} onSelect={onSelect} />
      ))}
    </>
  );
}

// ── Resolved device-type detail ───────────────────────────────────────────────
function ResolvedDetail({ resolved }: { resolved: ResolvedType }) {
  const { t } = useTranslation();
  const extKeys = Object.keys(resolved.extension ?? {});
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono font-medium">{resolved.typeKey}</span>
        <Badge variant="outline">v{resolved.version}</Badge>
        {resolved.adapterKind && <Badge className="bg-violet-500 text-white">{resolved.adapterKind}</Badge>}
      </div>
      <div>
        <div className="mb-1 text-xs font-medium text-muted-foreground">{t("eqStandards.inheritance", "Inheritance chain")}</div>
        <div className="flex flex-wrap items-center gap-1">
          {resolved.inheritanceChain.map((k, i) => (
            <span key={k} className="inline-flex items-center gap-1">
              <Badge variant="secondary" className="font-mono text-xs">{k}</Badge>
              {i < resolved.inheritanceChain.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
            </span>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1 text-xs font-medium text-muted-foreground">
          {t("eqStandards.attributes", "Attributes")} ({resolved.attributesSchema.length})
        </div>
        {resolved.attributesSchema.length === 0 ? (
          <Text tone="muted" variant="caption">{t("eqStandards.none", "None")}</Text>
        ) : (
          <div className="flex flex-wrap gap-1">
            {resolved.attributesSchema.map((a) => (
              <Badge key={a.name} variant="outline" className="font-mono text-xs" title={a.label ?? a.name}>
                <Tags className="mr-1 h-3 w-3" />{a.name}{a.unit ? ` (${a.unit})` : ""}
              </Badge>
            ))}
          </div>
        )}
      </div>
      <div>
        <div className="mb-1 text-xs font-medium text-muted-foreground">
          {t("eqStandards.commands", "Commands")} ({resolved.supportedCommands.length})
        </div>
        {resolved.supportedCommands.length === 0 ? (
          <Text tone="muted" variant="caption">{t("eqStandards.none", "None")}</Text>
        ) : (
          <div className="flex flex-wrap gap-1">
            {resolved.supportedCommands.map((c) => (
              <Badge key={c.name} variant="secondary" className="font-mono text-xs"><Wrench className="mr-1 h-3 w-3" />{c.name}</Badge>
            ))}
          </div>
        )}
      </div>
      <div>
        <div className="mb-1 text-xs font-medium text-muted-foreground">
          {t("eqStandards.states", "PackML states")} ({resolved.supportedStates.length})
        </div>
        {resolved.supportedStates.length === 0 ? (
          <Text tone="muted" variant="caption">{t("eqStandards.none", "None")}</Text>
        ) : (
          <div className="flex flex-wrap gap-1">
            {resolved.supportedStates.map((s) => <Badge key={s} variant="outline" className="text-xs">{s}</Badge>)}
          </div>
        )}
      </div>
      {extKeys.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">{t("eqStandards.extension", "Extension fields")}</div>
          <pre className="max-h-40 overflow-auto rounded border border-border bg-muted/30 p-2 text-[11px]">
            {JSON.stringify(resolved.extension, null, 2)}
          </pre>
        </div>
      )}
      {resolved.mappedMachineTypes.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">{t("eqStandards.mappedTypes", "Mapped machine types")}</div>
          <div className="flex flex-wrap gap-1">
            {resolved.mappedMachineTypes.map((m) => <Badge key={m} variant="outline" className="font-mono text-xs">{m}</Badge>)}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Conformance result detail ─────────────────────────────────────────────────
function ConformanceResult({ result }: { result: Conformance }) {
  const { t } = useTranslation();
  const all = [...result.seed, ...result.profiles];
  const failing = all.filter((r) => !r.pass);
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center gap-2">
        {result.pass ? (
          <Badge className="border-success/30 bg-success/15 text-success" variant="outline"><CheckCircle2 className="mr-1 h-3.5 w-3.5" />{t("eqStandards.confPass", "All pass")}</Badge>
        ) : (
          <Badge className="border-destructive/30 bg-destructive/15 text-destructive" variant="outline"><XCircle className="mr-1 h-3.5 w-3.5" />{t("eqStandards.confFail", "Failures")}: {failing.length}</Badge>
        )}
        <span className="text-xs text-muted-foreground">{t("eqStandards.confChecked", "{{n}} subjects checked").replace("{{n}}", String(all.length))}</span>
      </div>
      {failing.length > 0 && (
        <div className="space-y-2">
          {failing.map((r, i) => (
            <div key={`${r.typeKey}-${i}`} className="rounded-md border border-destructive/30 bg-destructive/5 p-2">
              <div className="font-mono text-xs font-medium">{r.typeKey}</div>
              <ul className="mt-1 space-y-0.5">
                {r.violations.map((v, j) => (
                  <li key={j} className="text-xs text-muted-foreground">• {v.rule} — <span className="font-mono">{v.detail}</span></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Register device-type dialog ───────────────────────────────────────────────
function RegisterTypeDialog({
  parentOptions, pending, onClose, onSubmit,
}: {
  parentOptions: TreeNode[];
  pending: boolean;
  onClose: () => void;
  onSubmit: (v: { typeKey: string; parentTypeKey?: string; version: string; label?: string; description?: string }) => void;
}) {
  const { t } = useTranslation();
  const [typeKey, setTypeKey] = useState("");
  const [parentTypeKey, setParentTypeKey] = useState("");
  const [version, setVersion] = useState("1.0.0");
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");

  // Flatten the tree for the parent <select>.
  const flatKeys = useMemo(() => {
    const out: string[] = [];
    const walk = (nodes: TreeNode[]) => { for (const n of nodes) { out.push(n.typeKey); walk(n.children); } };
    walk(parentOptions);
    return out;
  }, [parentOptions]);

  const submit = () => {
    if (!typeKey.trim()) { toast.error(t("eqStandards.typeKeyRequired", "Type key is required.")); return; }
    onSubmit({
      typeKey: typeKey.trim(),
      parentTypeKey: parentTypeKey.trim() || undefined,
      version: version.trim() || "1.0.0",
      label: label.trim() || undefined,
      description: description.trim() || undefined,
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Boxes className="h-4 w-4" />{t("eqStandards.registerTitle", "Register device type (draft)")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label>{t("eqStandards.typeKey", "Type key")}</Label>
              <Input value={typeKey} placeholder="MyRobotVariant" onChange={(e) => setTypeKey(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>{t("eqStandards.version", "Version")}</Label>
              <Input value={version} placeholder="1.0.0" onChange={(e) => setVersion(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1">
            <Label>{t("eqStandards.parent", "Parent type")}</Label>
            {/* U11 — Select DS; "__none__" là sentinel cho "không cha (root)". */}
            <Select value={parentTypeKey || "__none__"} onValueChange={(v) => setParentTypeKey(v === "__none__" ? "" : v)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t("eqStandards.noParent", "(none — root)")}</SelectItem>
                {flatKeys.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label>{t("eqStandards.label", "Label")}</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label>{t("eqStandards.description", "Description")}</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel", "Cancel")}</Button>
          <Button onClick={submit} disabled={pending}><CheckCircle2 className="mr-1 h-4 w-4" />{t("eqStandards.register", "Register")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Upsert alarm-mapping dialog ───────────────────────────────────────────────
function UpsertAlarmDialog({
  pending, onClose, onSubmit,
}: {
  pending: boolean;
  onClose: () => void;
  onSubmit: (v: { vendor: string; nativeCode: string; standardCode: string; severity: Severity; description?: string; recommendedAction?: string }) => void;
}) {
  const { t } = useTranslation();
  const [vendor, setVendor] = useState("");
  const [nativeCode, setNativeCode] = useState("");
  const [standardCode, setStandardCode] = useState("");
  const [severity, setSeverity] = useState<Severity>("medium");
  const [description, setDescription] = useState("");
  const [recommendedAction, setRecommendedAction] = useState("");

  const submit = () => {
    if (!vendor.trim() || !nativeCode.trim() || !standardCode.trim()) {
      toast.error(t("eqStandards.alarmRequired", "Vendor, native code and standard code are required.")); return;
    }
    onSubmit({
      vendor: vendor.trim(), nativeCode: nativeCode.trim(), standardCode: standardCode.trim(), severity,
      description: description.trim() || undefined, recommendedAction: recommendedAction.trim() || undefined,
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Bell className="h-4 w-4" />{t("eqStandards.upsertAlarmTitle", "Map vendor alarm")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label>{t("eqStandards.vendor", "Vendor")}</Label>
              <Input value={vendor} placeholder="fanuc" onChange={(e) => setVendor(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>{t("eqStandards.nativeCode", "Native code")}</Label>
              <Input value={nativeCode} placeholder="SRVO-050" onChange={(e) => setNativeCode(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label>{t("eqStandards.standardCode", "Standard code")}</Label>
              <Input value={standardCode} placeholder="COLLISION_DETECT" onChange={(e) => setStandardCode(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>{t("eqStandards.col.severity", "Severity")}</Label>
              <Select value={severity} onValueChange={(v) => setSeverity(v as Severity)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SEVERITIES.map((s) => <SelectItem key={s} value={s}>{t(`eqStandards.severity.${s}`, s)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1">
            <Label>{t("eqStandards.description", "Description")}</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label>{t("eqStandards.recommendedAction", "Recommended action")}</Label>
            <Input value={recommendedAction} onChange={(e) => setRecommendedAction(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel", "Cancel")}</Button>
          <Button onClick={submit} disabled={pending}><CheckCircle2 className="mr-1 h-4 w-4" />{t("eqStandards.save", "Save mapping")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Master alarm dialog (W5-21) ───────────────────────────────────────────────
// Client-side mirror of the server EEMUA-191 matrix — PREVIEW ONLY (the server
// re-derives priority authoritatively on upsert).
function previewPriority(consequence: Consequence, ttr: number | null): string {
  const band = ttr == null ? "medium" : ttr < 10 ? "short" : ttr <= 30 ? "medium" : "long";
  const M: Record<Consequence, Record<string, string>> = {
    severe: { short: "critical", medium: "critical", long: "high" },
    major: { short: "high", medium: "high", long: "medium" },
    minor: { short: "medium", medium: "low", long: "low" },
    none: { short: "low", medium: "low", long: "low" },
  };
  return M[consequence][band];
}

interface MasterAlarmValue {
  alarmKey: string;
  assetType?: string;
  vendor?: string;
  nativeCode?: string;
  label?: string;
  consequence: Consequence;
  timeToRespond?: number;
  setpoint?: string;
  deadband?: string;
  rationalization?: string;
  isSuppressed?: boolean;
}

function MasterAlarmDialog({
  initial, pending, onClose, onSubmit,
}: {
  initial: MasterAlarmRow | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (v: MasterAlarmValue) => void;
}) {
  const { t } = useTranslation();
  const [alarmKey, setAlarmKey] = useState(initial?.alarmKey ?? "");
  const [assetType, setAssetType] = useState(initial?.assetType ?? "");
  const [vendor, setVendor] = useState(initial?.vendor ?? "");
  const [nativeCode, setNativeCode] = useState(initial?.nativeCode ?? "");
  const [label, setLabel] = useState(initial?.label ?? "");
  const [consequence, setConsequence] = useState<Consequence>((initial?.consequence as Consequence) ?? "minor");
  const [ttr, setTtr] = useState<string>(initial?.timeToRespond != null ? String(initial.timeToRespond) : "");
  const [setpoint, setSetpoint] = useState(initial?.setpoint ?? "");
  const [deadband, setDeadband] = useState(initial?.deadband ?? "");
  const [rationalization, setRationalization] = useState(initial?.rationalization ?? "");
  const [isSuppressed, setIsSuppressed] = useState<boolean>(initial?.isSuppressed ?? false);

  const ttrNum = ttr.trim() === "" ? null : Number(ttr);
  const preview = previewPriority(consequence, ttrNum != null && Number.isFinite(ttrNum) ? ttrNum : null);

  const submit = () => {
    if (!alarmKey.trim()) { toast.error(t("eqStandards.alarmKeyRequired", "Alarm key is required.")); return; }
    onSubmit({
      alarmKey: alarmKey.trim(),
      assetType: assetType.trim() || undefined,
      vendor: vendor.trim() || undefined,
      nativeCode: nativeCode.trim() || undefined,
      label: label.trim() || undefined,
      consequence,
      timeToRespond: ttrNum != null && Number.isFinite(ttrNum) ? ttrNum : undefined,
      setpoint: setpoint.trim() || undefined,
      deadband: deadband.trim() || undefined,
      rationalization: rationalization.trim() || undefined,
      isSuppressed,
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ClipboardCheck className="h-4 w-4" />
            {initial ? t("eqStandards.editMasterTitle", "Edit master alarm") : t("eqStandards.addMasterTitle", "Rationalize a master alarm")}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label>{t("eqStandards.alarmKey", "Alarm key (standard code)")}</Label>
              <Input value={alarmKey} placeholder="COLLISION_DETECT" onChange={(e) => setAlarmKey(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>{t("eqStandards.assetType", "Asset type (optional)")}</Label>
              <Input value={assetType} placeholder="ROBOT" onChange={(e) => setAssetType(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label>{t("eqStandards.consequence", "Consequence")}</Label>
              <Select value={consequence} onValueChange={(v) => setConsequence(v as Consequence)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CONSEQUENCES.map((c) => <SelectItem key={c} value={c}>{t(`eqStandards.consequenceVal.${c}`, c)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label>{t("eqStandards.ttr", "Time-to-respond (min)")}</Label>
              <Input type="number" min={0} value={ttr} placeholder="10" onChange={(e) => setTtr(e.target.value)} />
            </div>
          </div>
          {/* Derived priority preview */}
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-2 text-sm">
            <span className="text-xs text-muted-foreground">{t("eqStandards.derivedPriority", "Derived priority (EEMUA-191):")}</span>
            <PriorityBadge value={preview} label={t(`eqStandards.priority.${preview}`, preview)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label>{t("eqStandards.setpoint", "Setpoint")}</Label>
              <Input value={setpoint} placeholder="85 °C" onChange={(e) => setSetpoint(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>{t("eqStandards.deadband", "Deadband")}</Label>
              <Input value={deadband} placeholder="2 °C" onChange={(e) => setDeadband(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label>{t("eqStandards.vendor", "Vendor (optional)")}</Label>
              <Input value={vendor} placeholder="fanuc" onChange={(e) => setVendor(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>{t("eqStandards.nativeCode", "Native code (optional)")}</Label>
              <Input value={nativeCode} placeholder="SRVO-050" onChange={(e) => setNativeCode(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1">
            <Label>{t("eqStandards.label", "Label")}</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label>{t("eqStandards.rationalization", "Rationalization")}</Label>
            <Input value={rationalization} placeholder={t("eqStandards.rationalizationHint", "Why this alarm exists / operator action")} onChange={(e) => setRationalization(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={isSuppressed} onCheckedChange={(v) => setIsSuppressed(Boolean(v))} />
            {t("eqStandards.suppressDesign", "Design suppression (out-of-service — never raises)")}
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel", "Cancel")}</Button>
          <Button onClick={submit} disabled={pending}><CheckCircle2 className="mr-1 h-4 w-4" />{t("eqStandards.save", "Save mapping")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Submit change-request dialog ──────────────────────────────────────────────
type AttrDataType = "bool" | "int" | "float" | "string" | "json" | "enum";
const ATTR_DATA_TYPES: AttrDataType[] = ["string", "int", "float", "bool", "json", "enum"];
interface AttrRow { name: string; dataType: AttrDataType; unit: string; required: boolean; }

/** Payload the CR carries — a REAL proposed schema (no longer an empty {} default). */
interface SubmitCrValue {
  targetTypeKey: string;
  kind: "new_type" | "modify" | "deprecate";
  semverBump?: "major" | "minor" | "patch";
  proposedSchema: {
    parentTypeKey?: string;
    attributesSchema: Array<{ name: string; dataType: AttrDataType; unit?: string; required?: boolean }>;
    supportedCommands: Array<{ name: string }>;
  };
}

function SubmitCrDialog({
  parentOptions, canView, pending, onClose, onSubmit,
}: {
  parentOptions: TreeNode[];
  canView: boolean;
  pending: boolean;
  onClose: () => void;
  onSubmit: (v: SubmitCrValue) => void;
}) {
  const { t } = useTranslation();
  const [targetTypeKey, setTargetTypeKey] = useState("");
  const [kind, setKind] = useState<"new_type" | "modify" | "deprecate">("modify");
  const [semverBump, setSemverBump] = useState<"major" | "minor" | "patch">("minor");
  const [parentTypeKey, setParentTypeKey] = useState("");
  const [attrs, setAttrs] = useState<AttrRow[]>([]);
  const [cmds, setCmds] = useState<string[]>([]);

  // Flatten the tree for the parent <select>.
  const flatKeys = useMemo(() => {
    const out: string[] = [];
    const walk = (nodes: TreeNode[]) => { for (const n of nodes) { out.push(n.typeKey); walk(n.children); } };
    walk(parentOptions);
    return out;
  }, [parentOptions]);

  // Prefill source — resolve the current published type for the entered targetTypeKey.
  const key = targetTypeKey.trim();
  const resolveQ = trpc.equipmentStandards.resolveType.useQuery(
    { typeKey: key },
    { enabled: canView && key.length > 0, retry: false },
  );
  const resolved = resolveQ.data as ResolvedType | undefined;
  const hasResolved = !!resolved && !resolveQ.isError;

  // Copy the merged current schema into the editors so the change ADDS to (never
  // silently replaces/empties) the existing type — the fix for the hierarchy-wipe bug.
  const prefill = () => {
    if (!resolved) return;
    setAttrs(resolved.attributesSchema.map((a) => ({
      name: a.name, dataType: (a.dataType as AttrDataType) ?? "string", unit: a.unit ?? "", required: a.required ?? false,
    })));
    setCmds(resolved.supportedCommands.map((c) => c.name));
    // Parent = the node just above self in the resolved inheritance chain.
    const chain = resolved.inheritanceChain;
    setParentTypeKey(chain.length >= 2 ? chain[chain.length - 2] : "");
    toast.success(t("eqStandards.crPrefilled", "Loaded current schema — edit below."));
  };

  const submit = () => {
    if (!key) { toast.error(t("eqStandards.targetRequired", "Target type key is required.")); return; }
    const attributesSchema = attrs
      .filter((a) => a.name.trim())
      .map((a) => ({ name: a.name.trim(), dataType: a.dataType, unit: a.unit.trim() || undefined, required: a.required || undefined }));
    const supportedCommands = cmds.filter((c) => c.trim()).map((c) => ({ name: c.trim() }));
    onSubmit({
      targetTypeKey: key, kind, semverBump,
      proposedSchema: { parentTypeKey: parentTypeKey.trim() || undefined, attributesSchema, supportedCommands },
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><GitPullRequest className="h-4 w-4" />{t("eqStandards.submitCrTitle", "Submit change request")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-1">
            <Label>{t("eqStandards.targetType", "Target type key")}</Label>
            <div className="flex items-center gap-2">
              <Input value={targetTypeKey} placeholder="Robot" onChange={(e) => setTargetTypeKey(e.target.value)} />
              <Button type="button" variant="outline" size="sm" className="h-9 shrink-0" disabled={!hasResolved} onClick={prefill}>
                <Layers className="mr-1 h-4 w-4" />{t("eqStandards.crPrefill", "Prefill")}
              </Button>
            </div>
            {key.length > 0 && resolveQ.isFetching && (
              <Text tone="muted" variant="caption">{t("eqStandards.loading", "Loading…")}</Text>
            )}
            {key.length > 0 && !resolveQ.isFetching && !hasResolved && (
              <Text tone="muted" variant="caption">{t("eqStandards.crNoResolve", "No existing published type for this key — a new type will be created on publish.")}</Text>
            )}
            {hasResolved && !resolveQ.isFetching && (
              <Text tone="muted" variant="caption">{t("eqStandards.crPrefillHint", "Click Prefill to load current attributes/commands so your change adds to them instead of replacing the type.")}</Text>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1">
              <Label>{t("eqStandards.kind", "Kind")}</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(["new_type", "modify", "deprecate"] as const).map((k) => (
                    <SelectItem key={k} value={k}>{t(`eqStandards.crKind.${k}`, k)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label>{t("eqStandards.semverBump", "SemVer bump")}</Label>
              <Select value={semverBump} onValueChange={(v) => setSemverBump(v as typeof semverBump)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(["major", "minor", "patch"] as const).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label>{t("eqStandards.parent", "Parent type")}</Label>
              {/* U11 — Select DS; "__none__" là sentinel cho "không cha (root)". */}
              <Select value={parentTypeKey || "__none__"} onValueChange={(v) => setParentTypeKey(v === "__none__" ? "" : v)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t("eqStandards.noParent", "(none — root)")}</SelectItem>
                  {flatKeys.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Attributes editor */}
          <div className="grid gap-1">
            <div className="flex items-center justify-between">
              <Label>{t("eqStandards.attributes", "Attributes")} ({attrs.length})</Label>
              <Button type="button" variant="ghost" size="sm" className="h-7"
                onClick={() => setAttrs((a) => [...a, { name: "", dataType: "string", unit: "", required: false }])}>
                <Plus className="mr-1 h-3.5 w-3.5" />{t("eqStandards.addAttr", "Add attribute")}
              </Button>
            </div>
            {attrs.length === 0 ? (
              <Text tone="muted" variant="caption">{t("eqStandards.crNoAttrs", "No attributes yet — prefill or add rows.")}</Text>
            ) : (
              <div className="space-y-1">
                {attrs.map((a, i) => (
                  <div key={i} className="flex items-center gap-1">
                    <Input className="h-8 flex-1" placeholder={t("eqStandards.attrName", "name")} value={a.name}
                      onChange={(e) => setAttrs((arr) => arr.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                    <Select value={a.dataType}
                      onValueChange={(v) => setAttrs((arr) => arr.map((x, j) => j === i ? { ...x, dataType: v as AttrDataType } : x))}>
                      <SelectTrigger size="sm" className="w-24 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ATTR_DATA_TYPES.map((dt) => <SelectItem key={dt} value={dt}>{dt}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Input className="h-8 w-20" placeholder={t("eqStandards.unit", "unit")} value={a.unit}
                      onChange={(e) => setAttrs((arr) => arr.map((x, j) => j === i ? { ...x, unit: e.target.value } : x))} />
                    <label className="flex items-center gap-1 text-xs text-muted-foreground" title={t("eqStandards.required", "Required")}>
                      <Checkbox checked={a.required}
                        onCheckedChange={(v) => setAttrs((arr) => arr.map((x, j) => j === i ? { ...x, required: Boolean(v) } : x))} />
                      {t("eqStandards.reqShort", "req")}
                    </label>
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0"
                      onClick={() => setAttrs((arr) => arr.filter((_, j) => j !== i))}>
                      <XCircle className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Commands editor */}
          <div className="grid gap-1">
            <div className="flex items-center justify-between">
              <Label>{t("eqStandards.commands", "Commands")} ({cmds.length})</Label>
              <Button type="button" variant="ghost" size="sm" className="h-7" onClick={() => setCmds((c) => [...c, ""])}>
                <Plus className="mr-1 h-3.5 w-3.5" />{t("eqStandards.addCmd", "Add command")}
              </Button>
            </div>
            {cmds.length === 0 ? (
              <Text tone="muted" variant="caption">{t("eqStandards.crNoCmds", "No commands yet — prefill or add rows.")}</Text>
            ) : (
              <div className="space-y-1">
                {cmds.map((c, i) => (
                  <div key={i} className="flex items-center gap-1">
                    <Input className="h-8 flex-1" placeholder={t("eqStandards.cmdName", "command name")} value={c}
                      onChange={(e) => setCmds((arr) => arr.map((x, j) => j === i ? e.target.value : x))} />
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0"
                      onClick={() => setCmds((arr) => arr.filter((_, j) => j !== i))}>
                      <XCircle className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            {t("eqStandards.crHint", "After submission the CR goes pending → in-review → approved, then publish enforces the conformance + backward-compatibility gate.")}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel", "Cancel")}</Button>
          <Button onClick={submit} disabled={pending}><Send className="mr-1 h-4 w-4" />{t("eqStandards.submit", "Submit")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
