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
// doc 64 IA-10 S2 — trục phạm vi ISA-95.
import { useScope } from "@/components/patterns/ScopeFilterBar";
import { useScopeWired } from "@/contexts/AssetScopeContext";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { getSharedSocket } from "@/lib/socketManager";
import DashboardLayout from "@/components/DashboardLayout";
import { navItems } from "@/lib/navigation";
import DeviceOnboardingWizard from "@/components/DeviceOnboardingWizard";
import {
  PageHeader, PageContainer, StatChip, StatChipRow,
  useDensity,
} from "@/components/patterns";
import { useFullscreen } from "@/hooks/useFullscreen";
import {
  useMachineTypes, DEVICE_CLASS_ORDER, isDeviceClassUiEnabled, type DeviceClass,
} from "@/hooks/useMachineTypes";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Wifi, WifiOff, HelpCircle, RefreshCw, Search, Plus, Activity, Server, Plug, Cpu,
  ChevronRight, ChevronDown, ExternalLink, Loader2, Maximize2, Minimize2, Rows3, Unplug,
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
  /** doc 56 Đ2b — deviceClass of a machine row (aoi_avi/automation/iot) for the class
   *  filter; null for adapters/edge nodes (not part of the machine-type taxonomy). */
  deviceClass?: DeviceClass | null;
  detail?: string;        // small secondary line (location / endpoint / lines)
}

interface LastTelemetry {
  metric: string;
  value: string;
  unit: string | null;
  ts: number;
  protocol: string;
}

/** doc 56 Đ2b — a device sending telemetry that has no machineId yet (not onboarded /
 *  approved). Kept in its own cache keyed by deviceId so its telemetry is NOT dropped. */
interface UnmappedDevice {
  deviceId: string;
  protocol: string;
  metric: string;
  value: string;
  unit: string | null;
  ts: number;
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
    return <Badge className="bg-success text-white"><Wifi className="mr-1 h-3 w-3" />{t("deviceMonitor.online", "Trực tuyến")}</Badge>;
  if (state === "offline")
    return <Badge variant="outline" className="text-muted-foreground"><WifiOff className="mr-1 h-3 w-3" />{t("deviceMonitor.offline", "Ngoại tuyến")}</Badge>;
  return <Badge variant="outline" className="border-warning text-warning"><HelpCircle className="mr-1 h-3 w-3" />{t("deviceMonitor.unknown", "Chưa rõ")}</Badge>;
}

function SourceIcon({ source }: { source: SourceKind }) {
  if (source === "machine") return <Server className="h-4 w-4 text-blue-500" />;
  if (source === "adapter") return <Plug className="h-4 w-4 text-rose-500" />;
  return <Cpu className="h-4 w-4 text-violet-500" />;
}

