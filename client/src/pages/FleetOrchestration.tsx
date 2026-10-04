/**
 * G1 + G2 (doc 16 §7 Khối 2 / §12 design system) — FLEET & TASK ORCHESTRATION surface.
 *
 * Doc 81 Đợt 2 Task 10 — mẫu P4 Cockpit (`CockpitLayout`):
 *  - Header một hàng: h1 · chip cờ (G1 điều phối luôn; G2 lớp tài nguyên khi đang ở tab Sạc/Tài nguyên — như banner
 *    cũ chỉ hiện ngoài tab Tác vụ) · `StatusChipStrip` thay 9 MetricCard (MỖI chip ghi nguồn; Bế tắc / Thất bại /
 *    Vùng đầy tải được GHIM — R-2-p) · "Chỉ trạng thái điều phối" + "Khi nào dùng" (câu cũ trong popover) ·
 *    "Sổ đăng ký thao tác" · làm mới.
 *  - MAIN (`data-layout-main`) = bản đồ đội thiết bị với các vùng (lưới chiếm dụng + vùng tô theo tải + robot có
 *    vị trí). Bấm một vùng trên bản đồ ⇒ mở tab Vùng và đánh dấu vùng đó. Hàng công cụ duy nhất: nhà máy + số robot.
 *  - Panel phụ (aside): khối BẾ TẮC (khi có; luôn thấy, không phụ thuộc tab) + tab `?tab=` Tác vụ / Vùng / Sạc /
 *    Tài nguyên (giá trị lạ ⇒ Tác vụ).
 *  - Dialog → sheet sổ đăng ký (`FlyoutHost`, `?flyout=&flyoutId=`): thao tác (sổ + tạo + ánh xạ chương trình), tài
 *    nguyên (tạo + đặt trước), trạm sạc (tạo), gán lại tác vụ, đặt trước vùng. Form / kiểm tra / payload GIỮ NGUYÊN.
 *    Huỷ tác vụ giữ AlertDialog (xác nhận phá huỷ).
 *  - R-2-n: KHÔNG thêm khả năng tác động. Mỗi mutation giữ đúng một mục tiêu mỗi lần bấm/xác nhận, cùng cổng, cùng
 *    xác nhận như trang cũ (Phân bổ / Giải phóng / Xử lý bế tắc / Quét sạc: một cú bấm; Huỷ: AlertDialog; Gán lại /
 *    Đặt trước / Tạo / Ánh xạ: một lần lưu sheet). Không có thao tác hàng loạt.
 *  - Chặn chéo nhà máy (Đợt 0 Task 6): server từ chối thực thể ngoài phạm vi nhà máy (FORBIDDEN SCOPE_MISMATCH) ⇒
 *    `onMutationError` toast lỗi đã dịch, sheet GIỮ MỞ, danh sách không đổi. Đọc đã lọc phạm vi ở server; bộ chọn nhà
 *    máy của bản đồ chỉ liệt kê nhà máy của các vùng đọc được.
 *  - Việc dời route sang "Labs" (doc 80) là task IA riêng — chưa làm ở đây.
 *
 * SAFETY (mirrors the router): this page writes orchestration STATE only — it opens NO device path. G1 mutations
 * are gated behind FLEET_ORCH_ENABLED; G2 mutations behind FLEET_RESOURCE_ENABLED. When a flag is OFF the page shows
 * an honest "preview" chip and surfaces the CONFLICT error gracefully (toast.info, not red). Read RBAC:
 * machine_monitoring/canView. Actions: machine_control/canCreate (hidden/locked when absent).
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import { usePollingInterval } from "@/hooks/usePollingInterval";
import { usePermissions } from "@/_core/hooks/usePermissions";
import DashboardLayout from "@/components/DashboardLayout";
import { ViewOnlyBadge } from "@/components/PermissionGate";
import { PollFreshness } from "@/components/PollFreshness";
import {
  CockpitLayout,
  FeatureStatusNoticeChip,
  FlyoutHost,
  NoticeStack,
  PageContainer,
  StatusChipStrip,
  chipStateFromQuery,
  useCloseOwnLayer,
  useFlyout,
  useNarrowViewport,
  type FlyoutDefinition,
  type NoticeItem,
  type StatusChipItem,
} from "@/components/patterns";
import { useUrlParam } from "@/components/patterns/useUrlParam";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { SheetFooter } from "@/components/ui/sheet";
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
  Truck, RefreshCw, ListChecks, Layers, ShieldAlert,
  Play, Send, Ban, MapPin, Bot, CheckCircle2,
  Wrench, Workflow, BatteryCharging, Plus, Search, Link2, Zap, Package, Map as MapIcon,
} from "lucide-react";
import { toast } from "sonner";
import { mapTrpcError } from "@/lib/trpcErrors";
import { isFeatureDisabledError, featureKeyOf } from "@/lib/featureFlagError";
import {
  deriveFeatureStatus,
  FeatureStatusGate,
  isFeatureStatusUnsettled,
  type FeatureStatus,
} from "@/components/common/FeatureStatusGate";
// doc 80 Đợt 1 Task 4 (X-01) — nhãn DEMO/SEED/SIM + dải tóm tắt trên bảng task.
import { ProvenanceBadge, ProvenanceSummary } from "@/components/common/ProvenanceBadge";

// ── Typesafe shapes inferred from the fleetRouter output ──────────────────────
type RouterOutputs = inferRouterOutputs<AppRouter>;
type FleetTask = RouterOutputs["fleet"]["listTasks"][number];
type FleetZone = RouterOutputs["fleet"]["listZones"][number];
type FleetReservation = RouterOutputs["fleet"]["listReservations"][number];
// G2 shapes
type FleetOperation = RouterOutputs["fleet"]["listOperations"][number];
type FleetResolved = RouterOutputs["fleet"]["resolveOperation"];
type FleetResource = RouterOutputs["fleet"]["listResources"][number];
type FleetResReservation = RouterOutputs["fleet"]["listResourceReservations"][number];
type FleetCharger = RouterOutputs["fleet"]["listChargers"][number];
type FleetChargingPlan = RouterOutputs["fleet"]["listChargingPlans"][number];
// W4-18 (3) — MAP shapes
type FleetRobotPos = RouterOutputs["fleet"]["robotPositions"][number];
type FleetOccupancyGrid = RouterOutputs["twin"]["occupancyGrid"];

const TASK_STATUSES = ["pending", "assigned", "running", "completed", "failed", "cancelled"] as const;
const TERMINAL = new Set(["completed", "failed", "cancelled"]);

/**
 * U11 (doc 26 §3.1) — bảng màu trạng thái Fleet gom về MỘT nơi. Mỗi khóa là một "sắc
 * thái" ngữ nghĩa; literal Tailwind chỉ khai báo một lần tại đây thay vì rải khắp từng
 * hàm badge. KHÔNG đổi nghĩa màu — chỉ dồn về nguồn chung để đồng nhất & dễ bảo trì.
 */
const FLEET_TONE = {
  blue: "bg-blue-500 text-white",
  cyan: "bg-cyan-500 text-white",
  cyan600: "bg-cyan-600 text-white",
  emerald: "bg-emerald-500 text-white",
  amber: "bg-amber-500 text-white",
  slate: "bg-slate-500 text-white",
  indigo: "bg-indigo-500 text-white",
  violet: "bg-violet-500 text-white",
} as const;

/** Badge màu theo sắc thái chung ở trên. */
function toneBadge(tone: keyof typeof FLEET_TONE, label: string) {
  return <Badge className={FLEET_TONE[tone]}>{label}</Badge>;
}

/** Badge "trung tính" (đã kết thúc / không rõ) — outline + chữ mờ. */
function mutedBadge(label: string) {
  return <Badge variant="outline" className="text-muted-foreground">{label}</Badge>;
}

function taskStatusBadge(status: string, t: (k: string, f: string) => string) {
  switch (status) {
    case "running":
      return toneBadge("blue", t("fleet.task.running", "Running"));
    case "assigned":
      return toneBadge("cyan", t("fleet.task.assigned", "Assigned"));
    case "completed":
      return toneBadge("emerald", t("fleet.task.completed", "Completed"));
    case "failed":
      return <Badge variant="destructive">{t("fleet.task.failed", "Failed")}</Badge>;
    case "cancelled":
      return mutedBadge(t("fleet.task.cancelled", "Cancelled"));
    case "pending":
    default:
      return toneBadge("amber", t("fleet.task.pending", "Pending"));
  }
}

function resStatusBadge(status: string, t: (k: string, f: string) => string) {
  switch (status) {
    case "active":
      return toneBadge("emerald", t("fleet.res.active", "Active"));
    case "queued":
      return toneBadge("amber", t("fleet.res.queued", "Queued"));
    case "rejected":
      return <Badge variant="destructive">{t("fleet.res.rejected", "Rejected")}</Badge>;
    case "released":
    default:
      return mutedBadge(t("fleet.res.released", "Released"));
  }
}

function zoneTypeBadge(zoneType: string, t: (k: string, f: string) => string) {
  const map: Record<string, { tone: keyof typeof FLEET_TONE; label: string }> = {
    production: { tone: "slate", label: t("fleet.zoneType.production", "Production") },
    transit: { tone: "indigo", label: t("fleet.zoneType.transit", "Transit") },
    charging: { tone: "emerald", label: t("fleet.zoneType.charging", "Charging") },
    human_shared: { tone: "amber", label: t("fleet.zoneType.human_shared", "Human-shared") },
  };
  const e = map[zoneType];
  return e ? toneBadge(e.tone, e.label) : <Badge variant="outline">{zoneType}</Badge>;
}

function fmtDuration(ms?: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function fmtDateTime(d?: string | Date | null): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleString();
}

// ── G2 status / type badges (mirror the G1 colour-by-status discipline) ───────
function resourceStatusBadge(status: string, t: (k: string, f: string) => string) {
  switch (status) {
    case "in_use":
      return toneBadge("blue", t("fleet.resource.in_use", "In use"));
    case "reserved":
      return toneBadge("amber", t("fleet.resource.reserved", "Reserved"));
    case "maintenance":
      return <Badge variant="destructive">{t("fleet.resource.maintenance", "Maintenance")}</Badge>;
    case "available":
    default:
      return toneBadge("emerald", t("fleet.resource.available", "Available"));
  }
}

function resourceTypeBadge(type: string, t: (k: string, f: string) => string) {
  const map: Record<string, { tone: keyof typeof FLEET_TONE; label: string }> = {
    jig: { tone: "slate", label: t("fleet.resType.jig", "Jig") },
    gripper: { tone: "indigo", label: t("fleet.resType.gripper", "Gripper") },
    fixture: { tone: "cyan600", label: t("fleet.resType.fixture", "Fixture") },
    tool_changer: { tone: "violet", label: t("fleet.resType.tool_changer", "Tool changer") },
  };
  const e = map[type];
  // "other" và loại lạ → outline (giữ nguyên: trước đây cls rỗng cũng ra outline).
  return e ? toneBadge(e.tone, e.label) : <Badge variant="outline">{type === "other" ? t("fleet.resType.other", "Other") : type}</Badge>;
}

function planStatusBadge(status: string, t: (k: string, f: string) => string) {
  switch (status) {
    case "active":
      return toneBadge("blue", t("fleet.plan.active", "Active"));
    case "planned":
      return toneBadge("amber", t("fleet.plan.planned", "Planned"));
    case "done":
      return toneBadge("emerald", t("fleet.plan.done", "Done"));
    case "cancelled":
    default:
      return mutedBadge(t("fleet.plan.cancelled", "Cancelled"));
  }
}

function chargerStatusBadge(status: string, t: (k: string, f: string) => string) {
  switch (status) {
    case "in_use":
      return toneBadge("blue", t("fleet.charger.in_use", "In use"));
    case "offline":
    case "maintenance":
      return <Badge variant="destructive">{t("fleet.charger.offline", "Offline")}</Badge>;
    case "available":
    default:
      return toneBadge("emerald", t("fleet.charger.available", "Available"));
  }
}

const RESOURCE_TYPES = ["jig", "gripper", "fixture", "tool_changer", "other"] as const;

/** Tab của panel phụ (`?tab=`). Giá trị lạ / thiếu ⇒ "tasks". */
const SIDE_TABS = ["tasks", "zones", "charging", "resources"] as const;
type SideTab = (typeof SIDE_TABS)[number];
/** ≥1600 px: 5 chip KPI hiện thẳng; hẹp hơn: 3 (đúng 3 chip ghim) + "+N". */
/** < 1280 px: header không đủ chỗ cho chip cờ + ghi chú (đo 1100 px: bị cắt) ⇒ chúng xuống đầu MAIN. */
const COMPACT_BREAKPOINT_PX = 1280;
const KPI_WIDE_BREAKPOINT_PX = 1600;
/** Bề rộng panel phụ: đủ cho bảng tác vụ gọn (khoá · trạng thái · thiết bị · 3 nút). */
const SIDE_WIDTH_WIDE = 440;
const SIDE_WIDTH = 400;

