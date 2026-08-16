import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Upload, Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import * as XLSX from "xlsx";

interface ExcelImportExportProps {
  entityType: string;
  templateData: Record<string, any>[];
  templateFilename: string;
  onImport: (data: any[], replaceIfExists: boolean) => Promise<{ success: number; failed: number; errors: string[] }>;
  onExport: () => Promise<{ url: string; filename: string; count: number }>;
  onImportComplete?: () => void;
}

export function ExcelImportExport({
  entityType,
  templateData,
  templateFilename,
  onImport,
  onExport,
  onImportComplete,
}: ExcelImportExportProps) {
  const { t } = useTranslation();
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [replaceIfExists, setReplaceIfExists] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  const handleImport = async () => {
    if (!selectedFile) return;
    setImporting(true);

    try {
      const data = await selectedFile.arrayBuffer();
      const workbook = XLSX.read(data);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      if (jsonData.length === 0) {
        toast.error("File không có dữ liệu");
        return;
      }

      const result = await onImport(jsonData, replaceIfExists);

      if (result.failed === 0) {
        toast.success(`Import thành công ${result.success} ${entityType}`);
      } else {
        toast.warning(`Import: ${result.success} thành công, ${result.failed} lỗi`);
        if (result.errors.length > 0) {
          console.warn("Import errors:", result.errors);
        }
      }

      setImportDialogOpen(false);
      setSelectedFile(null);
      setReplaceIfExists(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      onImportComplete?.();
    } catch (error: any) {
      toast.error(`Import lỗi: ${error.message}`);
    } finally {
      setImporting(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const result = await onExport();
      window.open(result.url, "_blank");
      toast.success(`Xuất Excel thành công: ${result.count} ${entityType}`);
    } catch (error: any) {
      toast.error(`Xuất lỗi: ${error.message}`);
    } finally {
      setExporting(false);
    }
  };

  const handleDownloadTemplate = () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(templateData);
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, templateFilename);
    toast.success("Đã tải template mẫu");
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1">
            <FileSpreadsheet className="h-4 w-4" />
            Excel
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setImportDialogOpen(true)}>
            <Upload className="h-4 w-4 mr-2" />
            Import từ Excel
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleExport} disabled={exporting}>
            {exporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
            Export ra Excel
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleDownloadTemplate}>
            <FileSpreadsheet className="h-4 w-4 mr-2" />
            Tải template mẫu
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={importDialogOpen} onOpenChange={(open) => {
        setImportDialogOpen(open);
        if (!open) {
          setSelectedFile(null);
          setReplaceIfExists(false);
          if (fileInputRef.current) fileInputRef.current.value = "";
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import {entityType} từ Excel</DialogTitle>
            <DialogDescription>{t("excelIo.chonFileExcelXlsxDe", "Chọn file Excel (.xlsx) để import dữ liệu. Tải template mẫu nếu cần.")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{t("excelIo.chonFileExcel", "Chọn file Excel")}</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileSelect}
                className="block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer"
              />
            </div>
            {selectedFile && (
              <p className="text-sm text-muted-foreground">
                File: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
              </p>
            )}
            <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/50">
              <Switch
                id="replaceIfExists"
                checked={replaceIfExists}
                onCheckedChange={setReplaceIfExists}
              />
              <div>
                <Label htmlFor="replaceIfExists" className="font-medium cursor-pointer">
                  Ghi đè nếu trùng mã (code)
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {replaceIfExists
                    ? "Dữ liệu trùng mã sẽ được CẬP NHẬT với thông tin từ file"
                    : "Dữ liệu trùng mã sẽ được BỎ QUA (giữ nguyên dữ liệu cũ)"}
                </p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleDownloadTemplate}>
              <FileSpreadsheet className="h-4 w-4 mr-2" />
              Tải template
            </Button>
            <Button
              onClick={handleImport}
              disabled={!selectedFile || importing}
            >
              {importing && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              <Upload className="h-4 w-4 mr-2" />
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
