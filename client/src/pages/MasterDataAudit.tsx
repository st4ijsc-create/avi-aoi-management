/**
 * MasterDataAudit — doc 42 Đợt 4B (H4) — Nhật ký kiểm toán MASTER DATA (read-only).
 *
 * Trả lời câu hỏi quản trị "AI đổi GÌ, KHI NÀO" cho module Quản lý dữ liệu (doc 42
 * §6 governance; benchmark ISO/IATF cần change-history trên vendor/item master).
 * Dữ liệu lấy TỪ audit_logs THẬT qua `enhancedAudit.masterDataList` (chủ yếu là bản
 * ghi trpc_mutation với action = đường dẫn router, kèm bản ghi domain có entityName).
 *
 * Đây là màn CHỈ ĐỌC: không tạo/sửa/xoá audit. RBAC = admin HOẶC module "masterdata"
 * canView (server re-enforce ở mọi query; RouteGuard gate ở tầng route).
 *
 * i18n: dùng defaultValue inline (locale sync để Đợt 3 — doc 42 §9).
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { History, Info } from "lucide-react";

import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import DashboardLayout from "@/components/DashboardLayout";
import { navItems } from "@/lib/navigation";
import { Card, CardContent } from "@/components/ui/card";
import {
  PageHeader,
  PageContainer,
  EmptyState,
  StatChip,
  StatChipRow,
} from "@/components/patterns";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { FilterBar, useUrlFilters, type FilterDef } from "@/components/FilterBar";
import { QueryBoundary } from "@/components/AsyncBoundary";
import { cn } from "@/lib/utils";

// Shape returned by enhancedAudit.masterDataList (mirrors MasterDataAuditItem).
interface AuditItem {
  id: number;
  createdAt: string | Date;
  path: string;
  opClass: "create" | "update" | "delete" | "other";
  entityType: string | null;
  entityName: string | null;
  userId: number | null;
  userName: string | null;
  status: string;
  summary: string;
}

/** Định dạng thời gian gọn; "—" khi rỗng/không hợp lệ. */
function fmtDateTime(v: string | Date): string {
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : format(d, "dd/MM/yyyy HH:mm:ss");
}

