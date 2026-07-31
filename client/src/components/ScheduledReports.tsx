import { useState, useRef } from "react";
import { useTranslation } from 'react-i18next';
import { trpc } from "@/lib/trpc";
import { mapTrpcError } from "@/lib/trpcErrors";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Loader2, Mail, Calendar, Users, Filter, Send, Palette, Image, FileText, Upload, Eye } from "lucide-react";
import { DeleteConfirmDialog } from "./ConfirmDialog";

type ScheduledReport = {
  id: number;
  name: string;
  reportType: "NG_VISUAL" | "DAILY_SUMMARY" | "WEEKLY_SUMMARY" | "MONTHLY_SUMMARY" | "CUSTOM" | "OEE_REPORT" | "MACHINE_HEALTH";
  schedule: "DAILY" | "WEEKLY" | "MONTHLY";
  scheduleDayOfWeek?: number | null;
  scheduleDayOfMonth?: number | null;
  recipients: string[];
  factoryId?: number | null;
  workshopId?: number | null;
  lineId?: number | null;
  isActive: boolean;
  lastSentAt?: Date | null;
  nextScheduledAt?: Date | null;
  createdAt: Date;
  // Customization fields
  reportFormat?: "HTML" | "PDF" | "EXCEL";
  logoUrl?: string | null;
  primaryColor?: string | null;
  footerText?: string | null;
};

