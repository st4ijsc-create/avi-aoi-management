import { useState } from "react";
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { 
  CheckSquare, 
  Download, 
  Tag, 
  MessageSquare,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Loader2,
  Archive,
  Send,
  RotateCcw,
} from "lucide-react";

interface InspectionItem {
  id: string;
  serialNumber: string;
  overallResult: string;
  inspectionTime: Date;
  machineName?: string;
  productModelName?: string;
}

interface HistoryBatchOperationsProps {
  selectedItems: InspectionItem[];
  onClearSelection: () => void;
  onRefresh: () => void;
}

type BatchAction = 'export' | 'acknowledge' | 'add-note' | 'add-tag' | 'archive' | 'delete';

export default function HistoryBatchOperations({
  selectedItems,
  onClearSelection,
  onRefresh,
}: HistoryBatchOperationsProps) {
  const { t } = useTranslation();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [currentAction, setCurrentAction] = useState<BatchAction | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [processedCount, setProcessedCount] = useState(0);
  const [noteText, setNoteText] = useState("");
  const [tagValue, setTagValue] = useState("");
  const [exportFormat, setExportFormat] = useState<"csv" | "json" | "excel">("csv");

  const simulateBatchProcess = async (actionLabel: string) => {
    const total = selectedItems.length;
    for (let i = 0; i < total; i++) {
      setProcessedCount(i + 1);
      setProgress(Math.round(((i + 1) / total) * 100));
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    toast.success(t('history.batch.processed', { action: actionLabel, count: total }));
    onClearSelection();
    onRefresh();
  };

  const handleOpenAction = (action: BatchAction) => {
    setCurrentAction(action);
    setIsDialogOpen(true);
    setProgress(0);
    setProcessedCount(0);
    setNoteText("");
    setTagValue("");
  };

  const handleExecuteAction = async () => {
    if (!currentAction) return;
    setIsProcessing(true);

    try {
      switch (currentAction) {
        case 'export':
          await handleExport();
          break;
        case 'acknowledge':
          await simulateBatchProcess(t('history.batch.actionAcknowledge'));
          break;
        case 'add-note':
          if (!noteText.trim()) {
            toast.error(t('history.batch.enterNote'));
            setIsProcessing(false);
            return;
          }
          await simulateBatchProcess(t('history.batch.actionAddNote'));
          break;
        case 'add-tag':
          if (!tagValue.trim()) {
            toast.error(t('history.batch.enterTag'));
            setIsProcessing(false);
            return;
          }
          await simulateBatchProcess(t('history.batch.actionAddTag'));
          break;
        case 'archive':
          await simulateBatchProcess(t('history.batch.actionArchive'));
          break;
        case 'delete':
          break;
      }
      setIsDialogOpen(false);
    } catch (error) {
      console.error("Batch operation error:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExport = async () => {
    for (let i = 0; i <= 100; i += 10) {
      setProgress(i);
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    const exportData = selectedItems.map(item => ({
      id: item.id,
      serialNumber: item.serialNumber,
      result: item.overallResult,
      inspectionTime: new Date(item.inspectionTime).toISOString(),
      machine: item.machineName || '',
      product: item.productModelName || '',
    }));

    let content: string;
    let filename: string;
    let mimeType: string;

    switch (exportFormat) {
      case 'csv':
        const headers = ['ID', 'Serial Number', 'Result', 'Inspection Time', 'Machine', 'Product'];
        const rows = exportData.map(d => [d.id, d.serialNumber, d.result, d.inspectionTime, d.machine, d.product]);
        content = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        filename = 'inspections_' + Date.now() + '.csv';
        mimeType = 'text/csv';
        break;
      case 'json':
        content = JSON.stringify(exportData, null, 2);
        filename = 'inspections_' + Date.now() + '.json';
        mimeType = 'application/json';
        break;
      case 'excel':
        const excelHeaders = ['ID', 'Serial Number', 'Result', 'Inspection Time', 'Machine', 'Product'];
        const excelRows = exportData.map(d => [d.id, d.serialNumber, d.result, d.inspectionTime, d.machine, d.product]);
        content = '\uFEFF' + [excelHeaders.join(','), ...excelRows.map(r => r.join(','))].join('\n');
        filename = 'inspections_' + Date.now() + '.csv';
        mimeType = 'text/csv;charset=utf-8';
        break;
      default:
        content = '';
        filename = '';
        mimeType = '';
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast.success(t('history.batch.exported', { count: selectedItems.length, filename }));
    onClearSelection();
  };

  const getActionTitle = (action: BatchAction) => {
    switch (action) {
      case 'export': return t('history.batch.exportData');
      case 'acknowledge': return t('history.batch.acknowledgeViewed');
      case 'add-note': return t('history.batch.addNote');
      case 'add-tag': return t('history.batch.addTag');
      case 'archive': return t('history.batch.archive');
      case 'delete': return t('common.delete');
      default: return '';
    }
  };

  const getActionIcon = (action: BatchAction) => {
    switch (action) {
      case 'export': return <Download className="h-4 w-4" />;
      case 'acknowledge': return <CheckSquare className="h-4 w-4" />;
      case 'add-note': return <MessageSquare className="h-4 w-4" />;
      case 'add-tag': return <Tag className="h-4 w-4" />;
      case 'archive': return <Archive className="h-4 w-4" />;
      default: return null;
    }
  };

  const getResultBadge = (result: string) => {
    switch (result) {
      case 'OK':
        return <Badge variant="default" className="bg-green-500"><CheckCircle className="h-3 w-3 mr-1" />OK</Badge>;
      case 'NG':
        return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />NG</Badge>;
      case 'NTF':
        return <Badge variant="secondary" className="bg-orange-500 text-white"><AlertTriangle className="h-3 w-3 mr-1" />NTF</Badge>;
      default:
        return <Badge variant="outline">{result}</Badge>;
    }
  };

  if (selectedItems.length === 0) {
    return null;
  }

  return (
    <>
      <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 z-50">
        <Card className="shadow-lg border-2">
          <CardContent className="p-3">
            <div className="flex items-center gap-3">
              <Badge variant="secondary" className="text-sm">
                {selectedItems.length} {t('history.batch.itemsSelected')}
              </Badge>
              
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => handleOpenAction('export')}>
                  <Download className="h-4 w-4 mr-1" />{t('common.export')}
                </Button>
                <Button size="sm" variant="outline" onClick={() => handleOpenAction('acknowledge')}>
                  <CheckSquare className="h-4 w-4 mr-1" />{t('history.batch.acknowledge')}
                </Button>
                <Button size="sm" variant="outline" onClick={() => handleOpenAction('add-note')}>
                  <MessageSquare className="h-4 w-4 mr-1" />{t('history.batch.note')}
                </Button>
                <Button size="sm" variant="outline" onClick={() => handleOpenAction('add-tag')}>
                  <Tag className="h-4 w-4 mr-1" />{t('history.batch.tag')}
                </Button>
                <Button size="sm" variant="outline" onClick={() => handleOpenAction('archive')}>
                  <Archive className="h-4 w-4 mr-1" />{t('history.batch.archive')}
                </Button>
              </div>
              
              <Button size="sm" variant="ghost" onClick={onClearSelection}>
                <RotateCcw className="h-4 w-4 mr-1" />{t('history.batch.deselect')}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {currentAction && getActionIcon(currentAction)}
              {currentAction && getActionTitle(currentAction)}
            </DialogTitle>
            <DialogDescription>
              {t('history.batch.operationAppliedTo', { count: selectedItems.length })}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label className="text-sm font-medium">{t('history.batch.selectedItems')}:</Label>
              <ScrollArea className="h-32 mt-2 border rounded-md p-2">
                <div className="space-y-1">
                  {selectedItems.slice(0, 10).map((item) => (
                    <div key={item.id} className="flex items-center justify-between text-sm">
                      <span className="font-mono">{item.serialNumber}</span>
                      {getResultBadge(item.overallResult)}
                    </div>
                  ))}
                  {selectedItems.length > 10 && (
                    <div className="text-sm text-muted-foreground">
                      ... {t('history.batch.andMore', { count: selectedItems.length - 10 })}
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>

            {currentAction === 'export' && (
              <div className="space-y-2">
                <Label>{t('history.batch.exportFormat')}:</Label>
                <Select value={exportFormat} onValueChange={(v: "csv" | "json" | "excel") => setExportFormat(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="csv">CSV</SelectItem>
                    <SelectItem value="json">JSON</SelectItem>
                    <SelectItem value="excel">Excel (CSV UTF-8)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {currentAction === 'add-note' && (
              <div className="space-y-2">
                <Label>{t('history.batch.noteContent')}:</Label>
                <Textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder={t('history.batch.enterNoteContent')} rows={3} />
              </div>
            )}

            {currentAction === 'add-tag' && (
              <div className="space-y-2">
                <Label>{t('history.batch.tag')}:</Label>
                <Input value={tagValue} onChange={(e) => setTagValue(e.target.value)} placeholder={t('history.batch.enterTag')} />
              </div>
            )}

            {isProcessing && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span>{t('history.batch.processing')}</span>
                  <span>{processedCount}/{selectedItems.length}</span>
                </div>
                <Progress value={progress} />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isProcessing}>{t('common.cancel')}</Button>
            <Button onClick={handleExecuteAction} disabled={isProcessing}>
              {isProcessing ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{t('history.batch.processing')}</>
              ) : (
                <><Send className="h-4 w-4 mr-2" />{t('history.batch.execute')}</>
              )}
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
