import { useState } from 'react';
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
  FileJson, FileText, RefreshCw, History, Send, Settings
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

// Mock data
const MOCK_SCHEDULES: Schedule[] = [
  {
    id: 1,
    name: 'Báo cáo NG hàng ngày',
    description: 'Xuất danh sách sản phẩm NG trong ngày',
    scheduleType: 'DAILY',
    scheduleTime: '08:00',
    exportFormat: 'EXCEL',
    resultFilter: 'NG',
    timeRangeType: 'LAST_24H',
    recipients: ['qa@company.com', 'manager@company.com'],
    includeImages: true,
    includeAnnotations: true,
    includeMeasurements: true,
    includeSummaryStats: true,
    isActive: true,
    lastRunAt: new Date(Date.now() - 86400000),
    lastRunStatus: 'SUCCESS',
    nextRunAt: new Date(Date.now() + 43200000),
  },
  {
    id: 2,
    name: 'Báo cáo tuần',
    description: 'Tổng hợp kết quả kiểm tra hàng tuần',
    scheduleType: 'WEEKLY',
    scheduleTime: '09:00',
    scheduleDayOfWeek: 1, // Monday
    exportFormat: 'PDF',
    resultFilter: 'ALL',
    timeRangeType: 'LAST_7D',
    recipients: ['director@company.com'],
    includeImages: false,
    includeAnnotations: true,
    includeMeasurements: true,
    includeSummaryStats: true,
    isActive: true,
    lastRunAt: new Date(Date.now() - 604800000),
    lastRunStatus: 'SUCCESS',
    nextRunAt: new Date(Date.now() + 259200000),
  },
  {
    id: 3,
    name: 'Báo cáo tháng',
    description: 'Báo cáo chi tiết hàng tháng',
    scheduleType: 'MONTHLY',
    scheduleTime: '07:00',
    scheduleDayOfMonth: 1,
    exportFormat: 'EXCEL',
    resultFilter: 'ALL',
    timeRangeType: 'LAST_MONTH',
    recipients: ['ceo@company.com', 'cfo@company.com'],
    includeImages: false,
    includeAnnotations: true,
    includeMeasurements: true,
    includeSummaryStats: true,
    isActive: false,
    lastRunAt: new Date(Date.now() - 2592000000),
    lastRunStatus: 'FAILED',
  },
];

const MOCK_LOGS: ExportLog[] = [
  {
    id: 1,
    scheduleId: 1,
    scheduleName: 'Báo cáo NG hàng ngày',
    status: 'SUCCESS',
    recordCount: 45,
    fileSize: 256000,
    recipientCount: 2,
    deliveredCount: 2,
    startedAt: new Date(Date.now() - 86400000),
    completedAt: new Date(Date.now() - 86400000 + 5000),
  },
  {
    id: 2,
    scheduleId: 2,
    scheduleName: 'Báo cáo tuần',
    status: 'SUCCESS',
    recordCount: 312,
    fileSize: 1024000,
    recipientCount: 1,
    deliveredCount: 1,
    startedAt: new Date(Date.now() - 604800000),
    completedAt: new Date(Date.now() - 604800000 + 15000),
  },
  {
    id: 3,
    scheduleId: 3,
    scheduleName: 'Báo cáo tháng',
    status: 'FAILED',
    recordCount: 0,
    fileSize: 0,
    recipientCount: 2,
    deliveredCount: 0,
    startedAt: new Date(Date.now() - 2592000000),
    completedAt: new Date(Date.now() - 2592000000 + 3000),
    errorMessage: 'SMTP connection timeout',
  },
];

const DAYS_OF_WEEK = [
  { value: 0, label: 'Chủ nhật' },
  { value: 1, label: 'Thứ 2' },
  { value: 2, label: 'Thứ 3' },
  { value: 3, label: 'Thứ 4' },
  { value: 4, label: 'Thứ 5' },
  { value: 5, label: 'Thứ 6' },
  { value: 6, label: 'Thứ 7' },
];

