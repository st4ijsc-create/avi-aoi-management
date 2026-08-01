/**
 * doc 47 IA Đợt 3 — "Nhật ký thay đổi cấu hình nhà máy" (chỉ đọc).
 *
 * Trả lời câu hỏi quản trị "AI đổi CẤU TRÚC nhà máy, KHI NÀO, đổi GÌ" cho 5 tầng
 * phân cấp: Nhà máy · Phân xưởng · Dây chuyền · Trạm · Máy. Các hierarchy router
 * ĐÃ GHI audit thật vào `audit_logs` (entityType = factory/workshop/line/station/
 * machine; action create/update/delete + *.restore/register/approve…). Màn này chỉ
 * SURFACE các bản ghi đó — KHÔNG bịa lịch sử.
 *
 * NGUỒN DỮ LIỆU: `trpc.enhancedAudit.list` (adminProcedure) lọc theo MỘT entityType/
 * lần. Để gộp cả 5 tầng khi chọn "Tất cả", gọi 5 query song song (mỗi tầng 1 query,
 * `enabled` bật theo bộ lọc), rồi gộp + phân loại + lọc phần còn lại phía client.
 * Vì `list` là adminProcedure nên đây là màn quản trị (chỉ admin); người không đủ
 * quyền thấy thông báo lịch sự (server cũng tự chặn).
 *
 * i18n: dùng defaultValue INLINE — KHÔNG sửa file locale (đồng bộ key ở bước sau).
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import {
  History,
  Info,
  Factory,
  Building2,
  Workflow,
  MapPin,
  Cpu,
  Lock,
} from "lucide-react";

import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, StatChip, StatChipRow } from "@/components/patterns";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import {
  FilterBar,
  type FilterDef,
  type FilterValues,
} from "@/components/FilterBar";
import { QueryBoundary } from "@/components/AsyncBoundary";
import { ExportMenu } from "@/components/ExportMenu";
import type { ExportColumnSpec } from "@/lib/serverReportExport";
import { cn } from "@/lib/utils";

// ── Kiểu dữ liệu ─────────────────────────────────────────────────────────────

/** Hàng thô trả về từ `enhancedAudit.list` (SELECT al.* + displayUserName). */
interface RawAuditRow {
  id: number;
  action: string;
  entityType: string | null;
  entityId: number | null;
  entityName: string | null;
  userId: number | null;
  userName: string | null;
  displayUserName?: string | null;
  status: string | null;
  createdAt: string | Date;
  details: unknown;
}

type ActionCat = "created" | "updated" | "deleted" | "restored" | "other";
type FactoryEntityType = "factory" | "workshop" | "line" | "station" | "machine";

/** Hàng đã chuẩn hoá để hiển thị. */
interface AuditRow {
  id: number;
  createdAt: string | Date;
  actor: string | null;
  action: string;
  actionCat: ActionCat;
  entityType: string;
  entityId: number | null;
  entityName: string | null;
  status: string;
  summary: string;
}

/** 5 entityType mà các hierarchy router THẬT ghi (auditTrailService.ENTITY_TYPES). */
const FACTORY_ENTITY_TYPES: FactoryEntityType[] = [
  "factory",
  "workshop",
  "line",
  "station",
  "machine",
];

// ── Hằng số hiển thị ─────────────────────────────────────────────────────────

const ENTITY_META: Record<
  FactoryEntityType,
  { labelKey: string; label: string; Icon: typeof Factory }
> = {
  factory: { labelKey: "factoryConfigAudit.entity.factory", label: "Nhà máy", Icon: Factory },
  workshop: { labelKey: "factoryConfigAudit.entity.workshop", label: "Phân xưởng", Icon: Building2 },
  line: { labelKey: "factoryConfigAudit.entity.line", label: "Dây chuyền", Icon: Workflow },
  station: { labelKey: "factoryConfigAudit.entity.station", label: "Trạm", Icon: MapPin },
  machine: { labelKey: "factoryConfigAudit.entity.machine", label: "Máy", Icon: Cpu },
};

const ACTION_META: Record<ActionCat, { labelKey: string; label: string; cls: string }> = {
  created: {
    labelKey: "factoryConfigAudit.action.created",
    label: "Tạo",
    cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  },
  updated: {
    labelKey: "factoryConfigAudit.action.updated",
    label: "Cập nhật",
    cls: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30",
  },
  deleted: {
    labelKey: "factoryConfigAudit.action.deleted",
    label: "Xoá",
    cls: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
  },
  restored: {
    labelKey: "factoryConfigAudit.action.restored",
    label: "Khôi phục",
    cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
  },
  other: {
    labelKey: "factoryConfigAudit.action.other",
    label: "Khác",
    cls: "bg-muted text-muted-foreground border-border",
  },
};

