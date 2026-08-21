import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '@/components/DashboardLayout';
import { PageContainer } from '@/components/patterns';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Upload, Download, FileSpreadsheet, AlertCircle, CheckCircle2, Calendar, Package, Cpu, Ruler, Building2, Factory } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { navItems } from '@/lib/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import * as XLSX from 'xlsx';
import { mapTrpcError } from "@/lib/trpcErrors";

export function ImportExportContent() {
  const { t } = useTranslation();
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importResult, setImportResult] = useState<{ success: number; failed: number; errors: string[] } | null>(null);
  const [exportDateRange, setExportDateRange] = useState<'7d' | '30d' | '90d'>('30d');
  
  // Import mutations
  const importFactories = trpc.import.importFactories.useMutation();
  const importWorkshops = trpc.import.importWorkshops.useMutation();
  const importMachines = trpc.import.importMachines.useMutation();
  const importProducts = trpc.import.importProducts.useMutation();
  const importMeasurementPoints = trpc.import.importMeasurementPoints.useMutation();
  
  // Export mutations
  const exportInspections = trpc.export.exportInspections.useMutation();
  const exportStatistics = trpc.export.exportStatistics.useMutation();
  const exportProducts = trpc.export.exportProducts.useMutation();
  const exportMachines = trpc.export.exportMachines.useMutation();
  const exportMeasurementPoints = trpc.export.exportMeasurementPoints.useMutation();
  const exportFactories = trpc.export.exportFactories.useMutation();
  const exportWorkshops = trpc.export.exportWorkshops.useMutation();

  const handleFileUpload = async (file: File, type: 'factories' | 'workshops' | 'machines' | 'products' | 'measurementPoints') => {
    setImporting(true);
    setImportResult(null);
    
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      if (jsonData.length === 0) {
        toast.error(t('importExport.emptyFile'));
        return;
      }

      let result;
      if (type === 'factories') {
        result = await importFactories.mutateAsync({ data: jsonData as any });
      } else if (type === 'workshops') {
        result = await importWorkshops.mutateAsync({ data: jsonData as any });
      } else if (type === 'machines') {
        result = await importMachines.mutateAsync({ data: jsonData as any });
      } else if (type === 'products') {
        result = await importProducts.mutateAsync({ data: jsonData as any });
      } else {
        result = await importMeasurementPoints.mutateAsync({ data: jsonData as any });
      }

      setImportResult(result);
      
      if (result.failed === 0) {
        toast.success(t('importExport.importSuccess', { count: result.success, type }));
      } else {
        toast.warning(t('importExport.importPartial', { success: result.success, failed: result.failed }));
      }
    } catch (error: any) {
      toast.error(t('importExport.importFailed', { message: mapTrpcError(error) }));
      setImportResult({ success: 0, failed: 0, errors: [mapTrpcError(error)] });
    } finally {
      setImporting(false);
    }
  };

  const downloadTemplate = (type: 'factories' | 'workshops' | 'machines' | 'products' | 'measurementPoints') => {
    let template: any[] = [];
    if (type === 'factories') {
      template = [
        { 
          code: 'FAC001', 
          name: t("importExport.nhaMay1", "Nhà máy 1"), 
          description: t("importExport.moTaNhaMay", "Mô tả nhà máy"), 
          address: t("importExport.123DuongAbc", "123 Đường ABC"), 
          region: t("importExport.mienNam", "Miền Nam"), 
          country: t("importExport.vietNam", "Việt Nam"), 
          isActive: true 
        }
      ];
    } else if (type === 'workshops') {
      template = [
        { 
          factoryCode: 'FAC001', 
          code: 'WS001', 
          name: t("importExport.xuong1", "Xưởng 1"), 
          description: t("importExport.moTaXuong", "Mô tả xưởng"), 
          isActive: true 
        }
      ];
    } else if (type === 'machines') {
      template = [
        { 
          stationCode: 'ST001', 
          code: 'MCH001', 
          name: t("importExport.may1", "Máy 1"), 
          machineType: 'AVI', 
          model: 'Model ABC', 
          manufacturer: 'Manufacturer XYZ', 
          isActive: true 
        }
      ];
    } else if (type === 'products') {
      template = [
        { 
          code: 'PRD001', 
          name: t("importExport.sanPham1", "Sản phẩm 1"), 
          description: t("importExport.moTaSanPham", "Mô tả sản phẩm"), 
          category: 'Category A', 
          isActive: true 
        }
      ];
    } else {
      template = [
        { 
          productModelCode: 'PRD001', 
          code: 'MP001', 
          name: t("importExport.diemDo1", "Điểm đo 1"), 
          measurementType: 'DIMENSION', 
          unit: 'mm', 
          nominalValue: 10.5, 
          upperLimit: 11.0, 
          lowerLimit: 10.0, 
          isActive: true 
        }
      ];
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(template);
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, `${type}_template.xlsx`);
    
    toast.success(t('importExport.templateDownloaded', { type }));
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
      toast.success(t('importExport.exportSuccess', { count: result.count, type: 'inspection records' }));
    } catch (error: any) {
      toast.error(t('importExport.exportFailed', { message: mapTrpcError(error) }));
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
      toast.success(t('importExport.statisticsExported'));
    } catch (error: any) {
      toast.error(t('importExport.exportFailed', { message: mapTrpcError(error) }));
    } finally {
      setExporting(false);
    }
  };

  const handleExportMasterData = async (type: 'products' | 'machines' | 'measurementPoints' | 'factories' | 'workshops') => {
    setExporting(true);
    try {
      let result;
      if (type === 'products') {
        result = await exportProducts.mutateAsync();
      } else if (type === 'machines') {
        result = await exportMachines.mutateAsync();
      } else if (type === 'measurementPoints') {
        result = await exportMeasurementPoints.mutateAsync({});
      } else if (type === 'factories') {
        result = await exportFactories.mutateAsync();
      } else {
        result = await exportWorkshops.mutateAsync();
      }
      
      window.open(result.url, '_blank');
      toast.success(t('importExport.exportSuccess', { count: result.count, type }));
    } catch (error: any) {
      toast.error(t('importExport.exportFailed', { message: mapTrpcError(error) }));
    } finally {
      setExporting(false);
    }
  };

  return (
      <Tabs defaultValue="import" className="space-y-6">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="import" className="flex items-center gap-2">
            <Upload className="h-4 w-4" />
            {t('importExport.importData')}
          </TabsTrigger>
          <TabsTrigger value="export" className="flex items-center gap-2">
            <Download className="h-4 w-4" />
            {t('importExport.exportData')}
          </TabsTrigger>
        </TabsList>

        {/* Import Tab */}
        <TabsContent value="import" className="space-y-6">
          {/* Organization Data */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                {t('importExport.orgData')}
              </CardTitle>
              <CardDescription>{t('importExport.orgDataDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Factories */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold flex items-center gap-2">
                    <Factory className="h-4 w-4" />
                    Factories ({t('importExport.factories')})
                  </h3>
                  <Button variant="outline" size="sm" onClick={() => downloadTemplate('factories')}>
                    <FileSpreadsheet className="h-4 w-4 mr-2" />
                    {t('importExport.downloadTemplate')}
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
                  <h3 className="font-semibold">Workshops ({t('importExport.workshops')})</h3>
                  <Button variant="outline" size="sm" onClick={() => downloadTemplate('workshops')}>
                    <FileSpreadsheet className="h-4 w-4 mr-2" />
                    {t('importExport.downloadTemplate')}
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
                  <h3 className="font-semibold flex items-center gap-2">
                    <Cpu className="h-4 w-4" />
                    Machines ({t('importExport.machines')})
                  </h3>
                  <Button variant="outline" size="sm" onClick={() => downloadTemplate('machines')}>
                    <FileSpreadsheet className="h-4 w-4 mr-2" />
                    {t('importExport.downloadTemplate')}
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
            </CardContent>
          </Card>

          {/* Product Data */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                {t('importExport.productData')}
              </CardTitle>
              <CardDescription>{t('importExport.productDataDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Products */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold flex items-center gap-2">
                    <Package className="h-4 w-4" />
                    Products ({t('importExport.products')})
                  </h3>
                  <Button variant="outline" size="sm" onClick={() => downloadTemplate('products')}>
                    <FileSpreadsheet className="h-4 w-4 mr-2" />
                    {t('importExport.downloadTemplate')}
                  </Button>
                </div>
                <div className="flex items-center gap-4">
                  <Input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileUpload(file, 'products');
                    }}
                    disabled={importing}
                    className="flex-1"
                  />
                  <Badge variant="secondary">Code, Name, Description, Category</Badge>
                </div>
              </div>

              {/* Measurement Points */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold flex items-center gap-2">
                    <Ruler className="h-4 w-4" />
                    Measurement Points ({t('importExport.measurementPoints')})
                  </h3>
                  <Button variant="outline" size="sm" onClick={() => downloadTemplate('measurementPoints')}>
                    <FileSpreadsheet className="h-4 w-4 mr-2" />
                    {t('importExport.downloadTemplate')}
                  </Button>
                </div>
                <div className="flex items-center gap-4">
                  <Input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileUpload(file, 'measurementPoints');
                    }}
                    disabled={importing}
                    className="flex-1"
                  />
                  <Badge variant="secondary">ProductModelCode, Code, Name, MeasurementType, Unit, Limits</Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Import Result */}
          {importResult && (
            <Alert variant={importResult.failed > 0 ? "destructive" : "default"}>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <div className="space-y-2">
                  <div className="flex items-center gap-4">
                    <span className="flex items-center gap-1">
                      <CheckCircle2 className="h-4 w-4 text-success" />
                      {t('importExport.successCount')}: {importResult.success}
                    </span>
                    {importResult.failed > 0 && (
                      <span className="flex items-center gap-1">
                        <AlertCircle className="h-4 w-4 text-destructive" />
                        {t('importExport.failedCount')}: {importResult.failed}
                      </span>
                    )}
                  </div>
                  {importResult.errors.length > 0 && (
                    <div className="mt-2">
                      <p className="font-semibold text-sm">{t('importExport.errorsLabel')}</p>
                      <ul className="list-disc list-inside text-xs space-y-1 max-h-40 overflow-y-auto">
                        {importResult.errors.slice(0, 10).map((err, idx) => (
                          <li key={idx}>{err}</li>
                        ))}
                        {importResult.errors.length > 10 && (
                          <li>... {t('importExport.andMoreErrors', { count: importResult.errors.length - 10 })}</li>
                        )}
                      </ul>
                    </div>
                  )}
                </div>
              </AlertDescription>
            </Alert>
          )}
        </TabsContent>

        {/* Export Tab */}
        <TabsContent value="export" className="space-y-6">
          {/* Inspection Data Export */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Download className="h-5 w-5" />
                {t('importExport.exportInspectionData')}
              </CardTitle>
              <CardDescription>{t('importExport.exportInspectionDataDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <Select value={exportDateRange} onValueChange={(v) => setExportDateRange(v as any)}>
                  <SelectTrigger className="w-50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7d">{t('importExport.last7days')}</SelectItem>
                    <SelectItem value="30d">{t('importExport.last30days')}</SelectItem>
                    <SelectItem value="90d">{t('importExport.last90days')}</SelectItem>
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
                  {t('importExport.exportInspections')}
                </Button>

                <Button
                  onClick={handleExportStatistics}
                  disabled={exporting}
                  variant="outline"
                  className="w-full"
                >
                  <Download className="h-4 w-4 mr-2" />
                  {t('importExport.exportStatistics')}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Master Data Export */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5" />
                {t('importExport.exportMasterData')}
              </CardTitle>
              <CardDescription>{t('importExport.exportMasterDataDesc')}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <Button
                  onClick={() => handleExportMasterData('factories')}
                  disabled={exporting}
                  variant="outline"
                  className="w-full"
                >
                  <Factory className="h-4 w-4 mr-2" />
                  {t('importExport.exportFactories')}
                </Button>

                <Button
                  onClick={() => handleExportMasterData('workshops')}
                  disabled={exporting}
                  variant="outline"
                  className="w-full"
                >
                  <Building2 className="h-4 w-4 mr-2" />
                  {t('importExport.exportWorkshops')}
                </Button>

                <Button
                  onClick={() => handleExportMasterData('machines')}
                  disabled={exporting}
                  variant="outline"
                  className="w-full"
                >
                  <Cpu className="h-4 w-4 mr-2" />
                  {t('importExport.exportMachines')}
                </Button>

                <Button
                  onClick={() => handleExportMasterData('products')}
                  disabled={exporting}
                  variant="outline"
                  className="w-full"
                >
                  <Package className="h-4 w-4 mr-2" />
                  {t('importExport.exportProducts')}
                </Button>

                <Button
                  onClick={() => handleExportMasterData('measurementPoints')}
                  disabled={exporting}
                  variant="outline"
                  className="w-full"
                >
                  <Ruler className="h-4 w-4 mr-2" />
                  {t('importExport.exportMeasurementPoints')}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {t('importExport.exportNote')}
            </AlertDescription>
          </Alert>
        </TabsContent>
      </Tabs>
  );
}

export default function ImportExport() {
  const { t } = useTranslation();
  return (
    <DashboardLayout
      title={t('importExport.title')}
      navItems={navItems}
      currentPath="/import-export"
    >
      <PageContainer>
        <ImportExportContent />
      </PageContainer>
    </DashboardLayout>
  );
}
