/**
 * doc 47 IA Đợt 3 — panel ĐỘC LẬP Nhập/Xuất cấu hình nhà máy.
 *
 * MỤC ĐÍCH: quản trị viên set-up / di chuyển cả cây phân cấp (Nhà máy → Xưởng →
 * Dây chuyền → Trạm → Máy) bằng bảng tính thay vì gõ tay hàng trăm dòng.
 *
 *  • XUẤT: mỗi cấp một nút `ExportMenu` (PDF/Excel/CSV font-safe qua server),
 *    cột = đúng shape import (kể cả MÃ CHA đã resolve) → file xuất RE-IMPORT được.
 *  • NHẬP: chọn cấp → tải file CSV/Excel → parse phía client → BẢNG XEM TRƯỚC có
 *    kiểm tra từng dòng (bắt buộc đủ trường, mã cha resolve được, enum hợp lệ) →
 *    nút "Nhập" gọi `trpc.import.*` THẬT → hiện KẾT QUẢ THẬT (thành công / thất
 *    bại / lỗi kèm lý do). KHÔNG bịa thành công. "Tải mẫu" xuất file trống đúng cột.
 *
 * TRUNG THỰC: chỉ gửi dòng đã qua kiểm tra; kết quả lấy nguyên từ mutation server.
 */
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  FileDown,
} from "lucide-react";

import { trpc } from "@/lib/trpc";
import { toastTrpcError } from "@/lib/trpcErrors";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { ListSkeleton } from "@/components/AnalyticsSkeleton";
import { ExportMenu } from "@/components/ExportMenu";
import type { ExportColumnSpec } from "@/lib/serverReportExport";
import {
  FACTORY_LEVELS,
  LEVEL_DEFS,
  type FactoryLevel,
  type FieldDef,
  type ParsedRow,
  buildExportRows,
  codeById,
  downloadTemplate,
  readSheetRows,
  validateRow,
} from "./factoryConfigIO";

type Row = Record<string, unknown>;

/** Kết quả THẬT trả về từ importRouter (server/routers/dataRouters.ts). */
interface ImportResult {
  success: number;
  failed: number;
  errors: string[];
}

const PREVIEW_LIMIT = 500;

