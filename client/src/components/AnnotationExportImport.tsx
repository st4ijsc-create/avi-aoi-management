import { useState, useRef } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import {
  Download,
  Upload,
  FileJson,
  FileSpreadsheet,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
  Loader2,
  Eye,
  FileText,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

interface ExportOptions {
  format: 'json' | 'csv';
  machineId?: number;
  productModelId?: number;
  dateFrom?: string;
  dateTo?: string;
}

interface ImportResult {
  success: boolean;
  imported: number;
  skipped: number;
  errors: string[];
}

export function AnnotationExportImport() {

  const fileInputRef = useRef<HTMLInputElement>(null);
  const { t } = useTranslation();
  
  // Export state
  const [exportOptions, setExportOptions] = useState<ExportOptions>({
    format: 'json',
  });
  const [isExporting, setIsExporting] = useState(false);
  
  // Import state
  const [importData, setImportData] = useState('');
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [previewData, setPreviewData] = useState<any[]>([]);

  // Fetch machines for filter
  const { data: machines } = trpc.machine.list.useQuery();
  
  // Fetch product models for filter
  const { data: productModels } = trpc.productModel.list.useQuery();

  // Export mutation
  const exportMutation = trpc.annotation.export.useMutation({
    onSuccess: (data) => {
      // Create download
      const blob = new Blob([data.data], { 
        type: data.format === 'json' ? 'application/json' : 'text/csv' 
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = data.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      toast.success(t('annotation.exportSuccess', { count: data.count }));
      setIsExporting(false);
    },
    onError: (error) => {
      toast.error(`${t('annotation.exportFailed')}: ${error.message}`);
      setIsExporting(false);
    },
  });

  // Import mutation
  const importMutation = trpc.annotation.import.useMutation({
    onSuccess: (data) => {
      setImportResult(data);
      setIsImporting(false);
      
      if (data.success) {
        toast.success(t('annotation.importSuccess', { imported: data.imported, skipped: data.skipped }));
      }
    },
    onError: (error) => {
      toast.error(`${t('annotation.importFailed')}: ${error.message}`);
      setIsImporting(false);
    },
  });

  const handleExport = () => {
    setIsExporting(true);
    exportMutation.mutate({
      format: exportOptions.format,
      machineId: exportOptions.machineId,
      productModelId: exportOptions.productModelId,
      dateFrom: exportOptions.dateFrom,
      dateTo: exportOptions.dateTo,
    });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setImportData(content);
      
      // Try to parse and preview
      try {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          setPreviewData(parsed.slice(0, 10));
        }
      } catch {
        // Not valid JSON
        setPreviewData([]);
      }
    };
    reader.readAsText(file);
  };

  const handleImport = () => {
    if (!importData.trim()) {
      toast.error(t('annotation.noImportData'));
      return;
    }
    
    setIsImporting(true);
    setImportResult(null);
    importMutation.mutate({
      data: importData,
      format: 'json',
      mode: importMode,
    });
  };

  const handlePreview = () => {
    try {
      const parsed = JSON.parse(importData);
      if (Array.isArray(parsed)) {
        setPreviewData(parsed.slice(0, 20));
        setShowPreview(true);
      } else {
        toast.error(t('annotation.invalidJsonFormat'));
      }
    } catch (err) {
      toast.error(t('annotation.invalidJson'));
    }
  };

  return (
    <div className="space-y-6">
      <Tabs defaultValue="export">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="export" className="gap-2">
            <Download className="h-4 w-4" />
            Export
          </TabsTrigger>
          <TabsTrigger value="import" className="gap-2">
            <Upload className="h-4 w-4" />
            Import
          </TabsTrigger>
        </TabsList>

        {/* Export Tab */}
        <TabsContent value="export" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Download className="h-5 w-5" />
                Export Annotations
              </CardTitle>
              <CardDescription>
                {t('annotation.exportDescription')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Format Selection */}
              <div className="grid grid-cols-2 gap-4">
                <Card 
                  className={cn(
                    'cursor-pointer transition-colors',
                    exportOptions.format === 'json' && 'border-primary'
                  )}
                  onClick={() => setExportOptions(prev => ({ ...prev, format: 'json' }))}
                >
                  <CardContent className="pt-6 flex items-center gap-4">
                    <FileJson className="h-10 w-10 text-blue-500" />
                    <div>
                      <p className="font-medium">JSON</p>
                      <p className="text-sm text-muted-foreground">
                        {t('annotation.jsonDescription')}
                      </p>
                    </div>
                  </CardContent>
                </Card>
                
                <Card 
                  className={cn(
                    'cursor-pointer transition-colors',
                    exportOptions.format === 'csv' && 'border-primary'
                  )}
                  onClick={() => setExportOptions(prev => ({ ...prev, format: 'csv' }))}
                >
                  <CardContent className="pt-6 flex items-center gap-4">
                    <FileSpreadsheet className="h-10 w-10 text-green-500" />
                    <div>
                      <p className="font-medium">CSV</p>
                      <p className="text-sm text-muted-foreground">
                        {t('annotation.csvDescription')}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Filters */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label>{t('history.machine')}</Label>
                  <Select
                    value={exportOptions.machineId?.toString() || 'all'}
                    onValueChange={(v) => setExportOptions(prev => ({ 
                      ...prev, 
                      machineId: v && v !== 'all' ? parseInt(v) : undefined 
                    }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t('common.all')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t('common.all')}</SelectItem>
                      {machines?.map((m: any) => (
                        <SelectItem key={m.id} value={m.id.toString()}>
                          {m.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>{t('annotation.productModel')}</Label>
                  <Select
                    value={exportOptions.productModelId?.toString() || 'all'}
                    onValueChange={(v) => setExportOptions(prev => ({ 
                      ...prev, 
                      productModelId: v && v !== 'all' ? parseInt(v) : undefined 
                    }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t('common.all')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t('common.all')}</SelectItem>
                      {productModels?.map((pm: any) => (
                        <SelectItem key={pm.id} value={pm.id.toString()}>
                          {pm.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>{t('common.from')}</Label>
                  <Input
                    type="date"
                    value={exportOptions.dateFrom || ''}
                    onChange={(e) => setExportOptions(prev => ({ 
                      ...prev, 
                      dateFrom: e.target.value || undefined 
                    }))}
                  />
                </div>

                <div className="space-y-2">
                  <Label>{t('common.to')}</Label>
                  <Input
                    type="date"
                    value={exportOptions.dateTo || ''}
                    onChange={(e) => setExportOptions(prev => ({ 
                      ...prev, 
                      dateTo: e.target.value || undefined 
                    }))}
                  />
                </div>
              </div>

              <Button 
                onClick={handleExport} 
                disabled={isExporting}
                className="w-full gap-2"
              >
                {isExporting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('annotation.exporting')}
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4" />
                    Export Annotations
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Import Tab */}
        <TabsContent value="import" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5" />
                Import Annotations
              </CardTitle>
              <CardDescription>
                {t('annotation.importDescription')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* File Upload */}
              <div className="border-2 border-dashed rounded-lg p-8 text-center">
                <Upload className="h-10 w-10 mx-auto mb-4 text-muted-foreground" />
                <p className="text-sm text-muted-foreground mb-4">
                  {t('annotation.dragDropJson')}
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <Button 
                  variant="outline" 
                  onClick={() => fileInputRef.current?.click()}
                >
                  {t('annotation.selectFile')}
                </Button>
              </div>

              {/* Or paste JSON */}
              <div className="space-y-2">
                <Label>{t('annotation.orPasteJson')}</Label>
                <Textarea
                  placeholder='[{"imageUrl": "...", "annotations": [...]}]'
                  value={importData}
                  onChange={(e) => setImportData(e.target.value)}
                  rows={6}
                  className="font-mono text-sm"
                />
              </div>

              {/* Import Mode */}
              <div className="space-y-2">
                <Label>{t('annotation.importMode')}</Label>
                <div className="grid grid-cols-2 gap-4">
                  <Card 
                    className={cn(
                      'cursor-pointer transition-colors',
                      importMode === 'merge' && 'border-primary'
                    )}
                    onClick={() => setImportMode('merge')}
                  >
                    <CardContent className="pt-4">
                      <p className="font-medium">Merge</p>
                      <p className="text-xs text-muted-foreground">
                        {t('annotation.mergeDescription')}
                      </p>
                    </CardContent>
                  </Card>
                  
                  <Card 
                    className={cn(
                      'cursor-pointer transition-colors',
                      importMode === 'replace' && 'border-primary'
                    )}
                    onClick={() => setImportMode('replace')}
                  >
                    <CardContent className="pt-4">
                      <p className="font-medium">Replace</p>
                      <p className="text-xs text-muted-foreground">
                        {t('annotation.replaceDescription')}
                      </p>
                    </CardContent>
                  </Card>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <Button 
                  variant="outline"
                  onClick={handlePreview}
                  disabled={!importData.trim()}
                  className="flex-1 gap-2"
                >
                  <Eye className="h-4 w-4" />
                  {t('annotation.preview')}
                </Button>
                <Button 
                  onClick={handleImport}
                  disabled={isImporting || !importData.trim()}
                  className="flex-1 gap-2"
                >
                  {isImporting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                    {t('annotation.importing')}
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4" />
                      Import
                    </>
                  )}
                </Button>
              </div>

              {/* Import Result */}
              {importResult && (
                <Alert variant={importResult.success ? 'default' : 'destructive'}>
                  {importResult.success ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <XCircle className="h-4 w-4" />
                  )}
                  <AlertTitle>
                    {importResult.success ? t('annotation.importSuccessTitle') : t('annotation.importHasErrors')}
                  </AlertTitle>
                  <AlertDescription>
                    <div className="space-y-1 mt-2">
                      <p>{t('annotation.importedCount', { count: importResult.imported })}</p>
                      <p>{t('annotation.skippedCount', { count: importResult.skipped })}</p>
                      {importResult.errors.length > 0 && (
                        <div className="mt-2">
                          <p className="font-medium">{t('common.error')}:</p>
                          <ul className="list-disc list-inside text-sm">
                            {importResult.errors.map((err, idx) => (
                              <li key={idx}>{err}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Preview Dialog */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-4xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>{t('annotation.previewImportData')}</DialogTitle>
            <DialogDescription>
              {t('annotation.showingFirstRecords', { count: previewData.length })}
            </DialogDescription>
          </DialogHeader>
          
          <ScrollArea className="h-125">
            <div className="space-y-4">
              {previewData.map((item, idx) => (
                <Card key={idx}>
                  <CardContent className="pt-4">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground">Image URL</p>
                        <p className="font-mono text-xs truncate">{item.imageUrl}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Serial Number</p>
                        <p>{item.serialNumber || 'N/A'}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Machine</p>
                        <p>{item.machineName || 'N/A'}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Product Model</p>
                        <p>{item.productModelName || 'N/A'}</p>
                      </div>
                      <div className="col-span-2">
                        <p className="text-muted-foreground">Annotations</p>
                        <Badge variant="outline">
                          {item.annotations?.length || 0} annotations
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPreview(false)}>
              {t('common.close')}
            </Button>
            <Button onClick={() => { setShowPreview(false); handleImport(); }}>
              {t('annotation.proceedImport')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default AnnotationExportImport;
