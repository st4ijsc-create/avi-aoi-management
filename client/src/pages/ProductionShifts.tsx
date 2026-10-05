/**
 * Doc 81 Đợt 3 Task 3 (doc 81 §11 "Đã chốt" 2026-10-05) — SẢN XUẤT › CA: bảng phân công nhân lực theo ca.
 *
 * Trước đây là tab `?tab=workforce` (S1-a) của Safety & Workforce. Safety bỏ tab đó; `/safety-workforce?tab=workforce`
 * (và deep link sheet phân công `?flyout=workforce-assign|workforce-reassign`) chuyển hướng (REPLACE) sang đây, giữ nguyên
 * văn mọi tham số khác — xem `lib/engineeringLegacyRedirects.tsx`. Phối hợp người↔robot (collaboration, máy trạng thái
 * `phase`, `startCollaboration`) Ở LẠI Safety — trang này KHÔNG bắt đầu phối hợp (một chỗ duy nhất).
 *
 * CỔNG — GIỮ ĐÚNG chỗ cũ, không thêm không bớt:
 *  - route: RouteGuard `navHref` = mục điều hướng khai `machine_status` (= `requirePermission="machine_status"` của
 *    /safety-workforce); xem: `machine_monitoring/canView` (= trang Safety; resolve về machine_status như server);
 *  - thao tác: `machine_control/canCreate` (nút khoá kèm lý do khi thiếu, sheet không đăng ký — như cũ);
 *  - cờ nhân lực của server (`safety.status.workforce`) — 4 trạng thái trung thực; CHƯA RÕ ⇒ khoá nút/sheet; TẮT ⇒ nút
 *    bật, server từ chối êm (toast.info) như cũ;
 *  - giấy phép: route thuộc `MOD_OT_CONTROL` như /safety-workforce (shared/module-registry.ts); mục điều hướng khai
 *    `licenseModule` nên nhóm Sản xuất (MOD_PRODUCTION) không ẩn nó.
 *
 * Bố cục (danh sách MAIN, chi tiết trong flyout): header một hàng (h1 · chip cờ · "Khi nào dùng" · `StatusChipStrip`) ·
 * MAIN = một hàng công cụ (lọc ca `?shift=` theo `shift_configs`, lọc trạng thái `?status=`, Phân công) + bảng phân công
 * (bấm mã người vận hành ⇒ sheet chi tiết `?flyout=workforce-detail&flyoutId=`) · panel phụ = bảng hiện trường (ai/robot
 * nào ở mỗi trạm lúc này).
 *
 * Thao tác (R-2-n — y hệt tab cũ): phân công / phân công lại = sheet, MỘT lượt gọi với cùng payload và kiểm tra; xác nhận =
 * MỘT cú bấm ⇒ `{assignmentId}`; đóng = AlertDialog ⇒ `{assignmentId}`. Mỗi thao tác làm mới ĐÚNG tập truy vấn như trang
 * cũ (`refetchAll` của Safety). Không thao tác hàng loạt. Bộ lọc ca CHỈ lọc phía client trên danh sách đã tải (200 phân
 * công mới nhất — như cũ); thủ tục và input không đổi.
 */
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
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
  type FlyoutDefinition,
  type StatusChipItem,
} from "@/components/patterns";
import { useUrlParam } from "@/components/patterns/useUrlParam";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SheetFooter } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertTriangle, Ban, Bot, CalendarClock, CheckCircle2, RefreshCcw, RefreshCw, User, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { mapTrpcError } from "@/lib/trpcErrors";
import { isFeatureDisabledError } from "@/lib/featureFlagError";
import { deriveFeatureStatus, isFeatureStatusUnsettled, type FeatureStatus } from "@/components/common/FeatureStatusGate";
import { ProvenanceBadge, ProvenanceSummary } from "@/components/common/ProvenanceBadge";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type BoardStation = RouterOutputs["safety"]["currentBoard"][number];
type Assignment = RouterOutputs["safety"]["listAssignments"][number];
type ShiftConfig = RouterOutputs["shiftConfig"]["list"][number];

