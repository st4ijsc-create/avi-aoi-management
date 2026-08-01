import { useState, useRef } from "react";
import { useTranslation } from 'react-i18next';
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Upload, FileSpreadsheet, CheckCircle, XCircle, AlertTriangle, Download, Loader2 } from "lucide-react";
import * as XLSX from "xlsx";

interface BulkImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productModelId: number;
  productModelName: string;
  onSuccess?: () => void;
}

interface ParsedPoint {
  code: string;
  name: string;
  description?: string;
  measurementType: "DIMENSION" | "VISUAL" | "ELECTRICAL" | "POSITION" | "COLOR" | "SURFACE" | "OTHER";
  // Doc 31 MP7 — fine-grained catalog code (maps to measurementTypeCatalog).
  measurementTypeCode?: string;
  unit?: string;
  lowerLimit?: number;
  upperLimit?: number;
  nominalValue?: number;
  // Doc 31 MP7 — tolerance v2.
  toleranceMode?: "min_only" | "max_only" | "range" | "bilateral";
  tolPlus?: number;
  tolMinus?: number;
  positionX: number;
  positionY: number;
  radius: number;
  cropWidth: number;
  cropHeight: number;
  orderIndex: number;
  // Doc 31 MP7 — shape (circle/rect/…).
  shape?: "circle" | "rect" | "polygon" | "line" | "ring";
  // Doc 31 MP7 — 3D / solder fields (SPI/AXI, decision #2).
  heightMin?: number;
  heightMax?: number;
  heightNominal?: number;
  volumeMin?: number;
  volumeMax?: number;
  volumeNominal?: number;
  areaMin?: number;
  areaMax?: number;
  coplanarityMax?: number;
  // Doc 31 MP1/PM6 — component linkage (Pareto-by-package chain).
  componentCode?: string;
  refDesignator?: string;
  error?: string;
}

const MEASUREMENT_TYPES = ["DIMENSION", "VISUAL", "ELECTRICAL", "POSITION", "COLOR", "SURFACE", "OTHER"];
const TOLERANCE_MODES = ["min_only", "max_only", "range", "bilateral"];
const POINT_SHAPES = ["circle", "rect", "polygon", "line", "ring"];

