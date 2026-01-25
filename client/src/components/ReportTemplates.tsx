import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText, Calendar, Clock, Mail, CheckCircle, Settings, Plus, Loader2, BarChart3, Activity, TrendingUp } from "lucide-react";

interface ReportTemplate {
  id: number;
  code: string;
  name: string;
  description: string | null;
  templateType: string;
  sections: any;
  isActive: boolean;
  createdAt: Date;
}

export function ReportTemplates() {
  const [selectedTemplate, setSelectedTemplate] = useState<ReportTemplate | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    recipients: "",
    scheduleTime: "08:00",
    scheduleDayOfWeek: undefined as number | undefined,
    scheduleDayOfMonth: undefined as number | undefined,
    factoryId: undefined as number | undefined,
    isActive: true,
  });

  const { data: templates, isLoading } = trpc.scheduledReport.listTemplates.useQuery();
  const { data: factories } = trpc.factory.list.useQuery();
  
  const createFromTemplateMutation = trpc.scheduledReport.createFromTemplate.useMutation({
    onSuccess: (data) => {
      toast.success(`Đã tạo báo cáo từ template ${data.templateUsed}`);
      setIsCreateDialogOpen(false);
      setSelectedTemplate(null);
      resetForm();
    },
    onError: (error) => {
      toast.error(`Lỗi: ${error.message}`);
    },
  });

  const resetForm = () => {
    setFormData({
      name: "",
      recipients: "",
      scheduleTime: "08:00",
      scheduleDayOfWeek: undefined,
      scheduleDayOfMonth: undefined,
      factoryId: undefined,
      isActive: true,
    });
  };

  const handleCreateFromTemplate = () => {
    if (!selectedTemplate) return;
    
    const recipients = formData.recipients.split(",").map(e => e.trim()).filter(e => e);
    if (recipients.length === 0) {
      toast.error("Vui lòng nhập ít nhất một email người nhận");
      return;
    }

    createFromTemplateMutation.mutate({
      templateCode: selectedTemplate.code,
      name: formData.name || selectedTemplate.name,
      recipients,
      scheduleTime: formData.scheduleTime,
      scheduleDayOfWeek: formData.scheduleDayOfWeek,
      scheduleDayOfMonth: formData.scheduleDayOfMonth,
      factoryId: formData.factoryId,
      isActive: formData.isActive,
    });
  };

  const getTemplateIcon = (code: string) => {
    switch (code) {
      case "DAILY_QUALITY":
        return <BarChart3 className="h-8 w-8 text-blue-500" />;
      case "WEEKLY_SUMMARY":
        return <Activity className="h-8 w-8 text-green-500" />;
      case "MONTHLY_PERFORMANCE":
        return <TrendingUp className="h-8 w-8 text-purple-500" />;
      default:
        return <FileText className="h-8 w-8 text-gray-500" />;
    }
  };

  const getTemplateTypeLabel = (type: string) => {
    switch (type) {
      case "DAILY":
        return "Hàng ngày";
      case "WEEKLY":
        return "Hàng tuần";
      case "MONTHLY":
        return "Hàng tháng";
      default:
        return type;
    }
  };

  const getTemplateTypeBadgeColor = (type: string) => {
    switch (type) {
      case "DAILY":
        return "bg-blue-100 text-blue-800";
      case "WEEKLY":
        return "bg-green-100 text-green-800";
      case "MONTHLY":
        return "bg-purple-100 text-purple-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Mẫu Báo Cáo</h2>
          <p className="text-muted-foreground">
            Sử dụng các mẫu báo cáo có sẵn để tạo báo cáo định kỳ nhanh chóng
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {templates?.map((template) => (
          <Card key={template.id} className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="flex items-start justify-between">
                {getTemplateIcon(template.code)}
                <Badge className={getTemplateTypeBadgeColor(template.templateType)}>
                  {getTemplateTypeLabel(template.templateType)}
                </Badge>
              </div>
              <CardTitle className="mt-4">{template.name}</CardTitle>
              <CardDescription>{template.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* Sections included */}
                <div>
                  <p className="text-sm font-medium mb-2">Nội dung bao gồm:</p>
                  <div className="flex flex-wrap gap-1">
                    {(template.sections as any)?.includeYieldRate && (
                      <Badge variant="outline" className="text-xs">Tỷ lệ Yield</Badge>
                    )}
                    {(template.sections as any)?.includeNGAnalysis && (
                      <Badge variant="outline" className="text-xs">Phân tích NG</Badge>
                    )}
                    {(template.sections as any)?.includeTopNGPoints && (
                      <Badge variant="outline" className="text-xs">Top NG Points</Badge>
                    )}
                    {(template.sections as any)?.includeTrendCharts && (
                      <Badge variant="outline" className="text-xs">Biểu đồ xu hướng</Badge>
                    )}
                    {(template.sections as any)?.includeMachineComparison && (
                      <Badge variant="outline" className="text-xs">So sánh máy</Badge>
                    )}
                    {(template.sections as any)?.includeOEE && (
                      <Badge variant="outline" className="text-xs">OEE</Badge>
                    )}
                    {(template.sections as any)?.includeDowntime && (
                      <Badge variant="outline" className="text-xs">Downtime</Badge>
                    )}
                  </div>
                </div>

                <Button 
                  className="w-full" 
                  onClick={() => {
                    setSelectedTemplate(template);
                    setFormData(prev => ({
                      ...prev,
                      name: `${template.name} - ${new Date().toLocaleDateString('vi-VN')}`,
                    }));
                    setIsCreateDialogOpen(true);
                  }}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Sử dụng mẫu này
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}

        {(!templates || templates.length === 0) && (
          <Card className="col-span-full">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <FileText className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">Chưa có mẫu báo cáo nào</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Create from Template Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Tạo báo cáo từ mẫu</DialogTitle>
            <DialogDescription>
              {selectedTemplate?.name} - {selectedTemplate?.description}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Tên báo cáo</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Nhập tên báo cáo"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="recipients">Email người nhận (phân cách bằng dấu phẩy)</Label>
              <Input
                id="recipients"
                value={formData.recipients}
                onChange={(e) => setFormData(prev => ({ ...prev, recipients: e.target.value }))}
                placeholder="email1@example.com, email2@example.com"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="scheduleTime">Giờ gửi</Label>
                <Input
                  id="scheduleTime"
                  type="time"
                  value={formData.scheduleTime}
                  onChange={(e) => setFormData(prev => ({ ...prev, scheduleTime: e.target.value }))}
                />
              </div>

              {selectedTemplate?.templateType === "WEEKLY" && (
                <div className="space-y-2">
                  <Label>Ngày trong tuần</Label>
                  <Select
                    value={formData.scheduleDayOfWeek?.toString()}
                    onValueChange={(v) => setFormData(prev => ({ ...prev, scheduleDayOfWeek: parseInt(v) }))}
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

              {selectedTemplate?.templateType === "MONTHLY" && (
                <div className="space-y-2">
                  <Label>Ngày trong tháng</Label>
                  <Select
                    value={formData.scheduleDayOfMonth?.toString()}
                    onValueChange={(v) => setFormData(prev => ({ ...prev, scheduleDayOfMonth: parseInt(v) }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Chọn ngày" />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 28 }, (_, i) => (
                        <SelectItem key={i + 1} value={(i + 1).toString()}>
                          Ngày {i + 1}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>Nhà máy (tùy chọn)</Label>
              <Select
                value={formData.factoryId?.toString() || "all"}
                onValueChange={(v) => setFormData(prev => ({ 
                  ...prev, 
                  factoryId: v === "all" ? undefined : parseInt(v) 
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
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
              Hủy
            </Button>
            <Button 
              onClick={handleCreateFromTemplate}
              disabled={createFromTemplateMutation.isPending}
            >
              {createFromTemplateMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Đang tạo...
                </>
              ) : (
                <>
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Tạo báo cáo
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ReportTemplates;
