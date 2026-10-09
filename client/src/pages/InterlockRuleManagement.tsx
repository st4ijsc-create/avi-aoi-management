/**
 * Sprint G2.2b — Interlock rule administration (CONFIG + VIEW + workflow only).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SAFETY:
 *   - This page manages interlock RULE definitions and their approve/enable
 *     workflow through interlockRouter only. It NEVER calls commandDispatcher and
 *     NEVER bypasses HITL.
 *   - A freshly-created rule is ALWAYS disabled + unapproved (router enforces).
 *   - approve is ADMIN-ONLY (the button is hidden for non-admins; the router also
 *     rejects non-admins). enable requires the rule to be approved first — the
 *     "Bật" button is disabled with an explanatory tooltip until approvedBy is set.
 *   - "Test (dry-run)" calls testEvaluate which writes NOTHING (no event/Andon/
 *     command); it only reports whether the condition would fire.
 * RBAC via module 'interlock':
 *   view = canView ; create = canCreate ; edit/enable/disable/resolveEvent = canEdit ;
 *   delete = canDelete ; approve = admin-only.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Doc 81 Đợt 2 Task 5 — bố cục P3 (doc 81 §1.2 dòng Interlock, FE1 §2.6, FE2 §3):
 *  - Header một hàng (`PageHeaderCompact`): h1 (+ "Chỉ xem") · chip "Khi nào dùng" (câu khi-nào-dùng +
 *    phụ đề cũ, trong popover) · chip tư thế engine / OT ghi / độ phủ đọc `oversight.posture` (cùng vị từ
 *    các cổng thật — ILK-06), kèm chip cảnh báo khi ghi thật BẬT mà engine TẮT · nút "Thêm quy tắc".
 *  - MAIN (`data-layout-main`) = danh sách rule. Thanh công cụ DUY NHẤT trong MAIN là dải tab `TabbedHub`
 *    (`?tab=rules|matrix`): Danh sách / Ma trận Cause×Effect (hàng = nguồn·phạm vi, cột = hành động·đích,
 *    ô = rule nối hai bên). Chip lọc `?filter=pending` (deep-link Hub, Đợt 1 Task 2) nằm cùng hàng.
 *  - Panel dưới "Sự kiện" (NGOÀI MAIN, `WorkbenchShell.bottom` — kéo/gập được, không unmount): lọc theo
 *    rule đang chọn (`?rule=<id>`, bấm/Enter trên hàng hoặc ô ma trận) + lọc open/resolved như cũ.
 *  - Sửa / thêm rule = sheet (`?flyout=rule&flyoutId=<id>` / `?flyout=rule-new`), giữ cảnh báo "Lưu sẽ tắt
 *    rule và cần duyệt lại" (Đợt 1 Task 11) và preserve-if-untouched của commandValue (doc 80 Task 2).
 *  - Test (dry-run) = flyout công cụ `?flyout=rule-test&flyoutId=<id>`.
 *  - Duyệt / Bật vẫn gửi `expectedVersion` = versionToken của HÀNG đang hiển thị (Đợt 1 Task 9); Tắt / Xoá /
 *    Giải quyết vẫn qua ConfirmWithReason (ILK-03). Không thủ tục, input hay thông điệp lỗi nào đổi.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { trpc } from "@/lib/trpc";
import { mapTrpcError, toastTrpcError } from "@/lib/trpcErrors";
import { usePollingInterval } from "@/hooks/usePollingInterval";
import { useTranslation } from "react-i18next";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { ViewOnlyBadge } from "@/components/PermissionGate";
import { PollFreshness } from "@/components/PollFreshness";
import {
  ConfirmWithReason, PageContainer, PageHeaderCompact, NoticeStack, StatusChipStrip, chipStateFromQuery,
  FlyoutHost, useFlyout, useFlyoutLayer, useCloseOwnLayer, WorkbenchShell,
  type StatusChipItem,
} from "@/components/patterns";
import { useUrlParam } from "@/components/patterns/useUrlParam";
import type { FlyoutDefinition } from "@/components/patterns";
import { TabbedHub, type TabbedHubTab } from "@/components/workspace/TabbedHub";
import { useLocation, useSearch } from "wouter";
import { navItems } from "@/lib/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ShieldAlert, Plus, Pencil, Trash2, CheckCircle2, Play, Pause, FlaskConical, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  serializeCommandValueForEdit,
  inferCommandValueType,
  resolveCommandValueForSubmit,
  CommandValueParseError,
  type CommandValueType,
} from "@/lib/interlockCommandValue";
// doc 81 Đợt 3 Task 4 — "Giao cho" (sheet rule) + cột "Người được giao" (danh sách). Được giao ≠ được duyệt (duyệt vẫn admin + SoD).
import { AssigneeCell, AssignmentControl, useAssignments, useCanAssign, type AssignmentRow } from "@/components/engineering/AssignmentControl";

const SCOPES = ["line", "station", "machine"] as const;
const SOURCE_TYPES = ["spc_violation", "ng_rate", "process_result", "telemetry_tag", "cpk"] as const;
const OPERATORS = ["lt", "lte", "gt", "gte", "eq"] as const;
const ACTIONS = ["alert", "block_downstream", "stop_line", "reduce_speed"] as const;

type Scope = (typeof SCOPES)[number];
type SourceType = (typeof SOURCE_TYPES)[number];
type Operator = (typeof OPERATORS)[number];
type Action = (typeof ACTIONS)[number];
type EventFilter = "all" | "open" | "resolved";

/** Hàng `interlock.list` — chỉ các trường trang đọc. */
type RuleRow = {
  id: number;
  name: string;
  description?: string | null;
  scope: Scope;
  lineId?: number | null;
  stationId?: number | null;
  machineId?: number | null;
  sourceType: SourceType;
  sourceKey?: string | null;
  comparisonOperator: Operator;
  threshold?: string | number | null;
  windowSize?: number | null;
  consecutiveCount?: number | null;
  windowSeconds?: number | null;
  action: Action;
  targetMachineId?: number | null;
  targetAdapterId?: number | null;
  commandTag?: string | null;
  commandValue?: unknown;
  cooldownSeconds?: number | null;
  enabled: boolean;
  approvedBy?: number | null;
  versionToken: string;
};
type EventRow = {
  id: number;
  ruleId: number;
  status: string;
  firedAt?: unknown;
  observedValue?: unknown;
  threshold?: unknown;
  action?: string | null;
};

interface RuleForm {
  id?: number;
  name: string;
  description: string;
  scope: Scope;
  lineId: string;
  stationId: string;
  machineId: string;
  sourceType: SourceType;
  sourceKey: string;
  comparisonOperator: Operator;
  threshold: string;
  windowSize: string;
  consecutiveCount: string;
  windowSeconds: string;
  action: Action;
  targetMachineId: string;
  targetAdapterId: string;
  commandTag: string;
  commandValue: string;
  // Fix round 2 (doc 80 Task 2 review) — explicit "Kiểu giá trị" selector so a
  // typed edit is unambiguous (no more auto-detecting "1" as text vs number).
  commandValueType: CommandValueType;
  cooldownSeconds: string;
}

const emptyRule: RuleForm = {
  name: "", description: "", scope: "machine", lineId: "", stationId: "", machineId: "",
  sourceType: "ng_rate", sourceKey: "", comparisonOperator: "gt", threshold: "",
  windowSize: "", consecutiveCount: "", windowSeconds: "", action: "alert",
  targetMachineId: "", targetAdapterId: "", commandTag: "", commandValue: "", commandValueType: "text",
  cooldownSeconds: "300",
};

function formFromRule(r: RuleRow): RuleForm {
  return {
    id: r.id,
    name: r.name ?? "",
    description: r.description ?? "",
    scope: r.scope,
    lineId: r.lineId != null ? String(r.lineId) : "",
    stationId: r.stationId != null ? String(r.stationId) : "",
    machineId: r.machineId != null ? String(r.machineId) : "",
    sourceType: r.sourceType,
    sourceKey: r.sourceKey ?? "",
    comparisonOperator: r.comparisonOperator,
    threshold: r.threshold != null ? String(r.threshold) : "",
    windowSize: r.windowSize != null ? String(r.windowSize) : "",
    consecutiveCount: r.consecutiveCount != null ? String(r.consecutiveCount) : "",
    windowSeconds: r.windowSeconds != null ? String(r.windowSeconds) : "",
    action: r.action,
    targetMachineId: r.targetMachineId != null ? String(r.targetMachineId) : "",
    targetAdapterId: r.targetAdapterId != null ? String(r.targetAdapterId) : "",
    commandTag: r.commandTag ?? "",
    // Fix round 1/2 (doc 80 Task 2 review) — see client/src/lib/interlockCommandValue.ts.
    commandValue: serializeCommandValueForEdit(r.commandValue),
    commandValueType: inferCommandValueType(r.commandValue),
    cooldownSeconds: r.cooldownSeconds != null ? String(r.cooldownSeconds) : "300",
  };
}

