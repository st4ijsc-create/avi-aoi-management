import { useState, useRef } from "react";
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
  unit?: string;
  lowerLimit?: number;
  upperLimit?: number;
  nominalValue?: number;
  positionX: number;
  positionY: number;
  radius: number;
  cropWidth: number;
  cropHeight: number;
  orderIndex: number;
  error?: string;
}

const MEASUREMENT_TYPES = ["DIMENSION", "VISUAL", "ELECTRICAL", "POSITION", "COLOR", "SURFACE", "OTHER"];

export function BulkImportDialog({ 
  open, 
  onOpenChange, 
  productModelId, 
  productModelName,
  onSuccess 
}: BulkImportDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [parsedPoints, setParsedPoints] = useState<ParsedPoint[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ success: number; failed: number; errors: string[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const bulkImportMutation = trpc.bulkImport.measurementPoints.useMutation({
    onSuccess: (result) => {
      setImportResult(result);
      if (result.success > 0) {
        toast.success(`Đã import thành công ${result.success} điểm đo`);
        onSuccess?.();
      }
      if (result.failed > 0) {
        toast.error(`${result.failed} điểm đo import thất bại`);
      }
      setIsImporting(false);
    },
    onError: (error) => {
      toast.error(`Import thất bại: ${error.message}`);
      setIsImporting(false);
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    if (!selectedFile.name.match(/\.(xlsx|xls)$/i)) {
      toast.error("Vui lòng chọn file Excel (.xlsx hoặc .xls)");
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
        setParseErrors(["File Excel không có dữ liệu hoặc thiếu header"]);
        setParsedPoints([]);
        return;
      }

      const headers = jsonData[0].map((h: any) => String(h).toLowerCase().trim());
      const errors: string[] = [];
      const points: ParsedPoint[] = [];

      // Map column indices
      const colMap = {
        code: headers.findIndex(h => h.includes("code") || h.includes("mã")),
        name: headers.findIndex(h => h.includes("name") || h.includes("tên")),
        description: headers.findIndex(h => h.includes("description") || h.includes("mô tả")),
        measurementType: headers.findIndex(h => h.includes("type") || h.includes("loại")),
        unit: headers.findIndex(h => h.includes("unit") || h.includes("đơn vị")),
        lowerLimit: headers.findIndex(h => h.includes("lower") || h.includes("min") || h.includes("dưới")),
        upperLimit: headers.findIndex(h => h.includes("upper") || h.includes("max") || h.includes("trên")),
        nominalValue: headers.findIndex(h => h.includes("nominal") || h.includes("danh định")),
        positionX: headers.findIndex(h => h.includes("posx") || h.includes("x") || h.includes("tọa độ x")),
        positionY: headers.findIndex(h => h.includes("posy") || h.includes("y") || h.includes("tọa độ y")),
        radius: headers.findIndex(h => h.includes("radius") || h.includes("bán kính")),
        cropWidth: headers.findIndex(h => h.includes("cropwidth") || h.includes("width") || h.includes("rộng")),
        cropHeight: headers.findIndex(h => h.includes("cropheight") || h.includes("height") || h.includes("cao")),
        orderIndex: headers.findIndex(h => h.includes("order") || h.includes("thứ tự")),
      };

      // Validate required columns
      if (colMap.code === -1) errors.push("Thiếu cột 'code' hoặc 'mã'");
      if (colMap.name === -1) errors.push("Thiếu cột 'name' hoặc 'tên'");
      if (colMap.positionX === -1) errors.push("Thiếu cột 'posX' hoặc 'x' hoặc 'tọa độ x'");
      if (colMap.positionY === -1) errors.push("Thiếu cột 'posY' hoặc 'y' hoặc 'tọa độ y'");

      if (errors.length > 0) {
        setParseErrors(errors);
        setParsedPoints([]);
        return;
      }

      // Parse data rows
      for (let i = 1; i < jsonData.length; i++) {
        const row = jsonData[i];
        if (!row || row.length === 0) continue;

        const code = String(row[colMap.code] || "").trim();
        const name = String(row[colMap.name] || "").trim();
        
        if (!code || !name) {
          errors.push(`Dòng ${i + 1}: Thiếu code hoặc name`);
          continue;
        }

        const measurementType = String(row[colMap.measurementType] || "VISUAL").toUpperCase().trim();
        if (!MEASUREMENT_TYPES.includes(measurementType)) {
          errors.push(`Dòng ${i + 1}: Loại đo "${measurementType}" không hợp lệ`);
          continue;
        }

        const posX = Number(row[colMap.positionX]);
        const posY = Number(row[colMap.positionY]);

        if (isNaN(posX) || isNaN(posY)) {
          errors.push(`Dòng ${i + 1}: Tọa độ X hoặc Y không hợp lệ`);
          continue;
        }

        points.push({
          code,
          name,
          description: colMap.description >= 0 ? String(row[colMap.description] || "") : undefined,
          measurementType: measurementType as any,
          unit: colMap.unit >= 0 ? String(row[colMap.unit] || "") : undefined,
          lowerLimit: colMap.lowerLimit >= 0 && row[colMap.lowerLimit] ? Number(row[colMap.lowerLimit]) : undefined,
          upperLimit: colMap.upperLimit >= 0 && row[colMap.upperLimit] ? Number(row[colMap.upperLimit]) : undefined,
          nominalValue: colMap.nominalValue >= 0 && row[colMap.nominalValue] ? Number(row[colMap.nominalValue]) : undefined,
          positionX: posX,
          positionY: posY,
          radius: colMap.radius >= 0 && row[colMap.radius] ? Number(row[colMap.radius]) : 20,
          cropWidth: colMap.cropWidth >= 0 && row[colMap.cropWidth] ? Number(row[colMap.cropWidth]) : 100,
          cropHeight: colMap.cropHeight >= 0 && row[colMap.cropHeight] ? Number(row[colMap.cropHeight]) : 100,
          orderIndex: colMap.orderIndex >= 0 && row[colMap.orderIndex] ? Number(row[colMap.orderIndex]) : i,
        });
      }

      setParseErrors(errors);
      setParsedPoints(points);
    } catch (error: any) {
      setParseErrors([`Lỗi đọc file: ${error.message}`]);
      setParsedPoints([]);
    }
  };

  const handleImport = () => {
    if (parsedPoints.length === 0) {
      toast.error("Không có điểm đo hợp lệ để import");
      return;
    }

    setIsImporting(true);
    bulkImportMutation.mutate({
      productModelId,
      points: parsedPoints,
    });
  };

  const downloadTemplate = () => {
    const templateData = [
      ["code", "name", "description", "measurementType", "unit", "lowerLimit", "upperLimit", "nominalValue", "positionX", "positionY", "radius", "cropWidth", "cropHeight", "orderIndex"],
      ["MP-001", "Điểm đo 1", "Mô tả điểm đo", "DIMENSION", "mm", 9.8, 10.2, 10, 100, 150, 20, 100, 100, 1],
      ["MP-002", "Điểm đo 2", "Kiểm tra visual", "VISUAL", "", "", "", "", 200, 250, 25, 120, 120, 2],
    ];

    const ws = XLSX.utils.aoa_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, "measurement_points_template.xlsx");
    toast.success("Đã tải file template");
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
            Import điểm đo từ Excel
          </DialogTitle>
          <DialogDescription>
            Import hàng loạt điểm đo cho sản phẩm <strong>{productModelName}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-auto space-y-4">
          {/* Template Download */}
          <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
            <div className="text-sm">
              <p className="font-medium">Tải file mẫu</p>
              <p className="text-muted-foreground">File Excel với các cột: code, name, positionX, positionY, ...</p>
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
                {file ? file.name : "Chọn file Excel để upload"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Hỗ trợ .xlsx và .xls
              </p>
            </label>
          </div>

          {/* Parse Errors */}
          {parseErrors.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Lỗi khi đọc file</AlertTitle>
              <AlertDescription>
                <ul className="list-disc list-inside mt-2 text-sm">
                  {parseErrors.slice(0, 10).map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                  {parseErrors.length > 10 && (
                    <li>... và {parseErrors.length - 10} lỗi khác</li>
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
                  Xem trước ({parsedPoints.length} điểm đo)
                </h4>
                <Badge variant="secondary">{parsedPoints.length} điểm</Badge>
              </div>
              <ScrollArea className="h-48 border rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="p-2 text-left">Code</th>
                      <th className="p-2 text-left">Tên</th>
                      <th className="p-2 text-left">Loại</th>
                      <th className="p-2 text-center">X</th>
                      <th className="p-2 text-center">Y</th>
                      <th className="p-2 text-center">Crop</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedPoints.map((point, i) => (
                      <tr key={i} className="border-t">
                        <td className="p-2 font-mono text-xs">{point.code}</td>
                        <td className="p-2">{point.name}</td>
                        <td className="p-2">
                          <Badge variant="outline" className="text-xs">{point.measurementType}</Badge>
                        </td>
                        <td className="p-2 text-center">{point.positionX}</td>
                        <td className="p-2 text-center">{point.positionY}</td>
                        <td className="p-2 text-center text-xs">{point.cropWidth}x{point.cropHeight}</td>
                      </tr>
                    ))}
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
              <AlertTitle>Kết quả import</AlertTitle>
              <AlertDescription>
                <div className="flex gap-4 mt-2">
                  <span className="text-emerald-600">✓ Thành công: {importResult.success}</span>
                  {importResult.failed > 0 && (
                    <span className="text-red-600">✗ Thất bại: {importResult.failed}</span>
                  )}
                </div>
                {importResult.errors.length > 0 && (
                  <ul className="list-disc list-inside mt-2 text-sm">
                    {importResult.errors.slice(0, 5).map((err, i) => (
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
            Đóng
          </Button>
          <Button 
            onClick={handleImport} 
            disabled={parsedPoints.length === 0 || isImporting}
          >
            {isImporting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Đang import...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                Import {parsedPoints.length} điểm đo
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
