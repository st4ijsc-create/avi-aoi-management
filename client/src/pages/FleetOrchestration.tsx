/**
 * G1 + G2 (doc 16 §7 Khối 2 / §12 design system) — FLEET & TASK ORCHESTRATION surface.
 *
 * Read-mostly cockpit over the fleetRouter, organised into tabs:
 *   • "Tasks & Zones" (G1) — Dynamic Task Allocation Engine + Zone Traffic/Path mgr.
 *       1. KPI strip — task counts + reservations + zones at capacity + deadlocks.
 *       2. Task queue table — allocate / reassign / cancel (flag- + RBAC-gated).
 *       3. Zones panel — occupancy vs maxConcurrentRobots + reservations.
 *   • "Operations" (G2-a) — operation_codes registry, resolve → qualified programs,
 *       create-operation + map-program (FLEET_RESOURCE_ENABLED gated).
 *   • "Resources" (G2-c) — shared_resources by type + reserve/release + reservations,
 *       create-resource (FLEET_RESOURCE_ENABLED gated). Mirrors the Zones UX.
 *   • "Charging" (G2-d) — charger_stations + battery_charging_plans + sweep-now +
 *       create-charger (FLEET_RESOURCE_ENABLED gated).
 *
 * SAFETY (mirrors the router): this page writes orchestration STATE only — it opens
 * NO device path. G1 mutations are gated behind FLEET_ORCH_ENABLED; G2 mutations
 * behind FLEET_RESOURCE_ENABLED. When a flag is OFF the page shows an honest "preview"
 * banner and surfaces the CONFLICT error gracefully (toast.info, not red). Read RBAC:
 * machine_monitoring/canView. Actions: machine_control/canCreate (hidden when absent).
 *
 * i18n: uses the t("key", "English default") fallback pattern (no locale-file edits).
 */
import { useEffect, useMemo, useRef, useState } from "react";
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
import { MetricCard, PageContainer, PageHeader } from "@/components/patterns";
import { buildBreadcrumbs } from "@/lib/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
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
  Truck, RefreshCw, ListChecks, Layers, AlertTriangle, ShieldAlert, Info,
  Play, Send, Ban, MapPin, Bot, Clock, Activity, Lock, CheckCircle2,
  Wrench, Workflow, BatteryCharging, Plus, Search, Link2, Zap, Package, Map as MapIcon,
} from "lucide-react";
import { toast } from "sonner";
import { mapTrpcError } from "@/lib/trpcErrors";
import { isFeatureDisabledError, featureKeyOf } from "@/lib/featureFlagError";

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

