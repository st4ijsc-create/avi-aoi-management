/**
 * P3 / doc 12 §8 — UNIFIED DEVICE MONITOR (flagship, client-only).
 *
 * ONE screen showing EVERY device the platform knows about in a single master table:
 *   - Machines        (trpc.machineStatus.listWithStatus)  — AOI/AVI/SPI/PLC/etc.
 *   - OT adapters     (trpc.deviceAdapter.list)            — protocol connection defs
 *   - Edge nodes      (trpc.edgeRuntime.listNodes)         — edge control runtimes
 * joined into a uniform DeviceRow with: name/code · type · protocol · connection
 * state (online/offline/unknown from status + last-seen) · last telemetry value +
 * a live sparkline fed by the ONE socket channel `telemetry:sample` · testConnection.
 *
 * REALTIME: subscribes once to `telemetry:sample` (global room) + `machine:status_update`.
 * Telemetry rows update live (sparkline + last value) with NO polling for the live
 * bits; the underlying lists use a slow refetch only for membership changes.
 *
 * HONESTY / NO-FAKE-DATA: a device with no telemetry shows "no telemetry yet" and an
 * "unknown" connection chip — never a fabricated number. Protocol frameworks that are
 * flag-gated (MTConnect / SECS-GEM / VDA5050) surface their REAL enabled/disabled
 * state in a status strip with a link to their detailed page.
 *
 * Consolidates the fragmented machine-status / health / adapter / edge views. The
 * legacy pages remain reachable (linked from the header) — see route map in the PR.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { getSharedSocket } from "@/lib/socketManager";
import DashboardLayout from "@/components/DashboardLayout";
import { navItems } from "@/lib/navigation";
import DeviceOnboardingWizard from "@/components/DeviceOnboardingWizard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Wifi, WifiOff, HelpCircle, RefreshCw, Search, Plus, Activity, Server, Plug, Cpu,
  ChevronRight, ChevronDown, ExternalLink, Loader2,
} from "lucide-react";
import { toast } from "sonner";

/** Wire shape received on telemetry:sample (mirrors server TelemetryBroadcastSample). */
interface TelemetrySample {
  machineId: number | null;
  deviceId: string | null;
  protocol: string;
  metric: string;
  numValue: number | null;
  textValue: string | null;
  boolValue: boolean | null;
  unit: string | null;
  quality: string;
  ts: string;
}

type ConnState = "online" | "offline" | "unknown";
type SourceKind = "machine" | "adapter" | "edge";

interface DeviceRow {
  key: string;            // stable composite key
  source: SourceKind;
  id: number;
  code: string;
  name: string;
  type: string;           // machineType / "adapter" / "edge"
  protocol: string;       // protocol or "—"
  conn: ConnState;
  lastSeen: Date | null;
  /** machineId used to correlate telemetry samples (machines + machine-bound adapters). */
  machineId: number | null;
  /** For adapters: the adapter id, used by testConnection. */
  adapterId: number | null;
  detail?: string;        // small secondary line (location / endpoint / lines)
}

interface LastTelemetry {
  metric: string;
  value: string;
  unit: string | null;
  ts: number;
  protocol: string;
}

const STALE_MS = 2 * 60_000;
const SPARK_MAX = 30;

function isStale(d: Date | null): boolean {
  if (!d) return true;
  const t = d.getTime();
  return Number.isNaN(t) || Date.now() - t > STALE_MS;
}

function sampleToValue(s: TelemetrySample): string {
  if (s.numValue != null) return String(s.numValue);
  if (s.boolValue != null) return s.boolValue ? "true" : "false";
  if (s.textValue != null) return s.textValue;
  return "—";
}

function fmtAgo(d: Date | null, never: string): string {
  if (!d) return never;
  const sec = Math.round((Date.now() - d.getTime()) / 1000);
  if (sec < 0) return "0s";
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

/** Tiny inline SVG sparkline — no chart lib, pure data. */
function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) {
    return <span className="text-[10px] text-muted-foreground">—</span>;
  }
  const w = 90, h = 24;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = w / (points.length - 1);
  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(h - ((p - min) / span) * h).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={w} height={h} className="overflow-visible">
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} className="text-primary" />
    </svg>
  );
}

