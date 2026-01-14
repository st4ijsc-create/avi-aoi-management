import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { 
  Target, 
  AlertTriangle, 
  Bell, 
  BellOff,
  Save,
  Loader2,
  TrendingUp,
  TrendingDown,
  Activity,
  Gauge,
  History,
  Clock,
  User,
  ArrowRight
} from "lucide-react";

const METRIC_INFO = {
  FPY: {
    name: "First Pass Yield",
    description: "Tỷ lệ đạt lần đầu - Sản phẩm đạt chất lượng ngay lần kiểm tra đầu tiên",
    icon: TrendingUp,
    color: "text-primary",
    unit: "%"
  },
  FY: {
    name: "Fail Yield",
    description: "Tỷ lệ lỗi - Tỷ lệ sản phẩm không đạt chất lượng",
    icon: TrendingDown,
    color: "text-destructive",
    unit: "%"
  },
  NTF: {
    name: "No Trouble Found",
    description: "Tỷ lệ không tìm thấy lỗi - Sản phẩm ban đầu NG nhưng kiểm tra lại OK",
    icon: Activity,
    color: "text-warning",
    unit: "%"
  },
  UPH: {
    name: "Units Per Hour",
    description: "Số lượng sản phẩm mỗi giờ - Năng suất sản xuất",
    icon: Gauge,
    color: "text-success",
    unit: "units/hr"
  }
};

