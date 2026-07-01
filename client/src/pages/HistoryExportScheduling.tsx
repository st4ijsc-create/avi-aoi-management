import { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '@/components/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import {
  Calendar, Clock, Download, Mail, Plus, Play, Pause, Trash2,
  Edit, CheckCircle, XCircle, AlertTriangle, FileSpreadsheet,
  FileJson, FileText, RefreshCw, History, Send, Settings, Eye
} from 'lucide-react';

type ScheduleType = 'DAILY' | 'WEEKLY' | 'MONTHLY';
type ExportFormat = 'CSV' | 'JSON' | 'EXCEL' | 'PDF';
type TimeRangeType = 'LAST_24H' | 'LAST_7D' | 'LAST_30D' | 'LAST_MONTH' | 'CUSTOM';
type ResultFilter = 'ALL' | 'OK' | 'NG' | 'NTF';

interface Schedule {
  id: number;
  name: string;
  description?: string;
  scheduleType: ScheduleType;
  scheduleTime: string;
  scheduleDayOfWeek?: number;
  scheduleDayOfMonth?: number;
  exportFormat: ExportFormat;
  resultFilter: ResultFilter;
  timeRangeType: TimeRangeType;
  customDays?: number;
  recipients: string[];
  includeImages: boolean;
  includeAnnotations: boolean;
  includeMeasurements: boolean;
  includeSummaryStats: boolean;
  isActive: boolean;
  lastRunAt?: Date;
  lastRunStatus?: 'SUCCESS' | 'FAILED' | 'PENDING';
  nextRunAt?: Date;
}

interface ExportLog {
  id: number;
  scheduleId: number;
  scheduleName: string;
  status: 'SUCCESS' | 'FAILED' | 'PENDING' | 'RUNNING';
  recordCount: number;
  fileSize: number;
  recipientCount: number;
  deliveredCount: number;
  startedAt: Date;
  completedAt?: Date;
  errorMessage?: string;
}

// Map server scheduled report to client Schedule interface
function mapServerToSchedule(server: any): Schedule {
  const formatMap: Record<string, ExportFormat> = { HTML: 'CSV', PDF: 'PDF', EXCEL: 'EXCEL' };
  return {
    id: server.id,
    name: server.name,
    description: server.description ?? undefined,
    scheduleType: server.schedule as ScheduleType,
    scheduleTime: server.scheduleTime ?? '08:00',
    scheduleDayOfWeek: server.scheduleDayOfWeek ?? undefined,
    scheduleDayOfMonth: server.scheduleDayOfMonth ?? undefined,
    exportFormat: formatMap[server.reportFormat] ?? 'CSV',
    resultFilter: 'ALL',
    timeRangeType: 'LAST_24H',
    recipients: server.recipients ?? [],
    includeImages: server.includeWorkstationHeatmap ?? false,
    includeAnnotations: server.includeTopNGPoints ?? false,
    includeMeasurements: server.includeTrendChart ?? false,
    includeSummaryStats: server.includeComparison ?? false,
    isActive: server.isActive ?? false,
    lastRunAt: server.lastSentAt ? new Date(server.lastSentAt) : undefined,
    lastRunStatus: undefined,
    nextRunAt: server.nextScheduledAt ? new Date(server.nextScheduledAt) : undefined,
  };
}

// Map server log to client ExportLog interface
function mapServerToLog(server: any, scheduleName: string): ExportLog {
  return {
    id: server.id,
    scheduleId: server.reportId,
    scheduleName,
    status: server.status as ExportLog['status'],
    recordCount: 0,
    fileSize: 0,
    recipientCount: server.recipientCount ?? 0,
    deliveredCount: server.successCount ?? 0,
    startedAt: new Date(server.sentAt),
    completedAt: server.sentAt ? new Date(server.sentAt) : undefined,
    errorMessage: server.errorMessage ?? undefined,
  };
}

const DAYS_OF_WEEK = [
  { value: 0, labelKey: 'reports.sunday' },
  { value: 1, labelKey: 'reports.monday' },
  { value: 2, labelKey: 'reports.tuesday' },
  { value: 3, labelKey: 'reports.wednesday' },
  { value: 4, labelKey: 'reports.thursday' },
  { value: 5, labelKey: 'reports.friday' },
  { value: 6, labelKey: 'reports.saturday' },
];

