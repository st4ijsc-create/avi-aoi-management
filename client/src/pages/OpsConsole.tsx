/**
 * P1 (audit H / doc 12 §8) — Ops Console / War-Room.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ONE unified alert/Andon surface that consolidates the 5 previously-fragmented
 * surfaces:
 *   1. Andon Board            (andon.*)          — manual + system-raised signals
 *   2. Alerts (yield/ng/...)  (alert.*)          — threshold alert settings + history
 *   3. Predictive Alerts      (predictiveAlert.*) — AI predictions
 *   4. MQTT Alert Rules       (mqttAlert.*)       — broker/transport health alerts
 *   5. Interlock events       (interlock.*)       — interlock rule firings
 *
 * Two modes (tabs):
 *   • War Room   — TV/full-screen, grouped by line/station, big colour tiles,
 *                  sound + flash on RED, ack-aging timer, realtime via the
 *                  existing `andon:event` socket (no polling for Andon).
 *   • Alert Center — every source normalised into ONE table with severity / ack
 *                  / source filter + unified ack action.
 *
 * SAFETY: alert-only. NOTHING here writes a command to a machine. Andon ack/resolve
 * and interlock event resolve go through their existing read-mostly routers. The
 * backend (alert evaluator scheduler, Andon→notify, persisted state) was activated
 * in P0-E; this page is the UI that consumes it. All data is real — no mocks.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { getSharedSocket } from "@/lib/socketManager";
import DashboardLayout from "@/components/DashboardLayout";
import { navItems } from "@/lib/navigation";
import { PageHeader } from "@/components/patterns";
import PollFreshness from "@/components/PollFreshness";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Activity, AlertTriangle, Bell, CheckCircle2, Maximize2, Minimize2,
  Volume2, VolumeX, ShieldAlert, Cpu, Wifi, TrendingDown, RefreshCw, Search,
} from "lucide-react";
import { toast } from "sonner";

// ─────────────────────────────────────────────────────────────────────────────
// Normalised alert model — every source maps onto this shape.
// ─────────────────────────────────────────────────────────────────────────────
type Severity = "critical" | "high" | "medium" | "low";
type AlertSource = "andon" | "predictive" | "interlock" | "mqtt" | "threshold";

interface NormalAlert {
  key: string;            // unique across sources: `${source}:${id}`
  source: AlertSource;
  id: number;
  title: string;
  message: string;
  severity: Severity;
  acknowledged: boolean;
  resolved: boolean;
  raisedAt: Date;
  group: string;          // line / station / machine label for grouping
  raisedBySystem?: boolean;
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

const SEVERITY_TILE: Record<Severity, string> = {
  critical: "bg-destructive text-white border-destructive",
  high: "bg-warning text-white border-warning",
  medium: "bg-warning/70 text-black border-warning",
  low: "bg-info text-white border-info",
};

const SEVERITY_DOT: Record<Severity, string> = {
  critical: "bg-destructive",
  high: "bg-warning",
  medium: "bg-warning/70",
  low: "bg-info",
};

const SOURCE_ICON: Record<AlertSource, React.ReactNode> = {
  andon: <Bell className="h-4 w-4" />,
  predictive: <TrendingDown className="h-4 w-4" />,
  interlock: <ShieldAlert className="h-4 w-4" />,
  mqtt: <Wifi className="h-4 w-4" />,
  threshold: <Cpu className="h-4 w-4" />,
};

/** andon state → severity. red=critical, yellow=medium, call=high, green=low. */
function andonStateToSeverity(state: string): Severity {
  if (state === "red") return "critical";
  if (state === "call") return "high";
  if (state === "yellow") return "medium";
  return "low";
}

function predictiveSeverity(s: string): Severity {
  switch (s) {
    case "CRITICAL": return "critical";
    case "HIGH": return "high";
    case "MEDIUM": return "medium";
    default: return "low";
  }
}

/** interlock action → severity. stop_line=critical, block=high, reduce=medium, alert=low. */
function interlockSeverity(action?: string | null): Severity {
  if (action === "stop_line") return "critical";
  if (action === "block_downstream") return "high";
  if (action === "reduce_speed") return "medium";
  return "low";
}

