/**
 * X1 (doc 16 §5 / §15 Khối 1) — FIELD & DEVICE ABSTRACTION surface.
 *
 * Read-mostly cockpit over the fieldRouter (flag FIELD_V2_ENABLED), organised into tabs:
 *   • "Device health" (X1-b) — the field_device_health liveness board: device, liveness
 *       StatusBadge (live=success / stale=warning / lost_connection=error / unknown=muted),
 *       last_heartbeat (relative), discovery provenance + endpoint. A robot picker drives a
 *       deviceState() detail panel showing the FULL Unified Device Model (battery_level,
 *       joint_states, safety_zone_id, firmware_version, last_heartbeat, pose, …).
 *   • "Discovery" (X1-d, hot-plug) — protocol select + endpoint → discover(). OPC-UA is a
 *       REAL browse (renders candidates + register-candidate action). mDNS/modbus/s7/
 *       ethernet-ip are HONEST SEAMS — the {seam:true} flag drives a calm "framework seam —
 *       no real probe" message; NO results are fabricated.
 *
 * HONESTY (mirrors the router/services):
 *   • joint_states / firmware_version are null until a real DRIVER provides them → rendered
 *     "—" with a note that a driver must supply them (never invented).
 *   • AGV battery_level flows from VDA5050; null when no telemetry.
 *   • lost_connection is ADVISORY (signal-only) — NOT a safety-rated stop.
 *   • non-OPCUA discovery is a documented seam; OPC-UA needs node-opcua + a reachable
 *     endpoint, else it returns an honest {ok:false, reason} (no fake nodes).
 *
 * SAFETY / RBAC: reads = machine_monitoring/canView. Discovery + register =
 * machine_control/canCreate + FIELD_V2_ENABLED. When the flag is OFF the page shows a calm
 * preview banner and surfaces the CONFLICT error gracefully (toast.info, not red).
 *
 * Uses the DS F1b pattern components (PageHeader / MetricCard / StatusBadge / SectionCard /
 * Text). i18n via the t("field.*", "English default") fallback pattern.
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
  Text,
} from "@/components/patterns";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Radio, RefreshCw, Info, Lock, AlertTriangle, Cpu, HeartPulse, Plug,
  Battery, ShieldAlert, Search, PlusCircle, CircleSlash, Activity, Wifi,
} from "lucide-react";
import { toast } from "sonner";

// ── Typesafe shapes inferred from the fieldRouter output ──────────────────────
type RouterOutputs = inferRouterOutputs<AppRouter>;
type HealthRow = RouterOutputs["field"]["health"][number];
type DeviceState = RouterOutputs["field"]["deviceState"];
type DiscoverResult = RouterOutputs["field"]["discover"];
type DiscoveredCandidate = DiscoverResult["candidates"][number];
type RobotRow = RouterOutputs["robot"]["list"][number];

type Liveness = "live" | "stale" | "lost_connection" | "unknown";
const DISCOVERY_PROTOCOLS = ["opcua", "mdns", "modbus", "s7", "ethernet-ip"] as const;
type DiscoveryProtocol = (typeof DISCOVERY_PROTOCOLS)[number];

/** Liveness → DS tone (explicit per the X1 spec). */
const LIVENESS_TONE: Record<Liveness, "success" | "warning" | "error" | "default"> = {
  live: "success",
  stale: "warning",
  lost_connection: "error",
  unknown: "default",
};

function strOrDash(s: string | null | undefined): string {
  return s == null || s === "" ? "—" : s;
}

/** Relative "x ago" from an ISO/Date value (calm, locale-agnostic short form). */
function relativeTime(value: string | Date | null | undefined, t: (k: string, d: string) => string): string {
  if (!value) return "—";
  const ts = typeof value === "string" ? Date.parse(value) : value.getTime();
  if (!Number.isFinite(ts)) return "—";
  const diffMs = Date.now() - ts;
  const s = Math.round(diffMs / 1000);
  if (s < 5) return t("field.justNow", "just now");
  if (s < 60) return `${s}${t("field.secAgo", "s ago")}`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}${t("field.minAgo", "m ago")}`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}${t("field.hrAgo", "h ago")}`;
  const d = Math.round(h / 24);
  return `${d}${t("field.dayAgo", "d ago")}`;
}