export default function HistoryExportScheduling() {
  const [schedules, setSchedules] = useState<Schedule[]>(MOCK_SCHEDULES);
  const [logs] = useState<ExportLog[]>(MOCK_LOGS);
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
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30"><CheckCircle className="w-3 h-3 mr-1" />Thành công</Badge>;
      case 'FAILED':
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30"><XCircle className="w-3 h-3 mr-1" />Thất bại</Badge>;
      case 'RUNNING':
        return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30"><RefreshCw className="w-3 h-3 mr-1 animate-spin" />Đang chạy</Badge>;
      case 'PENDING':
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30"><Clock className="w-3 h-3 mr-1" />Đang chờ</Badge>;
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
    setSchedules(prev => prev.map(s => 
      s.id === id ? { ...s, isActive: !s.isActive } : s
    ));
    toast.success('Đã cập nhật trạng thái lịch');
  };

  const handleRunNow = (schedule: Schedule) => {
    toast.success(`Đang chạy "${schedule.name}"...`);
  };

  const handleDelete = (id: number) => {
    setSchedules(prev => prev.filter(s => s.id !== id));
    toast.success('Đã xóa lịch xuất báo cáo');
  };

  const handleAddRecipient = () => {
    if (recipientInput && recipientInput.includes('@')) {
      setFormData(prev => ({
        ...prev,
        recipients: [...(prev.recipients || []), recipientInput],
      }));
      setRecipientInput('');
    } else {
      toast.error('Vui lòng nhập email hợp lệ');
    }
  };

  const handleRemoveRecipient = (email: string) => {
    setFormData(prev => ({
      ...prev,
      recipients: (prev.recipients || []).filter(r => r !== email),
    }));
  };

  const handleSave = () => {
    if (!formData.name?.trim()) {
      toast.error('Vui lòng nhập tên lịch');
      return;
    }
    if (!formData.recipients?.length) {
      toast.error('Vui lòng thêm ít nhất một người nhận');
      return;
    }

    if (editingSchedule) {
      setSchedules(prev => prev.map(s =>
        s.id === editingSchedule.id ? { ...s, ...formData } as Schedule : s
      ));
      toast.success('Đã cập nhật lịch xuất báo cáo');
    } else {
      const newSchedule: Schedule = {
        ...formData as Schedule,
        id: Date.now(),
        isActive: true,
      };
      setSchedules(prev => [...prev, newSchedule]);
      toast.success('Đã tạo lịch xuất báo cáo mới');
    }

    setShowCreateDialog(false);
    setEditingSchedule(null);
    resetForm();
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
              Lịch xuất báo cáo tự động
            </h1>
            <p className="text-muted-foreground">
              Cấu hình xuất báo cáo lịch sử tự động theo lịch và gửi email
            </p>
          </div>
          <Button onClick={() => { resetForm(); setShowCreateDialog(true); }}>
            <Plus className="h-4 w-4 mr-2" />
            Tạo lịch mới
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Tổng số lịch</CardDescription>
              <CardTitle className="text-2xl">{schedules.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Đang hoạt động</CardDescription>
              <CardTitle className="text-2xl text-green-500">
                {schedules.filter(s => s.isActive).length}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Thành công (7 ngày)</CardDescription>
              <CardTitle className="text-2xl text-blue-500">
                {logs.filter(l => l.status === 'SUCCESS').length}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Thất bại (7 ngày)</CardDescription>
              <CardTitle className="text-2xl text-red-500">
                {logs.filter(l => l.status === 'FAILED').length}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        <Tabs defaultValue="schedules">
          <TabsList>
            <TabsTrigger value="schedules">
              <Calendar className="h-4 w-4 mr-2" />
              Danh sách lịch
            </TabsTrigger>
            <TabsTrigger value="logs">
              <History className="h-4 w-4 mr-2" />
              Lịch sử chạy
            </TabsTrigger>
          </TabsList>

          <TabsContent value="schedules" className="space-y-4">
            {schedules.length === 0 ? (
              <Card className="p-12 text-center">
                <Calendar className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">Chưa có lịch nào</h3>
                <p className="text-muted-foreground mb-4">
                  Tạo lịch xuất báo cáo tự động để nhận email định kỳ
                </p>
                <Button onClick={() => setShowCreateDialog(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Tạo lịch đầu tiên
                </Button>
              </Card>
            ) : (
              <div className="grid gap-4">
                {schedules.map((schedule) => (
                  <Card key={schedule.id}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-lg ${schedule.isActive ? 'bg-green-500/20' : 'bg-muted'}`}>
                            {getFormatIcon(schedule.exportFormat)}
                          </div>
                          <div>
                            <CardTitle className="text-base flex items-center gap-2">
                              {schedule.name}
                              {!schedule.isActive && (
                                <Badge variant="outline">Tạm dừng</Badge>
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
                            onClick={() => handleRunNow(schedule)}
                          >
                            <Play className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openEditDialog(schedule)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDelete(schedule.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                        <div>
                          <p className="text-muted-foreground">Lịch chạy</p>
                          <p className="font-medium">
                            {schedule.scheduleType === 'DAILY' && `Hàng ngày lúc ${schedule.scheduleTime}`}
                            {schedule.scheduleType === 'WEEKLY' && `${DAYS_OF_WEEK.find(d => d.value === schedule.scheduleDayOfWeek)?.label} lúc ${schedule.scheduleTime}`}
                            {schedule.scheduleType === 'MONTHLY' && `Ngày ${schedule.scheduleDayOfMonth} hàng tháng lúc ${schedule.scheduleTime}`}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Định dạng</p>
                          <p className="font-medium">{schedule.exportFormat}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Người nhận</p>
                          <p className="font-medium">{schedule.recipients.length} email</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Lần chạy cuối</p>
                          <div className="flex items-center gap-2">
                            {getStatusBadge(schedule.lastRunStatus)}
                          </div>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Lần chạy tiếp</p>
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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Lịch</TableHead>
                    <TableHead>Trạng thái</TableHead>
                    <TableHead>Số bản ghi</TableHead>
                    <TableHead>Kích thước</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Thời gian</TableHead>
                    <TableHead>Lỗi</TableHead>
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
                      <TableCell className="max-w-[200px] truncate text-red-400">
                        {log.errorMessage || '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Create/Edit Dialog */}
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingSchedule ? 'Chỉnh sửa lịch' : 'Tạo lịch xuất báo cáo mới'}
              </DialogTitle>
              <DialogDescription>
                Cấu hình lịch xuất báo cáo tự động và gửi email
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {/* Basic Info */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Tên lịch *</Label>
                  <Input
                    placeholder="VD: Báo cáo NG hàng ngày"
                    value={formData.name || ''}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Định dạng xuất</Label>
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
                <Label>Mô tả</Label>
                <Textarea
                  placeholder="Mô tả về lịch xuất báo cáo..."
                  value={formData.description || ''}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                />
              </div>

              {/* Schedule Config */}
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Tần suất</Label>
                  <Select
                    value={formData.scheduleType}
                    onValueChange={(v: ScheduleType) => setFormData({ ...formData, scheduleType: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DAILY">Hàng ngày</SelectItem>
                      <SelectItem value="WEEKLY">Hàng tuần</SelectItem>
                      <SelectItem value="MONTHLY">Hàng tháng</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {formData.scheduleType === 'WEEKLY' && (
                  <div className="space-y-2">
                    <Label>Ngày trong tuần</Label>
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
                            {day.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {formData.scheduleType === 'MONTHLY' && (
                  <div className="space-y-2">
                    <Label>Ngày trong tháng</Label>
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
                            Ngày {day}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Giờ chạy</Label>
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
                  <Label>Khoảng thời gian</Label>
                  <Select
                    value={formData.timeRangeType}
                    onValueChange={(v: TimeRangeType) => setFormData({ ...formData, timeRangeType: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="LAST_24H">24 giờ qua</SelectItem>
                      <SelectItem value="LAST_7D">7 ngày qua</SelectItem>
                      <SelectItem value="LAST_30D">30 ngày qua</SelectItem>
                      <SelectItem value="LAST_MONTH">Tháng trước</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Lọc kết quả</Label>
                  <Select
                    value={formData.resultFilter}
                    onValueChange={(v: ResultFilter) => setFormData({ ...formData, resultFilter: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">Tất cả</SelectItem>
                      <SelectItem value="OK">Chỉ OK</SelectItem>
                      <SelectItem value="NG">Chỉ NG</SelectItem>
                      <SelectItem value="NTF">Chỉ NTF</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Include Options */}
              <div className="space-y-3">
                <Label>Nội dung bao gồm</Label>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center justify-between">
                    <Label className="font-normal">Hình ảnh</Label>
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
                    <Label className="font-normal">Thống kê tổng hợp</Label>
                    <Switch
                      checked={formData.includeSummaryStats}
                      onCheckedChange={(v) => setFormData({ ...formData, includeSummaryStats: v })}
                    />
                  </div>
                </div>
              </div>

              {/* Recipients */}
              <div className="space-y-2">
                <Label>Người nhận email *</Label>
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
                Hủy
              </Button>
              <Button onClick={handleSave}>
                <CheckCircle className="h-4 w-4 mr-2" />
                {editingSchedule ? 'Cập nhật' : 'Tạo lịch'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