export default function HistoryExportScheduling() {
  const { t } = useTranslation();
  // tRPC queries & mutations
  const utils = trpc.useUtils();
  const schedulesQuery = trpc.scheduledReport.list.useQuery();

  const schedules: Schedule[] = useMemo(() => {
    return (schedulesQuery.data ?? []).map(mapServerToSchedule);
  }, [schedulesQuery.data]);

  // Fetch logs for all schedules
  const [logs, setLogs] = useState<ExportLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  useEffect(() => {
    if (!schedulesQuery.data?.length) {
      setLogs([]);
      return;
    }
    setLogsLoading(true);
    const nameMap = new Map(schedulesQuery.data.map((s: any) => [s.id, s.name]));
    Promise.all(
      schedulesQuery.data.map((s: any) =>
        utils.scheduledReport.getLogs.fetch({ reportId: s.id, limit: 50 })
          .then((serverLogs: any[]) => serverLogs.map((l: any) => mapServerToLog(l, nameMap.get(s.id) ?? '')))
          .catch(() => [] as ExportLog[])
      )
    ).then((results) => {
      setLogs(results.flat().sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime()));
      setLogsLoading(false);
    });
  }, [schedulesQuery.data]);

  // Mutations
  const updateMutation = trpc.scheduledReport.update.useMutation({
    onSuccess: () => { utils.scheduledReport.list.invalidate(); },
    onError: (error: any) => { toast.error(t('common.error') + ': ' + error.message); },
  });
  const deleteMutation = trpc.scheduledReport.delete.useMutation({
    onSuccess: () => {
      toast.success(t('reports.scheduleDeleted'));
      utils.scheduledReport.list.invalidate();
    },
    onError: (error: any) => { toast.error(t('common.error') + ': ' + error.message); },
  });
  const createMutation = trpc.scheduledReport.create.useMutation({
    onSuccess: () => {
      toast.success(t('reports.scheduleCreated'));
      utils.scheduledReport.list.invalidate();
    },
    onError: (error: any) => { toast.error(t('common.error') + ': ' + error.message); },
  });
  const sendTestMutation = trpc.scheduledReport.sendTest.useMutation({
    onSuccess: () => { toast.success(t('reports.testEmailSent')); },
    onError: (error: any) => { toast.error(t('reports.emailSendError') + ': ' + error.message); },
  });

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [formData, setFormData] = useState<Partial<Schedule>>({
    name: '',
    description: '',
    scheduleType: 'DAILY',
    scheduleTime: '08:00',
    exportFormat: 'CSV',
    resultFilter: 'ALL',
    timeRangeType: 'LAST_24H',
    recipients: [],
    includeImages: false,
    includeAnnotations: true,
    includeMeasurements: true,
    includeSummaryStats: true,
    isActive: true,
  });
  const [recipientInput, setRecipientInput] = useState('');
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);

  const formatDate = (date?: Date) => {
    if (!date) return '-';
    return new Date(date).toLocaleString('vi-VN');
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const getStatusBadge = (status?: string) => {
    switch (status) {
      case 'SUCCESS':
        return <Badge className="bg-success/20 text-success border-success/30"><CheckCircle aria-hidden="true" className="w-3 h-3 mr-1" />{t('reports.success')}</Badge>;
      case 'FAILED':
        return <Badge className="bg-destructive/20 text-destructive border-destructive/30"><XCircle aria-hidden="true" className="w-3 h-3 mr-1" />{t('reports.failed')}</Badge>;
      case 'RUNNING':
        return <Badge className="bg-info/20 text-info border-info/30"><RefreshCw aria-hidden="true" className="w-3 h-3 mr-1 animate-spin" />{t('reports.running')}</Badge>;
      case 'PENDING':
        return <Badge className="bg-warning/20 text-warning border-warning/30"><Clock aria-hidden="true" className="w-3 h-3 mr-1" />{t('reports.pending')}</Badge>;
      default:
        return <Badge variant="outline">-</Badge>;
    }
  };

  const getFormatIcon = (format: ExportFormat) => {
    switch (format) {
      case 'CSV':
      case 'EXCEL':
        return <FileSpreadsheet className="h-4 w-4" />;
      case 'JSON':
        return <FileJson className="h-4 w-4" />;
      case 'PDF':
        return <FileText className="h-4 w-4" />;
    }
  };

  const handleToggleActive = (id: number) => {
    const schedule = schedules.find(s => s.id === id);
    if (!schedule) return;
    updateMutation.mutate(
      { id, isActive: !schedule.isActive },
      { onSuccess: () => toast.success(t('reports.statusUpdated')) }
    );
  };

  const handleRunNow = (schedule: Schedule) => {
    sendTestMutation.mutate({ id: schedule.id });
  };

  const handleDelete = (id: number) => {
    deleteMutation.mutate({ id });
  };

  const handleAddRecipient = () => {
    if (recipientInput && recipientInput.includes('@')) {
      setFormData(prev => ({
        ...prev,
        recipients: [...(prev.recipients || []), recipientInput],
      }));
      setRecipientInput('');
    } else {
      toast.error(t('reports.pleaseEnterValidEmail'));
    }
  };

  const handleRemoveRecipient = (email: string) => {
    setFormData(prev => ({
      ...prev,
      recipients: (prev.recipients || []).filter(r => r !== email),
    }));
  };

  const mapFormToServer = (data: Partial<Schedule>) => {
    const formatMap: Record<string, string> = { CSV: 'HTML', JSON: 'HTML', EXCEL: 'EXCEL', PDF: 'PDF' };
    return {
      name: data.name!,
      description: data.description,
      schedule: data.scheduleType as 'DAILY' | 'WEEKLY' | 'MONTHLY',
      scheduleTime: data.scheduleTime ?? '08:00',
      scheduleDayOfWeek: data.scheduleDayOfWeek,
      scheduleDayOfMonth: data.scheduleDayOfMonth,
      recipients: data.recipients ?? [],
      reportFormat: (formatMap[data.exportFormat ?? 'CSV'] ?? 'HTML') as 'HTML' | 'PDF' | 'EXCEL',
      includeWorkstationHeatmap: data.includeImages ?? false,
      includeTopNGPoints: data.includeAnnotations ?? true,
      includeTrendChart: data.includeMeasurements ?? true,
      includeComparison: data.includeSummaryStats ?? true,
      isActive: data.isActive ?? true,
      reportType: 'NG_VISUAL' as const,
    };
  };

  const handleSave = () => {
    if (!formData.name?.trim()) {
      toast.error(t('reports.pleaseEnterScheduleName'));
      return;
    }
    if (!formData.recipients?.length) {
      toast.error(t('reports.pleaseAddRecipient'));
      return;
    }

    if (editingSchedule) {
      const serverData = mapFormToServer(formData);
      updateMutation.mutate(
        { id: editingSchedule.id, ...serverData },
        {
          onSuccess: () => {
            toast.success(t('reports.scheduleUpdated'));
            setShowCreateDialog(false);
            setEditingSchedule(null);
            resetForm();
          },
        }
      );
    } else {
      const serverData = mapFormToServer(formData);
      createMutation.mutate(serverData, {
        onSuccess: () => {
          setShowCreateDialog(false);
          setEditingSchedule(null);
          resetForm();
        },
      });
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      scheduleType: 'DAILY',
      scheduleTime: '08:00',
      exportFormat: 'CSV',
      resultFilter: 'ALL',
      timeRangeType: 'LAST_24H',
      recipients: [],
      includeImages: false,
      includeAnnotations: true,
      includeMeasurements: true,
      includeSummaryStats: true,
      isActive: true,
    });
  };

  const openEditDialog = (schedule: Schedule) => {
    setEditingSchedule(schedule);
    setFormData(schedule);
    setShowCreateDialog(true);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Calendar className="h-6 w-6" />
              {t('reports.autoExportSchedule')}
            </h1>
            <p className="text-muted-foreground">
              {t('reports.autoExportDescription')}
            </p>
          </div>
          <Button onClick={() => { resetForm(); setShowCreateDialog(true); }}>
            <Plus className="h-4 w-4 mr-2" />
            {t('reports.createNewSchedule')}
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>{t('reports.totalSchedules')}</CardDescription>
              <CardTitle className="text-2xl">{schedules.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>{t('reports.active')}</CardDescription>
              <CardTitle className="text-2xl text-success">
                {schedules.filter(s => s.isActive).length}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>{t('reports.success7days')}</CardDescription>
              <CardTitle className="text-2xl text-info">
                {logs.filter(l => l.status === 'SUCCESS').length}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>{t('reports.failed7days')}</CardDescription>
              <CardTitle className="text-2xl text-destructive">
                {logs.filter(l => l.status === 'FAILED').length}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        <Tabs defaultValue="schedules">
          <TabsList>
            <TabsTrigger value="schedules">
              <Calendar className="h-4 w-4 mr-2" />
              {t('reports.scheduleList')}
            </TabsTrigger>
            <TabsTrigger value="logs">
              <History className="h-4 w-4 mr-2" />
              {t('reports.runHistory')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="schedules" className="space-y-4">
            {schedulesQuery.isLoading ? (
              <Card className="p-12 text-center">
                <RefreshCw className="h-12 w-12 mx-auto text-muted-foreground mb-4 animate-spin" />
                <h3 className="text-lg font-medium mb-2">{t('reports.loadingData')}</h3>
              </Card>
            ) : schedulesQuery.isError ? (
              <Card className="p-12 text-center">
                <AlertTriangle className="h-12 w-12 mx-auto text-destructive mb-4" />
                <h3 className="text-lg font-medium mb-2">{t('reports.loadError')}</h3>
                <p className="text-muted-foreground mb-4">{schedulesQuery.error?.message}</p>
                <Button onClick={() => schedulesQuery.refetch()} variant="outline">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  {t('reports.retry')}
                </Button>
              </Card>
            ) : schedules.length === 0 ? (
              <Card className="p-12 text-center">
                <Calendar className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">{t('reports.noSchedules')}</h3>
                <p className="text-muted-foreground mb-4">
                  {t('reports.noSchedulesDescription')}
                </p>
                <Button onClick={() => setShowCreateDialog(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  {t('reports.createFirstSchedule')}
                </Button>
              </Card>
            ) : (
              <div className="grid gap-4">
                {schedules.map((schedule) => (
                  <Card key={schedule.id}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-lg ${schedule.isActive ? 'bg-success/20' : 'bg-muted'}`}>
                            {getFormatIcon(schedule.exportFormat)}
                          </div>
                          <div>
                            <CardTitle className="text-base flex items-center gap-2">
                              {schedule.name}
                              {!schedule.isActive && (
                                <Badge variant="outline">{t('reports.paused')}</Badge>
                              )}
                            </CardTitle>
                            <CardDescription>{schedule.description}</CardDescription>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={schedule.isActive}
                            onCheckedChange={() => handleToggleActive(schedule.id)}
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            aria-label={t('reports.runNow', 'Run now')}
                            onClick={() => handleRunNow(schedule)}
                          >
                            <Play aria-hidden="true" className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            aria-label={t('common.edit', 'Edit')}
                            onClick={() => openEditDialog(schedule)}
                          >
                            <Edit aria-hidden="true" className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            aria-label={t('common.delete', 'Delete')}
                            onClick={() => handleDelete(schedule.id)}
                          >
                            <Trash2 aria-hidden="true" className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                        <div>
                          <p className="text-muted-foreground">{t('reports.runSchedule')}</p>
                          <p className="font-medium">
                            {schedule.scheduleType === 'DAILY' && t('reports.dailyAt', { time: schedule.scheduleTime })}
                            {schedule.scheduleType === 'WEEKLY' && `${t(DAYS_OF_WEEK.find(d => d.value === schedule.scheduleDayOfWeek)?.labelKey || '')} ${t('reports.at')} ${schedule.scheduleTime}`}
                            {schedule.scheduleType === 'MONTHLY' && t('reports.monthlyAt', { day: schedule.scheduleDayOfMonth, time: schedule.scheduleTime })}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">{t('reports.format')}</p>
                          <p className="font-medium">{schedule.exportFormat}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">{t('reports.recipientsLabel')}</p>
                          <p className="font-medium">{schedule.recipients.length} email</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">{t('reports.lastRun')}</p>
                          <div className="flex items-center gap-2">
                            {getStatusBadge(schedule.lastRunStatus)}
                          </div>
                        </div>
                        <div>
                          <p className="text-muted-foreground">{t('reports.nextRun')}</p>
                          <p className="font-medium">{formatDate(schedule.nextRunAt)}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="logs">
            <Card>
              {logsLoading ? (
                <div className="p-8 text-center">
                  <RefreshCw className="h-8 w-8 mx-auto text-muted-foreground animate-spin mb-2" />
                  <p className="text-muted-foreground">{t('reports.loadingHistory')}</p>
                </div>
              ) : logs.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  {t('reports.noRunHistory')}
                </div>
              ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('reports.schedule')}</TableHead>
                    <TableHead>{t('common.status')}</TableHead>
                    <TableHead>{t('reports.recordCount')}</TableHead>
                    <TableHead>{t('reports.fileSize')}</TableHead>
                    <TableHead>{t('reports.email')}</TableHead>
                    <TableHead>{t('reports.time')}</TableHead>
                    <TableHead>{t('reports.errorColumn')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="font-medium">{log.scheduleName}</TableCell>
                      <TableCell>{getStatusBadge(log.status)}</TableCell>
                      <TableCell>{log.recordCount.toLocaleString()}</TableCell>
                      <TableCell>{formatFileSize(log.fileSize)}</TableCell>
                      <TableCell>
                        {log.deliveredCount}/{log.recipientCount}
                      </TableCell>
                      <TableCell>{formatDate(log.startedAt)}</TableCell>
                      <TableCell className="max-w-[200px] truncate text-destructive">
                        {log.errorMessage || '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              )}
            </Card>
          </TabsContent>
        </Tabs>

        {/* Create/Edit Dialog */}
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingSchedule ? t('reports.editSchedule') : t('reports.createExportSchedule')}
              </DialogTitle>
              <DialogDescription>
                {t('reports.configAutoExport')}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {/* Basic Info */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t('reports.scheduleName')} *</Label>
                  <Input
                    placeholder={t('reports.scheduleNameExample')}
                    value={formData.name || ''}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('reports.exportFormat')}</Label>
                  <Select
                    value={formData.exportFormat}
                    onValueChange={(v: ExportFormat) => setFormData({ ...formData, exportFormat: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CSV">CSV</SelectItem>
                      <SelectItem value="EXCEL">Excel</SelectItem>
                      <SelectItem value="JSON">JSON</SelectItem>
                      <SelectItem value="PDF">PDF</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>{t('common.description')}</Label>
                <Textarea
                  placeholder={t('reports.descriptionPlaceholder')}
                  value={formData.description || ''}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                />
              </div>

              {/* Schedule Config */}
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>{t('reports.frequency')}</Label>
                  <Select
                    value={formData.scheduleType}
                    onValueChange={(v: ScheduleType) => setFormData({ ...formData, scheduleType: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DAILY">{t('reports.daily')}</SelectItem>
                      <SelectItem value="WEEKLY">{t('reports.weekly')}</SelectItem>
                      <SelectItem value="MONTHLY">{t('reports.monthly')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {formData.scheduleType === 'WEEKLY' && (
                  <div className="space-y-2">
                    <Label>{t('reports.dayOfWeek')}</Label>
                    <Select
                      value={String(formData.scheduleDayOfWeek ?? 1)}
                      onValueChange={(v) => setFormData({ ...formData, scheduleDayOfWeek: parseInt(v) })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DAYS_OF_WEEK.map((day) => (
                          <SelectItem key={day.value} value={String(day.value)}>
                            {t(day.labelKey)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {formData.scheduleType === 'MONTHLY' && (
                  <div className="space-y-2">
                    <Label>{t('reports.dayOfMonth')}</Label>
                    <Select
                      value={String(formData.scheduleDayOfMonth ?? 1)}
                      onValueChange={(v) => setFormData({ ...formData, scheduleDayOfMonth: parseInt(v) })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
                          <SelectItem key={day} value={String(day)}>
                            {t('reports.dayNumber', { day })}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="space-y-2">
                  <Label>{t('reports.runTime')}</Label>
                  <Input
                    type="time"
                    value={formData.scheduleTime || '08:00'}
                    onChange={(e) => setFormData({ ...formData, scheduleTime: e.target.value })}
                  />
                </div>
              </div>

              {/* Filters */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t('reports.timeRange')}</Label>
                  <Select
                    value={formData.timeRangeType}
                    onValueChange={(v: TimeRangeType) => setFormData({ ...formData, timeRangeType: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="LAST_24H">{t('reports.last24h')}</SelectItem>
                      <SelectItem value="LAST_7D">{t('reports.last7d')}</SelectItem>
                      <SelectItem value="LAST_30D">{t('reports.last30d')}</SelectItem>
                      <SelectItem value="LAST_MONTH">{t('reports.lastMonth')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t('reports.filterResults')}</Label>
                  <Select
                    value={formData.resultFilter}
                    onValueChange={(v: ResultFilter) => setFormData({ ...formData, resultFilter: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">{t('common.all')}</SelectItem>
                      <SelectItem value="OK">{t('reports.onlyOK')}</SelectItem>
                      <SelectItem value="NG">{t('reports.onlyNG')}</SelectItem>
                      <SelectItem value="NTF">{t('reports.onlyNTF')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Include Options */}
              <div className="space-y-3">
                <Label>{t('reports.includeContent')}</Label>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center justify-between">
                    <Label className="font-normal">{t('reports.images')}</Label>
                    <Switch
                      checked={formData.includeImages}
                      onCheckedChange={(v) => setFormData({ ...formData, includeImages: v })}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="font-normal">Annotations</Label>
                    <Switch
                      checked={formData.includeAnnotations}
                      onCheckedChange={(v) => setFormData({ ...formData, includeAnnotations: v })}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="font-normal">Measurements</Label>
                    <Switch
                      checked={formData.includeMeasurements}
                      onCheckedChange={(v) => setFormData({ ...formData, includeMeasurements: v })}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="font-normal">{t('reports.summaryStats')}</Label>
                    <Switch
                      checked={formData.includeSummaryStats}
                      onCheckedChange={(v) => setFormData({ ...formData, includeSummaryStats: v })}
                    />
                  </div>
                </div>
              </div>

              {/* Recipients */}
              <div className="space-y-2">
                <Label>{t('reports.emailRecipients')} *</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="email@company.com"
                    value={recipientInput}
                    onChange={(e) => setRecipientInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddRecipient()}
                  />
                  <Button type="button" onClick={handleAddRecipient}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  {formData.recipients?.map((email) => (
                    <Badge key={email} variant="secondary" className="flex items-center gap-1">
                      <Mail className="h-3 w-3" />
                      {email}
                      <button
                        type="button"
                        aria-label={t('common.remove', 'Remove')}
                        onClick={() => handleRemoveRecipient(email)}
                        className="ml-1 hover:text-destructive"
                      >
                        ×
                      </button>
                    </Badge>
                  ))}
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => { setShowCreateDialog(false); setEditingSchedule(null); }}>
                {t('common.cancel')}
              </Button>
              <Button variant="secondary" onClick={() => setShowPreviewDialog(true)}>
                <Eye className="h-4 w-4 mr-2" />
                {t('reports.previewEmail')}
              </Button>
              <Button onClick={handleSave}>
                <CheckCircle className="h-4 w-4 mr-2" />
                {editingSchedule ? t('common.update') : t('reports.createSchedule')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Email Preview Dialog */}
        <Dialog open={showPreviewDialog} onOpenChange={setShowPreviewDialog}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Eye className="h-5 w-5" />
                {t('reports.previewEmail')}
              </DialogTitle>
              <DialogDescription>
                {t('reports.previewEmailDescription')}
              </DialogDescription>
            </DialogHeader>

            <div className="border rounded-lg overflow-hidden">
              {/* Email Header */}
              <div className="bg-muted p-4 border-b space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-muted-foreground w-16">{t('reports.from')}:</span>
                  <span className="text-sm">AVI/AOI Management System &lt;noreply@avi-aoi.system&gt;</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-muted-foreground w-16">{t('reports.to')}:</span>
                  <div className="flex flex-wrap gap-1">
                    {formData.recipients?.map((email) => (
                      <Badge key={email} variant="secondary" className="text-xs">{email}</Badge>
                    ))}
                    {(!formData.recipients || formData.recipients.length === 0) && (
                      <span className="text-sm text-muted-foreground italic">{t('reports.noRecipients')}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-muted-foreground w-16">{t('reports.subject')}:</span>
                  <span className="text-sm font-medium">
                    [AVI/AOI] {formData.name || t('reports.report')} - {new Date().toLocaleDateString('vi-VN')}
                  </span>
                </div>
              </div>

              {/* Email Body */}
              <div className="p-6 bg-background">
                <div className="max-w-2xl mx-auto space-y-6">
                  {/* Logo/Header */}
                  <div className="text-center pb-4 border-b">
                    <h2 className="text-xl font-bold text-primary">AVI/AOI Management System</h2>
                    <p className="text-sm text-muted-foreground">{t('reports.autoReport')}</p>
                  </div>

                  {/* Greeting */}
                  <div>
                    <p className="text-sm">{t('reports.greeting')},</p>
                    <p className="text-sm mt-2">
                      {t('reports.autoReportGreeting', { name: formData.name || t('reports.report'), time: formData.scheduleTime || '08:00', date: new Date().toLocaleDateString('vi-VN') })}
                    </p>
                  </div>

                  {/* Report Summary */}
                  <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                    <h3 className="font-semibold text-sm">{t('reports.reportInfo')}</h3>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t('reports.frequency')}:</span>
                        <span>{formData.scheduleType === 'DAILY' ? t('reports.daily') : formData.scheduleType === 'WEEKLY' ? t('reports.weekly') : t('reports.monthly')}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t('reports.format')}:</span>
                        <span>{formData.exportFormat || 'CSV'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t('reports.filterResults')}:</span>
                        <span>{formData.resultFilter === 'ALL' ? t('common.all') : formData.resultFilter}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t('reports.timeRange')}:</span>
                        <span>
                          {formData.timeRangeType === 'LAST_24H' ? t('reports.last24h') :
                           formData.timeRangeType === 'LAST_7D' ? t('reports.last7d') :
                           formData.timeRangeType === 'LAST_30D' ? t('reports.last30d') :
                           formData.timeRangeType === 'LAST_MONTH' ? t('reports.lastMonth') : t('reports.custom')}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Included Content */}
                  <div className="space-y-2">
                    <h3 className="font-semibold text-sm">{t('reports.includeContent')}</h3>
                    <div className="flex flex-wrap gap-2">
                      {formData.includeImages && <Badge variant="outline">{t('reports.images')}</Badge>}
                      {formData.includeAnnotations && <Badge variant="outline">Annotations</Badge>}
                      {formData.includeMeasurements && <Badge variant="outline">Measurements</Badge>}
                      {formData.includeSummaryStats && <Badge variant="outline">{t('reports.stats')}</Badge>}
                      {!formData.includeImages && !formData.includeAnnotations && !formData.includeMeasurements && !formData.includeSummaryStats && (
                        <span className="text-sm text-muted-foreground italic">{t('reports.noContentSelected')}</span>
                      )}
                    </div>
                  </div>

                  {/* Sample Stats */}
                  {formData.includeSummaryStats && (
                    <div className="border rounded-lg p-4 space-y-3">
                      <h3 className="font-semibold text-sm">{t('reports.summaryStatsSample')}</h3>
                      <div className="grid grid-cols-4 gap-4 text-center">
                        <div className="bg-muted/50 rounded p-3">
                          <div className="text-2xl font-bold">1,234</div>
                          <div className="text-xs text-muted-foreground">{t('reports.total')}</div>
                        </div>
                        <div className="bg-success/10 rounded p-3">
                          <div className="text-2xl font-bold text-success">1,180</div>
                          <div className="text-xs text-muted-foreground">OK</div>
                        </div>
                        <div className="bg-destructive/10 rounded p-3">
                          <div className="text-2xl font-bold text-destructive">54</div>
                          <div className="text-xs text-muted-foreground">NG</div>
                        </div>
                        <div className="bg-info/10 rounded p-3">
                          <div className="text-2xl font-bold text-info">95.6%</div>
                          <div className="text-xs text-muted-foreground">{t('reports.okRate')}</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Attachment Info */}
                  <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                    {getFormatIcon(formData.exportFormat || 'CSV')}
                    <div>
                      <p className="text-sm font-medium">
                        {formData.name || 'report'}_{new Date().toISOString().split('T')[0]}.{(formData.exportFormat || 'CSV').toLowerCase()}
                      </p>
                      <p className="text-xs text-muted-foreground">{t('reports.attachment')}</p>
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="pt-4 border-t text-center text-xs text-muted-foreground space-y-1">
                    <p>{t('reports.autoEmailFooter1')}</p>
                    <p>{t('reports.autoEmailFooter2')}</p>
                  </div>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowPreviewDialog(false)}>
                {t('common.close')}
              </Button>
              <Button
                disabled={!editingSchedule || sendTestMutation.isPending}
                onClick={() => {
                  if (editingSchedule) {
                    sendTestMutation.mutate({ id: editingSchedule.id });
                    setShowPreviewDialog(false);
                  }
                }}
              >
                <Send className="h-4 w-4 mr-2" />
                {sendTestMutation.isPending ? t('reports.sending') : t('reports.sendTestEmail')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