/** Kết quả đặt trước (vùng / tài nguyên) bị TỪ CHỐI ⇒ sheet giữ mở như dialog cũ. */
function isRejectedClaim(res: { ok?: boolean; status?: string } | null | undefined): boolean {
  return !!res && (res.ok === false || res.status === "rejected");
}

export default function FleetOrchestration() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canView = hasPermission("machine_monitoring", "canView");
  const canControl = hasPermission("machine_control", "canCreate");
  // U4 (doc 26 §2.4) — hiện-nhưng-khoá: lý do khi thiếu quyền điều khiển máy.
  const permReason = !canControl
    ? t("common.gate.needPerm", "Requires {{perm}} permission", { perm: "machine_control" })
    : undefined;

  const narrow = useNarrowViewport(COMPACT_BREAKPOINT_PX);
  const kpiWide = !useNarrowViewport(KPI_WIDE_BREAKPOINT_PX);
  const [tabParam, setTabParam] = useUrlParam("tab");
  const sideTab: SideTab = (SIDE_TABS as readonly string[]).includes(tabParam ?? "") ? (tabParam as SideTab) : "tasks";
  const setSideTab = (v: string) => setTabParam(v === "tasks" ? null : v);

  const [statusFilter, setStatusFilter] = useState<string>("");
  const [cancelTarget, setCancelTarget] = useState<FleetTask | null>(null);
  // G2-a — mã thao tác đang phân giải (ở cấp trang như cũ: giữ qua lần đóng/mở sổ đăng ký).
  const [resolveCode, setResolveCode] = useState<string>("");
  // W4-18 (3) — factory chọn cho bản đồ (null = tự suy từ zone đầu tiên có factoryId).
  const [mapFactoryId, setMapFactoryId] = useState<number | null>(null);
  // Vùng đang chọn (bấm trên bản đồ) — đánh dấu thẻ vùng ở tab Vùng.
  const [selectedZoneId, setSelectedZoneId] = useState<number | null>(null);
  const deadlockRef = useRef<HTMLDivElement | null>(null);

  const utils = trpc.useUtils();

  // ── Reads ──────────────────────────────────────────────────────────────────
  // ENG-F8 (doc 40 W4b) — GATE POLL THEO TAB để cắt over-fetch. MỌI query vẫn `enabled: canView` (chip KPI + khối
  // bế tắc NẠP một lần & giữ cache khi đổi tab — honest, không để chip trống); refetchInterval 5s chỉ cho dữ liệu
  // đang hiển thị:
  //   • tasks → tab Tác vụ; status (cờ G1) + reservations → tab Tác vụ HOẶC Vùng (hai tab G1; Vùng vẽ đặt chỗ);
  //   • zones + robotPositions → LUÔN (doc 81 Đợt 2 Task 10: bản đồ là MAIN, luôn hiển thị — trước đây chỉ khi mở
  //     tab Bản đồ / Tác vụ & Vùng);
  //   • deadlocks → luôn (AN TOÀN: chip ghim + khối + toast "deadlock mới").
  // Quay lại tab → refetchOnWindowFocus/visibility làm mới NGAY (usePollingInterval). Dừng poll khi mất quyền xem
  // HOẶC tab trình duyệt bị ẩn (doc 27 B12).
  const g1TabActive = canView && (sideTab === "tasks" || sideTab === "zones");
  const tasksPolling = usePollingInterval(canView && sideTab === "tasks" ? 5000 : false);
  const g1Polling = usePollingInterval(g1TabActive ? 5000 : false);
  const alwaysPolling = usePollingInterval(canView ? 5000 : false);
  const statusQ = trpc.fleet.status.useQuery(undefined, { enabled: canView, ...g1Polling });
  const tasksQ = trpc.fleet.listTasks.useQuery(
    { status: (statusFilter || undefined) as (typeof TASK_STATUSES)[number] | undefined, limit: 200 },
    { enabled: canView, ...tasksPolling },
  );
  const zonesQ = trpc.fleet.listZones.useQuery(undefined, { enabled: canView, ...alwaysPolling });
  const reservationsQ = trpc.fleet.listReservations.useQuery({ limit: 500 }, { enabled: canView, ...g1Polling });
  const deadlocksQ = trpc.fleet.deadlocks.useQuery(undefined, { enabled: canView, ...alwaysPolling });

  const tasks = (tasksQ.data ?? []) as FleetTask[];
  const zones = (zonesQ.data ?? []) as FleetZone[];
  const reservations = (reservationsQ.data ?? []) as FleetReservation[];
  const deadlocks = deadlocksQ.data;

  // ── W4-18 (3) MAP reads — factory list + effective factory + grid + live robot poses.
  const factoryIds = useMemo(
    () => [...new Set(zones.map((z) => z.factoryId).filter((f): f is number => f != null))].sort((a, b) => a - b),
    [zones],
  );
  const effectiveFactoryId = mapFactoryId ?? factoryIds[0] ?? 1;
  // final wave T10 — chỉ đọc lưới khi BIẾT nhà máy (người dùng chọn, hoặc có vùng đọc được): không còn gọi factoryId=1
  // dự phòng mỗi lần mở trang (twin.occupancyGrid chưa có kiểm phạm vi nhà máy phía server — còn mở, ghi ở báo cáo).
  const gridFactoryKnown = mapFactoryId != null || factoryIds.length > 0;
  const occupancyGridQ = trpc.twin.occupancyGrid.useQuery(
    { factoryId: effectiveFactoryId },
    { enabled: canView && gridFactoryKnown, retry: false },
  );
  const robotPositionsQ = trpc.fleet.robotPositions.useQuery(undefined, {
    enabled: canView,
    ...alwaysPolling,
  });

  // ── G2 reads (read RBAC is the same — machine_monitoring/canView) ─────────────
  const resourceStatusQ = trpc.fleet.resourceStatus.useQuery(undefined, { enabled: canView });
  const operationsQ = trpc.fleet.listOperations.useQuery(undefined, { enabled: canView });
  const resolveQ = trpc.fleet.resolveOperation.useQuery(
    { code: resolveCode },
    { enabled: canView && resolveCode.length > 0, retry: false },
  );
  const resourcesQ = trpc.fleet.listResources.useQuery(undefined, { enabled: canView });
  const resourceReservationsQ = trpc.fleet.listResourceReservations.useQuery({ limit: 500 }, { enabled: canView });
  const chargersQ = trpc.fleet.listChargers.useQuery(undefined, { enabled: canView });
  const chargingPlansQ = trpc.fleet.listChargingPlans.useQuery({ limit: 200 }, { enabled: canView });

  const operations = (operationsQ.data ?? []) as FleetOperation[];
  const resolved = resolveQ.data as FleetResolved | undefined;
  const resources = (resourcesQ.data ?? []) as FleetResource[];
  const resourceReservations = (resourceReservationsQ.data ?? []) as FleetResReservation[];
  const chargers = (chargersQ.data ?? []) as FleetCharger[];
  const chargingPlans = (chargingPlansQ.data ?? []) as FleetChargingPlan[];

  // Flag state — honest 4-state. Doc 80 Task 1 (PLT-02/G-07/X-07): the query
  // pending/erroring is UNKNOWN, not "on" — no more `?? true` optimistic default.
  const flagStatus = deriveFeatureStatus(statusQ, (d: { enabled?: boolean }) => d.enabled);
  const flagUnsettled = isFeatureStatusUnsettled(flagStatus);
  // G2 resource layer flag — independent of the G1 orchestration flag.
  const resourceFlagStatus = deriveFeatureStatus(resourceStatusQ, (d: { enabled?: boolean }) => d.enabled);
  const resourceFlagUnsettled = isFeatureStatusUnsettled(resourceFlagStatus);
  // G1 write gate: permission first, then "we don't know the flag status yet" (loading/error).
  const g1ControlReason = permReason
    ?? (flagUnsettled ? t("common.gate.checkingStatus", "Checking feature status…") : undefined);
  const g1CanControl = canControl && !flagUnsettled;
  // G2 write gate — same shape, driven by the resource-layer status query.
  const g2ControlReason = permReason
    ?? (resourceFlagUnsettled ? t("common.gate.checkingStatus", "Checking feature status…") : undefined);
  const g2CanControl = canControl && !resourceFlagUnsettled;

  const refetchAll = () => {
    void utils.fleet.status.invalidate();
    void utils.fleet.listTasks.invalidate();
    void utils.fleet.listZones.invalidate();
    void utils.fleet.listReservations.invalidate();
    void utils.fleet.deadlocks.invalidate();
    // G2
    void utils.fleet.resourceStatus.invalidate();
    void utils.fleet.listOperations.invalidate();
    void utils.fleet.resolveOperation.invalidate();
    void utils.fleet.listResources.invalidate();
    void utils.fleet.listResourceReservations.invalidate();
    void utils.fleet.listChargers.invalidate();
    void utils.fleet.listChargingPlans.invalidate();
  };

  // Surface the FLAG-OFF CONFLICT gracefully (info, not a scary red error).
  // Covers both G1 (FLEET_ORCH_ENABLED) and G2 (FLEET_RESOURCE_ENABLED) disabled messages.
  // Mọi lỗi khác — kể cả FORBIDDEN SCOPE_MISMATCH (thực thể của nhà máy khác, Đợt 0 Task 6) — là toast lỗi đã dịch.
  const onMutationError = (e: { data?: { code?: string } | null; message: string }) => {
    if (isFeatureDisabledError(e)) {
      // F11: trước đây phân nhánh bằng `/resource/i.test(e.message)` — khớp chữ trong
      // message TIẾNG ANH. Nay dùng khoá máy chủ gửi kèm (`fleetResourceLayer` vs
      // `fleetOrchestration`); giữ regex làm đường lui cho tuyến chưa di trú.
      const feature = featureKeyOf(e);
      if (feature === "fleetResourceLayer" || (feature === undefined && /resource/i.test(e.message))) {
        toast.info(t("fleet.resourceFlagOffToast", "Fleet resource layer is disabled (preview). Set FLEET_RESOURCE_ENABLED=true to act."));
        void utils.fleet.resourceStatus.invalidate();
      } else {
        toast.info(t("fleet.flagOffToast", "Fleet orchestration is disabled (preview). Set FLEET_ORCH_ENABLED=true to act."));
        void utils.fleet.status.invalidate();
      }
    } else {
      toast.error(mapTrpcError(e));
    }
  };

  // Toast + làm mới nằm ở mutation cấp trang (như cũ). Sheet tự đóng CHÍNH lớp của nó qua `done` truyền theo lượt gọi.
  const allocateM = trpc.fleet.allocate.useMutation({
    // W4-18 (1) — allocateTask trả {ok:false} khi không có thiết bị phù hợp mà KHÔNG throw;
    // đọc kết quả thật thay vì luôn toast xanh giả.
    onSuccess: (res) => {
      if (res && res.ok === false) {
        toast.warning(t("fleet.allocateNoDevice", "No eligible device for this task") + (res.message ? ` — ${res.message}` : ""));
      } else {
        toast.success(t("fleet.allocated", "Allocation run") + (res && res.assignedDeviceId != null ? ` → #${res.assignedDeviceId}` : ""));
      }
      refetchAll();
    },
    onError: onMutationError,
  });
  const assignM = trpc.fleet.assign.useMutation({
    onSuccess: () => { toast.success(t("fleet.assigned", "Task reassigned")); refetchAll(); },
    onError: onMutationError,
  });
  const cancelM = trpc.fleet.cancelTask.useMutation({
    onSuccess: () => { toast.success(t("fleet.cancelled", "Task cancelled")); setCancelTarget(null); refetchAll(); },
    onError: onMutationError,
  });
  const reserveM = trpc.fleet.reserve.useMutation({
    // W4-18 (1) — reserveZone trả {ok,status}: rejected → error (sheet giữ mở), queued → warning, active → success.
    onSuccess: (res) => {
      if (isRejectedClaim(res)) {
        toast.error(t("fleet.reserveRejected", "Reservation rejected") + (res?.message ? ` — ${res.message}` : ""));
      } else if (res && res.status === "queued") {
        toast.warning(t("fleet.reserveQueued", "Zone at capacity — reservation queued"));
      } else {
        toast.success(t("fleet.reserved", "Reservation active"));
      }
      refetchAll();
    },
    onError: onMutationError,
  });
  const releaseM = trpc.fleet.release.useMutation({
    onSuccess: () => { toast.success(t("fleet.released", "Released")); refetchAll(); },
    onError: onMutationError,
  });
  // W4-18 (5) — advisory deadlock resolver (huỷ waiter ưu tiên thấp nhất trong mỗi chu trình).
  const resolveDeadlockM = trpc.fleet.resolveDeadlock.useMutation({
    onSuccess: (res) => {
      if (res && res.ok && res.resolved > 0) {
        toast.success(t("fleet.deadlockResolved", "Deadlock resolved") + ` — ${res.resolved} ${t("fleet.waiterCancelled", "waiter(s) cancelled")}`);
      } else {
        toast.info(t("fleet.deadlockNone", "No deadlock cycle to resolve"));
      }
      refetchAll();
    },
    onError: onMutationError,
  });

  // ── G2 mutations ─────────────────────────────────────────────────────────────
  const createOpM = trpc.fleet.createOperation.useMutation({
    onSuccess: () => { toast.success(t("fleet.opCreated", "Operation created")); refetchAll(); },
    onError: onMutationError,
  });
  const mapProgramM = trpc.fleet.mapOperationProgram.useMutation({
    onSuccess: () => { toast.success(t("fleet.programMapped", "Program mapped to operation")); refetchAll(); },
    onError: onMutationError,
  });
  const createResourceM = trpc.fleet.createResource.useMutation({
    onSuccess: () => { toast.success(t("fleet.resourceCreated", "Resource created")); refetchAll(); },
    onError: onMutationError,
  });
  const reserveResourceM = trpc.fleet.reserveResource.useMutation({
    // W4-18 (1) — claimResource trả {ok,status}: rejected → error (sheet giữ mở), queued → warning, active → success.
    onSuccess: (res) => {
      if (isRejectedClaim(res)) {
        toast.error(t("fleet.resourceRejected", "Resource claim rejected") + (res?.message ? ` — ${res.message}` : ""));
      } else if (res && res.status === "queued") {
        toast.warning(t("fleet.resourceQueued", "Resource in use — claim queued"));
      } else {
        toast.success(t("fleet.resourceReserved", "Resource claimed"));
      }
      refetchAll();
    },
    onError: onMutationError,
  });
  const releaseResourceM = trpc.fleet.releaseResource.useMutation({
    onSuccess: () => { toast.success(t("fleet.resourceReleased", "Resource released")); refetchAll(); },
    onError: onMutationError,
  });
  const createChargerM = trpc.fleet.createCharger.useMutation({
    onSuccess: () => { toast.success(t("fleet.chargerCreated", "Charger created")); refetchAll(); },
    onError: onMutationError,
  });
  const sweepM = trpc.fleet.sweepCharging.useMutation({
    onSuccess: (r) => {
      toast.success(t("fleet.sweepDone", "Charging sweep complete") + (r && "scheduled" in r ? ` — ${r.scheduled} ${t("fleet.scheduledShort", "scheduled")}` : ""));
      refetchAll();
    },
    onError: onMutationError,
  });

  // ── Derived KPIs ─────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const byStatus: Record<string, number> = {};
    for (const tk of tasks) byStatus[tk.status] = (byStatus[tk.status] ?? 0) + 1;
    const activeReservations = reservations.filter((r) => r.status === "active").length;
    const queuedReservations = reservations.filter((r) => r.status === "queued").length;
    const zonesAtCapacity = zones.filter((z) => z.occupancy >= z.maxConcurrentRobots).length;
    const resourcesInUse = resources.filter((r) => (r.availability?.activeCount ?? 0) > 0).length;
    const activeChargingPlans = chargingPlans.filter((p) => p.status === "active" || p.status === "planned").length;
    return {
      pending: byStatus.pending ?? 0,
      assigned: byStatus.assigned ?? 0,
      running: byStatus.running ?? 0,
      failed: byStatus.failed ?? 0,
      activeReservations,
      queuedReservations,
      zonesAtCapacity,
      deadlockCount: deadlocks?.cycles?.length ?? 0,
      resourcesInUse,
      activeChargingPlans,
    };
  }, [tasks, reservations, zones, deadlocks, resources, chargingPlans]);

  // Resource reservations grouped by resource id (active + queued only).
  const resReservationsByResource = useMemo(() => {
    const m = new Map<number, FleetResReservation[]>();
    for (const r of resourceReservations) {
      if (r.status === "released" || r.status === "rejected") continue;
      const list = m.get(r.resourceId) ?? [];
      list.push(r);
      m.set(r.resourceId, list);
    }
    return m;
  }, [resourceReservations]);

  // Reservations grouped by zone (for the zones panel).
  const resByZone = useMemo(() => {
    const m = new Map<number, FleetReservation[]>();
    for (const r of reservations) {
      if (r.status === "released" || r.status === "rejected") continue;
      const list = m.get(r.zoneId) ?? [];
      list.push(r);
      m.set(r.zoneId, list);
    }
    return m;
  }, [reservations]);

  // ── U12 (doc 26 §2.3) — nhắc khi có DEADLOCK MỚI trong lúc user đang ở trang ─
  // So sánh chữ ký chu trình với lần poll trước; chỉ toast cái MỚI (chống spam).
  // Chuẩn hoá mỗi cycle bằng cách sort id → xoay vòng A→B→C và B→C→A coi là một.
  const seenDeadlocksRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!deadlocks) return;
    const sigs = new Set((deadlocks.cycles ?? []).map((c) => [...c].sort((a, b) => a - b).join(">")));
    // Lần đầu (prime) chỉ ghi nhận baseline, KHÔNG toast.
    if (seenDeadlocksRef.current === null) {
      seenDeadlocksRef.current = sigs;
      return;
    }
    const prev = seenDeadlocksRef.current;
    const fresh = [...sigs].filter((s) => !prev.has(s));
    seenDeadlocksRef.current = sigs;
    if (fresh.length > 0) {
      toast.error(
        t("fleet.newDeadlockToast", "New deadlock detected") +
          (fresh.length > 1 ? ` (${fresh.length})` : ""),
        { description: t("fleet.newDeadlockDesc", "A robot dependency cycle just formed — review the deadlock block in the side panel.") },
      );
    }
  }, [deadlocks, t]);

  if (!canView) {
    return (
      <DashboardLayout>
        <div className="p-6">
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              <ShieldAlert className="mx-auto mb-2 h-6 w-6" />
              {t("fleet.noPermission", "You do not have permission to view fleet orchestration.")}
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  const anyLoading = tasksQ.isLoading || zonesQ.isLoading || reservationsQ.isLoading;
  const tasksState = chipStateFromQuery(tasksQ);
  const deadlockCount = kpis.deadlockCount;
  const focusDeadlocks = () => {
    const el = deadlockRef.current;
    if (!el) return;
    el.scrollIntoView?.({ block: "nearest" });
    el.focus();
  };
  const selectZoneOnMap = (zoneId: number) => {
    setSelectedZoneId(zoneId);
    setSideTab("zones");
  };

  // ── 9 KPI cũ → MỘT dải chip (mỗi chip ghi NGUỒN; lỗi/đang tải không bao giờ in 0) ─────────────────────────
  // R-2-p: Bế tắc (an toàn giao thông robot), Thất bại (cảnh báo), Vùng đầy tải (lưu lượng) — GHIM, không vào "+N".
  const failedFilteredOut = statusFilter !== "" && statusFilter !== "failed";
  const chipItems: StatusChipItem[] = [
    {
      id: "fleet-deadlocks",
      pinned: true,
      label: t("fleet.kpi.deadlocks", "Deadlocks"),
      value: deadlockCount,
      state: chipStateFromQuery(deadlocksQ),
      tone: deadlockCount > 0 ? "error" : "default",
      source: t("fleet.chip.src.deadlocks", "fleet.deadlocks — robot wait-for cycles detected now (advisory)"),
      onClick: deadlockCount > 0 ? focusDeadlocks : undefined,
    },
    {
      id: "fleet-failed",
      pinned: true,
      label: t("fleet.kpi.failed", "Failed"),
      // final wave T10 — danh sách đang lọc trạng thái KHÁC 'failed' ⇒ không đếm được ⇒ "—" (không đọc thành 0 khoẻ mạnh).
      value: failedFilteredOut ? "—" : kpis.failed,
      state: tasksState,
      tone: !failedFilteredOut && kpis.failed > 0 ? "error" : "default",
      source: t("fleet.chip.src.failed", "fleet.listTasks — tasks with status 'failed' in the loaded list (latest 200, status filter applies)"),
    },
    {
      id: "fleet-at-capacity",
      pinned: true,
      label: t("fleet.kpi.atCapacity", "Zones at capacity"),
      value: zonesQ.data === undefined ? undefined : `${kpis.zonesAtCapacity}/${zones.length}`,
      state: chipStateFromQuery(zonesQ),
      tone: kpis.zonesAtCapacity > 0 ? "warning" : "default",
      source: t("fleet.chip.src.atCapacity", "fleet.listZones — zones whose occupancy has reached max concurrent robots"),
    },
    {
      id: "fleet-pending",
      label: t("fleet.kpi.pending", "Pending"),
      value: kpis.pending,
      state: tasksState,
      tone: kpis.pending > 0 ? "warning" : "default",
      source: t("fleet.chip.src.pending", "fleet.listTasks — tasks with status 'pending' in the loaded list (latest 200, status filter applies)"),
    },
    {
      id: "fleet-running",
      label: t("fleet.kpi.running", "Running"),
      value: kpis.running,
      state: tasksState,
      tone: kpis.running > 0 ? "success" : "default",
      source: t("fleet.chip.src.running", "fleet.listTasks — tasks with status 'running' in the loaded list (latest 200, status filter applies)"),
    },
    {
      id: "fleet-assigned",
      label: t("fleet.kpi.assigned", "Assigned"),
      value: kpis.assigned,
      state: tasksState,
      source: t("fleet.chip.src.assigned", "fleet.listTasks — tasks with status 'assigned' in the loaded list (latest 200, status filter applies)"),
    },
    {
      id: "fleet-active-res",
      label: t("fleet.kpi.activeRes", "Active reservations"),
      value: kpis.activeReservations,
      state: chipStateFromQuery(reservationsQ),
      source: t("fleet.chip.src.activeRes", "fleet.listReservations — zone reservations with status 'active' (latest 500)"),
    },
    {
      id: "fleet-resources-in-use",
      label: t("fleet.kpi.resourcesInUse", "Resources in use"),
      value: resourcesQ.data === undefined ? undefined : `${kpis.resourcesInUse}/${resources.length}`,
      state: chipStateFromQuery(resourcesQ),
      tone: kpis.resourcesInUse > 0 ? "success" : "default",
      source: t("fleet.chip.src.resourcesInUse", "fleet.listResources — shared resources with at least one active claim"),
    },
    {
      id: "fleet-charging",
      label: t("fleet.kpi.charging", "Charging plans"),
      value: kpis.activeChargingPlans,
      state: chipStateFromQuery(chargingPlansQ),
      tone: kpis.activeChargingPlans > 0 ? "warning" : "default",
      source: t("fleet.chip.src.charging", "fleet.listChargingPlans — charging plans 'active' or 'planned' (latest 200)"),
    },
  ];

  // ── Chip cờ (4 trạng thái) + ghi chú ─────────────────────────────────────────────────────────────────────
  const g1FlagChip = (
    <FeatureStatusNoticeChip
      status={flagStatus}
      offMessage={t(
        "fleet.flagOffBanner",
        "Preview mode: fleet orchestration is disabled. Reads work; actions (allocate / reassign / cancel / reserve / release) are blocked until it is enabled.",
      )}
      errorMessage={t(
        "fleet.flagStatusError",
        "Could not check whether fleet orchestration is enabled — actions are disabled until this is confirmed.",
      )}
    />
  );
  // Banner G2 cũ chỉ hiện NGOÀI tab Tác vụ & Vùng (tức trên các bề mặt G2) ⇒ chip G2 chỉ ở tab Sạc / Tài nguyên;
  // sổ đăng ký thao tác (G2-a) có cổng đầy đủ bên trong sheet.
  const g2FlagChip =
    sideTab === "charging" || sideTab === "resources" ? (
      <FeatureStatusNoticeChip
        status={resourceFlagStatus}
        subject={t("fleet.flag.resource", "Resource layer")}
        offMessage={t(
          "fleet.resourceFlagOffBanner",
          "Preview mode: the fleet resource layer is disabled. Reads work; actions (create / map / reserve / release / sweep) are blocked until it is enabled.",
        )}
        errorMessage={t(
          "fleet.resourceFlagStatusError",
          "Could not check whether the fleet resource layer is enabled — actions are disabled until this is confirmed.",
        )}
      />
    ) : null;
  const noticeItems: NoticeItem[] = [
    {
      // Safety note — mirrors RobotControl honesty (khối 🔒 cũ).
      id: "fleet-safety",
      kind: "honesty",
      label: t("fleet.safetyChip", "Orchestration state only"),
      content: (
        <p>
          {t(
            "fleet.safetyNote",
            "This page writes orchestration state only (tasks / zones / reservations). Actual robot motion always routes through the gated HITL dispatcher — never from this screen.",
          )}
        </p>
      ),
    },
    {
      // U7 (doc 26 §2.1) — "Khi nào dùng" (khoá riêng của trang) + phụ đề cũ.
      id: "whenToUse:fleet.whenToUse",
      kind: "whenToUse",
      content: (
        <div className="space-y-2">
          <p data-when-to-use="fleet.whenToUse">
            {t("fleet.whenToUse", "When to use — assign tasks across a robot/AGV fleet and manage zone traffic & reservations. Orchestration state only; real motion routes through the HITL dispatcher.")}
          </p>
          <p className="text-muted-foreground">
            {t("fleet.subtitle", "Dynamic task allocation + zone traffic control — orchestration state only, no direct device commands.")}
          </p>
        </div>
      ),
    },
  ];

  // ── Flyouts (một stack sheet phải; URL `?flyout=&flyoutId=` là nguồn sự thật) ─────────────────────────────
  // Sheet ghi chỉ đăng ký khi có quyền điều khiển (nút cũ bị khoá/ẩn khi thiếu quyền). Nút cũ khoá khi cờ CHƯA RÕ
  // (đang kiểm tra / lỗi) ⇒ deep link cũng vậy: sheet chỉ báo trạng thái, không có form. Cờ TẮT (đã rõ) ⇒ form như
  // nút cũ (server trả CONFLICT ⇒ toast.info êm).
  const unsettledBody = (status: FeatureStatus, errorText: string) =>
    status === "error" ? (
      <p role="alert" className="py-6 text-center text-sm text-destructive">{errorText}</p>
    ) : (
      <p className="py-6 text-center text-sm text-muted-foreground">{t("common.gate.checkingStatus", "Checking feature status…")}</p>
    );
  const g1Unsettled = () =>
    unsettledBody(flagStatus, t("fleet.flagStatusError", "Could not check whether fleet orchestration is enabled — actions are disabled until this is confirmed."));
  const g2Unsettled = () =>
    unsettledBody(resourceFlagStatus, t("fleet.resourceFlagStatusError", "Could not check whether the fleet resource layer is enabled — actions are disabled until this is confirmed."));
  const byId = <T extends { id: number }>(rows: readonly T[], id: string | null): T | null =>
    id != null && /^\d+$/.test(id) ? rows.find((r) => r.id === Number(id)) ?? null : null;
  const notLoaded = (loading: boolean, key: string, fallback: string, id: string | null) => (
    <p className="py-6 text-center text-sm text-muted-foreground">
      {loading ? t("fleet.loading", "Loading…") : t(key, fallback, { id: id ?? "" })}
    </p>
  );

  const flyouts: Record<string, FlyoutDefinition> = {
    // G2-a — Sổ đăng ký thao tác (tab "Operations" cũ): đọc được với quyền xem; nút ghi theo cổng G2 như cũ.
    "fleet-operations": {
      size: "lg",
      title: t("fleet.op.registryTitle", "Operation registry"),
      description: t("fleet.op.registryDesc", "Operation codes, the programs qualified for each, and the operation → program mapping."),
      render: () => (
        <OperationsRegistry
          operations={operations}
          loading={operationsQ.isLoading}
          canControl={g2CanControl}
          controlReason={g2ControlReason}
          resourceFlagStatus={resourceFlagStatus}
          resolveCode={resolveCode}
          setResolveCode={setResolveCode}
          resolved={resolved}
          resolveLoading={resolveQ.isFetching}
          resolveError={resolveQ.error ? mapTrpcError(resolveQ.error) : null}
        />
      ),
    },
  };
  if (canControl) {
    flyouts["fleet-task-assign"] = {
      size: "sm",
      title: t("fleet.reassignTitle", "Reassign task"),
      description: (id) => {
        const tk = byId(tasks, id);
        return tk ? `${tk.taskKey} · ${tk.requiredCapability}` : t("fleet.reassignTip", "Manually (re)assign to a device");
      },
      // Nút "Gán lại" cũ: chỉ khi có quyền, khoá khi tác vụ đã kết thúc (không theo cờ).
      render: (layer) => {
        const tk = byId(tasks, layer.id);
        if (!tk) return notLoaded(tasksQ.isLoading, "fleet.taskNotFound", "Task #{{id}} is not in the loaded list.", layer.id);
        if (TERMINAL.has(tk.status)) {
          return (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t("fleet.taskTerminal", "Task #{{id}} is finished — it cannot be reassigned.", { id: tk.id })}
            </p>
          );
        }
        return (
          <AssignForm
            key={tk.id}
            task={tk}
            pending={assignM.isPending}
            onSubmit={(deviceId, done) => assignM.mutate({ taskId: tk.id, deviceId }, { onSuccess: done })}
          />
        );
      },
    };
    flyouts["fleet-zone-reserve"] = {
      size: "sm",
      title: t("fleet.reserveTitle", "Reserve zone"),
      description: (id) => {
        const z = byId(zones, id);
        return z ? `${z.name} · ${z.code} · ${z.occupancy}/${z.maxConcurrentRobots}` : t("fleet.reserveTitle", "Reserve zone");
      },
      render: (layer) => {
        if (flagUnsettled) return g1Unsettled();
        const z = byId(zones, layer.id);
        if (!z) return notLoaded(zonesQ.isLoading, "fleet.zoneNotFound", "Zone #{{id}} is not in the loaded list.", layer.id);
        return (
          <ReserveForm
            key={z.id}
            subject={<><span className="font-medium text-foreground">{z.name}</span>{" · "}<span className="font-mono text-xs">{z.code}</span>{" · "}{z.occupancy}/{z.maxConcurrentRobots}</>}
            queueLabel={t("fleet.queueIfFull", "Queue if zone is at capacity (otherwise reject)")}
            submitLabel={t("fleet.reserve", "Reserve")}
            icon={<MapPin className="mr-1 h-4 w-4" />}
            pending={reserveM.isPending}
            onSubmit={(deviceId, queueIfFull, done) =>
              reserveM.mutate({ zoneId: z.id, deviceId, queueIfFull }, { onSuccess: (res) => { if (!isRejectedClaim(res)) done(); } })}
          />
        );
      },
    };
    flyouts["fleet-operation-new"] = {
      size: "md",
      title: t("fleet.op.createTitle", "New operation code"),
      description: t("fleet.op.registryTitle", "Operation registry"),
      render: () =>
        resourceFlagUnsettled ? g2Unsettled() : (
          <CreateOperationForm pending={createOpM.isPending} onSubmit={(v, done) => createOpM.mutate(v, { onSuccess: done })} />
        ),
    };
    // Nút "Ánh xạ chương trình" cũ chỉ hiện khi g2CanControl ⇒ deep link lúc cờ chưa rõ chỉ báo trạng thái.
    flyouts["fleet-operation-map"] = {
      size: "md",
      title: t("fleet.op.mapTitle", "Map program to operation"),
      description: (id) => {
        const op = byId(operations, id);
        return op ? `${op.code} · ${op.requiredCapability}` : t("fleet.op.registryTitle", "Operation registry");
      },
      render: (layer) => {
        if (resourceFlagUnsettled) return g2Unsettled();
        const op = byId(operations, layer.id);
        if (!op) return notLoaded(operationsQ.isLoading, "fleet.op.opNotLoaded", "Operation #{{id}} is not in the loaded list.", layer.id);
        return (
          <MapProgramForm
            key={op.id}
            operation={op}
            pending={mapProgramM.isPending}
            onSubmit={(programProjectId, deviceKind, done) =>
              mapProgramM.mutate({ operationCodeId: op.id, programProjectId, deviceKind }, { onSuccess: done })}
          />
        );
      },
    };
    flyouts["fleet-resource-new"] = {
      size: "md",
      title: t("fleet.res.createTitle", "New shared resource"),
      description: t("fleet.res.title", "Shared resources"),
      render: () =>
        resourceFlagUnsettled ? g2Unsettled() : (
          <CreateResourceForm pending={createResourceM.isPending} onSubmit={(v, done) => createResourceM.mutate(v, { onSuccess: done })} />
        ),
    };
    flyouts["fleet-resource-reserve"] = {
      size: "sm",
      title: t("fleet.res.reserveTitle", "Reserve resource"),
      description: (id) => {
        const r = byId(resources, id);
        return r ? `${r.name ?? r.code} · ${r.code} · ${r.type}` : t("fleet.res.title", "Shared resources");
      },
      render: (layer) => {
        if (resourceFlagUnsettled) return g2Unsettled();
        const r = byId(resources, layer.id);
        if (!r) return notLoaded(resourcesQ.isLoading, "fleet.res.notLoaded", "Resource #{{id}} is not in the loaded list.", layer.id);
        return (
          <ReserveForm
            key={r.id}
            subject={<><span className="font-medium text-foreground">{r.name ?? r.code}</span>{" · "}<span className="font-mono text-xs">{r.code}</span>{" · "}{r.type}</>}
            queueLabel={t("fleet.res.queueIfFull", "Queue if the resource is in use (otherwise reject)")}
            submitLabel={t("fleet.res.reserve", "Reserve")}
            icon={<Wrench className="mr-1 h-4 w-4" />}
            pending={reserveResourceM.isPending}
            onSubmit={(deviceId, queueIfFull, done) =>
              reserveResourceM.mutate({ resourceId: r.id, deviceId, queueIfFull }, { onSuccess: (res) => { if (!isRejectedClaim(res)) done(); } })}
          />
        );
      },
    };
    flyouts["fleet-charger-new"] = {
      size: "md",
      title: t("fleet.charger.createTitle", "New charger station"),
      description: t("fleet.charger.title", "Charger stations"),
      render: () =>
        resourceFlagUnsettled ? g2Unsettled() : (
          <CreateChargerForm pending={createChargerM.isPending} onSubmit={(v, done) => createChargerM.mutate(v, { onSuccess: done })} />
        ),
    };
  }

  // < 1280 px: header chỉ giữ h1 + dải KPI (chip GHIM vẫn hiện); chip cờ + ghi chú xuống đầu MAIN (header hẹp cắt
  // phần tràn — cờ chưa rõ / đang tắt không được biến mất im lặng).
  const narrowNotices = narrow ? (
    <div data-narrow-notices="" className="flex flex-wrap items-center gap-1.5 pb-2">
      {g1FlagChip}
      {g2FlagChip}
      <NoticeStack maxVisible={2} items={noticeItems} />
    </div>
  ) : null;

  const sideCtx: SidePanelProps = {
    sideTab,
    setSideTab,
    canControl,
    permReason,
    g1CanControl,
    g1ControlReason,
    g2CanControl,
    g2ControlReason,
    deadlocks: deadlocks?.cycles ?? [],
    deadlockRef,
    resolveDeadlockPending: resolveDeadlockM.isPending,
    onResolveDeadlock: () => resolveDeadlockM.mutate(),
    tasks,
    tasksLoading: anyLoading,
    tasksUpdatedAt: tasksQ.dataUpdatedAt,
    tasksFetching: tasksQ.isFetching,
    statusFilter,
    setStatusFilter,
    allocatePending: allocateM.isPending,
    onAllocate: (tk) => allocateM.mutate({ taskId: tk.id }),
    onCancel: (tk) => setCancelTarget(tk),
    zones,
    zonesLoading: anyLoading,
    resByZone,
    selectedZoneId,
    releasePending: releaseM.isPending,
    onReleaseZone: (deviceId, zoneId) => releaseM.mutate({ deviceId, zoneId }),
    resources,
    resourcesLoading: resourcesQ.isLoading,
    resReservationsByResource,
    releaseResourcePending: releaseResourceM.isPending,
    onReleaseResource: (deviceId, resourceId) => releaseResourceM.mutate({ deviceId, resourceId }),
    chargers,
    chargersLoading: chargersQ.isLoading,
    plans: chargingPlans,
    plansLoading: chargingPlansQ.isLoading,
    sweepPending: sweepM.isPending,
    onSweep: () => sweepM.mutate(),
  };

  return (
    <DashboardLayout>
      <FlyoutHost flyouts={flyouts}>
        {/* doc 81 Đợt 2 Task 2 — PageContainer: không đệm kép với <main> của shell. */}
        <PageContainer className="space-y-0">
          <CockpitLayout
            icon={<Truck />}
            title={
              <span className="flex items-center gap-2">
                {t("fleet.title", "Fleet & Task Orchestration")}
                {!canControl && <ViewOnlyBadge module="machine_control" />}
              </span>
            }
            chips={
              <>
                {!narrow && g1FlagChip}
                {!narrow && g2FlagChip}
                <StatusChipStrip
                  items={chipItems}
                  maxVisible={kpiWide ? 5 : 3}
                  ariaLabel={t("fleet.chip.stripLabel", "Fleet indicators")}
                  className="shrink-0"
                />
                {/* Ghi chú đứng SAU dải KPI: header chật thì chúng bị cắt trước, không phải số liệu. */}
                {/* MỘT chip ghi chú + "+1" (đo 1600 px: chip thứ hai bị vùng hành động che). */}
                {!narrow && <NoticeStack maxVisible={1} items={noticeItems} />}
              </>
            }
            actions={<HeaderActions compact={!kpiWide} onRefresh={refetchAll} />}
            toolbar={
              <MapToolbar
                factoryIds={factoryIds}
                factoryId={effectiveFactoryId}
                onFactoryChange={setMapFactoryId}
                located={(robotPositionsQ.data ?? []).filter((r) => r.x != null && r.y != null).length}
                total={(robotPositionsQ.data ?? []).length}
              />
            }
            main={
              <>
                {narrowNotices}
                <FleetMap
                  grid={occupancyGridQ.data}
                  gridLoading={occupancyGridQ.isLoading}
                  gridError={occupancyGridQ.error ? mapTrpcError(occupancyGridQ.error) : null}
                  robots={(robotPositionsQ.data ?? []) as FleetRobotPos[]}
                  robotsLoading={robotPositionsQ.isLoading}
                  zones={zones}
                  selectedZoneId={selectedZoneId}
                  onZoneSelect={selectZoneOnMap}
                />
              </>
            }
            side={<FleetSidePanel {...sideCtx} />}
            sideWidth={kpiWide ? SIDE_WIDTH_WIDE : SIDE_WIDTH}
            sideLabel={t("fleet.side.label", "Tasks, zones, charging and resources")}
            mainName="fleet-orchestration"
          />
        </PageContainer>

        {/* ── Cancel confirm (R-2-n: như cũ — AlertDialog, một tác vụ mỗi lần xác nhận) ── */}
        <AlertDialog open={!!cancelTarget} onOpenChange={(o) => !o && setCancelTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("fleet.cancelConfirmTitle", "Cancel task?")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("fleet.cancelConfirmBody", "This marks the task cancelled (terminal). It cannot be undone.")}
                {cancelTarget && <span className="mt-1 block font-mono text-xs">{cancelTarget.taskKey}</span>}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={() => cancelTarget && cancelM.mutate({ taskId: cancelTarget.id })}>
                {t("fleet.confirmCancelTask", "Cancel task")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </FlyoutHost>
    </DashboardLayout>
  );
}

/** Hành động header: mở sổ đăng ký thao tác (sheet) + làm mới. <1600 px nút sổ chỉ còn icon (tên ở aria-label). */
function HeaderActions({ compact, onRefresh }: { compact: boolean; onRefresh: () => void }) {
  const { t } = useTranslation();
  const flyout = useFlyout();
  const label = t("fleet.op.registryTitle", "Operation registry");
  return (
    <>
      <Button
        size={compact ? "icon" : "sm"}
        variant="outline"
        className={compact ? "h-8 w-8" : "h-8"}
        aria-label={compact ? label : undefined}
        title={label}
        onClick={() => flyout.open("fleet-operations")}
      >
        <Workflow className={compact ? "h-4 w-4" : "mr-1 h-4 w-4"} />
        {!compact && label}
      </Button>
      <Button size="icon" variant="ghost" onClick={onRefresh} title={t("common.refresh", "Refresh")} aria-label={t("common.refresh", "Refresh")}>
        <RefreshCw className="h-4 w-4" />
      </Button>
    </>
  );
}

/** Hàng công cụ DUY NHẤT trong MAIN (≤56 px): tên bản đồ · nhà máy · số robot có vị trí. */
function MapToolbar({
  factoryIds, factoryId, onFactoryChange, located, total,
}: {
  factoryIds: number[];
  factoryId: number;
  onFactoryChange: (id: number) => void;
  located: number;
  total: number;
}) {
  const { t } = useTranslation();
  const uid = useId();
  return (
    <>
      <h2 className="flex min-w-0 items-center gap-2 truncate text-sm font-semibold">
        <MapIcon className="h-4 w-4 shrink-0" aria-hidden="true" />{t("fleet.map.title", "Fleet map")}
      </h2>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <span className="text-xs text-muted-foreground tabular-nums">
          {t("fleet.map.locatedRobots", "Located robots")}: {located}/{total}
        </span>
        <Label htmlFor={`${uid}-factory`} className="text-xs text-muted-foreground">{t("fleet.map.factory", "Factory")}</Label>
        <Select value={String(factoryId)} onValueChange={(v) => onFactoryChange(Number(v))}>
          <SelectTrigger id={`${uid}-factory`} size="sm" className="w-28"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(factoryIds.length ? factoryIds : [factoryId]).map((f) => (
              <SelectItem key={f} value={String(f)}>#{f}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// W4-18 (3) — FLEET MAP (2D occupancy grid + zone occupancy overlays + live robot
// markers). Read-only visualisation over twinRouter.occupancyGrid + fleet.robotPositions.
// Renders with plain inline SVG in WORLD coordinates (Y flipped so higher-y is up) so
// there are no mirrored labels — no extra deps. Degrades to an honest empty state when
// there is no grid geometry / no located robots.
// ══════════════════════════════════════════════════════════════════════════════

/** Occupancy tint (green → amber → red) for a zone's occupancy ratio. */
function occTint(ratio: number): string {
  if (ratio >= 1) return "#ef4444";
  if (ratio >= 0.6) return "#f59e0b";
  return "#10b981";
}
/** Marker colour by robot registry status. */
function robotColor(status: string): string {
  switch (status) {
    case "estop": return "#ef4444";
    case "offline": return "#94a3b8";
    case "busy":
    case "running": return "#3b82f6";
    default: return "#10b981"; // idle / online
  }
}
/** Coerce a zone `bounds` jsonb into {x,y,w,h} (mirrors server boundsToRect shapes). */
function boundsToRectLike(bounds: Record<string, unknown> | null | undefined): { x: number; y: number; w: number; h: number } | null {
  if (!bounds) return null;
  if (typeof bounds.x === "number" && typeof bounds.y === "number" && typeof bounds.w === "number" && typeof bounds.h === "number") {
    return { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h };
  }
  const min = bounds.min as number[] | undefined;
  const max = bounds.max as number[] | undefined;
  if (Array.isArray(min) && Array.isArray(max) && min.length >= 2 && max.length >= 2) {
    return { x: min[0], y: min[1], w: max[0] - min[0], h: max[1] - min[1] };
  }
  return null;
}

/** Khung bản đồ (MAIN của Fleet): cao theo khung nhìn trừ chrome thật của shell (R-2-z4); dùng chung cho bản đồ và trạng thái tải/trống. */
const MAP_FRAME = "h-[max(18rem,calc(100dvh_-_var(--shell-chrome-h,3.5rem)_-_11.5rem))] w-full rounded-md border border-border bg-muted/20";

function FleetMap({
  grid, gridLoading, gridError, robots, robotsLoading, zones, selectedZoneId, onZoneSelect,
}: {
  grid: FleetOccupancyGrid | undefined;
  gridLoading: boolean;
  gridError: string | null;
  robots: FleetRobotPos[];
  robotsLoading: boolean;
  zones: FleetZone[];
  selectedZoneId: number | null;
  onZoneSelect: (zoneId: number) => void;
}) {
  const { t } = useTranslation();
  const g = grid?.grid ?? null;

  // Zones with a rectangular bounds blob → drawable overlays tinted by occupancy.
  const zoneRects = useMemo(() => {
    const out: Array<{ id: number; code: string; name: string; occupancy: number; max: number; x: number; y: number; w: number; h: number; ratio: number }> = [];
    for (const z of zones) {
      const r = boundsToRectLike(z.bounds as Record<string, unknown> | null | undefined);
      if (!r) continue;
      const ratio = z.maxConcurrentRobots > 0 ? Math.min(1, z.occupancy / z.maxConcurrentRobots) : 0;
      out.push({ id: z.id, code: z.code, name: z.name, occupancy: z.occupancy, max: z.maxConcurrentRobots, ...r, ratio });
    }
    return out;
  }, [zones]);

  const locatedRobots = useMemo(
    () => robots.filter((r) => r.x != null && r.y != null) as Array<FleetRobotPos & { x: number; y: number }>,
    [robots],
  );

  // World bounding box over grid + zones + robots (pad slightly).
  const bbox = useMemo(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const acc = (x: number, y: number) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
    if (g) { acc(g.originX, g.originY); acc(g.originX + g.cols * g.cellSize, g.originY + g.rows * g.cellSize); }
    for (const zr of zoneRects) { acc(zr.x, zr.y); acc(zr.x + zr.w, zr.y + zr.h); }
    for (const r of locatedRobots) acc(r.x, r.y);
    if (!Number.isFinite(minX)) return null;
    const padX = Math.max(1, (maxX - minX) * 0.05);
    const padY = Math.max(1, (maxY - minY) * 0.05);
    return { minX: minX - padX, minY: minY - padY, maxX: maxX + padX, maxY: maxY + padY };
  }, [g, zoneRects, locatedRobots]);

  // Hệ toạ độ vẽ như cũ (720 đơn vị ngang); SVG nay co theo vùng MAIN (viewBox + preserveAspectRatio).
  const VIEW_W = 720;
  const worldW = bbox ? bbox.maxX - bbox.minX : 1;
  const worldH = bbox ? bbox.maxY - bbox.minY : 1;
  const scale = bbox && worldW > 0 ? VIEW_W / worldW : 1;
  const VIEW_H = bbox ? Math.max(160, Math.min(560, worldH * scale)) : 200;
  // world → screen (flip Y so higher world-y renders upward → no mirrored text)
  const sx = (wx: number) => (wx - (bbox?.minX ?? 0)) * scale;
  const sy = (wy: number) => ((bbox?.maxY ?? 0) - wy) * scale;

  const hasAnything = bbox != null && (g != null || zoneRects.length > 0 || locatedRobots.length > 0);
  const loading = gridLoading || robotsLoading;

  return (
    <div data-fleet-map="" className="flex flex-col gap-2">
      {/* final wave T10 — trạng thái tải / trống giữ ĐÚNG khung cao của bản đồ (MAIN không co lại khi chưa có hình học;
          trước đây lưới 40×40 rỗng của factoryId=1 dự phòng che mất trạng thái trống này). */}
      {loading && <p data-fleet-map-state="loading" className={`${MAP_FRAME} flex items-center justify-center text-sm text-muted-foreground`}>{t("fleet.loading", "Loading…")}</p>}
      {!loading && !hasAnything && (
        <p data-fleet-map-state="empty" className={`${MAP_FRAME} flex items-center justify-center px-6 text-center text-sm text-muted-foreground`}>
          {t("fleet.map.empty", "No map geometry or located robots yet. Add zone bounds and robot telemetry poses to populate the map.")}
        </p>
      )}
      {!loading && hasAnything && (
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="xMidYMid meet"
          className={`${MAP_FRAME} text-foreground`}
          role="img" aria-label={t("fleet.map.title", "Fleet map")}
        >
          {/* blocked grid cells */}
          {g?.cells && g.cells.map((row, r) =>
            row.map((blocked, c) => blocked ? (
              <rect
                key={`c-${r}-${c}`}
                x={sx(g.originX + c * g.cellSize)}
                y={sy(g.originY + (r + 1) * g.cellSize)}
                width={g.cellSize * scale}
                height={g.cellSize * scale}
                fill="currentColor" fillOpacity={0.22}
              />
            ) : null),
          )}
          {/* zone overlays tinted by occupancy — bấm (hoặc Enter/Space) ⇒ mở vùng ở tab Vùng */}
          {zoneRects.map((zr) => (
            <g
              key={`z-${zr.id}`}
              data-zone-id={zr.id}
              role="button"
              tabIndex={0}
              aria-label={t("fleet.map.zoneOpen", "Zone {{code}} — {{occupancy}}/{{max}} robots; open in the Zones tab", { code: zr.code, occupancy: zr.occupancy, max: zr.max })}
              aria-pressed={selectedZoneId === zr.id}
              className="cursor-pointer focus:outline-none [&:focus-visible>rect]:stroke-[3]"
              onClick={() => onZoneSelect(zr.id)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onZoneSelect(zr.id); } }}
            >
              <rect
                x={sx(zr.x)} y={sy(zr.y + zr.h)}
                width={zr.w * scale} height={zr.h * scale}
                fill={occTint(zr.ratio)} fillOpacity={selectedZoneId === zr.id ? 0.45 : 0.3}
                stroke={occTint(zr.ratio)} strokeOpacity={0.8} strokeWidth={selectedZoneId === zr.id ? 3 : 1}
              />
              <text x={sx(zr.x) + 3} y={sy(zr.y + zr.h) + 12} fill="currentColor" className="text-[10px]">{zr.code}</text>
            </g>
          ))}
          {/* live robot markers */}
          {locatedRobots.map((r) => (
            <g key={`r-${r.id}`}>
              <circle cx={sx(r.x)} cy={sy(r.y)} r={6} fill={robotColor(r.status)} stroke="white" strokeWidth={1.5}>
                <title>{`#${r.id} ${r.code} · ${r.status}${r.battery != null ? ` · ${Math.round(r.battery)}%` : ""}`}</title>
              </circle>
              <text x={sx(r.x) + 8} y={sy(r.y) + 3} fill="currentColor" className="text-[10px]">{r.code}</text>
            </g>
          ))}
        </svg>
      )}
      {!loading && gridError && <p className="text-center text-sm text-muted-foreground">{gridError}</p>}
      {/* legend + honest note */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />{t("fleet.map.online", "Online")}</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-blue-500" />{t("fleet.map.busy", "Busy")}</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-slate-400" />{t("fleet.map.offline", "Offline")}</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" />{t("fleet.map.estop", "E-stop")}</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 bg-foreground/25" />{t("fleet.map.blocked", "Blocked cell")}</span>
      </div>
      {grid?.note && <p className="text-xs text-muted-foreground">{grid.note}</p>}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Side panel — khối bế tắc (luôn thấy khi có) + tab Tác vụ / Vùng / Sạc / Tài nguyên (`?tab=`)
// ══════════════════════════════════════════════════════════════════════════════
interface SidePanelProps {
  sideTab: SideTab;
  setSideTab: (v: string) => void;
  canControl: boolean;
  permReason?: string;
  g1CanControl: boolean;
  g1ControlReason?: string;
  g2CanControl: boolean;
  g2ControlReason?: string;
  deadlocks: number[][];
  deadlockRef: RefObject<HTMLDivElement | null>;
  resolveDeadlockPending: boolean;
  onResolveDeadlock: () => void;
  tasks: FleetTask[];
  tasksLoading: boolean;
  tasksUpdatedAt: number | undefined;
  tasksFetching: boolean;
  statusFilter: string;
  setStatusFilter: (v: string) => void;
  allocatePending: boolean;
  onAllocate: (tk: FleetTask) => void;
  onCancel: (tk: FleetTask) => void;
  zones: FleetZone[];
  zonesLoading: boolean;
  resByZone: Map<number, FleetReservation[]>;
  selectedZoneId: number | null;
  releasePending: boolean;
  onReleaseZone: (deviceId: number, zoneId: number) => void;
  resources: FleetResource[];
  resourcesLoading: boolean;
  resReservationsByResource: Map<number, FleetResReservation[]>;
  releaseResourcePending: boolean;
  onReleaseResource: (deviceId: number, resourceId: number) => void;
  chargers: FleetCharger[];
  chargersLoading: boolean;
  plans: FleetChargingPlan[];
  plansLoading: boolean;
  sweepPending: boolean;
  onSweep: () => void;
}

function FleetSidePanel(p: SidePanelProps) {
  const { t } = useTranslation();
  return (
    <div className="flex max-h-[calc(100dvh_-_var(--shell-chrome-h,3.5rem)_-_4.5rem)] min-h-0 flex-col gap-3 overflow-auto">
      {/* Deadlock detail (khối đỏ cũ) — ngoài MAIN, luôn thấy khi có chu trình, không phụ thuộc tab. */}
      {p.deadlocks.length > 0 && (
        <div
          ref={p.deadlockRef}
          tabIndex={-1}
          role="alert"
          data-fleet-deadlocks={p.deadlocks.length}
          className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
        >
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="min-w-0">
            <div className="font-medium text-destructive">
              {t("fleet.deadlockTitle", "Deadlock cycle(s) detected")}
            </div>
            <div className="mt-1 space-y-0.5 text-muted-foreground">
              {p.deadlocks.map((cycle, i) => (
                <div key={i} className="font-mono text-xs">
                  {t("fleet.deadlockDevices", "Devices")}: {cycle.join(" → ")} → {cycle[0]}
                </div>
              ))}
            </div>
            {/* W4-18 (5) — advisory resolve: huỷ waiter ưu tiên thấp nhất để phá deadlock (một cú bấm như cũ). */}
            <Button
              size="sm" variant="destructive" className="mt-2 h-7"
              disabled={!p.g1CanControl || p.resolveDeadlockPending}
              title={p.g1ControlReason}
              onClick={p.onResolveDeadlock}
            >
              <ShieldAlert className="mr-1 h-3.5 w-3.5" />{t("fleet.resolveDeadlock", "Resolve deadlock")}
            </Button>
          </div>
        </div>
      )}
      <Tabs value={p.sideTab} onValueChange={p.setSideTab} className="gap-2">
        <TabsList className="w-full">
          <TabsTrigger value="tasks" className="flex-1 text-xs"><ListChecks className="mr-1 h-3.5 w-3.5" />{t("fleet.tab.tasks", "Tasks")}</TabsTrigger>
          <TabsTrigger value="zones" className="flex-1 text-xs"><Layers className="mr-1 h-3.5 w-3.5" />{t("fleet.tab.zones", "Zones")}</TabsTrigger>
          <TabsTrigger value="charging" className="flex-1 text-xs"><BatteryCharging className="mr-1 h-3.5 w-3.5" />{t("fleet.tab.charging", "Charging")}</TabsTrigger>
          <TabsTrigger value="resources" className="flex-1 text-xs"><Wrench className="mr-1 h-3.5 w-3.5" />{t("fleet.tab.resources", "Resources")}</TabsTrigger>
        </TabsList>
        <TabsContent value="tasks"><TasksPanel {...p} /></TabsContent>
        <TabsContent value="zones"><ZonesPanel {...p} /></TabsContent>
        <TabsContent value="charging"><ChargingPanel {...p} /></TabsContent>
        <TabsContent value="resources"><ResourcesPanel {...p} /></TabsContent>
      </Tabs>
    </div>
  );
}

/** Tác vụ (G1): hàng đợi — bảng gọn cho panel phụ (khoá + nhãn nguồn; năng lực/ưu tiên/thời lượng/thử lại ở dòng 2). */
function TasksPanel(p: SidePanelProps) {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const flyout = useFlyout();
  const uid = useId();
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {/* U12 §2.3 — độ tươi của dữ liệu poll (dataUpdatedAt của react-query). */}
        <PollFreshness updatedAt={p.tasksUpdatedAt} isFetching={p.tasksFetching} />
        <Label htmlFor={`${uid}-status`} className="ml-auto text-xs text-muted-foreground">{t("fleet.filterStatus", "Status")}</Label>
        {/* U11 — Select DS; "__all__" là sentinel cho "tất cả trạng thái". */}
        <Select value={p.statusFilter || "__all__"} onValueChange={(v) => p.setStatusFilter(v === "__all__" ? "" : v)}>
          <SelectTrigger id={`${uid}-status`} size="sm" className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{t("fleet.all", "All")}</SelectItem>
            {TASK_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{t(`fleet.task.${s}`, s)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <ProvenanceSummary rows={p.tasks} />
      {/* Panel phụ hẹp (400–440 px): đệm ô gọn; cột Thao tác chỉ có tên cho trình đọc màn hình. */}
      <Table aria-label={t("fleet.tasksTitle", "Task queue")} className="text-xs [&_td]:px-1.5 [&_th]:px-1.5">
        <TableHeader>
          <TableRow>
            <TableHead>{t("fleet.col.taskKey", "Task key")}</TableHead>
            <TableHead>{t("fleet.col.status", "Status")}</TableHead>
            <TableHead>{t("fleet.col.device", "Device")}</TableHead>
            <TableHead className="text-right"><span className="sr-only">{t("common.actions", "Actions")}</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {p.tasksLoading && (
            <TableRow>
              <TableCell colSpan={4} className="whitespace-normal py-8 text-center text-muted-foreground">
                {t("fleet.loading", "Loading…")}
              </TableCell>
            </TableRow>
          )}
          {!p.tasksLoading && p.tasks.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="whitespace-normal py-8 text-center text-muted-foreground">
                {t("fleet.tasksEmpty", "No tasks. Tasks are decomposed from production orders or created by an admin.")}
              </TableCell>
            </TableRow>
          )}
          {p.tasks.map((tk) => {
            const terminal = TERMINAL.has(tk.status);
            return (
              <TableRow key={tk.id} data-task-id={tk.id}>
                <TableCell className="max-w-[9rem] whitespace-normal align-top">
                  <span className="inline-flex items-center gap-1.5 font-mono text-xs">
                    <span className="truncate">{tk.taskKey}</span>
                    <ProvenanceBadge row={tk} />
                  </span>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                    <Badge variant="outline" title={t("fleet.col.capability", "Capability")} className="px-1 py-0 text-[10px]">{tk.requiredCapability}</Badge>
                    <Badge variant={tk.priority <= 2 ? "destructive" : "outline"} title={t("fleet.col.priority", "Priority")} className="px-1 py-0 text-[10px]">P{tk.priority}</Badge>
                    <span title={t("fleet.col.duration", "Est / Act")} className="whitespace-nowrap">
                      {fmtDuration(tk.estimatedDurationMs)} / {fmtDuration(tk.actualDurationMs)}
                    </span>
                    <span title={t("fleet.col.retries", "Retries")} className="tabular-nums">↻{tk.retryCount}</span>
                  </div>
                </TableCell>
                <TableCell className="align-top">{taskStatusBadge(tk.status, t)}</TableCell>
                <TableCell className="align-top text-xs">
                  {tk.assignedDeviceId != null
                    ? <button
                        type="button"
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                        title={t("fleet.openRobotCockpit", "Open robot cockpit")}
                        onClick={() => setLocation(`/robot/${tk.assignedDeviceId}`)}
                      ><Bot className="h-3 w-3" />#{tk.assignedDeviceId}</button>
                    : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="align-top text-right">
                  {p.canControl ? (
                    // final wave T10 — Phân bổ là một cú bấm không xác nhận: không đặt sát Gán lại (gap-1.5 như hàng nút cũ trở lên).
                    <div className="flex justify-end gap-1.5">
                      <Button
                        size="icon" variant="ghost" className="h-7 w-7"
                        disabled={terminal || tk.status === "running" || p.allocatePending}
                        aria-label={t("fleet.allocate", "Allocate")}
                        title={t("fleet.allocateTip", "Run the allocator (assign best device)")}
                        onClick={() => p.onAllocate(tk)}
                      >
                        <Play className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon" variant="ghost" className="h-7 w-7"
                        disabled={terminal}
                        aria-label={t("fleet.reassign", "Reassign")}
                        title={t("fleet.reassignTip", "Manually (re)assign to a device")}
                        onClick={() => flyout.open("fleet-task-assign", { id: tk.id })}
                      >
                        <Send className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon" variant="ghost" className="h-7 w-7"
                        disabled={terminal}
                        aria-label={t("fleet.cancel", "Cancel")}
                        title={t("fleet.cancelTip", "Cancel this task")}
                        onClick={() => p.onCancel(tk)}
                      >
                        <Ban className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">{t("fleet.viewOnly", "View only")}</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/** Vùng (G1): mức chiếm dụng + đặt chỗ đang giữ (Giải phóng một cú bấm như cũ) + Đặt trước (sheet). */
function ZonesPanel(p: SidePanelProps) {
  const { t } = useTranslation();
  const flyout = useFlyout();
  const selectedRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (p.selectedZoneId != null) selectedRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [p.selectedZoneId]);
  return (
    <section aria-label={t("fleet.zonesTitle", "Zones & occupancy")} className="space-y-2">
      {!p.zonesLoading && p.zones.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t("fleet.zonesEmpty", "No zones defined yet.")}
        </p>
      )}
      {p.zones.map((z) => {
        const pct = z.maxConcurrentRobots > 0
          ? Math.min(100, (z.occupancy / z.maxConcurrentRobots) * 100)
          : 0;
        const atCap = z.occupancy >= z.maxConcurrentRobots;
        const zoneRes = p.resByZone.get(z.id) ?? [];
        const selected = p.selectedZoneId === z.id;
        return (
          <Card
            key={z.id}
            ref={selected ? selectedRef : undefined}
            data-zone-card={z.id}
            aria-current={selected ? "true" : undefined}
            className={selected ? "border-primary ring-2 ring-primary/40" : "border-border/60"}
          >
            <CardContent className="space-y-2 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium">{z.name}</div>
                  <div className="font-mono text-xs text-muted-foreground">{z.code}</div>
                </div>
                {zoneTypeBadge(z.zoneType, t)}
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{t("fleet.occupancy", "Occupancy")}</span>
                  <span className={`tabular-nums font-medium ${atCap ? "text-amber-500" : ""}`}>
                    {z.occupancy} / {z.maxConcurrentRobots}
                  </span>
                </div>
                <Progress
                  value={pct}
                  className={atCap ? "[&>[data-slot=progress-indicator]]:bg-amber-500" : ""}
                />
              </div>
              {/* Reservations on this zone */}
              {zoneRes.length > 0 && (
                <div className="space-y-1 pt-1">
                  {zoneRes.map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="inline-flex items-center gap-1">
                        <Bot className="h-3 w-3" />#{r.deviceId}
                        {resStatusBadge(r.status, t)}
                      </span>
                      {p.canControl && r.status !== "released" && r.status !== "rejected" && (
                        <Button
                          size="sm" variant="ghost" className="h-6 px-2 text-xs"
                          disabled={p.releasePending}
                          onClick={() => p.onReleaseZone(r.deviceId, z.id)}
                        >
                          {t("fleet.release", "Release")}
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <Button
                size="sm" variant="outline" className="mt-1 h-7 w-full"
                disabled={!p.g1CanControl}
                title={p.g1ControlReason}
                onClick={() => flyout.open("fleet-zone-reserve", { id: z.id })}
              >
                <MapPin className="mr-1 h-3.5 w-3.5" />{t("fleet.reserve", "Reserve")}
              </Button>
            </CardContent>
          </Card>
        );
      })}
    </section>
  );
}

/** Tài nguyên (G2-c): tài nguyên dùng chung + đặt trước (sheet) + giải phóng (một cú bấm như cũ). */
function ResourcesPanel(p: SidePanelProps) {
  const { t } = useTranslation();
  const flyout = useFlyout();
  // Như ResourcesTab cũ: mọi nút ghi (kể cả Giải phóng) theo cổng G2 (quyền + cờ đã rõ).
  const canControl = p.g2CanControl;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-medium"><Wrench className="h-4 w-4" />{t("fleet.res.title", "Shared resources")}</h3>
        <Button size="sm" variant="outline" className="h-7" disabled={!canControl} title={p.g2ControlReason} onClick={() => flyout.open("fleet-resource-new")}>
          <Plus className="mr-1 h-4 w-4" />{t("fleet.res.create", "New resource")}
        </Button>
      </div>
      {!p.resourcesLoading && p.resources.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t("fleet.res.empty", "No shared resources (jigs / grippers / fixtures) defined yet.")}
        </p>
      )}
      {p.resources.map((r) => {
        const av = r.availability;
        const activeCount = av?.activeCount ?? 0;
        const queuedCount = av?.queuedCount ?? 0;
        const resReservations = p.resReservationsByResource.get(r.id) ?? [];
        return (
          <Card key={r.id} data-resource-card={r.id} className="border-border/60">
            <CardContent className="space-y-2 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium">{r.name ?? r.code}</div>
                  <div className="font-mono text-xs text-muted-foreground">{r.code}</div>
                </div>
                {resourceTypeBadge(r.type, t)}
              </div>
              <div className="flex items-center justify-between gap-2 text-xs">
                {resourceStatusBadge(r.status, t)}
                <span className="text-muted-foreground">
                  {r.currentOwnerDeviceId != null
                    ? <span className="inline-flex items-center gap-1"><Bot className="h-3 w-3" />#{r.currentOwnerDeviceId}</span>
                    : t("fleet.res.unowned", "unowned")}
                </span>
              </div>
              {(activeCount > 0 || queuedCount > 0) && (
                <div className="text-xs text-muted-foreground">
                  {t("fleet.res.activeLabel", "Active")}: {activeCount} · {t("fleet.res.queuedLabel", "Queued")}: {queuedCount}
                </div>
              )}
              {resReservations.length > 0 && (
                <div className="space-y-1 pt-1">
                  {resReservations.map((rr) => (
                    <div key={rr.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="inline-flex items-center gap-1">
                        <Bot className="h-3 w-3" />#{rr.deviceId}
                        {resStatusBadge(rr.status, t)}
                      </span>
                      {canControl && (
                        <Button
                          size="sm" variant="ghost" className="h-6 px-2 text-xs"
                          disabled={p.releaseResourcePending}
                          onClick={() => p.onReleaseResource(rr.deviceId, r.id)}
                        >
                          {t("fleet.release", "Release")}
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <Button size="sm" variant="outline" className="mt-1 h-7 w-full" disabled={!canControl} title={p.g2ControlReason} onClick={() => flyout.open("fleet-resource-reserve", { id: r.id })}>
                <Wrench className="mr-1 h-3.5 w-3.5" />{t("fleet.res.reserve", "Reserve")}
              </Button>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

/** Sạc (G2-d): trạm sạc (tạo = sheet) + kế hoạch sạc pin + Quét ngay (một cú bấm như cũ). */
function ChargingPanel(p: SidePanelProps) {
  const { t } = useTranslation();
  const flyout = useFlyout();
  const canControl = p.g2CanControl;
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-sm font-medium"><Zap className="h-4 w-4" />{t("fleet.charger.title", "Charger stations")}</h3>
          <Button size="sm" variant="outline" className="h-7" disabled={!canControl} title={p.g2ControlReason} onClick={() => flyout.open("fleet-charger-new")}>
            <Plus className="mr-1 h-4 w-4" />{t("fleet.charger.create", "New charger")}
          </Button>
        </div>
        {!p.chargersLoading && p.chargers.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">{t("fleet.charger.empty", "No charger stations defined yet.")}</p>
        )}
        {p.chargers.map((c) => (
          <Card key={c.id} data-charger-card={c.id} className="border-border/60">
            <CardContent className="space-y-1 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium">{c.name ?? c.code}</div>
                  <div className="font-mono text-xs text-muted-foreground">{c.code}</div>
                </div>
                {chargerStatusBadge(c.status, t)}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">{c.chargerType}</Badge>
                {c.powerWatts != null && <span className="tabular-nums">{c.powerWatts} W</span>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-sm font-medium"><BatteryCharging className="h-4 w-4" />{t("fleet.plan.title", "Battery charging plans")}</h3>
          <Button size="sm" variant="outline" className="h-7" disabled={!canControl || p.sweepPending} title={p.g2ControlReason} onClick={p.onSweep}>
            <RefreshCw className={`mr-1 h-4 w-4 ${p.sweepPending ? "animate-spin" : ""}`} />{t("fleet.plan.sweep", "Sweep now")}
          </Button>
        </div>
        <Table className="text-xs [&_td]:px-1.5 [&_th]:px-1.5">
          <TableHeader>
            <TableRow>
              <TableHead>{t("fleet.plan.col.device", "Device")}</TableHead>
              <TableHead>{t("fleet.plan.col.energy", "Current %")}</TableHead>
              <TableHead>{t("fleet.plan.col.start", "Planned start")}</TableHead>
              <TableHead>{t("fleet.plan.col.status", "Status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {p.plansLoading && (
              <TableRow><TableCell colSpan={4} className="whitespace-normal py-6 text-center text-muted-foreground">{t("fleet.loading", "Loading…")}</TableCell></TableRow>
            )}
            {!p.plansLoading && p.plans.length === 0 && (
              <TableRow><TableCell colSpan={4} className="whitespace-normal py-6 text-center text-muted-foreground">{t("fleet.plan.empty", "No charging plans. Run a sweep to schedule preemptive charges.")}</TableCell></TableRow>
            )}
            {p.plans.map((pl) => (
              <TableRow key={pl.id} data-plan-id={pl.id}>
                <TableCell className="text-xs"><span className="inline-flex items-center gap-1"><Bot className="h-3 w-3" />#{pl.deviceId}</span></TableCell>
                <TableCell className="text-xs tabular-nums">{pl.currentEnergyPct != null ? `${pl.currentEnergyPct}%` : "—"}</TableCell>
                <TableCell
                  className="text-xs whitespace-nowrap"
                  title={`${t("fleet.plan.col.duration", "Est duration")}: ${fmtDuration(pl.estimatedDurationMs)}${pl.reason ? ` · ${t("fleet.plan.col.reason", "Reason")}: ${pl.reason}` : ""}`}
                >
                  {fmtDateTime(pl.plannedStartAt)}
                  <div className="text-[11px] text-muted-foreground">
                    {fmtDuration(pl.estimatedDurationMs)}{pl.reason ? ` · ${pl.reason}` : ""}
                  </div>
                </TableCell>
                <TableCell>{planStatusBadge(pl.status, t)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// G2-a — SỔ ĐĂNG KÝ THAO TÁC (sheet; tab "Operations" cũ)
// ══════════════════════════════════════════════════════════════════════════════
function OperationsRegistry({
  operations, loading, canControl, controlReason, resourceFlagStatus, resolveCode, setResolveCode, resolved, resolveLoading,
  resolveError,
}: {
  operations: FleetOperation[];
  loading: boolean;
  canControl: boolean;
  controlReason?: string;
  resourceFlagStatus: FeatureStatus;
  resolveCode: string;
  setResolveCode: (v: string) => void;
  resolved: FleetResolved | undefined;
  resolveLoading: boolean;
  resolveError: string | null;
}) {
  const { t } = useTranslation();
  const flyout = useFlyout();
  const uid = useId();
  const [resolveInput, setResolveInput] = useState(resolveCode);

  return (
    <div className="space-y-4">
      {/* Banner cờ G2 cũ (4 trạng thái) — trong sheet, không phải trước MAIN. */}
      <FeatureStatusGate
        status={resourceFlagStatus}
        offMessage={t(
          "fleet.resourceFlagOffBanner",
          "Preview mode: the fleet resource layer is disabled. Reads work; actions (create / map / reserve / release / sweep) are blocked until it is enabled.",
        )}
        errorMessage={t(
          "fleet.resourceFlagStatusError",
          "Could not check whether the fleet resource layer is enabled — actions are disabled until this is confirmed.",
        )}
      />
      {/* Resolve panel — read-only operation → qualified programs */}
      <section className="space-y-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <Search className="h-4 w-4" />
          {t("fleet.op.resolveTitle", "Resolve operation")}
        </h3>
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1">
            <Label htmlFor={`${uid}-code`} className="text-xs text-muted-foreground">{t("fleet.op.code", "Operation code")}</Label>
            <Input
              id={`${uid}-code`}
              className="w-56"
              value={resolveInput}
              placeholder={t("fleet.op.codePlaceholder", "e.g. OP-WELD-01")}
              onChange={(e) => setResolveInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") setResolveCode(resolveInput.trim()); }}
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => setResolveCode(resolveInput.trim())}>
            <Search className="mr-1 h-4 w-4" />{t("fleet.op.resolve", "Resolve")}
          </Button>
        </div>
        {resolveCode && resolveLoading && (
          <p className="text-sm text-muted-foreground">{t("fleet.loading", "Loading…")}</p>
        )}
        {resolveCode && !resolveLoading && resolveError && (
          <p className="text-sm text-muted-foreground">
            {t("fleet.op.notFound", "Operation not found:")} <span className="font-mono">{resolveCode}</span>
          </p>
        )}
        {resolved && !resolveLoading && (
          <div data-op-resolved={resolved.code} className="space-y-2 rounded-md border border-border bg-muted/30 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono font-medium">{resolved.code}</span>
              <Badge variant="outline">{resolved.requiredCapability}</Badge>
              {resolved.toolType && <Badge className="bg-violet-500 text-white">{resolved.toolType}</Badge>}
              <span className="text-xs text-muted-foreground">
                {t("fleet.op.cycle", "Cycle")}: {fmtDuration(resolved.estimatedCycleMs)}
              </span>
              <span className="text-xs text-muted-foreground">
                {t("fleet.op.skills", "Skills")}: {resolved.requiredSkillIds.length}
              </span>
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">
                {t("fleet.op.qualifiedPrograms", "Qualified programs")} ({resolved.qualifiedPrograms.length})
              </div>
              {resolved.qualifiedPrograms.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t("fleet.op.noPrograms", "No qualified programs mapped yet.")}</p>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {resolved.qualifiedPrograms.map((pr) => (
                    <Badge key={`${pr.programProjectId}-${pr.deviceKind ?? "any"}`} variant="secondary" className="font-mono text-xs">
                      <Package className="mr-1 h-3 w-3" />
                      {pr.programCode ?? `#${pr.programProjectId}`}
                      {pr.deviceKind ? ` · ${pr.deviceKind}` : ""}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Operation registry table */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <Workflow className="h-4 w-4" />
            {t("fleet.op.registryTitle", "Operation registry")}
          </h3>
          <Button size="sm" variant="outline" className="h-8" disabled={!canControl} title={controlReason} onClick={() => flyout.push("fleet-operation-new")}>
            <Plus className="mr-1 h-4 w-4" />{t("fleet.op.create", "New operation")}
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("fleet.op.col.code", "Code")}</TableHead>
              <TableHead>{t("fleet.op.col.capability", "Capability")}</TableHead>
              <TableHead>{t("fleet.op.col.skills", "Skills")}</TableHead>
              <TableHead>{t("fleet.op.col.tool", "Tool type")}</TableHead>
              <TableHead>{t("fleet.op.col.cycle", "Est cycle")}</TableHead>
              <TableHead className="text-right">{t("common.actions", "Actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">{t("fleet.loading", "Loading…")}</TableCell></TableRow>
            )}
            {!loading && operations.length === 0 && (
              <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">{t("fleet.op.empty", "No operations defined yet.")}</TableCell></TableRow>
            )}
            {operations.map((op) => (
              <TableRow key={op.id} data-op-id={op.id}>
                <TableCell className="font-mono text-xs">{op.code}</TableCell>
                <TableCell><Badge variant="outline">{op.requiredCapability}</Badge></TableCell>
                <TableCell className="text-xs tabular-nums">{Array.isArray(op.requiredSkillIds) ? op.requiredSkillIds.length : 0}</TableCell>
                <TableCell className="text-xs">{op.toolType ?? <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="text-xs whitespace-nowrap">{fmtDuration(op.estimatedCycleMs)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" className="h-7" onClick={() => { setResolveInput(op.code); setResolveCode(op.code); }}>
                      <Search className="mr-1 h-3.5 w-3.5" />{t("fleet.op.resolve", "Resolve")}
                    </Button>
                    {canControl && (
                      <Button size="sm" variant="ghost" className="h-7" onClick={() => flyout.push("fleet-operation-map", { id: op.id })}>
                        <Link2 className="mr-1 h-3.5 w-3.5" />{t("fleet.op.map", "Map program")}
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Sheets (FlyoutHost) — form, kiểm tra và payload GIỮ NGUYÊN như các Dialog cũ.
// Toast + làm mới ở mutation cấp trang; sheet chỉ tự đóng CHÍNH lớp của nó khi thành công (useCloseOwnLayer).
// ══════════════════════════════════════════════════════════════════════════════
function AssignForm({
  task, pending, onSubmit,
}: {
  task: FleetTask;
  pending: boolean;
  onSubmit: (deviceId: number, done: () => void) => void;
}) {
  const { t } = useTranslation();
  const { layer, done } = useCloseOwnLayer();
  const uid = useId();
  const initial = task.assignedDeviceId != null ? String(task.assignedDeviceId) : "";
  const [deviceId, setDeviceId] = useState<string>(initial);
  const dirty = deviceId !== initial;
  useEffect(() => { layer.setDirty(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    const n = Number(deviceId);
    if (!Number.isInteger(n) || n <= 0) {
      toast.error(t("fleet.deviceIdRequired", "Enter a valid device id."));
      return;
    }
    onSubmit(n, done);
  };

  return (
    <div className="grid gap-3">
      <div className="text-sm text-muted-foreground">
        <span className="font-mono text-xs">{task.taskKey}</span>
        {" · "}{task.requiredCapability}
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${uid}-device`}>{t("fleet.deviceId", "Device id (robot)")}</Label>
        <Input
          id={`${uid}-device`}
          type="number" min={1} value={deviceId}
          placeholder={t("fleet.deviceIdPlaceholder", "e.g. 1")}
          onChange={(e) => setDeviceId(e.target.value)}
        />
      </div>
      <SheetFooter>
        <Button variant="outline" onClick={() => layer.close()}>{t("common.cancel", "Cancel")}</Button>
        <Button onClick={submit} disabled={pending}>
          <CheckCircle2 className="mr-1 h-4 w-4" />{t("fleet.assign", "Assign")}
        </Button>
      </SheetFooter>
    </div>
  );
}

/** Đặt trước vùng / tài nguyên — hai dialog cũ cùng hình (mã thiết bị + "xếp hàng nếu đầy"), payload như cũ. */
function ReserveForm({
  subject, queueLabel, submitLabel, icon, pending, onSubmit,
}: {
  subject: ReactNode;
  queueLabel: string;
  submitLabel: string;
  icon: ReactNode;
  pending: boolean;
  onSubmit: (deviceId: number, queueIfFull: boolean, done: () => void) => void;
}) {
  const { t } = useTranslation();
  const { layer, done } = useCloseOwnLayer();
  const uid = useId();
  const [deviceId, setDeviceId] = useState<string>("");
  const [queueIfFull, setQueueIfFull] = useState(true);
  const dirty = deviceId !== "" || !queueIfFull;
  useEffect(() => { layer.setDirty(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    const n = Number(deviceId);
    if (!Number.isInteger(n) || n <= 0) {
      toast.error(t("fleet.deviceIdRequired", "Enter a valid device id."));
      return;
    }
    onSubmit(n, queueIfFull, done);
  };

  return (
    <div className="grid gap-3">
      <div className="text-sm text-muted-foreground">{subject}</div>
      <div className="grid gap-1">
        <Label htmlFor={`${uid}-device`}>{t("fleet.deviceId", "Device id (robot)")}</Label>
        <Input
          id={`${uid}-device`}
          type="number" min={1} value={deviceId}
          placeholder={t("fleet.deviceIdPlaceholder", "e.g. 1")}
          onChange={(e) => setDeviceId(e.target.value)}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={queueIfFull} onCheckedChange={(v) => setQueueIfFull(Boolean(v))} />
        {queueLabel}
      </label>
      <SheetFooter>
        <Button variant="outline" onClick={() => layer.close()}>{t("common.cancel", "Cancel")}</Button>
        <Button onClick={submit} disabled={pending}>
          {icon}{submitLabel}
        </Button>
      </SheetFooter>
    </div>
  );
}

function CreateOperationForm({
  pending, onSubmit,
}: {
  pending: boolean;
  onSubmit: (v: { code: string; description?: string; requiredCapability: string; toolType?: string; estimatedCycleMs?: number }, done: () => void) => void;
}) {
  const { t } = useTranslation();
  const { layer, done } = useCloseOwnLayer();
  const uid = useId();
  const [code, setCode] = useState("");
  const [requiredCapability, setRequiredCapability] = useState("");
  const [toolType, setToolType] = useState("");
  const [estCycle, setEstCycle] = useState("");
  const [description, setDescription] = useState("");
  const dirty = code !== "" || requiredCapability !== "" || toolType !== "" || estCycle !== "" || description !== "";
  useEffect(() => { layer.setDirty(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    if (!code.trim() || !requiredCapability.trim()) {
      toast.error(t("fleet.op.codeCapRequired", "Code and required capability are mandatory."));
      return;
    }
    const ms = estCycle ? Number(estCycle) : undefined;
    onSubmit({
      code: code.trim(),
      requiredCapability: requiredCapability.trim(),
      description: description.trim() || undefined,
      toolType: toolType.trim() || undefined,
      estimatedCycleMs: Number.isFinite(ms) ? ms : undefined,
    }, done);
  };

  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <Label htmlFor={`${uid}-code`}>{t("fleet.op.code", "Operation code")}</Label>
        <Input id={`${uid}-code`} value={code} placeholder="OP-WELD-01" onChange={(e) => setCode(e.target.value)} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${uid}-cap`}>{t("fleet.op.capability", "Required capability")}</Label>
        <Input id={`${uid}-cap`} value={requiredCapability} placeholder="run_job" onChange={(e) => setRequiredCapability(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1">
          <Label htmlFor={`${uid}-tool`}>{t("fleet.op.toolType", "Tool type")}</Label>
          <Input id={`${uid}-tool`} value={toolType} placeholder="gripper" onChange={(e) => setToolType(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${uid}-cycle`}>{t("fleet.op.estCycleMs", "Est cycle (ms)")}</Label>
          <Input id={`${uid}-cycle`} type="number" min={0} value={estCycle} placeholder="30000" onChange={(e) => setEstCycle(e.target.value)} />
        </div>
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${uid}-desc`}>{t("fleet.op.description", "Description")}</Label>
        <Input id={`${uid}-desc`} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <SheetFooter>
        <Button variant="outline" onClick={() => layer.close()}>{t("common.cancel", "Cancel")}</Button>
        <Button onClick={submit} disabled={pending}><CheckCircle2 className="mr-1 h-4 w-4" />{t("fleet.op.create", "Create")}</Button>
      </SheetFooter>
    </div>
  );
}

function MapProgramForm({
  operation, pending, onSubmit,
}: {
  operation: FleetOperation;
  pending: boolean;
  onSubmit: (programProjectId: number, deviceKind: string | undefined, done: () => void) => void;
}) {
  const { t } = useTranslation();
  const { layer, done } = useCloseOwnLayer();
  const uid = useId();
  const [programProjectId, setProgramProjectId] = useState("");
  const [deviceKind, setDeviceKind] = useState("");
  const dirty = programProjectId !== "" || deviceKind !== "";
  useEffect(() => { layer.setDirty(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    const n = Number(programProjectId);
    if (!Number.isInteger(n) || n <= 0) {
      toast.error(t("fleet.op.programIdRequired", "Enter a valid program project id."));
      return;
    }
    onSubmit(n, deviceKind.trim() || undefined, done);
  };

  return (
    <div className="grid gap-3">
      <div className="text-sm text-muted-foreground">
        <span className="font-mono text-xs">{operation.code}</span>{" · "}{operation.requiredCapability}
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${uid}-program`}>{t("fleet.op.programId", "Program project id")}</Label>
        <Input id={`${uid}-program`} type="number" min={1} value={programProjectId} placeholder="e.g. 1" onChange={(e) => setProgramProjectId(e.target.value)} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${uid}-kind`}>{t("fleet.op.deviceKind", "Device kind (optional)")}</Label>
        <Input id={`${uid}-kind`} value={deviceKind} placeholder="arm / scara / cobot / agv" onChange={(e) => setDeviceKind(e.target.value)} />
      </div>
      <SheetFooter>
        <Button variant="outline" onClick={() => layer.close()}>{t("common.cancel", "Cancel")}</Button>
        <Button onClick={submit} disabled={pending}><CheckCircle2 className="mr-1 h-4 w-4" />{t("fleet.op.map", "Map program")}</Button>
      </SheetFooter>
    </div>
  );
}

function CreateResourceForm({
  pending, onSubmit,
}: {
  pending: boolean;
  onSubmit: (v: { code: string; name?: string; type: (typeof RESOURCE_TYPES)[number]; locationZoneId?: number }, done: () => void) => void;
}) {
  const { t } = useTranslation();
  const { layer, done } = useCloseOwnLayer();
  const uid = useId();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<(typeof RESOURCE_TYPES)[number]>("other");
  const [zoneId, setZoneId] = useState("");
  const dirty = code !== "" || name !== "" || type !== "other" || zoneId !== "";
  useEffect(() => { layer.setDirty(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    if (!code.trim()) {
      toast.error(t("fleet.res.codeRequired", "Resource code is required."));
      return;
    }
    const z = zoneId ? Number(zoneId) : undefined;
    onSubmit({
      code: code.trim(),
      name: name.trim() || undefined,
      type,
      locationZoneId: Number.isInteger(z) && (z as number) > 0 ? z : undefined,
    }, done);
  };

  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1">
          <Label htmlFor={`${uid}-code`}>{t("fleet.res.code", "Code")}</Label>
          <Input id={`${uid}-code`} value={code} placeholder="JIG-01" onChange={(e) => setCode(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${uid}-type`}>{t("fleet.res.type", "Type")}</Label>
          <Select value={type} onValueChange={(v) => setType(v as (typeof RESOURCE_TYPES)[number])}>
            <SelectTrigger id={`${uid}-type`} className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {RESOURCE_TYPES.map((tp) => (
                <SelectItem key={tp} value={tp}>{t(`fleet.resType.${tp}`, tp)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${uid}-name`}>{t("fleet.res.name", "Name")}</Label>
        <Input id={`${uid}-name`} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${uid}-zone`}>{t("fleet.res.zoneId", "Home zone id (optional)")}</Label>
        <Input id={`${uid}-zone`} type="number" min={1} value={zoneId} placeholder="e.g. 1" onChange={(e) => setZoneId(e.target.value)} />
      </div>
      <SheetFooter>
        <Button variant="outline" onClick={() => layer.close()}>{t("common.cancel", "Cancel")}</Button>
        <Button onClick={submit} disabled={pending}><CheckCircle2 className="mr-1 h-4 w-4" />{t("fleet.res.create", "Create")}</Button>
      </SheetFooter>
    </div>
  );
}

function CreateChargerForm({
  pending, onSubmit,
}: {
  pending: boolean;
  onSubmit: (v: { code: string; name?: string; chargerType: string; powerWatts?: number; locationZoneId?: number }, done: () => void) => void;
}) {
  const { t } = useTranslation();
  const { layer, done } = useCloseOwnLayer();
  const uid = useId();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [chargerType, setChargerType] = useState("contact");
  const [powerWatts, setPowerWatts] = useState("");
  const [zoneId, setZoneId] = useState("");
  const dirty = code !== "" || name !== "" || chargerType !== "contact" || powerWatts !== "" || zoneId !== "";
  useEffect(() => { layer.setDirty(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    if (!code.trim()) {
      toast.error(t("fleet.charger.codeRequired", "Charger code is required."));
      return;
    }
    const w = powerWatts ? Number(powerWatts) : undefined;
    const z = zoneId ? Number(zoneId) : undefined;
    onSubmit({
      code: code.trim(),
      name: name.trim() || undefined,
      chargerType: chargerType.trim() || "contact",
      powerWatts: Number.isFinite(w) ? w : undefined,
      locationZoneId: Number.isInteger(z) && (z as number) > 0 ? z : undefined,
    }, done);
  };

  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1">
          <Label htmlFor={`${uid}-code`}>{t("fleet.charger.code", "Code")}</Label>
          <Input id={`${uid}-code`} value={code} placeholder="CHG-01" onChange={(e) => setCode(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${uid}-type`}>{t("fleet.charger.type", "Charger type")}</Label>
          <Input id={`${uid}-type`} value={chargerType} placeholder="contact / inductive" onChange={(e) => setChargerType(e.target.value)} />
        </div>
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${uid}-name`}>{t("fleet.charger.name", "Name")}</Label>
        <Input id={`${uid}-name`} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1">
          <Label htmlFor={`${uid}-power`}>{t("fleet.charger.power", "Power (W)")}</Label>
          <Input id={`${uid}-power`} type="number" min={0} value={powerWatts} placeholder="2000" onChange={(e) => setPowerWatts(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${uid}-zone`}>{t("fleet.charger.zoneId", "Zone id (optional)")}</Label>
          <Input id={`${uid}-zone`} type="number" min={1} value={zoneId} placeholder="e.g. 1" onChange={(e) => setZoneId(e.target.value)} />
        </div>
      </div>
      <SheetFooter>
        <Button variant="outline" onClick={() => layer.close()}>{t("common.cancel", "Cancel")}</Button>
        <Button onClick={submit} disabled={pending}><CheckCircle2 className="mr-1 h-4 w-4" />{t("fleet.charger.create", "Create")}</Button>
      </SheetFooter>
    </div>
  );
}
