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
import {
  MetricCard,
  PageHeader,
  SectionCard,
  StatusBadge,
  Heading,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ResponsiveContainer, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Cell,
} from "recharts";
import {
  ShieldCheck, RefreshCw, Info, Lock, AlertTriangle, Plus, Search, Link2,
  Network, Bell, GitPullRequest, ClipboardCheck, ChevronRight, ChevronDown,
  Boxes, Cpu, Tags, Wrench, CheckCircle2, XCircle, Send, Eye, Rocket, Layers,
} from "lucide-react";
import { toast } from "sonner";

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
  const { hasPermission } = usePermissions();
  const canView = hasPermission("machine_monitoring", "canView");
  const canControl = hasPermission("machine_control", "canCreate");

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

  const tree = (treeQ.data?.tree ?? []) as TreeNode[];
  const resolved = resolveQ.data as ResolvedType | undefined;
  const alarms = (alarmsQ.data?.mappings ?? []) as AlarmMapping[];
  const vendors = (alarmsQ.data?.vendors ?? []) as string[];
  const mapped = mapAlarmQ.data as MappedAlarm | undefined;
  const crs = (crsQ.data ?? []) as ChangeRequest[];
  const compliance = complianceQ.data as Compliance | undefined;
  const conformance = conformanceQ.data as Conformance | undefined;

  const flagEnabled = statusQ.data?.enabled ?? true;

  const refetchAll = () => {
    void utils.equipmentStandards.status.invalidate();
    void utils.equipmentStandards.hierarchyTree.invalidate();
    void utils.equipmentStandards.resolveType.invalidate();
    void utils.equipmentStandards.listAlarmMappings.invalidate();
    void utils.equipmentStandards.listChangeRequests.invalidate();
    void utils.equipmentStandards.complianceMetrics.invalidate();
    void utils.equipmentStandards.runConformance.invalidate();
  };

  // Surface the FLAG-OFF CONFLICT gracefully (info, not a scary red error).
  const onMutationError = (e: { data?: { code?: string } | null; message: string }) => {
    if (e.data?.code === "CONFLICT" && /disabled/i.test(e.message)) {
      toast.info(t("eqStandards.flagOffToast", "Equipment governance is disabled (preview). Set EQ_GOVERN_ENABLED=true to act."));
      void utils.equipmentStandards.status.invalidate();
    } else {
      toast.error(e.message);
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
      <div className="flex flex-col gap-4 p-4 md:p-6">
        {/* ── PageHeader (DS F1b shared pattern) ─────────────────────────────── */}
        <PageHeader
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
            <TabsTrigger value="crs"><GitPullRequest className="mr-1 h-4 w-4" />{t("eqStandards.tab.crs", "Change requests")}</TabsTrigger>
            <TabsTrigger value="compliance"><ClipboardCheck className="mr-1 h-4 w-4" />{t("eqStandards.tab.compliance", "Compliance")}</TabsTrigger>
          </TabsList>

          {/* ════════════════ TAB: Hierarchy (E1-a) ════════════════ */}
          <TabsContent value="hierarchy" className="flex flex-col gap-4 lg:flex-row lg:items-start">
            <SectionCard
              icon={<Network className="h-4 w-4" />}
              title={t("eqStandards.hierarchyTitle", "Device type hierarchy")}
              className="lg:w-1/2"
              action={canControl ? (
                <Button size="sm" variant="outline" className="h-8" onClick={() => setRegisterOpen(true)}>
                  <Plus className="mr-1 h-4 w-4" />{t("eqStandards.registerType", "Register type")}
                </Button>
              ) : undefined}
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
                  <StatusBadge status={mapped.severity} tone={SEVERITY_TONE[mapped.severity as Severity] ?? "default"} label={t(`eqStandards.severity.${mapped.severity}`, mapped.severity)} />
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
                  <select
                    className="flex h-8 w-40 rounded-md border border-input bg-transparent px-2 py-1 text-sm"
                    value={vendorFilter}
                    onChange={(e) => setVendorFilter(e.target.value)}
                  >
                    <option value="">{t("eqStandards.allVendors", "All vendors")}</option>
                    {vendors.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                  {canControl && (
                    <Button size="sm" variant="outline" className="h-8" onClick={() => setUpsertAlarmOpen(true)}>
                      <Plus className="mr-1 h-4 w-4" />{t("eqStandards.mapAlarm", "Map alarm")}
                    </Button>
                  )}
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
                        <StatusBadge status={a.severity} tone={SEVERITY_TONE[a.severity as Severity] ?? "default"} label={t(`eqStandards.severity.${a.severity}`, a.severity)} />
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

          {/* ════════════════ TAB: Change requests (E1-c) ════════════════ */}
          <TabsContent value="crs" className="flex flex-col gap-4">
            <SectionCard
              icon={<GitPullRequest className="h-4 w-4" />}
              title={t("eqStandards.crsTitle", "Equipment Standards Board")}
              contentClassName="p-0"
              action={
                <div className="flex items-center gap-2">
                  <select
                    className="flex h-8 w-36 rounded-md border border-input bg-transparent px-2 py-1 text-sm"
                    value={crStatusFilter}
                    onChange={(e) => setCrStatusFilter(e.target.value)}
                  >
                    <option value="">{t("eqStandards.allStatuses", "All statuses")}</option>
                    {["pending", "in_review", "approved", "rejected", "published"].map((s) => (
                      <option key={s} value={s}>{t(`eqStandards.crStatus.${s}`, s)}</option>
                    ))}
                  </select>
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
                                    title={t("eqStandards.approveTip", "Approve (records conformance pass)")}
                                    onClick={() => reviewCrM.mutate({ crId: cr.id, to: "approved", conformanceStatus: "pass" })}>
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
                          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                          <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                          <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                          <Tooltip />
                          <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                            {conformanceChart.map((entry) => (
                              <Cell key={entry.kind} fill={entry.kind === "pass" ? "hsl(142 71% 45%)" : "hsl(0 84% 60%)"} />
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
      </div>

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
          pending={submitCrM.isPending}
          onClose={() => setSubmitCrOpen(false)}
          onSubmit={(v) => submitCrM.mutate(v)}
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
            <select className="flex h-9 rounded-md border border-input bg-transparent px-2 py-1 text-sm"
              value={parentTypeKey} onChange={(e) => setParentTypeKey(e.target.value)}>
              <option value="">{t("eqStandards.noParent", "(none — root)")}</option>
              {flatKeys.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
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
              <select className="flex h-9 rounded-md border border-input bg-transparent px-2 py-1 text-sm"
                value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
                {SEVERITIES.map((s) => <option key={s} value={s}>{t(`eqStandards.severity.${s}`, s)}</option>)}
              </select>
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

// ── Submit change-request dialog ──────────────────────────────────────────────
function SubmitCrDialog({
  pending, onClose, onSubmit,
}: {
  pending: boolean;
  onClose: () => void;
  onSubmit: (v: { targetTypeKey: string; kind: "new_type" | "modify" | "deprecate"; semverBump?: "major" | "minor" | "patch" }) => void;
}) {
  const { t } = useTranslation();
  const [targetTypeKey, setTargetTypeKey] = useState("");
  const [kind, setKind] = useState<"new_type" | "modify" | "deprecate">("modify");
  const [semverBump, setSemverBump] = useState<"major" | "minor" | "patch">("minor");

  const submit = () => {
    if (!targetTypeKey.trim()) { toast.error(t("eqStandards.targetRequired", "Target type key is required.")); return; }
    onSubmit({ targetTypeKey: targetTypeKey.trim(), kind, semverBump });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><GitPullRequest className="h-4 w-4" />{t("eqStandards.submitCrTitle", "Submit change request")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-1">
            <Label>{t("eqStandards.targetType", "Target type key")}</Label>
            <Input value={targetTypeKey} placeholder="Robot" onChange={(e) => setTargetTypeKey(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label>{t("eqStandards.kind", "Kind")}</Label>
              <select className="flex h-9 rounded-md border border-input bg-transparent px-2 py-1 text-sm"
                value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                {(["new_type", "modify", "deprecate"] as const).map((k) => (
                  <option key={k} value={k}>{t(`eqStandards.crKind.${k}`, k)}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-1">
              <Label>{t("eqStandards.semverBump", "SemVer bump")}</Label>
              <select className="flex h-9 rounded-md border border-input bg-transparent px-2 py-1 text-sm"
                value={semverBump} onChange={(e) => setSemverBump(e.target.value as typeof semverBump)}>
                {(["major", "minor", "patch"] as const).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
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
