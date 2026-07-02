import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import DOMPurify from 'dompurify';
import DashboardLayout from '@/components/DashboardLayout';
import { PageContainer, PageHeader, EmptyState } from '@/components/patterns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import {
  Calendar,
  Clock,
  Mail,
  Plus,
  Trash2,
  Edit,
  Play,
  Pause,
  Eye,
  Send,
  FileBarChart,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle
} from 'lucide-react';

interface ScheduledReport {
  id: number;
  name: string;
  description: string | null;
  frequency: 'daily' | 'weekly' | 'monthly';
  recipients: string[];
  isActive: boolean;
  lastSentAt: Date | null;
  nextScheduledAt: Date | null;
  createdAt: Date;
}

export function ScheduledReportsContent() {
  const { t } = useTranslation();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isPreviewDialogOpen, setIsPreviewDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [sendTarget, setSendTarget] = useState<
    { schedule: 'DAILY' | 'WEEKLY' | 'MONTHLY'; recipients: string[] } | null
  >(null);
  const [previewHtml, setPreviewHtml] = useState('');
  const [newReport, setNewReport] = useState({
    name: '',
    description: '',
    frequency: 'daily' as 'daily' | 'weekly' | 'monthly',
    recipients: '',
    isActive: true,
  });

  // Fetch scheduled reports
  const { data: reports, refetch, isLoading } = trpc.scheduledReport.list.useQuery();

  // Mutations
  const createMutation = trpc.scheduledReport.create.useMutation({
    onSuccess: () => {
      toast.success(t('scheduledReports.createSuccess'));
      setIsCreateDialogOpen(false);
      setNewReport({
        name: '',
        description: '',
        frequency: 'daily',
        recipients: '',
        isActive: true,
      });
      refetch();
    },
    onError: (error) => {
      toast.error(t('scheduledReports.createError'), { description: error.message });
    },
  });

  const deleteMutation = trpc.scheduledReport.delete.useMutation({
    onSuccess: () => {
      toast.success(t('scheduledReports.deleteSuccess'));
      refetch();
    },
    onError: (error) => {
      toast.error(t('scheduledReports.deleteError'), { description: error.message });
    },
  });

  const updateMutation = trpc.scheduledReport.update.useMutation({
    onSuccess: () => {
      toast.success(t('scheduledReports.updateSuccess'));
      refetch();
    },
    onError: (error: any) => {
      toast.error(t('scheduledReports.updateError'), { description: error.message });
    },
  });

  const [previewFrequency, setPreviewFrequency] = useState<'daily' | 'weekly' | 'monthly' | null>(null);
  
  const { isFetching: previewLoading } = trpc.scheduledReport.previewStatisticsReport.useQuery(
    { frequency: previewFrequency! },
    { 
      enabled: !!previewFrequency,
    }
  );
  
  // Effect to handle preview data
  const previewQuery = trpc.scheduledReport.previewStatisticsReport.useQuery(
    { frequency: previewFrequency! },
    { enabled: false }
  );

  const sendMutation = trpc.scheduledReport.sendStatisticsReport.useMutation({
    onSuccess: () => {
      toast.success(t('scheduledReports.sendSuccess'));
    },
    onError: (error) => {
      toast.error(t('scheduledReports.sendError'), { description: error.message });
    },
  });

  const handleCreate = () => {
    const recipients = newReport.recipients
      .split(',')
      .map(e => e.trim())
      .filter(e => e.length > 0);

    if (recipients.length === 0) {
      toast.error(t('scheduledReports.recipientRequired'));
      return;
    }

    createMutation.mutate({
      name: newReport.name,
      description: newReport.description || undefined,
      schedule: newReport.frequency.toUpperCase() as 'DAILY' | 'WEEKLY' | 'MONTHLY',
      recipients,
      isActive: newReport.isActive,
    });
  };

  const handleDelete = (id: number) => {
    setDeleteTarget(id);
  };

  const confirmDelete = () => {
    if (deleteTarget != null) {
      deleteMutation.mutate({ id: deleteTarget });
    }
    setDeleteTarget(null);
  };

  const handleToggle = (id: number, isActive: boolean) => {
    updateMutation.mutate({ id, isActive: !isActive });
  };

  const handlePreview = async (frequency: 'daily' | 'weekly' | 'monthly') => {
    try {
      const result = await previewQuery.refetch();
      if (result.data) {
        setPreviewHtml(result.data.html);
        setIsPreviewDialogOpen(true);
      }
    } catch (error: any) {
      toast.error(t('scheduledReports.previewError'), { description: error.message });
    }
  };

  const handleSendNow = (schedule: 'DAILY' | 'WEEKLY' | 'MONTHLY', recipients: string[]) => {
    setSendTarget({ schedule, recipients });
  };

  const confirmSendNow = () => {
    if (sendTarget) {
      const frequency = sendTarget.schedule.toLowerCase() as 'daily' | 'weekly' | 'monthly';
      sendMutation.mutate({ name: `Manual ${frequency} report`, frequency, recipients: sendTarget.recipients });
    }
    setSendTarget(null);
  };

  const getFrequencyLabel = (schedule: string) => {
    switch (schedule) {
      case 'DAILY': return t('scheduledReports.daily');
      case 'WEEKLY': return t('scheduledReports.weekly');
      case 'MONTHLY': return t('scheduledReports.monthly');
      default: return schedule;
    }
  };

  const getFrequencyColor = (schedule: string) => {
    switch (schedule) {
      case 'DAILY': return 'bg-info/10 text-info border-info/30';
      case 'WEEKLY': return 'bg-success/10 text-success border-success/30';
      case 'MONTHLY': return 'bg-primary/10 text-primary border-primary/30';
      default: return '';
    }
  };

  return (
    <>
      <PageContainer>
        {/* Header */}
        <PageHeader
          icon={<FileBarChart className="h-6 w-6" />}
          title={t('scheduledReports.title')}
          description={t('scheduledReports.subtitle')}
          actions={
            <>
              <Button variant="outline" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                {t('common.refresh')}
              </Button>
              <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  {t('scheduledReports.createReport')}
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>{t('scheduledReports.createTitle')}</DialogTitle>
                  <DialogDescription>
                    {t('scheduledReports.createDesc')}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>{t('scheduledReports.reportName')}</Label>
                    <Input
                      placeholder={t('scheduledReports.reportNamePlaceholder')}
                      value={newReport.name}
                      onChange={(e) => setNewReport({ ...newReport, name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('scheduledReports.descriptionOptional')}</Label>
                    <Input
                      placeholder={t('scheduledReports.descriptionPlaceholder')}
                      value={newReport.description}
                      onChange={(e) => setNewReport({ ...newReport, description: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('scheduledReports.frequency')}</Label>
                    <Select
                      value={newReport.frequency}
                      onValueChange={(v) => setNewReport({ ...newReport, frequency: v as any })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="daily">{t('scheduledReports.daily')}</SelectItem>
                        <SelectItem value="weekly">{t('scheduledReports.weekly')}</SelectItem>
                        <SelectItem value="monthly">{t('scheduledReports.monthly')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>{t('scheduledReports.recipientEmails')}</Label>
                    <Input
                      placeholder="email1@example.com, email2@example.com"
                      value={newReport.recipients}
                      onChange={(e) => setNewReport({ ...newReport, recipients: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">
                      {t('scheduledReports.recipientHint')}
                    </p>
                  </div>
                  <div className="flex items-center justify-between">
                    <Label>{t('scheduledReports.activateNow')}</Label>
                    <Switch
                      checked={newReport.isActive}
                      onCheckedChange={(v) => setNewReport({ ...newReport, isActive: v })}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                    {t('common.cancel')}
                  </Button>
                  <Button onClick={handleCreate} disabled={createMutation.isPending}>
                    {createMutation.isPending ? t('scheduledReports.creating') : t('scheduledReports.createReport')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            </>
          }
        />

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="cursor-pointer hover:border-primary transition-colors" onClick={() => handlePreview('daily')}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Calendar className="h-4 w-4 text-info" />
                {t('scheduledReports.dailyReport')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                {t('scheduledReports.dailyPreviewDesc')}
              </p>
              <Button variant="link" className="p-0 h-auto mt-2" disabled={previewLoading}>
                <Eye className="h-3 w-3 mr-1" />
                {t('scheduledReports.preview')}
              </Button>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:border-primary transition-colors" onClick={() => handlePreview('weekly')}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Calendar className="h-4 w-4 text-success" />
                {t('scheduledReports.weeklyReport')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                {t('scheduledReports.weeklyPreviewDesc')}
              </p>
              <Button variant="link" className="p-0 h-auto mt-2" disabled={previewLoading}>
                <Eye className="h-3 w-3 mr-1" />
                {t('scheduledReports.preview')}
              </Button>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:border-primary transition-colors" onClick={() => handlePreview('monthly')}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Calendar className="h-4 w-4 text-primary" />
                {t('scheduledReports.monthlyReport')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                {t('scheduledReports.monthlyPreviewDesc')}
              </p>
              <Button variant="link" className="p-0 h-auto mt-2" disabled={previewLoading}>
                <Eye className="h-3 w-3 mr-1" />
                {t('scheduledReports.preview')}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Reports List */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileBarChart className="h-5 w-5 text-primary" />
              {t('scheduledReports.configuredReports')}
            </CardTitle>
            <CardDescription>
              {t('scheduledReports.configuredReportsDesc')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-4">
                    <Skeleton className="h-5 w-1/3" />
                    <Skeleton className="h-5 w-24" />
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="ml-auto h-8 w-24" />
                  </div>
                ))}
              </div>
            ) : !reports || reports.length === 0 ? (
              <EmptyState
                variant="no-data"
                icon={FileBarChart}
                title={t('scheduledReports.noReports')}
                actionLabel={t('scheduledReports.createFirst')}
                onAction={() => setIsCreateDialogOpen(true)}
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('scheduledReports.reportName')}</TableHead>
                    <TableHead>{t('scheduledReports.frequency')}</TableHead>
                    <TableHead>{t('scheduledReports.recipients')}</TableHead>
                    <TableHead>{t('scheduledReports.status')}</TableHead>
                    <TableHead>{t('scheduledReports.lastSent')}</TableHead>
                    <TableHead className="text-right">{t('scheduledReports.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reports.map((report) => (
                    <TableRow key={report.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{report.name}</p>
                          {report.description && (
                            <p className="text-xs text-muted-foreground">{report.description}</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={getFrequencyColor(report.schedule)}>
                          {getFrequencyLabel(report.schedule)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {report.recipients.slice(0, 2).map((email, idx) => (
                            <Badge key={idx} variant="secondary" className="text-xs">
                              {email}
                            </Badge>
                          ))}
                          {report.recipients.length > 2 && (
                            <Badge variant="secondary" className="text-xs">
                              +{report.recipients.length - 2}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {report.isActive ? (
                          <Badge variant="outline" className="bg-success/10 text-success border-success/30">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            {t('scheduledReports.active')}
                          </Badge>
                        ) : (
                          <Badge variant="secondary">
                            <Pause className="h-3 w-3 mr-1" />
                            {t('scheduledReports.paused')}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {report.lastSentAt ? (
                          <span className="text-sm">
                            {new Date(report.lastSentAt).toLocaleString('vi-VN')}
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">{t('scheduledReports.notSent')}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleSendNow(report.schedule, report.recipients)}
                            disabled={sendMutation.isPending}
                            title={t('scheduledReports.sendNow')}
                          >
                            <Send className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleToggle(report.id, report.isActive)}
                            title={report.isActive ? t('scheduledReports.paused') : t('scheduledReports.activate')}
                          >
                            {report.isActive ? (
                              <Pause className="h-4 w-4" />
                            ) : (
                              <Play className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(report.id)}
                            className="text-destructive hover:text-destructive"
                            title={t('common.delete')}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Preview Dialog */}
        <Dialog open={isPreviewDialogOpen} onOpenChange={setIsPreviewDialogOpen}>
          <DialogContent className="max-w-4xl max-h-[80vh] overflow-auto">
            <DialogHeader>
              <DialogTitle>{t('scheduledReports.previewTitle')}</DialogTitle>
              <DialogDescription>
                {t('scheduledReports.previewDesc')}
              </DialogDescription>
            </DialogHeader>
            <div 
              className="border rounded-lg p-4 bg-white"
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(previewHtml) }}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsPreviewDialogOpen(false)}>
                {t('common.close')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Info Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t('scheduledReports.guide')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div className="p-3 bg-info/10 rounded-lg">
                <h4 className="font-medium text-info mb-1">{t('scheduledReports.dailyReport')}</h4>
                <p className="text-muted-foreground text-xs">
                  {t('scheduledReports.dailyGuideDesc')}
                </p>
              </div>
              <div className="p-3 bg-success/10 rounded-lg">
                <h4 className="font-medium text-success mb-1">{t('scheduledReports.weeklyReport')}</h4>
                <p className="text-muted-foreground text-xs">
                  {t('scheduledReports.weeklyGuideDesc')}
                </p>
              </div>
              <div className="p-3 bg-primary/10 rounded-lg">
                <h4 className="font-medium text-primary mb-1">{t('scheduledReports.monthlyReport')}</h4>
                <p className="text-muted-foreground text-xs">
                  {t('scheduledReports.monthlyGuideDesc')}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Delete confirmation */}
        <AlertDialog open={deleteTarget != null} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('scheduledReports.deleteTitle', 'Delete scheduled report?')}</AlertDialogTitle>
              <AlertDialogDescription>{t('scheduledReports.deleteConfirm')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
              <AlertDialogAction
                onClick={confirmDelete}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {t('common.delete')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Send-now confirmation */}
        <AlertDialog open={sendTarget != null} onOpenChange={(open) => { if (!open) setSendTarget(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('scheduledReports.sendNow')}</AlertDialogTitle>
              <AlertDialogDescription>
                {sendTarget
                  ? t('scheduledReports.sendConfirm', {
                      frequency: getFrequencyLabel(sendTarget.schedule),
                      count: sendTarget.recipients.length,
                    })
                  : ''}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
              <AlertDialogAction onClick={confirmSendNow}>{t('scheduledReports.sendNow')}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </PageContainer>
    </>
  );
}

export default function ScheduledReports() {
  return (
    <DashboardLayout>
      <ScheduledReportsContent />
    </DashboardLayout>
  );
}
