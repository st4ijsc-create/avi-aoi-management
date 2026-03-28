import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { trpc } from "@/lib/trpc";
import {
  Clock, Mail, Plus, Trash2, Edit, Play, Pause,
  Send, Loader2, CalendarClock, FileText, FileSpreadsheet,
  Presentation, Globe, CheckCircle2, XCircle, MailPlus, Timer,
  Calendar, BarChart3, GitCompareArrows, LayoutTemplate, Layers,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from 'react-i18next';
import { useState } from "react";

const REPORT_TYPE_LABELS: Record<string, { labelKey: string; icon: React.ReactNode; color: string }> = {
  quality_summary: { labelKey: "reports.qualitySummary", icon: <BarChart3 className="h-4 w-4" />, color: "text-blue-500" },
  comparison: { labelKey: "reports.dataComparison", icon: <GitCompareArrows className="h-4 w-4" />, color: "text-green-500" },
  custom_builder: { labelKey: "reports.customReport", icon: <LayoutTemplate className="h-4 w-4" />, color: "text-purple-500" },
  combined: { labelKey: "reports.combined", icon: <Layers className="h-4 w-4" />, color: "text-orange-500" },
};

const FREQUENCY_LABELS: Record<string, string> = {
  daily: "reports.daily",
  weekly: "reports.weekly",
  monthly: "reports.monthly",
};

const FORMAT_OPTIONS = [
  { value: "pdf", label: "PDF", icon: <FileText className="h-3 w-3" /> },
  { value: "excel", label: "Excel", icon: <FileSpreadsheet className="h-3 w-3" /> },
  { value: "pptx", label: "PowerPoint", icon: <Presentation className="h-3 w-3" /> },
  { value: "html", label: "HTML", icon: <Globe className="h-3 w-3" /> },
];

interface ScheduleForm {
  name: string;
  type: string;
  frequency: string;
  scheduleTime: string;
  scheduleDayOfWeek: number;
  scheduleDayOfMonth: number;
  recipients: string;
  factoryId: string;
  comparisonType: string;
  customReportId: string;
  attachmentFormats: string[];
  includeInlineHtml: boolean;
  isActive: boolean;
}

const DEFAULT_FORM: ScheduleForm = {
  name: "",
  type: "quality_summary",
  frequency: "weekly",
  scheduleTime: "08:00",
  scheduleDayOfWeek: 1,
  scheduleDayOfMonth: 1,
  recipients: "",
  factoryId: "",
  comparisonType: "week",
  customReportId: "",
  attachmentFormats: ["pdf"],
  includeInlineHtml: true,
  isActive: true,
};

export function EnhancedScheduledReportsContent() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [showDialog, setShowDialog] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ScheduleForm>({ ...DEFAULT_FORM });

  // Use existing scheduledReport router
  const { data: reports, refetch } = trpc.scheduledReport.list.useQuery();
  const { data: factories } = trpc.factory.list.useQuery();
  const { data: customReports } = trpc.reportBuilder.list.useQuery();

  const createMutation = trpc.scheduledReport.create.useMutation({
    onSuccess: () => {
      toast.success(t('reports.scheduleCreated'));
      refetch();
      setShowDialog(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMutation = trpc.scheduledReport.update.useMutation({
    onSuccess: () => {
      toast.success(t('reports.scheduleUpdated'));
      refetch();
      setShowDialog(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.scheduledReport.delete.useMutation({
    onSuccess: () => {
      toast.success(t('reports.scheduleDeleted'));
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...DEFAULT_FORM });
    setShowDialog(true);
  };

  const openEdit = (report: any) => {
    setEditingId(report.id);
    const config = report.config ? (typeof report.config === "string" ? JSON.parse(report.config) : report.config) : {};
    setForm({
      name: report.name || "",
      type: config.type || "quality_summary",
      frequency: report.frequency || "weekly",
      scheduleTime: config.scheduleTime || "08:00",
      scheduleDayOfWeek: config.scheduleDayOfWeek ?? 1,
      scheduleDayOfMonth: config.scheduleDayOfMonth ?? 1,
      recipients: (report.recipients || []).join(", "),
      factoryId: config.factoryId ? String(config.factoryId) : "",
      comparisonType: config.comparisonType || "week",
      customReportId: config.customReportId ? String(config.customReportId) : "",
      attachmentFormats: config.attachmentFormats || ["pdf"],
      includeInlineHtml: config.includeInlineHtml ?? true,
      isActive: report.isActive ?? true,
    });
    setShowDialog(true);
  };

  const handleSave = () => {
    if (!form.name.trim()) {
      toast.error(t('reports.pleaseEnterScheduleName'));
      return;
    }
    const recipients = form.recipients.split(",").map((r) => r.trim()).filter(Boolean);
    if (recipients.length === 0) {
      toast.error(t('reports.pleaseEnterAtLeastOneEmail'));
      return;
    }

    const payload: any = {
      name: form.name,
      frequency: form.frequency,
      recipients,
      isActive: form.isActive,
      reportType: form.type,
      config: {
        type: form.type,
        scheduleTime: form.scheduleTime,
        scheduleDayOfWeek: form.scheduleDayOfWeek,
        scheduleDayOfMonth: form.scheduleDayOfMonth,
        factoryId: form.factoryId ? parseInt(form.factoryId) : undefined,
        comparisonType: form.comparisonType,
        customReportId: form.customReportId ? parseInt(form.customReportId) : undefined,
        attachmentFormats: form.attachmentFormats,
        includeInlineHtml: form.includeInlineHtml,
      },
    };

    if (editingId) {
      updateMutation.mutate({ id: editingId, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const toggleFormat = (fmt: string) => {
    setForm((prev) => ({
      ...prev,
      attachmentFormats: prev.attachmentFormats.includes(fmt)
        ? prev.attachmentFormats.filter((f) => f !== fmt)
        : [...prev.attachmentFormats, fmt],
    }));
  };

  // Stats
  const activeCount = (reports || []).filter((r: any) => r.isActive).length;
  const totalCount = (reports || []).length;

  return (
    <>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <CalendarClock className="h-6 w-6 text-primary" />
              {t('reports.enhancedScheduledReports')}
            </h1>
            <p className="text-muted-foreground mt-1">
              {t('reports.enhancedScheduledReportsDescription')}
            </p>
          </div>
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" /> {t('reports.createNewSchedule')}
          </Button>
        </div>

        {/* Stats */}
        <div className="grid md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Timer className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <div className="text-2xl font-bold">{totalCount}</div>
                <div className="text-xs text-muted-foreground">{t('reports.totalSchedules')}</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                <Play className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <div className="text-2xl font-bold">{activeCount}</div>
                <div className="text-xs text-muted-foreground">{t('reports.active')}</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <Pause className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <div className="text-2xl font-bold">{totalCount - activeCount}</div>
                <div className="text-xs text-muted-foreground">{t('reports.paused')}</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                <Mail className="h-5 w-5 text-purple-500" />
              </div>
              <div>
                <div className="text-2xl font-bold">
                  {new Set((reports || []).flatMap((r: any) => r.recipients || [])).size}
                </div>
                <div className="text-xs text-muted-foreground">{t('reports.recipients')}</div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Report list */}
        <div className="space-y-3">
          {(reports || []).map((report: any) => {
            const config = report.config ? (typeof report.config === "string" ? JSON.parse(report.config) : report.config) : {};
            const typeInfo = REPORT_TYPE_LABELS[config.type] || REPORT_TYPE_LABELS.quality_summary;
            return (
              <Card key={report.id} className={`transition-opacity ${!report.isActive ? "opacity-60" : ""}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <div className={`h-10 w-10 rounded-lg bg-muted flex items-center justify-center ${typeInfo.color}`}>
                        {typeInfo.icon}
                      </div>
                      <div>
                        <div className="font-medium flex items-center gap-2">
                          {report.name}
                          <Badge variant={report.isActive ? "default" : "secondary"} className="text-[10px]">
                            {report.isActive ? t('reports.active') : t('reports.paused')}
                          </Badge>
                          <Badge variant="outline" className="text-[10px]">
                            {t(typeInfo.labelKey)}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 flex items-center gap-3">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {t(FREQUENCY_LABELS[report.frequency] || report.frequency)}
                            {config.scheduleTime && ` ${t('reports.at')} ${config.scheduleTime}`}
                          </span>
                          <span className="flex items-center gap-1">
                            <Mail className="h-3 w-3" />
                            {(report.recipients || []).length} {t('reports.recipients')}
                          </span>
                          {config.attachmentFormats && (
                            <span className="flex items-center gap-1">
                              {(config.attachmentFormats || []).map((fmt: string) => (
                                <Badge key={fmt} variant="outline" className="text-[9px] px-1">
                                  {fmt.toUpperCase()}
                                </Badge>
                              ))}
                            </span>
                          )}
                        </div>
                        {report.lastSentAt && (
                          <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3 text-green-500" />
                            {t('reports.lastSent')}: {new Date(report.lastSentAt).toLocaleString("vi-VN")}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button variant="outline" size="sm" onClick={() => openEdit(report)}>
                        <Edit className="h-3 w-3 mr-1" /> {t('common.edit')}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => {
                          if (confirm(t('reports.confirmDeleteSchedule'))) deleteMutation.mutate({ id: report.id });
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}

          {(!reports || reports.length === 0) && (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <CalendarClock className="h-16 w-16 mb-4 opacity-30" />
              <p className="text-lg">{t('reports.noSchedules')}</p>
              <p className="text-sm mt-1">{t('reports.noSchedulesDescription')}</p>
              <Button className="mt-4" onClick={openCreate}>
                <Plus className="h-4 w-4 mr-1" /> {t('reports.createNewSchedule')}
              </Button>
            </div>
          )}
        </div>

        {/* Create/Edit Dialog */}
        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingId ? t('reports.editSchedule') : t('reports.createNewScheduleTitle')}
              </DialogTitle>
              <DialogDescription className="sr-only">
                {editingId ? t('reports.editSchedule') : t('reports.createNewScheduleTitle')}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {/* Basic info */}
              <div className="space-y-1">
                <Label className="text-xs">{t('reports.scheduleName')}</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder={t('reports.scheduleNamePlaceholder')}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">{t('reports.reportType')}</Label>
                  <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(REPORT_TYPE_LABELS).map(([key, info]) => (
                        <SelectItem key={key} value={key}>
                          <span className="flex items-center gap-1">{info.icon} {t(info.labelKey)}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t('reports.frequency')}</Label>
                  <Select value={form.frequency} onValueChange={(v) => setForm({ ...form, frequency: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">{t('reports.daily')}</SelectItem>
                      <SelectItem value="weekly">{t('reports.weekly')}</SelectItem>
                      <SelectItem value="monthly">{t('reports.monthly')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">{t('reports.sendTime')}</Label>
                  <Input
                    type="time"
                    value={form.scheduleTime}
                    onChange={(e) => setForm({ ...form, scheduleTime: e.target.value })}
                  />
                </div>
                {form.frequency === "weekly" && (
                  <div className="space-y-1">
                    <Label className="text-xs">{t('reports.dayOfWeek')}</Label>
                    <Select
                      value={String(form.scheduleDayOfWeek)}
                      onValueChange={(v) => setForm({ ...form, scheduleDayOfWeek: parseInt(v) })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {[t('reports.sun'), t('reports.mon'), t('reports.tue'), t('reports.wed'), t('reports.thu'), t('reports.fri'), t('reports.sat')].map((d, i) => (
                          <SelectItem key={i} value={String(i)}>{d}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {form.frequency === "monthly" && (
                  <div className="space-y-1">
                    <Label className="text-xs">{t('reports.dayOfMonth')}</Label>
                    <Input
                      type="number"
                      min={1}
                      max={31}
                      value={form.scheduleDayOfMonth}
                      onChange={(e) => setForm({ ...form, scheduleDayOfMonth: parseInt(e.target.value) || 1 })}
                    />
                  </div>
                )}
              </div>

              <Separator />

              {/* Recipients */}
              <div className="space-y-1">
                <Label className="text-xs">{t('reports.recipientEmails')}</Label>
                <Input
                  value={form.recipients}
                  onChange={(e) => setForm({ ...form, recipients: e.target.value })}
                  placeholder="user1@company.com, user2@company.com"
                />
              </div>

              {/* Filters */}
              <div className="space-y-1">
                <Label className="text-xs">{t('reports.factoryOptional')}</Label>
                <Select value={form.factoryId || 'all'} onValueChange={(v) => setForm({ ...form, factoryId: v === 'all' ? '' : v })}>
                  <SelectTrigger><SelectValue placeholder={t('common.all')} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('common.all')}</SelectItem>
                    {(factories || []).map((f: any) => (
                      <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Type-specific options */}
              {form.type === "comparison" && (
                <div className="space-y-1">
                  <Label className="text-xs">{t('reports.comparisonPeriod')}</Label>
                  <Select value={form.comparisonType} onValueChange={(v) => setForm({ ...form, comparisonType: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="week">{t('reports.week')}</SelectItem>
                      <SelectItem value="month">{t('reports.month')}</SelectItem>
                      <SelectItem value="quarter">{t('reports.quarter')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {form.type === "custom_builder" && (
                <div className="space-y-1">
                  <Label className="text-xs">{t('reports.selectCustomReport')}</Label>
                  <Select value={form.customReportId} onValueChange={(v) => setForm({ ...form, customReportId: v })}>
                    <SelectTrigger><SelectValue placeholder={t('reports.selectPlaceholder')} /></SelectTrigger>
                    <SelectContent>
                      {((customReports as any)?.reports || []).map((r: any) => (
                        <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <Separator />

              {/* Attachment formats */}
              <div className="space-y-2">
                <Label className="text-xs">{t('reports.attachmentFormat')}</Label>
                <div className="flex gap-3">
                  {FORMAT_OPTIONS.map((opt) => (
                    <label key={opt.value} className="flex items-center gap-1.5 cursor-pointer">
                      <Checkbox
                        checked={form.attachmentFormats.includes(opt.value)}
                        onCheckedChange={() => toggleFormat(opt.value)}
                      />
                      <span className="text-xs flex items-center gap-1">{opt.icon} {opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <Label className="text-xs">{t('reports.includeHtmlInEmail')}</Label>
                <Switch
                  checked={form.includeInlineHtml}
                  onCheckedChange={(v) => setForm({ ...form, includeInlineHtml: v })}
                />
              </div>

              <div className="flex items-center justify-between">
                <Label className="text-xs">{t('reports.activateNow')}</Label>
                <Switch
                  checked={form.isActive}
                  onCheckedChange={(v) => setForm({ ...form, isActive: v })}
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDialog(false)}>{t('common.cancel')}</Button>
              <Button onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending}>
                {(createMutation.isPending || updateMutation.isPending) ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <MailPlus className="h-4 w-4 mr-1" />
                )}
                {editingId ? t('reports.update') : t('reports.createSchedule')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}

export default function EnhancedScheduledReports() {
  return (
    <DashboardLayout>
      <EnhancedScheduledReportsContent />
    </DashboardLayout>
  );
}