export function FieldDevicesContent() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canView = hasPermission("machine_monitoring", "canView");
  const canControl = hasPermission("machine_control", "canCreate");

  const [tab, setTab] = useState("health");
  const [pickedRobotId, setPickedRobotId] = useState<number | null>(null);

  // Discovery tab state
  const [protocol, setProtocol] = useState<DiscoveryProtocol>("opcua");
  const [endpoint, setEndpoint] = useState("");
  const [rootNodeId, setRootNodeId] = useState("");
  const [result, setResult] = useState<DiscoverResult | null>(null);

  const utils = trpc.useUtils();

  // ── Reads (RBAC: machine_monitoring/canView) ────────────────────────────────
  const statusQ = trpc.field.status.useQuery(undefined, { enabled: canView });
  const summaryQ = trpc.field.healthSummary.useQuery(undefined, { enabled: canView });
  const healthQ = trpc.field.health.useQuery(undefined, { enabled: canView });
  const robotsQ = trpc.robot.list.useQuery(undefined, { enabled: canView });

  const stateQ = trpc.field.deviceState.useQuery(
    { robotId: pickedRobotId ?? 0 },
    { enabled: canView && !!pickedRobotId, retry: false },
  );

  const flagEnabled = statusQ.data?.enabled ?? true;
  const probeSupport = statusQ.data?.probeSupport;
  const summary = (summaryQ.data ?? {}) as Record<string, number>;
  const healthRows = (healthQ.data ?? []) as HealthRow[];
  const robots = (robotsQ.data ?? []) as RobotRow[];

  const count = (s: Liveness) => summary[s] ?? 0;

  const refetchAll = () => {
    void utils.field.status.invalidate();
    void utils.field.healthSummary.invalidate();
    void utils.field.health.invalidate();
    void utils.field.deviceState.invalidate();
  };

  // Surface the FLAG-OFF CONFLICT gracefully (info, not a scary red error).
  const onMutationError = (e: { data?: { code?: string } | null; message: string }) => {
    if (e.data?.code === "CONFLICT" && /disabled/i.test(e.message)) {
      toast.info(t("field.flagOffToast", "Field abstraction is disabled (preview). Set FIELD_V2_ENABLED=true to act."));
      void utils.field.status.invalidate();
    } else {
      toast.error(e.message);
    }
  };

  // ── Mutations (RBAC: machine_control/canCreate + FIELD_V2_ENABLED) ───────────
  const discoverM = trpc.field.discover.useMutation({
    onSuccess: (res) => {
      setResult(res);
      if (res.ok && res.candidates.length > 0) {
        toast.success(t("field.discoverFound", "Discovered {{n}} candidate(s)").replace("{{n}}", String(res.candidates.length)));
      } else if (res.seam) {
        toast.info(t("field.discoverSeam", "This protocol is a framework seam — no real probe yet."));
      } else if (!res.ok) {
        toast.info(res.reason ?? t("field.discoverNone", "No candidates found."));
      } else {
        toast.info(t("field.discoverNone", "No candidates found."));
      }
    },
    onError: onMutationError,
  });
  const registerM = trpc.field.registerDiscovered.useMutation({
    onSuccess: (res) => {
      if (res.ok) {
        toast.success(t("field.registered", "Registered as a DISABLED adapter (enable it later to connect)."));
        refetchAll();
      } else {
        toast.info(res.message ?? t("field.registerSeam", "Nothing to register for this protocol."));
      }
    },
    onError: onMutationError,
  });

  const runDiscover = () => {
    const ep = endpoint.trim();
    if (!ep) { toast.error(t("field.endpointRequired", "Enter an endpoint to probe.")); return; }
    setResult(null);
    discoverM.mutate({
      protocol,
      endpoint: ep,
      rootNodeId: protocol === "opcua" && rootNodeId.trim() ? rootNodeId.trim() : undefined,
    });
  };

  if (!canView) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            <AlertTriangle className="mx-auto mb-2 h-6 w-6" />
            {t("field.noPermission", "You do not have permission to view field devices.")}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
        {/* ── PageHeader (DS F1b shared pattern) ─────────────────────────────── */}
        <PageHeader
          icon={<Radio className="h-6 w-6" />}
          title={t("field.title", "Field & Device Abstraction")}
          badge={!canControl ? <ViewOnlyBadge module="machine_control" /> : undefined}
          description={t("field.subtitle", "Unified Device Model state, heartbeat liveness (live / stale / lost_connection) and hot-plug discovery — monitoring & registry state only, no device commands.")}
          actions={
            <Button size="icon" variant="ghost" onClick={refetchAll} title={t("common.refresh", "Refresh")}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          }
        />

        {/* ── Flag-off preview banner (honest, calm) ─────────────────────────── */}
        {!flagEnabled && (
          <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <span>
              {t(
                "field.flagOffBanner",
                "Preview mode: field abstraction v2 is disabled (FIELD_V2_ENABLED is off). Reads work; hot-plug actions (discover / register a device) are blocked until the flag is enabled.",
              )}
            </span>
          </div>
        )}

        {/* Safety / honesty note — mirrors the router discipline */}
        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {t(
              "field.safetyNote",
              "This surface writes registry/health STATE only — it opens no device-control path. lost_connection is an ADVISORY signal (it triggers no safety-rated stop). Discovery probes are read-only; a registered device starts DISABLED and must be enabled explicitly.",
            )}
          </span>
        </div>

        {/* ── KPI strip (from healthSummary) ─────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard
            icon={<HeartPulse className="h-4 w-4" />}
            label={t("field.kpi.live", "Live")}
            value={summaryQ.isLoading ? "—" : count("live")}
            tone="good"
          />
          <MetricCard
            icon={<Activity className="h-4 w-4" />}
            label={t("field.kpi.stale", "Stale")}
            value={summaryQ.isLoading ? "—" : count("stale")}
            tone={count("stale") > 0 ? "warning" : "default"}
          />
          <MetricCard
            icon={<ShieldAlert className="h-4 w-4" />}
            label={t("field.kpi.lost", "Lost connection")}
            value={summaryQ.isLoading ? "—" : count("lost_connection")}
            tone={count("lost_connection") > 0 ? "error" : "default"}
          />
          <MetricCard
            icon={<CircleSlash className="h-4 w-4" />}
            label={t("field.kpi.unknown", "Unknown")}
            value={summaryQ.isLoading ? "—" : count("unknown")}
            tone="default"
          />
        </div>

        {/* ── Tabbed surface ─────────────────────────────────────────────────── */}
        <Tabs value={tab} onValueChange={setTab} className="gap-4">
          <TabsList className="flex-wrap">
            <TabsTrigger value="health"><HeartPulse className="mr-1 h-4 w-4" />{t("field.tab.health", "Device health")}</TabsTrigger>
            <TabsTrigger value="discovery"><Search className="mr-1 h-4 w-4" />{t("field.tab.discovery", "Discovery (hot-plug)")}</TabsTrigger>
          </TabsList>

          {/* ════════════════ TAB: Device health (X1-b) ════════════════ */}
          <TabsContent value="health" className="flex flex-col gap-4">
            <SectionCard
              icon={<HeartPulse className="h-4 w-4" />}
              title={t("field.healthTitle", "Device liveness board")}
              description={t("field.healthDesc", "One row per tracked device. Liveness is derived from heartbeat age (TTL-based).")}
              contentClassName="p-0"
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("field.col.device", "Device")}</TableHead>
                    <TableHead>{t("field.col.kind", "Kind")}</TableHead>
                    <TableHead>{t("field.col.liveness", "Liveness")}</TableHead>
                    <TableHead>{t("field.col.heartbeat", "Last heartbeat")}</TableHead>
                    <TableHead>{t("field.col.discoveredVia", "Discovered via")}</TableHead>
                    <TableHead>{t("field.col.endpoint", "Endpoint")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {healthQ.isLoading && (
                    <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">{t("field.loading", "Loading…")}</TableCell></TableRow>
                  )}
                  {!healthQ.isLoading && healthRows.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">{t("field.healthEmpty", "No tracked devices yet. Devices appear here once they heartbeat or are discovered.")}</TableCell></TableRow>
                  )}
                  {healthRows.map((row) => {
                    const state = (row.state as Liveness) ?? "unknown";
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="font-mono text-xs">{row.deviceKey}</TableCell>
                        <TableCell className="text-xs">{strOrDash(row.deviceKind)}</TableCell>
                        <TableCell>
                          <StatusBadge
                            status={state}
                            tone={LIVENESS_TONE[state] ?? "default"}
                            label={t(`field.liveness.${state}`, state)}
                          />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground" title={row.lastHeartbeat ? new Date(row.lastHeartbeat).toLocaleString() : undefined}>
                          {relativeTime(row.lastHeartbeat, t)}
                        </TableCell>
                        <TableCell className="text-xs">{strOrDash(row.discoveredVia)}</TableCell>
                        <TableCell className="max-w-[16rem] truncate font-mono text-xs text-muted-foreground" title={row.endpoint ?? undefined}>
                          {strOrDash(row.endpoint)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </SectionCard>

            {/* ── UDM detail panel (deviceState) ─────────────────────────────── */}
            <SectionCard
              icon={<Cpu className="h-4 w-4" />}
              title={t("field.udmTitle", "Unified Device Model — robot detail")}
              description={t("field.udmDesc", "Latest telemetry snapshot for the selected robot, with derived liveness.")}
            >
              <div className="flex flex-wrap items-end gap-2">
                <div className="grid gap-1">
                  <Label className="text-xs text-muted-foreground">{t("field.pickRobot", "Robot / AGV")}</Label>
                  <select
                    className="flex h-9 w-64 rounded-md border border-input bg-transparent px-2 py-1 text-sm"
                    value={pickedRobotId ?? ""}
                    onChange={(e) => setPickedRobotId(e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">{t("field.selectRobot", "Select a robot…")}</option>
                    {robots.map((r) => (
                      <option key={r.id} value={r.id}>{r.name ?? r.code} ({r.code})</option>
                    ))}
                  </select>
                </div>
              </div>

              {!pickedRobotId && (
                <Text tone="muted" variant="body-sm" className="mt-3">{t("field.udmHint", "Pick a robot above to inspect its full Unified Device Model snapshot.")}</Text>
              )}
              {pickedRobotId && stateQ.isFetching && (
                <Text tone="muted" variant="body-sm" className="mt-3">{t("field.loading", "Loading…")}</Text>
              )}
              {pickedRobotId && !stateQ.isFetching && stateQ.data && (
                <UdmPanel state={stateQ.data as DeviceState} />
              )}
            </SectionCard>
          </TabsContent>

          {/* ════════════════ TAB: Discovery / hot-plug (X1-d) ════════════════ */}
          <TabsContent value="discovery" className="flex flex-col gap-4">
            {/* Honesty: real vs seam matrix */}
            <div className="flex items-start gap-2 rounded-md border border-info/30 bg-info/10 p-3 text-sm">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" />
              <div className="space-y-1 text-muted-foreground">
                <span>
                  {t(
                    "field.discoveryNote",
                    "OPC-UA discovery is a REAL probe (it browses the server's address space; needs node-opcua + a reachable endpoint). The other protocols are HONEST FRAMEWORK SEAMS — no real probe library is linked, so they return no fabricated results.",
                  )}
                </span>
                {probeSupport && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {DISCOVERY_PROTOCOLS.map((p) => (
                      <Badge
                        key={p}
                        variant="outline"
                        className={probeSupport[p] === "real"
                          ? "border-success/30 bg-success/15 font-mono text-xs text-success"
                          : "border-warning/30 bg-warning/15 font-mono text-xs text-warning"}
                      >
                        {p}: {probeSupport[p] === "real" ? t("field.real", "real") : t("field.seam", "seam")}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <SectionCard
              icon={<Search className="h-4 w-4" />}
              title={t("field.probeTitle", "Probe an endpoint")}
            >
              {!canControl ? (
                <Text tone="muted" variant="body-sm">{t("field.discoveryViewOnly", "Discovery requires machine_control / create. You have view-only access.")}</Text>
              ) : (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="grid gap-1">
                    <Label className="text-xs text-muted-foreground">{t("field.protocol", "Protocol")}</Label>
                    <select
                      className="flex h-9 w-44 rounded-md border border-input bg-transparent px-2 py-1 text-sm"
                      value={protocol}
                      onChange={(e) => { setProtocol(e.target.value as DiscoveryProtocol); setResult(null); }}
                    >
                      {DISCOVERY_PROTOCOLS.map((p) => (
                        <option key={p} value={p}>
                          {p}{probeSupport ? ` (${probeSupport[p]})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-1">
                    <Label className="text-xs text-muted-foreground">{t("field.endpoint", "Endpoint")}</Label>
                    <Input
                      className="w-72"
                      value={endpoint}
                      placeholder="opc.tcp://192.168.0.10:4840"
                      onChange={(e) => setEndpoint(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") runDiscover(); }}
                    />
                  </div>
                  {protocol === "opcua" && (
                    <div className="grid gap-1">
                      <Label className="text-xs text-muted-foreground">{t("field.rootNode", "Root node (optional)")}</Label>
                      <Input
                        className="w-52"
                        value={rootNodeId}
                        placeholder="ns=0;i=85 (Objects)"
                        onChange={(e) => setRootNodeId(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") runDiscover(); }}
                      />
                    </div>
                  )}
                  <Button size="sm" disabled={discoverM.isPending || !endpoint.trim()} onClick={runDiscover}>
                    <Wifi className="mr-1 h-4 w-4" />{t("field.discover", "Discover")}
                  </Button>
                </div>
              )}
            </SectionCard>

            {/* Result panel */}
            {result && (
              <SectionCard
                icon={<Plug className="h-4 w-4" />}
                title={t("field.resultsTitle", "Discovery results")}
                action={
                  result.seam ? (
                    <Badge variant="outline" className="border-warning/30 bg-warning/15 text-warning">
                      <CircleSlash className="mr-1 h-3 w-3" />{t("field.seamBadge", "framework seam")}
                    </Badge>
                  ) : result.ok ? (
                    <StatusBadge status="ok" tone="success" label={t("field.probeOk", "probe ok")} />
                  ) : (
                    <Badge variant="outline" className="border-destructive/30 bg-destructive/15 text-destructive">
                      {t("field.probeFailed", "probe failed")}
                    </Badge>
                  )
                }
                contentClassName={result.candidates.length ? "p-0" : undefined}
              >
                {result.seam && (
                  <div className="flex items-start gap-2 text-sm text-muted-foreground">
                    <Info className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{result.reason ?? t("field.seamMsg", "Not yet supported — framework seam. No real probe library is linked for this protocol, so no results are fabricated.")}</span>
                  </div>
                )}
                {!result.seam && !result.ok && (
                  <div className="flex items-start gap-2 text-sm text-muted-foreground">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                    <span>{result.reason ?? t("field.probeFailedMsg", "Probe failed (endpoint unreachable or driver unavailable). No results fabricated.")}</span>
                  </div>
                )}
                {!result.seam && result.ok && result.candidates.length === 0 && (
                  <Text tone="muted" variant="body-sm">{t("field.noCandidates", "Probe succeeded but found no candidate devices.")}</Text>
                )}
                {result.candidates.length > 0 && (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("field.col.candidate", "Candidate")}</TableHead>
                        <TableHead>{t("field.col.candidateId", "Candidate ID")}</TableHead>
                        <TableHead className="text-right">{t("common.actions", "Actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.candidates.map((c) => (
                        <CandidateRow
                          key={c.candidateId}
                          candidate={c}
                          canControl={canControl}
                          pending={registerM.isPending}
                          onRegister={() => registerM.mutate({
                            candidate: { protocol: c.protocol, endpoint: c.endpoint, name: c.name, detail: c.detail },
                          })}
                        />
                      ))}
                    </TableBody>
                  </Table>
                )}
              </SectionCard>
            )}
          </TabsContent>
        </Tabs>
      </div>
  );
}

export default function FieldDevices() {
  return (
    <DashboardLayout>
      <FieldDevicesContent />
    </DashboardLayout>
  );
}

// ── Discovered-candidate row + register action ────────────────────────────────
function CandidateRow({
  candidate, canControl, pending, onRegister,
}: {
  candidate: DiscoveredCandidate;
  canControl: boolean;
  pending: boolean;
  onRegister: () => void;
}) {
  const { t } = useTranslation();
  return (
    <TableRow>
      <TableCell className="text-xs">{candidate.name}</TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">{candidate.candidateId}</TableCell>
      <TableCell className="text-right">
        {canControl ? (
          <Button size="sm" variant="ghost" className="h-7" disabled={pending} onClick={onRegister}
            title={t("field.registerTip", "Register this candidate as a DISABLED adapter (enable it later to connect)")}>
            <PlusCircle className="mr-1 h-3.5 w-3.5 text-success" />{t("field.register", "Register")}
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">{t("field.viewOnly", "View only")}</span>
        )}
      </TableCell>
    </TableRow>
  );
}

// ── UDM detail panel — full Unified Device Model with honest nulls ─────────────
function UdmPanel({ state }: { state: DeviceState }) {
  const { t } = useTranslation();
  const liveness = state.liveness as Liveness;
  const udm = state.udm;

  // joint_states may be null (no driver) or an array/object the driver provided.
  const joints = useMemo<unknown[] | null>(() => {
    const js = udm?.jointStates;
    if (js == null) return null;
    if (Array.isArray(js)) return js;
    if (typeof js === "object") return Object.values(js as Record<string, unknown>);
    return [js];
  }, [udm]);

  const battery = udm?.batteryLevel == null ? null : Number(udm.batteryLevel);

  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-medium">{state.robot.name ?? state.robot.code}</span>
        <Badge variant="outline" className="font-mono text-xs">{state.robot.code}</Badge>
        {state.robot.kind && <Badge variant="secondary" className="text-xs">{state.robot.kind}</Badge>}
        <StatusBadge status={liveness} tone={LIVENESS_TONE[liveness] ?? "default"} label={t(`field.liveness.${liveness}`, liveness)} />
      </div>

      {!udm && (
        <Text tone="muted" variant="body-sm">{t("field.noTelemetry", "No telemetry rows for this device yet.")}</Text>
      )}

      {udm && (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Core UDM fields */}
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              <UdmField label="mode" value={strOrDash(udm.mode)} />
              <UdmField label="busy" value={udm.busy == null ? "—" : String(udm.busy)} />
              <UdmField label="estop" value={udm.estop == null ? "—" : String(udm.estop)} />
              <UdmField label="speed_pct" value={udm.speedPct == null ? "—" : String(udm.speedPct)} />
              <UdmField label="payload_kg" value={udm.payloadKg == null ? "—" : String(udm.payloadKg)} />
              <UdmField label="safety_zone_id" value={udm.safetyZoneId == null ? "—" : String(udm.safetyZoneId)} />
              <UdmField label="firmware_version" value={strOrDash(udm.firmwareVersion)} />
              <UdmField
                label="last_heartbeat"
                value={udm.lastHeartbeat ? new Date(udm.lastHeartbeat).toLocaleString() : strOrDash(null)}
              />
            </div>
            {/* Battery — from VDA5050 for AGVs; null otherwise */}
            <div className="mt-3 border-t border-border pt-3">
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="flex items-center gap-1 font-mono text-muted-foreground"><Battery className="h-3.5 w-3.5" />battery_level</span>
                <span className="font-mono font-medium">{battery == null ? "—" : `${Math.round(battery)}%`}</span>
              </div>
              {battery == null ? (
                <Text tone="subtle" variant="caption">{t("field.batteryNull", "No battery telemetry (AGV battery flows from VDA5050; null when no driver reports it).")}</Text>
              ) : (
                <Progress value={Math.max(0, Math.min(100, battery))} className="h-2" />
              )}
            </div>
          </div>

          {/* joint_states — honest null handling */}
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <div className="mb-2 flex items-center gap-1 text-xs font-medium">
              <Cpu className="h-3.5 w-3.5" />joint_states
            </div>
            {joints == null ? (
              <Text tone="subtle" variant="caption">
                {t("field.jointsNull", "— (null). joint_states is null until a real motion driver provides it; the UI never fabricates joint values.")}
              </Text>
            ) : joints.length === 0 ? (
              <Text tone="subtle" variant="caption">{t("field.jointsEmpty", "Driver reported an empty joint set.")}</Text>
            ) : (
              <ul className="space-y-0.5 font-mono text-xs">
                {joints.map((j, i) => (
                  <li key={i} className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">J{i + 1}</span>
                    <span className="font-medium">{typeof j === "object" ? JSON.stringify(j) : String(j)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function UdmField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="font-mono text-muted-foreground">{label}</span>
      <span className="font-mono font-medium">{value}</span>
    </div>
  );
}