/**
 * MQTT severity thật từ bản ghi thay vì hardcode "high" (W1).
 * ĐÃ XÁC MINH: mqttAlert.unresolved đọc bảng mqtt_alert_history (server/db/mqtt.ts
 * getUnresolvedMqttAlerts) — bảng này KHÔNG có cột severity trong schema
 * (drizzle/schema/mqtt.ts:192-219). Severity critical/warning mà
 * server/mqttAlertScheduler.ts:115,174,238,306 ghi ra nằm ở bảng KHÁC
 * (mqtt_connection_alerts) chưa được console này đọc. Vì vậy: đọc phòng thủ
 * `severity` nếu server bổ sung sau này — critical→critical; warning→medium
 * (2 mức server ánh xạ vào thang 4 mức của console: warning < critical nên
 * xếp medium); thiếu/không rõ → fallback "high" (giữ hành vi cũ, không hạ cấp
 * cảnh báo hạ tầng khi chưa biết mức thật).
 */
function mqttSeverity(s?: string | null): Severity {
  if (s === "critical") return "critical";
  if (s === "warning") return "medium";
  return "high";
}

/**
 * Threshold severity (W1). ĐÃ XÁC MINH: alert.history đọc bảng alert_history và
 * bảng cha alert_settings — cả hai đều KHÔNG có cột severity
 * (drizzle/schema/alerts.ts:5-50). Đọc phòng thủ nếu record có, fallback "medium".
 */
function thresholdSeverity(s?: string | null): Severity {
  if (s === "critical" || s === "high" || s === "medium" || s === "low") return s;
  return "medium";
}

/**
 * Khả năng hành động theo nguồn — nhãn nút phải nói đúng hành vi mutation (W1):
 *  - interlock/mqtt: server CHỈ có resolve (đóng vĩnh viễn), không có ack riêng
 *    → một nút "Xử lý xong" duy nhất, bọc xác nhận.
 *  - predictive/threshold: console này CHỈ nối mutation acknowledge
 *    (/predictive-alerts redirect về /ops-console — không còn trang riêng)
 *    → một nút "Xác nhận" duy nhất, không hiện nút resolve giả.
 *  - andon: có đủ cả ack lẫn resolve.
 */
const isResolveOnly = (s: AlertSource) => s === "interlock" || s === "mqtt";
const isAckOnly = (s: AlertSource) => s === "predictive" || s === "threshold";