function sameForm(a: RuleForm, b: RuleForm): boolean {
  return (Object.keys(a) as Array<keyof RuleForm>).every((k) => a[k] === b[k]) && Object.keys(b).length === Object.keys(a).length;
}

function numOrNull(s: string): number | null {
  const v = s.trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function actionVariant(action: string): "default" | "secondary" | "destructive" | "outline" {
  if (action === "alert") return "secondary";
  if (action === "reduce_speed") return "outline";
  return "destructive"; // block_downstream / stop_line
}

// ── Dữ liệu dùng chung cho các tab của TabbedHub (Content là ComponentType không nhận props) ──
interface InterlockPageCtx {
  rules: RuleRow[];
  visibleRules: RuleRow[];
  selectedRuleId: number | null;
  selectRule: (id: number) => void;
  canEdit: boolean;
  canDelete: boolean;
  isAdmin: boolean;
  editReason?: string;
  deleteReason?: string;
  approveReason?: string;
  approve: (r: RuleRow) => void;
  enable: (r: RuleRow) => void;
  approvePending: boolean;
  enablePending: boolean;
  disablePending: boolean;
  deletePending: boolean;
  disable: (r: RuleRow, reason: string) => Promise<unknown>;
  remove: (r: RuleRow, reason: string) => Promise<unknown>;
  /** doc 81 Đợt 3 Task 4 — phân công đang hiệu lực (id rule → hàng). */
  assignments: Map<number, AssignmentRow>;
}
const InterlockCtx = createContext<InterlockPageCtx | null>(null);
function usePageCtx(): InterlockPageCtx {
  const v = useContext(InterlockCtx);
  if (!v) throw new Error("InterlockCtx missing");
  return v;
}

export default function InterlockRuleManagement() {
  const { t } = useTranslation();
  const { hasPermission, isAdmin } = usePermissions();
  const { user } = useAuth();
  const canView = hasPermission("interlock", "canView");
  const canCreate = hasPermission("interlock", "canCreate");
  const canEdit = hasPermission("interlock", "canEdit");
  const canDelete = hasPermission("interlock", "canDelete");
  // U4 (doc 26 §2.4) — hiện-nhưng-khoá: lý do khi thiếu quyền tương ứng.
  const createReason = !canCreate ? t("common.gate.needPerm", "Requires {{perm}} permission", { perm: "interlock" }) : undefined;
  const editReason = !canEdit ? t("common.gate.needPerm", "Requires {{perm}} permission", { perm: "interlock" }) : undefined;
  const deleteReason = !canDelete ? t("common.gate.needPerm", "Requires {{perm}} permission", { perm: "interlock" }) : undefined;
  const approveReason = !isAdmin ? t("common.gate.needPerm", "Requires {{perm}} permission", { perm: "admin" }) : undefined;

  const utils = trpc.useUtils();
  const rulesQuery = trpc.interlock.list.useQuery(undefined, { enabled: canView });
  const ruleIds = useMemo(() => ((rulesQuery.data ?? []) as Array<{ id: number }>).map((r) => r.id), [rulesQuery.data]);
  const { byId: assignments } = useAssignments("interlock_rule", ruleIds, canView);
  const canAssign = useCanAssign("interlock_rule");
  // Realtime: refetch danh sách sự kiện định kỳ; dừng khi không có quyền xem
  // hoặc khi tab bị ẩn (doc 27 B12 — usePollingInterval).
  const eventsPolling = usePollingInterval(canView ? 5000 : false);
  const eventsQuery = trpc.interlock.events.useQuery(
    { limit: 100 },
    { enabled: canView, ...eventsPolling },
  );
  // Doc 81 Đợt 2 Task 5 — chip tư thế (ILK-06): đọc CÙNG nguồn với dải "Tư thế an toàn" của Hub.
  const postureQuery = trpc.oversight.posture.useQuery(undefined, { enabled: canView, staleTime: 30_000 });

  const invalidateRules = () => void utils.interlock.list.invalidate();
  const invalidateEvents = () => void utils.interlock.events.invalidate();

  const deleteRule = trpc.interlock.delete.useMutation({
    onSuccess: () => { toast.success(t("interlockRules.toastDeleted")); invalidateRules(); },
    onError: (e) => toastTrpcError(e),
  });
  // doc 80 Đợt 1 Task 9 — approve/enable gửi `expectedVersion` = versionToken của HÀNG đang hiển
  // thị. Server trả CONFLICT khi rule đã bị sửa từ lúc tải trang ⇒ toast lý do ("tải lại để
  // duyệt") VÀ tải lại danh sách ngay, để người duyệt thấy nội dung mới trước khi bấm lại.
  const approveRule = trpc.interlock.approve.useMutation({
    onSuccess: () => { toast.success(t("interlockRules.toastApproved")); invalidateRules(); },
    onError: (e) => { toastTrpcError(e); if (e.data?.code === "CONFLICT") invalidateRules(); },
  });
  const enableRule = trpc.interlock.enable.useMutation({
    onSuccess: () => { toast.success(t("interlockRules.toastEnabled")); invalidateRules(); },
    onError: (e) => { toastTrpcError(e); if (e.data?.code === "CONFLICT") invalidateRules(); },
  });
  const disableRule = trpc.interlock.disable.useMutation({
    onSuccess: () => { toast.success(t("interlockRules.toastDisabled")); invalidateRules(); },
    onError: (e) => toastTrpcError(e),
  });
  const resolveEvent = trpc.interlock.resolveEvent.useMutation({
    onSuccess: () => { toast.success(t("interlockRules.toastResolved")); invalidateEvents(); },
    onError: (e) => toastTrpcError(e),
  });

  const rules = (rulesQuery.data ?? []) as RuleRow[];
  const events = (eventsQuery.data ?? []) as EventRow[];
  // Map id→tên rule để hiển thị tên thay vì #ruleId trong bảng sự kiện.
  const ruleNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const r of rules) m.set(r.id, r.name);
    return m;
  }, [rules]);

  // Doc 80 Đợt 1 Task 2 (HUB-03) — deep-link `?filter=pending` từ Engineering Hub
  // (trước bản vá: BỊ BỎ QUA hoàn toàn — trang không đọc query nào).
  const search = useSearch();
  const filterPending = useMemo(() => new URLSearchParams(search).get("filter") === "pending", [search]);
  const [showPendingOnly, setShowPendingOnly] = useState(false);

  // U13 (doc 26 §2.2) — lọc sự kiện open/resolved + đếm chưa xử lý.
  const [eventFilter, setEventFilter] = useState<EventFilter>("all");

  // HUB-03 — filter=pending ⇒ rule chưa duyệt + panel Sự kiện mặc định "Đang mở".
  useEffect(() => {
    if (filterPending) {
      setShowPendingOnly(true);
      setEventFilter("open");
    }
  }, [filterPending]);

  // Doc 81 Đợt 2 Task 5 — rule đang chọn (`?rule=<id>`, F5 giữ) ⇒ panel Sự kiện chỉ hiện sự kiện của nó.
  const [ruleParam, setRuleParam] = useUrlParam("rule");
  const selectedRuleId = ruleParam != null && /^\d+$/.test(ruleParam) ? Number(ruleParam) : null;

  // Fix round 1 — Ruling R-2-l: panel Sự kiện GẬP ở lần đầu (MAIN chiếm phần lớn khung đầu); mở theo Ý ĐỊNH
  // rõ ràng — chọn rule (hàng/ô ma trận), deep-link `?rule=`/`?filter=pending`, bấm nút đếm sự kiện, hành
  // động "Mở panel Sự kiện" của toast. Lựa chọn gập/mở do chính người dùng làm được WorkbenchShell nhớ.
  const [eventsOpenRequest, setEventsOpenRequest] = useState(0);
  const openEventsPanel = () => setEventsOpenRequest((n) => n + 1);
  // Deep-link: chỉ URL LÚC NẠP trang (F5 / link từ Hub); các lần chọn sau đi qua `selectRule`.
  useEffect(() => {
    if (ruleParam != null || filterPending) openEventsPanel();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const unresolvedCount = useMemo(
    () => events.filter((e) => e.status !== "resolved").length,
    [events],
  );
  const filteredEvents = useMemo(() => {
    const byRule = selectedRuleId != null ? events.filter((e) => e.ruleId === selectedRuleId) : events;
    if (eventFilter === "open") return byRule.filter((e) => e.status !== "resolved");
    if (eventFilter === "resolved") return byRule.filter((e) => e.status === "resolved");
    return byRule;
  }, [events, eventFilter, selectedRuleId]);
  // HUB-03 — rule CHƯA DUYỆT (approvedBy null) khi đến từ deep-link `?filter=pending`.
  const visibleRules = useMemo(
    () => (showPendingOnly ? rules.filter((r) => r.approvedBy == null) : rules),
    [rules, showPendingOnly],
  );

  // ── U12 (doc 26 §2.3) — nhắc khi có SỰ KIỆN INTERLOCK MỚI chưa xử lý ─────────
  // So sánh tập id sự kiện với lần poll trước; chỉ toast id MỚI & chưa resolved
  // (chống spam, không báo lại sự kiện đã thấy hay đã xử lý).
  const seenEventIdsRef = useRef<Set<number> | null>(null);
  useEffect(() => {
    if (eventsQuery.isLoading || eventsQuery.isError) return;
    const ids = new Set(events.map((e) => e.id));
    // Lần đầu (prime) chỉ ghi nhận baseline, KHÔNG toast.
    if (seenEventIdsRef.current === null) {
      seenEventIdsRef.current = ids;
      return;
    }
    const prev = seenEventIdsRef.current;
    const fresh = events.filter((e) => !prev.has(e.id) && e.status !== "resolved");
    seenEventIdsRef.current = ids;
    if (fresh.length > 0) {
      toast.warning(
        t("interlockRules.newEventToast", "Interlock triggered") +
          (fresh.length > 1 ? ` (${fresh.length})` : ""),
        {
          description: t("interlockRules.newEventDesc", "A new interlock event fired — open the Events tab to review."),
          // R-2-l — panel có thể đang gập: toast mở thẳng panel.
          action: { label: t("interlockRules.openEventsPanel", "Mở panel Sự kiện"), onClick: () => setEventsOpenRequest((n) => n + 1) },
        },
      );
    }
  }, [events, eventsQuery.isLoading, eventsQuery.isError, t]);

  if (!canView) {
    return (
      <DashboardLayout title={t("interlockRules.title")} navItems={navItems} currentPath="/interlock-rules">
        <div className="p-6 text-muted-foreground">{t("interlockRules.noViewPermission")}</div>
      </DashboardLayout>
    );
  }

  const rulesLoaded = !rulesQuery.isLoading;
  const findRule = (id: string | null) => rules.find((r) => String(r.id) === id) ?? null;

  // ── Flyouts (một stack sheet phải; URL `?flyout=&flyoutId=` là nguồn sự thật) ──
  const flyouts: Record<string, FlyoutDefinition> = {
    // Test (dry-run) — công cụ chỉ đọc (testEvaluate KHÔNG ghi gì), như nút cũ: không cổng quyền riêng.
    "rule-test": {
      size: "sm",
      title: t("interlockRules.testTitle"),
      description: t("interlockRules.testDesc"),
      render: (layer) => <RuleTestTool id={layer.id} rule={findRule(layer.id)} loaded={rulesLoaded} />,
    },
  };
  if (canCreate) {
    flyouts["rule-new"] = {
      size: "lg",
      title: t("interlockRules.newRule"),
      description: t("interlockRules.ruleDialogDesc"),
      render: () => <RuleEditForm rule={null} onSaved={invalidateRules} />,
    };
  }
  if (canEdit) {
    flyouts.rule = {
      size: "lg",
      title: t("interlockRules.editRule"),
      description: t("interlockRules.ruleDialogDesc"),
      render: (layer) => {
        const r = findRule(layer.id);
        if (!r) {
          return (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {rulesLoaded
                ? t("interlockRules.ruleNotFound", "Không tìm thấy quy tắc #{{id}}.", { id: layer.id ?? "" })
                : t("common.loading", "Đang tải…")}
            </p>
          );
        }
        // key = id: form khởi tạo MỘT lần từ hàng lúc mở (như dialog cũ); danh sách tải lại không ghi đè.
        // doc 81 Đợt 3 Task 4 — rule CHƯA DUYỆT: "Giao cho" ở đầu sheet (cổng = interlock/canEdit, như chính sheet này).
        return (
          <div className="space-y-3">
            {r.approvedBy == null && (
              <AssignmentControl entityType="interlock_rule" entityId={r.id} assignment={assignments.get(r.id)} canAssign={canAssign} className="rounded-md border p-2" />
            )}
            <RuleEditForm key={r.id} rule={r} onSaved={invalidateRules} />
          </div>
        );
      },
    };
  }

  const ctx: InterlockPageCtx = {
    rules,
    visibleRules,
    selectedRuleId,
    selectRule: (id) => {
      setRuleParam(String(id));
      openEventsPanel();
    },
    canEdit,
    canDelete,
    isAdmin,
    editReason,
    deleteReason,
    approveReason,
    approve: (r) => approveRule.mutate({ id: r.id, expectedVersion: r.versionToken }),
    enable: (r) => enableRule.mutate({ id: r.id, expectedVersion: r.versionToken }),
    approvePending: approveRule.isPending,
    enablePending: enableRule.isPending,
    disablePending: disableRule.isPending,
    deletePending: deleteRule.isPending,
    disable: (r, reason) => disableRule.mutateAsync({ id: r.id, reason }),
    remove: (r, reason) => deleteRule.mutateAsync({ id: r.id, reason }),
    assignments,
  };

  const tabs: TabbedHubTab[] = [
    { value: "rules", labelKey: "interlockRules.view.list", fallback: "Danh sách", Content: RulesListView },
    { value: "matrix", labelKey: "interlockRules.view.matrix", fallback: "Ma trận Cause×Effect", Content: CauseEffectMatrixView },
  ];

  return (
    <DashboardLayout title={t("interlockRules.title")} navItems={navItems} currentPath="/interlock-rules">
      <FlyoutHost flyouts={flyouts}>
        {/* doc 81 Đợt 2 Task 2 — PageContainer: không đệm kép với <main> của shell. */}
        <PageContainer className="space-y-3">
          <InterlockHeader canCreate={canCreate} createReason={createReason} posture={postureQuery} />
          <InterlockCtx.Provider value={ctx}>
            <WorkbenchShell
              layoutId="interlock-rules"
              userId={user?.id ?? null}
              mainName="interlock-rules"
              mainLabel={t("interlockRules.rules")}
              mainAria={{ "aria-label": t("interlockRules.rules") }}
              heightClass="h-[calc(100dvh_-_var(--shell-chrome-h,3.5rem)_-_5.75rem)] min-h-[28rem]"
              main={
                <div className="p-2">
                  <TabbedHub
                    tabs={tabs}
                    basePath="/interlock-rules"
                    defaultTab="rules"
                    className="space-y-2"
                    listRowAttrs={{ "data-layout-toolbar": "" }}
                    listRowStyle={{ maxHeight: 56 }}
                    listClassName="h-9"
                    listEnd={
                      <>
                        {/* Doc 80 Đợt 1 Task 2 (HUB-03) — deep-link `?filter=pending` từ Hub. */}
                        {showPendingOnly && (
                          <div
                            className="inline-flex h-8 items-center gap-1 rounded-full border border-warning/40 bg-warning/10 pl-3 pr-1 text-xs text-muted-foreground"
                            title={t("interlockRules.filteringPending", "Đang lọc: chỉ hiện quy tắc chưa duyệt")}
                          >
                            <span>{t("interlockRules.filterPendingChip", "Chỉ quy tắc chưa duyệt")}</span>
                            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setShowPendingOnly(false)}>
                              {t("interlockRules.showAll", "Xem tất cả")}
                            </Button>
                          </div>
                        )}
                        {/* R-2-l — đếm sự kiện chưa xử lý LUÔN thấy (kể cả khi panel gập); bấm = mở panel. */}
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1.5 text-xs"
                          data-testid="events-open-button"
                          aria-label={unresolvedCount > 0
                            ? `${t("interlockRules.openEventsPanel", "Mở panel Sự kiện")} — ${t("interlockRules.unresolvedCount", "{{count}} chưa xử lý", { count: unresolvedCount })}`
                            : t("interlockRules.openEventsPanel", "Mở panel Sự kiện")}
                          title={t("interlockRules.openEventsPanel", "Mở panel Sự kiện")}
                          onClick={openEventsPanel}
                        >
                          {t("interlockRules.eventsButton", "Sự kiện")}
                          {unresolvedCount > 0 && (
                            <Badge variant="destructive" className="h-4 min-w-4 px-1 text-[10px]">{unresolvedCount}</Badge>
                          )}
                        </Button>
                        <span className="text-xs text-muted-foreground">
                          {t("interlockRules.ruleCount", "{{count}} quy tắc", { count: visibleRules.length })}
                        </span>
                      </>
                    }
                  />
                </div>
              }
              bottom={{
                label: t("interlockRules.events"),
                minPx: 160,
                defaultPx: 240,
                maxPx: 480,
                defaultCollapsed: true,
                openRequest: eventsOpenRequest,
                content: (
                  <EventsPanel
                    events={filteredEvents}
                    unresolvedCount={unresolvedCount}
                    isError={eventsQuery.isError}
                    isLoading={eventsQuery.isLoading}
                    updatedAt={eventsQuery.dataUpdatedAt}
                    isFetching={eventsQuery.isFetching}
                    eventFilter={eventFilter}
                    onEventFilter={setEventFilter}
                    selectedRuleId={selectedRuleId}
                    onClearRule={() => setRuleParam(null)}
                    ruleNameById={ruleNameById}
                    canEdit={canEdit}
                    editReason={editReason}
                    resolvePending={resolveEvent.isPending}
                    onResolve={(ev, reason) => resolveEvent.mutateAsync({ id: ev.id, reason })}
                  />
                ),
              }}
            />
          </InterlockCtx.Provider>
        </PageContainer>
      </FlyoutHost>
    </DashboardLayout>
  );
}