// ── Helper thuần ─────────────────────────────────────────────────────────────

function fmtDateTime(v: string | Date): string {
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : format(d, "dd/MM/yyyy HH:mm:ss");
}

function toTime(v: string | Date): number {
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

/** Phân loại action-path → nhóm (khớp cách server ghi; precedence rõ ràng). */
function classifyAction(action: string): ActionCat {
  const a = (action || "").toLowerCase();
  if (a.includes("restore")) return "restored";
  if (a.includes("delete") || a.includes("remove")) return "deleted";
  if (a.includes("create") || a.includes("register")) return "created";
  if (
    a.includes("update") ||
    a.includes("approve") ||
    a.includes("lifecycle") ||
    a.includes("regenerate") ||
    a.includes("reorder") ||
    a.includes("move") ||
    a.includes("position")
  ) {
    return "updated";
  }
  return "other";
}

/** Parse cột details (TEXT chứa JSON hoặc object) an toàn → {} nếu thiếu/hỏng. */
function parseDetails(raw: unknown): Record<string, any> {
  if (raw == null) return {};
  if (typeof raw === "object") return raw as Record<string, any>;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return {};
}

/** Tên trường đã đổi từ details.changes[] (computeChanges: {field, displayName}). */
function changedFieldNames(details: Record<string, any>): string[] {
  const changes = details.changes;
  if (Array.isArray(changes) && changes.length > 0) {
    return changes
      .map((c) =>
        typeof c === "string" ? c : String(c?.displayName || c?.field || c?.key || ""),
      )
      .filter(Boolean);
  }
  if (Array.isArray(details.affectedFields) && details.affectedFields.length > 0) {
    return details.affectedFields.map((f: unknown) => String(f)).filter(Boolean);
  }
  return [];
}

/**
 * Tóm tắt thay đổi (vi) TỪ details thật — không bịa; ưu tiên liệt kê trường đã đổi.
 * `fieldsWord` = "trường" (đã dịch), truyền vào để không gọi t() trong helper thuần.
 */
function summarizeChange(row: AuditRow, details: Record<string, any>, fieldsWord: string): string {
  if (row.actionCat === "updated") {
    const fields = changedFieldNames(details);
    if (fields.length > 0) {
      const head = fields.slice(0, 3).join(", ");
      return fields.length > 3 ? `${head} (+${fields.length - 3})` : head;
    }
    return "";
  }
  if (row.actionCat === "created") {
    const fields = changedFieldNames(details);
    return fields.length > 0 ? `${fields.length} ${fieldsWord}` : "";
  }
  // deleted / restored / other: không có diff trường → để cột tự hiện nhãn hành động.
  return "";
}

function normalize(r: RawAuditRow, fieldsWord: string): AuditRow {
  const base: AuditRow = {
    id: r.id,
    createdAt: r.createdAt,
    actor: r.displayUserName || r.userName || null,
    action: r.action,
    actionCat: classifyAction(r.action),
    entityType: r.entityType ?? "",
    entityId: r.entityId ?? null,
    entityName: r.entityName ?? null,
    status: r.status || "success",
    summary: "",
  };
  base.summary = summarizeChange(base, parseDetails(r.details), fieldsWord);
  return base;
}

// ── Hook nạp audit cho MỘT tầng ──────────────────────────────────────────────

function useHierarchyAuditQuery(
  entityType: FactoryEntityType,
  enabled: boolean,
  startDate: string | undefined,
  endDate: string | undefined,
) {
  return trpc.enhancedAudit.list.useQuery(
    {
      entityType,
      startDate,
      endDate,
      limit: 200,
      sortBy: "createdAt",
      sortOrder: "desc",
    },
    {
      enabled,
      placeholderData: (prev) => prev,
      staleTime: 15_000,
    },
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export function FactoryConfigAudit(): React.JSX.Element {
  const { t } = useTranslation();
  const { isAdmin } = usePermissions();
  // `enhancedAudit.list` là adminProcedure → màn quản trị (chỉ admin xem được).
  const canView = isAdmin;

  const fieldsWord = t("factoryConfigAudit.fields", "trường");

  // Bộ lọc: giữ state cục bộ (component nhúng — tránh đụng query-param của trang chủ).
  const [values, setValues] = useState<FilterValues>({});

  const selectedType = values.entityType || "";
  const isAll = selectedType === "";
  const selectedAction = values.action || "";
  const searchText = (values.q || "").trim().toLowerCase();

  const startDate = values.windowFrom ? `${values.windowFrom}T00:00:00` : undefined;
  const endDate = values.windowTo ? `${values.windowTo}T23:59:59.999` : undefined;

  const enabledFor = (tp: FactoryEntityType) =>
    canView && (isAll || selectedType === tp);

  // 5 query cố định (rules-of-hooks); `enabled` quyết định query nào chạy.
  const qFactory = useHierarchyAuditQuery("factory", enabledFor("factory"), startDate, endDate);
  const qWorkshop = useHierarchyAuditQuery("workshop", enabledFor("workshop"), startDate, endDate);
  const qLine = useHierarchyAuditQuery("line", enabledFor("line"), startDate, endDate);
  const qStation = useHierarchyAuditQuery("station", enabledFor("station"), startDate, endDate);
  const qMachine = useHierarchyAuditQuery("machine", enabledFor("machine"), startDate, endDate);

  const perType = useMemo(
    () => [
      { type: "factory" as const, q: qFactory },
      { type: "workshop" as const, q: qWorkshop },
      { type: "line" as const, q: qLine },
      { type: "station" as const, q: qStation },
      { type: "machine" as const, q: qMachine },
    ],
    [qFactory, qWorkshop, qLine, qStation, qMachine],
  );

  // Chỉ gộp từ query ĐANG bật (query bị disable có thể còn cache tầng cũ).
  const active = perType.filter((x) => enabledFor(x.type));

  // Gộp + chuẩn hoá (chỉ tầng đang bật).
  const rawRows = useMemo(() => {
    const out: AuditRow[] = [];
    for (const { type, q } of perType) {
      if (!(canView && (isAll || selectedType === type))) continue;
      const items = (q.data?.items ?? []) as RawAuditRow[];
      for (const it of items) out.push(normalize(it, fieldsWord));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qFactory.data, qWorkshop.data, qLine.data, qStation.data, qMachine.data, selectedType, isAll, canView, fieldsWord]);

  // Lọc phía client: nhóm hành động + tìm kiếm tự do (actor/thực thể/hành động).
  const rows = useMemo(() => {
    return rawRows.filter((r) => {
      if (selectedAction && r.actionCat !== selectedAction) return false;
      if (searchText) {
        const entityLabel = t(
          ENTITY_META[r.entityType as FactoryEntityType]?.labelKey ?? "",
          ENTITY_META[r.entityType as FactoryEntityType]?.label ?? r.entityType,
        );
        const hay = [
          r.actor ?? "",
          r.entityName ?? "",
          r.entityId != null ? `#${r.entityId}` : "",
          entityLabel,
          r.action,
          r.summary,
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(searchText)) return false;
      }
      return true;
    });
  }, [rawRows, selectedAction, searchText, t]);

  // Tổng thật phía server (theo entityType + khoảng ngày) để cảnh báo "đã cắt".
  const serverTotal = active.reduce((sum, x) => sum + (x.q.data?.total ?? 0), 0);
  const loadedCount = rawRows.length;
  const capped = serverTotal > loadedCount;

  const combinedQuery = {
    isLoading: active.some((x) => x.q.isLoading),
    isError: active.some((x) => x.q.isError),
    error: active.find((x) => x.q.isError)?.q.error,
    data: rows,
    refetch: () => active.forEach((x) => x.q.refetch()),
  };

  const hasActiveFilter =
    Boolean(selectedType) || Boolean(selectedAction) || Boolean(searchText) ||
    Boolean(values.windowFrom) || Boolean(values.windowTo);

  // ── Bộ lọc ─────────────────────────────────────────────────────────────────
  const filterDefs: FilterDef[] = useMemo(
    () => [
      {
        key: "q",
        type: "search",
        label: t("factoryConfigAudit.filter.search", "Tìm kiếm"),
        placeholder: t(
          "factoryConfigAudit.filter.searchPlaceholder",
          "Người thực hiện, mã/tên, hành động…",
        ),
      },
      {
        key: "entityType",
        type: "select",
        label: t("factoryConfigAudit.filter.entityType", "Cấp cấu hình"),
        placeholder: t("factoryConfigAudit.filter.all", "Tất cả"),
        options: FACTORY_ENTITY_TYPES.map((tp) => ({
          value: tp,
          label: t(ENTITY_META[tp].labelKey, ENTITY_META[tp].label),
        })),
      },
      {
        key: "action",
        type: "select",
        label: t("factoryConfigAudit.filter.action", "Hành động"),
        placeholder: t("factoryConfigAudit.filter.all", "Tất cả"),
        options: (["created", "updated", "deleted", "restored"] as ActionCat[]).map((c) => ({
          value: c,
          label: t(ACTION_META[c].labelKey, ACTION_META[c].label),
        })),
      },
      {
        key: "window",
        type: "daterange",
        label: t("factoryConfigAudit.filter.window", "Khoảng thời gian"),
      },
    ],
    [t],
  );

  // ── Cột ──────────────────────────────────────────────────────────────────────
  const columns: DataTableColumn<AuditRow>[] = useMemo(
    () => [
      {
        id: "createdAt",
        header: t("factoryConfigAudit.col.time", "Thời gian"),
        cell: (r) => (
          <span className="tabular-nums whitespace-nowrap text-sm">{fmtDateTime(r.createdAt)}</span>
        ),
        sortValue: (r) => toTime(r.createdAt),
        width: "170px",
      },
      {
        id: "actor",
        header: t("factoryConfigAudit.col.actor", "Người thực hiện"),
        cell: (r) => r.actor || t("factoryConfigAudit.system", "Hệ thống"),
        sortValue: (r) => r.actor ?? "",
        filterValue: (r) => r.actor ?? "",
        width: "170px",
      },
      {
        id: "action",
        header: t("factoryConfigAudit.col.action", "Hành động"),
        cell: (r) => {
          const meta = ACTION_META[r.actionCat] ?? ACTION_META.other;
          return (
            <span
              className={cn(
                "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
                meta.cls,
              )}
              title={r.action}
            >
              {t(meta.labelKey, meta.label)}
            </span>
          );
        },
        sortValue: (r) => r.actionCat,
        width: "120px",
      },
      {
        id: "entityType",
        header: t("factoryConfigAudit.col.entityType", "Cấp"),
        cell: (r) => {
          const meta = ENTITY_META[r.entityType as FactoryEntityType];
          if (!meta) {
            return <span className="text-xs text-muted-foreground">{r.entityType || "—"}</span>;
          }
          const { Icon } = meta;
          return (
            <Badge variant="outline" className="gap-1 font-normal">
              <Icon className="h-3 w-3" aria-hidden="true" />
              {t(meta.labelKey, meta.label)}
            </Badge>
          );
        },
        sortValue: (r) => r.entityType,
        width: "140px",
      },
      {
        id: "entity",
        header: t("factoryConfigAudit.col.entity", "Đối tượng"),
        cell: (r) => (
          <div className="min-w-0">
            <span className="block truncate text-sm text-foreground">
              {r.entityName || (r.entityId != null ? `#${r.entityId}` : "—")}
            </span>
            {r.entityName && r.entityId != null && (
              <span className="block font-mono text-[11px] text-muted-foreground">#{r.entityId}</span>
            )}
          </div>
        ),
        sortValue: (r) => r.entityName ?? "",
        filterValue: (r) => `${r.entityName ?? ""} ${r.entityId ?? ""}`,
        width: "200px",
      },
      {
        id: "summary",
        header: t("factoryConfigAudit.col.summary", "Tóm tắt thay đổi"),
        cell: (r) => {
          if (r.status === "failure") {
            return (
              <span className="text-sm text-destructive">
                {t("factoryConfigAudit.failed", "Thất bại")}
              </span>
            );
          }
          if (r.summary) {
            return (
              <span className="text-sm">
                {r.actionCat === "updated" ? (
                  <>
                    <span className="text-muted-foreground">
                      {t("factoryConfigAudit.changedFields", "Đổi")}
                      {": "}
                    </span>
                    {r.summary}
                  </>
                ) : (
                  r.summary
                )}
              </span>
            );
          }
          // Không có diff trường → hiện nhãn hành động trung tính (trung thực).
          const meta = ACTION_META[r.actionCat] ?? ACTION_META.other;
          return <span className="text-sm text-muted-foreground">{t(meta.labelKey, meta.label)}</span>;
        },
      },
    ],
    [t],
  );

  // ── Xuất (font-safe) ─────────────────────────────────────────────────────────
  const exportColumns: ExportColumnSpec[] = useMemo(
    () => [
      { key: "time", header: t("factoryConfigAudit.col.time", "Thời gian"), format: "text" },
      { key: "actor", header: t("factoryConfigAudit.col.actor", "Người thực hiện"), format: "text" },
      { key: "action", header: t("factoryConfigAudit.col.action", "Hành động"), format: "text" },
      { key: "entityType", header: t("factoryConfigAudit.col.entityType", "Cấp"), format: "text" },
      { key: "entity", header: t("factoryConfigAudit.col.entity", "Đối tượng"), format: "text" },
      { key: "summary", header: t("factoryConfigAudit.col.summary", "Tóm tắt thay đổi"), format: "text" },
    ],
    [t],
  );

  const exportData = useMemo(
    () =>
      rows.map((r) => {
        const eMeta = ENTITY_META[r.entityType as FactoryEntityType];
        const aMeta = ACTION_META[r.actionCat] ?? ACTION_META.other;
        return {
          time: fmtDateTime(r.createdAt),
          actor: r.actor || t("factoryConfigAudit.system", "Hệ thống"),
          action: t(aMeta.labelKey, aMeta.label),
          entityType: eMeta ? t(eMeta.labelKey, eMeta.label) : r.entityType,
          entity: r.entityName
            ? r.entityId != null
              ? `${r.entityName} (#${r.entityId})`
              : r.entityName
            : r.entityId != null
              ? `#${r.entityId}`
              : "—",
          summary:
            r.status === "failure"
              ? t("factoryConfigAudit.failed", "Thất bại")
              : r.summary || t(aMeta.labelKey, aMeta.label),
        };
      }),
    [rows, t],
  );

  // ── Không đủ quyền ────────────────────────────────────────────────────────────
  if (!canView) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
          <Lock className="h-6 w-6 opacity-60" />
          <p>
            {t(
              "factoryConfigAudit.adminOnly",
              "Chỉ quản trị viên mới xem được nhật ký thay đổi cấu hình.",
            )}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header + xuất */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-lg border border-border bg-card p-2 text-muted-foreground">
            <History className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {t("factoryConfigAudit.title", "Nhật ký thay đổi cấu hình")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t(
                "factoryConfigAudit.subtitle",
                "Ai đổi cấu trúc nhà máy, khi nào, đổi gì — chỉ đọc.",
              )}
            </p>
          </div>
        </div>
        <ExportMenu
          title={t("factoryConfigAudit.title", "Nhật ký thay đổi cấu hình")}
          type="factory_config_audit"
          fileName="factory_config_audit"
          columns={exportColumns}
          data={exportData}
          disabled={rows.length === 0}
        />
      </div>

      <StatChipRow>
        <StatChip
          label={t("factoryConfigAudit.stat.shown", "Đang hiển thị")}
          value={rows.length}
          tone="info"
        />
        <StatChip
          label={t("factoryConfigAudit.stat.matched", "Đã tải")}
          value={loadedCount}
        />
        {capped && (
          <StatChip
            label={t("factoryConfigAudit.stat.total", "Tổng trong khoảng")}
            value={serverTotal}
            tone="warning"
            title={t(
              "factoryConfigAudit.stat.cappedHint",
              "Chỉ tải các thay đổi gần nhất — thu hẹp khoảng thời gian để xem thêm.",
            )}
          />
        )}
      </StatChipRow>

      <FilterBar
        filters={filterDefs}
        values={values}
        onChange={setValues}
        syncToUrl={false}
      />

      <Card>
        <CardContent className="p-3">
          <QueryBoundary
            query={combinedQuery}
            preset="table"
            isEmpty={(d) => d.length === 0}
            errorTitle={t("factoryConfigAudit.error", "Không tải được nhật ký thay đổi cấu hình")}
            emptyState={
              <EmptyState
                variant={hasActiveFilter ? "no-results" : "no-data"}
                icon={Info}
                title={t("factoryConfigAudit.empty.title", "Chưa có thay đổi cấu hình")}
                description={
                  hasActiveFilter
                    ? t(
                        "factoryConfigAudit.empty.filtered",
                        "Không có thay đổi cấu hình nào khớp bộ lọc hiện tại.",
                      )
                    : t(
                        "factoryConfigAudit.empty.desc",
                        "Chưa ghi nhận thay đổi nào về nhà máy, phân xưởng, dây chuyền, trạm hay máy.",
                      )
                }
              />
            }
          >
            {(data) => (
              <DataTable<AuditRow>
                data={data}
                getRowId={(r) => r.id}
                columns={columns}
                initialSort={{ columnId: "createdAt", dir: "desc" }}
                pageSize={25}
                virtualized
                virtualMaxHeight={560}
                rowHeight={52}
              />
            )}
          </QueryBoundary>
        </CardContent>
      </Card>
    </div>
  );
}

export default FactoryConfigAudit;
