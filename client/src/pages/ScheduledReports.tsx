import { useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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

export default function ScheduledReports() {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isPreviewDialogOpen, setIsPreviewDialogOpen] = useState(false);
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
      toast.success('Đã tạo báo cáo định kỳ');
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
      toast.error('Lỗi tạo báo cáo', { description: error.message });
    },
  });

  const deleteMutation = trpc.scheduledReport.delete.useMutation({
    onSuccess: () => {
      toast.success('Đã xóa báo cáo');
      refetch();
    },
    onError: (error) => {
      toast.error('Lỗi xóa báo cáo', { description: error.message });
    },
  });

  const updateMutation = trpc.scheduledReport.update.useMutation({
    onSuccess: () => {
      toast.success('Đã cập nhật trạng thái');
      refetch();
    },
    onError: (error: any) => {
      toast.error('Lỗi cập nhật', { description: error.message });
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
      toast.success('Đã gửi báo cáo');
    },
    onError: (error) => {
      toast.error('Lỗi gửi báo cáo', { description: error.message });
    },
  });

  const handleCreate = () => {
    const recipients = newReport.recipients
      .split(',')
      .map(e => e.trim())
      .filter(e => e.length > 0);

    if (recipients.length === 0) {
      toast.error('Vui lòng nhập ít nhất một email nhận báo cáo');
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
    if (confirm('Bạn có chắc muốn xóa báo cáo này?')) {
      deleteMutation.mutate({ id });
    }
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
      toast.error('Lỗi xem trước', { description: error.message });
    }
  };

  const handleSendNow = (schedule: 'DAILY' | 'WEEKLY' | 'MONTHLY', recipients: string[]) => {
    const freqLabel = schedule === 'DAILY' ? 'hàng ngày' : schedule === 'WEEKLY' ? 'hàng tuần' : 'hàng tháng';
    if (confirm(`Gửi báo cáo ${freqLabel} đến ${recipients.length} người nhận?`)) {
      const frequency = schedule.toLowerCase() as 'daily' | 'weekly' | 'monthly';
      sendMutation.mutate({ name: `Manual ${frequency} report`, frequency, recipients });
    }
  };

  const getFrequencyLabel = (schedule: string) => {
    switch (schedule) {
      case 'DAILY': return 'Hàng ngày';
      case 'WEEKLY': return 'Hàng tuần';
      case 'MONTHLY': return 'Hàng tháng';
      default: return schedule;
    }
  };

  const getFrequencyColor = (schedule: string) => {
    switch (schedule) {
      case 'DAILY': return 'bg-blue-500/10 text-blue-700 border-blue-200';
      case 'WEEKLY': return 'bg-green-500/10 text-green-700 border-green-200';
      case 'MONTHLY': return 'bg-purple-500/10 text-purple-700 border-purple-200';
      default: return '';
    }
  };

  return (
    <DashboardLayout title="Báo cáo định kỳ">
      <div className="container py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Báo cáo định kỳ</h1>
            <p className="text-muted-foreground">
              Cấu hình và quản lý báo cáo thống kê tự động gửi qua email
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Làm mới
            </Button>
            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Tạo báo cáo
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Tạo báo cáo định kỳ mới</DialogTitle>
                  <DialogDescription>
                    Cấu hình báo cáo thống kê tự động gửi qua email
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>Tên báo cáo</Label>
                    <Input
                      placeholder="VD: Báo cáo sản xuất hàng ngày"
                      value={newReport.name}
                      onChange={(e) => setNewReport({ ...newReport, name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Mô tả (tùy chọn)</Label>
                    <Input
                      placeholder="Mô tả ngắn về báo cáo"
                      value={newReport.description}
                      onChange={(e) => setNewReport({ ...newReport, description: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Tần suất</Label>
                    <Select
                      value={newReport.frequency}
                      onValueChange={(v) => setNewReport({ ...newReport, frequency: v as any })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="daily">Hàng ngày</SelectItem>
                        <SelectItem value="weekly">Hàng tuần</SelectItem>
                        <SelectItem value="monthly">Hàng tháng</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Email nhận báo cáo</Label>
                    <Input
                      placeholder="email1@example.com, email2@example.com"
                      value={newReport.recipients}
                      onChange={(e) => setNewReport({ ...newReport, recipients: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">
                      Nhập nhiều email cách nhau bởi dấu phẩy
                    </p>
                  </div>
                  <div className="flex items-center justify-between">
                    <Label>Kích hoạt ngay</Label>
                    <Switch
                      checked={newReport.isActive}
                      onCheckedChange={(v) => setNewReport({ ...newReport, isActive: v })}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                    Hủy
                  </Button>
                  <Button onClick={handleCreate} disabled={createMutation.isPending}>
                    {createMutation.isPending ? 'Đang tạo...' : 'Tạo báo cáo'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="cursor-pointer hover:border-primary transition-colors" onClick={() => handlePreview('daily')}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Calendar className="h-4 w-4 text-blue-500" />
                Báo cáo hàng ngày
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Xem trước báo cáo thống kê 24 giờ qua
              </p>
              <Button variant="link" className="p-0 h-auto mt-2" disabled={previewLoading}>
                <Eye className="h-3 w-3 mr-1" />
                Xem trước
              </Button>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:border-primary transition-colors" onClick={() => handlePreview('weekly')}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Calendar className="h-4 w-4 text-green-500" />
                Báo cáo hàng tuần
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Xem trước báo cáo thống kê 7 ngày qua
              </p>
              <Button variant="link" className="p-0 h-auto mt-2" disabled={previewLoading}>
                <Eye className="h-3 w-3 mr-1" />
                Xem trước
              </Button>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:border-primary transition-colors" onClick={() => handlePreview('monthly')}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Calendar className="h-4 w-4 text-purple-500" />
                Báo cáo hàng tháng
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Xem trước báo cáo thống kê 30 ngày qua
              </p>
              <Button variant="link" className="p-0 h-auto mt-2" disabled={previewLoading}>
                <Eye className="h-3 w-3 mr-1" />
                Xem trước
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Reports List */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileBarChart className="h-5 w-5 text-primary" />
              Danh sách báo cáo đã cấu hình
            </CardTitle>
            <CardDescription>
              Quản lý các báo cáo định kỳ đã tạo
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">
                Đang tải...
              </div>
            ) : !reports || reports.length === 0 ? (
              <div className="text-center py-8">
                <FileBarChart className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                <p className="text-muted-foreground">Chưa có báo cáo nào được cấu hình</p>
                <Button variant="outline" className="mt-4" onClick={() => setIsCreateDialogOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Tạo báo cáo đầu tiên
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tên báo cáo</TableHead>
                    <TableHead>Tần suất</TableHead>
                    <TableHead>Người nhận</TableHead>
                    <TableHead>Trạng thái</TableHead>
                    <TableHead>Gửi lần cuối</TableHead>
                    <TableHead className="text-right">Thao tác</TableHead>
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
                          <Badge className="bg-green-500/10 text-green-700 border-green-200">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Hoạt động
                          </Badge>
                        ) : (
                          <Badge variant="secondary">
                            <Pause className="h-3 w-3 mr-1" />
                            Tạm dừng
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {report.lastSentAt ? (
                          <span className="text-sm">
                            {new Date(report.lastSentAt).toLocaleString('vi-VN')}
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">Chưa gửi</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleSendNow(report.schedule, report.recipients)}
                            disabled={sendMutation.isPending}
                            title="Gửi ngay"
                          >
                            <Send className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleToggle(report.id, report.isActive)}
                            title={report.isActive ? 'Tạm dừng' : 'Kích hoạt'}
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
                            title="Xóa"
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
              <DialogTitle>Xem trước báo cáo</DialogTitle>
              <DialogDescription>
                Đây là nội dung email sẽ được gửi đến người nhận
              </DialogDescription>
            </DialogHeader>
            <div 
              className="border rounded-lg p-4 bg-white"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsPreviewDialogOpen(false)}>
                Đóng
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Info Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Hướng dẫn</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div className="p-3 bg-blue-500/10 rounded-lg">
                <h4 className="font-medium text-blue-700 mb-1">Báo cáo hàng ngày</h4>
                <p className="text-muted-foreground text-xs">
                  Gửi vào 8:00 sáng mỗi ngày, tổng hợp số liệu 24 giờ qua
                </p>
              </div>
              <div className="p-3 bg-green-500/10 rounded-lg">
                <h4 className="font-medium text-green-700 mb-1">Báo cáo hàng tuần</h4>
                <p className="text-muted-foreground text-xs">
                  Gửi vào 8:00 sáng thứ Hai, tổng hợp số liệu 7 ngày qua
                </p>
              </div>
              <div className="p-3 bg-purple-500/10 rounded-lg">
                <h4 className="font-medium text-purple-700 mb-1">Báo cáo hàng tháng</h4>
                <p className="text-muted-foreground text-xs">
                  Gửi vào 8:00 sáng ngày 1 mỗi tháng, tổng hợp số liệu tháng trước
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