const ASSIGN_STATUSES = ["planned", "active", "completed", "cancelled"] as const;
type AssignStatus = (typeof ASSIGN_STATUSES)[number];
/** Cửa sổ của `safety.listAssignments` — như tab cũ (200 phân công mới nhất). */
const ASSIGN_LIMIT = 200;
/** `?shift=none` — phân công chưa gắn ca (`shiftConfigId` rỗng). */
const NO_SHIFT = "none";
/** Như Safety: dưới 1600 px panel phụ 300 px (MAIN rộng hơn ở 1366), từ 1600 px 340 px. */
const WIDE_SIDE_BREAKPOINT_PX = 1600;

type TFn = (key: string, fallback: string, opts?: Record<string, unknown>) => string;

function skillBadge(skillLevel: string | null | undefined, t: TFn) {
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

function assignStatusBadge(status: string, t: TFn) {
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

function fmtDateTime(d?: string | Date | null): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleString();
}

const pad2 = (n: number) => String(n).padStart(2, "0");
/** "Ca sáng (A) 06:00–14:00" — giờ ca từ `shift_configs`. */
export function shiftLabel(s: Pick<ShiftConfig, "name" | "code" | "startHour" | "startMinute" | "endHour" | "endMinute">): string {
  return `${s.name} (${s.code}) ${pad2(s.startHour)}:${pad2(s.startMinute ?? 0)}–${pad2(s.endHour)}:${pad2(s.endMinute ?? 0)}`;
}

const isTerminalAssignment = (a: Assignment) => a.status === "completed" || a.status === "cancelled";

/** Lọc theo ca (phía client, trên danh sách đã tải): `null` ⇒ tất cả; `"none"` ⇒ chưa gắn ca; số ⇒ đúng ca đó. */
export function filterByShift<T extends { shiftConfigId: number | null }>(rows: readonly T[], shift: string | null): T[] {
  if (shift == null || shift === "") return [...rows];
  if (shift === NO_SHIFT) return rows.filter((r) => r.shiftConfigId == null);
  const id = Number(shift);
  if (!Number.isInteger(id) || id <= 0) return [...rows];
  return rows.filter((r) => r.shiftConfigId === id);
}

type MutationErrorHandler = (e: { data?: { code?: string } | null; message: string }) => void;

export default function ProductionShifts() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  // = trang Safety cũ: xem machine_monitoring/canView (resolve về machine_status), thao tác machine_control/canCreate.
  const canView = hasPermission("machine_monitoring", "canView");
  const canControl = hasPermission("machine_control", "canCreate");
  const permReason = !canControl
    ? t("common.gate.needPerm", "Requires {{perm}} permission", { perm: "machine_control" })
    : undefined;

  const [statusParam, setStatusParam] = useUrlParam("status");
  const [shiftParam, setShiftParam] = useUrlParam("shift");
  const statusFilter = (ASSIGN_STATUSES as readonly string[]).includes(statusParam ?? "") ? (statusParam as AssignStatus) : undefined;
  const [closeTarget, setCloseTarget] = useState<Assignment | null>(null);
  const wideSide = !useNarrowViewport(WIDE_SIDE_BREAKPOINT_PX);

  const utils = trpc.useUtils();

  // ── Reads (cùng thủ tục + input như tab cũ; thêm danh sách ca để lọc) ─────────────────────
  const statusQ = trpc.safety.status.useQuery(undefined, { enabled: canView });
  const assignmentsQ = trpc.safety.listAssignments.useQuery({ status: statusFilter, limit: ASSIGN_LIMIT }, { enabled: canView });
  const boardQ = trpc.safety.currentBoard.useQuery(undefined, { enabled: canView });
  const shiftsQ = trpc.shiftConfig.list.useQuery(undefined, { enabled: canView });

  const assignments = (assignmentsQ.data ?? []) as Assignment[];
  const board = (boardQ.data ?? []) as BoardStation[];
  const shifts = (shiftsQ.data ?? []) as ShiftConfig[];
  const shiftById = useMemo(() => new Map(shifts.map((s) => [s.id, s])), [shifts]);
  const rows = useMemo(() => filterByShift(assignments, shiftParam), [assignments, shiftParam]);

  const workforceStatus = deriveFeatureStatus(statusQ, (d: { workforce?: boolean }) => d.workforce);
  const workforceUnsettled = isFeatureStatusUnsettled(workforceStatus);
  const controlReason = permReason ?? (workforceUnsettled ? t("common.gate.checkingStatus", "Checking feature status…") : undefined);
  const canAct = canControl && !workforceUnsettled;

  // R-2-n / Review Focus 1: mỗi thao tác làm mới ĐÚNG tập truy vấn như `refetchAll` của trang Safety cũ.
  const refetchAll = () => {
    void utils.safety.status.invalidate();
    void utils.safety.feed.invalidate();
    void utils.safety.nearMissTrend.invalidate();
    void utils.safety.currentBoard.invalidate();
    void utils.safety.listAssignments.invalidate();
    void utils.safety.listCollaborations.invalidate();
    void utils.safety.sourceHealth.invalidate();
  };
  const refreshPage = () => {
    refetchAll();
    void utils.shiftConfig.list.invalidate();
  };

  // Cờ TẮT ⇒ server từ chối (CONFLICT/FEATURE_DISABLED) ⇒ toast.info êm + làm mới cờ (như cũ). Câu KHÔNG gọi tên biến môi trường.
  const onMutationError: MutationErrorHandler = (e) => {
    if (isFeatureDisabledError(e)) {
      toast.info(t("shifts.flagOffToast", "Workforce is turned off on the server (preview) — assignment actions are refused until an administrator turns it on."));
      void utils.safety.status.invalidate();
    } else if (e.data?.code === "CONFLICT") {
      toast.info(mapTrpcError(e));
    } else {
      toast.error(mapTrpcError(e));
    }
  };

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

  if (!canView) {
    return (
      <DashboardLayout>
        <div className="p-6">
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              <AlertTriangle className="mx-auto mb-2 h-6 w-6" />
              {t("shifts.noPermission", "You do not have permission to view shift assignments.")}
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  const findAssignment = (id: string | null) =>
    id != null && /^\d+$/.test(id) ? assignments.find((a) => a.id === Number(id)) ?? null : null;
  const notFound = (id: string | null) => (
    <p className="py-6 text-center text-sm text-muted-foreground">
      {assignmentsQ.isLoading
        ? t("safety.loading", "Loading…")
        : t("workforce.assignmentNotFound", "Assignment #{{id}} is not in the loaded list.", { id: id ?? "" })}
    </p>
  );
  const unsettledBody = (status: FeatureStatus) =>
    status === "error" ? (
      <p role="alert" className="py-6 text-center text-sm text-destructive">
        {t("shifts.flagStatusError", "Could not check whether workforce is enabled — assignment actions are disabled until this is confirmed.")}
      </p>
    ) : (
      <p className="py-6 text-center text-sm text-muted-foreground">{t("common.gate.checkingStatus", "Checking feature status…")}</p>
    );

  // ── Flyouts (một stack sheet phải; URL `?flyout=&flyoutId=` là nguồn sự thật) ──
  const flyouts: Record<string, FlyoutDefinition> = {
    // Chi tiết một phân công (chỉ đọc) — mọi người xem được trang.
    "workforce-detail": {
      size: "md",
      title: t("shifts.detailTitle", "Assignment details"),
      render: (layer) => {
        const a = findAssignment(layer.id);
        return a ? <AssignmentDetail a={a} shift={a.shiftConfigId != null ? shiftById.get(a.shiftConfigId) : undefined} /> : notFound(layer.id);
      },
    },
  };
  // Phân công / phân công lại: CHỈ khi có quyền điều khiển (như cũ). Cờ CHƯA RÕ ⇒ sheet chỉ báo trạng thái, không form.
  if (canControl) {
    flyouts["workforce-assign"] = {
      size: "md",
      title: t("workforce.assignTitle", "Assign operator"),
      render: () =>
        workforceUnsettled ? unsettledBody(workforceStatus) : (
          <AssignmentForm mode="assign" pending={assignM.isPending} onSubmit={(v, done) => assignM.mutate(v, { onSuccess: done })} />
        ),
    };
    // Nút "Phân công lại" cũ: chỉ khi có quyền, khoá khi phân công đã kết thúc (không theo cờ).
    flyouts["workforce-reassign"] = {
      size: "md",
      title: t("workforce.reassignTitle", "Reassign operator"),
      render: (layer) => {
        const a = findAssignment(layer.id);
        if (!a) return notFound(layer.id);
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
  }

  const activeCount = rows.filter((a) => a.status === "active").length;
  const plannedCount = rows.filter((a) => a.status === "planned").length;
  const listState = chipStateFromQuery(assignmentsQ, (d) => (d as unknown[]).length >= ASSIGN_LIMIT);
  const chipItems: StatusChipItem[] = [
    {
      id: "active-assignments",
      label: t("safety.chip.activeAssignments", "Active assignments"),
      value: activeCount,
      state: listState,
      tone: activeCount > 0 ? "success" : "default",
      source: t("shifts.chip.srcActive", "safety.listAssignments — status 'Active' among the latest 200 assignments (shift and status filters apply)"),
    },
    {
      id: "planned-assignments",
      label: t("shifts.chip.planned", "Awaiting confirmation"),
      value: plannedCount,
      state: listState,
      tone: plannedCount > 0 ? "warning" : "default",
      source: t("shifts.chip.srcPlanned", "safety.listAssignments — status 'Planned' (not yet confirmed) among the latest 200 assignments (shift and status filters apply)"),
    },
  ];

  return (
    <DashboardLayout>
      <FlyoutHost flyouts={flyouts}>
        <PageContainer className="space-y-0">
          <CockpitLayout
            icon={<CalendarClock />}
            title={
              <span className="flex items-center gap-2">
                {t("shifts.title", "Shifts")}
                {!canControl && <ViewOnlyBadge module="machine_control" />}
              </span>
            }
            notices={
              <>
                <FeatureStatusNoticeChip
                  status={workforceStatus}
                  subject={t("safety.flag.workforce", "Workforce")}
                  offMessage={t(
                    "shifts.flagOff",
                    "Preview mode: workforce is turned off on the server. Reads work; assignment actions are refused until an administrator turns it on.",
                  )}
                  errorMessage={t(
                    "shifts.flagStatusError",
                    "Could not check whether workforce is enabled — assignment actions are disabled until this is confirmed.",
                  )}
                />
                <NoticeChip kind="whenToUse">
                  <p data-when-to-use="shifts.whenToUse">
                    {t(
                      "shifts.whenToUse",
                      "When to use — plan and confirm which operator works which line/station in each shift, and see who is at each station now. Human↔robot collaboration stays on Safety & Workforce.",
                    )}
                  </p>
                </NoticeChip>
              </>
            }
            chips={<StatusChipStrip items={chipItems} />}
            actions={
              <Button size="icon" variant="ghost" onClick={refreshPage} title={t("common.refresh", "Refresh")} aria-label={t("common.refresh", "Refresh")}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            }
            toolbar={
              <ShiftsToolbar
                shifts={shifts}
                shiftsError={shiftsQ.isError}
                shift={shiftParam}
                onShift={setShiftParam}
                status={statusFilter}
                onStatus={(v) => setStatusParam(v ?? null)}
                canAct={canAct}
                reason={controlReason}
              />
            }
            main={
              <AssignmentsTable
                rows={rows}
                loading={assignmentsQ.isLoading}
                error={assignmentsQ.isError}
                shiftById={shiftById}
                canControl={canControl}
                confirmPending={confirmM.isPending}
                onConfirm={(a) => confirmM.mutate({ assignmentId: a.id })}
                onClose={setCloseTarget}
              />
            }
            side={<BoardPanel board={board} loading={boardQ.isLoading} error={boardQ.isError} />}
            sideWidth={wideSide ? 340 : 300}
            sideLabel={t("shifts.side.label", "Current board — who and which robot is at each station now")}
            mainName="production-shifts"
          />
        </PageContainer>

        {/* ── Đóng phân công (R-2-n: như cũ — AlertDialog, một phân công mỗi lần xác nhận) ── */}
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
// MAIN — một hàng công cụ + bảng phân công
// ══════════════════════════════════════════════════════════════════════════════

function ShiftsToolbar({
  shifts, shiftsError, shift, onShift, status, onStatus, canAct, reason,
}: {
  shifts: ShiftConfig[];
  shiftsError: boolean;
  shift: string | null;
  onShift: (v: string | null) => void;
  status: AssignStatus | undefined;
  onStatus: (v: AssignStatus | undefined) => void;
  canAct: boolean;
  reason: string | undefined;
}) {
  const { t } = useTranslation();
  const flyout = useFlyout();
  const shiftValue = shift == null || shift === "" ? "all" : shift;
  return (
    <>
      <Select value={shiftValue} onValueChange={(v) => onShift(v === "all" ? null : v)}>
        <SelectTrigger className="h-8 w-56" aria-label={t("shifts.filter.shift", "Shift")}>
          <span className="text-xs text-muted-foreground" aria-hidden="true">{t("shifts.filter.shift", "Shift")}:</span>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("shifts.filter.allShifts", "All shifts")}</SelectItem>
          <SelectItem value={NO_SHIFT}>{t("shifts.filter.noShift", "No shift")}</SelectItem>
          {shifts.map((s) => (
            <SelectItem key={s.id} value={String(s.id)}>
              {shiftLabel(s)}{s.isActive === false ? ` · ${t("shifts.inactive", "inactive")}` : ""}
            </SelectItem>
          ))}
          {/* `?shift=` trỏ tới ca không có trong danh sách (đã xoá / chưa tải) — vẫn hiện được giá trị đang lọc. */}
          {shiftValue !== "all" && shiftValue !== NO_SHIFT && !shifts.some((s) => String(s.id) === shiftValue) && (
            <SelectItem value={shiftValue}>{t("shifts.shiftUnknown", "Shift #{{id}}", { id: shiftValue })}</SelectItem>
          )}
        </SelectContent>
      </Select>
      {shiftsError && (
        <span role="status" className="text-xs text-destructive">{t("shifts.shiftsError", "Could not read the shift list")}</span>
      )}
      <Select value={status ?? "all"} onValueChange={(v) => onStatus(v === "all" ? undefined : (v as AssignStatus))}>
        <SelectTrigger className="h-8 w-36" aria-label={t("workforce.col.status", "Status")}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("safety.all", "All")}</SelectItem>
          {ASSIGN_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>{t(`safety.assign.${s}`, s)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button size="sm" variant="outline" className="h-8" disabled={!canAct} title={reason} onClick={() => flyout.open("workforce-assign")}>
        <UserPlus className="mr-1 h-4 w-4" />{t("workforce.assign", "Assign")}
      </Button>
    </>
  );
}

function AssignmentsTable({
  rows, loading, error, shiftById, canControl, confirmPending, onConfirm, onClose,
}: {
  rows: Assignment[];
  loading: boolean;
  error: boolean;
  shiftById: Map<number, ShiftConfig>;
  canControl: boolean;
  confirmPending: boolean;
  onConfirm: (a: Assignment) => void;
  onClose: (a: Assignment) => void;
}) {
  const { t } = useTranslation();
  const flyout = useFlyout();
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div
        className="max-h-[calc(100dvh_-_var(--shell-chrome-h,3.5rem)_-_14rem)] min-h-[12rem] overflow-auto rounded-md border"
        role="region"
        aria-label={t("workforce.assignmentsTitle", "Operator assignments")}
      >
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead>{t("workforce.col.operator", "Operator")}</TableHead>
              <TableHead>{t("workforce.col.lineStation", "Line / Station")}</TableHead>
              <TableHead>{t("shifts.col.shift", "Shift")}</TableHead>
              <TableHead>{t("workforce.col.skill", "Skill")}</TableHead>
              <TableHead>{t("workforce.col.status", "Status")}</TableHead>
              <TableHead>{t("workforce.col.window", "Window")}</TableHead>
              <TableHead className="text-right">{t("common.actions", "Actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">{t("safety.loading", "Loading…")}</TableCell></TableRow>
            )}
            {!loading && error && (
              <TableRow><TableCell colSpan={7} role="alert" className="py-8 text-center text-destructive">{t("shifts.listError", "Could not read the assignments.")}</TableCell></TableRow>
            )}
            {!loading && !error && rows.length === 0 && (
              <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">{t("workforce.assignmentsEmpty", "No operator assignments yet.")}</TableCell></TableRow>
            )}
            {rows.map((a) => {
              const terminal = isTerminalAssignment(a);
              const shift = a.shiftConfigId != null ? shiftById.get(a.shiftConfigId) : undefined;
              return (
                <TableRow key={a.id} data-assignment-id={a.id}>
                  <TableCell className="text-xs">
                    <span className="inline-flex items-center gap-1.5">
                      {/* Chi tiết (P3): mở sheet `workforce-detail` của chính phân công này. */}
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={t("shifts.openDetail", "Details of assignment #{{id}}", { id: a.id })}
                        onClick={() => flyout.open("workforce-detail", { id: a.id })}
                      >
                        <User className="h-3 w-3" aria-hidden="true" />#{a.operatorId}
                      </button>
                      <ProvenanceBadge row={a} />
                    </span>
                  </TableCell>
                  <TableCell className="text-xs">
                    {a.lineId != null ? `L${a.lineId}` : "—"}{" / "}{a.stationId != null ? `S${a.stationId}` : "—"}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {a.shiftConfigId == null ? "—" : shift ? `${shift.name} (${shift.code})` : t("shifts.shiftUnknown", "Shift #{{id}}", { id: a.shiftConfigId })}
                  </TableCell>
                  <TableCell>{skillBadge(a.skillLevel, t) ?? <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                  <TableCell>{assignStatusBadge(a.status, t)}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{fmtDateTime(a.assignedStart)} → {fmtDateTime(a.assignedEnd)}</TableCell>
                  <TableCell className="text-right">
                    {canControl ? (
                      <div className="flex justify-end gap-1">
                        {a.status === "planned" && (
                          <Button size="sm" variant="ghost" className="h-7" disabled={confirmPending} onClick={() => onConfirm(a)}>
                            <CheckCircle2 className="mr-1 h-3.5 w-3.5" />{t("workforce.confirm", "Confirm")}
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" className="h-7" disabled={terminal} onClick={() => flyout.open("workforce-reassign", { id: a.id })}>
                          <RefreshCcw className="mr-1 h-3.5 w-3.5" />{t("workforce.reassign", "Reassign")}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7" disabled={terminal} onClick={() => onClose(a)}>
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
      <ProvenanceSummary rows={rows} />
    </div>
  );
}

/** Sheet chi tiết (chỉ đọc) — mọi trường của phân công, kể cả ai xác nhận/đóng. */
function AssignmentDetail({ a, shift }: { a: Assignment; shift: ShiftConfig | undefined }) {
  const { t } = useTranslation();
  const row = (label: string, value: ReactNode) => (
    <div className="grid grid-cols-[9rem_1fr] gap-2 border-b border-border/60 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
  return (
    <dl data-assignment-detail={a.id} className="grid">
      {row(t("shifts.detail.id", "Assignment"), <span className="font-mono">#{a.id}</span>)}
      {row(
        t("workforce.col.operator", "Operator"),
        <span className="inline-flex items-center gap-1.5">#{a.operatorId}<ProvenanceBadge row={a} /></span>,
      )}
      {row(t("workforce.col.lineStation", "Line / Station"), `${a.lineId != null ? `L${a.lineId}` : "—"} / ${a.stationId != null ? `S${a.stationId}` : "—"}`)}
      {row(
        t("shifts.col.shift", "Shift"),
        a.shiftConfigId == null ? "—" : shift ? shiftLabel(shift) : t("shifts.shiftUnknown", "Shift #{{id}}", { id: a.shiftConfigId }),
      )}
      {row(t("workforce.col.skill", "Skill"), skillBadge(a.skillLevel, t) ?? "—")}
      {row(t("workforce.col.status", "Status"), assignStatusBadge(a.status, t))}
      {row(t("workforce.col.window", "Window"), `${fmtDateTime(a.assignedStart)} → ${fmtDateTime(a.assignedEnd)}`)}
      {row(t("shifts.detail.confirmed", "Confirmed"), a.confirmedBy != null ? `#${a.confirmedBy} · ${fmtDateTime(a.confirmedAt)}` : "—")}
      {row(t("shifts.detail.closedBy", "Closed by"), a.closedBy != null ? `#${a.closedBy}` : "—")}
      {row(t("shifts.detail.notes", "Notes"), a.notes ? <span className="whitespace-pre-wrap">{a.notes}</span> : "—")}
    </dl>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Panel phụ — bảng hiện trường (người + robot mỗi trạm, lúc này)
// ══════════════════════════════════════════════════════════════════════════════

function BoardPanel({ board, loading, error }: { board: BoardStation[]; loading: boolean; error: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex max-h-[calc(100dvh_-_var(--shell-chrome-h,3.5rem)_-_8rem)] min-h-0 flex-col gap-2 overflow-auto" data-board-panel="">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Users className="h-4 w-4" aria-hidden="true" />
        {t("workforce.boardTitle", "Current board — who & which robot is at each station now")}
      </div>
      {loading && <p className="py-6 text-center text-sm text-muted-foreground">{t("safety.loading", "Loading…")}</p>}
      {!loading && error && <p role="alert" className="py-6 text-center text-sm text-destructive">{t("shifts.boardError", "Could not read the current board.")}</p>}
      {!loading && !error && board.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t("workforce.boardEmpty", "No active assignments or enabled robots to show on the board.")}
        </p>
      )}
      <div className="grid gap-2">
        {board.map((st, idx) => (
          <Card key={`${st.stationId ?? "_"}-${st.lineId ?? "_"}-${idx}`} className="border-border/60">
            <CardContent className="space-y-2 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium">
                  {st.stationId != null ? t("workforce.station", "Station") + ` ${st.stationId}` : t("workforce.unassignedStation", "Unassigned")}
                </div>
                {st.lineId != null && <Badge variant="outline" className="text-xs">{t("workforce.line", "Line")} {st.lineId}</Badge>}
              </div>
              <div className="space-y-1">
                {st.humans.length === 0 && <div className="text-xs text-muted-foreground">{t("workforce.noHumans", "No humans")}</div>}
                {st.humans.map((h) => (
                  <div key={`h-${h.assignmentId}`} className="flex items-center justify-between gap-2 text-xs">
                    <span className="inline-flex items-center gap-1"><User className="h-3 w-3 text-blue-500" />{t("workforce.operator", "Operator")} #{h.operatorId}</span>
                    {skillBadge(h.skillLevel, t)}
                  </div>
                ))}
              </div>
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
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Form phân công (dời NGUYÊN VĂN từ SafetyWorkforce.tsx — kiểm tra + payload như cũ, R-2-n)
// ══════════════════════════════════════════════════════════════════════════════

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
