import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Calendar,
  Clock,
  Mail,
  Plus,
  MoreVertical,
  Trash2,
  Edit,
  Play,
  Pause,
  Send,
  History,
  BarChart3,
  CheckCircle2,
  XCircle,
  AlertCircle,
  FileText,
  FileSpreadsheet,
  FileCode,
} from 'lucide-react';
import { toast } from 'sonner';
import { format, formatDistanceToNow } from 'date-fns';
import { vi } from 'date-fns/locale';

const REPORT_TYPES = {
  NG_VISUAL: { label: 'Báo cáo NG Visual', icon: BarChart3 },
  DAILY_SUMMARY: { label: 'Tổng hợp hàng ngày', icon: Calendar },
  WEEKLY_SUMMARY: { label: 'Tổng hợp hàng tuần', icon: Calendar },
  MONTHLY_SUMMARY: { label: 'Tổng hợp hàng tháng', icon: Calendar },
  CUSTOM: { label: 'Tùy chỉnh', icon: FileText },
};

const SCHEDULES = {
  DAILY: { label: 'Hàng ngày', description: 'Gửi mỗi ngày vào giờ đã chọn' },
  WEEKLY: { label: 'Hàng tuần', description: 'Gửi vào ngày đã chọn trong tuần' },
  MONTHLY: { label: 'Hàng tháng', description: 'Gửi vào ngày đã chọn trong tháng' },
};

const DAYS_OF_WEEK = [
  { value: 0, label: 'Chủ nhật' },
  { value: 1, label: 'Thứ 2' },
  { value: 2, label: 'Thứ 3' },
  { value: 3, label: 'Thứ 4' },
  { value: 4, label: 'Thứ 5' },
  { value: 5, label: 'Thứ 6' },
  { value: 6, label: 'Thứ 7' },
];

const FORMAT_ICONS = {
  HTML: FileCode,
  PDF: FileText,
  EXCEL: FileSpreadsheet,
};

interface ReportFormData {
  name: string;
  description: string;
  reportType: 'NG_VISUAL' | 'DAILY_SUMMARY' | 'WEEKLY_SUMMARY' | 'MONTHLY_SUMMARY' | 'CUSTOM';
  schedule: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  scheduleTime: string;
  scheduleDayOfWeek?: number;
  scheduleDayOfMonth?: number;
  recipients: string[];
  factoryId?: number;
  reportFormat: 'HTML' | 'PDF' | 'EXCEL';
  includeWorkstationHeatmap: boolean;
  includeTopNGPoints: boolean;
  includeTrendChart: boolean;
  includeComparison: boolean;
  primaryColor: string;
  footerText: string;
}

const DEFAULT_FORM_DATA: ReportFormData = {
  name: '',
  description: '',
  reportType: 'DAILY_SUMMARY',
  schedule: 'DAILY',
  scheduleTime: '08:00',
  recipients: [],
  reportFormat: 'HTML',
  includeWorkstationHeatmap: true,
  includeTopNGPoints: true,
  includeTrendChart: true,
  includeComparison: true,
  primaryColor: '#3b82f6',
  footerText: '',
};

