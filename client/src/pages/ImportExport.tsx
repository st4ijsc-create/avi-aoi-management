import { useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Upload, Download, FileSpreadsheet, AlertCircle, CheckCircle2, Calendar } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { navItems } from '@/lib/navigation';
import * as XLSX from 'xlsx';

export default function ImportExport() {
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importResult, setImportResult] = useState<{ success: number; failed: number; errors: string[] } | null>(null);
  const [exportDateRange, setExportDateRange] = useState<'7d' | '30d' | '90d'>('30d');
  
  const importFactories = trpc.import.importFactories.useMutation();
  const importWorkshops = trpc.import.importWorkshops.useMutation();
  const importMachines = trpc.import.importMachines.useMutation();
  const exportInspections = trpc.export.exportInspections.useMutation();
  const exportStatistics = trpc.export.exportStatistics.useMutation();

  const handleFileUpload = async (file: File, type: 'factories' | 'workshops' | 'machines') => {
    setImporting(true);
    setImportResult(null);
    
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      if (jsonData.length === 0) {
        toast.error('File Excel trống hoặc không đúng định dạng');
        return;
      }

      let result;
      if (type === 'factories') {
        result = await importFactories.mutateAsync({ data: jsonData as any });
      } else if (type === 'workshops') {
        result = await importWorkshops.mutateAsync({ data: jsonData as any });
      } else {
        result = await importMachines.mutateAsync({ data: jsonData as any });
      }

      setImportResult(result);
      
      if (result.failed === 0) {
        toast.success(`Import thành công ${result.success} ${type}`);
      } else {
        toast.warning(`Import hoàn tất: ${result.success} thành công, ${result.failed} thất bại`);
      }
    } catch (error: any) {
      toast.error(`Import thất bại: ${error.message}`);
      setImportResult({ success: 0, failed: 0, errors: [error.message] });
    } finally {
      setImporting(false);
    }
  };

  const downloadTemplate = (type: 'factories' | 'workshops' | 'machines') => {
    let template: any[] = [];
    if (type === 'factories') {
      template = [
        { 
          code: 'FAC001', 
          name: 'Nhà máy 1', 
          description: 'Mô tả nhà máy', 
          address: '123 Đường ABC', 
          region: 'Miền Nam', 
          country: 'Việt Nam', 
          isActive: true 
        }
      ];
    } else if (type === 'workshops') {
      template = [
        { 
          factoryCode: 'FAC001', 
          code: 'WS001', 
          name: 'Xưởng 1', 
          description: 'Mô tả xưởng', 
          isActive: true 
        }
      ];
    } else {
      template = [
        { 
          stationCode: 'ST001', 
          code: 'MCH001', 
          name: 'Máy 1', 
          machineType: 'AVI', 
          model: 'Model ABC', 
          manufacturer: 'Manufacturer XYZ', 
          isActive: true 
        }
      ];
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(template);
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, `${type}_template.xlsx`);
    
    toast.success(`Đã tải template ${type}`);
  };

  const handleExportInspections = async () => {
    setExporting(true);
    try {
      const startDate = new Date();
      if (exportDateRange === '7d') startDate.setDate(startDate.getDate() - 7);
      else if (exportDateRange === '30d') startDate.setDate(startDate.getDate() - 30);
      else startDate.setDate(startDate.getDate() - 90);

      const result = await exportInspections.mutateAsync({
        startDate,
        endDate: new Date(),
      });
      
      window.open(result.url, '_blank');
      toast.success(`Đã export ${result.count} inspection records`);
    } catch (error: any) {
      toast.error(`Export thất bại: ${error.message}`);
    } finally {
      setExporting(false);
    }
  };

  const handleExportStatistics = async () => {
    setExporting(true);
    try {
      const startDate = new Date();
      if (exportDateRange === '7d') startDate.setDate(startDate.getDate() - 7);
      else if (exportDateRange === '30d') startDate.setDate(startDate.getDate() - 30);
      else startDate.setDate(startDate.getDate() - 90);

      const result = await exportStatistics.mutateAsync({
        startDate,
        endDate: new Date(),
      });
      
      window.open(result.url, '_blank');
      toast.success('Đã export statistics');
    } catch (error: any) {
      toast.error(`Export thất bại: ${error.message}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <DashboardLayout
      title="Import/Export Data"
      navItems={navItems}
      currentPath="/import-export"
    >
      <div className="space-y-6">
        {/* Import Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Import Data
            </CardTitle>
            <CardDescription>Upload Excel files để import hàng loạt factories, workshops, hoặc machines</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Factories */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Factories (Nhà máy)</h3>
                <Button variant="outline" size="sm" onClick={() => downloadTemplate('factories')}>
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  Tải template
                </Button>
              </div>
              <div className="flex items-center gap-4">
                <Input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileUpload(file, 'factories');
                  }}
                  disabled={importing}
                  className="flex-1"
                />
                <Badge variant="secondary">Code, Name, Description, Address, Region, Country</Badge>
              </div>
            </div>

            {/* Workshops */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Workshops (Xưởng)</h3>
                <Button variant="outline" size="sm" onClick={() => downloadTemplate('workshops')}>
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  Tải template
                </Button>
              </div>
              <div className="flex items-center gap-4">
                <Input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileUpload(file, 'workshops');
                  }}
                  disabled={importing}
                  className="flex-1"
                />
                <Badge variant="secondary">FactoryCode, Code, Name, Description</Badge>
              </div>
            </div>

            {/* Machines */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Machines (Máy)</h3>
                <Button variant="outline" size="sm" onClick={() => downloadTemplate('machines')}>
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  Tải template
                </Button>
              </div>
              <div className="flex items-center gap-4">
                <Input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileUpload(file, 'machines');
                  }}
                  disabled={importing}
                  className="flex-1"
                />
                <Badge variant="secondary">StationCode, Code, Name, MachineType (AVI/AOI/AUTOMATION)</Badge>
              </div>
            </div>

            {/* Import Result */}
            {importResult && (
              <Alert variant={importResult.failed > 0 ? "destructive" : "default"}>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <div className="space-y-2">
                    <div className="flex items-center gap-4">
                      <span className="flex items-center gap-1">
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                        Thành công: {importResult.success}
                      </span>
                      {importResult.failed > 0 && (
                        <span className="flex items-center gap-1">
                          <AlertCircle className="h-4 w-4 text-red-500" />
                          Thất bại: {importResult.failed}
                        </span>
                      )}
                    </div>
                    {importResult.errors.length > 0 && (
                      <div className="mt-2">
                        <p className="font-semibold text-sm">Errors:</p>
                        <ul className="list-disc list-inside text-xs space-y-1 max-h-40 overflow-y-auto">
                          {importResult.errors.slice(0, 10).map((err, idx) => (
                            <li key={idx}>{err}</li>
                          ))}
                          {importResult.errors.length > 10 && (
                            <li>... và {importResult.errors.length - 10} lỗi khác</li>
                          )}
                        </ul>
                      </div>
                    )}
                  </div>
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* Export Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              Export Data
            </CardTitle>
            <CardDescription>Export inspection data và statistics sang Excel</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <Select value={exportDateRange} onValueChange={(v) => setExportDateRange(v as any)}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7d">7 ngày qua</SelectItem>
                  <SelectItem value="30d">30 ngày qua</SelectItem>
                  <SelectItem value="90d">90 ngày qua</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Button
                onClick={handleExportInspections}
                disabled={exporting}
                className="w-full"
              >
                <Download className="h-4 w-4 mr-2" />
                Export Inspections
              </Button>

              <Button
                onClick={handleExportStatistics}
                disabled={exporting}
                variant="outline"
                className="w-full"
              >
                <Download className="h-4 w-4 mr-2" />
                Export Statistics
              </Button>
            </div>

            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Export sẽ tạo file Excel và upload lên S3. File sẽ tự động mở trong tab mới.
                Max 10,000 records cho Inspections export.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
