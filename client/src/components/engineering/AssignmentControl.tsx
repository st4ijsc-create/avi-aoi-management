/**
 * doc 81 Đợt 3 Task 4 (QĐ-3a) — bộ chọn "Giao cho" + cột "Người được giao" cho các mục CHỜ DUYỆT của tầng Kỹ thuật
 * (ECN · recipe nháp · interlock rule · changeover · orchestration run đang giữ).
 *
 * - Một nguồn: `trpc.engineering.assignments({entityType})` (phân công đang hiệu lực) — `useAssignments` trả map id → hàng
 *   cho cả cột danh sách lẫn bộ chọn trong sheet chi tiết (react-query gộp lượt gọi trùng khoá).
 * - Bộ chọn = `EntityPicker` (DS F1c) trên roster `engineering.assignableUsers` (người ĐANG hoạt động XEM được trang đích —
 *   server lọc). Chọn ⇒ `engineering.assign` (kèm `expectedAssigneeUserId` = người đang thấy — CAS); ✕ ⇒ `unassign`.
 * - Ai không có quyền giao (`canAssign` = cổng sửa/duyệt của trang, cùng `ASSIGNABLE[type].assignPerm`) chỉ thấy tên.
 * - ⚠ ĐƯỢC GIAO ≠ ĐƯỢC DUYỆT: thành phần này không đụng nút duyệt nào; nút duyệt của mỗi trang giữ cổng cũ.
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { UserCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toastTrpcError } from "@/lib/trpcErrors";
import { EntityPicker, type EntityOption } from "@/components/patterns/EntityPicker";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { cn } from "@/lib/utils";
import { ASSIGNABLE, type AssignableEntityType } from "@shared/engineeringAssignment";

export interface AssignmentRow {
  entityId: number;
  assigneeUserId: number;
  assigneeName: string | null;
  assignedAt?: string | Date | null;
  note?: string | null;
}

/** Phân công đang hiệu lực của một loại: map entityId → hàng. `enabled=false` ⇒ không gọi (trang chưa được xem). */
export function useAssignments(entityType: AssignableEntityType, enabled = true) {
  const q = trpc.engineering.assignments.useQuery({ entityType }, { enabled, retry: false, staleTime: 15_000 });
  const byId = useMemo(() => {
    const m = new Map<number, AssignmentRow>();
    for (const r of (q.data ?? []) as AssignmentRow[]) m.set(r.entityId, r);
    return m;
  }, [q.data]);
  return { byId, query: q };
}

/** Cổng client của nút GIAO — đúng `assignPerm` của loại (server là tường thật). */
export function useCanAssign(entityType: AssignableEntityType): boolean {
  const { hasPermission } = usePermissions();
  const { module, action } = ASSIGNABLE[entityType].assignPerm;
  return hasPermission(module, action);
}

function displayName(t: (k: string, o?: Record<string, unknown>) => string, row: { assigneeUserId: number; assigneeName: string | null }) {
  return row.assigneeName?.trim() || t("engineeringAssign.userFallback", { id: row.assigneeUserId, defaultValue: "User #{{id}}" });
}

/** Ô "Người được giao" của danh sách (chỉ đọc). */
export function AssigneeCell({ row, className }: { row: AssignmentRow | undefined; className?: string }) {
  const { t } = useTranslation();
  return (
    <span data-assignee-cell="" className={cn("inline-flex items-center gap-1 text-xs", row ? "text-foreground" : "text-muted-foreground", className)}>
      {row ? (
        <>
          <UserCheck className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
          <span className="truncate">{displayName(t, row)}</span>
        </>
      ) : (
        "—"
      )}
    </span>
  );
}

/**
 * Bộ chọn "Giao cho" của MỘT mục. `assignment` = hàng hiện tại (từ `useAssignments`). `canAssign=false` ⇒ chỉ đọc.
 * `compact` ⇒ không nhãn (ô trong bảng).
 */