// ── Header ─────────────────────────────────────────────────────────────────────────────────────

interface PostureData {
  otControlEnabled: boolean;
  interlockEngineEnabled: boolean;
  interlockRulesEnabledWithTarget: number;
  interlockCoverageDegraded: boolean;
  writesOnEngineOff: boolean;
}
interface PostureQueryLike {
  data: PostureData | undefined;
  isLoading?: boolean;
  isPending?: boolean;
  isError?: boolean;
}

/** Header một hàng: h1 + chip (khi nào dùng, tư thế) + "Thêm quy tắc" (ngoài MAIN). */
function InterlockHeader({ canCreate, createReason, posture }: { canCreate: boolean; createReason?: string; posture: PostureQueryLike }) {
  const { t } = useTranslation();
  const flyout = useFlyout();
  const d = posture.data;
  const state = chipStateFromQuery(posture);
  const onOff = (b: boolean) => (b ? t("oversight.posture.on", "ON") : t("oversight.posture.off", "OFF"));
  const source = t("interlockRules.posture.source", "oversight.posture — cờ của chính các cổng trên server");
  // ILK-06: ghi lệnh thật BẬT trong khi engine TẮT ⇒ tô cảnh báo cả engine lẫn OT (như dải của Hub).
  // doc 81 Đợt 3b final wave (I1): ba chip TƯ THẾ an toàn GHIM (R-2-p) ⇒ header hẹp (768/1024) không gộp chúng vào "+N"
  // (trước: "+3" xám, "Engine TẮT" tông default im lặng). Header không đủ chỗ ⇒ xuống dòng (mức 2), không cắt.
  const items: StatusChipItem[] = [
    {
      id: "engine",
      label: t("interlockRules.posture.engine", "Engine"),
      value: d ? onOff(d.interlockEngineEnabled) : undefined,
      state,
      source,
      tone: d?.writesOnEngineOff ? "warning" : d?.interlockEngineEnabled ? "success" : "default",
      pinned: true,
    },
    {
      id: "ot",
      label: t("interlockRules.posture.ot", "OT ghi"),
      value: d ? onOff(d.otControlEnabled) : undefined,
      state,
      source,
      tone: d?.writesOnEngineOff && d.otControlEnabled ? "warning" : "default",
      pinned: true,
    },
    {
      id: "coverage",
      label: t("interlockRules.posture.coverage", "Độ phủ"),
      value: d?.interlockRulesEnabledWithTarget,
      // Không đọc được độ phủ ⇒ server trả 0 kèm cờ degraded: KHÔNG được trưng "0" như một con số.
      state: state === "ok" && d?.interlockCoverageDegraded ? "error" : state,
      source: t("interlockRules.posture.coverageSource", "oversight.posture — rule đang bật, đã duyệt, chặn được và có đích"),
      pinned: true,
    },
  ];
  return (
    <PageHeaderCompact
      icon={<ShieldAlert />}
      title={
        <span className="flex items-center gap-2">
          {t("interlockRules.title")}<ViewOnlyBadge module="interlock" />
        </span>
      }
      chips={
        <>
          {/* Thứ tự theo ưu tiên: cảnh báo ILK-06 → khi nào dùng (MỘT NoticeStack) → tư thế. Đợt 3b Task 2 fix 1 (R-3b-b): hai
              chip đứng riêng vào NoticeStack (cùng nội dung, cùng điều kiện) ⇒ header hẹp gộp "Khi nào dùng" vào "+N"; cảnh
              báo ILK-06 (kind error) LUÔN hiện. */}
          <NoticeStack
            items={[
              d?.writesOnEngineOff && {
                id: "writesOnEngineOff",
                kind: "error",
                label: t("interlockRules.posture.writesOnEngineOffChip", "Ghi thật khi engine TẮT"),
                content: t(
                  "oversight.posture.writesOnEngineOffWarning",
                  "Real device writes are ON while the interlock engine is OFF — violations will not be auto-blocked.",
                ),
              },
              // U7 (doc 26 §2.1) — "Khi nào dùng" + phụ đề cũ, trong popover (không còn khối trên MAIN).
              {
                id: "whenToUse",
                kind: "whenToUse",
                content: (
                  <>
                    <p>{t("interlockRules.whenToUse", "Khi nào dùng — định nghĩa quy tắc an toàn tự động dừng/giảm tốc máy khi vượt giới hạn, và xem lại các sự kiện đã kích hoạt.")}</p>
                    <p className="mt-2 text-muted-foreground">{t("interlockRules.subtitle")}</p>
                  </>
                ),
              },
            ]}
          />
          <StatusChipStrip items={items} ariaLabel={t("interlockRules.posture.ariaLabel", "Tư thế an toàn interlock")} maxVisible={3} className="shrink-0" />
        </>
      }
      actions={
        <Button size="sm" onClick={() => flyout.open("rule-new")} disabled={!canCreate} title={createReason}>
          <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> {t("interlockRules.newRule")}
        </Button>
      }
    />
  );
}

