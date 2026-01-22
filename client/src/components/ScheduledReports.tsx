import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Loader2, Mail, Calendar, Users, Filter } from "lucide-react";
import { DeleteConfirmDialog } from "./ConfirmDialog";

type ScheduledReport = {
  id: number;
  name: string;
  reportType: "NG_VISUAL" | "DAILY_SUMMARY" | "WEEKLY_SUMMARY" | "MONTHLY_SUMMARY" | "CUSTOM";
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
};

export default function ScheduledReports() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingReport, setEditingReport] = useState<ScheduledReport | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [reportToDelete, setReportToDelete] = useState<ScheduledReport | null>(null);

  const [form, setForm] = useState({
    name: "",
    reportType: "NG_VISUAL" as "NG_VISUAL" | "DAILY_SUMMARY" | "WEEKLY_SUMMARY" | "MONTHLY_SUMMARY" | "CUSTOM",
    schedule: "DAILY" as "DAILY" | "WEEKLY" | "MONTHLY",
    scheduleDayOfWeek: undefined as number | undefined,
    scheduleDayOfMonth: undefined as number | undefined,
    recipients: "",
    factoryId: undefined as number | undefined,
    workshopId: undefined as number | undefined,
    lineId: undefined as number | undefined,
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
      toast.success("Tạo báo cáo tự động thành công");
      utils.scheduledReport.list.invalidate();
      setDialogOpen(false);
      resetForm();
    },
    onError: (error) => {
      toast.error(`Lỗi: ${error.message}`);
    },
  });

  const updateMutation = trpc.scheduledReport.update.useMutation({
    onSuccess: () => {
      toast.success("Cập nhật báo cáo thành công");
      utils.scheduledReport.list.invalidate();
      setDialogOpen(false);
      setEditingReport(null);
      resetForm();
    },
    onError: (error) => {
      toast.error(`Lỗi: ${error.message}`);
    },
  });

  const deleteMutation = trpc.scheduledReport.delete.useMutation({
    onSuccess: () => {
      toast.success("Xóa báo cáo thành công");
      utils.scheduledReport.list.invalidate();
      setDeleteDialogOpen(false);
      setReportToDelete(null);
    },
    onError: (error) => {
      toast.error(`Lỗi: ${error.message}`);
    },
  });

  const toggleMutation = trpc.scheduledReport.update.useMutation({
    onSuccess: () => {
      toast.success("Cập nhật trạng thái thành công");
      utils.scheduledReport.list.invalidate();
    },
    onError: (error: any) => {
      toast.error(`Lỗi: ${error.message}`);
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
    });
    setDialogOpen(true);
  };

  const handleDelete = (report: ScheduledReport) => {
    setReportToDelete(report);
    setDeleteDialogOpen(true);
  };

  const handleSubmit = () => {
    const recipientsArray = form.recipients
      .split(",")
      .map((email) => email.trim())
      .filter((email) => email.length > 0);

    if (!form.name || recipientsArray.length === 0) {
      toast.error("Vui lòng điền đầy đủ thông tin");
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
    };

    if (editingReport) {
      updateMutation.mutate({ id: editingReport.id, ...data });
    } else {
      createMutation.mutate(data);
    }
  };

  const formatSchedule = (report: ScheduledReport) => {
    if (report.schedule === "DAILY") return "Hàng ngày";
    if (report.schedule === "WEEKLY") {
      const days = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];
      return `Hàng tuần (${days[report.scheduleDayOfWeek ?? 0]})`;
    }
    if (report.schedule === "MONTHLY") {
      return `Hàng tháng (Ngày ${report.scheduleDayOfMonth})`;
    }
    return report.schedule;
  };

  const formatReportType = (type: string) => {
    if (type === "NG_VISUAL") return "NG Visual";
    if (type === "DAILY_SUMMARY") return "Tổng hợp hàng ngày";
    if (type === "WEEKLY_SUMMARY") return "Tổng hợp hàng tuần";
    if (type === "MONTHLY_SUMMARY") return "Tổng hợp hàng tháng";
    if (type === "CUSTOM") return "Tùy chỉnh";
    return type;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Báo cáo tự động</CardTitle>
            <CardDescription>
              Cấu hình lịch gửi báo cáo NG Visual và các báo cáo khác qua email tự động
            </CardDescription>
          </div>
          <Button onClick={handleCreate} className="gap-2">
            <Plus className="h-4 w-4" />
            Tạo báo cáo mới
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
                <TableHead>Tên báo cáo</TableHead>
                <TableHead>Loại</TableHead>
                <TableHead>Lịch gửi</TableHead>
                <TableHead>Người nhận</TableHead>
                <TableHead>Lần gửi cuối</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead className="text-right">Thao tác</TableHead>
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
                    <div className="flex items-center gap-2 text-sm">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      {formatSchedule(report)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 text-sm">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      {report.recipients.length} người
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {report.lastSentAt
                      ? new Date(report.lastSentAt).toLocaleString("vi-VN")
                      : "Chưa gửi"}
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
            <h3 className="text-lg font-semibold mb-2">Chưa có báo cáo tự động</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Tạo báo cáo tự động đầu tiên để nhận email định kỳ
            </p>
            <Button onClick={handleCreate} className="gap-2">
              <Plus className="h-4 w-4" />
              Tạo báo cáo mới
            </Button>
          </div>
        )}

        {/* Create/Edit Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {editingReport ? "Chỉnh sửa báo cáo" : "Tạo báo cáo tự động mới"}
              </DialogTitle>
              <DialogDescription>
                Cấu hình lịch gửi báo cáo qua email tự động
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Tên báo cáo *</Label>
                <Input
                  id="name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Ví dụ: Báo cáo NG hàng ngày"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="reportType">Loại báo cáo</Label>
                  <Select
                    value={form.reportType}
                    onValueChange={(value: any) => setForm({ ...form, reportType: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NG_VISUAL">NG Visual</SelectItem>
                      <SelectItem value="DAILY_SUMMARY">Tổng hợp hàng ngày</SelectItem>
                      <SelectItem value="WEEKLY_SUMMARY">Tổng hợp hàng tuần</SelectItem>
                      <SelectItem value="MONTHLY_SUMMARY">Tổng hợp hàng tháng</SelectItem>
                      <SelectItem value="CUSTOM">Tùy chỉnh</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="schedule">Lịch gửi</Label>
                  <Select
                    value={form.schedule}
                    onValueChange={(value: any) => setForm({ ...form, schedule: value })}
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
              </div>

              {form.schedule === "WEEKLY" && (
                <div className="grid gap-2">
                  <Label htmlFor="dayOfWeek">Ngày trong tuần</Label>
                  <Select
                    value={form.scheduleDayOfWeek?.toString()}
                    onValueChange={(value) =>
                      setForm({ ...form, scheduleDayOfWeek: parseInt(value) })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Chọn ngày" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">Chủ nhật</SelectItem>
                      <SelectItem value="1">Thứ 2</SelectItem>
                      <SelectItem value="2">Thứ 3</SelectItem>
                      <SelectItem value="3">Thứ 4</SelectItem>
                      <SelectItem value="4">Thứ 5</SelectItem>
                      <SelectItem value="5">Thứ 6</SelectItem>
                      <SelectItem value="6">Thứ 7</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {form.schedule === "MONTHLY" && (
                <div className="grid gap-2">
                  <Label htmlFor="dayOfMonth">Ngày trong tháng</Label>
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
                <Label htmlFor="recipients">Người nhận (email) *</Label>
                <Input
                  id="recipients"
                  value={form.recipients}
                  onChange={(e) => setForm({ ...form, recipients: e.target.value })}
                  placeholder="email1@example.com, email2@example.com"
                />
                <p className="text-xs text-muted-foreground">
                  Nhập nhiều email cách nhau bằng dấu phẩy
                </p>
              </div>

              <div className="grid gap-2">
                <Label className="flex items-center gap-2">
                  <Filter className="h-4 w-4" />
                  Bộ lọc (tùy chọn)
                </Label>
                <div className="grid grid-cols-3 gap-4">
                  <Select
                    value={form.factoryId?.toString() || "all"}
                    onValueChange={(value) =>
                      setForm({ ...form, factoryId: value === "all" ? undefined : parseInt(value) })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Nhà máy" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Tất cả nhà máy</SelectItem>
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
                      <SelectValue placeholder="Xưởng" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Tất cả xưởng</SelectItem>
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
                      <SelectItem value="all">Tất cả line</SelectItem>
                      {lines?.map((l) => (
                        <SelectItem key={l.id} value={l.id.toString()}>
                          {l.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Hủy
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {(createMutation.isPending || updateMutation.isPending) && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {editingReport ? "Cập nhật" : "Tạo báo cáo"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <DeleteConfirmDialog
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
          itemType="báo cáo tự động"
          itemName={reportToDelete?.name}
          onConfirm={() => reportToDelete && deleteMutation.mutate({ id: reportToDelete.id })}
          isLoading={deleteMutation.isPending}
        />
      </CardContent>
    </Card>
  );
}
