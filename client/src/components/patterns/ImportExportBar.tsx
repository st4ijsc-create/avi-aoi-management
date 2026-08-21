/**
 * Doc 42 Đợt 4A (INFRA-4A) — <ImportExportBar>: thanh nút import/export dùng
 * chung cho mọi bảng master-data.
 *
 *  • Xuất Excel / CSV  — client-side qua `xlsx` từ `data` + `columns` (header =
 *    nhãn cột). Trang có thể tự lo bằng `onExport(format)` nếu muốn xuất server.
 *  • Tải mẫu           — file rỗng chỉ header + 1 dòng ví dụ.
 *  • Nhập              — chọn file → PREVIEW (DataTable) rows parse được + lỗi
 *    (dòng lỗi tô đỏ) → "Xác nhận nhập" gọi `onImport(rows)` → hiện kết quả.
 *
 * Luật ánh xạ header→field + ép kiểu + validate DÙNG CHUNG với server qua
 * `@shared/masterDataIO` (không lệch). `xlsx` đọc được cả .csv lẫn .xlsx.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import {
  Upload,
  Download,
  FileSpreadsheet,
  FileText,
  FileDown,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import {
  type MasterDataColumn,
  type MasterDataFormat,
  type MasterDataRowDetail,
  validateRecordsDetailed,
  toHeaderRecord,
  buildExampleRecord,
} from "@shared/masterDataIO";

export type { MasterDataColumn, MasterDataFormat } from "@shared/masterDataIO";

/** Kết quả import trả về từ trang (để hiện tổng kết). */
export interface ImportResultSummary {
  inserted: number;
  failed: number;
  errors?: Array<{ row?: number; message: string }>;
}