export function FactoryConfigImportExport(): React.JSX.Element {
  const { t } = useTranslation();

  // ── Nạp 5 list (dedupe với hub qua react-query) ────────────────────────────
  const factoriesQ = trpc.factory.list.useQuery();
  const workshopsQ = trpc.workshop.list.useQuery();
  const linesQ = trpc.line.list.useQuery();
  const stationsQ = trpc.station.list.useQuery();
  const machinesQ = trpc.machine.list.useQuery();

  const isLoading =
    factoriesQ.isLoading || workshopsQ.isLoading || linesQ.isLoading || stationsQ.isLoading || machinesQ.isLoading;
  const isError =
    factoriesQ.isError || workshopsQ.isError || linesQ.isError || stationsQ.isError || machinesQ.isError;
  const loadError = factoriesQ.error ?? workshopsQ.error ?? linesQ.error ?? stationsQ.error ?? machinesQ.error;
  const refetchAll = () => {
    factoriesQ.refetch();
    workshopsQ.refetch();
    linesQ.refetch();
    stationsQ.refetch();
    machinesQ.refetch();
  };

  const lists = useMemo(
    () => ({
      factory: (factoriesQ.data ?? []) as Row[],
      workshop: (workshopsQ.data ?? []) as Row[],
      line: (linesQ.data ?? []) as Row[],
      station: (stationsQ.data ?? []) as Row[],
      machine: (machinesQ.data ?? []) as Row[],
    }),
    [factoriesQ.data, workshopsQ.data, linesQ.data, stationsQ.data, machinesQ.data],
  );

  // ── Import mutations (một hook cho mỗi cấp; dispatch theo cấp chọn) ─────────
  const importFactories = trpc.import.importFactories.useMutation();
  const importWorkshops = trpc.import.importWorkshops.useMutation();
  const importLines = trpc.import.importLines.useMutation();
  const importStations = trpc.import.importStations.useMutation();
  const importMachines = trpc.import.importMachines.useMutation();

  // ── State phần nhập ────────────────────────────────────────────────────────
  const [level, setLevel] = useState<FactoryLevel>("factory");
  const [rawRows, setRawRows] = useState<Row[] | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [replaceIfExists, setReplaceIfExists] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetImportState = () => {
    setRawRows(null);
    setFileName("");
    setParseError(null);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const onLevelChange = (v: string) => {
    setLevel(v as FactoryLevel);
    resetImportState();
  };

  const onFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setResult(null);
    if (!file) return;
    setFileName(file.name);
    try {
      const rows = await readSheetRows(file);
      setParseError(null);
      setRawRows(rows);
    } catch (err) {
      setRawRows(null);
      setParseError(err instanceof Error ? err.message : String(err));
    }
  };

  // ── Kiểm tra dòng (thuần) — chạy lại khi đổi file / cấp / dữ liệu DB ────────
  const parsed = useMemo<ParsedRow[]>(() => {
    if (!rawRows) return [];
    const def = LEVEL_DEFS[level];
    const parentDef = def.parent ? LEVEL_DEFS[def.parent] : null;
    const parentCodes = new Set(
      (parentDef ? lists[parentDef.level] : []).map((r) => String(r.code ?? "").trim()),
    );
    const existingCodes = new Set(lists[level].map((r) => String(r.code ?? "").trim()));
    const ctx = {
      parentCodes,
      existingCodes,
      labelOf: (f: FieldDef) => t(f.labelKey, f.labelDefault),
      parentLabel: parentDef ? t(parentDef.labelKey, parentDef.labelDefault) : "",
    };
    return rawRows.map((raw, i) => validateRow(level, raw, i + 1, ctx));
  }, [rawRows, level, lists, t]);

  const validRows = useMemo(() => parsed.filter((r) => r.valid), [parsed]);
  const invalidCount = parsed.length - validRows.length;
  const existsCount = useMemo(() => validRows.filter((r) => r.codeExists).length, [validRows]);

  const runImport = async () => {
    if (validRows.length === 0) return;
    const data = validRows.map((r) => r.values) as any[];
    const payload = { data, replaceIfExists };
    setSubmitting(true);
    setResult(null);
    try {
      let res: ImportResult;
      switch (level) {
        case "factory":
          res = await importFactories.mutateAsync(payload);
          break;
        case "workshop":
          res = await importWorkshops.mutateAsync(payload);
          break;
        case "line":
          res = await importLines.mutateAsync(payload);
          break;
        case "station":
          res = await importStations.mutateAsync(payload);
          break;
        case "machine":
          res = await importMachines.mutateAsync(payload);
          break;
      }
      setResult(res);
      refetchAll();
    } catch (err) {
      toastTrpcError(err);
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return <ListSkeleton />;
  }

  if (isError) {
    return (
      <Alert variant="destructive" className="border-destructive/30">
        <AlertTitle>{t("factoryIO.loadError", "Không tải được dữ liệu cấu hình")}</AlertTitle>
        <AlertDescription>
          {loadError instanceof Error ? loadError.message : null}
          <Button variant="outline" size="sm" className="mt-2" onClick={refetchAll}>
            {t("common.retry", "Thử lại")}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const def = LEVEL_DEFS[level];

  return (
    <div className="flex flex-col gap-6">
      {/* ══════════════ XUẤT ══════════════ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileDown className="h-4 w-4 text-primary" />
            {t("factoryIO.export.title", "Xuất cấu hình")}
          </CardTitle>
          <CardDescription>
            {t(
              "factoryIO.export.desc",
              "Xuất từng cấp ra PDF/Excel/CSV (font tiếng Việt chuẩn). Cột khớp định dạng nhập nên file xuất có thể dùng lại để di chuyển sang nhà máy khác.",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y divide-border/60">
          {FACTORY_LEVELS.map((lv) => (
            <ExportLevelRow key={lv} level={lv} rows={lists[lv]} lists={lists} />
          ))}
        </CardContent>
      </Card>

      {/* ══════════════ NHẬP ══════════════ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Upload className="h-4 w-4 text-primary" />
            {t("factoryIO.import.title", "Nhập cấu hình")}
          </CardTitle>
          <CardDescription>
            {t(
              "factoryIO.import.desc",
              "Chọn cấp, tải file CSV/Excel rồi kiểm tra trước khi nhập. Nhập theo thứ tự Nhà máy → Xưởng → Dây chuyền → Trạm → Máy (mã cha phải tồn tại trước).",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* Hàng điều khiển: chọn cấp + tải mẫu + ghi đè */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">{t("factoryIO.import.level", "Cấp dữ liệu")}</Label>
              <Select value={level} onValueChange={onLevelChange}>
                <SelectTrigger className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FACTORY_LEVELS.map((lv) => (
                    <SelectItem key={lv} value={lv}>
                      {t(LEVEL_DEFS[lv].labelKey, LEVEL_DEFS[lv].labelDefault)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button variant="outline" size="sm" onClick={() => downloadTemplate(level)}>
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              {t("factoryIO.import.template", "Tải mẫu")}
            </Button>

            <label className="ml-auto flex cursor-pointer items-center gap-2 rounded-md border bg-secondary/40 px-3 py-2">
              <Switch checked={replaceIfExists} onCheckedChange={setReplaceIfExists} />
              <span className="text-sm">
                {t("factoryIO.import.replace", "Ghi đè khi trùng mã")}
              </span>
            </label>
          </div>

          {/* Cột yêu cầu của cấp đang chọn */}
          <p className="text-xs text-muted-foreground">
            {t("factoryIO.import.columns", "Cột yêu cầu")}:{" "}
            {def.fields.map((f, i) => (
              <span key={f.key}>
                {i > 0 && ", "}
                <code className="rounded bg-muted px-1 py-0.5 text-[11px] text-foreground">{f.key}</code>
                {f.required && <span className="text-destructive">*</span>}
              </span>
            ))}
          </p>

          {/* Ô chọn file */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">{t("factoryIO.import.file", "Chọn file (.csv / .xlsx)")}</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={onFileSelect}
              className="block w-full text-sm text-muted-foreground file:mr-4 file:rounded-md file:border-0 file:bg-primary/10 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-primary hover:file:bg-primary/20"
            />
            {fileName && (
              <p className="text-xs text-muted-foreground">
                {t("factoryIO.import.fileLabel", "File")}: {fileName}
              </p>
            )}
          </div>

          {parseError && (
            <Alert variant="destructive" className="border-destructive/30">
              <AlertTitle>{t("factoryIO.import.parseError", "Không đọc được file")}</AlertTitle>
              <AlertDescription>{parseError}</AlertDescription>
            </Alert>
          )}

          {/* Xem trước + kiểm tra */}
          {rawRows && !parseError && (
            <PreviewSection
              level={level}
              parsed={parsed}
              validCount={validRows.length}
              invalidCount={invalidCount}
              existsCount={existsCount}
              replaceIfExists={replaceIfExists}
            />
          )}

          {/* Nút Nhập */}
          {rawRows && !parseError && (
            <div className="flex items-center gap-3">
              <Button onClick={runImport} disabled={submitting || validRows.length === 0}>
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                {t("factoryIO.import.submit", "Nhập {{count}} dòng hợp lệ").replace("{{count}}", String(validRows.length))}
              </Button>
              {invalidCount > 0 && (
                <span className="text-xs text-muted-foreground">
                  {t("factoryIO.import.skipInvalid", "{{count}} dòng lỗi sẽ bị bỏ qua").replace(
                    "{{count}}",
                    String(invalidCount),
                  )}
                </span>
              )}
            </div>
          )}

          {/* Kết quả THẬT */}
          {result && <ResultSummary result={result} />}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Một hàng xuất cho một cấp ─────────────────────────────────────────────────
function ExportLevelRow({
  level,
  rows,
  lists,
}: {
  level: FactoryLevel;
  rows: Row[];
  lists: Record<FactoryLevel, Row[]>;
}): React.JSX.Element {
  const { t } = useTranslation();
  const def = LEVEL_DEFS[level];
  const label = t(def.labelKey, def.labelDefault);

  const columns: ExportColumnSpec[] = def.fields.map((f) => ({
    key: f.key,
    header: f.key,
    format: f.type === "number" ? "number" : "text",
  }));

  const parentMap = def.parent ? codeById(lists[def.parent]) : null;
  const data = buildExportRows(level, rows, parentMap);
  const empty = rows.length === 0;

  return (
    <div className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <Badge variant={empty ? "outline" : "secondary"}>
          {t("factoryIO.export.rows", "{{count}} dòng").replace("{{count}}", String(rows.length))}
        </Badge>
      </div>
      {empty ? (
        <span className="text-xs text-muted-foreground">{t("factoryIO.export.empty", "Chưa có dữ liệu")}</span>
      ) : (
        <ExportMenu
          title={t("factoryIO.export.reportTitle", "Cấu hình {{level}}").replace("{{level}}", label)}
          columns={columns}
          data={data}
          type={`factory_config_${level}`}
          fileName={`cau-hinh-${level}`}
        />
      )}
    </div>
  );
}

// ── Bảng xem trước + tóm tắt kiểm tra ────────────────────────────────────────
function PreviewSection({
  level,
  parsed,
  validCount,
  invalidCount,
  existsCount,
  replaceIfExists,
}: {
  level: FactoryLevel;
  parsed: ParsedRow[];
  validCount: number;
  invalidCount: number;
  existsCount: number;
  replaceIfExists: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const def = LEVEL_DEFS[level];

  if (parsed.length === 0) {
    return (
      <Alert>
        <AlertTitle>{t("factoryIO.import.empty", "File không có dòng dữ liệu")}</AlertTitle>
      </Alert>
    );
  }

  const shown = parsed.slice(0, PREVIEW_LIMIT);

  return (
    <div className="flex flex-col gap-2">
      {/* Tóm tắt kiểm tra */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="secondary" className="gap-1">
          <CheckCircle2 className="h-3 w-3 text-success" />
          {t("factoryIO.import.valid", "{{count}} hợp lệ").replace("{{count}}", String(validCount))}
        </Badge>
        {invalidCount > 0 && (
          <Badge variant="destructive" className="gap-1">
            <XCircle className="h-3 w-3" />
            {t("factoryIO.import.invalid", "{{count}} lỗi").replace("{{count}}", String(invalidCount))}
          </Badge>
        )}
        {existsCount > 0 && (
          <Badge variant="outline" className="gap-1">
            <AlertTriangle className="h-3 w-3 text-warning" />
            {(replaceIfExists
              ? t("factoryIO.import.willUpdate", "{{count}} trùng mã → cập nhật")
              : t("factoryIO.import.willConflict", "{{count}} trùng mã → sẽ báo lỗi (bật ghi đè để cập nhật)")
            ).replace("{{count}}", String(existsCount))}
          </Badge>
        )}
      </div>

      {/* Bảng */}
      <div className="max-h-[420px] overflow-auto rounded-lg border border-border/60">
        <Table>
          <TableHeader className="sticky top-0 bg-card">
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead className="w-28">{t("factoryIO.import.status", "Trạng thái")}</TableHead>
              {def.fields.map((f) => (
                <TableHead key={f.key} className="whitespace-nowrap">
                  {t(f.labelKey, f.labelDefault)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((row) => (
              <TableRow key={row.rowNumber} className={cn(!row.valid && "bg-destructive/5")}>
                <TableCell className="text-xs text-muted-foreground">{row.rowNumber}</TableCell>
                <TableCell>
                  {row.valid ? (
                    row.codeExists ? (
                      <Badge variant="outline" className="gap-1">
                        <AlertTriangle className="h-3 w-3 text-warning" />
                        {t("factoryIO.import.rowExists", "Trùng mã")}
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="gap-1">
                        <CheckCircle2 className="h-3 w-3 text-success" />
                        {t("factoryIO.import.rowNew", "Mới")}
                      </Badge>
                    )
                  ) : (
                    <div className="flex flex-col gap-0.5">
                      <Badge variant="destructive" className="w-fit gap-1">
                        <XCircle className="h-3 w-3" />
                        {t("factoryIO.import.rowError", "Lỗi")}
                      </Badge>
                      <span className="text-[11px] leading-tight text-destructive">{row.errors.join("; ")}</span>
                    </div>
                  )}
                </TableCell>
                {def.fields.map((f) => (
                  <TableCell key={f.key} className="whitespace-nowrap text-xs">
                    {formatCell(row.values[f.key])}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {parsed.length > PREVIEW_LIMIT && (
        <p className="text-xs text-muted-foreground">
          {t("factoryIO.import.previewLimit", "Chỉ hiện {{shown}}/{{total}} dòng đầu (tất cả vẫn được nhập)")
            .replace("{{shown}}", String(PREVIEW_LIMIT))
            .replace("{{total}}", String(parsed.length))}
        </p>
      )}
    </div>
  );
}

// ── Tóm tắt kết quả THẬT sau khi nhập ────────────────────────────────────────
function ResultSummary({ result }: { result: ImportResult }): React.JSX.Element {
  const { t } = useTranslation();
  const hasFailures = result.failed > 0;

  return (
    <Alert variant={hasFailures ? "destructive" : "default"} className={cn(!hasFailures && "border-success/30")}>
      <AlertTitle className="flex items-center gap-2">
        {hasFailures ? (
          <AlertTriangle className="h-4 w-4" />
        ) : (
          <CheckCircle2 className="h-4 w-4 text-success" />
        )}
        {t("factoryIO.result.title", "Kết quả nhập")}
      </AlertTitle>
      <AlertDescription>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="gap-1">
            <CheckCircle2 className="h-3 w-3 text-success" />
            {t("factoryIO.result.success", "{{count}} thành công (tạo/cập nhật)").replace(
              "{{count}}",
              String(result.success),
            )}
          </Badge>
          {result.failed > 0 && (
            <Badge variant="destructive" className="gap-1">
              <XCircle className="h-3 w-3" />
              {t("factoryIO.result.failed", "{{count}} thất bại").replace("{{count}}", String(result.failed))}
            </Badge>
          )}
        </div>
        {result.errors.length > 0 && (
          <ul className="mt-2 max-h-48 list-disc space-y-0.5 overflow-auto rounded-md border border-destructive/20 bg-destructive/5 px-5 py-2 text-xs">
            {result.errors.map((e, i) => (
              <li key={i} className="text-destructive">
                {e}
              </li>
            ))}
          </ul>
        )}
      </AlertDescription>
    </Alert>
  );
}

function formatCell(v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v === "boolean") return v ? "✓" : "✗";
  return String(v);
}

export default FactoryConfigImportExport;
