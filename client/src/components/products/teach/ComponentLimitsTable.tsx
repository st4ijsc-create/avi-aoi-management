/**
 * ComponentLimitsTable.tsx — Khối C Task 10: bảng linh kiện của MỘT capture, đọc
 * `cayDay.listComponents` (Task 9). ĐỌC-CHỈ — `onEdit`/`onBatchEdit` là CHỖ TRỐNG cho Task 11
 * gắn dialog dạy giới hạn (canvas nằm TRONG dialog đó, R-KC-1 — KHÔNG nhúng
 * `MeasurementPointCanvas` ở đây).
 *
 * Cột trạng thái đọc `coGioiHan` — nhãn CHỈ nói "đã dạy / chưa dạy" (KHÔNG ngụ ý "chấm được"),
 * xem cảnh báo BG-105 ở `teachTreeLogic.ts`. Thanh đầu bảng hiện `thongKeGioiHan` (đếm TOÀN
 * CÂY của `(sản phẩm, máy)`, do `TeachTreeTab` truyền xuống) — bảng này KHÔNG tự đếm lại.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { useCanWrite } from "@/components/PermissionGate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { GraduationCap, Pencil } from "lucide-react";
import {
  mapComponentRows,
  trangThaiGioiHan,
  formatThongKe,
  COT_GIOI_HAN_HIEN_THI,
  type ComponentLimitsRow,
  type ThongKeGioiHan,
} from "./teachTreeLogic";

export interface ComponentLimitsTableProps {
  captureRowId: number;
  /** `thongKeGioiHan` của TOÀN CÂY — `null` khi chưa nạp xong. Không tính lại ở đây. */
  stats: ThongKeGioiHan | null;
  /** Task 11 gắn dialog dạy giới hạn cho MỘT linh kiện. */
  onEdit: (row: ComponentLimitsRow) => void;
  /** Task 11 gắn dialog dạy giới hạn HÀNG LOẠT cho các linh kiện đã chọn. */
  onBatchEdit: (rows: ComponentLimitsRow[]) => void;
}

export function ComponentLimitsTable({ captureRowId, stats, onEdit, onBatchEdit }: ComponentLimitsTableProps) {
  const { t } = useTranslation();
  const { canEdit } = useCanWrite("settings_products");
  const componentsQuery = trpc.cayDay.listComponents.useQuery(
    { captureRowId },
    { enabled: captureRowId > 0 },
  );
  const rows = mapComponentRows(componentsQuery.data ?? []);
  const [selectedIds, setSelectedIds] = useState<Array<string | number>>([]);

  const columns: DataTableColumn<ComponentLimitsRow>[] = [
    {
      id: "componentExtId",
      header: t("teachTree.componentExtId", "Mã linh kiện"),
      cell: (r) => r.componentExtId ?? "—",
      sortValue: (r) => r.componentExtId ?? "",
      filterValue: (r) => r.componentExtId ?? "",
      alwaysVisible: true,
    },
    {
      id: "name",
      header: t("teachTree.tenLinhKien", "Tên linh kiện"),
      cell: (r) => r.name,
      sortValue: (r) => r.name,
      filterValue: (r) => r.name,
    },
    { id: "roi", header: "ROI", cell: (r) => r.roi },
    {
      id: "trangThai",
      header: t("teachTree.trangThai", "Trạng thái"),
      cell: (r) => {
        const tt = trangThaiGioiHan(r.coGioiHan);
        return <Badge variant={tt.variant}>{t(tt.key, tt.defaultText)}</Badge>;
      },
      sortValue: (r) => (r.coGioiHan ? 1 : 0),
    },
    // Cột giới hạn — data-driven từ `COT_GIOI_HAN_HIEN_THI` (spec đã lọc, `teachTreeLogic.ts`),
    // KHÔNG liệt kê tên cột tay ở đây (đúng yêu cầu điều phối sau re-review Task 7: một nguồn
    // sự thật `shared/pointLimitSpec.ts`, không copy 4).
    ...COT_GIOI_HAN_HIEN_THI.map((cot): DataTableColumn<ComponentLimitsRow> => ({
      id: cot.field,
      header: t(cot.i18nKey),
      cell: (r) => r.gioiHanHienThi[cot.field] ?? "—",
    })),
    {
      id: "edit",
      header: "",
      cell: (r) => (
        <Button
          size="sm"
          variant="ghost"
          disabled={!canEdit}
          title={t("teachTree.dayGioiHanComingSoon", "Dạy giới hạn")}
          onClick={() => onEdit(r)}
        >
          <Pencil className="h-4 w-4" />
        </Button>
      ),
      alwaysVisible: true,
      width: "56px",
    },
  ];

  const thongKe = stats ? formatThongKe(stats) : null;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
        <CardTitle className="text-sm font-medium">{t("teachTree.bangLinhKien", "Linh kiện trong capture")}</CardTitle>
        <div className="flex items-center gap-2">
          {thongKe && (
            <Badge variant="outline">
              {t("teachTree.thongKe", "Tiến độ dạy: {{daDay}}/{{tong}}", { daDay: thongKe.daDay, tong: thongKe.tong })}
            </Badge>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={!canEdit || selectedIds.length === 0}
            title={t("teachTree.dayGioiHanComingSoon", "Dạy giới hạn")}
            onClick={() => onBatchEdit(rows.filter((r) => selectedIds.includes(r.id)))}
          >
            <GraduationCap className="h-4 w-4 mr-1.5" />
            {t("teachTree.dayGioiHanHangLoat", "Dạy giới hạn ({{n}})", { n: selectedIds.length })}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {componentsQuery.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : rows.length === 0 ? (
          <EmptyState variant="no-data" compact title={t("teachTree.captureRong", "Capture này chưa có linh kiện")} />
        ) : (
          <DataTable<ComponentLimitsRow>
            data={rows}
            getRowId={(r) => r.id}
            columns={columns}
            selectable
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
          />
        )}
      </CardContent>
    </Card>
  );
}
