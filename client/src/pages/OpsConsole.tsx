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
 * doc 67 W3 — sống sót ALERT-STORM (persona: quản đốc panel-PC 10.1", găng tay):
 *   1. Coalesce bão cảnh báo: nhóm theo (source+title+vị trí) → 1 thẻ "×N lần"
 *      (Andon KHÔNG gộp — mỗi Andon là một sự cố riêng).
 *   2. Bulk-ack: "Xác nhận cả nhóm (N)" trên thẻ nhóm + checkbox chọn hàng ở
 *      Alert Center với thanh hành động nổi (đúng ngữ nghĩa W1 theo nguồn).
 *   3. Escalation thị giác: critical chưa-ack >10' nổi lên đầu + "QUÁ HẠN Xm";
 *      predictive quá cửa sổ 5 ngày chìm xuống đáy + mờ (không xóa — trung thực).
 *   4. Perf: bỏ tick 1s ở root (re-render cả trang mỗi giây) → AgeLabel tự tick,
 *      escalation/stale dùng coarse tick 30s, thẻ nhóm React.memo.
 *   5. Pending per-alert (Set) thay isPending toàn cục từng khóa cả 192 nút.
 *   6. alert.history dùng onlyOpen=true — server lọc đã-ack để breach mở CŨ
 *      không rớt khỏi limit 50.
 *   7. TV mode thật khi fullscreen: tile lớn critical/high, không nút/không
 *      filter; còi qua AudioContext dùng chung, unlock từ user-gesture đầu tiên.
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
import { MetricCard, PageHeader } from "@/components/patterns";
import { ContextDrawer } from "@/components/workspace/ContextDrawer";
import { RelatedViews } from "@/components/RelatedViews";
import PollFreshness from "@/components/PollFreshness";
import AgeLabel from "@/components/opsconsole/AgeLabel";
import AlertGroupCard from "@/components/opsconsole/AlertGroupCard";
import {
  type AlertGroup, type AlertSource, type ClosedAlertRow, type DecoratedAlert, type NormalAlert, type Severity,
  SEVERITY_DOT, SEVERITY_RANK, SEVERITY_TILE_SOLID, SOURCE_ICON,
  OVERDUE_AFTER_MS,
  closedReasonText, compareEscalation, isAckOnly, isResolveOnly, isForecastExpired,
} from "@/components/opsconsole/model";
// doc 67 W7 GĐ2 — formatter/empty-state chuẩn GĐ1 thay bản tự chế.
import { fmtNum } from "@/lib/format";
// Task 7 (Wave 3) — dải tin cậy là trục riêng với mức độ (severity); xem
// client/src/lib/alertConfidence.ts cho lý do (decimal pg ⇒ chuỗi qua tRPC).
import { confidenceBand } from "@/lib/alertConfidence";
import EmptyState from "@/components/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
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
  Volume2, VolumeX, RefreshCw, Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ─────────────────────────────────────────────────────────────────────────────
// Severity mappers per source (model types/constants sống ở components/opsconsole/model.tsx)
// ─────────────────────────────────────────────────────────────────────────────

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

/** War Room: mỗi cột vị trí chỉ hiện top-8 nhóm — phần còn lại sau "Hiện thêm (N)". */
const WARROOM_GROUP_CAP = 8;
/** Alert Center: slice tăng dần thay virtualization (không thêm dependency npm). */
const CENTER_ROW_STEP = 50;

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
  // Task 6 (Wave 4) — "cảnh báo vừa đóng" (predictive status=EXPIRED). Wave 3's
  // alertExpirySweeper auto-closes alerts that stopped recurring and writes a
  // human reason into resolutionNotes, but the console only ever queried
  // status=ACTIVE — a closed alert simply vanished with nobody able to read
  // why. `enabled: showRecentlyClosed` — opt-in toggle, OFF by default (no
  // background polling for a section nobody opened, and the open-alert list
  // stays quiet by default).
  const [showRecentlyClosed, setShowRecentlyClosed] = useState(false);
  const closedPredictiveQuery = trpc.predictiveAlert.list.useQuery(
    { status: "EXPIRED", limit: 50 },
    { enabled: showRecentlyClosed, refetchInterval: showRecentlyClosed ? 30_000 : false },
  );
  const interlockEvents = trpc.interlock.events.useQuery({ limit: 100 }, { refetchInterval: 30_000 });
  const mqttUnresolved = trpc.mqttAlert.unresolved.useQuery(undefined, { refetchInterval: 30_000 });
  // W3 (việc 6): onlyOpen=true — server lọc acknowledged_at IS NULL TRƯỚC khi
  // limit 50. Trước đây lấy 50 bản MỚI NHẤT rồi client lọc → 50 bản gần nhất
  // đều đã ack thì breach mở cũ biến mất khỏi console.
  const thresholdHistory = trpc.alert.history.useQuery(
    { limit: 50, onlyOpen: true },
    { refetchInterval: 30_000 },
  );

  // ── mutations (unified ack/resolve) ─────────────────────────────────────────
  // W3 (việc 2): KHÔNG toast lỗi ở config mutation nữa — bulk 25 id lỗi sẽ bắn
  // 25 toast. Lỗi được gom ở actSingle (toast từng lỗi) / runBulk (toast tổng kết).
  const ackAndon = trpc.andon.acknowledge.useMutation({
    onSuccess: () => { void utils.andon.active.invalidate(); void utils.andon.metrics.invalidate(); },
  });
  const resolveAndon = trpc.andon.resolve.useMutation({
    onSuccess: () => { void utils.andon.active.invalidate(); void utils.andon.metrics.invalidate(); },
  });
  const ackPredictive = trpc.predictiveAlert.acknowledge.useMutation({
    onSuccess: () => { void utils.predictiveAlert.list.invalidate(); },
  });
  const resolveInterlock = trpc.interlock.resolveEvent.useMutation({
    onSuccess: () => { void utils.interlock.events.invalidate(); },
  });
  const resolveMqtt = trpc.mqttAlert.resolve.useMutation({
    onSuccess: () => { void utils.mqttAlert.unresolved.invalidate(); },
  });
  const ackThreshold = trpc.alert.acknowledge.useMutation({
    onSuccess: () => { void utils.alert.history.invalidate(); },
  });

  // ── realtime: refresh Andon (+ flash/sound) on any andon:event ──────────────
  const [flash, setFlash] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const soundOnRef = useRef(soundOn);
  soundOnRef.current = soundOn;

  // W3 (việc 7): AudioContext DÙNG CHUNG, tạo 1 lần + unlock từ user-gesture đầu
  // tiên. Bản cũ `new AudioContext()` NGAY TRONG beep() — nếu chưa có gesture nào
  // (tab TV treo tường không ai chạm) thì ctx sinh ra ở trạng thái "suspended",
  // beep câm lặng lẽ mà không ai biết → chip "Chạm để bật còi" nói thật trạng thái.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const ensureAudio = useCallback((): AudioContext | null => {
    try {
      const AC = (window.AudioContext || (window as any).webkitAudioContext);
      if (!AC) return null;
      if (!audioCtxRef.current) {
        const ctx: AudioContext = new AC();
        ctx.onstatechange = () => setAudioBlocked(ctx.state !== "running");
        audioCtxRef.current = ctx;
      }
      return audioCtxRef.current;
    } catch { return null; }
  }, []);
  const unlockAudio = useCallback(() => {
    const ctx = ensureAudio();
    if (!ctx) return;
    if (ctx.state !== "running") {
      void ctx.resume()
        .then(() => setAudioBlocked(ctx.state !== "running"))
        .catch(() => setAudioBlocked(true));
    } else setAudioBlocked(false);
  }, [ensureAudio]);
  useEffect(() => {
    // Tạo ngay khi mount để BIẾT autoplay-policy đang chặn hay không (suspended
    // → hiện chip). Click bất kỳ trên trang (listener once) sẽ resume.
    const ctx = ensureAudio();
    if (ctx) setAudioBlocked(ctx.state !== "running");
    window.addEventListener("pointerdown", unlockAudio, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      void audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
    };
  }, [ensureAudio, unlockAudio]);

  const beep = useCallback(() => {
    if (!soundOnRef.current) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    if (ctx.state !== "running") { setAudioBlocked(true); return; }
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = 880;
      gain.gain.value = 0.06;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    } catch { /* audio not available — silent */ }
  }, [ensureAudio]);

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

  // ── W3 (việc 4): coarse tick 30s thay tick 1s ở root ────────────────────────
  // Bản cũ setInterval 1s setNow → re-render TOÀN trang (85+ thẻ) mỗi giây chỉ
  // để nhãn tuổi chạy. Giờ: nhãn tuổi = <AgeLabel> tự tick (1s khi <60s, 10s sau
  // đó); root chỉ giữ tick 30s cho pollStale (ngưỡng 75s — 30s là đủ trung thực)
  // và escalation quá-hạn/hết-hạn (độ phân giải phút).
  const [coarseNow, setCoarseNow] = useState(() => Date.now());
  useEffect(() => {
    const i = window.setInterval(() => setCoarseNow(Date.now()), 30_000);
    return () => window.clearInterval(i);
  }, []);

  // ── W2 (AUD-01): freshness trung thực cho console poll ──────────────────────
  // 4/5 nguồn poll 30s (andon 60s safety-net) nhưng nhãn "Tuổi" tự tăng theo
  // đồng hồ client — mất mạng thì danh sách ĐỨNG IM mà tuổi vẫn chạy, càng
  // giống thật. Lấy MIN(dataUpdatedAt của 5 query nguồn) — nguồn CŨ NHẤT là
  // sự thật của cả console (mọi con số trên màn chỉ tươi bằng nguồn tệ nhất).
  // Chỉ có mốc khi CẢ 5 nguồn đã fetch ít nhất một lần (dataUpdatedAt=0 =
  // chưa từng fetch → chưa thể tuyên bố độ tươi).
  // W3: nhãn "cập nhật Ns trước" do PollFreshness TỰ TICK nội bộ; root chỉ cần
  // coarseNow 30s để quyết định banner stale.
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
  const pollStale = oldestUpdatedAt != null && coarseNow - oldestUpdatedAt > STALE_AFTER_MS;

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

    for (const a of predictiveQuery.data ?? []) {
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
        // Task 7 — confidenceScore/occurrenceCount CHỈ có ở predictive. occurrenceCount
        // có thể vắng mặt (migration 0308 chưa chạy) → giữ nguyên undefined, KHÔNG ép 1
        // ở đây (việc "coi như 1" thuộc về nơi hiển thị, không phải nơi chuẩn hoá dữ liệu).
        confidenceScore: a.confidenceScore ?? null,
        occurrenceCount: typeof a.occurrenceCount === "number" ? a.occurrenceCount : undefined,
        // Vòng sửa cuối (mục 2) — mốc "tái diễn gần nhất" cho isForecastExpired.
        lastOccurredAt: a.lastOccurredAt ? new Date(a.lastOccurredAt) : null,
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
      if (h.acknowledgedAt) continue; // phòng thủ — server đã lọc bằng onlyOpen (W3 việc 6)
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

    return out;
  }, [andonQuery.data, predictiveQuery.data, interlockEvents.data, mqttUnresolved.data, thresholdHistory.data, t]);

  // ── Task 6 (Wave 4): "cảnh báo vừa đóng" — DANH SÁCH PHỤ, cố ý KHÔNG đi qua
  // `alerts`/`decorated`/`groups` (đó là nguồn cho War Room + KPI đếm "đang
  // mở"). Trộn vào đó sẽ khiến một dòng EXPIRED bị đếm/hiện như đang mở — đúng
  // lỗi brief cảnh báo tránh. Chỉ tính khi công tắc bật (query cũng chỉ enabled
  // lúc đó) nên không tốn gì khi tắt.
  const closedRows = useMemo<ClosedAlertRow[]>(() => {
    if (!showRecentlyClosed) return [];
    return (closedPredictiveQuery.data ?? []).map((a) => ({
      key: `predictive-closed:${a.id}`,
      id: a.id,
      title: a.title,
      message: a.description ?? "",
      severity: predictiveSeverity(a.severity),
      group: a.machineCode ? `Machine ${a.machineCode}` : t("opsConsole.unassigned", "Unassigned"),
      raisedAt: new Date(a.createdAt),
      // updatedAt là mốc gần nhất được ghi khi sweeper đóng dòng (EXPIRED không
      // có resolvedAt) — dùng nó để "vừa đóng" phản ánh đúng độ mới của việc đóng,
      // không phải tuổi của lần dự báo đầu tiên.
      closedAt: a.updatedAt ? new Date(a.updatedAt) : new Date(a.createdAt),
      resolutionNotes: a.resolutionNotes ?? null,
    }));
  }, [showRecentlyClosed, closedPredictiveQuery.data, t]);

  // ── W3 (việc 3): escalation flags + sort ────────────────────────────────────
  // critical chưa-ack >10' → quá hạn (nổi đầu); predictive >5 ngày → hết hạn dự
  // báo (chìm đáy, mờ — KHÔNG xóa). Trong cùng mức: chưa-ack cũ nhất trước.
  const decorated = useMemo<DecoratedAlert[]>(() => {
    return alerts
      .map((a) => {
        const age = coarseNow - a.raisedAt.getTime();
        const overdue = a.severity === "critical" && !a.acknowledged && !a.resolved && age > OVERDUE_AFTER_MS;
        return {
          ...a,
          overdue,
          overdueMin: overdue ? Math.max(1, Math.floor((age - OVERDUE_AFTER_MS) / 60_000)) : 0,
          expired: isForecastExpired(a, coarseNow),
        };
      })
      .sort(compareEscalation);
  }, [alerts, coarseNow]);

  // ── W3 (việc 1): coalesce bão cảnh báo thành NHÓM ───────────────────────────
  // Key = source + title (ruleName của MQTT/threshold nằm trong title) + vị trí
  // (machineCode nằm trong group). Andon KHÔNG gộp — mỗi Andon một sự cố riêng.
  const groups = useMemo<AlertGroup[]>(() => {
    const m = new Map<string, DecoratedAlert[]>();
    for (const a of decorated) {
      if (a.resolved) continue;
      const k = a.source === "andon" ? `andon:${a.id}` : `${a.source}|${a.title}|${a.group}`;
      const arr = m.get(k) ?? [];
      arr.push(a);
      m.set(k, arr);
    }
    const rep = (g: AlertGroup) => ({
      severity: g.severity,
      overdue: g.overdue,
      expired: g.expired,
      acknowledged: g.unackedCount === 0,
      // chưa-ack: xếp theo bản CHỜ LÂU NHẤT trong nhóm (đúng luật "cũ nhất trước")
      raisedAt: g.unackedCount > 0
        ? g.items.reduce((min, i) => (!i.acknowledged && i.raisedAt < min ? i.raisedAt : min), g.latest.raisedAt)
        : g.latest.raisedAt,
    });
    const out: AlertGroup[] = [];
    for (const [gkey, items] of m) {
      items.sort((x, y) => y.raisedAt.getTime() - x.raisedAt.getTime()); // mới nhất trước
      const latest = items[0];
      const severity = items.reduce<Severity>(
        (s, i) => (SEVERITY_RANK[i.severity] < SEVERITY_RANK[s] ? i.severity : s),
        latest.severity,
      );
      out.push({
        gkey,
        source: latest.source,
        title: latest.title,
        location: latest.group,
        severity,
        items,
        latest,
        count: items.length,
        unackedCount: items.filter((i) => !i.acknowledged).length,
        overdue: items.some((i) => i.overdue),
        overdueMin: items.reduce((mx, i) => Math.max(mx, i.overdueMin), 0),
        // nhóm chỉ coi là hết hạn khi TẤT CẢ bản ghi con hết hạn (còn 1 bản trong
        // cửa sổ dự báo thì nhóm vẫn đáng nhìn)
        expired: items.every((i) => i.expired),
      });
    }
    return out.sort((x, y) => compareEscalation(rep(x), rep(y)));
  }, [decorated]);

  // ── W3 (việc 2+5): pending per-alert + dispatch đơn/bulk ────────────────────
  // Set<key> thay isPending toàn cục (OR 6 mutation) từng disable CẢ 192 nút khi
  // 1 alert đang xử lý.
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(() => new Set());
  const markPending = useCallback((keys: string[], on: boolean) => {
    setPendingKeys((prev) => {
      const next = new Set(prev);
      for (const k of keys) { if (on) next.add(k); else next.delete(k); }
      return next;
    });
  }, []);

  // mutateAsync của TanStack v5 là tham chiếu ổn định → callback bên dưới không
  // đổi identity mỗi render (giữ React.memo của AlertGroupCard có tác dụng).
  const ackAndonAsync = ackAndon.mutateAsync;
  const ackPredictiveAsync = ackPredictive.mutateAsync;
  const ackThresholdAsync = ackThreshold.mutateAsync;
  const resolveAndonAsync = resolveAndon.mutateAsync;
  const resolveInterlockAsync = resolveInterlock.mutateAsync;
  const resolveMqttAsync = resolveMqtt.mutateAsync;

  // ack: CHỈ những nguồn có mutation acknowledge thật (W1). interlock/mqtt không
  // có ack trên server → không bao giờ đi qua đây (nút "Xác nhận" không hiện).
  const ackOneAsync = useCallback((a: NormalAlert): Promise<unknown> => {
    switch (a.source) {
      case "andon": return ackAndonAsync({ id: a.id });
      case "predictive": return ackPredictiveAsync({ id: a.id });
      case "threshold": return ackThresholdAsync({ id: a.id });
      default: return Promise.reject(new Error(`Nguồn ${a.source} không có thao tác xác nhận`));
    }
  }, [ackAndonAsync, ackPredictiveAsync, ackThresholdAsync]);

  // resolve: CHỈ những nguồn có mutation resolve thật (W1). predictive/threshold
  // chỉ có ack ở console này → không hiện nút "Xử lý xong" giả cho chúng.
  const resolveOneAsync = useCallback((a: NormalAlert): Promise<unknown> => {
    switch (a.source) {
      case "andon": return resolveAndonAsync({ id: a.id });
      case "interlock": return resolveInterlockAsync({ id: a.id });
      case "mqtt": return resolveMqttAsync({ id: a.id });
      default: return Promise.reject(new Error(`Nguồn ${a.source} không có thao tác xử lý`));
    }
  }, [resolveAndonAsync, resolveInterlockAsync, resolveMqttAsync]);

  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const actSingle = useCallback(async (a: DecoratedAlert, action: "ack" | "resolve") => {
    markPending([a.key], true);
    try {
      await (action === "ack" ? ackOneAsync(a) : resolveOneAsync(a));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Thao tác thất bại");
    } finally {
      markPending([a.key], false);
    }
  }, [markPending, ackOneAsync, resolveOneAsync]);

  /** Bulk (việc 2): Promise.allSettled + toast tổng kết X/N — không spam toast lỗi. */
  const runBulk = useCallback(async (items: DecoratedAlert[], action: "ack" | "resolve", label: string) => {
    if (items.length === 0) return;
    const keys = items.map((i) => i.key);
    markPending(keys, true);
    const results = await Promise.allSettled(
      items.map((i) => (action === "ack" ? ackOneAsync(i) : resolveOneAsync(i))),
    );
    markPending(keys, false);
    const ok = results.filter((r) => r.status === "fulfilled").length;
    if (ok === items.length) toast.success(`${label}: ${ok}/${items.length} thành công`);
    else toast.error(`${label}: ${ok}/${items.length} thành công — ${items.length - ok} thất bại`);
    // Bỏ chọn những dòng đã xử lý THÀNH CÔNG; dòng lỗi giữ lại cho lần thử sau.
    const doneKeys = new Set(keys.filter((_, idx) => results[idx].status === "fulfilled"));
    setSelected((prev) => new Set([...prev].filter((k) => !doneKeys.has(k))));
  }, [markPending, ackOneAsync, resolveOneAsync]);

  // interlock/mqtt resolve là đóng VĨNH VIỄN → bắt buộc xác nhận qua AlertDialog
  // (W1) — áp dụng cho cả đơn lẻ lẫn cả-nhóm/bulk.
  const [confirmTarget, setConfirmTarget] = useState<{ items: DecoratedAlert[]; label: string } | null>(null);

  const handleAck = useCallback((a: DecoratedAlert) => { void actSingle(a, "ack"); }, [actSingle]);
  const handleRequestResolve = useCallback((a: DecoratedAlert) => {
    if (isResolveOnly(a.source)) setConfirmTarget({ items: [a], label: a.title });
    else void actSingle(a, "resolve");
  }, [actSingle]);
  const handleBulkAck = useCallback((g: AlertGroup) => {
    void runBulk(g.items.filter((i) => !i.acknowledged), "ack", `Xác nhận nhóm "${g.title}"`);
  }, [runBulk]);
  const handleBulkResolveRequest = useCallback((g: AlertGroup) => {
    setConfirmTarget({ items: g.items, label: g.title });
  }, []);

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

  // ── War-Room: nhóm coalesce xếp theo vị trí ─────────────────────────────────
  // `groups` đã sort escalation → thứ tự chèn vào Map = vị trí có nhóm NẶNG nhất
  // đứng trước.
  // doc 68 §3.4 (P1): dải "CẦN XỬ LÝ TRƯỚC" — nhấc nhóm nghiêm-trọng/quá-hạn ra
  // full-width TRÊN lưới vị trí (salience đúng, không dựa may rủi vị trí ô).
  const priorityGroups = useMemo(
    () => groups.filter((g) => g.severity === "critical" || g.overdue),
    [groups],
  );
  const warRoom = useMemo(() => {
    const m = new Map<string, AlertGroup[]>();
    for (const g of groups) {
      // Nhóm ưu tiên đã lên dải trên → loại khỏi cột vị trí để khỏi trùng.
      if (g.severity === "critical" || g.overdue) continue;
      const arr = m.get(g.location) ?? [];
      arr.push(g);
      m.set(g.location, arr);
    }
    return [...m.entries()];
  }, [groups]);
  const [expandedLocs, setExpandedLocs] = useState<Set<string>>(() => new Set());

  // doc 68 §3.4 (P1): chi tiết nhóm / bản-ghi / 1 alert → ContextDrawer phải.
  const [detailGroup, setDetailGroup] = useState<AlertGroup | null>(null);
  const openAlertDetail = useCallback((a: DecoratedAlert) => {
    setDetailGroup({
      gkey: a.key,
      source: a.source,
      title: a.title,
      location: a.group,
      severity: a.severity,
      items: [a],
      latest: a,
      count: 1,
      unackedCount: a.acknowledged ? 0 : 1,
      overdue: a.overdue,
      overdueMin: a.overdueMin,
      expired: a.expired,
    });
  }, []);

  const counts = useMemo(() => {
    const open = decorated.filter((a) => !a.resolved);
    return {
      critical: open.filter((a) => a.severity === "critical").length,
      high: open.filter((a) => a.severity === "high").length,
      unacked: open.filter((a) => !a.acknowledged).length,
      total: open.length,
    };
  }, [decorated]);

  // ── Alert Center filters ────────────────────────────────────────────────────
  const [sourceFilter, setSourceFilter] = useState<AlertSource | "all">("all");
  const [severityFilter, setSeverityFilter] = useState<Severity | "all">("all");
  const [ackFilter, setAckFilter] = useState<"all" | "unacked" | "acked">("all");
  const [search, setSearch] = useState("");
  const [rowCap, setRowCap] = useState(CENTER_ROW_STEP);
  useEffect(() => { setRowCap(CENTER_ROW_STEP); }, [sourceFilter, severityFilter, ackFilter, search]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return decorated.filter((a) => {
      if (a.resolved) return false;
      if (sourceFilter !== "all" && a.source !== sourceFilter) return false;
      if (severityFilter !== "all" && a.severity !== severityFilter) return false;
      if (ackFilter === "unacked" && a.acknowledged) return false;
      if (ackFilter === "acked" && !a.acknowledged) return false;
      if (q && !(`${a.title} ${a.message} ${a.group}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [decorated, sourceFilter, severityFilter, ackFilter, search]);

  const visibleRows = useMemo(() => filtered.slice(0, rowCap), [filtered, rowCap]);

  // W3 (việc 2b): chọn hàng trong Alert Center. "Chọn tất cả" = TẤT CẢ đang lọc
  // (kể cả phần chưa hiện do slice) — thanh nổi phân loại theo ngữ nghĩa nguồn.
  const selectedAlerts = useMemo(() => filtered.filter((a) => selected.has(a.key)), [filtered, selected]);
  const selAckable = useMemo(
    () => selectedAlerts.filter((a) => !isResolveOnly(a.source) && !a.acknowledged),
    [selectedAlerts],
  );
  const selResolvable = useMemo(
    () => selectedAlerts.filter((a) => isResolveOnly(a.source)),
    [selectedAlerts],
  );
  const allFilteredSelected = filtered.length > 0 && filtered.every((a) => selected.has(a.key));
  const someFilteredSelected = filtered.some((a) => selected.has(a.key));
  const toggleSelectAll = useCallback(() => {
    setSelected((prev) => {
      if (filtered.length > 0 && filtered.every((a) => prev.has(a.key))) {
        const next = new Set(prev);
        for (const a of filtered) next.delete(a.key);
        return next;
      }
      return new Set([...prev, ...filtered.map((a) => a.key)]);
    });
  }, [filtered]);
  const toggleSelect = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const refreshAll = () => {
    void utils.andon.active.invalidate();
    void utils.predictiveAlert.list.invalidate();
    void utils.interlock.events.invalidate();
    void utils.mqttAlert.unresolved.invalidate();
    void utils.alert.history.invalidate();
  };

  // W3 (việc 7): TV mode chỉ hiện critical/high — panel 10.1" nhìn từ xa.
  const tvGroups = useMemo(
    () => groups.filter((g) => g.severity === "critical" || g.severity === "high"),
    [groups],
  );

  const confirmSources = confirmTarget
    ? [...new Set(confirmTarget.items.map((i) => (i.source === "interlock" ? "Interlock" : "MQTT")))].join("/")
    : "";

  return (
    <DashboardLayout title={t("nav.opsConsole", "Alert Response")} navItems={navItems} currentPath="/ops-console">
      <div
        ref={rootRef}
        className={`space-y-6 p-6 transition-colors ${flash ? "animate-pulse bg-destructive/20" : ""} ${isFs ? "min-h-screen overflow-y-auto bg-background" : ""}`}
      >
        {isFs ? (
          /* ── W3 (việc 7): TV MODE THẬT khi fullscreen ─────────────────────────
             Chỉ nhóm critical/high dạng tile lớn, font clamp theo vh (pattern
             AndonBoard), KHÔNG nút hành động / KHÔNG filter — TV là màn nhìn,
             thao tác làm ở panel. */
          <div className="flex min-h-screen flex-col gap-[1.5vh]">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-border pb-[1vh]">
              <h1 className="text-[clamp(1.1rem,3.2vh,2.4rem)] font-black uppercase tracking-wide">
                {t("nav.opsConsole", "Alert Response")} · TV
              </h1>
              <div className="flex items-center gap-3">
                <span className="text-[clamp(0.9rem,2.6vh,1.8rem)] font-black tabular-nums text-destructive">
                  ▲ {counts.critical}
                </span>
                <span className="text-[clamp(0.9rem,2.6vh,1.8rem)] font-black tabular-nums text-warning">
                  ● {counts.high}
                </span>
                <PollFreshness
                  updatedAt={oldestUpdatedAt}
                  isFetching={anySourceFetching}
                  staleAfterMs={STALE_AFTER_MS}
                />
                {soundOn && audioBlocked && (
                  <Button variant="outline" className="h-11 border-warning text-warning" onClick={unlockAudio}>
                    Chạm để bật còi
                  </Button>
                )}
                <Button variant="outline" className="h-11" onClick={toggleFs}>
                  <Minimize2 className="mr-1 h-4 w-4" /> Thoát TV
                </Button>
              </div>
            </header>

            {pollStale && (
              <div
                role="alert"
                className="flex items-center gap-2 rounded-md border border-warning bg-warning/10 px-3 py-2 text-[clamp(0.85rem,2.2vh,1.4rem)] text-warning"
              >
                <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
                {t("opsConsole.staleData", "Dữ liệu có thể đã cũ — mất kết nối cập nhật")}
              </div>
            )}

            {tvGroups.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-success">
                <CheckCircle2 className="h-[12vh] w-[12vh]" aria-hidden="true" />
                <p className="text-[clamp(1.2rem,4vh,3rem)] font-black">
                  Không có cảnh báo nghiêm trọng
                </p>
              </div>
            ) : (
              <div className="grid flex-1 content-start gap-[1vw] md:grid-cols-2 xl:grid-cols-3">
                {tvGroups.map((g) => (
                  <div
                    key={g.gkey}
                    className={cn(
                      "flex min-h-[18vh] flex-col gap-[0.6vh] rounded-lg border-4 p-[1vw]",
                      // W7 GĐ2 (quyết định b đã duyệt): TV giữ nền ĐẶC — soft-tint
                      // không đọc được từ xa trên TV xưởng.
                      SEVERITY_TILE_SOLID[g.severity],
                      g.severity === "critical" && g.unackedCount > 0 && "animate-pulse",
                      g.overdue && "ring-4 ring-destructive ring-offset-2 ring-offset-background",
                      g.expired && "opacity-50",
                    )}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[clamp(0.85rem,2.2vh,1.6rem)] font-bold uppercase">
                        {g.location}
                      </span>
                      {g.count > 1 && (
                        <span className="shrink-0 text-[clamp(0.85rem,2.2vh,1.6rem)] font-black tabular-nums">
                          ×{g.count}
                        </span>
                      )}
                    </div>
                    <div className="line-clamp-2 text-[clamp(1rem,3vh,2.2rem)] font-black leading-tight">
                      {g.title}
                    </div>
                    <div className="mt-auto flex items-baseline justify-between gap-2 text-[clamp(0.8rem,2vh,1.4rem)] font-semibold opacity-90">
                      <span className="tabular-nums">
                        <AgeLabel raisedAt={g.latest.raisedAt} /> trước
                      </span>
                      {g.overdue
                        ? <span className="font-black">QUÁ HẠN {g.overdueMin}m</span>
                        : g.unackedCount === 0 && <span>ACK</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Header / KPI strip */}
            <PageHeader
              icon={<Activity className="h-6 w-6" />}
              // doc 67 W5 (việc 2) — 1 key/trang: h1 = breadcrumb = menu = nav.opsConsole.
              title={t("nav.opsConsole", "Alert Response")}
              description={t("opsConsole.subtitle", "Unified War-Room + Alert Center — signal only, never controls a machine")}
              actions={
                <>
                  {/* W2 (AUD-01): độ tươi thật của console = nguồn poll CŨ NHẤT. */}
                  <PollFreshness
                    updatedAt={oldestUpdatedAt}
                    isFetching={anySourceFetching}
                    staleAfterMs={STALE_AFTER_MS}
                  />
                  {/* W3 (việc 7): autoplay policy chặn còi tới khi có user-gesture
                      — chip nói thật thay vì beep câm. */}
                  {soundOn && audioBlocked && (
                    <Button variant="outline" size="sm" className="h-11 border-warning text-warning" onClick={unlockAudio}>
                      Chạm để bật còi
                    </Button>
                  )}
                  <Button variant="outline" size="sm" className="h-11" onClick={refreshAll}>
                    <RefreshCw className="mr-1 h-4 w-4" /> {t("common.refresh", "Refresh")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-11 min-w-11"
                    onClick={() => setSoundOn((s) => !s)}
                    aria-label={soundOn ? t("opsConsole.soundOn", "Sound on") : t("opsConsole.soundOff", "Sound off")}
                  >
                    {soundOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                  </Button>
                  <Button variant="outline" size="sm" className="h-11" onClick={toggleFs}>
                    <Maximize2 className="mr-1 h-4 w-4" />
                    {t("opsConsole.tvMode", "TV mode")}
                  </Button>
                </>
              }
            />

            {/* doc 67 W5 (việc 6) — rail 2-chiều từ map tập trung (RelatedViews.tsx). */}
            <RelatedViews pageId="ops-console" />

            {/* doc 68 §3.4 (P2): KPI hero — "Nghiêm trọng" chiếm 2 cột / text-4xl khi
                >0 (câu hỏi số 1 của persona); 3 ô trùng (Cao/Chưa-ack/Đang-mở ~87=87)
                + MTTA gộp thành DẢI PHỤ nhỏ MetricCard size compact. */}
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              <Card
                className={cn(
                  "flex flex-col justify-center",
                  counts.critical > 0
                    ? "border-2 border-destructive xl:col-span-2"
                    : "xl:col-span-1",
                )}
              >
                <CardContent className="p-4">
                  <div className="text-sm text-muted-foreground">
                    {t("opsConsole.kpiCritical", "Critical")}
                  </div>
                  {/* W7 GĐ2: số KPI qua fmtNum chuẩn GĐ1 (tách nghìn theo locale). */}
                  <div
                    className={cn(
                      "font-bold tabular-nums text-destructive",
                      counts.critical > 0 ? "text-4xl" : "text-2xl",
                    )}
                  >
                    {fmtNum(counts.critical)}
                  </div>
                </CardContent>
              </Card>
              <div
                className={cn(
                  "grid grid-cols-2 gap-2",
                  counts.critical > 0 ? "xl:col-span-1" : "xl:col-span-2 sm:grid-cols-4",
                )}
              >
                <MetricCard size="compact" tone="warning" label={t("opsConsole.kpiHigh", "High")} value={fmtNum(counts.high)} />
                <MetricCard size="compact" tone="warning" label={t("opsConsole.kpiUnacked", "Unacknowledged")} value={fmtNum(counts.unacked)} />
                <MetricCard size="compact" label={t("opsConsole.kpiOpen", "Open total")} value={fmtNum(counts.total)} />
                {/* W1: server (andonRouter.metrics) coalesce avg NULL→0 khi CHƯA có ack
                    nào trong 24h — nên 0 là sentinel "chưa có dữ liệu", không phải MTTA
                    0 giây thật → hiển thị "—" thay vì con số gây hiểu nhầm. Nhãn nói rõ
                    phạm vi: chỉ đo sự kiện Andon, không gồm các nguồn cảnh báo khác. */}
                <MetricCard
                  size="compact"
                  label="MTTA Andon (24h)"
                  value={
                    andonMetrics.data == null || !andonMetrics.data.avgMttaSeconds
                      ? "—"
                      : `${fmtNum(andonMetrics.data.avgMttaSeconds)}s`
                  }
                />
              </div>
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
                {groups.length === 0 ? (
                  /* W7 GĐ2 (việc 3): EmptyState allClear chuẩn GĐ1 thay khối Card
                     tự chế — "rỗng" ở war-room là TIN TỐT (ISA-101). */
                  <Card>
                    <CardContent className="py-4">
                      <EmptyState
                        allClear
                        title="Không có cảnh báo đang mở"
                        description="Cả 5 nguồn (Andon, dự báo, interlock, MQTT, ngưỡng) đều yên — hệ thống ổn định."
                      />
                    </CardContent>
                  </Card>
                ) : (
                  <>
                    {/* doc 68 §3.4 (P1): DẢI "CẦN XỬ LÝ TRƯỚC" full-width — nhóm
                        nghiêm-trọng/quá-hạn nhấc lên đầu, không lẫn vào cột vị trí. */}
                    {priorityGroups.length > 0 && (
                      <section className="rounded-lg border-2 border-destructive/60 bg-destructive/5 p-3">
                        <h2 className="mb-2 flex items-center gap-2 text-sm font-black uppercase tracking-wide text-destructive">
                          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                          {t("opsConsole.needsActionFirst", "Cần xử lý trước")} ({priorityGroups.length})
                        </h2>
                        <div className="grid content-start gap-3 md:grid-cols-2 2xl:grid-cols-3">
                          {priorityGroups.map((g) => (
                            <div key={g.gkey}>
                              <div className="mb-1 truncate text-xs font-semibold uppercase text-muted-foreground">
                                {g.location}
                              </div>
                              <AlertGroupCard
                                group={g}
                                pendingKeys={pendingKeys}
                                onAck={handleAck}
                                onRequestResolve={handleRequestResolve}
                                onBulkAck={handleBulkAck}
                                onBulkResolveRequest={handleBulkResolveRequest}
                                onOpenDetail={setDetailGroup}
                              />
                            </div>
                          ))}
                        </div>
                      </section>
                    )}

                    {/* doc 68 §3.4 (P1): lưới vị trí — 1280 nhận 2 CỘT (hết vỡ chữ),
                        content-start để cột ngắn không kéo giãn. */}
                    {warRoom.length > 0 && (
                  <div className="grid content-start gap-4 grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3">
                    {warRoom.map(([location, locGroups]) => {
                      const expanded = expandedLocs.has(location);
                      const shown = expanded ? locGroups : locGroups.slice(0, WARROOM_GROUP_CAP);
                      const hidden = locGroups.length - shown.length;
                      const totalRecords = locGroups.reduce((s, g) => s + g.count, 0);
                      return (
                        <Card key={location} className="overflow-hidden">
                          <CardHeader className="py-3">
                            <CardTitle className="flex items-center justify-between text-base">
                              <span>{location}</span>
                              <Badge variant="secondary">{totalRecords}</Badge>
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-2">
                            {shown.map((g) => (
                              <AlertGroupCard
                                key={g.gkey}
                                group={g}
                                pendingKeys={pendingKeys}
                                onAck={handleAck}
                                onRequestResolve={handleRequestResolve}
                                onBulkAck={handleBulkAck}
                                onBulkResolveRequest={handleBulkResolveRequest}
                                onOpenDetail={setDetailGroup}
                              />
                            ))}
                            {(hidden > 0 || expanded) && (
                              <Button
                                variant="ghost"
                                className="h-11 w-full"
                                onClick={() => setExpandedLocs((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(location)) next.delete(location); else next.add(location);
                                  return next;
                                })}
                              >
                                {expanded ? "Thu gọn" : `Hiện thêm (${hidden})`}
                              </Button>
                            )}
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                    )}
                  </>
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
                    {/* Task 6 (Wave 4) — công tắc "cảnh báo vừa đóng" (EXPIRED), MẶC ĐỊNH
                        TẮT để không làm ồn danh sách đang mở. */}
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        className="size-5"
                        checked={showRecentlyClosed}
                        onCheckedChange={(v) => setShowRecentlyClosed(v === true)}
                      />
                      {t("alerts.showRecentlyClosed", "Hiện cảnh báo vừa đóng")}
                    </label>
                    <span className="ml-auto text-sm text-muted-foreground">
                      {t("opsConsole.showing", "Showing {{n}}", { n: filtered.length })}
                      {showRecentlyClosed && closedRows.length > 0 && (
                        <> · +{closedRows.length} {t("alerts.closedBadge", "đã đóng")}</>
                      )}
                    </span>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="pt-6">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {/* W3 (việc 2b): chọn tất cả ĐANG LỌC (kể cả phần chưa hiện). */}
                          <TableHead className="w-12">
                            <Checkbox
                              className="size-5"
                              checked={allFilteredSelected ? true : someFilteredSelected ? "indeterminate" : false}
                              onCheckedChange={toggleSelectAll}
                              aria-label="Chọn tất cả đang lọc"
                            />
                          </TableHead>
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
                        {/* Task 6 (Wave 4) — khi công tắc bật và có dòng vừa đóng để hiện,
                            đừng nói "không có cảnh báo" (đang có, chỉ là ở phần đã đóng bên
                            dưới). */}
                        {filtered.length === 0 && closedRows.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                              {t("opsConsole.noAlerts", "No alerts match the filters")}
                            </TableCell>
                          </TableRow>
                        )}
                        {visibleRows.map((a) => (
                          <TableRow key={a.key} className={cn(a.expired && "opacity-50")}>
                            <TableCell>
                              <Checkbox
                                className="size-5"
                                checked={selected.has(a.key)}
                                onCheckedChange={() => toggleSelect(a.key)}
                                aria-label={`Chọn ${a.title}`}
                              />
                            </TableCell>
                            <TableCell>
                              <span className="flex items-center gap-2">
                                <span className={`inline-block h-3 w-3 rounded-full ${SEVERITY_DOT[a.severity]}`} />
                                <span className="capitalize">{a.severity}</span>
                              </span>
                              {/* Task 7 (Wave 3 §4.5/§6) — dải tin cậy + số lần tái diễn CẠNH
                                  mức độ (không giấu trong chi tiết): sau gộp, 52→6 ACTIVE, và
                                  số-lần-tái-diễn là bằng chứng hệ vẫn hoạt động. CHỈ nguồn
                                  predictive mang confidenceScore/occurrenceCount. */}
                              {a.source === "predictive" && (() => {
                                const band = confidenceBand(a.confidenceScore);
                                const label =
                                  band === "high" ? t("alerts.confidenceHigh", "bằng chứng vững ({{n}}%)", { n: a.confidenceScore }) :
                                  band === "medium" ? t("alerts.confidenceMedium", "bằng chứng khá ({{n}}%)", { n: a.confidenceScore }) :
                                  band === "low" ? t("alerts.confidenceLow", "bằng chứng vừa đủ ({{n}}%)", { n: a.confidenceScore }) :
                                  t("alerts.confidenceUnknown", "chưa rõ độ tin cậy");
                                // occurrenceCount có thể VẮNG (migration 0308 chưa chạy) → coi
                                // như 1 và không hiện badge — tuyệt đối không lọt NaN/undefined.
                                const times = Number(a.occurrenceCount ?? 1);
                                return (
                                  <div className="mt-1 flex flex-wrap items-center gap-1">
                                    <span className="text-xs text-muted-foreground">{label}</span>
                                    {Number.isFinite(times) && times > 1 && (
                                      <Badge variant="secondary" className="text-xs font-normal">
                                        {t("alerts.recurrence", "đã tái diễn {{n}} lần", { n: times })}
                                      </Badge>
                                    )}
                                  </div>
                                );
                              })()}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="gap-1">
                                {SOURCE_ICON[a.source]} {a.source}
                              </Badge>
                            </TableCell>
                            <TableCell className="max-w-[280px]">
                              {/* doc 68 §3.4 (P1): bấm tiêu đề → ContextDrawer chi tiết 1 alert. */}
                              <button
                                type="button"
                                className="block w-full text-left"
                                onClick={() => openAlertDetail(a)}
                              >
                                <div className="truncate font-medium underline-offset-2 hover:underline">{a.title}</div>
                                <div className="truncate text-xs text-muted-foreground">{a.message}</div>
                              </button>
                            </TableCell>
                            <TableCell className="text-sm">{a.group}</TableCell>
                            <TableCell className="text-sm tabular-nums">
                              <AgeLabel raisedAt={a.raisedAt} />
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap items-center gap-1">
                                {a.acknowledged
                                  ? <Badge variant="secondary">{t("opsConsole.acked", "ACK")}</Badge>
                                  : <Badge variant="destructive">{t("opsConsole.open", "Open")}</Badge>}
                                {/* W3 (việc 3): escalation trung thực trên bảng. */}
                                {a.overdue && (
                                  <Badge className="animate-pulse bg-destructive font-bold">QUÁ HẠN {a.overdueMin}m</Badge>
                                )}
                                {a.expired && (
                                  <Badge variant="outline">HẾT HẠN DỰ BÁO</Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                {!isResolveOnly(a.source) && !a.acknowledged && (
                                  <Button size="sm" variant="outline" className="h-11" disabled={pendingKeys.has(a.key)} onClick={() => handleAck(a)}>
                                    Xác nhận
                                  </Button>
                                )}
                                {!isAckOnly(a.source) && (
                                  <Button size="sm" variant="ghost" className="h-11" disabled={pendingKeys.has(a.key)} onClick={() => handleRequestResolve(a)}>
                                    Xử lý xong
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                        {/* Task 6 (Wave 4) — "cảnh báo vừa đóng" (predictive EXPIRED), chỉ hiện
                            khi công tắc bật. Hàng riêng biệt, KHÔNG dùng chung render với hàng
                            đang mở ở trên: mờ hơn (opacity), nhãn "đã đóng" thay ACK/Open, KHÔNG
                            checkbox chọn/nút hành động (đã ở trạng thái cuối, không có mutation
                            nào để gọi ở đây) — không thể nhầm là còn đang mở. */}
                        {showRecentlyClosed && closedRows.length > 0 && (
                          <TableRow className="hover:bg-transparent">
                            <TableCell colSpan={8} className="py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              {t("alerts.showRecentlyClosed", "Hiện cảnh báo vừa đóng")} ({closedRows.length})
                            </TableCell>
                          </TableRow>
                        )}
                        {showRecentlyClosed && closedRows.map((c) => {
                          const reason = closedReasonText(c.resolutionNotes);
                          return (
                            <TableRow key={c.key} className="opacity-60">
                              <TableCell />
                              <TableCell>
                                <span className="flex items-center gap-2">
                                  <span className={`inline-block h-3 w-3 rounded-full ${SEVERITY_DOT[c.severity]}`} />
                                  <span className="capitalize">{c.severity}</span>
                                </span>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className="gap-1">
                                  {SOURCE_ICON.predictive} predictive
                                </Badge>
                              </TableCell>
                              <TableCell className="max-w-[280px]">
                                <div className="truncate font-medium">{c.title}</div>
                                <div className="truncate text-xs text-muted-foreground">{c.message}</div>
                                {/* resolutionNotes có thể rỗng (dòng đóng bằng đường khác) — KHÔNG
                                    hiện dòng lý do khi rỗng, tuyệt đối không "Lý do: undefined". */}
                                {reason && (
                                  <div className="mt-1 truncate text-xs italic text-muted-foreground" title={reason}>
                                    {t("alerts.closedReason", "Lý do: {{reason}}", { reason })}
                                  </div>
                                )}
                              </TableCell>
                              <TableCell className="text-sm">{c.group}</TableCell>
                              <TableCell className="text-sm tabular-nums">
                                <AgeLabel raisedAt={c.closedAt} />
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className="text-muted-foreground">
                                  {t("alerts.closedBadge", "đã đóng")}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right" />
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                    {/* W3 (việc 1/perf): slice tăng dần thay virtualization — không thêm dep npm. */}
                    {filtered.length > rowCap && (
                      <Button
                        variant="ghost"
                        className="mt-2 h-11 w-full"
                        onClick={() => setRowCap((c) => c + CENTER_ROW_STEP)}
                      >
                        Hiện thêm ({filtered.length - rowCap})
                      </Button>
                    )}
                  </CardContent>
                </Card>

                {/* W3 (việc 2b): thanh hành động nổi — phân loại theo ngữ nghĩa
                    nguồn của TỪNG hàng (W1): ack cho andon/predictive/threshold
                    chưa-ack; "Xử lý" (đóng vĩnh viễn, qua confirm) cho interlock/mqtt. */}
                {selectedAlerts.length > 0 && (
                  <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3 shadow-xl">
                    <span className="text-sm font-semibold">Đã chọn {selectedAlerts.length}</span>
                    {selAckable.length > 0 && (
                      <Button
                        className="h-11"
                        disabled={selAckable.some((a) => pendingKeys.has(a.key))}
                        onClick={() => void runBulk(selAckable, "ack", "Xác nhận hàng loạt")}
                      >
                        Xác nhận ({selAckable.length})
                      </Button>
                    )}
                    {selResolvable.length > 0 && (
                      <Button
                        variant="outline"
                        className="h-11"
                        disabled={selResolvable.some((a) => pendingKeys.has(a.key))}
                        onClick={() => setConfirmTarget({ items: selResolvable, label: "các cảnh báo đã chọn" })}
                      >
                        Xử lý ({selResolvable.length})
                      </Button>
                    )}
                    <Button variant="ghost" className="h-11" onClick={() => setSelected(new Set())}>
                      Bỏ chọn
                    </Button>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </>
        )}

        {/* doc 68 §3.4 (P1): ContextDrawer phải — chi tiết nhóm + từng bản ghi +
            hành động cả-nhóm ở ĐÁY drawer (thay Collapsible bung in-place). Dùng
            chung cho nhóm War-Room lẫn 1 alert bấm từ Alert Center. */}
        <ContextDrawer
          open={detailGroup !== null}
          onOpenChange={(open) => { if (!open) setDetailGroup(null); }}
          title={detailGroup?.title ?? ""}
          description={
            detailGroup
              ? `${detailGroup.location} · ${
                  detailGroup.count > 1
                    ? t("opsConsole.nRecords", "{{n}} bản ghi", { n: detailGroup.count })
                    : t("opsConsole.oneRecord", "1 bản ghi")
                }`
              : undefined
          }
        >
          {detailGroup && (
            <div className="flex h-full flex-col gap-3">
              <ul className="space-y-2">
                {detailGroup.items.map((a) => (
                  <li key={a.key} className="rounded-md border p-2 text-sm">
                    <p className="line-clamp-3">{a.message || a.title}</p>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground tabular-nums">
                        <AgeLabel raisedAt={a.raisedAt} /> trước{a.acknowledged && " · ACK"}
                      </span>
                      <div className="flex flex-wrap justify-end gap-1">
                        {!isResolveOnly(a.source) && !a.acknowledged && (
                          <Button size="sm" variant="secondary" className="h-9" disabled={pendingKeys.has(a.key)} onClick={() => handleAck(a)}>
                            Xác nhận
                          </Button>
                        )}
                        {!isAckOnly(a.source) && (
                          <Button size="sm" variant="outline" className="h-9" disabled={pendingKeys.has(a.key)} onClick={() => handleRequestResolve(a)}>
                            Xử lý xong
                          </Button>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>

              {/* Hành động CẢ-NHÓM ở đáy drawer (chỉ khi nhóm >1). */}
              {detailGroup.count > 1 && (
                <div className="mt-auto flex flex-wrap gap-2 border-t pt-3">
                  {isResolveOnly(detailGroup.source) ? (
                    <Button
                      className="h-11 flex-1"
                      variant="outline"
                      disabled={detailGroup.items.some((i) => pendingKeys.has(i.key))}
                      onClick={() => handleBulkResolveRequest(detailGroup)}
                    >
                      Xử lý cả nhóm ({detailGroup.count})
                    </Button>
                  ) : detailGroup.unackedCount > 0 ? (
                    <Button
                      className="h-11 flex-1"
                      disabled={detailGroup.items.some((i) => pendingKeys.has(i.key))}
                      onClick={() => handleBulkAck(detailGroup)}
                    >
                      Xác nhận cả nhóm ({detailGroup.unackedCount})
                    </Button>
                  ) : null}
                </div>
              )}
            </div>
          )}
        </ContextDrawer>

        {/* W1: interlock/MQTT chỉ có mutation RESOLVE (đóng vĩnh viễn, server không
            có ack riêng) → hành động phải qua bước xác nhận tường minh — W3 mở rộng
            cho cả-nhóm/bulk (nhiều id một lượt). */}
        <AlertDialog
          open={confirmTarget !== null}
          onOpenChange={(open) => { if (!open) setConfirmTarget(null); }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Xác nhận xử lý xong?</AlertDialogTitle>
              <AlertDialogDescription>
                {confirmTarget
                  ? confirmTarget.items.length === 1
                    ? `Cảnh báo "${confirmTarget.items[0].title}" (nguồn ${confirmSources}) sẽ bị đóng vĩnh viễn — không thể hoàn tác từ màn hình này.`
                    : `${confirmTarget.items.length} cảnh báo (nguồn ${confirmSources}) — ${confirmTarget.label} — sẽ bị đóng VĨNH VIỄN, không thể hoàn tác từ màn hình này.`
                  : ""}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="h-11">Hủy</AlertDialogCancel>
              <AlertDialogAction
                className="h-11"
                onClick={() => {
                  if (confirmTarget) {
                    const { items, label } = confirmTarget;
                    if (items.length === 1) void actSingle(items[0], "resolve");
                    else void runBulk(items, "resolve", `Xử lý "${label}"`);
                  }
                  setConfirmTarget(null);
                }}
              >
                Xử lý xong{confirmTarget && confirmTarget.items.length > 1 ? ` (${confirmTarget.items.length})` : ""}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </DashboardLayout>
  );
}