function toTime(v: string | Date): number {
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

/** Nhãn (i18n key + default) + màu semantic cho hành động (create/update/delete/other). */
const OP_META: Record<AuditItem["opClass"], { labelKey: string; label: string; cls: string }> = {
  create: {
    labelKey: "masterDataAudit.op.create",
    label: "Tạo",
    cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  },
  update: {
    labelKey: "masterDataAudit.op.update",
    label: "Cập nhật",
    cls: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30",
  },
  delete: {
    labelKey: "masterDataAudit.op.delete",
    label: "Xoá",
    cls: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
  },
  other: {
    labelKey: "masterDataAudit.op.other",
    label: "Khác",
    cls: "bg-muted text-muted-foreground border-border",
  },
};

/** Khu vực dữ liệu đọc từ đường dẫn router (bỏ động từ ở cuối). */
function areaFromPath(path: string): string {
  const parts = path.split(".");
  if (parts.length <= 1) return path;
  return parts.slice(0, -1).join(" › ");
}

export default function MasterDataAudit() {
  const { t } = useTranslation();
  const { hasPermission, isAdmin } = usePermissions();
  const canView = isAdmin || hasPermission("masterdata", "canView");

  const title = t("masterDataAudit.title", "Nhật ký kiểm toán dữ liệu");
  const currentPath = "/master-data-audit";

  // Bộ lọc (thực thể/người dùng) lấy từ audit thật — luôn hợp quyền masterdata.
  const filtersQuery = trpc.enhancedAudit.masterDataAuditFilters.useQuery(undefined, {
    enabled: canView,
    staleTime: 60_000,
  });

  const domainOptions = useMemo(
    () => (filtersQuery.data?.domains ?? []).map((d) => ({ value: d.key, label: d.label })),
    [filtersQuery.data],
  );
  const userOptions = useMemo(
    () =>
      ((filtersQuery.data?.users ?? []) as { id: number; name: string }[]).map((u) => ({
        value: String(u.id),
        label: u.name,
      })),
    [filtersQuery.data],
  );

  const filterDefs: FilterDef[] = useMemo(
    () => [
      {
        key: "q",
        type: "search",
        label: t("masterDataAudit.filter.search", "Tìm kiếm"),
        placeholder: t(
          "masterDataAudit.filter.searchPlaceholder",
          "Tên/mã, đường dẫn, người dùng…",
        ),
      },
      {
        key: "domain",
        type: "select",
        label: t("masterDataAudit.filter.entity", "Thực thể"),
        options: domainOptions,
        placeholder: t("masterDataAudit.filter.entityAll", "Tất cả"),
      },
      {
        key: "op",
        type: "select",
        label: t("masterDataAudit.filter.action", "Hành động"),
        options: [
          { value: "create", label: t(OP_META.create.labelKey, OP_META.create.label) },
          { value: "update", label: t(OP_META.update.labelKey, OP_META.update.label) },
          { value: "delete", label: t(OP_META.delete.labelKey, OP_META.delete.label) },
        ],
        placeholder: t("masterDataAudit.filter.actionAll", "Tất cả"),
      },
      {
        key: "user",
        type: "select",
        label: t("masterDataAudit.filter.user", "Người dùng"),
        options: userOptions,
        placeholder: t("masterDataAudit.filter.userAll", "Tất cả"),
      },
      {
        key: "window",
        type: "daterange",
        label: t("masterDataAudit.filter.window", "Khoảng thời gian"),
      },
    ],
    [t, domainOptions, userOptions],
  );

  const { values } = useUrlFilters(filterDefs);

  const listQuery = trpc.enhancedAudit.masterDataList.useQuery(
    {
      search: values.q || undefined,
      domain: values.domain || undefined,
      op: (values.op as "create" | "update" | "delete" | undefined) || undefined,
      userId: values.user ? Number(values.user) : undefined,
      startDate: values.windowFrom ? `${values.windowFrom}T00:00:00` : undefined,
      endDate: values.windowTo ? `${values.windowTo}T23:59:59.999` : undefined,
      limit: 300,
    },
    { enabled: canView, placeholderData: (prev) => prev },
  );

  const columns: DataTableColumn<AuditItem>[] = useMemo(
    () => [
      {
        id: "createdAt",
        header: t("masterDataAudit.col.time", "Thời gian"),
        cell: (r) => (
          <span className="tabular-nums whitespace-nowrap text-sm">
            {fmtDateTime(r.createdAt)}
          </span>
        ),
        sortValue: (r) => toTime(r.createdAt),
        width: "170px",
      },
      {
        id: "userName",
        header: t("masterDataAudit.col.user", "Người dùng"),
        cell: (r) => r.userName || t("masterDataAudit.system", "Hệ thống"),
        sortValue: (r) => r.userName ?? "",
        filterValue: (r) => r.userName ?? "",
        width: "160px",
      },
      {
        id: "opClass",
        header: t("masterDataAudit.col.action", "Hành động"),
        cell: (r) => {
          const meta = OP_META[r.opClass] ?? OP_META.other;
          return (
            <span
              className={cn(
                "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
                meta.cls,
              )}
            >
              {t(meta.labelKey, meta.label)}
            </span>
          );
        },
        sortValue: (r) => r.opClass,
        width: "110px",
      },
      {
        id: "entity",
        header: t("masterDataAudit.col.entity", "Thực thể"),
        cell: (r) => (
          <span
            className="font-mono text-xs text-muted-foreground"
            title={r.path}
          >
            {areaFromPath(r.path)}
          </span>
        ),
        sortValue: (r) => r.path,
        filterValue: (r) => r.path,
      },
      {
        id: "entityName",
        header: t("masterDataAudit.col.code", "Mã / Tên"),
        cell: (r) => r.entityName || "—",
        sortValue: (r) => r.entityName ?? "",
        filterValue: (r) => r.entityName ?? "",
        width: "180px",
      },
      {
        id: "summary",
        header: t("masterDataAudit.col.summary", "Tóm tắt thay đổi"),
        cell: (r) => (
          <span className={cn("text-sm", r.status === "failure" && "text-destructive")}>
            {r.summary || (r.status === "failure" ? t("masterDataAudit.failed", "Thất bại") : "—")}
          </span>
        ),
      },
    ],
    [t],
  );

  if (!canView) {
    return (
      <DashboardLayout title={title} navItems={navItems} currentPath={currentPath}>
        <PageContainer>
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              {t("masterData.noPermission", "Bạn không có quyền xem trang này.")}
            </CardContent>
          </Card>
        </PageContainer>
      </DashboardLayout>
    );
  }

  const total = listQuery.data?.total ?? 0;
  const shown = listQuery.data?.items?.length ?? 0;

  return (
    <DashboardLayout title={title} navItems={navItems} currentPath={currentPath}>
      <PageContainer>
        <PageHeader
          icon={<History className="h-6 w-6" />}
          title={title}
          description={t(
            "masterDataAudit.subtitle",
            "Ai đổi gì, khi nào — lịch sử thay đổi dữ liệu chủ (chỉ đọc).",
          )}
        />

        <StatChipRow>
          <StatChip
            label={t("masterDataAudit.stat.matched", "Bản ghi khớp lọc")}
            value={total}
          />
          <StatChip
            label={t("masterDataAudit.stat.shown", "Đang hiển thị")}
            value={shown}
            tone="info"
          />
        </StatChipRow>

        <FilterBar filters={filterDefs} />

        <Card>
          <CardContent className="p-3">
            <QueryBoundary
              query={listQuery}
              preset="table"
              isEmpty={(d) => !d.items || d.items.length === 0}
              errorTitle={t("masterDataAudit.error", "Không tải được nhật ký kiểm toán")}
              emptyState={
                <EmptyState
                  variant={
                    values.q || values.domain || values.op || values.user || values.windowFrom
                      ? "no-results"
                      : "no-data"
                  }
                  icon={Info}
                  title={t("masterDataAudit.empty.title", "Chưa có bản ghi kiểm toán")}
                  description={t(
                    "masterDataAudit.empty.desc",
                    "Không có thay đổi dữ liệu chủ nào khớp bộ lọc hiện tại.",
                  )}
                />
              }
            >
              {(data) => (
                <DataTable<AuditItem>
                  data={data.items as AuditItem[]}
                  getRowId={(r) => r.id}
                  columns={columns}
                  initialSort={{ columnId: "createdAt", dir: "desc" }}
                  /* doc 44 G5.21 — audit log fetches up to 300 rows; window them
                     (opt-in, replaces paging) instead of rendering all at once. */
                  virtualized
                  virtualMaxHeight={560}
                  rowHeight={48}
                />
              )}
            </QueryBoundary>
          </CardContent>
        </Card>
      </PageContainer>
    </DashboardLayout>
  );
}