export default function FleetOrchestration() {
  const { t } = useTranslation();
  const [location, setLocation] = useLocation();
  // U3 (doc 26) — breadcrumb "Kỹ thuật › Section › Trang" + link về Hub.
  const crumbs = buildBreadcrumbs(location, t);
  const { hasPermission } = usePermissions();
  const canView = hasPermission("machine_monitoring", "canView");
  const canControl = hasPermission("machine_control", "canCreate");
  // U4 (doc 26 §2.4) — hiện-nhưng-khoá: lý do khi thiếu quyền điều khiển máy.
  const permReason = !canControl
    ? t("common.gate.needPerm", "Requires {{perm}} permission", { perm: "machine_control" })
    : undefined;

  const [statusFilter, setStatusFilter] = useState<string>("");
  const [assignTask, setAssignTask] = useState<FleetTask | null>(null);
  const [cancelTarget, setCancelTarget] = useState<FleetTask | null>(null);
  const [reserveZoneTarget, setReserveZoneTarget] = useState<FleetZone | null>(null);

  // ── G2 UI state ──────────────────────────────────────────────────────────────
  const [tab, setTab] = useState("tasks");
  const [resolveCode, setResolveCode] = useState<string>("");
  const [createOpOpen, setCreateOpOpen] = useState(false);
  const [mapProgramFor, setMapProgramFor] = useState<FleetOperation | null>(null);
  const [createResourceOpen, setCreateResourceOpen] = useState(false);
  const [reserveResourceTarget, setReserveResourceTarget] = useState<FleetResource | null>(null);
  const [createChargerOpen, setCreateChargerOpen] = useState(false);
  // W4-18 (3) — factory chọn cho bản đồ (null = tự suy từ zone đầu tiên có factoryId).
  const [mapFactoryId, setMapFactoryId] = useState<number | null>(null);

  const utils = trpc.useUtils();

  // ── Reads ──────────────────────────────────────────────────────────────────
  // ENG-F8 (doc 40 W4b) — GATE POLL THEO TAB để cắt over-fetch. Trước đây cả 5
  // query G1 (status/tasks/zones/reservations/deadlocks) đều poll 5s BẤT KỂ tab
  // nào đang mở → ~5 request/5s ngay cả khi user đang ở tab Operations/Resources/
  // Charging (vốn KHÔNG hiển thị những dữ liệu này). Nay:
  //   • MỌI query vẫn `enabled: canView` để KPI strip + banner deadlock (luôn
  //     hiển thị bên trên các tab) NẠP một lần & giữ giá trị từ cache khi đổi tab
  //     — honest, không để KPI trống. Đây là fetch một-lần, không phải poll.
  //   • Nhưng refetchInterval 5s CHỈ bật cho query thuộc tab đang mở:
  //       - tasks / reservations / status(cờ) → chỉ tab "tasks";
  //       - zones → tab "tasks" HOẶC "map" (FleetMap vẽ zone);
  //       - deadlocks → poll khi canView bất kể tab (AN TOÀN: banner + KPI + toast
  //         "deadlock mới" luôn hiển thị nên phải giữ live). Đây là "1" luôn chạy.
  //   • Quay lại tab → refetchOnWindowFocus/visibility làm mới NGAY (usePollingInterval).
  // Kết quả: tasks-tab poll các query của nó; Operations/Resources/Charging chỉ còn
  // deadlocks (1); Map còn zones + deadlocks (2, chưa kể poll riêng của Map). Dừng
  // poll khi mất quyền xem HOẶC tab trình duyệt bị ẩn (doc 27 B12).
  const tasksTabActive = canView && tab === "tasks";
  const tasksPolling = usePollingInterval(tasksTabActive ? 5000 : false);
  const zonesPolling = usePollingInterval(canView && (tab === "tasks" || tab === "map") ? 5000 : false);
  const deadlocksPolling = usePollingInterval(canView ? 5000 : false);
  const statusQ = trpc.fleet.status.useQuery(undefined, { enabled: canView, ...tasksPolling });
  const tasksQ = trpc.fleet.listTasks.useQuery(
    { status: (statusFilter || undefined) as (typeof TASK_STATUSES)[number] | undefined, limit: 200 },
    { enabled: canView, ...tasksPolling },
  );
  const zonesQ = trpc.fleet.listZones.useQuery(undefined, { enabled: canView, ...zonesPolling });
  const reservationsQ = trpc.fleet.listReservations.useQuery({ limit: 500 }, { enabled: canView, ...tasksPolling });
  const deadlocksQ = trpc.fleet.deadlocks.useQuery(undefined, { enabled: canView, ...deadlocksPolling });

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
  const mapActive = canView && tab === "map";
  const mapPolling = usePollingInterval(mapActive ? 5000 : false);
  const occupancyGridQ = trpc.twin.occupancyGrid.useQuery(
    { factoryId: effectiveFactoryId },
    { enabled: mapActive, retry: false },
  );
  const robotPositionsQ = trpc.fleet.robotPositions.useQuery(undefined, {
    enabled: mapActive,
    ...mapPolling,
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

  // Flag state — honest preview banner. Prefer the explicit status query.
  const flagEnabled = statusQ.data?.enabled ?? true;
  // G2 resource layer flag — independent of the G1 orchestration flag.
  const resourceFlagEnabled = resourceStatusQ.data?.enabled ?? true;

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
    onSuccess: () => { toast.success(t("fleet.assigned", "Task reassigned")); setAssignTask(null); refetchAll(); },
    onError: onMutationError,
  });
  const cancelM = trpc.fleet.cancelTask.useMutation({
    onSuccess: () => { toast.success(t("fleet.cancelled", "Task cancelled")); setCancelTarget(null); refetchAll(); },
    onError: onMutationError,
  });
  const reserveM = trpc.fleet.reserve.useMutation({
    // W4-18 (1) — reserveZone trả {ok,status}: rejected → error, queued → warning, active → success.
    onSuccess: (res) => {
      if (res && (res.ok === false || res.status === "rejected")) {
        toast.error(t("fleet.reserveRejected", "Reservation rejected") + (res.message ? ` — ${res.message}` : ""));
      } else if (res && res.status === "queued") {
        toast.warning(t("fleet.reserveQueued", "Zone at capacity — reservation queued"));
        setReserveZoneTarget(null);
      } else {
        toast.success(t("fleet.reserved", "Reservation active"));
        setReserveZoneTarget(null);
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
    onSuccess: () => { toast.success(t("fleet.opCreated", "Operation created")); setCreateOpOpen(false); refetchAll(); },
    onError: onMutationError,
  });
  const mapProgramM = trpc.fleet.mapOperationProgram.useMutation({
    onSuccess: () => { toast.success(t("fleet.programMapped", "Program mapped to operation")); setMapProgramFor(null); refetchAll(); },
    onError: onMutationError,
  });
  const createResourceM = trpc.fleet.createResource.useMutation({
    onSuccess: () => { toast.success(t("fleet.resourceCreated", "Resource created")); setCreateResourceOpen(false); refetchAll(); },
    onError: onMutationError,
  });
  const reserveResourceM = trpc.fleet.reserveResource.useMutation({
    // W4-18 (1) — claimResource trả {ok,status}: rejected → error, queued → warning, active → success.
    onSuccess: (res) => {
      if (res && (res.ok === false || res.status === "rejected")) {
        toast.error(t("fleet.resourceRejected", "Resource claim rejected") + (res.message ? ` — ${res.message}` : ""));
      } else if (res && res.status === "queued") {
        toast.warning(t("fleet.resourceQueued", "Resource in use — claim queued"));
        setReserveResourceTarget(null);
      } else {
        toast.success(t("fleet.resourceReserved", "Resource claimed"));
        setReserveResourceTarget(null);
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
    onSuccess: () => { toast.success(t("fleet.chargerCreated", "Charger created")); setCreateChargerOpen(false); refetchAll(); },
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
        { description: t("fleet.newDeadlockDesc", "A robot dependency cycle just formed — review the Tasks & Zones tab.") },
      );
    }
  }, [deadlocks, t]);

  if (!canView) {
    return (
      <DashboardLayout>
        <div className="p-6">
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              <AlertTriangle className="mx-auto mb-2 h-6 w-6" />
              {t("fleet.noPermission", "You do not have permission to view fleet orchestration.")}
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  const anyLoading = tasksQ.isLoading || zonesQ.isLoading || reservationsQ.isLoading;

  return (
    <DashboardLayout>
      <PageContainer className="flex flex-col gap-4 space-y-0">
        {/* ── PageHeader (DS F1b shared pattern) ─────────────────────────────── */}
        <PageHeader
          breadcrumbs={crumbs}
          icon={<Truck className="h-6 w-6" />}
          title={t("fleet.title", "Fleet & Task Orchestration")}
          badge={!canControl ? <ViewOnlyBadge module="machine_control" /> : undefined}
          description={t("fleet.subtitle", "Dynamic task allocation + zone traffic control — orchestration state only, no direct device commands.")}
          actions={
            <Button
              size="icon"
              variant="ghost"
              onClick={refetchAll}
              title={t("common.refresh", "Refresh")}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          }
        />

        {/* U7 (doc 26 §2.1) — "Khi nào dùng": trang LÀ GÌ / DÙNG KHI NÀO cho KTV mới. */}
        <div className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
          <span>{t("fleet.whenToUse", "When to use — assign tasks across a robot/AGV fleet and manage zone traffic & reservations. Orchestration state only; real motion routes through the HITL dispatcher.")}</span>
        </div>

        {/* ── Flag-off preview banner (honest) ───────────────────────────────── */}
        {!flagEnabled && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <span>
              {t(
                "fleet.flagOffBanner",
                "Preview mode: fleet orchestration is disabled (FLEET_ORCH_ENABLED is off). Reads work; actions (allocate / reassign / cancel / reserve / release) are blocked until the flag is enabled.",
              )}
            </span>
          </div>
        )}

        {/* Safety note — mirrors RobotControl honesty */}
        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {t(
              "fleet.safetyNote",
              "This page writes orchestration state only (tasks / zones / reservations). Actual robot motion always routes through the gated HITL dispatcher — never from this screen.",
            )}
          </span>
        </div>

        {/* ── 1. KPI strip ───────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-9">
          <MetricCard icon={<Clock className="h-4 w-4" />} label={t("fleet.kpi.pending", "Pending")} value={kpis.pending} tone={kpis.pending > 0 ? "warning" : "default"} />
          <MetricCard icon={<Send className="h-4 w-4" />} label={t("fleet.kpi.assigned", "Assigned")} value={kpis.assigned} />
          <MetricCard icon={<Activity className="h-4 w-4" />} label={t("fleet.kpi.running", "Running")} value={kpis.running} tone={kpis.running > 0 ? "good" : "default"} />
          <MetricCard icon={<AlertTriangle className="h-4 w-4" />} label={t("fleet.kpi.failed", "Failed")} value={kpis.failed} tone={kpis.failed > 0 ? "danger" : "default"} />
          <MetricCard icon={<MapPin className="h-4 w-4" />} label={t("fleet.kpi.activeRes", "Active reservations")} value={kpis.activeReservations} />
          <MetricCard icon={<Layers className="h-4 w-4" />} label={t("fleet.kpi.atCapacity", "Zones at capacity")} value={`${kpis.zonesAtCapacity}/${zones.length}`} tone={kpis.zonesAtCapacity > 0 ? "warning" : "default"} />
          <MetricCard icon={<ShieldAlert className="h-4 w-4" />} label={t("fleet.kpi.deadlocks", "Deadlocks")} value={kpis.deadlockCount} tone={kpis.deadlockCount > 0 ? "danger" : "default"} />
          <MetricCard icon={<Wrench className="h-4 w-4" />} label={t("fleet.kpi.resourcesInUse", "Resources in use")} value={`${kpis.resourcesInUse}/${resources.length}`} tone={kpis.resourcesInUse > 0 ? "good" : "default"} />
          <MetricCard icon={<BatteryCharging className="h-4 w-4" />} label={t("fleet.kpi.charging", "Charging plans")} value={kpis.activeChargingPlans} tone={kpis.activeChargingPlans > 0 ? "warning" : "default"} />
        </div>

        {/* Deadlock detail banner */}
        {(deadlocks?.cycles?.length ?? 0) > 0 && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div>
              <div className="font-medium text-destructive">
                {t("fleet.deadlockTitle", "Deadlock cycle(s) detected")}
              </div>
              <div className="mt-1 space-y-0.5 text-muted-foreground">
                {deadlocks!.cycles.map((cycle, i) => (
                  <div key={i} className="font-mono text-xs">
                    {t("fleet.deadlockDevices", "Devices")}: {cycle.join(" → ")} → {cycle[0]}
                  </div>
                ))}
              </div>
              {/* W4-18 (5) — advisory resolve: huỷ waiter ưu tiên thấp nhất để phá deadlock. */}
              <Button
                size="sm" variant="destructive" className="mt-2 h-7"
                disabled={!canControl || resolveDeadlockM.isPending}
                title={permReason}
                onClick={() => resolveDeadlockM.mutate()}
              >
                <ShieldAlert className="mr-1 h-3.5 w-3.5" />{t("fleet.resolveDeadlock", "Resolve deadlock")}
              </Button>
            </div>
          </div>
        )}

        {/* ── G2 resource-flag preview banner (only on the G2 tabs) ──────────── */}
        {!resourceFlagEnabled && tab !== "tasks" && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <span>
              {t(
                "fleet.resourceFlagOffBanner",
                "Preview mode: the fleet resource layer is disabled (FLEET_RESOURCE_ENABLED is off). Reads work; actions (create / map / reserve / release / sweep) are blocked until the flag is enabled.",
              )}
            </span>
          </div>
        )}

        {/* ── Tabbed surface (G1 tasks/zones + G2 operations/resources/charging) ─ */}
        <Tabs value={tab} onValueChange={setTab} className="gap-4">
          <TabsList className="flex-wrap">
            <TabsTrigger value="tasks"><ListChecks className="mr-1 h-4 w-4" />{t("fleet.tab.tasks", "Tasks & Zones")}</TabsTrigger>
            <TabsTrigger value="map"><MapIcon className="mr-1 h-4 w-4" />{t("fleet.tab.map", "Map")}</TabsTrigger>
            <TabsTrigger value="operations"><Workflow className="mr-1 h-4 w-4" />{t("fleet.tab.operations", "Operations")}</TabsTrigger>
            <TabsTrigger value="resources"><Wrench className="mr-1 h-4 w-4" />{t("fleet.tab.resources", "Resources")}</TabsTrigger>
            <TabsTrigger value="charging"><BatteryCharging className="mr-1 h-4 w-4" />{t("fleet.tab.charging", "Charging")}</TabsTrigger>
          </TabsList>

          {/* ════════════════ TAB: Map (W4-18 §3) ════════════════ */}
          <TabsContent value="map" className="flex flex-col gap-4">
            <FleetMap
              grid={occupancyGridQ.data}
              gridLoading={occupancyGridQ.isLoading}
              gridError={occupancyGridQ.error ? mapTrpcError(occupancyGridQ.error) : null}
              robots={(robotPositionsQ.data ?? []) as FleetRobotPos[]}
              robotsLoading={robotPositionsQ.isLoading}
              zones={zones}
              factoryIds={factoryIds}
              factoryId={effectiveFactoryId}
              onFactoryChange={setMapFactoryId}
            />
          </TabsContent>

          {/* ════════════════ TAB: Tasks & Zones (G1) ════════════════ */}
          <TabsContent value="tasks" className="flex flex-col gap-4">
        {/* ── 2. Task queue ──────────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ListChecks className="h-4 w-4" />
              {t("fleet.tasksTitle", "Task queue")}
            </CardTitle>
            <div className="flex items-center gap-2">
              {/* U12 §2.3 — độ tươi của dữ liệu poll (dataUpdatedAt của react-query). */}
              <PollFreshness updatedAt={tasksQ.dataUpdatedAt} isFetching={tasksQ.isFetching} />
              <Label className="text-xs text-muted-foreground">{t("fleet.filterStatus", "Status")}</Label>
              {/* U11 — Select DS; "__all__" là sentinel cho "tất cả trạng thái". */}
              <Select value={statusFilter || "__all__"} onValueChange={(v) => setStatusFilter(v === "__all__" ? "" : v)}>
                <SelectTrigger size="sm" className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">{t("fleet.all", "All")}</SelectItem>
                  {TASK_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{t(`fleet.task.${s}`, s)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("fleet.col.taskKey", "Task key")}</TableHead>
                  <TableHead>{t("fleet.col.capability", "Capability")}</TableHead>
                  <TableHead>{t("fleet.col.priority", "Priority")}</TableHead>
                  <TableHead>{t("fleet.col.status", "Status")}</TableHead>
                  <TableHead>{t("fleet.col.device", "Device")}</TableHead>
                  <TableHead>{t("fleet.col.duration", "Est / Act")}</TableHead>
                  <TableHead>{t("fleet.col.retries", "Retries")}</TableHead>
                  <TableHead className="text-right">{t("common.actions", "Actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {anyLoading && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                      {t("fleet.loading", "Loading…")}
                    </TableCell>
                  </TableRow>
                )}
                {!anyLoading && tasks.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                      {t("fleet.tasksEmpty", "No tasks. Tasks are decomposed from production orders or created by an admin.")}
                    </TableCell>
                  </TableRow>
                )}
                {tasks.map((tk) => {
                  const terminal = TERMINAL.has(tk.status);
                  return (
                    <TableRow key={tk.id}>
                      <TableCell className="font-mono text-xs">{tk.taskKey}</TableCell>
                      <TableCell><Badge variant="outline">{tk.requiredCapability}</Badge></TableCell>
                      <TableCell>
                        <Badge variant={tk.priority <= 2 ? "destructive" : "outline"}>P{tk.priority}</Badge>
                      </TableCell>
                      <TableCell>{taskStatusBadge(tk.status, t)}</TableCell>
                      <TableCell className="text-xs">
                        {tk.assignedDeviceId != null
                          ? <button
                              type="button"
                              className="inline-flex items-center gap-1 text-primary hover:underline"
                              title={t("fleet.openRobotCockpit", "Open robot cockpit")}
                              onClick={() => setLocation(`/robot/${tk.assignedDeviceId}`)}
                            ><Bot className="h-3 w-3" />#{tk.assignedDeviceId}</button>
                          : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {fmtDuration(tk.estimatedDurationMs)} / {fmtDuration(tk.actualDurationMs)}
                      </TableCell>
                      <TableCell className="text-xs tabular-nums">{tk.retryCount}</TableCell>
                      <TableCell className="text-right">
                        {canControl ? (
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm" variant="ghost" className="h-7"
                              disabled={terminal || tk.status === "running" || allocateM.isPending}
                              title={t("fleet.allocateTip", "Run the allocator (assign best device)")}
                              onClick={() => allocateM.mutate({ taskId: tk.id })}
                            >
                              <Play className="mr-1 h-3.5 w-3.5" />{t("fleet.allocate", "Allocate")}
                            </Button>
                            <Button
                              size="sm" variant="ghost" className="h-7"
                              disabled={terminal}
                              title={t("fleet.reassignTip", "Manually (re)assign to a device")}
                              onClick={() => setAssignTask(tk)}
                            >
                              <Send className="mr-1 h-3.5 w-3.5" />{t("fleet.reassign", "Reassign")}
                            </Button>
                            <Button
                              size="sm" variant="ghost" className="h-7"
                              disabled={terminal}
                              title={t("fleet.cancelTip", "Cancel this task")}
                              onClick={() => setCancelTarget(tk)}
                            >
                              <Ban className="mr-1 h-3.5 w-3.5 text-destructive" />{t("fleet.cancel", "Cancel")}
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
          </CardContent>
        </Card>

        {/* ── 3. Zones panel ─────────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers className="h-4 w-4" />
              {t("fleet.zonesTitle", "Zones & occupancy")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!anyLoading && zones.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {t("fleet.zonesEmpty", "No zones defined yet.")}
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {zones.map((z) => {
                const pct = z.maxConcurrentRobots > 0
                  ? Math.min(100, (z.occupancy / z.maxConcurrentRobots) * 100)
                  : 0;
                const atCap = z.occupancy >= z.maxConcurrentRobots;
                const zoneRes = resByZone.get(z.id) ?? [];
                return (
                  <Card key={z.id} className="border-border/60">
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
                              {canControl && r.status !== "released" && r.status !== "rejected" && (
                                <Button
                                  size="sm" variant="ghost" className="h-6 px-2 text-xs"
                                  disabled={releaseM.isPending}
                                  onClick={() => releaseM.mutate({ deviceId: r.deviceId, zoneId: z.id })}
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
                        disabled={!canControl}
                        title={permReason}
                        onClick={() => setReserveZoneTarget(z)}
                      >
                        <MapPin className="mr-1 h-3.5 w-3.5" />{t("fleet.reserve", "Reserve")}
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </CardContent>
        </Card>
          </TabsContent>

          {/* ════════════════ TAB: Operations (G2-a) ════════════════ */}
          <TabsContent value="operations" className="flex flex-col gap-4">
            <OperationsTab
              operations={operations}
              loading={operationsQ.isLoading}
              canControl={canControl}
              controlReason={permReason}
              resolveCode={resolveCode}
              setResolveCode={setResolveCode}
              resolved={resolved}
              resolveLoading={resolveQ.isFetching}
              resolveError={resolveQ.error ? mapTrpcError(resolveQ.error) : null}
              onCreate={() => setCreateOpOpen(true)}
              onMap={(op) => setMapProgramFor(op)}
            />
          </TabsContent>

          {/* ════════════════ TAB: Resources (G2-c) ════════════════ */}
          <TabsContent value="resources" className="flex flex-col gap-4">
            <ResourcesTab
              resources={resources}
              loading={resourcesQ.isLoading}
              canControl={canControl}
              controlReason={permReason}
              reservationsByResource={resReservationsByResource}
              releasePending={releaseResourceM.isPending}
              onCreate={() => setCreateResourceOpen(true)}
              onReserve={(r) => setReserveResourceTarget(r)}
              onRelease={(deviceId, resourceId) => releaseResourceM.mutate({ deviceId, resourceId })}
            />
          </TabsContent>

          {/* ════════════════ TAB: Charging (G2-d) ════════════════ */}
          <TabsContent value="charging" className="flex flex-col gap-4">
            <ChargingTab
              chargers={chargers}
              chargersLoading={chargersQ.isLoading}
              plans={chargingPlans}
              plansLoading={chargingPlansQ.isLoading}
              canControl={canControl}
              controlReason={permReason}
              sweepPending={sweepM.isPending}
              onCreateCharger={() => setCreateChargerOpen(true)}
              onSweep={() => sweepM.mutate()}
            />
          </TabsContent>
        </Tabs>
      </PageContainer>

      {/* ── Reassign dialog ──────────────────────────────────────────────────── */}
      {assignTask && (
        <AssignDialog
          task={assignTask}
          pending={assignM.isPending}
          onClose={() => setAssignTask(null)}
          onSubmit={(deviceId) => assignM.mutate({ taskId: assignTask.id, deviceId })}
        />
      )}

      {/* ── Reserve dialog ───────────────────────────────────────────────────── */}
      {reserveZoneTarget && (
        <ReserveDialog
          zone={reserveZoneTarget}
          pending={reserveM.isPending}
          onClose={() => setReserveZoneTarget(null)}
          onSubmit={(deviceId, queueIfFull) =>
            reserveM.mutate({ zoneId: reserveZoneTarget.id, deviceId, queueIfFull })}
        />
      )}

      {/* ── Cancel confirm ───────────────────────────────────────────────────── */}
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

      {/* ── G2 — Create operation dialog ─────────────────────────────────────── */}
      {createOpOpen && (
        <CreateOperationDialog
          pending={createOpM.isPending}
          onClose={() => setCreateOpOpen(false)}
          onSubmit={(v) => createOpM.mutate(v)}
        />
      )}

      {/* ── G2 — Map program dialog ──────────────────────────────────────────── */}
      {mapProgramFor && (
        <MapProgramDialog
          operation={mapProgramFor}
          pending={mapProgramM.isPending}
          onClose={() => setMapProgramFor(null)}
          onSubmit={(programProjectId, deviceKind) =>
            mapProgramM.mutate({ operationCodeId: mapProgramFor.id, programProjectId, deviceKind })}
        />
      )}

      {/* ── G2 — Create resource dialog ──────────────────────────────────────── */}
      {createResourceOpen && (
        <CreateResourceDialog
          pending={createResourceM.isPending}
          onClose={() => setCreateResourceOpen(false)}
          onSubmit={(v) => createResourceM.mutate(v)}
        />
      )}

      {/* ── G2 — Reserve resource dialog ─────────────────────────────────────── */}
      {reserveResourceTarget && (
        <ReserveResourceDialog
          resource={reserveResourceTarget}
          pending={reserveResourceM.isPending}
          onClose={() => setReserveResourceTarget(null)}
          onSubmit={(deviceId, queueIfFull) =>
            reserveResourceM.mutate({ resourceId: reserveResourceTarget.id, deviceId, queueIfFull })}
        />
      )}

      {/* ── G2 — Create charger dialog ───────────────────────────────────────── */}
      {createChargerOpen && (
        <CreateChargerDialog
          pending={createChargerM.isPending}
          onClose={() => setCreateChargerOpen(false)}
          onSubmit={(v) => createChargerM.mutate(v)}
        />
      )}
    </DashboardLayout>
  );
}

function AssignDialog({
  task, pending, onClose, onSubmit,
}: {
  task: FleetTask;
  pending: boolean;
  onClose: () => void;
  onSubmit: (deviceId: number) => void;
}) {
  const { t } = useTranslation();
  const [deviceId, setDeviceId] = useState<string>(task.assignedDeviceId != null ? String(task.assignedDeviceId) : "");

  const submit = () => {
    const n = Number(deviceId);
    if (!Number.isInteger(n) || n <= 0) {
      toast.error(t("fleet.deviceIdRequired", "Enter a valid device id."));
      return;
    }
    onSubmit(n);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-4 w-4" />{t("fleet.reassignTitle", "Reassign task")}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="text-sm text-muted-foreground">
            <span className="font-mono text-xs">{task.taskKey}</span>
            {" · "}{task.requiredCapability}
          </div>
          <div className="grid gap-1">
            <Label>{t("fleet.deviceId", "Device id (robot)")}</Label>
            <Input
              type="number" min={1} value={deviceId}
              placeholder={t("fleet.deviceIdPlaceholder", "e.g. 1")}
              onChange={(e) => setDeviceId(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel", "Cancel")}</Button>
          <Button onClick={submit} disabled={pending}>
            <CheckCircle2 className="mr-1 h-4 w-4" />{t("fleet.assign", "Assign")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReserveDialog({
  zone, pending, onClose, onSubmit,
}: {
  zone: FleetZone;
  pending: boolean;
  onClose: () => void;
  onSubmit: (deviceId: number, queueIfFull: boolean) => void;
}) {
  const { t } = useTranslation();
  const [deviceId, setDeviceId] = useState<string>("");
  const [queueIfFull, setQueueIfFull] = useState(true);

  const submit = () => {
    const n = Number(deviceId);
    if (!Number.isInteger(n) || n <= 0) {
      toast.error(t("fleet.deviceIdRequired", "Enter a valid device id."));
      return;
    }
    onSubmit(n, queueIfFull);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-4 w-4" />{t("fleet.reserveTitle", "Reserve zone")}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{zone.name}</span>
            {" · "}<span className="font-mono text-xs">{zone.code}</span>
            {" · "}{zone.occupancy}/{zone.maxConcurrentRobots}
          </div>
          <div className="grid gap-1">
            <Label>{t("fleet.deviceId", "Device id (robot)")}</Label>
            <Input
              type="number" min={1} value={deviceId}
              placeholder={t("fleet.deviceIdPlaceholder", "e.g. 1")}
              onChange={(e) => setDeviceId(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={queueIfFull} onCheckedChange={(v) => setQueueIfFull(Boolean(v))} />
            {t("fleet.queueIfFull", "Queue if zone is at capacity (otherwise reject)")}
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel", "Cancel")}</Button>
          <Button onClick={submit} disabled={pending}>
            <MapPin className="mr-1 h-4 w-4" />{t("fleet.reserve", "Reserve")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

function FleetMap({
  grid, gridLoading, gridError, robots, robotsLoading, zones, factoryIds, factoryId, onFactoryChange,
}: {
  grid: FleetOccupancyGrid | undefined;
  gridLoading: boolean;
  gridError: string | null;
  robots: FleetRobotPos[];
  robotsLoading: boolean;
  zones: FleetZone[];
  factoryIds: number[];
  factoryId: number;
  onFactoryChange: (id: number) => void;
}) {
  const { t } = useTranslation();
  const g = grid?.grid ?? null;

  // Zones with a rectangular bounds blob → drawable overlays tinted by occupancy.
  const zoneRects = useMemo(() => {
    const out: Array<{ id: number; code: string; x: number; y: number; w: number; h: number; ratio: number }> = [];
    for (const z of zones) {
      const r = boundsToRectLike(z.bounds as Record<string, unknown> | null | undefined);
      if (!r) continue;
      const ratio = z.maxConcurrentRobots > 0 ? Math.min(1, z.occupancy / z.maxConcurrentRobots) : 0;
      out.push({ id: z.id, code: z.code, ...r, ratio });
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
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <MapIcon className="h-4 w-4" />{t("fleet.map.title", "Fleet map")}
        </CardTitle>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">{t("fleet.map.factory", "Factory")}</Label>
          <Select value={String(factoryId)} onValueChange={(v) => onFactoryChange(Number(v))}>
            <SelectTrigger size="sm" className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(factoryIds.length ? factoryIds : [factoryId]).map((f) => (
                <SelectItem key={f} value={String(f)}>#{f}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading && <p className="py-8 text-center text-sm text-muted-foreground">{t("fleet.loading", "Loading…")}</p>}
        {!loading && gridError && <p className="py-3 text-center text-sm text-muted-foreground">{gridError}</p>}
        {!loading && !hasAnything && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t("fleet.map.empty", "No map geometry or located robots yet. Add zone bounds and robot telemetry poses to populate the map.")}
          </p>
        )}
        {!loading && hasAnything && (
          <div className="overflow-x-auto">
            <svg
              width={VIEW_W} height={VIEW_H}
              className="rounded-md border border-border bg-muted/20 text-foreground"
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
              {/* zone overlays tinted by occupancy */}
              {zoneRects.map((zr) => (
                <g key={`z-${zr.id}`}>
                  <rect
                    x={sx(zr.x)} y={sy(zr.y + zr.h)}
                    width={zr.w * scale} height={zr.h * scale}
                    fill={occTint(zr.ratio)} fillOpacity={0.3}
                    stroke={occTint(zr.ratio)} strokeOpacity={0.8}
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
          </div>
        )}
        {/* legend + honest note */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />{t("fleet.map.online", "Online")}</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-blue-500" />{t("fleet.map.busy", "Busy")}</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-slate-400" />{t("fleet.map.offline", "Offline")}</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" />{t("fleet.map.estop", "E-stop")}</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 bg-foreground/25" />{t("fleet.map.blocked", "Blocked cell")}</span>
          <span>· {t("fleet.map.locatedRobots", "Located robots")}: {locatedRobots.length}/{robots.length}</span>
        </div>
        {grid?.note && <p className="text-xs text-muted-foreground">{grid.note}</p>}
      </CardContent>
    </Card>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// G2-a — OPERATIONS tab
// ══════════════════════════════════════════════════════════════════════════════
function OperationsTab({
  operations, loading, canControl, controlReason, resolveCode, setResolveCode, resolved, resolveLoading,
  resolveError, onCreate, onMap,
}: {
  operations: FleetOperation[];
  loading: boolean;
  canControl: boolean;
  controlReason?: string;
  resolveCode: string;
  setResolveCode: (v: string) => void;
  resolved: FleetResolved | undefined;
  resolveLoading: boolean;
  resolveError: string | null;
  onCreate: () => void;
  onMap: (op: FleetOperation) => void;
}) {
  const { t } = useTranslation();
  const [resolveInput, setResolveInput] = useState(resolveCode);

  return (
    <>
      {/* Resolve panel — read-only operation → qualified programs */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Search className="h-4 w-4" />
            {t("fleet.op.resolveTitle", "Resolve operation")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="grid gap-1">
              <Label className="text-xs text-muted-foreground">{t("fleet.op.code", "Operation code")}</Label>
              <Input
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
            <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3 text-sm">
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
                    {resolved.qualifiedPrograms.map((p) => (
                      <Badge key={`${p.programProjectId}-${p.deviceKind ?? "any"}`} variant="secondary" className="font-mono text-xs">
                        <Package className="mr-1 h-3 w-3" />
                        {p.programCode ?? `#${p.programProjectId}`}
                        {p.deviceKind ? ` · ${p.deviceKind}` : ""}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Operation registry table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Workflow className="h-4 w-4" />
            {t("fleet.op.registryTitle", "Operation registry")}
          </CardTitle>
          {(
            <Button size="sm" variant="outline" className="h-8" disabled={!canControl} title={controlReason} onClick={onCreate}>
              <Plus className="mr-1 h-4 w-4" />{t("fleet.op.create", "New operation")}
            </Button>
          )}
        </CardHeader>
        <CardContent className="p-0">
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
                <TableRow key={op.id}>
                  <TableCell className="font-mono text-xs">{op.code}</TableCell>
                  <TableCell><Badge variant="outline">{op.requiredCapability}</Badge></TableCell>
                  <TableCell className="text-xs tabular-nums">{Array.isArray(op.requiredSkillIds) ? op.requiredSkillIds.length : 0}</TableCell>
                  <TableCell className="text-xs">{op.toolType ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{fmtDuration(op.estimatedCycleMs)}</TableCell>
                  <TableCell className="text-right">
                    {canControl ? (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" className="h-7" onClick={() => { setResolveInput(op.code); setResolveCode(op.code); }}>
                          <Search className="mr-1 h-3.5 w-3.5" />{t("fleet.op.resolve", "Resolve")}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7" onClick={() => onMap(op)}>
                          <Link2 className="mr-1 h-3.5 w-3.5" />{t("fleet.op.map", "Map program")}
                        </Button>
                      </div>
                    ) : (
                      <Button size="sm" variant="ghost" className="h-7" onClick={() => { setResolveInput(op.code); setResolveCode(op.code); }}>
                        <Search className="mr-1 h-3.5 w-3.5" />{t("fleet.op.resolve", "Resolve")}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// G2-c — RESOURCES tab
// ══════════════════════════════════════════════════════════════════════════════
function ResourcesTab({
  resources, loading, canControl, controlReason, reservationsByResource, releasePending, onCreate, onReserve, onRelease,
}: {
  resources: FleetResource[];
  loading: boolean;
  canControl: boolean;
  controlReason?: string;
  reservationsByResource: Map<number, FleetResReservation[]>;
  releasePending: boolean;
  onCreate: () => void;
  onReserve: (r: FleetResource) => void;
  onRelease: (deviceId: number, resourceId: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Wrench className="h-4 w-4" />
          {t("fleet.res.title", "Shared resources")}
        </CardTitle>
        <Button size="sm" variant="outline" className="h-8" disabled={!canControl} title={controlReason} onClick={onCreate}>
          <Plus className="mr-1 h-4 w-4" />{t("fleet.res.create", "New resource")}
        </Button>
      </CardHeader>
      <CardContent>
        {!loading && resources.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t("fleet.res.empty", "No shared resources (jigs / grippers / fixtures) defined yet.")}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {resources.map((r) => {
            const av = r.availability;
            const activeCount = av?.activeCount ?? 0;
            const queuedCount = av?.queuedCount ?? 0;
            const resReservations = reservationsByResource.get(r.id) ?? [];
            return (
              <Card key={r.id} className="border-border/60">
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
                              disabled={releasePending}
                              onClick={() => onRelease(rr.deviceId, r.id)}
                            >
                              {t("fleet.release", "Release")}
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <Button size="sm" variant="outline" className="mt-1 h-7 w-full" disabled={!canControl} title={controlReason} onClick={() => onReserve(r)}>
                    <Wrench className="mr-1 h-3.5 w-3.5" />{t("fleet.res.reserve", "Reserve")}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// G2-d — CHARGING tab
// ══════════════════════════════════════════════════════════════════════════════
function ChargingTab({
  chargers, chargersLoading, plans, plansLoading, canControl, controlReason, sweepPending, onCreateCharger, onSweep,
}: {
  chargers: FleetCharger[];
  chargersLoading: boolean;
  plans: FleetChargingPlan[];
  plansLoading: boolean;
  canControl: boolean;
  controlReason?: string;
  sweepPending: boolean;
  onCreateCharger: () => void;
  onSweep: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {/* Charger stations */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Zap className="h-4 w-4" />
            {t("fleet.charger.title", "Charger stations")}
          </CardTitle>
          <Button size="sm" variant="outline" className="h-8" disabled={!canControl} title={controlReason} onClick={onCreateCharger}>
            <Plus className="mr-1 h-4 w-4" />{t("fleet.charger.create", "New charger")}
          </Button>
        </CardHeader>
        <CardContent>
          {!chargersLoading && chargers.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("fleet.charger.empty", "No charger stations defined yet.")}</p>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {chargers.map((c) => (
              <Card key={c.id} className="border-border/60">
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
        </CardContent>
      </Card>

      {/* Charging plans */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <BatteryCharging className="h-4 w-4" />
            {t("fleet.plan.title", "Battery charging plans")}
          </CardTitle>
          <Button size="sm" variant="outline" className="h-8" disabled={!canControl || sweepPending} title={controlReason} onClick={onSweep}>
            <RefreshCw className={`mr-1 h-4 w-4 ${sweepPending ? "animate-spin" : ""}`} />{t("fleet.plan.sweep", "Sweep now")}
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("fleet.plan.col.device", "Device")}</TableHead>
                <TableHead>{t("fleet.plan.col.energy", "Current %")}</TableHead>
                <TableHead>{t("fleet.plan.col.start", "Planned start")}</TableHead>
                <TableHead>{t("fleet.plan.col.duration", "Est duration")}</TableHead>
                <TableHead>{t("fleet.plan.col.status", "Status")}</TableHead>
                <TableHead>{t("fleet.plan.col.reason", "Reason")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plansLoading && (
                <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">{t("fleet.loading", "Loading…")}</TableCell></TableRow>
              )}
              {!plansLoading && plans.length === 0 && (
                <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">{t("fleet.plan.empty", "No charging plans. Run a sweep to schedule preemptive charges.")}</TableCell></TableRow>
              )}
              {plans.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="text-xs"><span className="inline-flex items-center gap-1"><Bot className="h-3 w-3" />#{p.deviceId}</span></TableCell>
                  <TableCell className="text-xs tabular-nums">{p.currentEnergyPct != null ? `${p.currentEnergyPct}%` : "—"}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{fmtDateTime(p.plannedStartAt)}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{fmtDuration(p.estimatedDurationMs)}</TableCell>
                  <TableCell>{planStatusBadge(p.status, t)}</TableCell>
                  <TableCell className="max-w-[16rem] truncate text-xs text-muted-foreground" title={p.reason ?? undefined}>{p.reason ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// G2 dialogs
// ══════════════════════════════════════════════════════════════════════════════
function CreateOperationDialog({
  pending, onClose, onSubmit,
}: {
  pending: boolean;
  onClose: () => void;
  onSubmit: (v: { code: string; description?: string; requiredCapability: string; toolType?: string; estimatedCycleMs?: number }) => void;
}) {
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  const [requiredCapability, setRequiredCapability] = useState("");
  const [toolType, setToolType] = useState("");
  const [estCycle, setEstCycle] = useState("");
  const [description, setDescription] = useState("");

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
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Workflow className="h-4 w-4" />{t("fleet.op.createTitle", "New operation code")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-1">
            <Label>{t("fleet.op.code", "Operation code")}</Label>
            <Input value={code} placeholder="OP-WELD-01" onChange={(e) => setCode(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label>{t("fleet.op.capability", "Required capability")}</Label>
            <Input value={requiredCapability} placeholder="run_job" onChange={(e) => setRequiredCapability(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label>{t("fleet.op.toolType", "Tool type")}</Label>
              <Input value={toolType} placeholder="gripper" onChange={(e) => setToolType(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>{t("fleet.op.estCycleMs", "Est cycle (ms)")}</Label>
              <Input type="number" min={0} value={estCycle} placeholder="30000" onChange={(e) => setEstCycle(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1">
            <Label>{t("fleet.op.description", "Description")}</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel", "Cancel")}</Button>
          <Button onClick={submit} disabled={pending}><CheckCircle2 className="mr-1 h-4 w-4" />{t("fleet.op.create", "Create")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MapProgramDialog({
  operation, pending, onClose, onSubmit,
}: {
  operation: FleetOperation;
  pending: boolean;
  onClose: () => void;
  onSubmit: (programProjectId: number, deviceKind?: string) => void;
}) {
  const { t } = useTranslation();
  const [programProjectId, setProgramProjectId] = useState("");
  const [deviceKind, setDeviceKind] = useState("");

  const submit = () => {
    const n = Number(programProjectId);
    if (!Number.isInteger(n) || n <= 0) {
      toast.error(t("fleet.op.programIdRequired", "Enter a valid program project id."));
      return;
    }
    onSubmit(n, deviceKind.trim() || undefined);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Link2 className="h-4 w-4" />{t("fleet.op.mapTitle", "Map program to operation")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="text-sm text-muted-foreground">
            <span className="font-mono text-xs">{operation.code}</span>{" · "}{operation.requiredCapability}
          </div>
          <div className="grid gap-1">
            <Label>{t("fleet.op.programId", "Program project id")}</Label>
            <Input type="number" min={1} value={programProjectId} placeholder="e.g. 1" onChange={(e) => setProgramProjectId(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label>{t("fleet.op.deviceKind", "Device kind (optional)")}</Label>
            <Input value={deviceKind} placeholder="arm / scara / cobot / agv" onChange={(e) => setDeviceKind(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel", "Cancel")}</Button>
          <Button onClick={submit} disabled={pending}><CheckCircle2 className="mr-1 h-4 w-4" />{t("fleet.op.map", "Map program")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateResourceDialog({
  pending, onClose, onSubmit,
}: {
  pending: boolean;
  onClose: () => void;
  onSubmit: (v: { code: string; name?: string; type: (typeof RESOURCE_TYPES)[number]; locationZoneId?: number }) => void;
}) {
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<(typeof RESOURCE_TYPES)[number]>("other");
  const [zoneId, setZoneId] = useState("");

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
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Wrench className="h-4 w-4" />{t("fleet.res.createTitle", "New shared resource")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label>{t("fleet.res.code", "Code")}</Label>
              <Input value={code} placeholder="JIG-01" onChange={(e) => setCode(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>{t("fleet.res.type", "Type")}</Label>
              <Select value={type} onValueChange={(v) => setType(v as (typeof RESOURCE_TYPES)[number])}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RESOURCE_TYPES.map((tp) => (
                    <SelectItem key={tp} value={tp}>{t(`fleet.resType.${tp}`, tp)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1">
            <Label>{t("fleet.res.name", "Name")}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label>{t("fleet.res.zoneId", "Home zone id (optional)")}</Label>
            <Input type="number" min={1} value={zoneId} placeholder="e.g. 1" onChange={(e) => setZoneId(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel", "Cancel")}</Button>
          <Button onClick={submit} disabled={pending}><CheckCircle2 className="mr-1 h-4 w-4" />{t("fleet.res.create", "Create")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReserveResourceDialog({
  resource, pending, onClose, onSubmit,
}: {
  resource: FleetResource;
  pending: boolean;
  onClose: () => void;
  onSubmit: (deviceId: number, queueIfFull: boolean) => void;
}) {
  const { t } = useTranslation();
  const [deviceId, setDeviceId] = useState("");
  const [queueIfFull, setQueueIfFull] = useState(true);

  const submit = () => {
    const n = Number(deviceId);
    if (!Number.isInteger(n) || n <= 0) {
      toast.error(t("fleet.deviceIdRequired", "Enter a valid device id."));
      return;
    }
    onSubmit(n, queueIfFull);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Wrench className="h-4 w-4" />{t("fleet.res.reserveTitle", "Reserve resource")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{resource.name ?? resource.code}</span>
            {" · "}<span className="font-mono text-xs">{resource.code}</span>{" · "}{resource.type}
          </div>
          <div className="grid gap-1">
            <Label>{t("fleet.deviceId", "Device id (robot)")}</Label>
            <Input type="number" min={1} value={deviceId} placeholder={t("fleet.deviceIdPlaceholder", "e.g. 1")} onChange={(e) => setDeviceId(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={queueIfFull} onCheckedChange={(v) => setQueueIfFull(Boolean(v))} />
            {t("fleet.res.queueIfFull", "Queue if the resource is in use (otherwise reject)")}
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel", "Cancel")}</Button>
          <Button onClick={submit} disabled={pending}><Wrench className="mr-1 h-4 w-4" />{t("fleet.res.reserve", "Reserve")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateChargerDialog({
  pending, onClose, onSubmit,
}: {
  pending: boolean;
  onClose: () => void;
  onSubmit: (v: { code: string; name?: string; chargerType: string; powerWatts?: number; locationZoneId?: number }) => void;
}) {
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [chargerType, setChargerType] = useState("contact");
  const [powerWatts, setPowerWatts] = useState("");
  const [zoneId, setZoneId] = useState("");

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
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Zap className="h-4 w-4" />{t("fleet.charger.createTitle", "New charger station")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label>{t("fleet.charger.code", "Code")}</Label>
              <Input value={code} placeholder="CHG-01" onChange={(e) => setCode(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>{t("fleet.charger.type", "Charger type")}</Label>
              <Input value={chargerType} placeholder="contact / inductive" onChange={(e) => setChargerType(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1">
            <Label>{t("fleet.charger.name", "Name")}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label>{t("fleet.charger.power", "Power (W)")}</Label>
              <Input type="number" min={0} value={powerWatts} placeholder="2000" onChange={(e) => setPowerWatts(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>{t("fleet.charger.zoneId", "Zone id (optional)")}</Label>
              <Input type="number" min={1} value={zoneId} placeholder="e.g. 1" onChange={(e) => setZoneId(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel", "Cancel")}</Button>
          <Button onClick={submit} disabled={pending}><CheckCircle2 className="mr-1 h-4 w-4" />{t("fleet.charger.create", "Create")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