function ageLabel(from: Date, now: number): string {
  const sec = Math.max(0, Math.floor((now - from.getTime()) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

export default function OpsConsole() {
  const { t } = useTranslation();
  const utils = trpc.useUtils();

  // ── data sources ──────────────────────────────────────────────────────────
  // Andon is realtime (socket) → long refetch as a safety net only.
  const andonQuery = trpc.andon.active.useQuery(undefined, { refetchInterval: 60_000 });
  const andonMetrics = trpc.andon.metrics.useQuery({ sinceHours: 24 });
  // The other sources have no socket → modest polling.
  const predictiveQuery = trpc.predictiveAlert.list.useQuery(
    { status: "ACTIVE", limit: 100 },
    { refetchInterval: 30_000 },
  );
  const interlockEvents = trpc.interlock.events.useQuery({ limit: 100 }, { refetchInterval: 30_000 });
  const mqttUnresolved = trpc.mqttAlert.unresolved.useQuery(undefined, { refetchInterval: 30_000 });
  const thresholdHistory = trpc.alert.history.useQuery({ limit: 50 }, { refetchInterval: 30_000 });

  // ── mutations (unified ack/resolve) ─────────────────────────────────────────
  const ackAndon = trpc.andon.acknowledge.useMutation({
    onSuccess: () => { void utils.andon.active.invalidate(); void utils.andon.metrics.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const resolveAndon = trpc.andon.resolve.useMutation({
    onSuccess: () => { void utils.andon.active.invalidate(); void utils.andon.metrics.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const ackPredictive = trpc.predictiveAlert.acknowledge.useMutation({
    onSuccess: () => { void utils.predictiveAlert.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const resolveInterlock = trpc.interlock.resolveEvent.useMutation({
    onSuccess: () => { void utils.interlock.events.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const resolveMqtt = trpc.mqttAlert.resolve.useMutation({
    onSuccess: () => { void utils.mqttAlert.unresolved.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const ackThreshold = trpc.alert.acknowledge.useMutation({
    onSuccess: () => { void utils.alert.history.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  // ── realtime: refresh Andon (+ flash/sound) on any andon:event ──────────────
  const [flash, setFlash] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const soundOnRef = useRef(soundOn);
  soundOnRef.current = soundOn;

  const beep = useCallback(() => {
    if (!soundOnRef.current) return;
    try {
      const AC = (window.AudioContext || (window as any).webkitAudioContext);
      if (!AC) return;
      const ctx = new AC();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = 880;
      gain.gain.value = 0.06;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.25);
      osc.onended = () => void ctx.close();
    } catch { /* audio not available — silent */ }
  }, []);

  useEffect(() => {
    const socket = getSharedSocket();
    const handler = (ev: { state?: string; event?: string }) => {
      void utils.andon.active.invalidate();
      void utils.andon.metrics.invalidate();
      // Flash + beep only on a NEW red signal — avoid noise on ack/resolve echoes.
      if (ev?.event === "raised" && ev?.state === "red") {
        setFlash(true);
        beep();
        window.setTimeout(() => setFlash(false), 4000);
      }
    };
    socket.on("andon:event", handler);
    socket.emit("subscribe", {});
    return () => { socket.off("andon:event", handler); };
  }, [utils, beep]);

  // ── ticking clock for ack-aging timers ──────────────────────────────────────
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const i = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(i);
  }, []);

  // ── W2 (AUD-01): freshness trung thực cho console poll ──────────────────────
  // 4/5 nguồn poll 30s (andon 60s safety-net) nhưng nhãn "Tuổi" tự tăng theo
  // đồng hồ client — mất mạng thì danh sách ĐỨNG IM mà tuổi vẫn chạy, càng
  // giống thật. Lấy MIN(dataUpdatedAt của 5 query nguồn) — nguồn CŨ NHẤT là
  // sự thật của cả console (mọi con số trên màn chỉ tươi bằng nguồn tệ nhất).
  // Chỉ có mốc khi CẢ 5 nguồn đã fetch ít nhất một lần (dataUpdatedAt=0 =
  // chưa từng fetch → chưa thể tuyên bố độ tươi).
  const POLL_MS = 30_000;
  const sourceStamps = [
    andonQuery.dataUpdatedAt,
    predictiveQuery.dataUpdatedAt,
    interlockEvents.dataUpdatedAt,
    mqttUnresolved.dataUpdatedAt,
    thresholdHistory.dataUpdatedAt,
  ];
  const fetchedStamps = sourceStamps.filter((ts) => ts > 0);
  const oldestUpdatedAt = fetchedStamps.length === sourceStamps.length ? Math.min(...fetchedStamps) : undefined;
  const anySourceFetching =
    andonQuery.isFetching || predictiveQuery.isFetching || interlockEvents.isFetching ||
    mqttUnresolved.isFetching || thresholdHistory.isFetching;
  // Quá 2 chu kỳ poll không có fetch thành công nào → coi là mất cập nhật.
  // +15s dung sai: andon poll ở 60s (safety-net của socket) nên tuổi hợp lệ của
  // nó chạm đúng 60s mỗi chu kỳ — không có dung sai thì banner nhấp nháy giả.
  const STALE_AFTER_MS = POLL_MS * 2 + 15_000;
  const pollStale = oldestUpdatedAt != null && now - oldestUpdatedAt > STALE_AFTER_MS;

  // ── normalise all sources into one list ─────────────────────────────────────
  const alerts = useMemo<NormalAlert[]>(() => {
    const out: NormalAlert[] = [];

    for (const e of andonQuery.data ?? []) {
      out.push({
        key: `andon:${e.id}`,
        source: "andon",
        id: e.id,
        title: e.title,
        message: e.message ?? e.reason ?? "",
        severity: andonStateToSeverity(e.state),
        acknowledged: e.status === "acknowledged",
        resolved: e.status === "resolved",
        raisedAt: new Date(e.raisedAt),
        group: e.lineId ? `Line ${e.lineId}` : e.stationId ? `Station ${e.stationId}` : e.machineId ? `Machine ${e.machineId}` : t("opsConsole.unassigned", "Unassigned"),
        raisedBySystem: e.raisedBySystem,
      });
    }

    for (const a of (predictiveQuery.data as any[]) ?? []) {
      out.push({
        key: `predictive:${a.id}`,
        source: "predictive",
        id: a.id,
        title: a.title,
        message: a.description ?? "",
        severity: predictiveSeverity(a.severity),
        acknowledged: a.status === "ACKNOWLEDGED",
        resolved: a.status === "RESOLVED",
        raisedAt: new Date(a.createdAt),
        group: a.machineCode ? `Machine ${a.machineCode}` : t("opsConsole.unassigned", "Unassigned"),
        raisedBySystem: true,
      });
    }

    for (const ev of (interlockEvents.data as any[]) ?? []) {
      if (ev.status === "resolved") continue;
      out.push({
        key: `interlock:${ev.id}`,
        source: "interlock",
        id: ev.id,
        title: t("opsConsole.interlockRule", "Interlock rule #{{id}}", { id: ev.ruleId }),
        message: `${ev.action ?? "alert"} · observed ${ev.observedValue ?? "—"} / threshold ${ev.threshold ?? "—"}`,
        severity: interlockSeverity(ev.action),
        acknowledged: ev.status === "acknowledged",
        resolved: false,
        raisedAt: ev.firedAt ? new Date(ev.firedAt) : new Date(),
        group: t("opsConsole.interlock", "Interlock"),
        raisedBySystem: true,
      });
    }

    for (const a of (mqttUnresolved.data as any[]) ?? []) {
      out.push({
        key: `mqtt:${a.id}`,
        source: "mqtt",
        id: a.id,
        title: a.ruleName ?? "MQTT alert",
        message: a.message ?? "",
        severity: mqttSeverity(a.severity),
        acknowledged: false,
        resolved: false,
        raisedAt: a.triggeredAt ? new Date(a.triggeredAt) : new Date(),
        group: t("opsConsole.mqttBroker", "MQTT / Broker"),
        raisedBySystem: true,
      });
    }

    for (const h of (thresholdHistory.data as any[]) ?? []) {
      if (h.acknowledgedAt) continue; // only show open threshold breaches in the console
      out.push({
        key: `threshold:${h.id}`,
        source: "threshold",
        id: h.id,
        title: h.message ?? t("opsConsole.thresholdBreach", "Threshold breach"),
        message: t("opsConsole.triggeredValue", "Triggered value: {{v}}", { v: h.triggeredValue }),
        severity: thresholdSeverity(h.severity),
        acknowledged: false,
        resolved: false,
        raisedAt: new Date(h.createdAt),
        group: t("opsConsole.qualityThreshold", "Quality threshold"),
        raisedBySystem: true,
      });
    }

    return out.sort((a, b) => {
      const r = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      if (r !== 0) return r;
      return b.raisedAt.getTime() - a.raisedAt.getTime();
    });
  }, [andonQuery.data, predictiveQuery.data, interlockEvents.data, mqttUnresolved.data, thresholdHistory.data, t]);

  // ── unified ack / resolve dispatch (W1: nhãn nút = đúng hành vi mutation) ───
  // ack: CHỈ những nguồn có mutation acknowledge thật. interlock/mqtt không có
  // ack trên server → không bao giờ đi qua đây (nút "Xác nhận" không hiện).
  const ack = useCallback((a: NormalAlert) => {
    switch (a.source) {
      case "andon": ackAndon.mutate({ id: a.id }); break;
      case "predictive": ackPredictive.mutate({ id: a.id }); break;
      case "threshold": ackThreshold.mutate({ id: a.id }); break;
    }
  }, [ackAndon, ackPredictive, ackThreshold]);

  // resolve: CHỈ những nguồn có mutation resolve thật. predictive/threshold chỉ
  // có ack ở console này → không hiện nút "Xử lý xong" giả cho chúng.
  const resolve = useCallback((a: NormalAlert) => {
    switch (a.source) {
      case "andon": resolveAndon.mutate({ id: a.id }); break;
      case "interlock": resolveInterlock.mutate({ id: a.id }); break;
      case "mqtt": resolveMqtt.mutate({ id: a.id }); break;
    }
  }, [resolveAndon, resolveInterlock, resolveMqtt]);

  // interlock/mqtt resolve là đóng VĨNH VIỄN → bắt buộc xác nhận qua AlertDialog.
  const [confirmAlert, setConfirmAlert] = useState<NormalAlert | null>(null);
  const requestResolve = useCallback((a: NormalAlert) => {
    if (isResolveOnly(a.source)) setConfirmAlert(a);
    else resolve(a);
  }, [resolve]);

  // ── full-screen / TV mode ───────────────────────────────────────────────────
  const rootRef = useRef<HTMLDivElement>(null);
  const [isFs, setIsFs] = useState(false);
  const toggleFs = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    if (!document.fullscreenElement) void el.requestFullscreen?.().catch(() => {});
    else void document.exitFullscreen?.().catch(() => {});
  }, []);
  useEffect(() => {
    const onChange = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // ── War-Room grouping ───────────────────────────────────────────────────────
  const grouped = useMemo(() => {
    const m = new Map<string, NormalAlert[]>();
    for (const a of alerts) {
      if (a.resolved) continue;
      const arr = m.get(a.group) ?? [];
      arr.push(a);
      m.set(a.group, arr);
    }
    return [...m.entries()].sort((x, y) => SEVERITY_RANK[x[1][0].severity] - SEVERITY_RANK[y[1][0].severity]);
  }, [alerts]);

  const counts = useMemo(() => {
    const open = alerts.filter((a) => !a.resolved);
    return {
      critical: open.filter((a) => a.severity === "critical").length,
      high: open.filter((a) => a.severity === "high").length,
      unacked: open.filter((a) => !a.acknowledged).length,
      total: open.length,
    };
  }, [alerts]);

  // ── Alert Center filters ────────────────────────────────────────────────────
  const [sourceFilter, setSourceFilter] = useState<AlertSource | "all">("all");
  const [severityFilter, setSeverityFilter] = useState<Severity | "all">("all");
  const [ackFilter, setAckFilter] = useState<"all" | "unacked" | "acked">("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return alerts.filter((a) => {
      if (a.resolved) return false;
      if (sourceFilter !== "all" && a.source !== sourceFilter) return false;
      if (severityFilter !== "all" && a.severity !== severityFilter) return false;
      if (ackFilter === "unacked" && a.acknowledged) return false;
      if (ackFilter === "acked" && !a.acknowledged) return false;
      if (q && !(`${a.title} ${a.message} ${a.group}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [alerts, sourceFilter, severityFilter, ackFilter, search]);

  const isPending =
    ackAndon.isPending || resolveAndon.isPending || ackPredictive.isPending ||
    resolveInterlock.isPending || resolveMqtt.isPending || ackThreshold.isPending;

  const refreshAll = () => {
    void utils.andon.active.invalidate();
    void utils.predictiveAlert.list.invalidate();
    void utils.interlock.events.invalidate();
    void utils.mqttAlert.unresolved.invalidate();
    void utils.alert.history.invalidate();
  };

  return (
    <DashboardLayout title={t("opsConsole.title", "Ops Console")} navItems={navItems} currentPath="/ops-console">
      <div
        ref={rootRef}
        className={`space-y-6 p-6 transition-colors ${flash ? "animate-pulse bg-destructive/20" : ""} ${isFs ? "min-h-screen bg-background" : ""}`}
      >
        {/* Header / KPI strip */}
        <PageHeader
          icon={<Activity className="h-6 w-6" />}
          title={t("opsConsole.title", "Ops Console")}
          description={t("opsConsole.subtitle", "Unified War-Room + Alert Center — signal only, never controls a machine")}
          actions={
            <>
              {/* W2 (AUD-01): độ tươi thật của console = nguồn poll CŨ NHẤT. */}
              <PollFreshness
                updatedAt={oldestUpdatedAt}
                isFetching={anySourceFetching}
                staleAfterMs={STALE_AFTER_MS}
              />
              <Button variant="outline" size="sm" onClick={refreshAll}>
                <RefreshCw className="mr-1 h-4 w-4" /> {t("common.refresh", "Refresh")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSoundOn((s) => !s)}
                aria-label={soundOn ? t("opsConsole.soundOn", "Sound on") : t("opsConsole.soundOff", "Sound off")}
              >
                {soundOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              </Button>
              <Button variant="outline" size="sm" onClick={toggleFs}>
                {isFs ? <Minimize2 className="mr-1 h-4 w-4" /> : <Maximize2 className="mr-1 h-4 w-4" />}
                {t("opsConsole.tvMode", "TV mode")}
              </Button>
            </>
          }
        />

        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          <Kpi label={t("opsConsole.kpiCritical", "Critical")} value={counts.critical} accent="text-destructive" />
          <Kpi label={t("opsConsole.kpiHigh", "High")} value={counts.high} accent="text-warning" />
          <Kpi label={t("opsConsole.kpiUnacked", "Unacknowledged")} value={counts.unacked} accent="text-warning" />
          <Kpi label={t("opsConsole.kpiOpen", "Open total")} value={counts.total} />
          {/* W1: server (andonRouter.metrics) coalesce avg NULL→0 khi CHƯA có ack
              nào trong 24h — nên 0 là sentinel "chưa có dữ liệu", không phải MTTA
              0 giây thật → hiển thị "—" thay vì con số gây hiểu nhầm. Nhãn nói rõ
              phạm vi: chỉ đo sự kiện Andon, không gồm các nguồn cảnh báo khác. */}
          <Kpi
            label="MTTA Andon (24h)"
            value={
              andonMetrics.data == null || !andonMetrics.data.avgMttaSeconds
                ? "—"
                : `${andonMetrics.data.avgMttaSeconds}s`
            }
          />
        </div>

        {/* W2 (AUD-01): mất cập nhật >2 chu kỳ poll → banner mỏng cảnh báo trên
            đầu danh sách — nhãn "Tuổi" bên dưới vẫn chạy theo đồng hồ client nên
            KHÔNG tự tố giác việc danh sách đã đứng im. */}
        {pollStale && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-md border border-warning bg-warning/10 px-3 py-2 text-sm text-warning"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            {t("opsConsole.staleData", "Dữ liệu có thể đã cũ — mất kết nối cập nhật")}
          </div>
        )}

        <Tabs defaultValue="warroom">
          <TabsList>
            <TabsTrigger value="warroom" className="gap-2">
              <AlertTriangle className="h-4 w-4" /> {t("opsConsole.tabWarRoom", "War Room")}
            </TabsTrigger>
            <TabsTrigger value="center" className="gap-2">
              <Bell className="h-4 w-4" /> {t("opsConsole.tabAlertCenter", "Alert Center")}
            </TabsTrigger>
          </TabsList>

          {/* ── War Room ── */}
          <TabsContent value="warroom" className="mt-4 space-y-4">
            {grouped.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                  <CheckCircle2 className="mb-3 h-12 w-12 text-success/60" />
                  <p className="text-lg">{t("opsConsole.allClear", "All clear — no open alerts")}</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {grouped.map(([group, items]) => (
                  <Card key={group} className="overflow-hidden">
                    <CardHeader className="py-3">
                      <CardTitle className="flex items-center justify-between text-base">
                        <span>{group}</span>
                        <Badge variant="secondary">{items.length}</Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {items.map((a) => (
                        <div
                          key={a.key}
                          className={`rounded-md border-2 p-3 ${SEVERITY_TILE[a.severity]} ${a.severity === "critical" && !a.acknowledged ? "animate-pulse" : ""}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 text-sm font-semibold">
                                {SOURCE_ICON[a.source]}
                                <span className="truncate">{a.title}</span>
                              </div>
                              <p className="mt-1 line-clamp-2 text-xs opacity-90">{a.message}</p>
                              <div className="mt-1 text-xs opacity-80">
                                {t("opsConsole.age", "Age")}: {ageLabel(a.raisedAt, now)}
                                {a.acknowledged && ` · ${t("opsConsole.acked", "ACK")}`}
                              </div>
                            </div>
                            <div className="flex shrink-0 flex-col gap-1">
                              {!isResolveOnly(a.source) && !a.acknowledged && (
                                <Button size="sm" variant="secondary" disabled={isPending} onClick={() => ack(a)}>
                                  Xác nhận
                                </Button>
                              )}
                              {!isAckOnly(a.source) && (
                                <Button size="sm" variant="outline" disabled={isPending} onClick={() => requestResolve(a)}>
                                  Xử lý xong
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── Alert Center ── */}
          <TabsContent value="center" className="mt-4 space-y-4">
            <Card>
              <CardContent className="flex flex-wrap items-center gap-3 pt-6">
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="w-[220px] pl-8"
                    placeholder={t("opsConsole.searchPlaceholder", "Search alerts…")}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v as AlertSource | "all")}>
                  <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("opsConsole.allSources", "All sources")}</SelectItem>
                    <SelectItem value="andon">{t("opsConsole.srcAndon", "Andon")}</SelectItem>
                    <SelectItem value="predictive">{t("opsConsole.srcPredictive", "Predictive")}</SelectItem>
                    <SelectItem value="interlock">{t("opsConsole.srcInterlock", "Interlock")}</SelectItem>
                    <SelectItem value="mqtt">{t("opsConsole.srcMqtt", "MQTT")}</SelectItem>
                    <SelectItem value="threshold">{t("opsConsole.srcThreshold", "Threshold")}</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={severityFilter} onValueChange={(v) => setSeverityFilter(v as Severity | "all")}>
                  <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("opsConsole.allSeverity", "All severity")}</SelectItem>
                    <SelectItem value="critical">{t("opsConsole.kpiCritical", "Critical")}</SelectItem>
                    <SelectItem value="high">{t("opsConsole.kpiHigh", "High")}</SelectItem>
                    <SelectItem value="medium">{t("opsConsole.sevMedium", "Medium")}</SelectItem>
                    <SelectItem value="low">{t("opsConsole.sevLow", "Low")}</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={ackFilter} onValueChange={(v) => setAckFilter(v as typeof ackFilter)}>
                  <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("opsConsole.ackAll", "All states")}</SelectItem>
                    <SelectItem value="unacked">{t("opsConsole.ackUnacked", "Unacknowledged")}</SelectItem>
                    <SelectItem value="acked">{t("opsConsole.ackAcked", "Acknowledged")}</SelectItem>
                  </SelectContent>
                </Select>
                <span className="ml-auto text-sm text-muted-foreground">
                  {t("opsConsole.showing", "Showing {{n}}", { n: filtered.length })}
                </span>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("opsConsole.colSeverity", "Severity")}</TableHead>
                      <TableHead>{t("opsConsole.colSource", "Source")}</TableHead>
                      <TableHead>{t("opsConsole.colTitle", "Title")}</TableHead>
                      <TableHead>{t("opsConsole.colGroup", "Location")}</TableHead>
                      <TableHead>{t("opsConsole.colAge", "Age")}</TableHead>
                      <TableHead>{t("common.status", "Status")}</TableHead>
                      <TableHead className="text-right">{t("common.actions", "Actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                          {t("opsConsole.noAlerts", "No alerts match the filters")}
                        </TableCell>
                      </TableRow>
                    )}
                    {filtered.map((a) => (
                      <TableRow key={a.key}>
                        <TableCell>
                          <span className="flex items-center gap-2">
                            <span className={`inline-block h-3 w-3 rounded-full ${SEVERITY_DOT[a.severity]}`} />
                            <span className="capitalize">{a.severity}</span>
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="gap-1">
                            {SOURCE_ICON[a.source]} {a.source}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-[280px]">
                          <div className="truncate font-medium">{a.title}</div>
                          <div className="truncate text-xs text-muted-foreground">{a.message}</div>
                        </TableCell>
                        <TableCell className="text-sm">{a.group}</TableCell>
                        <TableCell className="text-sm tabular-nums">{ageLabel(a.raisedAt, now)}</TableCell>
                        <TableCell>
                          {a.acknowledged
                            ? <Badge variant="secondary">{t("opsConsole.acked", "ACK")}</Badge>
                            : <Badge variant="destructive">{t("opsConsole.open", "Open")}</Badge>}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {!isResolveOnly(a.source) && !a.acknowledged && (
                              <Button size="sm" variant="outline" disabled={isPending} onClick={() => ack(a)}>
                                Xác nhận
                              </Button>
                            )}
                            {!isAckOnly(a.source) && (
                              <Button size="sm" variant="ghost" disabled={isPending} onClick={() => requestResolve(a)}>
                                Xử lý xong
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* W1: interlock/MQTT chỉ có mutation RESOLVE (đóng vĩnh viễn, server không
            có ack riêng) → hành động phải qua bước xác nhận tường minh. */}
        <AlertDialog
          open={confirmAlert !== null}
          onOpenChange={(open) => { if (!open) setConfirmAlert(null); }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Xác nhận xử lý xong?</AlertDialogTitle>
              <AlertDialogDescription>
                {confirmAlert
                  ? `Cảnh báo "${confirmAlert.title}" (nguồn ${confirmAlert.source === "interlock" ? "Interlock" : "MQTT"}) sẽ bị đóng vĩnh viễn — không thể hoàn tác từ màn hình này.`
                  : ""}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Hủy</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => { if (confirmAlert) resolve(confirmAlert); setConfirmAlert(null); }}
              >
                Xử lý xong
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </DashboardLayout>
  );
}

function Kpi({ label, value, accent }: { label: string; value: number | string; accent?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className={`text-2xl font-bold ${accent ?? ""}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