export default function ScheduledReports() {
  const { t } = useTranslation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingReport, setEditingReport] = useState<ScheduledReport | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [reportToDelete, setReportToDelete] = useState<ScheduledReport | null>(null);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [previewReportId, setPreviewReportId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    name: "",
    reportType: "NG_VISUAL" as "NG_VISUAL" | "DAILY_SUMMARY" | "WEEKLY_SUMMARY" | "MONTHLY_SUMMARY" | "CUSTOM" | "OEE_REPORT" | "MACHINE_HEALTH",
    schedule: "DAILY" as "DAILY" | "WEEKLY" | "MONTHLY",
    scheduleDayOfWeek: undefined as number | undefined,
    scheduleDayOfMonth: undefined as number | undefined,
    recipients: "",
    factoryId: undefined as number | undefined,
    workshopId: undefined as number | undefined,
    lineId: undefined as number | undefined,
    // Customization fields
    reportFormat: "HTML" as "HTML" | "PDF" | "EXCEL",
    logoUrl: "",
    primaryColor: "#3b82f6",
    footerText: "",
  });

  // Queries
  const { data: reports, isLoading } = trpc.scheduledReport.list.useQuery();
  const { data: factories } = trpc.factory.list.useQuery();
  const { data: workshops } = trpc.workshop.list.useQuery();
  const { data: lines } = trpc.line.list.useQuery();

  // Mutations
  const utils = trpc.useUtils();
  const createMutation = trpc.scheduledReport.create.useMutation({
    onSuccess: () => {
      toast.success(t('reports.reportCreated'));
      utils.scheduledReport.list.invalidate();
      setDialogOpen(false);
      resetForm();
    },
    onError: (error) => {
      toast.error(t('common.errorMessage', { message: mapTrpcError(error) }));
    },
  });

  const updateMutation = trpc.scheduledReport.update.useMutation({
    onSuccess: () => {
      toast.success(t('reports.reportUpdated'));
      utils.scheduledReport.list.invalidate();
      setDialogOpen(false);
      setEditingReport(null);
      resetForm();
    },
    onError: (error) => {
      toast.error(t('common.errorMessage', { message: mapTrpcError(error) }));
    },
  });

  const deleteMutation = trpc.scheduledReport.delete.useMutation({
    onSuccess: () => {
      toast.success(t('reports.reportDeleted'));
      utils.scheduledReport.list.invalidate();
      setDeleteDialogOpen(false);
      setReportToDelete(null);
    },
    onError: (error) => {
      toast.error(t('common.errorMessage', { message: mapTrpcError(error) }));
    },
  });

  const toggleMutation = trpc.scheduledReport.update.useMutation({
    onSuccess: () => {
      toast.success(t('reports.statusUpdated'));
      utils.scheduledReport.list.invalidate();
    },
    onError: (error: any) => {
      toast.error(t('common.errorMessage', { message: mapTrpcError(error) }));
    },
  });

  const sendTestMutation = trpc.scheduledReport.sendTest.useMutation({
    onSuccess: () => {
      toast.success(t('reports.testEmailSent'));
      utils.scheduledReport.list.invalidate();
    },
    onError: (error: any) => {
      toast.error(t('reports.errorSendEmail', { message: mapTrpcError(error) }));
    },
  });

  const uploadLogoMutation = trpc.scheduledReport.uploadLogo.useMutation({
    onSuccess: (data) => {
      setForm({ ...form, logoUrl: data.url });
      toast.success(t('reports.logoUploaded'));
      setIsUploadingLogo(false);
    },
    onError: (error: any) => {
      toast.error(t('reports.errorUpload', { message: mapTrpcError(error) }));
      setIsUploadingLogo(false);
    },
  });

  const resetForm = () => {
    setForm({
      name: "",
      reportType: "NG_VISUAL",
      schedule: "DAILY",
      scheduleDayOfWeek: undefined,
      scheduleDayOfMonth: undefined,
      recipients: "",
      factoryId: undefined,
      workshopId: undefined,
      lineId: undefined,
      reportFormat: "HTML",
      logoUrl: "",
      primaryColor: "#3b82f6",
      footerText: "",
    });
  };

  const handleCreate = () => {
    setEditingReport(null);
    resetForm();
    setDialogOpen(true);
  };

  const handleEdit = (report: ScheduledReport) => {
    setEditingReport(report);
    setForm({
      name: report.name,
      reportType: report.reportType,
      schedule: report.schedule,
      scheduleDayOfWeek: report.scheduleDayOfWeek ?? undefined,
      scheduleDayOfMonth: report.scheduleDayOfMonth ?? undefined,
      recipients: report.recipients.join(", "),
      factoryId: report.factoryId ?? undefined,
      workshopId: report.workshopId ?? undefined,
      lineId: report.lineId ?? undefined,
      reportFormat: report.reportFormat || "HTML",
      logoUrl: report.logoUrl || "",
      primaryColor: report.primaryColor || "#3b82f6",
      footerText: report.footerText || "",
    });
    setDialogOpen(true);
  };

  const handleDelete = (report: ScheduledReport) => {
    setReportToDelete(report);
    setDeleteDialogOpen(true);
  };

  const handlePreview = (reportId: number) => {
    setPreviewReportId(reportId);
    setPreviewDialogOpen(true);
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      toast.error(t('reports.selectImageFile'));
      return;
    }

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      toast.error(t('reports.fileTooLarge'));
      return;
    }

    setIsUploadingLogo(true);

    // Convert to base64
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      uploadLogoMutation.mutate({
        base64,
        filename: file.name,
        mimeType: file.type,
      });
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = () => {
    const recipientsArray = form.recipients
      .split(",")
      .map((email) => email.trim())
      .filter((email) => email.length > 0);

    if (!form.name || recipientsArray.length === 0) {
      toast.error(t('reports.fillRequiredInfo'));
      return;
    }

    const data = {
      name: form.name,
      reportType: form.reportType,
      schedule: form.schedule,
      scheduleDayOfWeek: form.schedule === "WEEKLY" ? form.scheduleDayOfWeek : undefined,
      scheduleDayOfMonth: form.schedule === "MONTHLY" ? form.scheduleDayOfMonth : undefined,
      recipients: recipientsArray,
      factoryId: form.factoryId,
      workshopId: form.workshopId,
      lineId: form.lineId,
      reportFormat: form.reportFormat,
      logoUrl: form.logoUrl || undefined,
      primaryColor: form.primaryColor || undefined,
      footerText: form.footerText || undefined,
    };

    if (editingReport) {
      updateMutation.mutate({ id: editingReport.id, ...data });
    } else {
      createMutation.mutate(data);
    }
  };

  const formatSchedule = (report: ScheduledReport) => {
    if (report.schedule === "DAILY") return t('reports.daily');
    if (report.schedule === "WEEKLY") {
      const days = [t('reports.sunday'), t('reports.monday'), t('reports.tuesday'), t('reports.wednesday'), t('reports.thursday'), t('reports.friday'), t('reports.saturday')];
      return t('reports.weeklyOn', { day: days[report.scheduleDayOfWeek ?? 0] });
    }
    if (report.schedule === "MONTHLY") {
      return t('reports.monthlyOnDay', { day: report.scheduleDayOfMonth });
    }
    return report.schedule;
  };

  const formatReportType = (type: string) => {
    if (type === "NG_VISUAL") return "NG Visual";
    if (type === "DAILY_SUMMARY") return t('reports.dailySummary');
    if (type === "WEEKLY_SUMMARY") return t('reports.weeklySummary');
    if (type === "MONTHLY_SUMMARY") return t('reports.monthlySummary');
    if (type === "CUSTOM") return t('reports.custom');
    if (type === "OEE_REPORT") return t('reports.oeeReport');
    if (type === "MACHINE_HEALTH") return t('reports.machineHealth');
    return type;
  };

  const formatReportFormat = (format?: string) => {
    if (format === "PDF") return "PDF";
    if (format === "EXCEL") return "Excel";
    return "HTML";
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{t('reports.scheduledReports')}</CardTitle>
            <CardDescription>
              {t('reports.scheduledReportsDesc')}
            </CardDescription>
          </div>
          <Button onClick={handleCreate} className="gap-2">
            <Plus className="h-4 w-4" />
            {t('reports.createNewReport')}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : reports && reports.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('reports.reportName')}</TableHead>
                <TableHead>{t('common.type')}</TableHead>
                <TableHead>{t('reports.format')}</TableHead>
                <TableHead>{t('reports.sendSchedule')}</TableHead>
                <TableHead>{t('reports.recipients')}</TableHead>
                <TableHead>{t('reports.lastSent')}</TableHead>
                <TableHead>{t('common.status')}</TableHead>
                <TableHead className="text-right">{t('common.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reports.map((report) => (
                <TableRow key={report.id}>
                  <TableCell className="font-medium">{report.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{formatReportType(report.reportType)}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{formatReportFormat((report as any).reportFormat)}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 text-sm">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      {formatSchedule(report)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 text-sm">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      {report.recipients.length} {t('reports.people')}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {report.lastSentAt
                      ? new Date(report.lastSentAt).toLocaleString("vi-VN")
                      : t('reports.notSentYet')}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={report.isActive}
                      onCheckedChange={() => toggleMutation.mutate({ id: report.id, isActive: !report.isActive })}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handlePreview(report.id)}
                        className="h-8 w-8 p-0"
                        title={t('reports.previewEmail')}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => sendTestMutation.mutate({ id: report.id })}
                        disabled={sendTestMutation.isPending}
                        className="h-8 w-8 p-0"
                        title={t('reports.sendTest')}
                      >
                        <Send className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEdit(report)}
                        className="h-8 w-8 p-0"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(report)}
                        className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Mail className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">{t('reports.noScheduledReports')}</h3>
            <p className="text-sm text-muted-foreground mb-4">
              {t('reports.noScheduledReportsDesc')}
            </p>
            <Button onClick={handleCreate} className="gap-2">
              <Plus className="h-4 w-4" />
              {t('reports.createNewReport')}
            </Button>
          </div>
        )}

        {/* Create/Edit Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingReport ? t('reports.editReport') : t('reports.createScheduledReport')}
              </DialogTitle>
              <DialogDescription>
                {t('reports.configAutoReport')}
              </DialogDescription>
            </DialogHeader>
            
            <Tabs defaultValue="basic" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="basic" className="gap-2">
                  <FileText className="h-4 w-4" />
                  {t('reports.basic')}
                </TabsTrigger>
                <TabsTrigger value="customization" className="gap-2">
                  <Palette className="h-4 w-4" />
                  {t('reports.customization')}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="basic" className="space-y-4 mt-4">
                <div className="grid gap-2">
                  <Label htmlFor="name">{t('reports.reportName')} *</Label>
                  <Input
                    id="name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder={t('reports.reportNamePlaceholder')}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="reportType">{t('reports.reportType')}</Label>
                    <Select
                      value={form.reportType}
                      onValueChange={(value: any) => setForm({ ...form, reportType: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NG_VISUAL">NG Visual</SelectItem>
                        <SelectItem value="DAILY_SUMMARY">{t('reports.dailySummary')}</SelectItem>
                        <SelectItem value="WEEKLY_SUMMARY">{t('reports.weeklySummary')}</SelectItem>
                        <SelectItem value="MONTHLY_SUMMARY">{t('reports.monthlySummary')}</SelectItem>
                        <SelectItem value="CUSTOM">{t('reports.custom')}</SelectItem>
                        <SelectItem value="OEE_REPORT">{t('reports.oeeReport')}</SelectItem>
                        <SelectItem value="MACHINE_HEALTH">{t('reports.machineHealth')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="schedule">{t('reports.sendSchedule')}</Label>
                    <Select
                      value={form.schedule}
                      onValueChange={(value: any) => setForm({ ...form, schedule: value })}
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
                </div>

                {form.schedule === "WEEKLY" && (
                  <div className="grid gap-2">
                    <Label htmlFor="dayOfWeek">{t('reports.dayOfWeek')}</Label>
                    <Select
                      value={form.scheduleDayOfWeek?.toString()}
                      onValueChange={(value) =>
                        setForm({ ...form, scheduleDayOfWeek: parseInt(value) })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t('reports.selectDay')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">{t('reports.sunday')}</SelectItem>
                        <SelectItem value="1">{t('reports.monday')}</SelectItem>
                        <SelectItem value="2">{t('reports.tuesday')}</SelectItem>
                        <SelectItem value="3">{t('reports.wednesday')}</SelectItem>
                        <SelectItem value="4">{t('reports.thursday')}</SelectItem>
                        <SelectItem value="5">{t('reports.friday')}</SelectItem>
                        <SelectItem value="6">{t('reports.saturday')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {form.schedule === "MONTHLY" && (
                  <div className="grid gap-2">
                    <Label htmlFor="dayOfMonth">{t('reports.dayOfMonth')}</Label>
                    <Input
                      id="dayOfMonth"
                      type="number"
                      min="1"
                      max="31"
                      value={form.scheduleDayOfMonth || ""}
                      onChange={(e) =>
                        setForm({ ...form, scheduleDayOfMonth: parseInt(e.target.value) || undefined })
                      }
                      placeholder="1-31"
                    />
                  </div>
                )}

                <div className="grid gap-2">
                  <Label htmlFor="recipients">{t('reports.recipientsEmail')} *</Label>
                  <Input
                    id="recipients"
                    value={form.recipients}
                    onChange={(e) => setForm({ ...form, recipients: e.target.value })}
                    placeholder="email1@example.com, email2@example.com"
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('reports.multipleEmailsHint')}
                  </p>
                </div>

                <div className="grid gap-2">
                  <Label className="flex items-center gap-2">
                    <Filter className="h-4 w-4" />
                    {t('reports.filterOptional')}
                  </Label>
                  <div className="grid grid-cols-3 gap-4">
                    <Select
                      value={form.factoryId?.toString() || "all"}
                      onValueChange={(value) =>
                        setForm({ ...form, factoryId: value === "all" ? undefined : parseInt(value) })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t('reports.factory')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t('reports.allFactories')}</SelectItem>
                        {factories?.map((f) => (
                          <SelectItem key={f.id} value={f.id.toString()}>
                            {f.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Select
                      value={form.workshopId?.toString() || "all"}
                      onValueChange={(value) =>
                        setForm({ ...form, workshopId: value === "all" ? undefined : parseInt(value) })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t('reports.workshop')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t('reports.allWorkshops')}</SelectItem>
                        {workshops?.map((w) => (
                          <SelectItem key={w.id} value={w.id.toString()}>
                            {w.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Select
                      value={form.lineId?.toString() || "all"}
                      onValueChange={(value) =>
                        setForm({ ...form, lineId: value === "all" ? undefined : parseInt(value) })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Line" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t('reports.allLines')}</SelectItem>
                        {lines?.map((l) => (
                          <SelectItem key={l.id} value={l.id.toString()}>
                            {l.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="customization" className="space-y-4 mt-4">
                {/* Report Format */}
                <div className="grid gap-2">
                  <Label htmlFor="reportFormat">{t('reports.reportFormat')}</Label>
                  <Select
                    value={form.reportFormat}
                    onValueChange={(value: "HTML" | "PDF" | "EXCEL") => setForm({ ...form, reportFormat: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="HTML">{t('reports.htmlDirect')}</SelectItem>
                      <SelectItem value="PDF">{t('reports.pdfAttachment')}</SelectItem>
                      <SelectItem value="EXCEL">{t('reports.excelAttachment')}</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {t('reports.formatDescription')}
                  </p>
                </div>

                {/* Logo Upload */}
                <div className="grid gap-2">
                  <Label className="flex items-center gap-2">
                    <Image className="h-4 w-4" />
                    {t('reports.customLogo')}
                  </Label>
                  <div className="flex items-center gap-4">
                    {form.logoUrl ? (
                      <div className="relative">
                        <img
                          src={form.logoUrl}
                          alt="Logo preview"
                          className="h-16 w-auto object-contain border rounded"
                        />
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          className="absolute -top-2 -right-2 h-6 w-6 p-0 rounded-full"
                          onClick={() => setForm({ ...form, logoUrl: "" })}
                        >
                          ×
                        </Button>
                      </div>
                    ) : (
                      <div className="h-16 w-32 border-2 border-dashed rounded flex items-center justify-center text-muted-foreground text-sm">
                        {t('reports.noLogo')}
                      </div>
                    )}
                    <div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleLogoUpload}
                        className="hidden"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isUploadingLogo}
                      >
                        {isUploadingLogo ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        ) : (
                          <Upload className="h-4 w-4 mr-2" />
                        )}
                        Upload logo
                      </Button>
                      <p className="text-xs text-muted-foreground mt-1">
                        {t('reports.maxFileSize')}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Primary Color */}
                <div className="grid gap-2">
                  <Label className="flex items-center gap-2">
                    <Palette className="h-4 w-4" />
                    {t('reports.primaryColor')}
                  </Label>
                  <div className="flex items-center gap-4">
                    <input
                      type="color"
                      value={form.primaryColor}
                      onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
                      className="h-10 w-20 cursor-pointer rounded border"
                    />
                    <Input
                      value={form.primaryColor}
                      onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
                      placeholder="#3b82f6"
                      className="w-32"
                    />
                    <div
                      className="h-10 flex-1 rounded border flex items-center justify-center text-white text-sm font-medium"
                      style={{ backgroundColor: form.primaryColor }}
                    >
                      Preview
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t('reports.colorDescription')}
                  </p>
                </div>

                {/* Footer Text */}
                <div className="grid gap-2">
                  <Label htmlFor="footerText">{t('reports.footerContent')}</Label>
                  <Textarea
                    id="footerText"
                    value={form.footerText}
                    onChange={(e) => setForm({ ...form, footerText: e.target.value })}
                    placeholder="Ví dụ: © 2025 Công ty TNHH ABC. Mọi quyền được bảo lưu."
                    rows={3}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('reports.footerDescription')}
                  </p>
                </div>

                {/* Preview Section */}
                <div className="border rounded-lg p-4 bg-muted/30">
                  <Label className="text-sm font-medium mb-3 block">{t('reports.previewEmail')}</Label>
                  <div className="bg-white rounded border overflow-hidden">
                    {/* Header */}
                    <div
                      className="p-4 text-white"
                      style={{ backgroundColor: form.primaryColor }}
                    >
                      <div className="flex items-center gap-3">
                        {form.logoUrl ? (
                          <img src={form.logoUrl} alt="Logo" className="h-8 w-auto" />
                        ) : (
                          <div className="h-8 w-8 bg-white/20 rounded flex items-center justify-center text-xs">
                            Logo
                          </div>
                        )}
                        <span className="font-semibold">{t('reports.ngVisualReport')}</span>
                      </div>
                    </div>
                    {/* Content */}
                    <div className="p-4 text-gray-700 text-sm">
                      <p>{t('reports.previewContentPlaceholder')}</p>
                      <p className="mt-2">{t('reports.previewContentDesc')}</p>
                    </div>
                    {/* Footer */}
                    <div className="p-3 bg-gray-100 text-xs text-gray-500 text-center">
                      {form.footerText || t('reports.footerPlaceholder')}
                    </div>
                  </div>
                </div>
              </TabsContent>
            </Tabs>

            <DialogFooter className="mt-4">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {(createMutation.isPending || updateMutation.isPending) && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {editingReport ? t('common.update') : t('reports.createReport')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <DeleteConfirmDialog
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
          itemType={t('reports.scheduledReport')}
          itemName={reportToDelete?.name}
          onConfirm={() => reportToDelete && deleteMutation.mutate({ id: reportToDelete.id })}
          isLoading={deleteMutation.isPending}
        />

        {/* Preview Email Dialog */}
        <EmailPreviewDialog
          open={previewDialogOpen}
          onOpenChange={setPreviewDialogOpen}
          reportId={previewReportId}
        />
      </CardContent>
    </Card>
  );
}