export interface ImportExportBarProps<T extends Record<string, any> = Record<string, any>> {
  /** Đặc tả cột: dùng cho export header + parse/validate import. */
  columns: MasterDataColumn[];
  /** Dữ liệu hiện có để export client-side. Bỏ trống nếu chỉ dùng import/onExport. */
  data?: T[];
  /**
   * Thực thi import các dòng HỢP LỆ đã parse. Không truyền → ẩn nút "Nhập".
   * Trả tổng kết {inserted, failed, errors} để hiện cho user.
   */
  onImport?: (rows: Array<Record<string, unknown>>) => Promise<ImportResultSummary>;
  /** Cột cho file mẫu (mặc định = `columns`). */
  templateColumns?: MasterDataColumn[];
  /** Nhãn thực thể (vd "vật liệu") — dùng trong tiêu đề & tên file. */
  entityLabel: string;
  /** Ghi đè export mặc định (vd xuất từ server có branding). */
  onExport?: (format: MasterDataFormat) => void | Promise<void>;
  /** Tên file cơ sở (mặc định slug hoá từ entityLabel). */
  fileBaseName?: string;
  disabled?: boolean;
  className?: string;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function slug(s: string): string {
  return (
    s
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "") // bỏ dấu tổ hợp (tiếng Việt)
      .replace(/[đĐ]/g, "d")
      .replace(/[^\w-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .toLowerCase() || "data"
  );
}

function downloadBlob(content: BlobPart, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Sinh worksheet từ các bản ghi header-keyed theo đúng thứ tự cột. */
function sheetFrom(records: Array<Record<string, unknown>>, columns: MasterDataColumn[]) {
  return XLSX.utils.json_to_sheet(records, { header: columns.map((c) => c.header) });
}

function exportViaXlsx(
  records: Array<Record<string, unknown>>,
  columns: MasterDataColumn[],
  format: MasterDataFormat,
  base: string,
): void {
  const ws = sheetFrom(records, columns);
  if (format === "csv") {
    const csv = XLSX.utils.sheet_to_csv(ws);
    downloadBlob("﻿" + csv, `${base}.csv`, "text/csv;charset=utf-8");
  } else {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Data");
    XLSX.writeFile(wb, `${base}.xlsx`);
  }
}

// ─── component ───────────────────────────────────────────────────────────────

export function ImportExportBar<T extends Record<string, any> = Record<string, any>>({
  columns,
  data,
  onImport,
  templateColumns,
  entityLabel,
  onExport,
  fileBaseName,
  disabled = false,
  className,
}: ImportExportBarProps<T>): React.JSX.Element {
  const { t } = useTranslation();
  const base = fileBaseName ?? slug(entityLabel);
  const tmplColumns = templateColumns ?? columns;

  const [open, setOpen] = React.useState(false);
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [parsing, setParsing] = React.useState(false);
  const [details, setDetails] = React.useState<MasterDataRowDetail[] | null>(null);
  const [importing, setImporting] = React.useState(false);
  const [result, setResult] = React.useState<ImportResultSummary | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const validRows = React.useMemo(
    () => (details ?? []).filter((d) => d.errors.length === 0).map((d) => d.values),
    [details],
  );
  const errorCount = React.useMemo(
    () => (details ?? []).filter((d) => d.errors.length > 0).length,
    [details],
  );

  // ── export ──
  const handleExport = React.useCallback(
    async (format: MasterDataFormat) => {
      if (onExport) {
        await onExport(format);
        return;
      }
      const rows = (data ?? []).map((r) => toHeaderRecord(r, columns));
      if (rows.length === 0) {
        toast.warning(t("importExportBar.khongCoDuLieuDe", "Không có dữ liệu để xuất"));
        return;
      }
      exportViaXlsx(rows, columns, format, base);
      toast.success(`Đã xuất ${rows.length} ${entityLabel} (${format.toUpperCase()})`);
    },
    [onExport, data, columns, base, entityLabel],
  );

  const handleTemplate = React.useCallback(
    (format: MasterDataFormat) => {
      const example = buildExampleRecord(tmplColumns);
      exportViaXlsx([example], tmplColumns, format, `${base}_mau`);
      toast.success(t("importExportBar.daTaiFileMau", "Đã tải file mẫu"));
    },
    [tmplColumns, base],
  );

  // ── import ──
  const resetImport = React.useCallback(() => {
    setFileName(null);
    setDetails(null);
    setResult(null);
    setParsing(false);
    setImporting(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const handleFile = React.useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setFileName(file.name);
      setResult(null);
      setParsing(true);
      try {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(new Uint8Array(buf), { type: "array", cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
          defval: "",
          raw: true,
        });
        setDetails(validateRecordsDetailed(records, columns));
      } catch (err) {
        toast.error(`Không đọc được file: ${(err as Error).message}`);
        setDetails(null);
      } finally {
        setParsing(false);
      }
    },
    [columns],
  );

  const handleConfirm = React.useCallback(async () => {
    if (!onImport || validRows.length === 0) return;
    setImporting(true);
    try {
      const res = await onImport(validRows);
      setResult(res);
      if (res.failed === 0) {
        toast.success(`Đã nhập ${res.inserted} ${entityLabel}`);
      } else {
        toast.warning(`Nhập: ${res.inserted} thành công, ${res.failed} lỗi`);
      }
    } catch (err) {
      toast.error(`Nhập lỗi: ${(err as Error).message}`);
    } finally {
      setImporting(false);
    }
  }, [onImport, validRows, entityLabel]);

  // ── preview columns ──
  const previewColumns: DataTableColumn<MasterDataRowDetail>[] = React.useMemo(() => {
    const rowCol: DataTableColumn<MasterDataRowDetail> = {
      id: "__row",
      header: "Dòng",
      align: "right",
      width: "60px",
      cell: (d) => (
        <span className={cn("tabular-nums", d.errors.length > 0 && "font-semibold text-destructive")}>
          {d.row}
        </span>
      ),
    };
    const specCols: DataTableColumn<MasterDataRowDetail>[] = columns.map((col) => ({
      id: col.field,
      // Nhãn HIỂN THỊ theo ngôn ngữ; phép KHỚP cột và hàng tiêu đề template vẫn
      // dùng `col.header` nguyên văn — xem docblock `MasterDataColumn.header`.
      header: col.headerKey ? t(col.headerKey) : col.header,
      cell: (d) => {
        const hasErr = d.errors.some((e) => e.field === col.field);
        const v = d.values[col.field];
        const text = v === undefined || v === null || v === "" ? "—" : String(v);
        return <span className={cn(hasErr && "text-destructive font-medium")}>{text}</span>;
      },
    }));
    const statusCol: DataTableColumn<MasterDataRowDetail> = {
      id: "__status",
      header: "Trạng thái",
      cell: (d) =>
        d.errors.length === 0 ? (
          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="size-4" /> Hợp lệ
          </span>
        ) : (
          <span className="inline-flex items-start gap-1 text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>{d.errors.map((e) => e.message).join("; ")}</span>
          </span>
        ),
    };
    return [rowCol, ...specCols, statusCol];
  }, [columns]);

  const total = details?.length ?? 0;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {/* Xuất */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5" disabled={disabled}>
            <Download className="size-4" /> Xuất
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => handleExport("xlsx")}>
            <FileSpreadsheet className="size-4" /> Xuất Excel
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleExport("csv")}>
            <FileText className="size-4" /> Xuất CSV
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Tải mẫu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5" disabled={disabled}>
            <FileDown className="size-4" /> Tải mẫu
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => handleTemplate("xlsx")}>
            <FileSpreadsheet className="size-4" /> Mẫu Excel
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleTemplate("csv")}>
            <FileText className="size-4" /> Mẫu CSV
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Nhập */}
      {onImport && (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={disabled}
          onClick={() => {
            resetImport();
            setOpen(true);
          }}
        >
          <Upload className="size-4" /> Nhập
        </Button>
      )}

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (importing || parsing) return;
          setOpen(next);
          if (!next) resetImport();
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Nhập {entityLabel} từ file</DialogTitle>
            <DialogDescription>
              Chọn file Excel (.xlsx) hoặc CSV. Xem trước dữ liệu, sửa các dòng lỗi rồi xác nhận nhập.
            </DialogDescription>
          </DialogHeader>

