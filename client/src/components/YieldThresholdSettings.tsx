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
  Gauge
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
  const updateMutation = trpc.yieldThreshold.update.useMutation({
    onSuccess: () => {
      toast.success("Đã cập nhật ngưỡng cảnh báo");
      refetch();
    },
    onError: (error) => {
      toast.error(`Lỗi: ${error.message}`);
    }
  });

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

    updateMutation.mutate({
      id: editingId,
      warningThreshold: parseFloat(editForm.warningThreshold),
      criticalThreshold: parseFloat(editForm.criticalThreshold),
      targetValue: editForm.targetValue ? parseFloat(editForm.targetValue) : undefined,
      comparisonOperator: editForm.comparisonOperator as any,
      isEnabled: editForm.isEnabled,
      notifyOnWarning: editForm.notifyOnWarning,
      notifyOnCritical: editForm.notifyOnCritical,
    });

    setEditingId(null);
    setEditForm(null);
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
    </div>
  );
}