export function UnifiedDeviceMonitorContent() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();

  // doc 40 §13.3 content-first — mật độ hiển thị + fullscreen cho bảng fleet.
  const { density, toggle: toggleDensity } = useDensity();
  const fs = useFullscreen();

  const [search, setSearch] = useState("");
  const [filterSource, setFilterSource] = useState<string>("all");
  const [filterConn, setFilterConn] = useState<string>("all");
  // doc 56 Đ2b — deviceClass facet (all | aoi_avi | automation | iot).
  const [filterClass, setFilterClass] = useState<"all" | DeviceClass>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  // Live telemetry caches keyed by machineId (samples carry machineId, not adapter id).
  const [lastTelemetry, setLastTelemetry] = useState<Record<number, LastTelemetry>>({});
  const sparkRef = useRef<Record<number, number[]>>({});
  const [, forceSpark] = useState(0); // bump to re-render sparklines
  const [liveStatus, setLiveStatus] = useState<Record<number, { status: string; ts: number }>>({});

  // doc 56 Đ2b — telemetry from devices with NO machineId is no longer dropped; it's
  // gathered here (keyed by deviceId) to feed the "unmapped devices" panel.
  const [unmappedDevices, setUnmappedDevices] = useState<Record<string, UnmappedDevice>>({});

  // doc 54 cosmetic — the OT adapter + edge-runtime queries require machine_control;
  // gate them so a machine_monitoring-only role (e.g. operator) doesn't fire a query it
  // can't read → no 403 console noise. The machines/health data (machine_monitoring)
  // still loads for everyone.
  const { hasPermission } = usePermissions();
  const canReadControl = hasPermission("machine_control", "canView");

  // doc 56 Đ2b — machineType → deviceClass lookup (server taxonomy via useMachineTypes,
  // static fallback while loading). Powers the deviceClass filter so IoT machines (IoT
  // sensor/gateway rows after Đ2a) land in the `iot` group. The flag gates only the
  // filter UI — default OFF keeps the flat list byte-identical.
  const { byClass } = useMachineTypes();
  const classByType = useMemo(() => {
    const m = new Map<string, DeviceClass>();
    for (const cls of DEVICE_CLASS_ORDER) for (const e of byClass[cls]) m.set(e.type, cls);
    return m;
  }, [byClass]);
  const deviceClassUi = isDeviceClassUiEnabled();

  // doc 64 IA-10 S2 — trục phạm vi ISA-95: fleet lọc server-side theo Xưởng/Chuyền/Máy.
  const { scope: assetScope } = useScope(["factory", "line", "machine"]);
  useScopeWired();
  // ── Data sources (slow refetch only for membership; live bits come via socket) ──
  const machinesQ = trpc.machineStatus.listWithStatus.useQuery(
    {
      factoryId: assetScope.factoryId,
      lineId: assetScope.lineId,
      machineId: assetScope.machineId,
    },
    { refetchInterval: 60_000 },
  );
  const adaptersQ = trpc.deviceAdapter.list.useQuery(undefined, { refetchInterval: 60_000, enabled: canReadControl });
  const edgeStatusQ = trpc.edgeRuntime.status.useQuery(undefined, { enabled: canReadControl });
  const edgeNodesQ = trpc.edgeRuntime.listNodes.useQuery(undefined, { refetchInterval: 60_000, enabled: canReadControl });

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
      // doc 56 Đ2b — samples with no machineId used to be dropped here. Instead we
      // collect the ones that carry a deviceId into the unmapped batch (applied to its
      // own cache below) so their telemetry surfaces in the "unmapped devices" panel.
      const unmapped: TelemetrySample[] = [];
      setLastTelemetry((prev) => {
        const next = { ...prev };
        for (const s of data.samples!) {
          if (s.machineId == null) {
            if (s.deviceId != null) unmapped.push(s);
            continue;
          }
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
      if (unmapped.length) {
        setUnmappedDevices((prev) => {
          const next = { ...prev };
          for (const s of unmapped) {
            const id = s.deviceId!;
            next[id] = {
              deviceId: id,
              protocol: s.protocol,
              metric: s.metric,
              value: sampleToValue(s),
              unit: s.unit,
              ts: new Date(s.ts).getTime(),
            };
          }
          return next;
        });
      }
      forceSpark((n) => n + 1);
    };
    const onStatus = (data: { machineId: number; status: string }) => {
      // doc 56 Đ2b — status_update carries only {machineId,status} (no deviceId/metric),
      // so a null machineId cannot form an unmapped-device row; keep the mapped-only guard.
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
        deviceClass: classByType.get(m.machineType) ?? null,
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
        deviceClass: null,
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
        deviceClass: null,
        detail: (n.assignedLineCodes ?? []).join(", ") || n.factoryCode || undefined,
      });
    }

    return out;
  }, [machinesQ.data, adaptersQ.data, edgeNodesQ.data, liveStatus, t, classByType]);

  const filtered = useMemo(() => rows.filter((r) => {
    if (filterSource !== "all" && r.source !== filterSource) return false;
    if (filterConn !== "all" && r.conn !== filterConn) return false;
    // doc 56 Đ2b — deviceClass facet only narrows machine rows (adapters/edge = null).
    if (filterClass !== "all" && r.deviceClass !== filterClass) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      if (!`${r.name} ${r.code} ${r.protocol} ${r.type}`.toLowerCase().includes(q)) return false;
    }
    return true;
  }), [rows, filterSource, filterConn, filterClass, search]);

  const counts = useMemo(() => ({
    total: rows.length,
    online: rows.filter((r) => r.conn === "online").length,
    offline: rows.filter((r) => r.conn === "offline").length,
    unknown: rows.filter((r) => r.conn === "unknown").length,
  }), [rows]);

  // doc 56 Đ2b — unmapped devices (latest telemetry first) for the attention panel.
  const unmappedList = useMemo(
    () => Object.values(unmappedDevices).sort((a, b) => b.ts - a.ts),
    [unmappedDevices],
  );

  const classFilterLabel = (c: "all" | DeviceClass): string =>
    c === "all" ? t("deviceMonitor.classAll", "Tất cả")
    : c === "aoi_avi" ? t("deviceMonitor.classAoiAvi", "AVI/AOI")
    : c === "automation" ? t("deviceMonitor.classAutomation", "Tự động hóa")
    : t("deviceMonitor.classIot", "IoT");

  const isLoading = machinesQ.isLoading || adaptersQ.isLoading || edgeNodesQ.isLoading;

  const refetchAll = () => {
    void machinesQ.refetch();
    void adaptersQ.refetch();
    void edgeNodesQ.refetch();
  };

  return (
    <>
      <PageContainer
        fluid
        className="flex min-h-[calc(100vh-8rem)] flex-col gap-3 py-3 md:py-4 [&>*]:!mt-0"
      >
        {/* Header — gọn 1 hàng (content-first) */}
        <PageHeader
          className="shrink-0"
          icon={<Activity className="h-5 w-5 text-primary" />}
          title={t("deviceMonitor.title", "Giám sát thiết bị hợp nhất")}
          actions={
            <>
              <Button size="sm" onClick={() => setWizardOpen(true)}>
                <Plus className="mr-1.5 h-4 w-4" />{t("deviceMonitor.onboard", "Kết nối thiết bị mới")}
              </Button>
              <Button size="sm" variant="outline" onClick={refetchAll}>
                <RefreshCw className="mr-1.5 h-4 w-4" />{t("common.refresh", "Làm mới")}
              </Button>
            </>
          }
        />

        {/* KPI strip — StatChip 1 dòng (thay lưới MetricCard 110px). Bấm để lọc theo kết nối. */}
        <StatChipRow className="shrink-0">
          <StatChip
            icon={<Server />}
            label={t("deviceMonitor.totalDevices", "Tổng")}
            value={counts.total}
            onClick={() => setFilterConn("all")}
            active={filterConn === "all"}
          />
          <StatChip
            label={t("deviceMonitor.online", "Trực tuyến")}
            value={counts.online}
            tone="success"
            onClick={() => setFilterConn(filterConn === "online" ? "all" : "online")}
            active={filterConn === "online"}
          />
          <StatChip
            label={t("deviceMonitor.offline", "Ngoại tuyến")}
            value={counts.offline}
            tone="error"
            onClick={() => setFilterConn(filterConn === "offline" ? "all" : "offline")}
            active={filterConn === "offline"}
          />
          <StatChip
            label={t("deviceMonitor.unknown", "Chưa rõ")}
            value={counts.unknown}
            tone="warning"
            onClick={() => setFilterConn(filterConn === "unknown" ? "all" : "unknown")}
            active={filterConn === "unknown"}
          />
          <span className="mx-0.5 h-4 w-px shrink-0 bg-border" aria-hidden="true" />
          {/* Khung giao thức — trạng thái cờ thật, cùng hàng để tiết kiệm chiều dọc */}
          <FrameworkChip label="MTConnect" enabled={!!(mtconnectQ.data as any)?.enabled} loading={mtconnectQ.isLoading} t={t} />
          <FrameworkChip label="SECS/GEM" enabled={!!(secsQ.data as any)?.enabled} loading={secsQ.isLoading} t={t} />
          {/* DEV-09 — chip VDA5050 gỡ bỏ: không có endpoint framework-status toàn cục
              (vda5050.status yêu cầu robotId, chỉ per-robot). Không hiện "chưa rõ" vĩnh viễn
              để giữ đúng cam kết honesty. Trạng thái VDA5050 xem tại từng robot (Fleet/Robot). */}
          <FrameworkChip label="Edge runtime" enabled={!!(edgeStatusQ.data as any)?.enabled} loading={edgeStatusQ.isLoading} onClick={() => setLocation("/edge-nodes")} t={t} />
        </StatChipRow>

        {/* doc 56 Đ2b — "Thiết bị chưa map": devices sending telemetry that aren't bound
            to any machine yet. Self-hiding when empty (byte-identical default). Each row
            offers a "register this device" shortcut into the onboarding wizard. */}
        {unmappedList.length > 0 && (
          <Card className="shrink-0 border-warning/40">
            <CardHeader className="flex flex-row flex-wrap items-center gap-x-2 gap-y-1 space-y-0 py-2">
              <Unplug className="h-4 w-4 shrink-0 text-warning" />
              <CardTitle className="text-sm">
                {t("deviceMonitor.unmapped.title", "Thiết bị chưa map")}{" "}
                <span className="tabular-nums text-muted-foreground">({unmappedList.length})</span>
              </CardTitle>
              <span className="text-xs text-muted-foreground">
                {t("deviceMonitor.unmapped.hint", "Đang gửi telemetry nhưng chưa gắn với máy nào — đăng ký để theo dõi đầy đủ.")}
              </span>
            </CardHeader>
            <CardContent className="max-h-44 overflow-auto p-0 [&>[data-slot=table-container]]:overflow-visible">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead>{t("deviceMonitor.unmapped.colDevice", "Mã thiết bị")}</TableHead>
                    <TableHead>{t("deviceMonitor.colProtocol", "Giao thức")}</TableHead>
                    <TableHead>{t("deviceMonitor.colLastSeen", "Lần cuối")}</TableHead>
                    <TableHead>{t("deviceMonitor.colTelemetry", "Telemetry mới nhất")}</TableHead>
                    <TableHead className="text-right">{t("common.actions", "Thao tác")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {unmappedList.map((u) => (
                    <TableRow key={u.deviceId}>
                      <TableCell className="font-mono text-xs">{u.deviceId}</TableCell>
                      <TableCell className="text-xs">{u.protocol}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtAgo(new Date(u.ts), t("deviceMonitor.never", "chưa"))}
                      </TableCell>
                      <TableCell className="text-xs">
                        <span className="text-muted-foreground">{u.metric}: </span>
                        <span className="font-semibold tabular-nums">{u.value}</span>
                        {u.unit && <span className="text-muted-foreground"> {u.unit}</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          title={t("deviceMonitor.unmapped.registerHint", "Đăng ký thiết bị này") + ` (${u.deviceId})`}
                          onClick={() => setWizardOpen(true)}
                        >
                          <Plus className="mr-1 h-3.5 w-3.5" />
                          {t("deviceMonitor.unmapped.register", "Đăng ký")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Master table — chiếm ≥70% chiều cao (flex-1), cuộn nội bộ, sticky header */}
        <Card
          ref={fs.ref}
          className={cn(
            "flex min-h-0 flex-1 flex-col gap-2 py-3",
            fs.usingFallback && fs.isFullscreen && "fixed inset-0 z-50 rounded-none",
            fs.isFullscreen && "bg-background",
          )}
        >
          <CardHeader className="shrink-0 gap-2 pb-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="mr-auto text-base">
                {t("deviceMonitor.allDevices", "Tất cả thiết bị")}{" "}
                <span className="tabular-nums text-muted-foreground">({filtered.length})</span>
              </CardTitle>
              {/* Bộ lọc trong header bảng — gọn cùng hàng với tiêu đề */}
              <div className="relative">
                <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 w-52 pl-8"
                  placeholder={t("deviceMonitor.searchPlaceholder", "Tìm tên / mã / giao thức…")} />
              </div>
              <Select value={filterSource} onValueChange={setFilterSource}>
                <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("deviceMonitor.allSources", "Mọi nguồn")}</SelectItem>
                  <SelectItem value="machine">{t("deviceMonitor.sourceMachine", "Máy")}</SelectItem>
                  <SelectItem value="adapter">{t("deviceMonitor.typeAdapter", "Adapter OT")}</SelectItem>
                  <SelectItem value="edge">{t("deviceMonitor.typeEdge", "Node biên")}</SelectItem>
                </SelectContent>
              </Select>
              {/* doc 56 Đ2b — deviceClass facet (segmented control). Gated by the
                  DEVICE_CLASS_UI flag; OFF (default) hides it and keeps filterClass="all". */}
              {deviceClassUi && (
                <div
                  className="inline-flex h-8 items-center gap-0.5 rounded-md border p-0.5"
                  role="group"
                  aria-label={t("deviceMonitor.classFilterLabel", "Lọc theo nhóm thiết bị")}
                >
                  {(["all", ...DEVICE_CLASS_ORDER] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setFilterClass(c)}
                      aria-pressed={filterClass === c}
                      className={cn(
                        "h-7 whitespace-nowrap rounded px-2 text-xs transition-colors",
                        filterClass === c
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-accent",
                      )}
                    >
                      {classFilterLabel(c)}
                    </button>
                  ))}
                </div>
              )}
              <Button
                variant="outline" size="icon-sm" onClick={toggleDensity}
                title={density === "compact"
                  ? t("common.densityComfortable", "Mật độ thoải mái")
                  : t("common.densityCompact", "Mật độ gọn")}
                aria-pressed={density === "compact"}
              >
                <Rows3 className="h-4 w-4" />
              </Button>
              <Button
                variant="outline" size="icon-sm" onClick={fs.toggle}
                title={fs.isFullscreen
                  ? t("common.exitFullscreen", "Thoát toàn màn hình")
                  : t("common.fullscreen", "Toàn màn hình")}
                aria-pressed={fs.isFullscreen}
              >
                {fs.isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </Button>
              <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs" onClick={() => setLocation("/device-adapters")}>
                {t("deviceMonitor.manageAdapters", "Quản lý adapter")}<ExternalLink className="h-3 w-3" />
              </Button>
            </div>
          </CardHeader>
          {/* CardContent là khối cao cố định (flex-1); bộ cuộn thật là
              [data-slot=table-container] bên trong Table → sticky header hoạt động. */}
          <CardContent className="min-h-0 flex-1 p-0 [&>[data-slot=table-container]]:h-full [&>[data-slot=table-container]]:overflow-auto">
            <Table
              className={cn(
                // Mật độ gọn: giảm padding ô + cỡ chữ để hiện nhiều hàng hơn.
                density === "compact" &&
                  "text-xs [&_td]:px-2 [&_td]:py-1 [&_th]:px-2 [&_th]:py-1.5",
              )}
            >
              <TableHeader className="sticky top-0 z-10 bg-card">
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
                            <Button size="sm" variant="ghost" onClick={() => setLocation(`/machine/${r.id}`)}>
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
      </PageContainer>

      <DeviceOnboardingWizard open={wizardOpen} onOpenChange={setWizardOpen} onChanged={refetchAll} />
    </>
  );
}

export default function UnifiedDeviceMonitor() {
  const { t } = useTranslation();
  return (
    <DashboardLayout title={t("deviceMonitor.title", "Giám sát thiết bị hợp nhất")} navItems={navItems} currentPath="/device-monitor">
      <UnifiedDeviceMonitorContent />
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
  let cls = "border-warning text-warning";
  let txt = t("deviceMonitor.flagUnknown", "chưa rõ");
  if (loading) { txt = "…"; }
  else if (enabled === true) { cls = "border-success text-success"; txt = t("deviceMonitor.flagOn", "bật"); }
  else if (enabled === false) { cls = "border-muted-foreground/40 text-muted-foreground"; txt = t("deviceMonitor.flagOff", "tắt"); }
  const inner = <>{label}<span className="opacity-70">· {txt}</span></>;
  const base = `inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs ${cls}`;
  if (!onClick) return <span className={base} title={label}>{inner}</span>;
  return <button onClick={onClick} className={`${base} hover:opacity-80`}>{inner}</button>;
}
