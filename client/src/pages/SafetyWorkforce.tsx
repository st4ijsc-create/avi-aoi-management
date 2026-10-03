/**
 * S1 (doc 16 §8 + §12 design system) — SAFETY & WORKFORCE surface.
 *
 * Read-mostly cockpit over the safetyRouter.
 *
 * ⚠ CRITICAL HONESTY / SAFETY: NOTHING on this page is safety-rated. The safety feed
 *   is an ADVISORY monitoring/logging record — no SIL 2/3 stop, no sub-second
 *   guarantee. Physical safety relies on certified hardware, deferred to a hardware
 *   phase. A persistent chip states this. Mutations open NO device-control path.
 *
 * Doc 81 Đợt 2 Task 8 — mẫu P4 Cockpit (`CockpitLayout`):
 *  - Header một hàng: h1 · chip cờ (4 trạng thái, gọi tên cờ) · "Khi nào dùng" · `StatusChipStrip` (thay 4
 *    MetricCard) · bên phải (không bao giờ bị cắt): chip "Tư vấn — không phải SIS" (thay khối 88 px, popover giữ
 *    nguyên câu cũ + câu chân trang trùng đã bỏ) và chip NGUỒN AN TOÀN có chữ trạng thái — mọi trạng thái
 *    không-OK hiện sẵn, có màu, không nằm trong "+N" · làm mới.
 *  - MAIN (`data-layout-main`) = hàng tab `?tab=` (cockpit | workforce) + nội dung. Tab "Sự kiện an toàn" = luồng
 *    sự kiện (bảng, cuộn trong) + bảng tin trực tiếp (chip "Trực tiếp" trong hàng công cụ). Bảng nhân lực ở lại
 *    tab thứ hai (doc 80/81 muốn dời sang Sản xuất › Ca — trang đó chưa có).
 *  - Panel phụ (aside): panel NGUỒN AN TOÀN đầy đủ (luôn thấy) + tab Xu hướng / Phối hợp. Panel Phối hợp mount
 *    MỘT lần và KHÔNG unmount (Review Focus 3): đổi tab phụ, đổi tab MAIN, qua lại 1024 px.
 *  - Dialog tạo/sửa → sheet (`FlyoutHost`, `?flyout=`): báo cáo tiệm cận, phân công, phân công lại, bắt đầu phối
 *    hợp — form/kiểm tra/payload như cũ. Kiểm định / đóng phân công / huỷ phối hợp giữ AlertDialog (R-2-n).
 *  - < 1024 px: chip an toàn + chip cờ + công cụ tab xuống hàng đầu nội dung tab (header hẹp cắt phần tràn).
 *
 * Flags (read from safety.status):
 *   • SAFETY_AUDIT_ENABLED → recordEvent / auditEvent / ingestProximity
 *   • WORKFORCE_ENABLED    → assignments + collaboration mutations
 * When a flag is OFF the page shows a calm preview chip and surfaces the CONFLICT
 * error gracefully (toast.info, not red) — mirrors FleetOrchestration.
 *
 * RBAC: read → machine_monitoring/canView; mutations → machine_control/canCreate.
 */
import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { useSearch } from "wouter";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { getSharedSocket, releaseSharedSocket } from "@/lib/socketManager";
import DashboardLayout from "@/components/DashboardLayout";
import { ViewOnlyBadge } from "@/components/PermissionGate";
import {
  CockpitLayout,
  FeatureStatusNoticeChip,
  FlyoutHost,
  NoticeChip,
  PageContainer,
  StatusChipStrip,
  chipStateFromQuery,
  useCloseOwnLayer,
  useFlyout,
  useNarrowViewport,
  chartColor, chartTooltipStyle, chartTooltipLabelStyle, chartGridProps, chartAxisTick,
  type FlyoutDefinition,
  type StatusChipItem,
} from "@/components/patterns";
import { type TabbedHubTab } from "@/components/workspace/TabbedHub";
import { resolveActiveTab } from "@/components/workspace/hubState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SheetFooter } from "@/components/ui/sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ResponsiveContainer, AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip,
} from "recharts";
import {
  ShieldAlert, ShieldCheck, RefreshCw, Info, AlertTriangle, Activity, Users, Workflow,
  Bot, User, CheckCircle2, Radio, Send, UserPlus, RefreshCcw,
  Ban, ScanLine, ClipboardCheck, HandMetal, Handshake, ChevronRight, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { mapTrpcError } from "@/lib/trpcErrors";
import { isFeatureDisabledError } from "@/lib/featureFlagError";
import {
  deriveFeatureStatus,
  isFeatureStatusUnsettled,
  type FeatureStatus,
} from "@/components/common/FeatureStatusGate";
import { cn } from "@/lib/utils";
// doc 80 Đợt 1 Task 4 (X-01 · SAF-02) — nhãn nguồn dữ liệu + panel sức khoẻ nguồn an toàn.
import { ProvenanceBadge, ProvenanceSummary } from "@/components/common/ProvenanceBadge";

// ── Typesafe shapes inferred from the safetyRouter output ─────────────────────
type RouterOutputs = inferRouterOutputs<AppRouter>;
type SafetyEvent = RouterOutputs["safety"]["feed"][number];
type TrendBucket = RouterOutputs["safety"]["nearMissTrend"][number];
type BoardStation = RouterOutputs["safety"]["currentBoard"][number];
type Assignment = RouterOutputs["safety"]["listAssignments"][number];
type Collaboration = RouterOutputs["safety"]["listCollaborations"][number];
type SourceHealth = RouterOutputs["safety"]["sourceHealth"];

// Wire shape of the live `safety:event` socket broadcast (server emitSafetyEvent).
type SafetyLiveEvent = {
  id: number;
  eventType: string;
  robotId?: number | null;
  lineId?: number | null;
  stationId?: number | null;
  detectedBy?: string | null;
  outcome: string;
  isNearMiss: boolean;
  createdAt: Date | string;
};

type ProximityInput = { deviceId?: number; stationId?: number; distance: number; confidence: number; source: "vision" | "manual" | "test" };
type StartCollabInput = { operationCode?: string; humanOperatorId?: number; robotDeviceId?: number; taskId?: number };

const EVENT_TYPES = ["estop", "collision", "intrusion", "force_limit", "speed_violation", "near_miss"] as const;
const COLLAB_PHASES = ["human_prep", "robot_work", "human_verify", "done"] as const;
const ASSIGN_STATUSES = ["planned", "active", "completed", "cancelled"] as const;
const FEED_LIMIT = 200;

const TAB_VALUES = ["cockpit", "workforce"] as const;
type TabValue = (typeof TAB_VALUES)[number];
type SideTab = "trend" | "collab";
const BASE_PATH = "/safety-workforce";
const COMPACT_BREAKPOINT_PX = 1280;
const KPI_ALL_BREAKPOINT_PX = 1600;

// ── Colour-by-status badges (mirror the FleetOrchestration discipline) ─────────
function eventTypeBadge(eventType: string, t: (k: string, f: string) => string) {
  const map: Record<string, { cls: string; label: string }> = {
    estop: { cls: "bg-red-600 text-white", label: t("safety.evt.estop", "E-stop") },
    collision: { cls: "bg-red-500 text-white", label: t("safety.evt.collision", "Collision") },
    intrusion: { cls: "bg-orange-500 text-white", label: t("safety.evt.intrusion", "Intrusion") },
    force_limit: { cls: "bg-amber-500 text-white", label: t("safety.evt.force_limit", "Force limit") },
    speed_violation: { cls: "bg-yellow-500 text-black", label: t("safety.evt.speed_violation", "Speed violation") },
    near_miss: { cls: "bg-violet-500 text-white", label: t("safety.evt.near_miss", "Near-miss") },
  };
  const e = map[eventType] ?? { cls: "", label: eventType };
  return e.cls ? <Badge className={e.cls}>{e.label}</Badge> : <Badge variant="outline">{eventType}</Badge>;
}

function outcomeBadge(outcome: string, t: (k: string, f: string) => string) {
  switch (outcome) {
    case "stopped":
      return <Badge className="bg-red-500 text-white">{t("safety.outcome.stopped", "Stopped")}</Badge>;
    case "reduced_speed":
      return <Badge className="bg-amber-500 text-white">{t("safety.outcome.reduced_speed", "Reduced speed")}</Badge>;
    case "manual_override":
      return <Badge className="bg-blue-500 text-white">{t("safety.outcome.manual_override", "Manual override")}</Badge>;
    case "logged_only":
    default:
      return <Badge variant="outline" className="text-muted-foreground">{t("safety.outcome.logged_only", "Logged only")}</Badge>;
  }
}

function detectedByBadge(detectedBy: string | null | undefined, t: (k: string, f: string) => string) {
  if (!detectedBy) return <span className="text-muted-foreground">—</span>;
  return <Badge variant="secondary" className="text-xs">{t(`safety.detectedBy.${detectedBy}`, detectedBy)}</Badge>;
}

function skillBadge(skillLevel: string | null | undefined, t: (k: string, f: string) => string) {
  if (!skillLevel) return null;
  const map: Record<string, string> = {
    trainee: "bg-slate-400 text-white",
    qualified: "bg-emerald-500 text-white",
    expert: "bg-blue-500 text-white",
    trainer: "bg-violet-500 text-white",
  };
  const cls = map[skillLevel] ?? "";
  return cls
    ? <Badge className={`${cls} text-xs`}>{t(`safety.skill.${skillLevel}`, skillLevel)}</Badge>
    : <Badge variant="outline" className="text-xs">{skillLevel}</Badge>;
}

function assignStatusBadge(status: string, t: (k: string, f: string) => string) {
  switch (status) {
    case "active":
      return <Badge className="bg-emerald-500 text-white">{t("safety.assign.active", "Active")}</Badge>;
    case "planned":
      return <Badge className="bg-amber-500 text-white">{t("safety.assign.planned", "Planned")}</Badge>;
    case "completed":
      return <Badge variant="outline" className="text-muted-foreground">{t("safety.assign.completed", "Completed")}</Badge>;
    case "cancelled":
    default:
      return <Badge variant="outline" className="text-muted-foreground">{t("safety.assign.cancelled", "Cancelled")}</Badge>;
  }
}

function handshakeBadge(state: string, t: (k: string, f: string) => string) {
  switch (state) {
    case "ack":
      return <Badge className="bg-blue-500 text-white">{t("safety.handshake.ack", "Acknowledged")}</Badge>;
    case "clear":
      return <Badge className="bg-emerald-500 text-white">{t("safety.handshake.clear", "Zone clear")}</Badge>;
    case "pending":
    default:
      return <Badge className="bg-amber-500 text-white">{t("safety.handshake.pending", "Pending")}</Badge>;
  }
}

function fmtDateTime(d?: string | Date | null): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleString();
}