export function AssignmentControl({
  entityType,
  entityId,
  assignment,
  canAssign,
  compact = false,
  className,
}: {
  entityType: AssignableEntityType;
  entityId: number;
  assignment: AssignmentRow | undefined;
  canAssign: boolean;
  compact?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const roster = trpc.engineering.assignableUsers.useQuery({ entityType }, { enabled: canAssign, retry: false, staleTime: 60_000 });
  const refresh = () => {
    void utils.engineering.assignments.invalidate({ entityType });
    void utils.oversight.pendingSummary.invalidate();
  };
  const onError = (e: unknown) => {
    toastTrpcError(e);
    // CONFLICT (người khác vừa giao/bỏ giao) ⇒ tải lại để thấy người được giao thật.
    if ((e as { data?: { code?: string } })?.data?.code === "CONFLICT") refresh();
  };
  const assignM = trpc.engineering.assign.useMutation({
    onSuccess: (r) => {
      toast.success(t("engineeringAssign.assigned", { name: r?.assigneeName?.trim() || `#${r?.assigneeUserId}`, defaultValue: "Assigned to {{name}}" }));
      refresh();
    },
    onError,
  });
  const unassignM = trpc.engineering.unassign.useMutation({
    onSuccess: () => {
      toast.success(t("engineeringAssign.unassigned", "Unassigned"));
      refresh();
    },
    onError,
  });

  const options = useMemo<EntityOption[]>(() => {
    const list = ((roster.data ?? []) as Array<{ id: number; name: string | null }>).map((u) => ({
      value: u.id,
      label: displayName(t, { assigneeUserId: u.id, assigneeName: u.name }),
    }));
    // Người đang được giao luôn có trong danh sách (kể cả khi ngoài trần roster / đã mất quyền) — không hiện "không tồn tại".
    if (assignment && !list.some((o) => o.value === assignment.assigneeUserId)) {
      list.unshift({ value: assignment.assigneeUserId, label: displayName(t, assignment) });
    }
    return list;
  }, [roster.data, assignment, t]);

  const label = t("engineeringAssign.label", "Assign to");
  const busy = assignM.isPending || unassignM.isPending;

  return (
    <div
      data-assign-control={entityType}
      data-assign-entity={entityId}
      className={cn("flex min-w-0 items-center gap-2", className)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {!compact && <span className="shrink-0 text-xs font-medium text-muted-foreground">{label}</span>}
      {canAssign ? (
        <EntityPicker
          aria-label={label}
          className="h-8 min-w-[10rem] max-w-[16rem] text-xs"
          options={options}
          value={assignment?.assigneeUserId ?? null}
          loading={roster.isLoading}
          disabled={busy}
          placeholder={t("engineeringAssign.placeholder", "Unassigned — pick a person…")}
          searchPlaceholder={t("engineeringAssign.search", "Search people…")}
          emptyText={t("engineeringAssign.empty", "No one who can view this page")}
          warnOnInvalid={false}
          onChange={(v) => {
            if (v == null) {
              if (assignment) unassignM.mutate({ entityType, entityId, expectedAssigneeUserId: assignment.assigneeUserId });
              return;
            }
            const next = Number(v);
            if (assignment?.assigneeUserId === next) return;
            assignM.mutate({ entityType, entityId, assigneeUserId: next, expectedAssigneeUserId: assignment?.assigneeUserId ?? null });
          }}
        />
      ) : (
        <span className="min-w-0">
          {assignment ? <AssigneeCell row={assignment} /> : <span className="text-xs text-muted-foreground">{t("engineeringAssign.none", "Unassigned")}</span>}
        </span>
      )}
      {!compact && (
        <span className="hidden text-[11px] text-muted-foreground xl:inline">{t("engineeringAssign.noApprovalRight", "Being assigned does not grant approval rights.")}</span>
      )}
    </div>
  );
}

export default AssignmentControl;