export default function YieldThresholdSettings() {
  const { data: thresholds, isLoading, refetch } = trpc.yieldThreshold.list.useQuery();
  const { data: history, refetch: refetchHistory } = trpc.yieldThreshold.getHistory.useQuery({ limit: 50 });
  
  const updateMutation = trpc.yieldThreshold.updateWithHistory.useMutation({
    onSuccess: () => {
      toast.success("Đã cập nhật ngưỡng cảnh báo");
      refetch();
      refetchHistory();
    },
    onError: (error) => {
      toast.error(`Lỗi: ${error.message}`);
    }
  });

  const [activeTab, setActiveTab] = useState("settings");
  const [changeReasonDialog, setChangeReasonDialog] = useState(false);
  const [changeReason, setChangeReason] = useState("");

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<{
    warningThreshold: string;
    criticalThreshold: string;
    targetValue: string;
    comparisonOperator: string;
    isEnabled: boolean;
    notifyOnWarning: boolean;
    notifyOnCritical: boolean;
  } | null>(null);

  const handleEdit = (threshold: any) => {
    setEditingId(threshold.id);
    setEditForm({
      warningThreshold: threshold.warningThreshold,
      criticalThreshold: threshold.criticalThreshold,
      targetValue: threshold.targetValue || "",
      comparisonOperator: threshold.comparisonOperator,
      isEnabled: threshold.isEnabled,
      notifyOnWarning: threshold.notifyOnWarning,
      notifyOnCritical: threshold.notifyOnCritical,
    });
  };

  const handleSave = async () => {
    if (!editingId || !editForm) return;
    setChangeReasonDialog(true);
  };

  const handleConfirmSave = async () => {
    if (!editingId || !editForm) return;

    updateMutation.mutate({
      id: editingId,
      warningThreshold: parseFloat(editForm.warningThreshold),
      criticalThreshold: parseFloat(editForm.criticalThreshold),
      targetValue: editForm.targetValue ? parseFloat(editForm.targetValue) : undefined,
      comparisonOperator: editForm.comparisonOperator as any,
      isEnabled: editForm.isEnabled,
      notifyOnWarning: editForm.notifyOnWarning,
      notifyOnCritical: editForm.notifyOnCritical,
      changeReason: changeReason || undefined,
    });

    setEditingId(null);
    setEditForm(null);
    setChangeReasonDialog(false);
    setChangeReason("");
  };

  const handleCancel = () => {
    setEditingId(null);
    setEditForm(null);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            Cấu hình ngưỡng cảnh báo Yield
          </CardTitle>
          <CardDescription>
            Thiết lập ngưỡng cảnh báo cho các chỉ số FPY, FY, NTF và UPH. Hệ thống sẽ gửi thông báo khi vượt ngưỡng.
          </CardDescription>
        </CardHeader>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="settings" className="flex items-center gap-2">
            <Target className="h-4 w-4" />
            Cấu hình ngưỡng
          </TabsTrigger>
          <TabsTrigger value="history" className="flex items-center gap-2">
            <History className="h-4 w-4" />
            Lịch sử thay đổi
          </TabsTrigger>
        </TabsList>

        <TabsContent value="settings" className="mt-6">

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {thresholds?.map((threshold) => {
          const metricInfo = METRIC_INFO[threshold.metricType as keyof typeof METRIC_INFO];
          const Icon = metricInfo.icon;
          const isEditing = editingId === threshold.id;

          return (
            <Card key={threshold.id} className={`glass-card ${!threshold.isEnabled ? 'opacity-60' : ''}`}>
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg bg-muted ${metricInfo.color}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{metricInfo.name}</CardTitle>
                      <CardDescription className="text-xs mt-1">
                        {metricInfo.description}
                      </CardDescription>
                    </div>
                  </div>
                  <Badge variant={threshold.isEnabled ? "default" : "secondary"}>
                    {threshold.isEnabled ? "Đang bật" : "Đã tắt"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {isEditing && editForm ? (
                  <>
                    {/* Edit Mode */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className="text-xs">Ngưỡng cảnh báo ({metricInfo.unit})</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={editForm.warningThreshold}
                          onChange={(e) => setEditForm({ ...editForm, warningThreshold: e.target.value })}
                          className="h-9"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs">Ngưỡng nghiêm trọng ({metricInfo.unit})</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={editForm.criticalThreshold}
                          onChange={(e) => setEditForm({ ...editForm, criticalThreshold: e.target.value })}
                          className="h-9"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className="text-xs">Giá trị mục tiêu ({metricInfo.unit})</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={editForm.targetValue}
                          onChange={(e) => setEditForm({ ...editForm, targetValue: e.target.value })}
                          className="h-9"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs">Toán tử so sánh</Label>
                        <Select
                          value={editForm.comparisonOperator}
                          onValueChange={(v) => setEditForm({ ...editForm, comparisonOperator: v })}
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="gte">≥ Lớn hơn hoặc bằng</SelectItem>
                            <SelectItem value="gt">&gt; Lớn hơn</SelectItem>
                            <SelectItem value="lte">≤ Nhỏ hơn hoặc bằng</SelectItem>
                            <SelectItem value="lt">&lt; Nhỏ hơn</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="space-y-3 pt-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm">Bật cảnh báo</Label>
                        <Switch
                          checked={editForm.isEnabled}
                          onCheckedChange={(v) => setEditForm({ ...editForm, isEnabled: v })}
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label className="text-sm flex items-center gap-2">
                          <Bell className="h-4 w-4 text-warning" />
                          Thông báo khi cảnh báo
                        </Label>
                        <Switch
                          checked={editForm.notifyOnWarning}
                          onCheckedChange={(v) => setEditForm({ ...editForm, notifyOnWarning: v })}
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label className="text-sm flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4 text-destructive" />
                          Thông báo khi nghiêm trọng
                        </Label>
                        <Switch
                          checked={editForm.notifyOnCritical}
                          onCheckedChange={(v) => setEditForm({ ...editForm, notifyOnCritical: v })}
                        />
                      </div>
                    </div>

                    <div className="flex gap-2 pt-2">
                      <Button 
                        size="sm" 
                        onClick={handleSave}
                        disabled={updateMutation.isPending}
                        className="flex-1"
                      >
                        {updateMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        ) : (
                          <Save className="h-4 w-4 mr-2" />
                        )}
                        Lưu
                      </Button>
                      <Button 
                        size="sm" 
                        variant="outline" 
                        onClick={handleCancel}
                        className="flex-1"
                      >
                        Hủy
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    {/* View Mode */}
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Mục tiêu</p>
                        <p className="font-medium text-primary">
                          {threshold.targetValue || "-"} {metricInfo.unit}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Cảnh báo</p>
                        <p className="font-medium text-warning">
                          {threshold.comparisonOperator === 'gte' || threshold.comparisonOperator === 'gt' ? '< ' : '> '}
                          {threshold.warningThreshold} {metricInfo.unit}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Nghiêm trọng</p>
                        <p className="font-medium text-destructive">
                          {threshold.comparisonOperator === 'gte' || threshold.comparisonOperator === 'gt' ? '< ' : '> '}
                          {threshold.criticalThreshold} {metricInfo.unit}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-sm pt-2">
                      <div className="flex items-center gap-2">
                        {threshold.notifyOnWarning ? (
                          <Bell className="h-4 w-4 text-warning" />
                        ) : (
                          <BellOff className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="text-muted-foreground">Cảnh báo</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {threshold.notifyOnCritical ? (
                          <Bell className="h-4 w-4 text-destructive" />
                        ) : (
                          <BellOff className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="text-muted-foreground">Nghiêm trọng</span>
                      </div>
                    </div>

                    <Button 
                      size="sm" 
                      variant="outline" 
                      onClick={() => handleEdit(threshold)}
                      className="w-full mt-2"
                    >
                      Chỉnh sửa
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Info Card */}
      <Card className="glass-card border-primary/20">
        <CardContent className="pt-6">
          <div className="flex items-start gap-4">
            <div className="p-2 rounded-lg bg-primary/10">
              <AlertTriangle className="h-5 w-5 text-primary" />
            </div>
            <div className="space-y-2">
              <h4 className="font-medium">Hướng dẫn cấu hình ngưỡng</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• <strong>FPY (First Pass Yield)</strong>: Nên đặt ngưỡng cảnh báo ≥ 97%, nghiêm trọng ≥ 95%</li>
                <li>• <strong>FY (Fail Yield)</strong>: Nên đặt ngưỡng cảnh báo ≤ 2%, nghiêm trọng ≤ 3%</li>
                <li>• <strong>NTF (No Trouble Found)</strong>: Nên đặt ngưỡng cảnh báo ≤ 1.5%, nghiêm trọng ≤ 2%</li>
                <li>• <strong>UPH (Units Per Hour)</strong>: Tùy thuộc vào năng lực sản xuất của nhà máy</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="history" className="mt-6">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <History className="h-5 w-5 text-primary" />
                Lịch sử thay đổi ngưỡng
              </CardTitle>
              <CardDescription>
                Theo dõi các thay đổi ngưỡng cảnh báo theo thời gian
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!history || history.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <History className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>Chưa có lịch sử thay đổi</p>
                </div>
              ) : (
                <ScrollArea className="h-[500px]">
                  <div className="space-y-4">
                    {history.map((item, index) => {
                      const metricInfo = METRIC_INFO[item.metricType as keyof typeof METRIC_INFO];
                      const Icon = metricInfo?.icon || Activity;
                      return (
                        <div key={index} className="flex items-start gap-4 p-4 rounded-lg bg-muted/30 border border-border/50">
                          <div className={`p-2 rounded-lg bg-muted ${metricInfo?.color || 'text-primary'}`}>
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="flex-1 space-y-2">
                            <div className="flex items-center justify-between">
                              <Badge variant="outline">{item.metricType}</Badge>
                              <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {new Date(item.createdAt).toLocaleString('vi-VN')}
                              </span>
                            </div>
                            <div className="grid grid-cols-2 gap-4 text-sm">
                              <div>
                                <p className="text-xs text-muted-foreground mb-1">Ngưỡng cảnh báo</p>
                                <div className="flex items-center gap-2">
                                  <span className="text-warning">{item.previousWarning}%</span>
                                  <ArrowRight className="h-3 w-3" />
                                  <span className="text-warning font-medium">{item.newWarning}%</span>
                                </div>
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground mb-1">Ngưỡng nghiêm trọng</p>
                                <div className="flex items-center gap-2">
                                  <span className="text-destructive">{item.previousCritical}%</span>
                                  <ArrowRight className="h-3 w-3" />
                                  <span className="text-destructive font-medium">{item.newCritical}%</span>
                                </div>
                              </div>
                            </div>
                            {item.changeReason && (
                              <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
                                <strong>Lý do:</strong> {item.changeReason}
                              </div>
                            )}
                            {item.changedByName && (
                              <div className="text-xs text-muted-foreground flex items-center gap-1">
                                <User className="h-3 w-3" />
                                Thay đổi bởi: {item.changedByName}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Change Reason Dialog */}
      <Dialog open={changeReasonDialog} onOpenChange={setChangeReasonDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Lý do thay đổi ngưỡng</DialogTitle>
            <DialogDescription>
              Nhập lý do thay đổi ngưỡng cảnh báo (để theo dõi lịch sử)
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Textarea
              placeholder="Ví dụ: Điều chỉnh theo yêu cầu của QC, Cải thiện chất lượng sản xuất..."
              value={changeReason}
              onChange={(e) => setChangeReason(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChangeReasonDialog(false)}>
              Hủy
            </Button>
            <Button onClick={handleConfirmSave} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Đang lưu...</>
              ) : (
                <><Save className="h-4 w-4 mr-2" /> Lưu thay đổi</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