const isTerminalAssignment = (a: Assignment) => a.status === "completed" || a.status === "cancelled";

type MutationErrorHandler = (e: { data?: { code?: string } | null; message: string }) => void;

// ── Ngữ cảnh trang: nội dung tab (component cấp module, ổn định) đọc từ đây ───────────────────
interface SafetyCtxValue {
  tab: TabValue;
  narrow: boolean;
  canControl: boolean;
  safetyCanControl: boolean;
  safetyControlReason: string | undefined;
  workforceCanControl: boolean;
  workforceControlReason: string | undefined;
  safetyAuditStatus: FeatureStatus;
  workforceStatus: FeatureStatus;
  // events
  feed: SafetyEvent[];
  feedLoading: boolean;
  eventTypeFilter: string;
  setEventTypeFilter: (v: string) => void;
  liveEvents: SafetyLiveEvent[];
  auditPending: boolean;
  setAuditTarget: (e: SafetyEvent) => void;
  // workforce
  board: BoardStation[];
  boardLoading: boolean;
  assignments: Assignment[];
  assignmentsLoading: boolean;
  assignStatusFilter: string;
  setAssignStatusFilter: (v: string) => void;
  confirmPending: boolean;
  confirmAssignment: (a: Assignment) => void;
  setCloseTarget: (a: Assignment) => void;
  // side
  sideTab: SideTab;
  setSideTab: (v: SideTab) => void;
  trend: TrendBucket[];
  collabs: Collaboration[];
  collabsLoading: boolean;
  sourceHealth: SourceHealth | undefined;
  sourceLoading: boolean;
  sourceError: boolean;
  socketConnected: boolean;
  sourcePanelRef: RefObject<HTMLDivElement | null>;
  refetchAll: () => void;
  onMutationError: MutationErrorHandler;
}

const SafetyCtx = createContext<SafetyCtxValue | null>(null);
function useSafetyCtx(): SafetyCtxValue {
  const v = useContext(SafetyCtx);
  if (!v) throw new Error("SafetyCtx missing");
  return v;
}

const TABS: TabbedHubTab[] = [
  { value: "cockpit", labelKey: "safety.tab.cockpit", fallback: "Safety events", icon: <Activity className="h-4 w-4" />, Content: EventsTab },
  { value: "workforce", labelKey: "safety.tab.workforce", fallback: "Workforce board", icon: <Users className="h-4 w-4" />, Content: WorkforceTab },
];

