import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from 'sonner';
import { FileDown, FileSpreadsheet, FileText, Calendar as CalendarIcon, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { vi } from 'date-fns/locale';

interface ExportDashboardButtonProps {
  corporateCode?: string;
}

export function ExportDashboardButton({ corporateCode }: ExportDashboardButtonProps) {
  const { t } = useTranslation();
  const [showDialog, setShowDialog] = useState(false);
  const [exportFormat, setExportFormat] = useState<'excel' | 'pdf'>('excel');
  const [dateRange, setDateRange] = useState<{
    from: Date;
    to: Date;
  }>({
    from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
    to: new Date(),
  });

  const exportMutation = trpc.export.exportDashboardStats.useMutation({
    onSuccess: (data) => {
      toast.success(t('reports.exportSuccess'), {
        description: `File: ${data.filename}`,
        action: {
          label: t('common.download'),
          onClick: () => window.open(data.url, '_blank'),
        },
      });
      setShowDialog(false);
    },
    onError: (error) => {
      toast.error(t('reports.exportError'), {
        description: error.message,
      });
    },
  });

  const handleExport = (format: 'excel' | 'pdf') => {
    setExportFormat(format);
    setShowDialog(true);
  };

  const confirmExport = () => {
    exportMutation.mutate({
      startDate: dateRange.from,
      endDate: dateRange.to,
      format: exportFormat,
      corporateCode,
    });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <FileDown className="h-4 w-4" />
            {t('reports.exportReport')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{t('reports.chooseFormat')}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => handleExport('excel')} className="gap-2 cursor-pointer">
            <FileSpreadsheet className="h-4 w-4 text-green-600" />
            Excel (.xlsx)
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleExport('pdf')} className="gap-2 cursor-pointer">
            <FileText className="h-4 w-4 text-red-600" />
            PDF / HTML
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {exportFormat === 'excel' ? (
                <FileSpreadsheet className="h-5 w-5 text-green-600" />
              ) : (
                <FileText className="h-5 w-5 text-red-600" />
              )}
              {t('reports.exportReportFormat', { format: exportFormat === 'excel' ? 'Excel' : 'PDF' })}
            </DialogTitle>
            <DialogDescription>
              {t('reports.exportReportDescription')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('reports.dateRange')}</label>
              <div className="flex items-center gap-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start text-left font-normal">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {format(dateRange.from, 'dd/MM/yyyy', { locale: vi })}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={dateRange.from}
                      onSelect={(date) => date && setDateRange(prev => ({ ...prev, from: date }))}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                <span className="text-muted-foreground">{t('common.to')}</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start text-left font-normal">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {format(dateRange.to, 'dd/MM/yyyy', { locale: vi })}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={dateRange.to}
                      onSelect={(date) => date && setDateRange(prev => ({ ...prev, to: date }))}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDateRange({
                  from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
                  to: new Date(),
                })}
              >
                7 {t('common.days')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDateRange({
                  from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
                  to: new Date(),
                })}
              >
                30 {t('common.days')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDateRange({
                  from: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
                  to: new Date(),
                })}
              >
                90 {t('common.days')}
              </Button>
            </div>

            {corporateCode && (
              <div className="p-3 bg-muted/50 rounded-lg">
                <p className="text-sm text-muted-foreground">
                  {t('reports.filteredByCorporate', { code: corporateCode })}
                </p>
              </div>
            )}

            <div className="p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg">
              <p className="text-sm text-blue-700 dark:text-blue-300">
                <strong>{t('reports.reportContent')}:</strong>
              </p>
              <ul className="text-sm text-blue-600 dark:text-blue-400 mt-1 space-y-1">
                <li>• {t('reports.reportOverview')}</li>
                <li>• {t('reports.reportByCorporate')}</li>
                <li>• {t('reports.reportByFactory')}</li>
                <li>• {t('reports.reportThroughput')}</li>
              </ul>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={confirmExport} disabled={exportMutation.isPending}>
              {exportMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('reports.exporting')}
                </>
              ) : (
                <>
                  <FileDown className="mr-2 h-4 w-4" />
                  {t('reports.exportReport')}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