// ── MAIN: tab Danh sách ────────────────────────────────────────────────────────────────────────

function RulesListView() {
  const { t } = useTranslation();
  const c = usePageCtx();
  const flyout = useFlyout();
  // Nút trong ô thao tác không được lan click/Enter lên hàng (hàng = chọn rule).
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

  return (
    <TooltipProvider>
      <Table aria-label={t("interlockRules.rules")}>
        <TableHeader>
          <TableRow>
            <TableHead>{t("interlockRules.name")}</TableHead>
            <TableHead>{t("interlockRules.scope")}</TableHead>
            <TableHead>{t("interlockRules.source")}</TableHead>
            <TableHead>{t("interlockRules.condition")}</TableHead>
            <TableHead>{t("interlockRules.action")}</TableHead>
            <TableHead>{t("interlockRules.gate")}</TableHead>
            <TableHead>{t("interlockRules.cooldown")}</TableHead>
            <TableHead>{t("engineeringAssign.column", "Assignee")}</TableHead>
            {/* final wave M-10 — cột thao tác DÍNH phải: bảng rộng hơn MAIN ở 1366 vẫn luôn thấy Duyệt/Bật/Tắt (phần còn lại cuộn ngang). */}
            <TableHead data-sticky-actions="" className="sticky right-0 z-[1] bg-background text-right shadow-[-6px_0_6px_-6px_rgba(0,0,0,0.25)]">{t("interlockRules.actions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {c.visibleRules.length === 0 && (
            <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">{t("interlockRules.empty")}</TableCell></TableRow>
          )}
          {c.visibleRules.map((r) => {
            const approved = r.approvedBy != null;
            const selected = c.selectedRuleId === r.id;
            return (
              <TableRow
                key={r.id}
                tabIndex={0}
                aria-current={selected ? "true" : undefined}
                data-state={selected ? "selected" : undefined}
                onClick={() => c.selectRule(r.id)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    c.selectRule(r.id);
                  }
                }}
                className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              >
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell><Badge variant="outline">{r.scope}</Badge></TableCell>
                <TableCell><Badge variant="outline">{r.sourceType}</Badge>{r.sourceKey ? <div className="text-xs text-muted-foreground">{r.sourceKey}</div> : null}</TableCell>
                <TableCell className="text-xs">{r.comparisonOperator} {r.threshold ?? "—"}</TableCell>
                <TableCell><Badge variant={actionVariant(r.action)}>{r.action}</Badge></TableCell>
                <TableCell className="space-x-1">
                  {approved
                    ? <Badge variant="default">{t("interlockRules.approved")}</Badge>
                    : <Badge variant="secondary">{t("interlockRules.notApproved")}</Badge>}
                  {r.enabled
                    ? <Badge variant="default">{t("interlockRules.enabled")}</Badge>
                    : <Badge variant="outline">{t("interlockRules.disabled")}</Badge>}
                </TableCell>
                <TableCell className="text-xs">{r.cooldownSeconds}s</TableCell>
                <TableCell><AssigneeCell row={c.assignments.get(r.id)} className="max-w-[9rem]" /></TableCell>
                <TableCell data-sticky-actions="" className="sticky right-0 z-[1] bg-background text-right space-x-1 whitespace-nowrap shadow-[-6px_0_6px_-6px_rgba(0,0,0,0.25)]" onClick={stop} onKeyDown={stop}>
                  {/* Doc 81 Đợt 2 Task 5 — dialog test cũ ⇒ flyout công cụ `?flyout=rule-test&flyoutId=`. */}
                  <Button size="sm" variant="outline" aria-label={t("interlockRules.testTitle")} title={t("interlockRules.testTitle")}
                    onClick={() => flyout.open("rule-test", { id: r.id })}>
                    <FlaskConical className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  {/* Hiện-nhưng-khoá: duyệt chỉ dành cho admin (SoD giữ nguyên). */}
                  {!approved && (
                    <Button size="sm" variant="outline" disabled={!c.isAdmin || c.approvePending}
                      title={c.approveReason}
                      onClick={() => c.approve(r)}>
                      <CheckCircle2 className="h-4 w-4 mr-1" /> {t("interlockRules.approve")}
                    </Button>
                  )}
                  {!r.enabled && (
                    approved ? (
                      <Button size="sm" variant="outline" disabled={!c.canEdit || c.enablePending}
                        title={c.editReason}
                        onClick={() => c.enable(r)}>
                        <Play className="h-4 w-4 mr-1" /> {t("interlockRules.enable")}
                      </Button>
                    ) : (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span tabIndex={0}>
                            <Button size="sm" variant="outline" disabled title={c.editReason}>
                              <Play className="h-4 w-4 mr-1" /> {t("interlockRules.enable")}
                            </Button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>{t("interlockRules.enableNeedsApproval")}</TooltipContent>
                      </Tooltip>
                    )
                  )}
                  {/* doc 44 G5.4 / ILK-03 (doc 80) — tắt một rule an toàn đang chạy =
                      gỡ lớp bảo vệ tự động → ConfirmWithReason (2 bước + lý do bắt
                      buộc); riskLevel "high" (không phải "low" — ILK-03) vì tắt một
                      interlock ĐANG BẬT có cùng mức rủi ro với xoá rule. reason được
                      gửi thẳng vào mutation — backend ghi audit kèm reason (bắt buộc
                      ≥3 ký tự) thay vì chỉ log console. */}
                  {r.enabled && (
                    <ConfirmWithReason
                      trigger={
                        <Button size="sm" variant="outline" disabled={!c.canEdit || c.disablePending}
                          title={c.editReason}>
                          <Pause className="h-4 w-4 mr-1" /> {t("interlockRules.disable")}
                        </Button>
                      }
                      title={t("interlockRules.disableConfirmTitle", 'Tắt rule "{{name}}"?', { name: r.name })}
                      description={t("interlockRules.disableConfirmDescription", "Rule sẽ ngừng giám sát điều kiện và ngừng kích hoạt hành động đã cấu hình.")}
                      impact={t("interlockRules.disableImpact", "Lớp bảo vệ tự động này TẮT cho tới khi được bật lại — vượt ngưỡng sẽ không chặn/dừng/cảnh báo.")}
                      riskLevel="high"
                      disabled={!c.canEdit || c.disablePending}
                      onConfirm={async (reason) => {
                        await c.disable(r, reason);
                      }}
                    />
                  )}
                  {/* Doc 81 Đợt 2 Task 5 — dialog sửa cũ ⇒ sheet `?flyout=rule&flyoutId=`. */}
                  <Button size="sm" variant="outline" disabled={!c.canEdit} title={c.editReason} aria-label={t("interlockRules.editRule")}
                    onClick={() => flyout.open("rule", { id: r.id })}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  {/* doc 44 G5.4 / ILK-03 (doc 80) — hard-delete rule an toàn: rủi ro
                      cao → 2 bước + lý do + gõ chuỗi xác nhận. reason gửi thẳng vào
                      mutation — backend ghi audit kèm reason trước khi xoá. */}
                  <ConfirmWithReason
                    trigger={
                      <Button size="sm" variant="destructive" disabled={!c.canDelete || c.deletePending}
                        title={c.deleteReason}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    }
                    title={t("interlockRules.confirmDelete", { name: r.name })}
                    description={t("interlockRules.deleteConfirmDescription", "Xoá vĩnh viễn — không thể hoàn tác (đã ghi audit trước khi xoá).")}
                    impact={t("interlockRules.deleteImpact", "Định nghĩa rule và lớp bảo vệ tự động tương ứng biến mất khỏi hệ thống.")}
                    riskLevel="high"
                    disabled={!c.canDelete || c.deletePending}
                    onConfirm={async (reason) => {
                      await c.remove(r, reason);
                    }}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TooltipProvider>
  );
}

// ── MAIN: tab Ma trận Cause×Effect ────────────────────────────────────────────────────────────

interface MatrixAxis {
  key: string;
  label: string;
  sub?: string;
}
/** Ma trận nguyên nhân × hệ quả dựng từ CHÍNH các rule (mỗi rule = một nguyên nhân → một hệ quả). */
function buildCauseEffectMatrix(
  rules: readonly RuleRow[],
  labels: { machine: (id: number) => string; adapter: (id: number) => string; noTarget: string },
): { causes: MatrixAxis[]; effects: MatrixAxis[]; cells: Map<string, RuleRow[]> } {
  const causes = new Map<string, MatrixAxis>();
  const effects = new Map<string, MatrixAxis>();
  const cells = new Map<string, RuleRow[]>();
  for (const r of rules) {
    const scopeId = r.scope === "line" ? r.lineId : r.scope === "station" ? r.stationId : r.machineId;
    const ck = `${r.sourceType}|${r.sourceKey ?? ""}|${r.scope}|${scopeId ?? ""}`;
    if (!causes.has(ck)) {
      causes.set(ck, { key: ck, label: r.sourceKey ? `${r.sourceType} · ${r.sourceKey}` : r.sourceType, sub: scopeId != null ? `${r.scope} #${scopeId}` : r.scope });
    }
    const targets = [
      r.targetMachineId != null ? labels.machine(r.targetMachineId) : null,
      r.targetAdapterId != null ? labels.adapter(r.targetAdapterId) : null,
    ].filter(Boolean) as string[];
    const ek = `${r.action}|${r.targetMachineId ?? ""}|${r.targetAdapterId ?? ""}`;
    if (!effects.has(ek)) {
      effects.set(ek, { key: ek, label: r.action, sub: targets.length ? `→ ${targets.join(", ")}` : labels.noTarget });
    }
    const cell = `${ck}§${ek}`;
    cells.set(cell, [...(cells.get(cell) ?? []), r]);
  }
  return { causes: [...causes.values()], effects: [...effects.values()], cells };
}

function CauseEffectMatrixView() {
  const { t } = useTranslation();
  const c = usePageCtx();
  const m = useMemo(
    () =>
      buildCauseEffectMatrix(c.visibleRules, {
        machine: (id) => t("interlockRules.matrix.targetMachine", "máy #{{id}}", { id }),
        adapter: (id) => t("interlockRules.matrix.targetAdapter", "adapter #{{id}}", { id }),
        noTarget: t("interlockRules.matrix.noTarget", "không đích"),
      }),
    [c.visibleRules, t],
  );
  return (
    <Table aria-label={t("interlockRules.view.matrix", "Ma trận Cause×Effect")}>
      <TableHeader>
        <TableRow>
          <TableHead className="min-w-48 align-bottom">{t("interlockRules.matrix.corner", "Nguyên nhân ↓ · Hệ quả →")}</TableHead>
          {m.effects.map((e) => (
            <TableHead key={e.key} className="align-bottom">
              <Badge variant={actionVariant(e.label)}>{e.label}</Badge>
              <div className="text-xs font-normal text-muted-foreground">{e.sub}</div>
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {m.causes.length === 0 && (
          <TableRow><TableCell colSpan={1 + m.effects.length} className="text-center text-muted-foreground">{t("interlockRules.empty")}</TableCell></TableRow>
        )}
        {m.causes.map((cause) => (
          <TableRow key={cause.key}>
            <TableHead scope="row" className="font-normal">
              <div className="font-medium text-foreground">{cause.label}</div>
              <div className="text-xs text-muted-foreground">{cause.sub}</div>
            </TableHead>
            {m.effects.map((e) => {
              const rs = m.cells.get(`${cause.key}§${e.key}`) ?? [];
              return (
                <TableCell key={e.key} className={cn(rs.length > 0 && "bg-muted/40")}>
                  <div className="flex flex-wrap gap-1">
                    {rs.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        aria-pressed={c.selectedRuleId === r.id}
                        title={`${r.approvedBy != null ? t("interlockRules.approved") : t("interlockRules.notApproved")} · ${r.enabled ? t("interlockRules.enabled") : t("interlockRules.disabled")}`}
                        onClick={() => c.selectRule(r.id)}
                        className={cn(
                          "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          c.selectedRuleId === r.id && "border-primary ring-1 ring-primary/40",
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className={cn("h-1.5 w-1.5 rounded-full", r.enabled && r.approvedBy != null ? "bg-success" : r.enabled ? "bg-warning" : "bg-muted-foreground/40")}
                        />
                        {r.name}
                      </button>
                    ))}
                  </div>
                </TableCell>
              );
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ── Panel dưới: Sự kiện ────────────────────────────────────────────────────────────────────────

function EventsPanel({
  events, unresolvedCount, isError, isLoading, updatedAt, isFetching, eventFilter, onEventFilter, selectedRuleId,
  onClearRule, ruleNameById, canEdit, editReason, resolvePending, onResolve,
}: {
  events: EventRow[];
  unresolvedCount: number;
  isError: boolean;
  isLoading: boolean;
  updatedAt: number | undefined;
  isFetching: boolean;
  eventFilter: EventFilter;
  onEventFilter: (f: EventFilter) => void;
  selectedRuleId: number | null;
  onClearRule: () => void;
  ruleNameById: Map<number, string>;
  canEdit: boolean;
  editReason?: string;
  resolvePending: boolean;
  onResolve: (ev: EventRow, reason: string) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  // "Dòng mới" = sự kiện vừa fire trong 2 phút gần đây & chưa xử lý → tô nổi để KTV chú ý.
  const isRecentEvent = (firedAt: unknown, status: string) => {
    if (status === "resolved" || !firedAt) return false;
    const t0 = new Date(firedAt as string).getTime();
    return Number.isFinite(t0) && Date.now() - t0 < 2 * 60 * 1000;
  };
  const ruleLabel = selectedRuleId != null ? (ruleNameById.get(selectedRuleId) ?? `#${selectedRuleId}`) : null;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5">
        <h2 className="text-sm font-semibold">{t("interlockRules.events")} ({events.length})</h2>
        {/* U13 §2.2 — badge đếm sự kiện chưa xử lý (toàn bộ, không phụ thuộc lọc). */}
        {unresolvedCount > 0 && (
          <Badge variant="destructive" className="h-4 min-w-4 px-1 text-[10px]" title={t("interlockRules.filterOpen", "Chưa xử lý")}>{unresolvedCount}</Badge>
        )}
        {ruleLabel != null ? (
          <span className="inline-flex h-7 items-center gap-1 rounded-full border bg-muted/40 pl-3 pr-1 text-xs">
            {t("interlockRules.eventsForRule", "Quy tắc: {{name}}", { name: ruleLabel })}
            <Button size="sm" variant="ghost" className="h-5 w-5 p-0" aria-label={t("interlockRules.clearRuleFilter", "Bỏ lọc theo quy tắc")} title={t("interlockRules.clearRuleFilter", "Bỏ lọc theo quy tắc")} onClick={onClearRule}>
              <X className="h-3 w-3" aria-hidden="true" />
            </Button>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">{t("interlockRules.selectRuleHint", "Chọn quy tắc để lọc panel Sự kiện")}</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {/* U12 §2.3 — độ tươi của dữ liệu poll (dataUpdatedAt của react-query). */}
          <PollFreshness updatedAt={updatedAt} isFetching={isFetching} />
          {/* U13 §2.2 — lọc open/resolved (lọc phía client). */}
          <Select value={eventFilter} onValueChange={(v) => onEventFilter(v as EventFilter)}>
            <SelectTrigger className="h-8 w-40 text-xs" aria-label={t("interlockRules.status")}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("interlockRules.filterAll", "Tất cả")}</SelectItem>
              <SelectItem value="open">{t("interlockRules.filterOpen", "Chưa xử lý")}</SelectItem>
              <SelectItem value="resolved">{t("interlockRules.filterResolved", "Đã xử lý")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("interlockRules.rule")}</TableHead>
              <TableHead>{t("interlockRules.firedAt")}</TableHead>
              <TableHead>{t("interlockRules.observed")}</TableHead>
              <TableHead>{t("interlockRules.threshold")}</TableHead>
              <TableHead>{t("interlockRules.action")}</TableHead>
              <TableHead>{t("interlockRules.status")}</TableHead>
              <TableHead className="text-right">{t("interlockRules.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isError && (
              <TableRow><TableCell colSpan={7} className="text-center text-destructive">{t("common.loadError")}</TableCell></TableRow>
            )}
            {!isError && isLoading && (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">{t("common.loading")}</TableCell></TableRow>
            )}
            {!isError && !isLoading && events.length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">{t("interlockRules.empty")}</TableCell></TableRow>
            )}
            {events.map((ev) => (
              <TableRow key={ev.id} className={isRecentEvent(ev.firedAt, ev.status) ? "bg-warning/10" : undefined}>
                <TableCell className="font-medium">{ruleNameById.get(ev.ruleId) ?? `#${ev.ruleId}`}</TableCell>
                <TableCell className="text-xs">{ev.firedAt ? new Date(ev.firedAt as string).toLocaleString() : "—"}</TableCell>
                <TableCell>{(ev.observedValue as ReactNode) ?? "—"}</TableCell>
                <TableCell>{(ev.threshold as ReactNode) ?? "—"}</TableCell>
                <TableCell>{ev.action ? <Badge variant={actionVariant(ev.action)}>{ev.action}</Badge> : "—"}</TableCell>
                <TableCell><Badge variant="outline">{ev.status}</Badge></TableCell>
                <TableCell className="text-right">
                  {/* ILK-03 (doc 80) — resolveEvent giờ đòi reason (≥3 ký tự, ghi vào
                      sổ audit + lưu làm ghi chú sự kiện) → ConfirmWithReason thay vì
                      gọi mutate() thẳng không lý do. */}
                  {ev.status !== "resolved" && (
                    <ConfirmWithReason
                      trigger={
                        <Button size="sm" variant="outline" disabled={!canEdit || resolvePending}
                          title={editReason}>
                          {t("interlockRules.resolve")}
                        </Button>
                      }
                      title={t("interlockRules.resolveConfirmTitle", "Đánh dấu đã xử lý sự kiện này?")}
                      description={t("interlockRules.resolveConfirmDescription", "Sự kiện sẽ chuyển sang trạng thái Đã xử lý và không còn hiện ở tab \"Chưa xử lý\".")}
                      impact={t("interlockRules.resolveImpact", "Lý do sẽ được lưu làm ghi chú của sự kiện và ghi vào sổ audit.")}
                      riskLevel="low"
                      disabled={!canEdit || resolvePending}
                      onConfirm={async (reason) => {
                        await onResolve(ev, reason);
                      }}
                    />
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

// ── Flyout: sheet sửa / thêm rule (condition builder) ─────────────────────────────────────────

function RuleEditForm({ rule, onSaved }: { rule: RuleRow | null; onSaved: () => void }) {
  const { t } = useTranslation();
  const { layer, done } = useCloseOwnLayer();
  const fid = `ilk-${rule?.id ?? "new"}`;
  // Form khởi tạo MỘT lần từ hàng lúc mở sheet (như dialog cũ).
  const [initial] = useState<RuleForm>(() => (rule ? formFromRule(rule) : emptyRule));
  const [form, setForm] = useState<RuleForm>(initial);
  // Fix round 2 (doc 80 Task 2 review) — "preserve-if-untouched": the commandValue
  // this sheet opened with, captured VERBATIM (exact type). If the operator never
  // edits the text field, submitRule() sends this back byte-for-byte instead of
  // re-parsing — a rename can never alter the command payload. See
  // client/src/lib/interlockCommandValue.ts (resolveCommandValueForSubmit).
  const [initialCommandValue] = useState<{ raw: unknown; text: string }>(() =>
    rule ? { raw: rule.commandValue ?? null, text: serializeCommandValueForEdit(rule.commandValue) } : { raw: null, text: "" },
  );
  // doc 80 Đợt 1 Task 11 — rule ĐANG SỬA đã duyệt (approvedBy != null) hoặc ĐANG BẬT (enabled)
  // khi sheet được mở: server (ILK-01, interlockRouter.ts `update`) reset approvedBy/approvedAt
  // và ép enabled=false trong CÙNG transaction khi Lưu — cảnh báo TRƯỚC khi người dùng bấm Lưu,
  // không phải sau khi đã mất hiệu lực duyệt. Cùng điều kiện server dùng ở ILK-01.
  const [editWillResetApproval] = useState(() => rule != null && (rule.approvedBy != null || rule.enabled === true));

  const dirty = !sameForm(form, initial);
  // Báo FlyoutHost còn dữ liệu chưa lưu (Esc/Back/đóng ⇒ hỏi trước khi bỏ).
  useEffect(() => { layer.setDirty(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  // Review M3 — `layer.close` đóng lớp TRÊN CÙNG của host: chỉ đóng khi sheet này còn mount và vẫn là lớp trên
  // cùng ⇒ hook dùng chung useCloseOwnLayer (final wave M-1: bỏ bản chép tay T5).
  const createRule = trpc.interlock.create.useMutation({
    onSuccess: () => { toast.success(t("interlockRules.toastCreated")); onSaved(); done(); },
    onError: (e) => toastTrpcError(e),
  });
  const updateRule = trpc.interlock.update.useMutation({
    onSuccess: () => { toast.success(t("interlockRules.toastUpdated")); onSaved(); done(); },
    onError: (e) => toastTrpcError(e),
  });

  const submitRule = () => {
    // Fix round 2 (doc 80 Task 2 review) — resolve commandValue BEFORE building
    // `base`: preserve-if-untouched (exact original, any type) when the field
    // wasn't edited; otherwise parse STRICTLY per the chosen "Kiểu giá trị".
    // Reject (toast + abort — do NOT submit) rather than silently coerce/drop.
    let commandValue: unknown;
    try {
      commandValue = resolveCommandValueForSubmit({
        actionIsAlert: form.action === "alert",
        currentText: form.commandValue,
        initialText: initialCommandValue.text,
        initialRaw: initialCommandValue.raw,
        selectedType: form.commandValueType,
      });
    } catch (err) {
      const key = err instanceof CommandValueParseError
        ? ({
            invalid_number: "interlockRules.commandValueInvalidNumber",
            invalid_boolean: "interlockRules.commandValueInvalidBoolean",
            invalid_json: "interlockRules.commandValueInvalidJson",
          } as const)[err.code]
        : "interlockRules.commandValueInvalidJson";
      toast.error(t(key));
      return;
    }

    const base = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      scope: form.scope,
      lineId: numOrNull(form.lineId),
      stationId: numOrNull(form.stationId),
      machineId: numOrNull(form.machineId),
      sourceType: form.sourceType,
      sourceKey: form.sourceKey.trim() || null,
      comparisonOperator: form.comparisonOperator,
      threshold: numOrNull(form.threshold),
      windowSize: numOrNull(form.windowSize),
      consecutiveCount: numOrNull(form.consecutiveCount),
      windowSeconds: numOrNull(form.windowSeconds),
      action: form.action,
      targetMachineId: form.action !== "alert" ? numOrNull(form.targetMachineId) : null,
      targetAdapterId: form.action !== "alert" ? numOrNull(form.targetAdapterId) : null,
      commandTag: form.action !== "alert" ? (form.commandTag.trim() || null) : null,
      commandValue,
      cooldownSeconds: numOrNull(form.cooldownSeconds) ?? 300,
    };
    if (form.id != null) updateRule.mutate({ id: form.id, ...base });
    else createRule.mutate(base);
  };

  const scopeIdLabel = form.scope === "line" ? t("interlockRules.lineId") : form.scope === "station" ? t("interlockRules.stationId") : t("interlockRules.machineId");
  return (
    <div className="space-y-3">
      {/* doc 80 Đợt 1 Task 11 — cảnh báo TRƯỚC khi lưu một rule đã duyệt/đang bật: Lưu sẽ
          reset approvedBy/approvedAt=null + enabled=false (server ILK-01), không phải kết
          quả bất ngờ SAU khi bấm Lưu. */}
      {form.id != null && editWillResetApproval && (
        <div
          data-testid="edit-approved-warning"
          role="alert"
          className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400"
        >
          <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{t("interlockRules.editApprovedWarning", "Rule này đã DUYỆT hoặc đang BẬT — Lưu sẽ tắt rule và cần duyệt lại.")}</span>
        </div>
      )}
      <div>
        <Label htmlFor={`${fid}-name`}>{t("interlockRules.name")}</Label>
        <Input id={`${fid}-name`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </div>
      <div>
        <Label htmlFor={`${fid}-desc`}>{t("interlockRules.description")}</Label>
        <Textarea id={`${fid}-desc`} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor={`${fid}-scope`}>{t("interlockRules.scope")}</Label>
          <Select value={form.scope} onValueChange={(v) => setForm({ ...form, scope: v as Scope })}>
            <SelectTrigger id={`${fid}-scope`}><SelectValue /></SelectTrigger>
            <SelectContent>{SCOPES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor={`${fid}-scopeId`}>{scopeIdLabel}</Label>
          {form.scope === "line" && <Input id={`${fid}-scopeId`} type="number" value={form.lineId} onChange={(e) => setForm({ ...form, lineId: e.target.value })} />}
          {form.scope === "station" && <Input id={`${fid}-scopeId`} type="number" value={form.stationId} onChange={(e) => setForm({ ...form, stationId: e.target.value })} />}
          {form.scope === "machine" && <Input id={`${fid}-scopeId`} type="number" value={form.machineId} onChange={(e) => setForm({ ...form, machineId: e.target.value })} />}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor={`${fid}-srcType`}>{t("interlockRules.sourceType")}</Label>
          <Select value={form.sourceType} onValueChange={(v) => setForm({ ...form, sourceType: v as SourceType })}>
            <SelectTrigger id={`${fid}-srcType`}><SelectValue /></SelectTrigger>
            <SelectContent>{SOURCE_TYPES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor={`${fid}-srcKey`}>{t("interlockRules.sourceKey")}</Label>
          <Input id={`${fid}-srcKey`} value={form.sourceKey} onChange={(e) => setForm({ ...form, sourceKey: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor={`${fid}-op`}>{t("interlockRules.operator")}</Label>
          <Select value={form.comparisonOperator} onValueChange={(v) => setForm({ ...form, comparisonOperator: v as Operator })}>
            <SelectTrigger id={`${fid}-op`}><SelectValue /></SelectTrigger>
            <SelectContent>{OPERATORS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor={`${fid}-thr`}>{t("interlockRules.threshold")}</Label>
          <Input id={`${fid}-thr`} type="number" value={form.threshold} onChange={(e) => setForm({ ...form, threshold: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label htmlFor={`${fid}-ws`}>{t("interlockRules.windowSize")}</Label>
          <Input id={`${fid}-ws`} type="number" value={form.windowSize} onChange={(e) => setForm({ ...form, windowSize: e.target.value })} />
        </div>
        <div>
          <Label htmlFor={`${fid}-cc`}>{t("interlockRules.consecutiveCount")}</Label>
          <Input id={`${fid}-cc`} type="number" value={form.consecutiveCount} onChange={(e) => setForm({ ...form, consecutiveCount: e.target.value })} />
        </div>
        <div>
          <Label htmlFor={`${fid}-wsec`}>{t("interlockRules.windowSeconds")}</Label>
          <Input id={`${fid}-wsec`} type="number" value={form.windowSeconds} onChange={(e) => setForm({ ...form, windowSeconds: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor={`${fid}-act`}>{t("interlockRules.action")}</Label>
          <Select value={form.action} onValueChange={(v) => setForm({ ...form, action: v as Action })}>
            <SelectTrigger id={`${fid}-act`}><SelectValue /></SelectTrigger>
            <SelectContent>{ACTIONS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor={`${fid}-cool`}>{t("interlockRules.cooldown")}</Label>
          <Input id={`${fid}-cool`} type="number" value={form.cooldownSeconds} onChange={(e) => setForm({ ...form, cooldownSeconds: e.target.value })} />
        </div>
      </div>

      {form.action !== "alert" && (
        <div className="space-y-3 rounded-md border p-3">
          <div className="text-sm font-medium">{t("interlockRules.commandTarget")}</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor={`${fid}-tm`}>{t("interlockRules.targetMachineId")}</Label>
              <Input id={`${fid}-tm`} type="number" value={form.targetMachineId} onChange={(e) => setForm({ ...form, targetMachineId: e.target.value })} />
            </div>
            <div>
              <Label htmlFor={`${fid}-ta`}>{t("interlockRules.targetAdapterId")}</Label>
              <Input id={`${fid}-ta`} type="number" value={form.targetAdapterId} onChange={(e) => setForm({ ...form, targetAdapterId: e.target.value })} />
            </div>
            <div>
              <Label htmlFor={`${fid}-tag`}>{t("interlockRules.commandTag")}</Label>
              <Input id={`${fid}-tag`} value={form.commandTag} onChange={(e) => setForm({ ...form, commandTag: e.target.value })} />
            </div>
            <div>
              {/* Fix round 2 (doc 80 Task 2 review) — explicit type selector, chỉ
                  được dùng khi ô commandValue THỰC SỰ bị sửa (preserve-if-untouched
                  gửi lại giá trị gốc y nguyên khi text không đổi, bất kể ô này). */}
              <Label htmlFor={`${fid}-cvt`}>{t("interlockRules.commandValueType")}</Label>
              <Select value={form.commandValueType} onValueChange={(v) => setForm({ ...form, commandValueType: v as CommandValueType })}>
                <SelectTrigger id={`${fid}-cvt`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">{t("interlockRules.commandValueTypeText")}</SelectItem>
                  <SelectItem value="number">{t("interlockRules.commandValueTypeNumber")}</SelectItem>
                  <SelectItem value="boolean">{t("interlockRules.commandValueTypeBoolean")}</SelectItem>
                  <SelectItem value="json">{t("interlockRules.commandValueTypeJson")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor={`${fid}-cv`}>{t("interlockRules.commandValue")}</Label>
            <Input id={`${fid}-cv`} value={form.commandValue} onChange={(e) => setForm({ ...form, commandValue: e.target.value })} />
          </div>
          <p className="text-xs text-muted-foreground">{t("interlockRules.commandValueNote")}</p>
          <p className="text-xs text-muted-foreground">{t("interlockRules.commandValueUnchangedHint")}</p>
        </div>
      )}
      <div className="flex justify-end gap-2 border-t pt-3">
        <Button variant="outline" onClick={() => layer.close()}>{t("interlockRules.cancel")}</Button>
        <Button onClick={submitRule} disabled={createRule.isPending || updateRule.isPending || !form.name.trim()}>
          {t("interlockRules.save")}
        </Button>
      </div>
    </div>
  );
}

// ── Flyout công cụ: Test (dry-run) ─────────────────────────────────────────────────────────────

function RuleTestTool({ id, rule, loaded }: { id: string | null; rule: RuleRow | null; loaded: boolean }) {
  const { t } = useTranslation();
  const layer = useFlyoutLayer();
  const fid = `ilk-test-${id ?? "x"}`;
  const ruleId = Number(id);
  const validId = Number.isInteger(ruleId) && ruleId > 0;
  const [observedValue, setObservedValue] = useState("");
  const [seriesText, setSeriesText] = useState("");
  const [testEnabled, setTestEnabled] = useState(false);

  const parsedSeries = seriesText.trim()
    ? seriesText.split(",").map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n))
    : undefined;

  const testQuery = trpc.interlock.testEvaluate.useQuery(
    {
      id: validId ? ruleId : 0,
      observedValue: observedValue.trim() ? Number(observedValue) : undefined,
      series: parsedSeries && parsedSeries.length > 0 ? parsedSeries : undefined,
    },
    { enabled: testEnabled && validId },
  );

  return (
    <div className="space-y-3">
      <div className="text-sm">
        <span className="text-muted-foreground">{t("interlockRules.rule")}: </span>
        <span className="font-medium">{rule ? rule.name : loaded ? `#${id ?? ""}` : t("common.loading", "Đang tải…")}</span>
        {rule && <span className="ml-2 font-mono text-xs text-muted-foreground">{rule.comparisonOperator} {String(rule.threshold ?? "—")}</span>}
      </div>
      <div>
        <Label htmlFor={`${fid}-obs`}>{t("interlockRules.observedValue")}</Label>
        <Input id={`${fid}-obs`} type="number" value={observedValue} onChange={(e) => { setObservedValue(e.target.value); setTestEnabled(false); }} />
      </div>
      <div>
        <Label htmlFor={`${fid}-series`}>{t("interlockRules.series")}</Label>
        <Input id={`${fid}-series`} value={seriesText} placeholder="1.2, 1.5, 1.8" onChange={(e) => { setSeriesText(e.target.value); setTestEnabled(false); }} />
      </div>
      <Button onClick={() => setTestEnabled(true)} disabled={!validId}>
        {t("interlockRules.runTest")}
      </Button>

      {testEnabled && testQuery.isLoading && <p className="text-sm text-muted-foreground">{t("interlockRules.testRunning")}</p>}
      {testEnabled && testQuery.error && <p className="text-sm text-destructive">{mapTrpcError(testQuery.error)}</p>}
      {testEnabled && testQuery.data && (
        <div className="rounded-md border p-3 text-sm space-y-1">
          <div className="flex items-center gap-2">
            <span>{t("interlockRules.wouldFire")}:</span>
            <Badge variant={testQuery.data.wouldFire ? "destructive" : "secondary"}>
              {testQuery.data.wouldFire ? t("interlockRules.yes") : t("interlockRules.no")}
            </Badge>
          </div>
          <div>{t("interlockRules.outcome")}: <span className="font-mono">{testQuery.data.outcome}</span></div>
          <div>{t("interlockRules.observed")}: <span className="font-mono">{String(testQuery.data.observed)}</span></div>
          <div>{t("interlockRules.threshold")}: <span className="font-mono">{String(testQuery.data.threshold)}</span></div>
          <p className="text-xs text-muted-foreground">{testQuery.data.note}</p>
        </div>
      )}
      <div className="flex justify-end border-t pt-3">
        <Button variant="outline" onClick={() => layer.close()}>{t("interlockRules.close")}</Button>
      </div>
    </div>
  );
}