export default function SafetyWorkforce() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canView = hasPermission("machine_monitoring", "canView");
  const canControl = hasPermission("machine_control", "canCreate");
  // U4 (doc 26 §2.4) — hiện-nhưng-khoá: lý do khi thiếu quyền điều khiển máy.
  const permReason = !canControl
    ? t("common.gate.needPerm", "Requires {{perm}} permission", { perm: "machine_control" })
    : undefined;

  const search = useSearch();
  const tab = resolveActiveTab(search, TAB_VALUES, "cockpit") as TabValue;
  // < 1280 px (MAIN hẹp vì sidebar + panel phụ): chip an toàn, chip cờ và công cụ tab xuống hàng đầu nội dung tab
  // (header / hàng tab một dòng sẽ cắt chúng). CockpitLayout tự xếp panel phụ xuống dưới ở < 1024 px.
  const narrow = useNarrowViewport(COMPACT_BREAKPOINT_PX);
  // Đủ chỗ cho cả 4 chip KPI từ 1600 px; hẹp hơn ⇒ 2 chip an toàn hiện thẳng, phần còn lại vào "+N" của
  // StatusChipStrip (chip LỖI luôn được ưu tiên hiện) — không để header cắt mất chip một cách im lặng.
  const kpiAll = !useNarrowViewport(KPI_ALL_BREAKPOINT_PX);
  const [sideTab, setSideTab] = useState<SideTab>("trend");
  const [eventTypeFilter, setEventTypeFilter] = useState<string>("");
  const [assignStatusFilter, setAssignStatusFilter] = useState<string>("");
  const [auditTarget, setAuditTarget] = useState<SafetyEvent | null>(null);
  const [closeTarget, setCloseTarget] = useState<Assignment | null>(null);
  // Live events received over the socket (newest first), kept separate from the feed.
  const [liveEvents, setLiveEvents] = useState<SafetyLiveEvent[]>([]);
  // doc 80 Task 4 (SAF-02/SAF-07) — this browser's socket connection, shown in the source panel.
  const [socketConnected, setSocketConnected] = useState(false);
  const sourcePanelRef = useRef<HTMLDivElement | null>(null);

  const utils = trpc.useUtils();

  // ── Reads ──────────────────────────────────────────────────────────────────
  const statusQ = trpc.safety.status.useQuery(undefined, { enabled: canView });
  const feedQ = trpc.safety.feed.useQuery(
    { eventType: (eventTypeFilter || undefined) as (typeof EVENT_TYPES)[number] | undefined, limit: FEED_LIMIT },
    { enabled: canView },
  );
  const trendQ = trpc.safety.nearMissTrend.useQuery({ sinceDays: 30 }, { enabled: canView });
  const boardQ = trpc.safety.currentBoard.useQuery(undefined, { enabled: canView });
  const assignmentsQ = trpc.safety.listAssignments.useQuery(
    { status: (assignStatusFilter || undefined) as (typeof ASSIGN_STATUSES)[number] | undefined, limit: 200 },
    { enabled: canView },
  );
  const collabsQ = trpc.safety.listCollaborations.useQuery({ limit: 100 }, { enabled: canView });
  // doc 80 Task 4 (SAF-02) — read-only source health; design §6.3 "panel reflects reality ≤5 s".
  const sourceHealthQ = trpc.safety.sourceHealth.useQuery(undefined, { enabled: canView, refetchInterval: 5000 });

  const feed = (feedQ.data ?? []) as SafetyEvent[];
  const trend = (trendQ.data ?? []) as TrendBucket[];
  const board = (boardQ.data ?? []) as BoardStation[];
  const assignments = (assignmentsQ.data ?? []) as Assignment[];
  const collabs = (collabsQ.data ?? []) as Collaboration[];

  // Flag state — honest preview chips. Doc 80 Task 1 (PLT-02/G-07/X-07): pending/erroring
  // status query is UNKNOWN, not "on" — no more `?? true` optimistic default. The router
  // exposes two independent flags here (safetyAudit / workforce) off the SAME statusQ.
  const safetyAuditStatus = deriveFeatureStatus(statusQ, (d: { safetyAudit?: boolean }) => d.safetyAudit);
  const safetyAuditUnsettled = isFeatureStatusUnsettled(safetyAuditStatus);
  const workforceStatus = deriveFeatureStatus(statusQ, (d: { workforce?: boolean }) => d.workforce);
  const workforceUnsettled = isFeatureStatusUnsettled(workforceStatus);
  const safetyControlReason = permReason
    ?? (safetyAuditUnsettled ? t("common.gate.checkingStatus", "Checking feature status…") : undefined);
  const safetyCanControl = canControl && !safetyAuditUnsettled;
  const workforceControlReason = permReason
    ?? (workforceUnsettled ? t("common.gate.checkingStatus", "Checking feature status…") : undefined);
  const workforceCanControl = canControl && !workforceUnsettled;

  const refetchAll = () => {
    void utils.safety.status.invalidate();
    void utils.safety.feed.invalidate();
    void utils.safety.nearMissTrend.invalidate();
    void utils.safety.currentBoard.invalidate();
    void utils.safety.listAssignments.invalidate();
    void utils.safety.listCollaborations.invalidate();
    void utils.safety.sourceHealth.invalidate();
  };

  // ── LIVE socket: listen to `safety:event` advisory broadcasts ────────────────
  useEffect(() => {
    if (!canView) return;
    const socket = getSharedSocket();
    const join = () => { setSocketConnected(true); socket.emit("subscribe", {}); };
    const onDisconnect = () => setSocketConnected(false);
    const onSafety = (event: SafetyLiveEvent) => {
      setLiveEvents((prev) => [event, ...prev].slice(0, 50));
      // Pull the canonical row into the feed/KPIs too.
      void utils.safety.feed.invalidate();
      void utils.safety.nearMissTrend.invalidate();
    };
    socket.on("connect", join);
    socket.on("disconnect", onDisconnect);
    socket.on("safety:event", onSafety);
    if (socket.connected) join();
    return () => {
      socket.off("connect", join);
      socket.off("disconnect", onDisconnect);
      socket.off("safety:event", onSafety);
      releaseSharedSocket();
    };
  }, [canView, utils]);

  // ── Mutation error handler — flag-off CONFLICT → calm info (not red) ─────────
  const onMutationError: MutationErrorHandler = (e) => {
    if (isFeatureDisabledError(e)) {
      if (/workforce/i.test(e.message)) {
        toast.info(t("workforce.flagOffToast", "Workforce is disabled (preview). Set WORKFORCE_ENABLED=true to act."));
        void utils.safety.status.invalidate();
      } else {
        toast.info(t("safety.flagOffToast", "Safety audit is disabled (preview). Set SAFETY_AUDIT_ENABLED=true to act."));
        void utils.safety.status.invalidate();
      }
    } else if (e.data?.code === "CONFLICT") {
      // Non-flag CONFLICT (e.g. double-booking) — still calm, but informative.
      toast.info(mapTrpcError(e));
    } else {
      toast.error(mapTrpcError(e));
    }
  };

  // ── Mutations (toast + làm mới ở cấp TRANG: vẫn chạy nếu sheet đã đóng giữa chừng) ─────────
  // Ghi chú R-2-n: mỗi mutation một mục tiêu mỗi lần bấm/xác nhận, payload như trang cũ.
  // signalHandshake / advancePhase / abortCollaboration nằm trong panel Phối hợp (không bao giờ unmount).
  const auditM = trpc.safety.auditEvent.useMutation({
    onSuccess: () => { toast.success(t("safety.audited", "Event audited")); setAuditTarget(null); refetchAll(); },
    onError: onMutationError,
  });
  const ingestM = trpc.safety.ingestProximity.useMutation({
    onSuccess: (r) => {
      if (r && "triggered" in r && r.triggered) {
        // SAF-01 — this form always sends source:"test" (see ProximityForm.submit
        // below), and the server never raises an Andon for a test-sourced trigger.
        toast.success(t("safety.proximityTriggered", "Near-miss recorded (source 'test') — TEST ONLY, no Andon raised, no device command issued"));
      } else {
        toast.info(t("safety.proximityNoop", "Above margin / low confidence — no near-miss recorded (advisory)"));
      }
      refetchAll();
    },
    onError: onMutationError,
  });
  const assignM = trpc.safety.assignOperator.useMutation({
    onSuccess: () => { toast.success(t("workforce.assigned", "Operator assigned")); refetchAll(); },
    onError: onMutationError,
  });
  const reassignM = trpc.safety.reassignOperator.useMutation({
    onSuccess: () => { toast.success(t("workforce.reassigned", "Assignment updated")); refetchAll(); },
    onError: onMutationError,
  });
  const confirmM = trpc.safety.confirmAssignment.useMutation({
    onSuccess: () => { toast.success(t("workforce.confirmed", "Assignment confirmed")); refetchAll(); },
    onError: onMutationError,
  });
  const closeM = trpc.safety.closeAssignment.useMutation({
    onSuccess: () => { toast.success(t("workforce.closed", "Assignment closed")); setCloseTarget(null); refetchAll(); },
    onError: onMutationError,
  });
  const startCollabM = trpc.safety.startCollaboration.useMutation({
    onSuccess: () => { toast.success(t("workforce.collabStarted", "Collaboration started")); refetchAll(); },
    onError: onMutationError,
  });

  // ── Derived KPIs ─────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const openSafetyEvents = feed.filter((e) => e.auditedAt == null).length;
    const todayKey = new Date().toISOString().slice(0, 10);
    const nearMissesToday = trend.find((b) => b.day === todayKey)?.count ?? 0;
    const activeAssignments = assignments.filter((a) => a.status === "active").length;
    const activeCollaborations = collabs.filter((c) => c.phase !== "done" && c.endedAt == null).length;
    return { openSafetyEvents, nearMissesToday, activeAssignments, activeCollaborations };
  }, [feed, trend, assignments, collabs]);

  if (!canView) {
    return (
      <DashboardLayout>
        <div className="p-6">
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              <AlertTriangle className="mx-auto mb-2 h-6 w-6" />
              {t("safety.noPermission", "You do not have permission to view safety & workforce.")}
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  // ── Flyouts (một stack sheet phải; URL `?flyout=&flyoutId=` là nguồn sự thật) ──
  // Chỉ đăng ký khi có quyền điều khiển (nút cũ không có/khóa khi thiếu quyền). Nút cũ khóa khi cờ CHƯA RÕ
  // (đang kiểm tra / lỗi) ⇒ deep link cũng vậy: sheet chỉ báo trạng thái, không có form. Cờ TẮT (đã rõ) ⇒ form như
  // nút cũ (server trả CONFLICT ⇒ toast.info êm).
  const unsettledBody = (status: FeatureStatus, errorText: string) =>
    status === "error" ? (
      <p role="alert" className="py-6 text-center text-sm text-destructive">{errorText}</p>
    ) : (
      <p className="py-6 text-center text-sm text-muted-foreground">{t("common.gate.checkingStatus", "Checking feature status…")}</p>
    );
  const findAssignment = (id: string | null) =>
    id != null && /^\d+$/.test(id) ? assignments.find((a) => a.id === Number(id)) ?? null : null;
  const flyouts: Record<string, FlyoutDefinition> = {};
  if (canControl) {
    flyouts["safety-proximity"] = {
      size: "md",
      title: t("safety.proximityTitle", "Report proximity (TEST ONLY — no alert raised)"),
      render: () =>
        safetyAuditUnsettled ? (
          unsettledBody(
            safetyAuditStatus,
            t("safety.auditFlagStatusError", "Could not check whether safety audit is enabled — recording, auditing and proximity ingest are disabled until this is confirmed."),
          )
        ) : (
          <ProximityForm pending={ingestM.isPending} onSubmit={(v, done) => ingestM.mutate(v, { onSuccess: done })} />
        ),
    };
    flyouts["workforce-assign"] = {
      size: "md",
      title: t("workforce.assignTitle", "Assign operator"),
      render: () =>
        workforceUnsettled ? (
          unsettledBody(
            workforceStatus,
            t("workforce.flagStatusError", "Could not check whether workforce is enabled — assignment and collaboration actions are disabled until this is confirmed."),
          )
        ) : (
          <AssignmentForm mode="assign" pending={assignM.isPending} onSubmit={(v, done) => assignM.mutate(v, { onSuccess: done })} />
        ),
    };
    // Nút "Phân công lại" cũ: chỉ khi có quyền, khoá khi phân công đã kết thúc (không theo cờ).
    flyouts["workforce-reassign"] = {
      size: "md",
      title: t("workforce.reassignTitle", "Reassign operator"),
      render: (layer) => {
        const a = findAssignment(layer.id);
        if (!a) {
          return (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {assignmentsQ.isLoading
                ? t("safety.loading", "Loading…")
                : t("workforce.assignmentNotFound", "Assignment #{{id}} is not in the loaded list.", { id: layer.id ?? "" })}
            </p>
          );
        }
        if (isTerminalAssignment(a)) {
          return (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t("workforce.assignmentTerminal", "Assignment #{{id}} is finished — it cannot be reassigned.", { id: a.id })}
            </p>
          );
        }
        return (
          <AssignmentForm
            key={a.id}
            mode="reassign"
            existing={a}
            pending={reassignM.isPending}
            onSubmit={(v, done) => reassignM.mutate({ assignmentId: a.id, ...v }, { onSuccess: done })}
          />
        );
      },
    };
    flyouts["collab-start"] = {
      size: "md",
      title: t("workforce.startCollabTitle", "Start human↔robot collaboration"),
      render: () =>
        workforceUnsettled ? (
          unsettledBody(
            workforceStatus,
            t("workforce.flagStatusError", "Could not check whether workforce is enabled — assignment and collaboration actions are disabled until this is confirmed."),
          )
        ) : (
          <StartCollabForm pending={startCollabM.isPending} onSubmit={(v, done) => startCollabM.mutate(v, { onSuccess: done })} />
        ),
    };
  }

  const chipItems: StatusChipItem[] = [
    {
      id: "open-events",
      label: t("safety.chip.openEvents", "Unaudited"),
      value: kpis.openSafetyEvents,
      // Cửa sổ FEED_LIMIT đầy ⇒ có thể còn sự kiện chưa kiểm định ngoài cửa sổ ⇒ "≥N", không phải N.
      state: chipStateFromQuery(feedQ, (d) => (d as unknown[]).length >= FEED_LIMIT),
      tone: kpis.openSafetyEvents > 0 ? "warning" : "default",
      source: t("safety.chip.src.openEvents", "safety.feed — events without an audit stamp among the latest 200 (type filter applies)"),
    },
    {
      id: "near-miss-today",
      label: t("safety.chip.nearMissToday", "Near-misses today"),
      value: kpis.nearMissesToday,
      state: chipStateFromQuery(trendQ),
      tone: kpis.nearMissesToday > 0 ? "warning" : "success",
      source: t("safety.chip.src.nearMiss", "safety.nearMissTrend — today's (UTC) near-miss count in the 30-day trend"),
    },
    {
      id: "active-assignments",
      label: t("safety.chip.activeAssignments", "Active assignments"),
      value: kpis.activeAssignments,
      state: chipStateFromQuery(assignmentsQ),
      tone: kpis.activeAssignments > 0 ? "success" : "default",
      source: t("safety.chip.src.assignments", "safety.listAssignments — assignments with status 'Active' in the loaded list (status filter applies)"),
    },
    {
      id: "active-collabs",
      label: t("safety.chip.activeCollabs", "Active collaborations"),
      value: kpis.activeCollaborations,
      state: chipStateFromQuery(collabsQ),
      tone: kpis.activeCollaborations > 0 ? "success" : "default",
      source: t("safety.chip.src.collabs", "safety.listCollaborations — sessions not finished (phase not 'done' and no end time)"),
      onClick: () => setSideTab("collab"),
      active: sideTab === "collab",
    },
  ];

  const ctx: SafetyCtxValue = {
    tab,
    narrow,
    canControl,
    safetyCanControl,
    safetyControlReason,
    workforceCanControl,
    workforceControlReason,
    safetyAuditStatus,
    workforceStatus,
    feed,
    feedLoading: feedQ.isLoading,
    eventTypeFilter,
    setEventTypeFilter,
    liveEvents,
    auditPending: auditM.isPending,
    setAuditTarget,
    board,
    boardLoading: boardQ.isLoading,
    assignments,
    assignmentsLoading: assignmentsQ.isLoading,
    assignStatusFilter,
    setAssignStatusFilter,
    confirmPending: confirmM.isPending,
    confirmAssignment: (a) => confirmM.mutate({ assignmentId: a.id }),
    setCloseTarget,
    sideTab,
    setSideTab,
    trend,
    collabs,
    collabsLoading: collabsQ.isLoading,
    sourceHealth: sourceHealthQ.data as SourceHealth | undefined,
    sourceLoading: sourceHealthQ.isLoading,
    sourceError: sourceHealthQ.isError,
    socketConnected,
    sourcePanelRef,
    refetchAll,
    onMutationError,
  };

  return (
    <DashboardLayout>
      <FlyoutHost flyouts={flyouts}>
        {/* doc 81 Đợt 2 Task 2 — PageContainer: không đệm kép với <main> của shell. */}
        <PageContainer className="space-y-0">
          <SafetyCtx.Provider value={ctx}>
            <CockpitLayout
              icon={<ShieldAlert />}
              title={
                <span className="flex items-center gap-2">
                  {t("safety.title", "Safety & Workforce")}
                  {!canControl && <ViewOnlyBadge module="machine_control" />}
                </span>
              }
              notices={narrow ? undefined : <FlagChips />}
              chips={
                <>
                  <StatusChipStrip items={chipItems} maxVisible={kpiAll ? 4 : 2} />
                  {/* "Khi nào dùng" đứng SAU dải KPI: header chật thì nó bị cắt trước, không phải số liệu. */}
                  {!narrow && <WhenToUseChip />}
                </>
              }
              actions={
                <>
                  {/* An toàn trước hết: vùng hành động không co (shrink-0) ⇒ hai chip này KHÔNG BAO GIỜ bị cắt ở ≥1024 px. */}
                  {!narrow && <SafetyChips />}
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={refetchAll}
                    title={t("common.refresh", "Refresh")}
                    aria-label={t("common.refresh", "Refresh")}
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </>
              }
              tabs={TABS}
              basePath={BASE_PATH}
              defaultTab="cockpit"
              toolbarEnd={narrow ? undefined : <TabToolbar />}
              side={<SidePanel />}
              sideWidth={kpiAll ? 340 : 300}
              sideLabel={t("safety.side.label", "Safety sources, trend and collaboration")}
              mainName="safety-workforce"
            />
          </SafetyCtx.Provider>
        </PageContainer>

        {/* ── Audit confirm (R-2-n: như cũ — AlertDialog, một sự kiện mỗi lần xác nhận) ── */}
        <AlertDialog open={!!auditTarget} onOpenChange={(o) => !o && setAuditTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("safety.auditConfirmTitle", "Audit this safety event?")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("safety.auditConfirmBody", "Stamps a human PDCA review on the record (who reviewed it, when). Advisory — it does not change any device.")}
                {auditTarget && <span className="mt-1 block font-mono text-xs">#{auditTarget.id} · {auditTarget.eventType}</span>}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={() => auditTarget && auditM.mutate({ eventId: auditTarget.id })}>
                {t("safety.confirmAudit", "Audit event")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* ── Close assignment confirm (R-2-n: như cũ) ── */}
        <AlertDialog open={!!closeTarget} onOpenChange={(o) => !o && setCloseTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("workforce.closeConfirmTitle", "Close this assignment?")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("workforce.closeConfirmBody", "Marks the assignment completed (terminal).")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={() => closeTarget && closeM.mutate({ assignmentId: closeTarget.id })}>
                {t("workforce.confirmClose", "Close assignment")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </FlyoutHost>
    </DashboardLayout>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Header chips
// ══════════════════════════════════════════════════════════════════════════════

/** Chip cờ (4 trạng thái, gọi tên cờ) — vào header (≥1280) hoặc hàng đầu nội dung (<1280). */
function FlagChips() {
  const { t } = useTranslation();
  const ctx = useSafetyCtx();
  return (
    <>
      {/* Flag status — honest 4-state (loading/off/on/error), doc 80 Task 1, as chips. */}
      <FeatureStatusNoticeChip
        status={ctx.safetyAuditStatus}
        subject={t("safety.flag.safetyAudit", "Safety audit")}
        offMessage={t(
          "safety.auditFlagOffBanner",
          "Preview mode: safety audit is disabled. Reads work; recording, auditing and proximity ingest are blocked until it is enabled.",
        )}
        errorMessage={t(
          "safety.auditFlagStatusError",
          "Could not check whether safety audit is enabled — recording, auditing and proximity ingest are disabled until this is confirmed.",
        )}
      />
      <FeatureStatusNoticeChip
        status={ctx.workforceStatus}
        subject={t("safety.flag.workforce", "Workforce")}
        offMessage={t(
          "workforce.flagOffBanner",
          "Preview mode: workforce is disabled. Reads work; assignment and collaboration actions are blocked until it is enabled.",
        )}
        errorMessage={t(
          "workforce.flagStatusError",
          "Could not check whether workforce is enabled — assignment and collaboration actions are disabled until this is confirmed.",
        )}
      />
    </>
  );
}

/** U7 (doc 26 §2.1) — "Khi nào dùng" (khoá riêng của trang) + phụ đề cũ. */
function WhenToUseChip() {
  const { t } = useTranslation();
  return (
      <NoticeChip kind="whenToUse">
        <div className="space-y-2">
          <p data-when-to-use="safety.whenToUse">
            {t("safety.whenToUse", "When to use — monitor safety-relevant events and coordinate mixed human↔robot workforce assignments. Advisory only — not a safety-rated controller.")}
          </p>
          <p className="text-muted-foreground">
            {t("safety.subtitle", "Advisory safety monitoring, mixed-workforce assignments and human↔robot handover coordination.")}
          </p>
        </div>
      </NoticeChip>
  );
}

/** Chip "Tư vấn — không phải SIS" + chip nguồn an toàn — luôn thấy, không bao giờ vào "+N". */
function SafetyChips() {
  const { t } = useTranslation();
  return (
    <>
      {/* PERSISTENT advisory notice (thay khối 88 px) — popover giữ NGUYÊN tiêu đề + câu cũ + câu chân trang. */}
      <NoticeChip
        kind="honesty"
        label={
          <span className="inline-flex items-center gap-1">
            {t("safety.advisoryChip", "Advisory — not a SIS")}
            <Info className="h-3 w-3" aria-hidden="true" />
          </span>
        }
      >
        <div className="space-y-2">
          <p className="font-semibold text-amber-700 dark:text-amber-400">
            {t("safety.advisoryTitle", "Advisory monitoring only — not a safety-rated system")}
          </p>
          <p className="text-muted-foreground">
            {t(
              "safety.advisoryBanner",
              "This surface logs and coordinates safety-relevant observations. It is NOT a SIL 2/3 safety controller and provides NO sub-second stop guarantee. Physical safety relies on certified hardware (Safety PLC / interlocks), deferred to a hardware phase. No action here issues a direct device command.",
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {t(
              "safety.footerNote",
              "All writes on this page are monitoring / logging / coordination state only. Near-miss ingest raises a yellow Andon and PROPOSES (never executes) a speed reduction through the existing gated dispatcher.",
            )}
          </p>
        </div>
      </NoticeChip>
      <SafetySourceChip />
    </>
  );
}

type SegTone = "ok" | "warning" | "error" | "loading";
const SEG_TONE: Record<SegTone, string> = {
  ok: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  warning: "bg-amber-500/20 text-amber-800 dark:text-amber-300",
  error: "bg-destructive/15 text-destructive",
  loading: "bg-muted text-muted-foreground",
};
const CHIP_TONE: Record<SegTone, string> = {
  ok: "border-emerald-500/40",
  warning: "border-amber-500/60",
  error: "border-destructive/60",
  loading: "border-border",
};
const TONE_RANK: Record<SegTone, number> = { error: 0, warning: 1, loading: 2, ok: 3 };

/**
 * Doc 81 Đợt 2 Task 8 — mô hình chip nguồn an toàn. Không bao giờ "đẹp hơn thực tế":
 *  - truy vấn lỗi ⇒ error; chưa có dữ liệu ⇒ loading (không đoán ok);
 *  - chỉ PLC THẬT (real / mixed) là ok; SIM / chưa gán tag / tắt / không cấu hình ⇒ warning; lỗi đọc cấu hình ⇒ error;
 *  - preflight bị tắt (lệnh thật không được kiểm) ⇒ thêm đoạn error;
 *  - lệnh thật bị chặn trong khi PLC thật (vd tag an toàn chất lượng xấu) ⇒ thêm đoạn warning (khi PLC không thật,
 *    đoạn PLC đã nói lý do chặn);
 *  - E-stop bật mà không safety-rated ⇒ thêm đoạn warning.
 */
export function safetySourceChipModel(
  data: SourceHealth | undefined,
  isError: boolean,
  t: (k: string, d: string, o?: Record<string, unknown>) => string,
): { state: SegTone; segs: Array<{ id: string; tone: SegTone; text: string }> } {
  if (isError) return { state: "error", segs: [{ id: "plc", tone: "error", text: t("safety.source.chip.error", "Could not read") }] };
  if (!data) return { state: "loading", segs: [{ id: "plc", tone: "loading", text: t("safety.source.chip.loading", "Checking") }] };
  const basis = data.safetyPlc.basis;
  const plcSeg: { id: string; tone: SegTone; text: string } = (() => {
    switch (basis) {
      case "real": return { id: "plc", tone: "ok", text: t("safety.source.chip.real", "Real PLC") };
      case "mixed": return { id: "plc", tone: "ok", text: t("safety.source.chip.mixed", "Real PLC + SIM") };
      case "sim": return { id: "plc", tone: "warning", text: t("safety.source.chip.sim", "SIM only") };
      case "real_unmapped": return { id: "plc", tone: "warning", text: t("safety.source.chip.realUnmapped", "No tag mapped") };
      case "adapter_off": return { id: "plc", tone: "warning", text: t("safety.source.chip.adapterOff", "Off — no source") };
      case "no_config": return { id: "plc", tone: "warning", text: t("safety.source.chip.noConfig", "No config") };
      case "read_error": return { id: "plc", tone: "error", text: t("safety.source.chip.readError", "Config read error") };
      default: return { id: "plc", tone: "warning", text: String(basis) };
    }
  })();
  const segs = [plcSeg];
  const plcReal = basis === "real" || basis === "mixed";
  for (const k of ["ot", "robot"] as const) {
    const p = data.preflight[k];
    const target = k === "ot" ? t("safety.source.chip.ot", "OT") : t("safety.source.chip.robot", "Robot");
    if (p.realWrites === "unguarded") {
      segs.push({ id: k, tone: "error", text: t("safety.source.chip.unguarded", "{{target}}: preflight off", { target }) });
    } else if (p.realWrites === "blocked" && plcReal) {
      segs.push({ id: k, tone: "warning", text: t("safety.source.chip.blocked", "{{target}}: blocked", { target }) });
    }
  }
  if (data.estop.enabled && !data.estop.rated) {
    segs.push({ id: "estop", tone: "warning", text: t("safety.source.chip.estopNotRated", "E-stop not safety-rated") });
  }
  const state = segs.reduce<SegTone>((w, s) => (TONE_RANK[s.tone] < TONE_RANK[w] ? s.tone : w), "ok");
  return { state, segs };
}

/** Chip nguồn an toàn: chữ trạng thái hiện SẴN; bấm ⇒ cuộn + focus panel nguồn đầy đủ trong panel phụ. */
function SafetySourceChip() {
  const { t } = useTranslation();
  const ctx = useSafetyCtx();
  const model = safetySourceChipModel(ctx.sourceHealth, ctx.sourceError, t);
  const Icon = model.state === "ok" ? ShieldCheck : model.state === "loading" ? Loader2 : ShieldAlert;
  const reveal = () => {
    const el = ctx.sourcePanelRef.current;
    if (!el) return;
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    el.focus({ preventScroll: true });
  };
  return (
    <button
      type="button"
      data-testid="safety-source-chip"
      data-state={model.state}
      onClick={reveal}
      aria-label={`${t("safety.source.chip.label", "Safety sources")}: ${model.segs.map((s) => s.text).join(" · ")}`}
      title={t("safety.source.chip.hint", "Show safety source details in the side panel")}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border bg-card px-1.5 text-xs font-medium",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        CHIP_TONE[model.state],
      )}
    >
      <Icon className={cn("h-3.5 w-3.5 shrink-0", model.state === "loading" && "animate-spin", model.state === "error" ? "text-destructive" : model.state === "warning" ? "text-amber-600" : model.state === "ok" ? "text-emerald-600" : "text-muted-foreground")} aria-hidden="true" />
      <span className="text-muted-foreground" aria-hidden="true">{t("safety.source.title", "Sources")}:</span>
      <span className="inline-flex items-center gap-1" aria-live="polite">
        {model.segs.map((s) => (
          <span key={s.id} data-source-seg={s.id} data-tone={s.tone} className={cn("rounded-full px-1.5 py-0.5", SEG_TONE[s.tone])}>
            {s.text}
          </span>
        ))}
      </span>
    </button>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN — tab row tools + tab contents
// ══════════════════════════════════════════════════════════════════════════════

function TabToolbar() {
  const ctx = useSafetyCtx();
  return ctx.tab === "workforce" ? <WorkforceToolbar /> : <EventsToolbar />;
}

/** <1280 px: chip an toàn + cờ + công cụ tab thành hàng xuống dòng ở đầu nội dung (header hẹp cắt phần tràn). */
function NarrowRows() {
  return (
    <>
      <div data-narrow-safety="" className="flex flex-wrap items-center gap-1 pb-2">
        <SafetyChips />
        <FlagChips />
        <WhenToUseChip />
      </div>
      <div data-narrow-tools="" className="flex flex-wrap items-center gap-2 pb-2">
        <TabToolbar />
      </div>
    </>
  );
}

function EventsToolbar() {
  const { t } = useTranslation();
  const ctx = useSafetyCtx();
  const flyout = useFlyout();
  return (
    <>
      <LiveTickerChip />
      <Select value={ctx.eventTypeFilter || "all"} onValueChange={(v) => ctx.setEventTypeFilter(v === "all" ? "" : v)}>
        <SelectTrigger className="h-8 w-40" aria-label={t("safety.filterType", "Type")}>
          <span className="text-xs text-muted-foreground" aria-hidden="true">{t("safety.filterType", "Type")}:</span>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("safety.all", "All")}</SelectItem>
          {EVENT_TYPES.map((s) => (
            <SelectItem key={s} value={s}>{t(`safety.evt.${s}`, s)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        variant="outline"
        className="h-8"
        disabled={!ctx.safetyCanControl}
        // Tên truy cập = câu cũ đầy đủ ("… CHỈ THỬ — không phát cảnh báo"); chữ nhìn thấy rút gọn + nhãn CHỈ THỬ.
        aria-label={t("safety.reportProximity", "Report proximity (TEST ONLY — no alert raised)")}
        title={ctx.safetyControlReason ?? t("safety.reportProximity", "Report proximity (TEST ONLY — no alert raised)")}
        onClick={() => flyout.open("safety-proximity")}
      >
        <ScanLine className="mr-1 h-4 w-4" />{t("safety.reportProximityShort", "Report proximity")}
        <span className="ml-1 rounded bg-amber-500/20 px-1 text-[10px] font-semibold uppercase text-amber-800 dark:text-amber-300">
          {t("safety.testOnly", "Test only")}
        </span>
      </Button>
    </>
  );
}

/** Bảng tin tư vấn trực tiếp (`safety:event`) — chip trong hàng công cụ, popover giữ nội dung cũ. */
function LiveTickerChip() {
  const { t } = useTranslation();
  const { liveEvents } = useSafetyCtx();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-live-count={liveEvents.length}
          aria-label={`${t("safety.liveTitle", "Live advisory ticker")} (${liveEvents.length})`}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border bg-card px-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Radio className={cn("h-3.5 w-3.5", liveEvents.length > 0 ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />
          {t("safety.liveChip", "Live")}
          <Badge variant="secondary" className="ml-0.5 h-5 px-1.5 text-xs tabular-nums">{liveEvents.length}</Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 text-sm">
        <div className="mb-2 flex items-center gap-2 font-medium">
          <Radio className="h-4 w-4" aria-hidden="true" />
          {t("safety.liveTitle", "Live advisory ticker")}
        </div>
        {liveEvents.length === 0 ? (
          <p className="py-2 text-xs text-muted-foreground">
            {t("safety.liveEmpty", "Waiting for live safety:event broadcasts… (advisory only)")}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {liveEvents.slice(0, 12).map((e, i) => (
              <div key={`${e.id}-${i}`} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs">
                {eventTypeBadge(e.eventType, t)}
                <span className="text-muted-foreground">#{e.id}</span>
                <span className="text-muted-foreground">{fmtDateTime(e.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function EventsTab() {
  const { t } = useTranslation();
  const ctx = useSafetyCtx();
  const { feed, feedLoading } = ctx;
  return (
    <div className="flex min-h-0 flex-col">
      {ctx.narrow && <NarrowRows />}
      {/* Luồng sự kiện an toàn — vùng cao hết khung nhìn còn lại, bảng tự cuộn trong (trang không cao lên theo 200 dòng). */}
      <div className="h-[calc(100dvh-11.5rem)] min-h-[16rem] overflow-auto rounded-md border" aria-label={t("safety.feedTitle", "Safety event feed")} role="region">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead>{t("safety.col.id", "ID")}</TableHead>
              <TableHead>{t("safety.col.type", "Type")}</TableHead>
              <TableHead>{t("safety.col.detectedBy", "Detected by")}</TableHead>
              <TableHead>{t("safety.col.outcome", "Outcome")}</TableHead>
              <TableHead>{t("safety.col.robotStation", "Robot / Station")}</TableHead>
              <TableHead>{t("safety.col.response", "Response")}</TableHead>
              <TableHead>{t("safety.col.when", "When")}</TableHead>
              <TableHead>{t("safety.col.audit", "Audit")}</TableHead>
              <TableHead className="text-right">{t("common.actions", "Actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {feedLoading && (
              <TableRow><TableCell colSpan={9} className="py-8 text-center text-muted-foreground">{t("safety.loading", "Loading…")}</TableCell></TableRow>
            )}
            {!feedLoading && feed.length === 0 && (
              <TableRow><TableCell colSpan={9} className="py-8 text-center text-muted-foreground">{t("safety.feedEmpty", "No safety events recorded. This feed is advisory monitoring only.")}</TableCell></TableRow>
            )}
            {feed.map((e) => (
              <TableRow key={e.id} className={e.isNearMiss ? "bg-violet-500/5" : undefined}>
                <TableCell className="font-mono text-xs">#{e.id}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    {eventTypeBadge(e.eventType, t)}
                    {e.isNearMiss && <Badge variant="outline" className="text-[10px]">{t("safety.nearMissTag", "near-miss")}</Badge>}
                  </div>
                </TableCell>
                <TableCell>{detectedByBadge(e.detectedBy, t)}</TableCell>
                <TableCell>{outcomeBadge(e.outcome, t)}</TableCell>
                <TableCell className="text-xs">
                  <span className="inline-flex items-center gap-2">
                    {e.robotId != null ? <span className="inline-flex items-center gap-1"><Bot className="h-3 w-3" />#{e.robotId}</span> : <span className="text-muted-foreground">—</span>}
                    {e.stationId != null && <span className="text-muted-foreground">@{e.stationId}</span>}
                  </span>
                </TableCell>
                <TableCell className="text-xs tabular-nums">{e.responseTimeMs != null ? `${e.responseTimeMs}ms` : "—"}</TableCell>
                <TableCell className="text-xs whitespace-nowrap">{fmtDateTime(e.createdAt)}</TableCell>
                <TableCell className="text-xs">
                  {e.auditedAt != null
                    ? <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" />{t("safety.audited", "Audited")}</span>
                    : <span className="text-muted-foreground">{t("safety.unaudited", "Pending")}</span>}
                </TableCell>
                <TableCell className="text-right">
                  {ctx.canControl && e.auditedAt == null ? (
                    <Button size="sm" variant="ghost" className="h-7" disabled={ctx.auditPending} onClick={() => ctx.setAuditTarget(e)}>
                      <ClipboardCheck className="mr-1 h-3.5 w-3.5" />{t("safety.audit", "Audit")}
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function WorkforceToolbar() {
  const { t } = useTranslation();
  const ctx = useSafetyCtx();
  const flyout = useFlyout();
  return (
    <>
      <Select value={ctx.assignStatusFilter || "all"} onValueChange={(v) => ctx.setAssignStatusFilter(v === "all" ? "" : v)}>
        <SelectTrigger className="h-8 w-32" aria-label={t("workforce.col.status", "Status")}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("safety.all", "All")}</SelectItem>
          {ASSIGN_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>{t(`safety.assign.${s}`, s)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        variant="outline"
        className="h-8"
        disabled={!ctx.workforceCanControl}
        title={ctx.workforceControlReason}
        onClick={() => flyout.open("workforce-assign")}
      >
        <UserPlus className="mr-1 h-4 w-4" />{t("workforce.assign", "Assign")}
      </Button>
    </>
  );
}

/**
 * Bảng nhân lực (S1-a). Doc 80 §9 / doc 81 §1.2 muốn dời sang Sản xuất › Ca — trang đó CHƯA CÓ (nhóm Sản xuất
 * không có màn ca), nên bảng ở lại đây, mở thẳng bằng `?tab=workforce`.
 */
function WorkforceTab() {
  const { t } = useTranslation();
  const ctx = useSafetyCtx();
  const flyout = useFlyout();
  const { board, assignments } = ctx;
  return (
    <div className="flex min-h-0 flex-col gap-3">
      {ctx.narrow && <NarrowRows />}
      <ProvenanceSummary rows={assignments} />
      {/* Assignments table */}
      <div className="max-h-[calc(100dvh-11rem)] min-h-[12rem] overflow-auto rounded-md border" role="region" aria-label={t("workforce.assignmentsTitle", "Operator assignments")}>
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead>{t("workforce.col.operator", "Operator")}</TableHead>
              <TableHead>{t("workforce.col.lineStation", "Line / Station")}</TableHead>
              <TableHead>{t("workforce.col.skill", "Skill")}</TableHead>
              <TableHead>{t("workforce.col.status", "Status")}</TableHead>
              <TableHead>{t("workforce.col.window", "Window")}</TableHead>
              <TableHead className="text-right">{t("common.actions", "Actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ctx.assignmentsLoading && (
              <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">{t("safety.loading", "Loading…")}</TableCell></TableRow>
            )}
            {!ctx.assignmentsLoading && assignments.length === 0 && (
              <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">{t("workforce.assignmentsEmpty", "No operator assignments yet.")}</TableCell></TableRow>
            )}
            {assignments.map((a) => {
              const terminal = isTerminalAssignment(a);
              return (
                <TableRow key={a.id}>
                  <TableCell className="text-xs">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-flex items-center gap-1"><User className="h-3 w-3" />#{a.operatorId}</span>
                      <ProvenanceBadge row={a} />
                    </span>
                  </TableCell>
                  <TableCell className="text-xs">
                    {a.lineId != null ? `L${a.lineId}` : "—"}{" / "}{a.stationId != null ? `S${a.stationId}` : "—"}
                  </TableCell>
                  <TableCell>{skillBadge(a.skillLevel, t) ?? <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                  <TableCell>{assignStatusBadge(a.status, t)}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{fmtDateTime(a.assignedStart)} → {fmtDateTime(a.assignedEnd)}</TableCell>
                  <TableCell className="text-right">
                    {ctx.canControl ? (
                      <div className="flex justify-end gap-1">
                        {a.status === "planned" && (
                          <Button size="sm" variant="ghost" className="h-7" disabled={ctx.confirmPending} onClick={() => ctx.confirmAssignment(a)}>
                            <CheckCircle2 className="mr-1 h-3.5 w-3.5" />{t("workforce.confirm", "Confirm")}
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" className="h-7" disabled={terminal} onClick={() => flyout.open("workforce-reassign", { id: a.id })}>
                          <RefreshCcw className="mr-1 h-3.5 w-3.5" />{t("workforce.reassign", "Reassign")}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7" disabled={terminal} onClick={() => ctx.setCloseTarget(a)}>
                          <Ban className="mr-1 h-3.5 w-3.5 text-muted-foreground" />{t("workforce.close", "Close")}
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">{t("safety.viewOnly", "View only")}</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Current board — humans + robots per station */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" />
            {t("workforce.boardTitle", "Current board — who & which robot is at each station now")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {ctx.boardLoading && <p className="py-6 text-center text-sm text-muted-foreground">{t("safety.loading", "Loading…")}</p>}
          {!ctx.boardLoading && board.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t("workforce.boardEmpty", "No active assignments or enabled robots to show on the board.")}
            </p>
          )}
          {/* Bảng hiện trường có thể rất dài (mọi robot đang bật) — cuộn trong, trang không cao theo. */}
          <div className="grid max-h-[60dvh] gap-3 overflow-auto sm:grid-cols-2 lg:grid-cols-3">
            {board.map((st, idx) => (
              <Card key={`${st.stationId ?? "_"}-${st.lineId ?? "_"}-${idx}`} className="border-border/60">
                <CardContent className="space-y-2 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium">
                      {st.stationId != null ? t("workforce.station", "Station") + ` ${st.stationId}` : t("workforce.unassignedStation", "Unassigned")}
                    </div>
                    {st.lineId != null && <Badge variant="outline" className="text-xs">{t("workforce.line", "Line")} {st.lineId}</Badge>}
                  </div>
                  {/* Humans */}
                  <div className="space-y-1">
                    {st.humans.length === 0 && <div className="text-xs text-muted-foreground">{t("workforce.noHumans", "No humans")}</div>}
                    {st.humans.map((h) => (
                      <div key={`h-${h.assignmentId}`} className="flex items-center justify-between gap-2 text-xs">
                        <span className="inline-flex items-center gap-1"><User className="h-3 w-3 text-blue-500" />{t("workforce.operator", "Operator")} #{h.operatorId}</span>
                        {skillBadge(h.skillLevel, t)}
                      </div>
                    ))}
                  </div>
                  {/* Robots */}
                  <div className="space-y-1 border-t border-border/60 pt-1">
                    {st.robots.length === 0 && <div className="text-xs text-muted-foreground">{t("workforce.noRobots", "No robots")}</div>}
                    {st.robots.map((r) => (
                      <div key={`r-${r.robotId}`} className="flex items-center justify-between gap-2 text-xs">
                        <span className="inline-flex items-center gap-1"><Bot className="h-3 w-3 text-violet-500" />{r.code}</span>
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <span>{r.status}</span>
                          <Badge variant="secondary" className="text-[10px]">{r.openTaskCount} {t("workforce.openTasks", "tasks")}</Badge>
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Side panel — safety source panel (always visible) + Trend / Collaboration tabs
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Panel phụ. Cây con ở CÙNG vị trí ở cả hai phía mốc 1024 px (CockpitLayout chỉ đổi lớp của `<aside>`), và tab
 * Phối hợp `forceMount` + `hidden` ⇒ panel Phối hợp mount MỘT lần lúc nạp và không bao giờ unmount (Review
 * Focus 3: thao tác chuyển pha / bắt tay đang chạy không bị huỷ khi người dùng xem chỗ khác).
 */
function SidePanel() {
  const { t } = useTranslation();
  const ctx = useSafetyCtx();
  return (
    <div className="flex max-h-[calc(100dvh-8rem)] min-h-0 flex-col gap-3 overflow-auto">
      {/* ── doc 80 Task 4 (SAF-02) — safety SOURCE panel (read-only, safety.sourceHealth), đủ nội dung ── */}
      <SafetySourcePanel
        panelRef={ctx.sourcePanelRef}
        data={ctx.sourceHealth}
        isLoading={ctx.sourceLoading}
        isError={ctx.sourceError}
        socketConnected={ctx.socketConnected}
      />
      <Tabs value={ctx.sideTab} onValueChange={(v) => ctx.setSideTab(v as SideTab)} className="gap-2">
        <TabsList className="w-full">
          <TabsTrigger value="trend" className="flex-1 text-xs"><ScanLine className="mr-1 h-3.5 w-3.5" />{t("safety.side.trend", "Trend")}</TabsTrigger>
          <TabsTrigger value="collab" className="flex-1 text-xs"><Workflow className="mr-1 h-3.5 w-3.5" />{t("safety.tab.collaboration", "Collaboration")}</TabsTrigger>
        </TabsList>
        <TabsContent value="trend">
          {/* Near-miss PDCA trend */}
          <div className="text-sm font-medium">{t("safety.trendTitle", "Near-miss trend (PDCA, last 30 days)")}</div>
          <div className="mt-2 h-48">
            {ctx.trend.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={ctx.trend}>
                  <CartesianGrid {...chartGridProps} className="opacity-30" />
                  <XAxis dataKey="day" tick={chartAxisTick} />
                  <YAxis width={28} allowDecimals={false} tick={chartAxisTick} />
                  <Tooltip contentStyle={chartTooltipStyle} labelStyle={chartTooltipLabelStyle} />
                  <Area type="monotone" dataKey="count" name={t("safety.nearMissCount", "Near-misses")} stroke={chartColor(0)} fill={chartColor(0)} fillOpacity={0.2} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                {t("safety.trendEmpty", "No near-misses recorded in the window.")}
              </div>
            )}
          </div>
        </TabsContent>
        <TabsContent value="collab" forceMount hidden={ctx.sideTab !== "collab"}>
          <CollaborationPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * Phiên bàn giao người↔robot (S1-a) với chỉ báo pha human_prep → robot_work → human_verify → done.
 * Sở hữu các mutation điều phối (bắt tay / chuyển pha / huỷ) — instance sống suốt trang (xem SidePanel).
 */
function CollaborationPanel() {
  const { t } = useTranslation();
  const ctx = useSafetyCtx();
  const flyout = useFlyout();
  const [abortTarget, setAbortTarget] = useState<Collaboration | null>(null);
  // Cùng hàm xử lý lỗi của trang (flag-off ⇒ toast.info êm; khác ⇒ mapTrpcError) — truyền qua ngữ cảnh.
  const { onMutationError } = ctx;
  const signalM = trpc.safety.signalHandshake.useMutation({
    onSuccess: () => { toast.success(t("workforce.handshakeSignalled", "Handshake signalled")); ctx.refetchAll(); },
    onError: onMutationError,
  });
  const advanceM = trpc.safety.advancePhase.useMutation({
    onSuccess: () => { toast.success(t("workforce.phaseAdvanced", "Phase advanced")); ctx.refetchAll(); },
    onError: onMutationError,
  });
  const abortM = trpc.safety.abortCollaboration.useMutation({
    onSuccess: () => { toast.success(t("workforce.collabAborted", "Collaboration aborted")); setAbortTarget(null); ctx.refetchAll(); },
    onError: onMutationError,
  });
  const { collabs } = ctx;
  return (
    <div data-collab-panel="" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
          <Handshake className="h-4 w-4 shrink-0" />
          <span className="truncate">{t("workforce.collabTitle", "Human↔robot handover sessions")}</span>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 shrink-0 text-xs"
          disabled={!ctx.workforceCanControl}
          title={ctx.workforceControlReason}
          onClick={() => flyout.open("collab-start")}
        >
          <HandMetal className="mr-1 h-3.5 w-3.5" />{t("workforce.startCollab", "Start collaboration")}
        </Button>
      </div>
      {ctx.collabsLoading && <p className="py-6 text-center text-sm text-muted-foreground">{t("safety.loading", "Loading…")}</p>}
      {!ctx.collabsLoading && collabs.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t("workforce.collabEmpty", "No collaboration sessions. Handover coordination is advisory only — no device command is issued.")}
        </p>
      )}
      <div className="grid gap-2">
        {collabs.map((c) => {
          const terminal = c.phase === "done" || c.endedAt != null;
          return (
            <Card key={c.id} data-collab-session={c.id} className="border-border/60">
              <CardContent className="space-y-3 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium">
                      {t("workforce.session", "Session")} #{c.id}
                      {c.operationCode && <span className="ml-1 font-mono text-xs text-muted-foreground">{c.operationCode}</span>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {c.humanOperatorId != null && <span className="mr-2 inline-flex items-center gap-1"><User className="h-3 w-3" />#{c.humanOperatorId}</span>}
                      {c.robotDeviceId != null && <span className="inline-flex items-center gap-1"><Bot className="h-3 w-3" />#{c.robotDeviceId}</span>}
                    </div>
                  </div>
                  {handshakeBadge(c.handshakeState, t)}
                </div>

                {/* Phase indicator: human_prep → robot_work → human_verify → done */}
                <div className="flex flex-wrap items-center gap-1">
                  {COLLAB_PHASES.map((p, i) => {
                    const reached = COLLAB_PHASES.indexOf(c.phase as (typeof COLLAB_PHASES)[number]) >= i;
                    const current = c.phase === p;
                    return (
                      <div key={p} className="flex items-center gap-1">
                        <span
                          data-phase-current={current ? "" : undefined}
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                            current ? "bg-primary text-primary-foreground"
                            : reached ? "bg-emerald-500/15 text-emerald-600"
                            : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {t(`workforce.phase.${p}`, p)}
                        </span>
                        {i < COLLAB_PHASES.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                      </div>
                    );
                  })}
                </div>
                <Progress
                  value={((COLLAB_PHASES.indexOf(c.phase as (typeof COLLAB_PHASES)[number]) + 1) / COLLAB_PHASES.length) * 100}
                />

                {ctx.canControl && !terminal && (
                  <div className="flex flex-wrap gap-1">
                    <Button size="sm" variant="ghost" className="h-7" disabled={signalM.isPending} onClick={() => signalM.mutate({ sessionId: c.id, state: "ack" })}>
                      <Send className="mr-1 h-3.5 w-3.5" />{t("workforce.signalAck", "Ack")}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7" disabled={signalM.isPending} onClick={() => signalM.mutate({ sessionId: c.id, state: "clear" })}>
                      <CheckCircle2 className="mr-1 h-3.5 w-3.5" />{t("workforce.signalClear", "Clear")}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7" disabled={advanceM.isPending} onClick={() => advanceM.mutate({ sessionId: c.id })}>
                      <ChevronRight className="mr-1 h-3.5 w-3.5" />{t("workforce.advance", "Advance phase")}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7" onClick={() => setAbortTarget(c)}>
                      <Ban className="mr-1 h-3.5 w-3.5 text-destructive" />{t("workforce.abort", "Abort")}
                    </Button>
                  </div>
                )}
                {terminal && (
                  <div className="text-xs text-muted-foreground">
                    {t("workforce.collabClosed", "Closed")} · {fmtDateTime(c.endedAt ?? c.updatedAt)}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* ── Abort collaboration confirm (R-2-n: như cũ) ── */}
      <AlertDialog open={!!abortTarget} onOpenChange={(o) => !o && setAbortTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("workforce.abortConfirmTitle", "Abort this collaboration?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("workforce.abortConfirmBody", "Terminally aborts the handover session. Advisory coordination only — no device command is issued.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => abortTarget && abortM.mutate({ sessionId: abortTarget.id })}>
              {t("workforce.confirmAbort", "Abort")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// doc 80 Đợt 1 Task 4 (SAF-02) — SAFETY SOURCE panel. Read-only mirror of safety.sourceHealth:
// what the OT/robot safety preflight actually reads (real PLC / SIM / nothing) and what that
// means for real commands. Never guesses while loading or on error.
// doc 81 Đợt 1C Task 1 (owner decision 2026-09-27): a SIM / unmapped safety PLC never satisfies the
// preflight of a real (commissioned) command — the panel states that rule and shows SAFETY_SIM_ONLY;
// "mixed" is no longer risky (only the real PLC counts) and the three "allowed on SIM" verdicts are gone.
// ══════════════════════════════════════════════════════════════════════════════
const RISKY_BASIS = new Set(["sim", "real_unmapped", "read_error"]);
const RISKY_VERDICT = new Set(["unguarded"]);

function SafetySourcePanel({
  panelRef, data, isLoading, isError, socketConnected,
}: {
  /** Doc 81 Đợt 2 Task 8 — chip nguồn ở header cuộn + focus tới đây. */
  panelRef?: RefObject<HTMLDivElement | null>;
  data: SourceHealth | undefined;
  isLoading: boolean;
  isError: boolean;
  socketConnected: boolean;
}) {
  const { t } = useTranslation();
  const title = <span className="font-semibold text-foreground">{t("safety.source.title", "Sources")}:</span>;
  // Fix round 1 #7 — only a real query ERROR says "could not read"; a pending/disabled query
  // with no data is neutral (never shown as an error, never as a known state).
  if (isError || !data) {
    return (
      <div
        ref={panelRef}
        tabIndex={-1}
        data-testid="safety-source-panel"
        data-loading={isLoading ? "true" : undefined}
        className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs text-muted-foreground ${isError ? "border-destructive/40 bg-destructive/5" : ""}`}
      >
        {title}
        <span>
          {isError
            ? t("safety.source.error", "Could not read safety sources — treat them as unknown.")
            : t("safety.source.loading", "Checking safety sources…")}
        </span>
      </div>
    );
  }

  const plc = data.safetyPlc;
  const plcText = (() => {
    switch (plc.basis) {
      case "sim": {
        // Fix round 1 #4 — an empty script is always all-clear; a script follows a script, not a PLC.
        const detail = plc.simScriptedConfigs > 0
          ? t("safety.source.plc.simScripted", "scripted — OK/BLOCKED follows a script, not a PLC")
          : t("safety.source.plc.simEmpty", "empty script — always OK");
        return `${t("safety.source.plc.sim", "⚠ SIM only — does NOT satisfy the preflight for real commands")} · ${detail}`;
      }
      case "real_unmapped": return t("safety.source.plc.realUnmapped", "⚠ real endpoint but NO safety tag mapped — does NOT satisfy the preflight for real commands");
      case "mixed": return t("safety.source.plc.mixed", "● real + SIM/unmapped (only the real PLC counts)");
      case "real": return t("safety.source.plc.real", "● real PLC");
      case "adapter_off": return t("safety.source.plc.adapterOff", "○ off — no safety source");
      case "no_config": return t("safety.source.plc.noConfig", "○ no enabled config");
      case "read_error": return t("safety.source.plc.readError", "⚠ configs could not be read");
    }
  })();
  const verdictText = (p: SourceHealth["preflight"]["ot"]) => {
    switch (p.realWrites) {
      case "dry_run": return t("safety.source.verdict.dry_run", "dry-run only (control disabled — nothing is written)");
      case "unguarded": return `${t("safety.source.verdict.unguarded", "⚠ preflight disabled — real commands are not checked")} (${p.flag}=false)`;
      case "blocked":
        return p.refusalReason === "SAFETY_SIM_ONLY"
          ? `${t("safety.source.verdict.blockedSimOnly", "real commands blocked — only SIM / unmapped; a commissioned target needs a REAL safety PLC with mapped tags")} (SAFETY_SIM_ONLY)`
          : `${t("safety.source.verdict.blocked", "real commands blocked")} (${p.refusalReason ?? "SAFETY_UNKNOWN"})`;
      case "real_basis": return t("safety.source.verdict.real_basis", "checked against the real safety PLC");
    }
  };
  const onOff = (on: boolean) => (on ? t("safety.source.on", "● on") : t("safety.source.off", "○ off"));
  const estopText = !data.estop.enabled
    ? t("safety.source.off", "○ off")
    : data.estop.rated
      ? t("safety.source.estopRated", "● safety-rated")
      : t("safety.source.estopNotRated", "⚠ on — not safety-rated");
  const socketText = !data.socket.serverUp
    ? t("safety.source.socketServerDown", "○ server socket down")
    : socketConnected
      ? t("safety.source.socketConnected", "● connected")
      : t("safety.source.socketDisconnected", "○ disconnected");
  const plcRisky = RISKY_BASIS.has(plc.basis);

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      data-testid="safety-source-panel"
      className={`space-y-1 rounded-md border px-3 py-2 text-xs ${plcRisky ? "border-amber-500/50 bg-amber-500/10" : "bg-muted/30"}`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {title}
        <span
          data-testid="safety-source-plc"
          data-basis={plc.basis}
          className={plcRisky ? "font-medium text-amber-700 dark:text-amber-400" : undefined}
        >
          {t("safety.source.plcLabel", "Safety PLC")} {plcText}
        </span>
        {plc.configs.map((c) => (
          <Badge
            key={c.code}
            variant="outline"
            data-effective={c.effective}
            className={`font-mono text-[10px] ${c.effective === "real" ? "" : "border-amber-500/50 text-amber-700 dark:text-amber-400"}`}
            title={`${c.backend} → ${c.effective}`}
          >
            {c.code}
          </Badge>
        ))}
        {plc.hiddenConfigs > 0 && (
          <span className="text-muted-foreground">+{plc.hiddenConfigs} {t("safety.source.hiddenConfigs", "outside your scope")}</span>
        )}
      </div>
      <div data-testid="safety-source-rule" className="text-muted-foreground">
        {t("safety.source.rule", "Rule: a commissioned target needs a REAL safety PLC with mapped safety tags — SIM or unmapped configs never satisfy the preflight; a bad-quality safety tag counts as unknown.")}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
        {(["ot", "robot"] as const).map((k) => {
          const p = data.preflight[k];
          return (
            <span
              key={k}
              data-testid={`safety-source-${k}`}
              data-verdict={p.realWrites}
              className={RISKY_VERDICT.has(p.realWrites) ? "text-amber-700 dark:text-amber-400" : undefined}
            >
              {k === "ot" ? t("safety.source.ot", "OT writes") : t("safety.source.robot", "Robot motion")}: {verdictText(p)}
            </span>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
        <span data-testid="safety-source-vision">
          {t("safety.source.vision", "Vision")} {onOff(data.vision.enabled)} · {data.vision.calibrations} {t("safety.source.cameras", "camera(s)")}
        </span>
        <span data-testid="safety-source-zone">
          {t("safety.source.zone", "Zone SW")} {onOff(data.zoneSw.enabled)} · {data.zoneSw.zones} {t("safety.source.zones", "zone(s)")}
        </span>
        <span data-testid="safety-source-estop" title={data.estop.label}>
          {t("safety.source.estop", "E-stop")} {estopText}
        </span>
        <span data-testid="safety-source-socket">
          {t("safety.source.socket", "Socket")} {socketText}
        </span>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Sheets (FlyoutHost) — form, kiểm tra và payload GIỮ NGUYÊN như các Dialog cũ.
// Toast + làm mới nằm ở mutation cấp trang; sheet chỉ tự đóng CHÍNH lớp của nó khi thành công (useCloseOwnLayer).
// ══════════════════════════════════════════════════════════════════════════════
function ProximityForm({
  pending, onSubmit,
}: {
  pending: boolean;
  onSubmit: (v: ProximityInput, done: () => void) => void;
}) {
  const { t } = useTranslation();
  const { layer, done } = useCloseOwnLayer();
  const uid = useId();
  const [deviceId, setDeviceId] = useState("");
  const [stationId, setStationId] = useState("");
  const [distance, setDistance] = useState("150");
  const [confidence, setConfidence] = useState("0.9");

  const dirty = deviceId !== "" || stationId !== "" || distance !== "150" || confidence !== "0.9";
  useEffect(() => { layer.setDirty(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    const dist = Number(distance);
    const conf = Number(confidence);
    if (!Number.isFinite(dist) || dist < 0) {
      toast.error(t("safety.distanceRequired", "Enter a valid distance (mm)."));
      return;
    }
    if (!Number.isFinite(conf) || conf < 0 || conf > 1) {
      toast.error(t("safety.confidenceRequired", "Confidence must be between 0 and 1."));
      return;
    }
    const dev = deviceId ? Number(deviceId) : undefined;
    const st = stationId ? Number(stationId) : undefined;
    onSubmit(
      {
        deviceId: Number.isInteger(dev) && (dev as number) > 0 ? dev : undefined,
        stationId: Number.isInteger(st) && (st as number) > 0 ? st : undefined,
        distance: dist,
        confidence: conf,
        source: "test",
      },
      done,
    );
  };

  return (
    <div className="grid gap-3">
      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-muted-foreground">
        {t("safety.proximityHint", "TEST ONLY — does not raise an Andon alert. Below the configured margin (and at/above min confidence) → records a near_miss tagged source 'test' for the ingest pipeline. It NEVER raises an Andon and NEVER issues a device command.")}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1">
          <Label htmlFor={`${uid}-distance`}>{t("safety.distance", "Distance (mm)")}</Label>
          <Input id={`${uid}-distance`} type="number" min={0} value={distance} placeholder="150" onChange={(e) => setDistance(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${uid}-confidence`}>{t("safety.confidence", "Confidence (0–1)")}</Label>
          <Input id={`${uid}-confidence`} type="number" min={0} max={1} step={0.05} value={confidence} placeholder="0.9" onChange={(e) => setConfidence(e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1">
          <Label htmlFor={`${uid}-device`}>{t("safety.deviceIdOpt", "Robot/device id (optional)")}</Label>
          <Input id={`${uid}-device`} type="number" min={1} value={deviceId} placeholder="e.g. 1" onChange={(e) => setDeviceId(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${uid}-station`}>{t("safety.stationIdOpt", "Station id (optional)")}</Label>
          <Input id={`${uid}-station`} type="number" min={1} value={stationId} placeholder="e.g. 1" onChange={(e) => setStationId(e.target.value)} />
        </div>
      </div>
      <SheetFooter>
        <Button variant="outline" onClick={() => layer.close()}>{t("common.cancel", "Cancel")}</Button>
        <Button onClick={submit} disabled={pending}><ScanLine className="mr-1 h-4 w-4" />{t("safety.ingest", "Ingest (advisory)")}</Button>
      </SheetFooter>
    </div>
  );
}

type AssignmentFormValue = {
  operatorId: number;
  lineId?: number;
  stationId?: number;
  skillLevel?: string;
};

function AssignmentForm({
  mode, existing, pending, onSubmit,
}: {
  mode: "assign" | "reassign";
  existing?: Assignment;
  pending: boolean;
  onSubmit: (v: AssignmentFormValue, done: () => void) => void;
}) {
  const { t } = useTranslation();
  const { layer, done } = useCloseOwnLayer();
  const uid = useId();
  const initial = useMemo(
    () => ({
      operatorId: existing?.operatorId != null ? String(existing.operatorId) : "",
      lineId: existing?.lineId != null ? String(existing.lineId) : "",
      stationId: existing?.stationId != null ? String(existing.stationId) : "",
      skillLevel: existing?.skillLevel ?? "",
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [operatorId, setOperatorId] = useState(initial.operatorId);
  const [lineId, setLineId] = useState(initial.lineId);
  const [stationId, setStationId] = useState(initial.stationId);
  const [skillLevel, setSkillLevel] = useState(initial.skillLevel);

  const dirty = operatorId !== initial.operatorId || lineId !== initial.lineId || stationId !== initial.stationId || skillLevel !== initial.skillLevel;
  useEffect(() => { layer.setDirty(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    const op = Number(operatorId);
    if (!Number.isInteger(op) || op <= 0) {
      toast.error(t("workforce.operatorIdRequired", "Enter a valid operator (user) id."));
      return;
    }
    const ln = lineId ? Number(lineId) : undefined;
    const st = stationId ? Number(stationId) : undefined;
    onSubmit(
      {
        operatorId: op,
        lineId: Number.isInteger(ln) && (ln as number) > 0 ? ln : undefined,
        stationId: Number.isInteger(st) && (st as number) > 0 ? st : undefined,
        skillLevel: skillLevel.trim() || undefined,
      },
      done,
    );
  };

  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <Label htmlFor={`${uid}-operator`}>{t("workforce.operatorId", "Operator (user) id")}</Label>
        <Input id={`${uid}-operator`} type="number" min={1} value={operatorId} placeholder="e.g. 1" onChange={(e) => setOperatorId(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1">
          <Label htmlFor={`${uid}-line`}>{t("workforce.lineId", "Line id (optional)")}</Label>
          <Input id={`${uid}-line`} type="number" min={1} value={lineId} placeholder="e.g. 1" onChange={(e) => setLineId(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${uid}-station`}>{t("workforce.stationId", "Station id (optional)")}</Label>
          <Input id={`${uid}-station`} type="number" min={1} value={stationId} placeholder="e.g. 1" onChange={(e) => setStationId(e.target.value)} />
        </div>
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${uid}-skill`}>{t("workforce.skillLevel", "Skill level (optional)")}</Label>
        <Select
          value={skillLevel || "none"}
          onValueChange={(v) => setSkillLevel(v === "none" ? "" : v)}
        >
          <SelectTrigger id={`${uid}-skill`} className="h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t("workforce.skillNone", "— none —")}</SelectItem>
            {["trainee", "qualified", "expert", "trainer"].map((s) => (
              <SelectItem key={s} value={s}>{t(`safety.skill.${s}`, s)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <SheetFooter>
        <Button variant="outline" onClick={() => layer.close()}>{t("common.cancel", "Cancel")}</Button>
        <Button onClick={submit} disabled={pending}>
          <CheckCircle2 className="mr-1 h-4 w-4" />
          {mode === "assign" ? t("workforce.assign", "Assign") : t("workforce.reassign", "Reassign")}
        </Button>
      </SheetFooter>
    </div>
  );
}

function StartCollabForm({
  pending, onSubmit,
}: {
  pending: boolean;
  onSubmit: (v: StartCollabInput, done: () => void) => void;
}) {
  const { t } = useTranslation();
  const { layer, done } = useCloseOwnLayer();
  const uid = useId();
  const [operationCode, setOperationCode] = useState("");
  const [humanOperatorId, setHumanOperatorId] = useState("");
  const [robotDeviceId, setRobotDeviceId] = useState("");
  const [taskId, setTaskId] = useState("");

  const dirty = operationCode !== "" || humanOperatorId !== "" || robotDeviceId !== "" || taskId !== "";
  useEffect(() => { layer.setDirty(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    const human = humanOperatorId ? Number(humanOperatorId) : undefined;
    const robot = robotDeviceId ? Number(robotDeviceId) : undefined;
    const task = taskId ? Number(taskId) : undefined;
    onSubmit(
      {
        operationCode: operationCode.trim() || undefined,
        humanOperatorId: Number.isInteger(human) && (human as number) > 0 ? human : undefined,
        robotDeviceId: Number.isInteger(robot) && (robot as number) > 0 ? robot : undefined,
        taskId: Number.isInteger(task) && (task as number) > 0 ? task : undefined,
      },
      done,
    );
  };

  return (
    <div className="grid gap-3">
      <div className="rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
        {t("workforce.startCollabHint", "Starts an advisory handover handshake (human_prep → robot_work → human_verify → done). Coordination metadata only — NOT a safety interlock and issues no device command.")}
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${uid}-op`}>{t("workforce.operationCode", "Operation code (optional)")}</Label>
        <Input id={`${uid}-op`} value={operationCode} placeholder="OP-WELD-01" onChange={(e) => setOperationCode(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1">
          <Label htmlFor={`${uid}-human`}>{t("workforce.humanId", "Human operator id")}</Label>
          <Input id={`${uid}-human`} type="number" min={1} value={humanOperatorId} placeholder="e.g. 1" onChange={(e) => setHumanOperatorId(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${uid}-robot`}>{t("workforce.robotId", "Robot device id")}</Label>
          <Input id={`${uid}-robot`} type="number" min={1} value={robotDeviceId} placeholder="e.g. 1" onChange={(e) => setRobotDeviceId(e.target.value)} />
        </div>
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${uid}-task`}>{t("workforce.taskId", "Task id (optional)")}</Label>
        <Input id={`${uid}-task`} type="number" min={1} value={taskId} placeholder="e.g. 1" onChange={(e) => setTaskId(e.target.value)} />
      </div>
      <SheetFooter>
        <Button variant="outline" onClick={() => layer.close()}>{t("common.cancel", "Cancel")}</Button>
        <Button onClick={submit} disabled={pending}><Handshake className="mr-1 h-4 w-4" />{t("workforce.startCollab", "Start collaboration")}</Button>
      </SheetFooter>
    </div>
  );
}