          {/* Kết quả sau khi nhập */}
          {result ? (
            <div className="space-y-3 py-2">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400" />
                <span>
                  Đã nhập <strong>{result.inserted}</strong> {entityLabel}
                  {result.failed > 0 && (
                    <>
                      {" · "}
                      <span className="text-destructive">
                        <strong>{result.failed}</strong> thất bại
                      </span>
                    </>
                  )}
                </span>
              </div>
              {result.errors && result.errors.length > 0 && (
                <div className="max-h-40 overflow-auto rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
                  {result.errors.slice(0, 50).map((e, i) => (
                    <div key={i}>
                      {e.row != null ? `Dòng ${e.row}: ` : ""}
                      {e.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3 py-1">
              <div className="flex items-center gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFile}
                  disabled={parsing || importing}
                  className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-primary hover:file:bg-primary/20"
                />
                {fileName && (
                  <button
                    type="button"
                    onClick={resetImport}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3.5" /> Xoá
                  </button>
                )}
              </div>

              {parsing && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Đang đọc file…
                </div>
              )}

              {details && (
                <>
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <span>
                      Đọc được <strong>{total}</strong> dòng
                    </span>
                    <span className="text-emerald-600 dark:text-emerald-400">
                      {validRows.length} hợp lệ
                    </span>
                    {errorCount > 0 && (
                      <span className="text-destructive">{errorCount} dòng lỗi (sẽ bỏ qua)</span>
                    )}
                  </div>
                  <div className="max-h-[45vh] overflow-auto">
                    <DataTable<MasterDataRowDetail>
                      data={details}
                      getRowId={(d) => d.row}
                      columns={previewColumns}
                      pageSize={50}
                      emptyState={
                        <div className="p-6 text-center text-sm text-muted-foreground">
                          File không có dòng dữ liệu nào.
                        </div>
                      }
                    />
                  </div>
                </>
              )}
            </div>
          )}

          <DialogFooter>
            {result ? (
              <Button
                onClick={() => {
                  setOpen(false);
                  resetImport();
                }}
              >
                Đóng
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setOpen(false)} disabled={parsing || importing}>
                  Huỷ
                </Button>
                <Button
                  onClick={handleConfirm}
                  disabled={!details || validRows.length === 0 || importing}
                >
                  {importing && <Loader2 className="size-4 animate-spin" />}
                  Xác nhận nhập ({validRows.length})
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ImportExportBar;