// Email Preview Dialog Component
function EmailPreviewDialog({
  open,
  onOpenChange,
  reportId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reportId: number | null;
}) {
  const { t } = useTranslation();
  const { data, isLoading, error } = trpc.scheduledReport.previewEmail.useQuery(
    { id: reportId! },
    { enabled: open && reportId !== null }
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5" />
            {t('reports.previewEmailWithData')}
          </DialogTitle>
          <DialogDescription>
            {t('reports.previewEmailDesc')}
          </DialogDescription>
        </DialogHeader>
        
        <div className="flex-1 overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center h-96">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <span className="ml-2 text-muted-foreground">{t('reports.loadingPreview')}</span>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-96 text-center">
              <Mail className="h-12 w-12 text-destructive mb-4" />
              <h3 className="text-lg font-semibold text-destructive mb-2">{t('reports.errorLoadPreview')}</h3>
              <p className="text-sm text-muted-foreground">{error.message}</p>
            </div>
          ) : data ? (
            <div className="h-[60vh] overflow-auto border rounded-lg bg-white">
              <iframe
                srcDoc={data.html}
                className="w-full h-full border-0"
                title="Email Preview"
              />
            </div>
          ) : null}
        </div>

        {data && (
          <div className="mt-4 p-3 bg-muted/50 rounded-lg">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">{t('reports.reportType')}:</span>
              <Badge variant="secondary">{data.reportType}</Badge>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