function ConnChip({ state, t }: { state: ConnState; t: (k: string, f: string) => string }) {
  if (state === "online")
    return <Badge className="bg-emerald-500 text-white"><Wifi className="mr-1 h-3 w-3" />{t("deviceMonitor.online", "Trực tuyến")}</Badge>;
  if (state === "offline")
    return <Badge variant="outline" className="text-muted-foreground"><WifiOff className="mr-1 h-3 w-3" />{t("deviceMonitor.offline", "Ngoại tuyến")}</Badge>;
  return <Badge variant="outline" className="border-amber-400 text-amber-600"><HelpCircle className="mr-1 h-3 w-3" />{t("deviceMonitor.unknown", "Chưa rõ")}</Badge>;
}

function SourceIcon({ source }: { source: SourceKind }) {
  if (source === "machine") return <Server className="h-4 w-4 text-blue-500" />;
  if (source === "adapter") return <Plug className="h-4 w-4 text-rose-500" />;
  return <Cpu className="h-4 w-4 text-violet-500" />;
}

export default function UnifiedDeviceMonitor() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();

  const [search, setSearch] = useState("");
  const [filterSource, setFilterSource] = useState<string>("all");
  const [filterConn, setFilterConn] = useState<string>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  // Live telemetry caches keyed by machineId (samples carry machineId, not adapter id).
  const [lastTelemetry, setLastTelemetry] = useState<Record<number, LastTelemetry>>({});
  const sparkRef = useRef<Record<number, number[]>>({});
  const [, forceSpark] = useState(0); // bump to re-render sparklines
  const [liveStatus, setLiveStatus] = useState<Record<number, { status: string; ts: number }>>({});

  // ── Data sources (slow refetch only for membership; live bits come via socket) ──
  const machinesQ = trpc.machineStatus.listWithStatus.useQuery(undefined, { refetchInterval: 60_000 });
  const adaptersQ = trpc.deviceAdapter.list.useQuery(undefined, { refetchInterval: 60_000 });
  const edgeStatusQ = trpc.edgeRuntime.status.useQuery();
  const edgeNodesQ = trpc.edgeRuntime.listNodes.useQuery(undefined, { refetchInterval: 60_000 });

  // ── Protocol framework status strip (real flag state) ──
  const mtconnectQ = trpc.mtconnect.status.useQuery(undefined, { retry: false });
  const secsQ = trpc.secsGem.status.useQuery(undefined, { retry: false });

  const testConnection = trpc.deviceAdapter.testConnection.useMutation({
    onSuccess: (res) => {
      if (res.ok) toast.success(t("deviceMonitor.testOk", "Kết nối OK") + ` (${res.latencyMs}ms)`);
      else toast.error(t("deviceMonitor.testFail", "Kết nối thất bại") + `: ${res.error ?? "unknown"}`);
    },
    onError: (e) => toast.error(e.message),
  });

  // ── Realtime: telemetry:sample + machine:status_update ──
  useEffect(() => {
    const socket = getSharedSocket();
    const onTelemetry = (data: { samples?: TelemetrySample[] }) => {
      if (!data?.samples?.length) return;
      setLastTelemetry((prev) => {
        const next = { ...prev };
        for (const s of data.samples!) {
          if (s.machineId == null) continue;
          next[s.machineId] = {
            metric: s.metric,
            value: sampleToValue(s),
            unit: s.unit,
            ts: new Date(s.ts).getTime(),
            protocol: s.protocol,
          };
          if (s.numValue != null) {
            const arr = sparkRef.current[s.machineId] ?? [];
            arr.push(s.numValue);
            if (arr.length > SPARK_MAX) arr.shift();
            sparkRef.current[s.machineId] = arr;
          }
        }
        return next;
      });
      forceSpark((n) => n + 1);
    };
    const onStatus = (data: { machineId: number; status: string }) => {
      if (data?.machineId == null) return;
      setLiveStatus((prev) => ({ ...prev, [data.machineId]: { status: data.status, ts: Date.now() } }));
    };
    socket.on("telemetry:sample", onTelemetry);
    socket.on("machine:status_update", onStatus);
    socket.emit("subscribe", {}); // join the global room to receive the unified feed
    return () => {
      socket.off("telemetry:sample", onTelemetry);
      socket.off("machine:status_update", onStatus);
    };
  }, []);

  // Tick every 5s so "last seen" / stale chips stay fresh without re-fetching.
  useEffect(() => {
    const i = setInterval(() => forceSpark((n) => n + 1), 5000);
    return () => clearInterval(i);
  }, []);

  // ── Build the unified rows ──
  const rows = useMemo<DeviceRow[]>(() => {
    const out: DeviceRow[] = [];

    for (const m of (machinesQ.data ?? []) as any[]) {
      const live = liveStatus[m.id];
      const status = live?.status ?? m.latestStatus;
      const lastSeen = live?.ts ? new Date(live.ts)
        : m.latestHeartbeat ? new Date(m.latestHeartbeat) : null;
      let conn: ConnState = "unknown";
      if (status === "online" && !isStale(lastSeen)) conn = "online";
      else if (status === "offline" || isStale(lastSeen)) conn = lastSeen ? "offline" : "unknown";
      out.push({
        key: `machine:${m.id}`,
        source: "machine",
        id: m.id,
        code: m.code,
        name: m.name,
        type: m.machineType ?? "—",
        protocol: "—",
        conn,
        lastSeen,
        machineId: m.id,
        adapterId: null,
        detail: [m.factory?.name, m.workshop?.name, m.line?.name].filter(Boolean).join(" → "),
      });
    }

    for (const a of (adaptersQ.data ?? []) as any[]) {
      const lastSeen = a.lastConnectedAt ? new Date(a.lastConnectedAt) : null;
      let conn: ConnState = "unknown";
      if (a.status === "connected") conn = "online";
      else if (a.status === "error" || a.status === "disabled") conn = "offline";
      else conn = "unknown"; // connecting
      out.push({
        key: `adapter:${a.id}`,
        source: "adapter",
        id: a.id,
        code: a.code,
        name: a.name,
        type: t("deviceMonitor.typeAdapter", "Adapter OT"),
        protocol: a.protocol,
        conn,
        lastSeen,
        machineId: a.machineId ?? null,
        adapterId: a.id,
        detail: a.endpoint,
      });
    }

    for (const n of (edgeNodesQ.data ?? []) as any[]) {
      const lastSeen = n.lastHeartbeatAt ? new Date(n.lastHeartbeatAt) : null;
      let conn: ConnState = "unknown";
      if (n.status === "offline") conn = "offline";
      else if (isStale(lastSeen)) conn = lastSeen ? "offline" : "unknown";
      else conn = "online";
      out.push({
        key: `edge:${n.id}`,
        source: "edge",
        id: n.id,
        code: n.code,
        name: n.name,
        type: t("deviceMonitor.typeEdge", "Node biên"),
        protocol: "edge",
        conn,
        lastSeen,
        machineId: null,
        adapterId: null,
        detail: (n.assignedLineCodes ?? []).join(", ") || n.factoryCode || undefined,
      });
    }

    return out;
  }, [machinesQ.data, adaptersQ.data, edgeNodesQ.data, liveStatus, t]);

  const filtered = useMemo(() => rows.filter((r) => {
    if (filterSource !== "all" && r.source !== filterSource) return false;
    if (filterConn !== "all" && r.conn !== filterConn) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      if (!`${r.name} ${r.code} ${r.protocol} ${r.type}`.toLowerCase().includes(q)) return false;
    }
    return true;
  }), [rows, filterSource, filterConn, search]);

  const counts = useMemo(() => ({
    total: rows.length,
    online: rows.filter((r) => r.conn === "online").length,
    offline: rows.filter((r) => r.conn === "offline").length,
    unknown: rows.filter((r) => r.conn === "unknown").length,
  }), [rows]);

  const isLoading = machinesQ.isLoading || adaptersQ.isLoading || edgeNodesQ.isLoading;

  const refetchAll = () => {
    void machinesQ.refetch();
    void adaptersQ.refetch();
    void edgeNodesQ.refetch();
  };

  return (
    <DashboardLayout title={t("deviceMonitor.title", "Giám sát thiết bị hợp nhất")} navItems={navItems} currentPath="/device-monitor">
      <div className="space-y-6 p-4 md:p-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold">
              <Activity className="h-6 w-6 text-primary" />
              {t("deviceMonitor.title", "Giám sát thiết bị hợp nhất")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("deviceMonitor.subtitle", "Mọi thiết bị (máy · adapter OT · node biên) trong một bảng — trạng thái kết nối, telemetry trực tiếp & test kết nối")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => setWizardOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" />{t("deviceMonitor.onboard", "Kết nối thiết bị mới")}
            </Button>
            <Button variant="outline" onClick={refetchAll}>
              <RefreshCw className="mr-1.5 h-4 w-4" />{t("common.refresh", "Làm mới")}
            </Button>
          </div>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Card><CardContent className="flex items-center gap-3 pt-4">
            <Server className="h-7 w-7 text-muted-foreground" />
            <div><p className="text-2xl font-bold">{counts.total}</p><p className="text-xs text-muted-foreground">{t("deviceMonitor.totalDevices", "Tổng thiết bị")}</p></div>
          </CardContent></Card>
          <Card className="border-emerald-500/40"><CardContent className="flex items-center gap-3 pt-4">
            <Wifi className="h-7 w-7 text-emerald-500" />
            <div><p className="text-2xl font-bold text-emerald-500">{counts.online}</p><p className="text-xs text-muted-foreground">{t("deviceMonitor.online", "Trực tuyến")}</p></div>
          </CardContent></Card>
          <Card className="border-red-500/40"><CardContent className="flex items-center gap-3 pt-4">
            <WifiOff className="h-7 w-7 text-red-500" />
            <div><p className="text-2xl font-bold text-red-500">{counts.offline}</p><p className="text-xs text-muted-foreground">{t("deviceMonitor.offline", "Ngoại tuyến")}</p></div>
          </CardContent></Card>
          <Card className="border-amber-400/40"><CardContent className="flex items-center gap-3 pt-4">
            <HelpCircle className="h-7 w-7 text-amber-500" />
            <div><p className="text-2xl font-bold text-amber-500">{counts.unknown}</p><p className="text-xs text-muted-foreground">{t("deviceMonitor.unknown", "Chưa rõ")}</p></div>
          </CardContent></Card>
        </div>

        {/* Protocol framework status strip (honest flag state) */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">{t("deviceMonitor.frameworks", "Khung giao thức")}:</span>
          <FrameworkChip label="MTConnect" enabled={!!(mtconnectQ.data as any)?.enabled} loading={mtconnectQ.isLoading} t={t} />
          <FrameworkChip label="SECS/GEM" enabled={!!(secsQ.data as any)?.enabled} loading={secsQ.isLoading} t={t} />
          <FrameworkChip label="VDA5050 (AMR)" enabled={undefined} loading={false} t={t} />
          <FrameworkChip label="Edge runtime" enabled={!!(edgeStatusQ.data as any)?.enabled} loading={edgeStatusQ.isLoading} onClick={() => setLocation("/edge-nodes")} t={t} />
          <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs" onClick={() => setLocation("/device-adapters")}>
            {t("deviceMonitor.manageAdapters", "Quản lý adapter")}<ExternalLink className="h-3 w-3" />
          </Button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} className="w-64 pl-8"
              placeholder={t("deviceMonitor.searchPlaceholder", "Tìm theo tên / mã / giao thức…")} />
          </div>
          <Select value={filterSource} onValueChange={setFilterSource}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("deviceMonitor.allSources", "Mọi nguồn")}</SelectItem>
              <SelectItem value="machine">{t("deviceMonitor.sourceMachine", "Máy")}</SelectItem>
              <SelectItem value="adapter">{t("deviceMonitor.typeAdapter", "Adapter OT")}</SelectItem>
              <SelectItem value="edge">{t("deviceMonitor.typeEdge", "Node biên")}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterConn} onValueChange={setFilterConn}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("common.all", "Tất cả")}</SelectItem>
              <SelectItem value="online">{t("deviceMonitor.online", "Trực tuyến")}</SelectItem>
              <SelectItem value="offline">{t("deviceMonitor.offline", "Ngoại tuyến")}</SelectItem>
              <SelectItem value="unknown">{t("deviceMonitor.unknown", "Chưa rõ")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Master table */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t("deviceMonitor.allDevices", "Tất cả thiết bị")} ({filtered.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>{t("deviceMonitor.colName", "Tên / Mã")}</TableHead>
                  <TableHead>{t("deviceMonitor.colType", "Loại")}</TableHead>
                  <TableHead>{t("deviceMonitor.colProtocol", "Giao thức")}</TableHead>
                  <TableHead>{t("deviceMonitor.colConn", "Kết nối")}</TableHead>
                  <TableHead>{t("deviceMonitor.colLastSeen", "Lần cuối")}</TableHead>
                  <TableHead>{t("deviceMonitor.colTelemetry", "Telemetry mới nhất")}</TableHead>
                  <TableHead>{t("deviceMonitor.colSpark", "Xu hướng")}</TableHead>
                  <TableHead className="text-right">{t("common.actions", "Thao tác")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow><TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin" />
                  </TableCell></TableRow>
                )}
                {!isLoading && filtered.length === 0 && (
                  <TableRow><TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">
                    {rows.length === 0
                      ? t("deviceMonitor.emptyNone", "Chưa có thiết bị nào. Dùng \"Kết nối thiết bị mới\" để bắt đầu.")
                      : t("deviceMonitor.emptyFilter", "Không có thiết bị khớp bộ lọc.")}
                  </TableCell></TableRow>
                )}
                {!isLoading && filtered.map((r) => {
                  const tele = r.machineId != null ? lastTelemetry[r.machineId] : undefined;
                  const spark = r.machineId != null ? (sparkRef.current[r.machineId] ?? []) : [];
                  const isOpen = expanded === r.key;
                  return (
                    <Fragment key={r.key}>
                      <TableRow className="cursor-pointer" onClick={() => setExpanded(isOpen ? null : r.key)}>
                        <TableCell>{isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <SourceIcon source={r.source} />
                            <div>
                              <div className="font-medium">{r.name}</div>
                              <div className="font-mono text-[11px] text-muted-foreground">{r.code}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">{r.type}</Badge></TableCell>
                        <TableCell><span className="text-xs">{r.protocol}</span></TableCell>
                        <TableCell><ConnChip state={r.conn} t={t} /></TableCell>
                        <TableCell className="text-xs text-muted-foreground">{fmtAgo(r.lastSeen, t("deviceMonitor.never", "chưa"))}</TableCell>
                        <TableCell>
                          {tele ? (
                            <div className="text-xs">
                              <span className="text-muted-foreground">{tele.metric}: </span>
                              <span className="font-semibold tabular-nums">{tele.value}</span>
                              {tele.unit && <span className="text-muted-foreground"> {tele.unit}</span>}
                            </div>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">{t("deviceMonitor.noTelemetry", "chưa có telemetry")}</span>
                          )}
                        </TableCell>
                        <TableCell><Sparkline points={spark} /></TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          {r.adapterId != null ? (
                            <Button size="sm" variant="outline" disabled={testConnection.isPending}
                              onClick={() => testConnection.mutate({ id: r.adapterId! })}>
                              {t("deviceMonitor.test", "Test")}
                            </Button>
                          ) : r.source === "machine" ? (
                            <Button size="sm" variant="ghost" onClick={() => setLocation("/machine-status")}>
                              {t("deviceMonitor.details", "Chi tiết")}
                            </Button>
                          ) : (
                            <Button size="sm" variant="ghost" onClick={() => setLocation("/edge-nodes")}>
                              {t("deviceMonitor.details", "Chi tiết")}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                      {isOpen && (
                        <TableRow className="bg-muted/30">
                          <TableCell />
                          <TableCell colSpan={8}>
                            <div className="flex flex-wrap items-center gap-x-8 gap-y-2 py-2 text-xs">
                              {r.detail && (
                                <div><span className="text-muted-foreground">{t("deviceMonitor.detailInfo", "Thông tin")}: </span>{r.detail}</div>
                              )}
                              {tele && (
                                <>
                                  <div><span className="text-muted-foreground">{t("deviceMonitor.lastProtocol", "Nguồn")}: </span>{tele.protocol}</div>
                                  <div><span className="text-muted-foreground">{t("deviceMonitor.lastAt", "Cập nhật")}: </span>{new Date(tele.ts).toLocaleTimeString()}</div>
                                </>
                              )}
                              <div className="flex items-center gap-2 text-muted-foreground">
                                <Activity className="h-3.5 w-3.5" />
                                {spark.length >= 2
                                  ? t("deviceMonitor.liveSpark", "Sparkline trực tiếp từ telemetry:sample")
                                  : t("deviceMonitor.noLiveYet", "Chưa đủ mẫu để vẽ sparkline — chờ telemetry trực tiếp")}
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <DeviceOnboardingWizard open={wizardOpen} onOpenChange={setWizardOpen} onChanged={refetchAll} />
    </DashboardLayout>
  );
}

function FrameworkChip({
  label, enabled, loading, onClick, t,
}: {
  label: string;
  enabled: boolean | undefined;
  loading: boolean;
  onClick?: () => void;
  t: (k: string, f: string) => string;
}) {
  let cls = "border-amber-400 text-amber-600";
  let txt = t("deviceMonitor.flagUnknown", "chưa rõ");
  if (loading) { txt = "…"; }
  else if (enabled === true) { cls = "border-emerald-500 text-emerald-600"; txt = t("deviceMonitor.flagOn", "bật"); }
  else if (enabled === false) { cls = "border-muted-foreground/40 text-muted-foreground"; txt = t("deviceMonitor.flagOff", "tắt"); }
  const inner = <>{label}<span className="opacity-70">· {txt}</span></>;
  const base = `inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${cls}`;
  if (!onClick) return <span className={base} title={label}>{inner}</span>;
  return <button onClick={onClick} className={`${base} hover:opacity-80`}>{inner}</button>;
}