export function ReportScheduler() {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingReport, setEditingReport] = useState<number | null>(null);
  const [logsDialogOpen, setLogsDialogOpen] = useState(false);
  const [selectedReportId, setSelectedReportId] = useState<number | null>(null);
  const [formData, setFormData] = useState<ReportFormData>(DEFAULT_FORM_DATA);
  const [recipientInput, setRecipientInput] = useState('');

  // Queries
  const { data: reportsData, isLoading, refetch } = trpc.scheduledReport.list.useQuery();
  // Stats will be calculated from reportsData
  const { data: factories } = trpc.factory.list.useQuery();
  const { data: logsData } = trpc.scheduledReport.getLogs.useQuery(
    { reportId: selectedReportId!, limit: 20 },
    { enabled: !!selectedReportId && logsDialogOpen }
  );

  // Mutations
  const createMutation = trpc.scheduledReport.create.useMutation({
    onSuccess: () => {
      toast.success('Đã tạo lịch báo cáo');
      setCreateDialogOpen(false);
      setFormData(DEFAULT_FORM_DATA);
      refetch();
    },
    onError: (error) => toast.error(error.message),
  });

  const updateMutation = trpc.scheduledReport.update.useMutation({
    onSuccess: () => {
      toast.success('Đã cập nhật lịch báo cáo');
      setEditingReport(null);
      setFormData(DEFAULT_FORM_DATA);
      refetch();
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteMutation = trpc.scheduledReport.delete.useMutation({
    onSuccess: () => {
      toast.success('Đã xóa lịch báo cáo');
      refetch();
    },
    onError: (error) => toast.error(error.message),
  });

  const toggleMutation = trpc.scheduledReport.update.useMutation({
    onSuccess: () => {
      toast.success('Đã cập nhật trạng thái lịch báo cáo');
      refetch();
    },
    onError: (error: any) => toast.error(error.message),
  });

  const triggerMutation = trpc.scheduledReport.sendTest.useMutation({
    onSuccess: () => {
      toast.success('Đã gửi báo cáo test');
      refetch();
    },
    onError: (error: any) => toast.error(error.message),
  });

  const handleAddRecipient = () => {
    if (recipientInput && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientInput)) {
      if (!formData.recipients.includes(recipientInput)) {
        setFormData(prev => ({
          ...prev,
          recipients: [...prev.recipients, recipientInput],
        }));
      }
      setRecipientInput('');
    } else {
      toast.error('Email không hợp lệ');
    }
  };

  const handleRemoveRecipient = (email: string) => {
    setFormData(prev => ({
      ...prev,
      recipients: prev.recipients.filter(r => r !== email),
    }));
  };

  const handleSubmit = () => {
    if (!formData.name.trim()) {
      toast.error('Vui lòng nhập tên báo cáo');
      return;
    }
    if (formData.recipients.length === 0) {
      toast.error('Vui lòng thêm ít nhất một người nhận');
      return;
    }

    if (editingReport) {
      updateMutation.mutate({
        id: editingReport,
        ...formData,
      });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleEdit = (report: any) => {
    setEditingReport(report.id);
    setFormData({
      name: report.name,
      description: report.description || '',
      reportType: report.reportType,
      schedule: report.schedule,
      scheduleTime: report.scheduleTime,
      scheduleDayOfWeek: report.scheduleDayOfWeek,
      scheduleDayOfMonth: report.scheduleDayOfMonth,
      recipients: report.recipients || [],
      factoryId: report.factoryId,
      reportFormat: report.reportFormat,
      includeWorkstationHeatmap: report.includeWorkstationHeatmap,
      includeTopNGPoints: report.includeTopNGPoints,
      includeTrendChart: report.includeTrendChart,
      includeComparison: report.includeComparison,
      primaryColor: report.primaryColor || '#3b82f6',
      footerText: report.footerText || '',
    });
    setCreateDialogOpen(true);
  };

  const handleViewLogs = (reportId: number) => {
    setSelectedReportId(reportId);
    setLogsDialogOpen(true);
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Tổng lịch báo cáo
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{(reportsData || []).length}</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              Đang hoạt động
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-500">
              {(reportsData || []).filter((r: any) => r.isActive).length}
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Pause className="h-4 w-4 text-yellow-500" />
              Tạm dừng
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-yellow-500">
              {(reportsData || []).filter((r: any) => !r.isActive).length}
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Mail className="h-4 w-4 text-blue-500" />
              Tổng người nhận
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-blue-500">
              {(reportsData || []).reduce((acc: number, r: any) => acc + (r.recipients?.length || 0), 0)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Reports Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Lịch báo cáo tự động</CardTitle>
            <CardDescription>
              Quản lý các báo cáo được gửi tự động theo lịch
            </CardDescription>
          </div>
          <Button onClick={() => {
            setEditingReport(null);
            setFormData(DEFAULT_FORM_DATA);
            setCreateDialogOpen(true);
          }}>
            <Plus className="h-4 w-4 mr-2" />
            Tạo lịch mới
          </Button>
        </CardHeader>
        <CardContent>
          {(reportsData || []).length === 0 ? (
            <div className="text-center py-12">
              <Calendar className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">Chưa có lịch báo cáo</h3>
              <p className="text-muted-foreground mb-4">
                Tạo lịch báo cáo tự động để nhận báo cáo qua email định kỳ
              </p>
              <Button onClick={() => setCreateDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Tạo lịch đầu tiên
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tên báo cáo</TableHead>
                  <TableHead>Loại</TableHead>
                  <TableHead>Lịch gửi</TableHead>
                  <TableHead>Người nhận</TableHead>
                  <TableHead>Lần gửi tiếp</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead className="w-[80px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(reportsData || []).map((report: any) => {
                  const TypeIcon = REPORT_TYPES[report.reportType as keyof typeof REPORT_TYPES]?.icon || FileText;
                  const FormatIcon = FORMAT_ICONS[report.reportFormat as keyof typeof FORMAT_ICONS] || FileText;
                  
                  return (
                    <TableRow key={report.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <TypeIcon className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <p className="font-medium">{report.name}</p>
                            {report.description && (
                              <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                                {report.description}
                              </p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">
                            {REPORT_TYPES[report.reportType as keyof typeof REPORT_TYPES]?.label}
                          </Badge>
                          <FormatIcon className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <p className="text-sm">{SCHEDULES[report.schedule as keyof typeof SCHEDULES]?.label}</p>
                            <p className="text-xs text-muted-foreground">{report.scheduleTime}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Mail className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm">{report.recipients?.length || 0} người</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {report.nextScheduledAt ? (
                          <div>
                            <p className="text-sm">
                              {format(new Date(report.nextScheduledAt), 'dd/MM/yyyy HH:mm')}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatDistanceToNow(new Date(report.nextScheduledAt), { addSuffix: true, locale: vi })}
                            </p>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={report.isActive ? 'default' : 'secondary'}>
                          {report.isActive ? 'Đang hoạt động' : 'Tạm dừng'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleEdit(report)}>
                              <Edit className="h-4 w-4 mr-2" />
                              Chỉnh sửa
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleViewLogs(report.id)}>
                              <History className="h-4 w-4 mr-2" />
                              Lịch sử gửi
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => triggerMutation.mutate({ id: report.id })}>
                              <Send className="h-4 w-4 mr-2" />
                              Gửi ngay
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => toggleMutation.mutate({ id: report.id, isActive: !report.isActive })}>
                              {report.isActive ? (
                                <>
                                  <Pause className="h-4 w-4 mr-2" />
                                  Tạm dừng
                                </>
                              ) : (
                                <>
                                  <Play className="h-4 w-4 mr-2" />
                                  Kích hoạt
                                </>
                              )}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem 
                              className="text-red-600"
                              onClick={() => {
                                if (confirm('Bạn có chắc muốn xóa lịch báo cáo này?')) {
                                  deleteMutation.mutate({ id: report.id });
                                }
                              }}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Xóa
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingReport ? 'Chỉnh sửa lịch báo cáo' : 'Tạo lịch báo cáo mới'}
            </DialogTitle>
            <DialogDescription>
              Cấu hình báo cáo tự động gửi qua email theo lịch
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="basic" className="mt-4">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="basic">Cơ bản</TabsTrigger>
              <TabsTrigger value="schedule">Lịch gửi</TabsTrigger>
              <TabsTrigger value="content">Nội dung</TabsTrigger>
            </TabsList>

            <TabsContent value="basic" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="name">Tên báo cáo *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="VD: Báo cáo NG hàng ngày"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Mô tả</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Mô tả ngắn về báo cáo..."
                  rows={2}
                />
              </div>

              <div className="space-y-2">
                <Label>Loại báo cáo</Label>
                <Select
                  value={formData.reportType}
                  onValueChange={(value: any) => setFormData(prev => ({ ...prev, reportType: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(REPORT_TYPES).map(([key, { label }]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Định dạng</Label>
                <Select
                  value={formData.reportFormat}
                  onValueChange={(value: any) => setFormData(prev => ({ ...prev, reportFormat: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="HTML">HTML (Email)</SelectItem>
                    <SelectItem value="PDF">PDF</SelectItem>
                    <SelectItem value="EXCEL">Excel</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Người nhận *</Label>
                <div className="flex gap-2">
                  <Input
                    value={recipientInput}
                    onChange={(e) => setRecipientInput(e.target.value)}
                    placeholder="email@example.com"
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddRecipient())}
                  />
                  <Button type="button" onClick={handleAddRecipient}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  {formData.recipients.map((email) => (
                    <Badge key={email} variant="secondary" className="gap-1">
                      {email}
                      <button
                        type="button"
                        onClick={() => handleRemoveRecipient(email)}
                        className="ml-1 hover:text-red-500"
                      >
                        ×
                      </button>
                    </Badge>
                  ))}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="schedule" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Tần suất</Label>
                <Select
                  value={formData.schedule}
                  onValueChange={(value: any) => setFormData(prev => ({ ...prev, schedule: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(SCHEDULES).map(([key, { label, description }]) => (
                      <SelectItem key={key} value={key}>
                        <div>
                          <p>{label}</p>
                          <p className="text-xs text-muted-foreground">{description}</p>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="scheduleTime">Giờ gửi</Label>
                <Input
                  id="scheduleTime"
                  type="time"
                  value={formData.scheduleTime}
                  onChange={(e) => setFormData(prev => ({ ...prev, scheduleTime: e.target.value }))}
                />
              </div>

              {formData.schedule === 'WEEKLY' && (
                <div className="space-y-2">
                  <Label>Ngày trong tuần</Label>
                  <Select
                    value={formData.scheduleDayOfWeek?.toString()}
                    onValueChange={(value) => setFormData(prev => ({ ...prev, scheduleDayOfWeek: parseInt(value) }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Chọn ngày" />
                    </SelectTrigger>
                    <SelectContent>
                      {DAYS_OF_WEEK.map(({ value, label }) => (
                        <SelectItem key={value} value={value.toString()}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {formData.schedule === 'MONTHLY' && (
                <div className="space-y-2">
                  <Label>Ngày trong tháng</Label>
                  <Select
                    value={formData.scheduleDayOfMonth?.toString()}
                    onValueChange={(value) => setFormData(prev => ({ ...prev, scheduleDayOfMonth: parseInt(value) }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Chọn ngày" />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                        <SelectItem key={day} value={day.toString()}>Ngày {day}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-2">
                <Label>Lọc theo nhà máy (tùy chọn)</Label>
                <Select
                  value={formData.factoryId?.toString() || 'all'}
                  onValueChange={(value) => setFormData(prev => ({ 
                    ...prev, 
                    factoryId: value === 'all' ? undefined : parseInt(value) 
                  }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Tất cả nhà máy" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tất cả nhà máy</SelectItem>
                    {factories?.map((factory) => (
                      <SelectItem key={factory.id} value={factory.id.toString()}>
                        {factory.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </TabsContent>

            <TabsContent value="content" className="space-y-4 mt-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Heatmap công trạm</Label>
                    <p className="text-xs text-muted-foreground">Hiển thị phân bố lỗi theo công trạm</p>
                  </div>
                  <Switch
                    checked={formData.includeWorkstationHeatmap}
                    onCheckedChange={(checked) => setFormData(prev => ({ ...prev, includeWorkstationHeatmap: checked }))}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label>Top điểm NG</Label>
                    <p className="text-xs text-muted-foreground">Danh sách điểm đo có nhiều lỗi nhất</p>
                  </div>
                  <Switch
                    checked={formData.includeTopNGPoints}
                    onCheckedChange={(checked) => setFormData(prev => ({ ...prev, includeTopNGPoints: checked }))}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label>Biểu đồ xu hướng</Label>
                    <p className="text-xs text-muted-foreground">Xu hướng yield theo thời gian</p>
                  </div>
                  <Switch
                    checked={formData.includeTrendChart}
                    onCheckedChange={(checked) => setFormData(prev => ({ ...prev, includeTrendChart: checked }))}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label>So sánh kỳ trước</Label>
                    <p className="text-xs text-muted-foreground">So sánh với kỳ báo cáo trước</p>
                  </div>
                  <Switch
                    checked={formData.includeComparison}
                    onCheckedChange={(checked) => setFormData(prev => ({ ...prev, includeComparison: checked }))}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="primaryColor">Màu chủ đạo</Label>
                <div className="flex gap-2">
                  <Input
                    id="primaryColor"
                    type="color"
                    value={formData.primaryColor}
                    onChange={(e) => setFormData(prev => ({ ...prev, primaryColor: e.target.value }))}
                    className="w-16 h-10 p-1"
                  />
                  <Input
                    value={formData.primaryColor}
                    onChange={(e) => setFormData(prev => ({ ...prev, primaryColor: e.target.value }))}
                    placeholder="#3b82f6"
                    className="flex-1"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="footerText">Chữ ký footer</Label>
                <Textarea
                  id="footerText"
                  value={formData.footerText}
                  onChange={(e) => setFormData(prev => ({ ...prev, footerText: e.target.value }))}
                  placeholder="VD: Báo cáo này được tạo tự động bởi hệ thống AVI/AOI Management"
                  rows={2}
                />
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter className="mt-6">
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              Hủy
            </Button>
            <Button 
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {editingReport ? 'Cập nhật' : 'Tạo lịch'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Logs Dialog */}
      <Dialog open={logsDialogOpen} onOpenChange={setLogsDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Lịch sử gửi báo cáo
            </DialogTitle>
          </DialogHeader>

          {(logsData || []).length === 0 ? (
            <div className="text-center py-8">
              <History className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">Chưa có lịch sử gửi báo cáo</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Thời gian</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead>Người nhận</TableHead>
                  <TableHead>Ghi chú</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(logsData || []).map((log: any) => (
                  <TableRow key={log.id}>
                    <TableCell>
                      <div>
                        <p className="text-sm">{format(new Date(log.sentAt), 'dd/MM/yyyy HH:mm')}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(log.sentAt), { addSuffix: true, locale: vi })}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={
                        log.status === 'SUCCESS' ? 'default' : 
                        log.status === 'FAILED' ? 'destructive' : 
                        'secondary'
                      }>
                        {log.status === 'SUCCESS' && <CheckCircle2 className="h-3 w-3 mr-1" />}
                        {log.status === 'FAILED' && <XCircle className="h-3 w-3 mr-1" />}
                        {log.status === 'PENDING' && <AlertCircle className="h-3 w-3 mr-1" />}
                        {log.status === 'SUCCESS' ? 'Thành công' : 
                         log.status === 'FAILED' ? 'Thất bại' : 'Đang xử lý'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">
                        {log.successCount}/{log.recipientCount} thành công
                      </span>
                    </TableCell>
                    <TableCell>
                      {log.errorMessage && (
                        <span className="text-sm text-red-500 truncate max-w-[200px] block">
                          {log.errorMessage}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ReportScheduler;