export function BulkImportDialog({ 
  open, 
  onOpenChange, 
  productModelId, 
  productModelName,
  onSuccess 
}: BulkImportDialogProps) {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [parsedPoints, setParsedPoints] = useState<ParsedPoint[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ success: number; failed: number; skipped?: number; errors: string[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const bulkImportMutation = trpc.bulkImport.measurementPoints.useMutation({
    onSuccess: (result) => {
      setImportResult(result);
      if (result.success > 0) {
        toast.success(t('products.bulkImport.importSuccess', { count: result.success }));
        onSuccess?.();
      }
      if (result.failed > 0) {
        toast.error(t('products.bulkImport.importFailed', { count: result.failed }));
      }
      // Doc 31 MP7 — limits stripped because the product is live (approval-gated).
      if ((result as any).skipped > 0) {
        toast.warning(t('products.bulkImport.limitsSkipped', { count: (result as any).skipped }));
      }
      setIsImporting(false);
    },
    onError: (error) => {
      toast.error(t('products.bulkImport.importError', { message: error.message }));
      setIsImporting(false);
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    if (!selectedFile.name.match(/\.(xlsx|xls)$/i)) {
      toast.error(t('products.bulkImport.selectExcelFile'));
      return;
    }

    setFile(selectedFile);
    setImportResult(null);
    parseExcelFile(selectedFile);
  };

  const parseExcelFile = async (file: File) => {
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

      if (jsonData.length < 2) {
        setParseErrors([t('products.bulkImport.noDataOrHeader')]);
        setParsedPoints([]);
        return;
      }

      // Normalize headers: lowercase, strip spaces/underscores/hyphens so
      // "Position X" / "position_x" / "positionX" all collapse to "positionx".
      // Doc 31 MP7 — EXACT (normalized) alias matching replaces the old loose
      // `.includes()` which now collides badly (e.g. "min" ⊂ "heightmin").
      const norm = (h: any) => String(h).toLowerCase().trim().replace(/[\s_\-]+/g, "");
      const normHeaders = jsonData[0].map(norm);
      const findCol = (...aliases: string[]) => {
        const set = aliases.map(norm);
        return normHeaders.findIndex((h: string) => set.includes(h));
      };
      const errors: string[] = [];
      const points: ParsedPoint[] = [];

      // Map column indices (canonical template names + english/vietnamese aliases)
      const colMap = {
        code: findCol("code", "mã", "ma", "pointcode", "mãđiểm", "mađiem"),
        name: findCol("name", "tên", "ten", "pointname"),
        description: findCol("description", "desc", "môtả", "mota"),
        measurementType: findCol("measurementtype", "type", "loại", "loai"),
        measurementTypeCode: findCol("measurementtypecode", "typecode", "catalogcode", "mãloại", "maloai"),
        unit: findCol("unit", "đơnvị", "donvi"),
        lowerLimit: findCol("lowerlimit", "lower", "lsl", "min", "giớihạndưới", "duoi"),
        upperLimit: findCol("upperlimit", "upper", "usl", "max", "giớihạntrên", "tren"),
        nominalValue: findCol("nominalvalue", "nominal", "danhđịnh", "danhdinh"),
        toleranceMode: findCol("tolerancemode", "tolmode", "chếđộdungsai", "chedodungsai"),
        tolPlus: findCol("tolplus", "tol+", "dungsaiplus", "toleranceplus"),
        tolMinus: findCol("tolminus", "tol-", "dungsaiminus", "toleranceminus"),
        positionX: findCol("positionx", "posx", "x", "tọađộx", "toadox"),
        positionY: findCol("positiony", "posy", "y", "tọađộy", "toadoy"),
        radius: findCol("radius", "bánkính", "bankinh"),
        cropWidth: findCol("cropwidth", "width", "rộng", "rong"),
        cropHeight: findCol("cropheight", "height", "cao"),
        orderIndex: findCol("orderindex", "order", "thứtự", "thutu"),
        shape: findCol("shape", "hình", "hinh"),
        heightMin: findCol("heightmin"),
        heightMax: findCol("heightmax"),
        heightNominal: findCol("heightnominal"),
        volumeMin: findCol("volumemin"),
        volumeMax: findCol("volumemax"),
        volumeNominal: findCol("volumenominal"),
        areaMin: findCol("areamin"),
        areaMax: findCol("areamax"),
        coplanarityMax: findCol("coplanaritymax", "coplanarity"),
        // Doc 31 MP1/PM6 — component linkage columns.
        componentCode: findCol("componentcode", "component", "mãlinhkiện", "malinhkien"),
        refDesignator: findCol("refdesignator", "refdes", "designator", "vịtrí", "vitri"),
      };

      // Validate required columns
      if (colMap.code === -1) errors.push(t('products.bulkImport.missingCodeCol'));
      if (colMap.name === -1) errors.push(t('products.bulkImport.missingNameCol'));
      if (colMap.positionX === -1) errors.push(t('products.bulkImport.missingPosXCol'));
      if (colMap.positionY === -1) errors.push(t('products.bulkImport.missingPosYCol'));

      if (errors.length > 0) {
        setParseErrors(errors);
        setParsedPoints([]);
        return;
      }

      // Parse data rows — per-row & per-column validation. A bad OPTIONAL cell is
      // reported and dropped (the row still imports); a bad REQUIRED cell skips
      // the whole row. Nothing aborts the entire import.
      for (let i = 1; i < jsonData.length; i++) {
        const row = jsonData[i];
        if (!row || row.length === 0) continue;

        const code = String(row[colMap.code] ?? "").trim();
        const name = String(row[colMap.name] ?? "").trim();

        if (!code || !name) {
          errors.push(t('products.bulkImport.missingCodeOrName', { row: i + 1 }));
          continue;
        }

        // Optional numeric cell → number | undefined; invalid → row/col error, drop cell.
        const numCell = (idx: number, label: string): number | undefined => {
          if (idx < 0) return undefined;
          const raw = row[idx];
          if (raw === undefined || raw === null || String(raw).trim() === "") return undefined;
          const n = Number(raw);
          if (!Number.isFinite(n)) {
            errors.push(t('products.bulkImport.invalidNumber', { row: i + 1, col: label }));
            return undefined;
          }
          return n;
        };
        const strCell = (idx: number): string | undefined =>
          idx >= 0 && row[idx] != null && String(row[idx]).trim() !== "" ? String(row[idx]).trim() : undefined;

        const measurementType = String(row[colMap.measurementType] ?? "VISUAL").toUpperCase().trim() || "VISUAL";
        if (!MEASUREMENT_TYPES.includes(measurementType)) {
          errors.push(t('products.bulkImport.invalidMeasurementType', { row: i + 1, type: measurementType }));
          continue;
        }

        const posX = numCell(colMap.positionX, "positionX");
        const posY = numCell(colMap.positionY, "positionY");
        if (posX === undefined || posY === undefined) {
          errors.push(t('products.bulkImport.invalidCoordinates', { row: i + 1 }));
          continue;
        }

        // tolerance mode (optional, validated)
        let toleranceMode: ParsedPoint["toleranceMode"];
        const tolModeRaw = strCell(colMap.toleranceMode)?.toLowerCase();
        if (tolModeRaw) {
          if (TOLERANCE_MODES.includes(tolModeRaw)) toleranceMode = tolModeRaw as any;
          else errors.push(t('products.bulkImport.invalidToleranceMode', { row: i + 1, mode: tolModeRaw }));
        }
        // shape (optional, validated)
        let shape: ParsedPoint["shape"];
        const shapeRaw = strCell(colMap.shape)?.toLowerCase();
        if (shapeRaw) {
          if (POINT_SHAPES.includes(shapeRaw)) shape = shapeRaw as ParsedPoint["shape"];
          else errors.push(t('products.bulkImport.invalidShape', { row: i + 1, shape: shapeRaw }));
        }

        points.push({
          code,
          name,
          description: strCell(colMap.description),
          measurementType: measurementType as any,
          measurementTypeCode: strCell(colMap.measurementTypeCode),
          unit: strCell(colMap.unit),
          lowerLimit: numCell(colMap.lowerLimit, "lowerLimit"),
          upperLimit: numCell(colMap.upperLimit, "upperLimit"),
          nominalValue: numCell(colMap.nominalValue, "nominalValue"),
          toleranceMode,
          tolPlus: numCell(colMap.tolPlus, "tolPlus"),
          tolMinus: numCell(colMap.tolMinus, "tolMinus"),
          positionX: posX,
          positionY: posY,
          radius: numCell(colMap.radius, "radius") ?? 20,
          cropWidth: numCell(colMap.cropWidth, "cropWidth") ?? 100,
          cropHeight: numCell(colMap.cropHeight, "cropHeight") ?? 100,
          orderIndex: numCell(colMap.orderIndex, "orderIndex") ?? i,
          shape,
          heightMin: numCell(colMap.heightMin, "heightMin"),
          heightMax: numCell(colMap.heightMax, "heightMax"),
          heightNominal: numCell(colMap.heightNominal, "heightNominal"),
          volumeMin: numCell(colMap.volumeMin, "volumeMin"),
          volumeMax: numCell(colMap.volumeMax, "volumeMax"),
          volumeNominal: numCell(colMap.volumeNominal, "volumeNominal"),
          areaMin: numCell(colMap.areaMin, "areaMin"),
          areaMax: numCell(colMap.areaMax, "areaMax"),
          coplanarityMax: numCell(colMap.coplanarityMax, "coplanarityMax"),
          componentCode: strCell(colMap.componentCode),
          refDesignator: strCell(colMap.refDesignator),
        });
      }

      setParseErrors(errors);
      setParsedPoints(points);
    } catch (error: any) {
      setParseErrors([t('products.bulkImport.readError', { message: error.message })]);
      setParsedPoints([]);
    }
  };

  const handleImport = () => {
    if (parsedPoints.length === 0) {
      toast.error(t('products.bulkImport.noValidPoints'));
      return;
    }

    setIsImporting(true);
    bulkImportMutation.mutate({
      productModelId,
      points: parsedPoints,
    });
  };

  const downloadTemplate = () => {
    // Doc 31 MP7 — deep template: current schema (tolerance v2 + shape + 3D/solder
    // + measurementTypeCode + component linkage). Every column past positionY is
    // optional; a legacy sheet with only the first columns still imports.
    const header = [
      "code", "name", "description", "measurementType", "measurementTypeCode", "unit",
      "lowerLimit", "upperLimit", "nominalValue", "toleranceMode", "tolPlus", "tolMinus",
      "positionX", "positionY", "radius", "cropWidth", "cropHeight", "orderIndex", "shape",
      "heightMin", "heightMax", "heightNominal", "volumeMin", "volumeMax", "volumeNominal",
      "areaMin", "areaMax", "coplanarityMax", "componentCode", "refDesignator",
    ];
    const templateData = [
      header,
      // bilateral tolerance dimension point
      ["MP-001", "Điểm đo 1", "Đo kích thước", "DIMENSION", "DIM_LINEAR", "mm",
        "", "", 10, "bilateral", 0.2, 0.1,
        100, 150, 20, 100, 100, 1, "circle",
        "", "", "", "", "", "",
        "", "", "", "C-0402-10K", "R12"],
      // SPI/AXI 3D solder point (height/volume/coplanarity windows)
      ["MP-002", "Solder Q3", "Kiểm tra hàn 3D", "SURFACE", "SOLDER_VOLUME", "%",
        "", "", "", "range", "", "",
        200, 250, 25, 120, 120, 2, "rect",
        0.05, 0.35, 0.2, 60, 140, 100,
        "", "", 0.1, "U-QFN48-MCU", "U3"],
      // legacy visual point (only core columns filled)
      ["MP-003", "Điểm đo 3", "Kiểm tra visual", "VISUAL", "", "",
        "", "", "", "", "", "",
        300, 320, 20, 100, 100, 3, "",
        "", "", "", "", "", "",
        "", "", "", "", ""],
    ];

    const ws = XLSX.utils.aoa_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, "measurement_points_template.xlsx");
    toast.success(t('products.bulkImport.templateDownloaded'));
  };

  const resetDialog = () => {
    setFile(null);
    setParsedPoints([]);
    setParseErrors([]);
    setImportResult(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleClose = () => {
    resetDialog();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            {t('products.bulkImport.title')}
          </DialogTitle>
          <DialogDescription>
            {t('products.bulkImport.description', { name: productModelName })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-auto space-y-4">
          {/* Template Download */}
          <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
            <div className="text-sm">
              <p className="font-medium">{t('products.bulkImport.downloadTemplate')}</p>
              <p className="text-muted-foreground">{t('products.bulkImport.templateDescription')}</p>
            </div>
            <Button variant="outline" size="sm" onClick={downloadTemplate}>
              <Download className="h-4 w-4 mr-2" />
              Template
            </Button>
          </div>

          {/* File Upload */}
          <div className="border-2 border-dashed rounded-lg p-6 text-center">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileChange}
              className="hidden"
              id="excel-upload"
            />
            <label htmlFor="excel-upload" className="cursor-pointer">
              <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm font-medium">
                {file ? file.name : t('products.bulkImport.selectFile')}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {t('products.bulkImport.supportedFormats')}
              </p>
            </label>
          </div>

          {/* Parse Errors */}
          {parseErrors.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>{t('products.bulkImport.readErrors')}</AlertTitle>
              <AlertDescription>
                <ul className="list-disc list-inside mt-2 text-sm">
                  {parseErrors.slice(0, 10).map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                  {parseErrors.length > 10 && (
                    <li>... {t('products.bulkImport.andMoreErrors', { count: parseErrors.length - 10 })}</li>
                  )}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* Parsed Points Preview */}
          {parsedPoints.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium">
                  {t('products.bulkImport.preview', { count: parsedPoints.length })}
                </h4>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{parsedPoints.length} {t('products.bulkImport.points')}</Badge>
                  {parseErrors.length > 0 && (
                    <Badge variant="destructive">
                      {t('products.bulkImport.rowsWithIssues', { count: parseErrors.length })}
                    </Badge>
                  )}
                </div>
              </div>
              <ScrollArea className="h-48 border rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="p-2 text-left">Code</th>
                      <th className="p-2 text-left">{t('products.bulkImport.colType')}</th>
                      <th className="p-2 text-center">X</th>
                      <th className="p-2 text-center">Y</th>
                      <th className="p-2 text-left">{t('products.bulkImport.colLimits', 'Limits / Tol')}</th>
                      <th className="p-2 text-center">3D</th>
                      <th className="p-2 text-left">{t('products.refDesignator', 'RefDes')} / {t('products.componentCode', 'Component')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedPoints.map((point, i) => {
                      const limits = point.toleranceMode
                        ? `${point.toleranceMode}${point.nominalValue != null ? ` @${point.nominalValue}` : ""}${point.tolPlus != null ? ` +${point.tolPlus}` : ""}${point.tolMinus != null ? `/-${point.tolMinus}` : ""}`
                        : [point.lowerLimit, point.upperLimit].some(v => v != null)
                          ? `${point.lowerLimit ?? "…"} – ${point.upperLimit ?? "…"}`
                          : "—";
                      const has3d = [point.heightMin, point.heightMax, point.volumeMin, point.volumeMax, point.areaMin, point.areaMax, point.coplanarityMax].some(v => v != null);
                      return (
                        <tr key={i} className="border-t">
                          <td className="p-2 font-mono text-xs" title={point.name}>{point.code}</td>
                          <td className="p-2">
                            <Badge variant="outline" className="text-xs">{point.measurementTypeCode ?? point.measurementType}</Badge>
                          </td>
                          <td className="p-2 text-center">{point.positionX}</td>
                          <td className="p-2 text-center">{point.positionY}</td>
                          <td className="p-2 text-xs">{limits}</td>
                          <td className="p-2 text-center">{has3d ? "✓" : "—"}</td>
                          <td className="p-2 font-mono text-xs text-muted-foreground">
                            {[point.refDesignator, point.componentCode].filter(Boolean).join(" · ") || "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </ScrollArea>
            </div>
          )}

          {/* Import Result */}
          {importResult && (
            <Alert variant={importResult.failed > 0 ? "destructive" : "default"}>
              {importResult.failed > 0 ? (
                <XCircle className="h-4 w-4" />
              ) : (
                <CheckCircle className="h-4 w-4" />
              )}
              <AlertTitle>{t('products.bulkImport.importResult')}</AlertTitle>
              <AlertDescription>
                <div className="flex gap-4 mt-2 flex-wrap">
                  <span className="text-emerald-600">✓ {t('products.bulkImport.successCount')}: {importResult.success}</span>
                  {importResult.failed > 0 && (
                    <span className="text-red-600">✗ {t('products.bulkImport.failedCount')}: {importResult.failed}</span>
                  )}
                  {!!importResult.skipped && importResult.skipped > 0 && (
                    <span className="text-amber-600">⚠ {t('products.bulkImport.skippedCount')}: {importResult.skipped}</span>
                  )}
                </div>
                {importResult.errors.length > 0 && (
                  <ul className="list-disc list-inside mt-2 text-sm">
                    {importResult.errors.slice(0, 8).map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                )}
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose}>
            {t('common.close')}
          </Button>
          <Button 
            onClick={handleImport} 
            disabled={parsedPoints.length === 0 || isImporting}
          >
            {isImporting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {t('products.bulkImport.importing')}
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                {t('products.bulkImport.importCount', { count: parsedPoints.length })}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
