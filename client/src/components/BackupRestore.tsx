import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { toastTrpcError } from "@/lib/trpcErrors";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Database,
  Download,
  Upload,
  Clock,
  CalendarDays,
  Plus,
  Trash2,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  HardDrive,
  Cloud,
  Play,
  Pause,
  MoreHorizontal,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const BACKUP_CATEGORIES = [
  { value: "users", label: "backup.catUsers" },
  { value: "factories", label: "backup.catFactories" },
  { value: "workshops", label: "backup.catWorkshops" },
  { value: "production_lines", label: "backup.catProductionLines" },
  { value: "stations", label: "backup.catStations" },
  { value: "machines", label: "backup.catMachines" },
  { value: "product_models", label: "backup.catProductModels" },
  { value: "product_inspections", label: "backup.catInspections" },
  { value: "measurement_results", label: "backup.catMeasurements" },
  { value: "alert_settings", label: "backup.catAlertSettings" },
  { value: "production_orders", label: "backup.catProductionOrders" },
  { value: "system_config", label: "backup.catSystemConfig" },
];

export default function BackupRestore() {
  const { t } = useTranslation();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<any>(null);

  // Schedule form
  const [scheduleForm, setScheduleForm] = useState({
    name: "",
    description: "",
    schedule: "daily" as "daily" | "weekly" | "monthly",
    scheduleTime: "02:00",
    scheduleDayOfWeek: 0,
    scheduleDayOfMonth: 1,
    retentionCount: 7,
    storageType: "s3" as "local" | "s3",
    categories: [] as string[],
  });

  // Queries
  const { data: backups, refetch: refetchBackups, isLoading: backupsLoading } = trpc.backup.listBackups.useQuery();
  const { data: schedules, refetch: refetchSchedules } = trpc.backup.listScheduled.useQuery();
  const { data: stats } = trpc.backup.getStats.useQuery();

  // Mutations
  const createBackupMutation = trpc.backup.createBackup.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      setCreateDialogOpen(false);
      setSelectedCategories([]);
      setDescription("");
      refetchBackups();
    },
    onError: (err) => toastTrpcError(err),
  });

  const restoreBackupMutation = trpc.backup.restoreBackup.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      setRestoreDialogOpen(false);
      setRestoreTarget(null);
      refetchBackups();
    },
    onError: (err) => toastTrpcError(err),
  });

  const deleteBackupMutation = trpc.backup.deleteBackup.useMutation({
    onSuccess: () => {
      toast.success(t('backup.backupDeleted'));
      refetchBackups();
    },
    onError: (err) => toastTrpcError(err),
  });

  const createScheduledMutation = trpc.backup.createScheduled.useMutation({
    onSuccess: () => {
      toast.success(t('backup.scheduleCreated'));
      setScheduleDialogOpen(false);
      setScheduleForm({
        name: "", description: "", schedule: "daily", scheduleTime: "02:00",
        scheduleDayOfWeek: 0, scheduleDayOfMonth: 1, retentionCount: 7,
        storageType: "s3", categories: [],
      });
      refetchSchedules();
    },
    onError: (err) => toastTrpcError(err),
  });

  const toggleScheduledMutation = trpc.backup.toggleScheduled.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      refetchSchedules();
    },
    onError: (err) => toastTrpcError(err),
  });

  const deleteScheduledMutation = trpc.backup.deleteScheduled.useMutation({
    onSuccess: () => {
      toast.success(t('backup.scheduleDeleted'));
      refetchSchedules();
    },
    onError: (err) => toastTrpcError(err),
  });

  const toggleCategory = (category: string) => {
    setSelectedCategories(prev =>
      prev.includes(category) ? prev.filter(c => c !== category) : [...prev, category]
    );
  };

  const toggleScheduleCategory = (category: string) => {
    setScheduleForm(prev => ({
      ...prev,
      categories: prev.categories.includes(category)
        ? prev.categories.filter(c => c !== category)
        : [...prev.categories, category],
    }));
  };

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Database className="h-8 w-8 text-blue-500" />
              <div>
                <p className="text-2xl font-bold">{stats?.totalBackups || 0}</p>
                <p className="text-sm text-muted-foreground">{t("backup.totalBackups")}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-8 w-8 text-green-500" />
              <div>
                <p className="text-2xl font-bold">{stats?.successBackups || 0}</p>
                <p className="text-sm text-muted-foreground">{t("backup.successRate")}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <CalendarDays className="h-8 w-8 text-purple-500" />
              <div>
                <p className="text-2xl font-bold">{stats?.activeSchedules || 0}</p>
                <p className="text-sm text-muted-foreground">{t("backup.activeSchedules")}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Clock className="h-8 w-8 text-orange-500" />
              <div>
                <p className="text-sm font-medium">
                  {stats?.lastBackupAt ? new Date(stats.lastBackupAt).toLocaleString() : "—"}
                </p>
                <p className="text-sm text-muted-foreground">{t("backup.lastBackup")}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <Button onClick={() => setCreateDialogOpen(true)} className="gap-2">
          <Download className="h-4 w-4" />
          {t("backup.createBackup")}
        </Button>
        <Button variant="outline" onClick={() => setScheduleDialogOpen(true)} className="gap-2">
          <CalendarDays className="h-4 w-4" />
          {t("backup.scheduledBackup")}
        </Button>
        <Button variant="outline" onClick={() => refetchBackups()} className="gap-2">
          <RefreshCw className="h-4 w-4" />
          {t("common.refresh")}
        </Button>
      </div>

      {/* Scheduled Backups */}
      {schedules && schedules.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5" />
              {t("backup.scheduledBackup")}
            </CardTitle>
            <CardDescription>{t('backup.scheduledBackupDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {schedules.map((schedule) => (
                <div key={schedule.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={schedule.isEnabled}
                      onCheckedChange={(checked) => toggleScheduledMutation.mutate({ id: schedule.id, isEnabled: checked })}
                    />
                    <div>
                      <p className="font-medium">{schedule.name}</p>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Badge variant="outline">
                          {schedule.schedule === "daily" ? t("backup.daily") : schedule.schedule === "weekly" ? t("backup.weekly") : t("backup.monthly")}
                        </Badge>
                        <span>{schedule.scheduleTime}</span>
                        <Badge variant="secondary">
                          {schedule.storageType === "s3" ? <Cloud className="h-3 w-3 mr-1" /> : <HardDrive className="h-3 w-3 mr-1" />}
                          {schedule.storageType}
                        </Badge>
                        <span>{t('backup.keepCopies', { count: schedule.retentionCount })}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {schedule.lastRunStatus && (
                      <Badge variant={schedule.lastRunStatus === "success" ? "default" : "destructive"}>
                        {schedule.lastRunStatus}
                      </Badge>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteScheduledMutation.mutate({ id: schedule.id })}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Backup History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            {t("backup.backupHistory")}
          </CardTitle>
          <CardDescription>{t('backup.backupHistoryDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          {backupsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : !backups || backups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 space-y-3">
              <Database className="h-12 w-12 text-muted-foreground" />
              <p className="text-muted-foreground">{t('backup.noBackups')}</p>
              <Button onClick={() => setCreateDialogOpen(true)} size="sm" className="gap-2">
                <Plus className="h-4 w-4" />
                {t("backup.createBackup")}
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {backups.map((backup) => (
                <div
                  key={backup.id}
                  className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    {backup.action === "export" ? (
                      <Download className="h-5 w-5 text-blue-500" />
                    ) : (
                      <Upload className="h-5 w-5 text-orange-500" />
                    )}
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{backup.fileName || `Backup #${backup.id}`}</p>
                        <Badge variant={backup.status === "success" ? "default" : backup.status === "failed" ? "destructive" : "secondary"}>
                          {backup.status === "success" ? (
                            <><CheckCircle2 className="h-3 w-3 mr-1" /> {t('common.success')}</>
                          ) : backup.status === "failed" ? (
                            <><XCircle className="h-3 w-3 mr-1" /> {t('common.failed')}</>
                          ) : "Partial"}
                        </Badge>
                        <Badge variant="outline">
                          {backup.action === "export" ? "Backup" : "Restore"}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 text-sm text-muted-foreground">
                        <span>{new Date(backup.createdAt).toLocaleString()}</span>
                        {backup.recordCount && <span>{backup.recordCount.toLocaleString()} records</span>}
                        {backup.duration && <span>{(backup.duration / 1000).toFixed(1)}s</span>}
                        {backup.fileSize && <span>{(backup.fileSize / 1024).toFixed(1)} KB</span>}
                      </div>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {backup.action === "export" && backup.status === "success" && (
                        <DropdownMenuItem onClick={() => { setRestoreTarget(backup); setRestoreDialogOpen(true); }}>
                          <Upload className="h-4 w-4 mr-2" />
                          {t('backup.restoreFromThis')}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem 
                        onClick={() => deleteBackupMutation.mutate({ id: backup.id })}
                        className="text-destructive"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        {t('common.delete')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Backup Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              {t("backup.createBackup")}
            </DialogTitle>
            <DialogDescription>{t('backup.selectCategoriesToBackup')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('backup.descriptionOptional')}</label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('backup.descriptionPlaceholder')}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("backup.categories")} *</label>
              <div className="grid grid-cols-2 gap-2">
                {BACKUP_CATEGORIES.map((cat) => (
                  <label
                    key={cat.value}
                    className={`flex items-center gap-2 p-2 border rounded-lg cursor-pointer hover:bg-accent transition-colors ${
                      selectedCategories.includes(cat.value) ? "border-primary bg-primary/5" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedCategories.includes(cat.value)}
                      onChange={() => toggleCategory(cat.value)}
                      className="rounded"
                    />
                    <span className="text-sm">{t(cat.label)}</span>
                  </label>
                ))}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedCategories(BACKUP_CATEGORIES.map(c => c.value))}
                >
                  {t('backup.selectAll')}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setSelectedCategories([])}>
                  {t('backup.deselectAll')}
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => createBackupMutation.mutate({
                categories: selectedCategories,
                description: description || undefined,
              })}
              disabled={selectedCategories.length === 0 || createBackupMutation.isPending}
              className="gap-2"
            >
              {createBackupMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {t("backup.createBackup")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Scheduled Backup Dialog */}
      <Dialog open={scheduleDialogOpen} onOpenChange={setScheduleDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5" />
              {t("backup.scheduledBackup")}
            </DialogTitle>
            <DialogDescription>{t('backup.configureAutoBackup')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('backup.scheduleName')}</label>
              <Input
                value={scheduleForm.name}
                onChange={(e) => setScheduleForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder={t('backup.scheduleNamePlaceholder')}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("backup.schedule")} *</label>
                <Select
                  value={scheduleForm.schedule}
                  onValueChange={(v) => setScheduleForm(prev => ({ ...prev, schedule: v as any }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">{t("backup.daily")}</SelectItem>
                    <SelectItem value="weekly">{t("backup.weekly")}</SelectItem>
                    <SelectItem value="monthly">{t("backup.monthly")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('backup.time')}</label>
                <Input
                  type="time"
                  value={scheduleForm.scheduleTime}
                  onChange={(e) => setScheduleForm(prev => ({ ...prev, scheduleTime: e.target.value }))}
                />
              </div>
            </div>
            {scheduleForm.schedule === "weekly" && (
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('reports.dayOfWeek')}</label>
                <Select
                  value={String(scheduleForm.scheduleDayOfWeek)}
                  onValueChange={(v) => setScheduleForm(prev => ({ ...prev, scheduleDayOfWeek: Number(v) }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
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
            {scheduleForm.schedule === "monthly" && (
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('reports.dayOfMonth')}</label>
                <Input
                  type="number"
                  min={1}
                  max={31}
                  value={scheduleForm.scheduleDayOfMonth}
                  onChange={(e) => setScheduleForm(prev => ({ ...prev, scheduleDayOfMonth: Number(e.target.value) }))}
                />
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("backup.retention")}</label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={scheduleForm.retentionCount}
                  onChange={(e) => setScheduleForm(prev => ({ ...prev, retentionCount: Number(e.target.value) }))}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("backup.storage")}</label>
                <Select
                  value={scheduleForm.storageType}
                  onValueChange={(v) => setScheduleForm(prev => ({ ...prev, storageType: v as any }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="s3">
                      <span className="flex items-center gap-2"><Cloud className="h-4 w-4" /> S3 / Cloud</span>
                    </SelectItem>
                    <SelectItem value="local">
                      <span className="flex items-center gap-2"><HardDrive className="h-4 w-4" /> Local</span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("backup.categories")} *</label>
              <div className="grid grid-cols-2 gap-2">
                {BACKUP_CATEGORIES.map((cat) => (
                  <label
                    key={cat.value}
                    className={`flex items-center gap-2 p-2 border rounded-lg cursor-pointer hover:bg-accent transition-colors ${
                      scheduleForm.categories.includes(cat.value) ? "border-primary bg-primary/5" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={scheduleForm.categories.includes(cat.value)}
                      onChange={() => toggleScheduleCategory(cat.value)}
                      className="rounded"
                    />
                    <span className="text-sm">{t(cat.label)}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setScheduleDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => createScheduledMutation.mutate({
                ...scheduleForm,
                scheduleDayOfWeek: scheduleForm.schedule === "weekly" ? scheduleForm.scheduleDayOfWeek : undefined,
                scheduleDayOfMonth: scheduleForm.schedule === "monthly" ? scheduleForm.scheduleDayOfMonth : undefined,
              })}
              disabled={!scheduleForm.name || scheduleForm.categories.length === 0 || createScheduledMutation.isPending}
              className="gap-2"
            >
              {createScheduledMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarDays className="h-4 w-4" />}
              {t('backup.createSchedule')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Restore Confirm Dialog */}
      <Dialog open={restoreDialogOpen} onOpenChange={setRestoreDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-orange-500">
              <Upload className="h-5 w-5" />
              {t("backup.confirmRestore")}
            </DialogTitle>
            <DialogDescription>{t("backup.restoreWarning")}</DialogDescription>
          </DialogHeader>
          {restoreTarget && (
            <div className="py-4 space-y-2">
              <p className="text-sm"><strong>File:</strong> {restoreTarget.fileName}</p>
              <p className="text-sm"><strong>{t('backup.createdDate')}:</strong> {new Date(restoreTarget.createdAt).toLocaleString()}</p>
              <p className="text-sm"><strong>Records:</strong> {restoreTarget.recordCount?.toLocaleString() || "N/A"}</p>
              <div className="flex flex-wrap gap-1">
                {(restoreTarget.categories as string[])?.map((cat: string) => (
                  <Badge key={cat} variant="outline">{cat}</Badge>
                ))}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestoreDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => restoreBackupMutation.mutate({ backupId: restoreTarget.id })}
              disabled={restoreBackupMutation.isPending}
              className="gap-2"
            >
              {restoreBackupMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {t("backup.restoreBackup")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
